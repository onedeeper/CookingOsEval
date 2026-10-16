import { z } from 'zod';
import { nameKey, sameName } from './ingredient-index.ts';
import type { IngredientResolver } from './recipe-resolve.ts';
import { ModelRecipeIngredientSchema, type PrepItem, type Recipe, type Step } from './recipe.ts';
import { UNITS } from './units.ts';

/**
 * `patch_recipe` — the tool John calls from the cook-screen bottom sheet.
 *
 * Why patches and not a regenerated recipe: the app renders straight from Recipe JSON, so an
 * edit expressed as a patch tells us exactly which lines moved. That is what makes the live
 * highlighting and the "Updated" toast possible, and it keeps a mid-cook answer from quietly
 * rewriting a step the cook already finished.
 *
 * Every operation is applied purely — `applyRecipePatch` returns a new recipe and never mutates
 * its input, so React re-renders correctly and an undo stack stays possible.
 *
 * Adding an operation: add a schema to the union, add a `case` in `applyOperation`, and add a
 * line to `describeOperation`. The exhaustive switches make the compiler point at both.
 */

const targetIngredient = z
  .string()
  .min(1)
  .max(120)
  .describe('The English name of the ingredient line to act on, as written in the recipe.');

/**
 * Caps on free text. Patch strings are written into `recipe_json`, and the recipe is re-embedded
 * in the prompt on every later question — so an unbounded step text costs tokens on every turn
 * for the rest of the cook, not just once.
 */
const stepText = z.string().min(1).max(2000);

export const ReplaceIngredientSchema = z.object({
  op: z.literal('replace_ingredient'),
  target_name_en: targetIngredient,
  replacement: ModelRecipeIngredientSchema,
});

export const AddIngredientSchema = z.object({
  op: z.literal('add_ingredient'),
  ingredient: ModelRecipeIngredientSchema,
});

export const RemoveIngredientSchema = z.object({
  op: z.literal('remove_ingredient'),
  target_name_en: targetIngredient,
});

export const SetIngredientAmountSchema = z.object({
  op: z.literal('set_ingredient_amount'),
  target_name_en: targetIngredient,
  amount: z.number().nonnegative().finite(),
  unit: z.enum(UNITS),
});

export const RewriteStepSchema = z.object({
  op: z.literal('rewrite_step'),
  number: z.int().min(1).describe('The step number to rewrite.'),
  text: stepText,
  salt_cue: z.string().max(500).nullable(),
  heat_cue: z.string().max(500).nullable(),
});

export const RewritePrepSchema = z.object({
  op: z.literal('rewrite_prep'),
  item: z.string().min(1).max(120).describe('The prep item to rewrite, as written in the recipe.'),
  amount: z.string().min(1).max(200),
  instruction: stepText,
});

export const SetServingsSchema = z.object({
  op: z.literal('set_servings'),
  servings: z.int().positive().max(50),
});

export const RecipePatchOperationSchema = z.discriminatedUnion('op', [
  ReplaceIngredientSchema,
  AddIngredientSchema,
  RemoveIngredientSchema,
  SetIngredientAmountSchema,
  RewriteStepSchema,
  RewritePrepSchema,
  SetServingsSchema,
]);
export type RecipePatchOperation = z.infer<typeof RecipePatchOperationSchema>;

/**
 * One answer should never need more than a handful of edits. The cap stops a confused model from
 * writing an unbounded change log into a row that is read back on every later question.
 */
export const MAX_PATCH_OPERATIONS = 12;

export const RecipePatchSchema = z.object({
  operations: z.array(RecipePatchOperationSchema).min(1).max(MAX_PATCH_OPERATIONS),
});
export type RecipePatch = z.infer<typeof RecipePatchSchema>;

/**
 * A line the cook screen should highlight for a few seconds. Identified by its content, not its
 * array position, because a patch may reorder nothing but still change several lines at once.
 */
export type ChangedLine =
  | { kind: 'ingredient'; name_en: string }
  | { kind: 'prep'; item: string }
  | { kind: 'step'; number: number }
  | { kind: 'servings' };

export type PatchResult = {
  recipe: Recipe;
  /** Lines to highlight. Free of duplicates, in the order they were touched. */
  changes: ChangedLine[];
  /** Human sentences for the recipe's change log and the "Updated" toast. */
  changeLog: string[];
  /** Operations that matched nothing or were refused. Surfaced so a no-op never looks like success. */
  skipped: RecipePatchOperation[];
  /**
   * Prep rows whose amount an amount change could not rescale, by item name.
   *
   * These carry no readable quantity ("a handful"), so they are left exactly as written — and
   * named here, because a prep row still showing the old amount with nothing saying so is the
   * silent half of this operation. The handler puts them in the tool result and John rewrites
   * them in the same answer.
   */
  unscaledPrep: string[];
};

export function applyRecipePatch(
  recipe: Recipe,
  patch: RecipePatch,
  resolve: IngredientResolver,
): PatchResult {
  let current = recipe;
  const changes: ChangedLine[] = [];
  const changeLog: string[] = [];
  const skipped: RecipePatchOperation[] = [];
  const unscaledPrep = new Set<string>();

  for (const operation of patch.operations) {
    const applied = applyOperation(current, operation, resolve);
    if (applied === null) {
      skipped.push(operation);
      continue;
    }
    current = applied.recipe;
    changes.push(...applied.changes);
    changeLog.push(describeOperation(operation));
    for (const item of applied.unscaledPrep ?? []) unscaledPrep.add(item);
  }

  return {
    recipe: current,
    changes: dedupeChanges(changes),
    changeLog,
    skipped,
    unscaledPrep: [...unscaledPrep],
  };
}

type AppliedOperation = {
  recipe: Recipe;
  changes: ChangedLine[];
  /** Prep rows this operation left at the old quantity. Omitted when it touched no amounts. */
  unscaledPrep?: string[];
};

/** Returns null when the operation matched nothing or had to be refused. */
function applyOperation(
  recipe: Recipe,
  operation: RecipePatchOperation,
  resolve: IngredientResolver,
): AppliedOperation | null {
  switch (operation.op) {
    case 'replace_ingredient':
      return replaceIngredient(recipe, operation, resolve);

    case 'add_ingredient':
      return {
        recipe: { ...recipe, ingredients: [...recipe.ingredients, resolve(operation.ingredient)] },
        changes: [{ kind: 'ingredient', name_en: operation.ingredient.name_en }],
      };

    case 'remove_ingredient':
      return removeIngredient(recipe, operation.target_name_en);

    case 'set_ingredient_amount': {
      const indices = findIngredientIndices(recipe, operation.target_name_en);
      if (indices.length === 0) return null;

      // Applied to every line with that name: the operation addresses an ingredient by name, so
      // the name is the identity it acts on. Changing one of two would leave the recipe saying
      // two different amounts for the same thing.
      const ingredients = [...recipe.ingredients];
      const changes: ChangedLine[] = [];
      /**
       * How far this ingredient moved, so the prep row that preps it can move with it.
       *
       * Taken from the first line that has a factor to offer, and only while the UNIT is
       * unchanged: 0.5 kg becoming 750 g is a ratio of 1500 by arithmetic and 1.5 in the
       * kitchen. With a unit change there is no honest factor, so prep is left alone.
       */
      let factor: number | null = null;
      for (const index of indices) {
        const line = ingredients[index];
        if (line === undefined) continue;
        if (factor === null && line.unit === operation.unit && line.amount > 0) {
          factor = operation.amount / line.amount;
        }
        ingredients[index] = { ...line, amount: operation.amount, unit: operation.unit };
        changes.push({ kind: 'ingredient', name_en: line.name_en });
      }

      if (factor === null) return { recipe: { ...recipe, ingredients }, changes };

      // Only this ingredient's prep rows: the other dishes did not move.
      const rescaled = rescalePrep(recipe.prep, factor, (entry) =>
        sameName(entry.item, operation.target_name_en),
      );
      return {
        recipe: { ...recipe, ingredients, prep: rescaled.prep },
        changes: [...changes, ...rescaled.changes],
        unscaledPrep: rescaled.unscaledPrep,
      };
    }

    case 'rewrite_step': {
      const index = recipe.steps.findIndex((step) => step.number === operation.number);
      const step = recipe.steps[index];
      if (step === undefined) return null;

      const steps = [...recipe.steps];
      steps[index] = {
        ...step,
        text: operation.text,
        salt_cue: operation.salt_cue,
        heat_cue: operation.heat_cue,
      };
      return { recipe: { ...recipe, steps }, changes: [{ kind: 'step', number: step.number }] };
    }

    case 'rewrite_prep': {
      const index = recipe.prep.findIndex((entry) => sameName(entry.item, operation.item));
      const entry = recipe.prep[index];
      if (entry === undefined) return null;

      const prep = [...recipe.prep];
      prep[index] = { ...entry, amount: operation.amount, instruction: operation.instruction };
      return { recipe: { ...recipe, prep }, changes: [{ kind: 'prep', item: entry.item }] };
    }

    case 'set_servings':
      return setServings(recipe, operation.servings);
  }
}

/**
 * Swaps an ingredient, and makes the rest of the recipe read correctly afterwards.
 *
 * Two rules earn their keep here:
 *
 * 1. The rename is driven by the name stored in the recipe, NOT by the spelling the model used to
 *    address it. Lines are matched on a normalized key, so `target_name_en: 'creme fraiche'`
 *    correctly finds a line named `crème fraîche` — but a regex built from the unaccented
 *    spelling would then match nothing in the steps, and the swap would silently half-apply.
 *
 * 2. Mentions elsewhere are only rewritten once the old ingredient is gone from the recipe
 *    entirely. Two dishes can legitimately list the same ingredient, and a mention in a step
 *    cannot be attributed to one line or the other — so while a duplicate remains, rewriting
 *    would be a guess. The model can address those lines individually with `rewrite_step`.
 */
function replaceIngredient(
  recipe: Recipe,
  operation: z.infer<typeof ReplaceIngredientSchema>,
  resolve: IngredientResolver,
): AppliedOperation | null {
  const indices = findIngredientIndices(recipe, operation.target_name_en);
  if (indices.length === 0) return null;

  // The replacement names a dish, which is what disambiguates when several lines share a name:
  // two dishes using shallots hold different amounts, so the one being swapped is the one in the
  // dish the replacement belongs to.
  const index =
    indices.find((candidate) => recipe.ingredients[candidate]?.dish === operation.replacement.dish) ??
    indices[0];
  if (index === undefined) return null;

  const existing = recipe.ingredients[index];
  if (existing === undefined) return null;

  const ingredients = [...recipe.ingredients];
  ingredients[index] = resolve(operation.replacement);

  const swapped: Recipe = { ...recipe, ingredients };
  const changes: ChangedLine[] = [{ kind: 'ingredient', name_en: operation.replacement.name_en }];

  if (hasIngredientNamed(swapped, existing.name_en)) {
    return { recipe: swapped, changes };
  }

  const renamed = renameMentions(swapped, existing.name_en, operation.replacement.name_en);
  return { recipe: renamed.recipe, changes: [...changes, ...renamed.changes] };
}

/**
 * Removes every line with this name, and the prep that went with it.
 *
 * Every match goes, because the change log says "Removed shallot" — leaving a second shallot line
 * behind would make that a lie. The prep rows go too: a mise-en-place entry for an ingredient
 * that is no longer in the recipe is prep the cook does for nothing.
 */
function removeIngredient(recipe: Recipe, nameEn: string): AppliedOperation | null {
  const indices = new Set(findIngredientIndices(recipe, nameEn));
  if (indices.size === 0) return null;

  const ingredients = recipe.ingredients.filter((_, position) => !indices.has(position));

  // A recipe with no ingredients is not a valid Recipe, and the repository would refuse to save
  // it — turning a mid-cook question into a failed, already-paid-for request. Refusing here
  // reports it as skipped instead, which the model can see and correct.
  if (ingredients.length === 0) return null;

  const changes: ChangedLine[] = [{ kind: 'ingredient', name_en: nameEn }];

  const prep = recipe.prep.filter((entry) => {
    const belongsToRemoved = sameName(entry.item, nameEn);
    if (belongsToRemoved) changes.push({ kind: 'prep', item: entry.item });
    return !belongsToRemoved;
  });

  return { recipe: { ...recipe, ingredients, prep }, changes };
}

/**
 * Changes the serving count AND scales every amount to match.
 *
 * Scaling is the point: the toast says "Now cooking for 6", and if the amounts still feed 3 then
 * the toast is a lie and the cook follows it into an under-seasoned, under-portioned meal. The
 * tool description tells the model not to send amount operations alongside this one.
 */
function setServings(recipe: Recipe, servings: number): AppliedOperation | null {
  if (servings === recipe.servings) return null;

  const factor = servings / recipe.servings;
  const changes: ChangedLine[] = [{ kind: 'servings' }];

  const ingredients = recipe.ingredients.map((line) => {
    // A unit with no number attached has nothing to scale.
    if (line.unit === 'to_taste' || line.amount === 0) return line;
    changes.push({ kind: 'ingredient', name_en: line.name_en });
    return { ...line, amount: round(line.amount * factor) };
  });

  // Every prep row, because a serving change moves the whole meal.
  const rescaled = rescalePrep(recipe.prep, factor, () => true);

  return {
    recipe: { ...recipe, servings, ingredients, prep: rescaled.prep },
    changes: [...changes, ...rescaled.changes],
    unscaledPrep: rescaled.unscaledPrep,
  };
}

/**
 * Rescales the quantity on the prep rows an amount change touched.
 *
 * `prep[].amount` is a SECOND copy of the amount — free text like "2, finely sliced", rendered
 * verbatim on the Prep tab. Moving the ingredient line without it left the cook slicing the
 * quantity for the old serving count, with nothing anywhere saying so.
 *
 * Step text is deliberately NOT rescaled. "Fry for 5 minutes" and "add 500g chicken" are the
 * same shape to a regex, and doubling a cooking time is a far worse failure than a stale amount
 * — so John is asked to rewrite the steps that name an amount, and the numbers in prose are
 * never touched by us.
 */
function rescalePrep(
  prep: readonly PrepItem[],
  factor: number,
  touches: (entry: PrepItem) => boolean,
): { prep: PrepItem[]; changes: ChangedLine[]; unscaledPrep: string[] } {
  const changes: ChangedLine[] = [];
  const unscaledPrep: string[] = [];

  const rescaled = prep.map((entry) => {
    if (!touches(entry)) return entry;

    const amount = scaleAmountText(entry.amount, factor);
    if (amount === null) {
      unscaledPrep.push(entry.item);
      return entry;
    }
    if (amount === entry.amount) return entry;

    changes.push({ kind: 'prep', item: entry.item });
    return { ...entry, amount };
  });

  return { prep: rescaled, changes, unscaledPrep };
}

/**
 * Scales the quantity inside a free-text prep amount: "2, finely sliced" at factor 2 becomes
 * "4, finely sliced".
 *
 * Only the FIRST number moves, and every word is left exactly as written. Both halves are
 * deliberate:
 *
 *  - the first number is the quantity; a later one belongs to the instruction ("2 cloves, sliced
 *    into 3"), and scaling that would change the method rather than the amount;
 *  - the decimal separator is `.` and never `,`, because a comma is the separator in the common
 *    shape "2, finely sliced" — reading that as 2,0 would swallow the qualifier.
 *
 * Returns null when there is no number to read at all ("a handful"), which the caller must
 * report rather than pass off as rescaled.
 */
function scaleAmountText(text: string, factor: number): string | null {
  const match = /\d+(?:\.\d+)?/.exec(text);
  if (match === null) return null;

  const quantity = match[0];
  const scaled = round(Number(quantity) * factor);
  return `${text.slice(0, match.index)}${scaled}${text.slice(match.index + quantity.length)}`;
}

/** Two decimal places is finer than any kitchen scale and keeps float noise out of the JSON. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rewrites a removed ingredient everywhere the cook would otherwise read its old name.
 *
 * Called only once that ingredient is gone from the recipe, so every remaining mention of it is
 * stale by definition — in prep, in step text, in the cues printed beneath each step, in the dish
 * titles, and in the card the cook screenshots and takes to the shops.
 *
 * O(prep + steps) replacements over short strings: tens of lines, not thousands.
 */
function renameMentions(recipe: Recipe, from: string, to: string): AppliedOperation {
  const rename = makeRenamer(from, to);
  const changes: ChangedLine[] = [];

  const prep = recipe.prep.map((entry) => {
    const updated: PrepItem = {
      ...entry,
      item: rename(entry.item),
      amount: rename(entry.amount),
      instruction: rename(entry.instruction),
    };
    if (
      updated.item === entry.item &&
      updated.amount === entry.amount &&
      updated.instruction === entry.instruction
    ) {
      return entry;
    }
    changes.push({ kind: 'prep', item: updated.item });
    return updated;
  });

  const steps = recipe.steps.map((step) => {
    const updated: Step = {
      ...step,
      text: rename(step.text),
      // The cues print directly beneath the step on the Cook tab. Leaving them unrenamed puts
      // "Salt the shallot now" under "Fry the red onion", naming an ingredient that is gone.
      salt_cue: step.salt_cue === null ? null : rename(step.salt_cue),
      heat_cue: step.heat_cue === null ? null : rename(step.heat_cue),
    };
    if (
      updated.text === step.text &&
      updated.salt_cue === step.salt_cue &&
      updated.heat_cue === step.heat_cue
    ) {
      return step;
    }
    changes.push({ kind: 'step', number: step.number });
    return updated;
  });

  return {
    recipe: {
      ...recipe,
      prep,
      steps,
      dishes: recipe.dishes.map((dish) => ({ ...dish, name: rename(dish.name) })),
      salt_strategy: rename(recipe.salt_strategy),
      summary_card: rename(recipe.summary_card),
      high_leverage_ingredients: recipe.high_leverage_ingredients.map(rename),
    },
    changes,
  };
}

/**
 * Builds a replacer for one rename.
 *
 * Two things a naive `String.replace` gets wrong:
 *
 *  - `\b` is defined over `[A-Za-z0-9_]`, so it never matches a name that starts or ends outside
 *    ASCII — `'nduja`, `açaí`, `purée`. The boundary is spelled with Unicode letter/number
 *    classes instead. A leading capture group is used rather than a lookbehind, because this
 *    module also ships to Hermes in the app.
 *  - a replacement string is interpreted: `$&` splices the matched text back in, `$'` the rest of
 *    the sentence. Ingredient names are untrusted tool arguments, so a function replacer is used,
 *    which treats the replacement as literal text.
 */
function makeRenamer(from: string, to: string): (text: string) => string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'giu');

  return (text) =>
    text.replace(pattern, (_match, lead: string, matched: string) => `${lead}${matchCase(matched, to)}`);
}

/**
 * Keeps sentence capitalisation. The step text is the largest thing on the cook screen, so a
 * swap that turns "Shallot first, then the chicken" into "red onion first" is conspicuous.
 */
function matchCase(matched: string, replacement: string): string {
  const firstMatched = matched.charAt(0);
  if (firstMatched !== firstMatched.toUpperCase() || firstMatched === firstMatched.toLowerCase()) {
    return replacement;
  }
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

/** Every ingredient line with this name. Names are matched on a normalized key. */
function findIngredientIndices(recipe: Recipe, nameEn: string): number[] {
  const indices: number[] = [];
  recipe.ingredients.forEach((line, index) => {
    if (sameName(line.name_en, nameEn)) indices.push(index);
  });
  return indices;
}

function hasIngredientNamed(recipe: Recipe, nameEn: string): boolean {
  return recipe.ingredients.some((line) => sameName(line.name_en, nameEn));
}

function dedupeChanges(changes: readonly ChangedLine[]): ChangedLine[] {
  const seen = new Set<string>();
  const unique: ChangedLine[] = [];
  for (const change of changes) {
    const key = changeKey(change);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(change);
  }
  return unique;
}

/** Stable identity for a changed line, used for de-duping and as a React key. */
export function changeKey(change: ChangedLine): string {
  switch (change.kind) {
    case 'ingredient':
      return `ingredient:${nameKey(change.name_en)}`;
    case 'prep':
      return `prep:${nameKey(change.item)}`;
    case 'step':
      return `step:${change.number}`;
    case 'servings':
      return 'servings';
  }
}

/**
 * The sentence shown in the "Updated" toast and kept in the recipe's change log. Generated from
 * the operation rather than taken from the model, so the log always describes what actually
 * happened to the recipe.
 */
export function describeOperation(operation: RecipePatchOperation): string {
  switch (operation.op) {
    case 'replace_ingredient':
      return `Swapped ${operation.target_name_en} for ${operation.replacement.name_en}`;
    case 'add_ingredient':
      return `Added ${operation.ingredient.name_en}`;
    case 'remove_ingredient':
      return `Removed ${operation.target_name_en}`;
    case 'set_ingredient_amount':
      return `Changed ${operation.target_name_en} to ${operation.amount}${operation.unit}`;
    case 'rewrite_step':
      return `Updated step ${operation.number}`;
    case 'rewrite_prep':
      return `Updated prep for ${operation.item}`;
    case 'set_servings':
      return `Now cooking for ${operation.servings}`;
  }
}

/**
 * What John reads back after his own patch, as the tool result.
 *
 * This is his ONLY feedback channel: he cannot see the recipe row we saved, so anything this
 * sentence leaves out, he cannot act on. It therefore reports the two silent outcomes as well
 * as the happy one — operations that matched nothing, and prep rows left at the old quantity
 * because their amount carries no number to scale. Both used to go unmentioned, which is how a
 * stale prep row reached a cook with John sounding certain.
 *
 * Lives here rather than in the handler so it is testable: the handler calls `Deno.serve` at
 * module scope and Jest cannot import it.
 */
export function summarisePatchForModel(result: PatchResult): string {
  const parts: string[] = [];

  parts.push(
    result.changeLog.length === 0
      ? 'Nothing matched, so the recipe is unchanged. Check the names and step numbers.'
      : `Applied: ${result.changeLog.join('; ')}.`,
  );

  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} operation(s) matched nothing.`);
  }

  if (result.unscaledPrep.length > 0) {
    parts.push(
      `These prep rows still show the OLD amount because their quantity is not a number: ` +
        `${result.unscaledPrep.join(', ')}. Call rewrite_prep for each one in this same answer.`,
    );
  }

  return parts.join(' ');
}

/** One sentence summarising a whole patch, for the toast. */
export function describePatch(changeLog: readonly string[]): string {
  const [first] = changeLog;
  if (first === undefined) return 'Nothing changed';
  if (changeLog.length === 1) return first;
  return `${first} +${changeLog.length - 1} more`;
}
