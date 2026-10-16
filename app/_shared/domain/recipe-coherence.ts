import { groupByDish } from './dish.ts';
import { nameKey, normalizeName } from './ingredient-index.ts';
import type { Profile } from './profile.ts';
import { matchesMealShape, type ModelRecipe } from './recipe.ts';
import type { SkillFrontier } from './skill.ts';
/**
 * One check's verdict.
 *
 * Structurally identical to the eval harness's `CoherenceResult` on purpose: this module moved here
 * from `evals/graders/` so the shipped code and the sweep grade a recipe by the same definition,
 * and the eval's re-export needs no conversion.
 */
export type CoherenceResult = {
  metric: string;
  pass: boolean;
  /** 0..1. Boolean checks report 1 or 0; share-based checks report the share. */
  score: number;
  /** Written for a human reading one cell of the dashboard, so it names the offending line. */
  reason: string;
};

function metricResult(
  metric: string,
  pass: boolean,
  reason: string,
  score = pass ? 1 : 0,
): CoherenceResult {
  return { metric, pass, score, reason };
}

/**
 * The deterministic half of the eval rubric: the defects a recipe can carry while still being
 * schema-valid.
 *
 * The schema guarantees shape — every key present, units metric, steps numbered. It cannot
 * tell you that an ingredient was bought and never used, that one dish alone runs longer than
 * the meal is supposed to take, or that a step reaches for an oven the cook does not own.
 * Those are what a cook hits at the hob, and they are all checkable without a second model,
 * which is why they are here rather than in the judge: free to run, no variance, and the same
 * answer every time.
 *
 * Each check is scored on its own and reported under its own name, so a sweep can show that
 * (say) a cheaper arm holds structure but drops ingredients — a single pass/fail would hide
 * exactly the trade the sweep exists to measure.
 *
 * Deliberately lenient where prose is involved. A metric that cries wolf on every real recipe
 * gets ignored, which is worse than one that under-reports; where a judgement call was needed
 * the comments say which way it went.
 */

export const COHERENCE_METRICS = [
  'meal_shape',
  'roles_resolve',
  'ingredients_used',
  'prep_covered',
  'timings_add_up',
  'within_time_budget',
  'servings_match',
  'one_skill_node',
  'cues_present',
  'dutch_names',
  'equipment_respected',
  'equipment_listed',
] as const;
export type CoherenceMetric = (typeof COHERENCE_METRICS)[number];

/** What the checks need to know about the cook. The same fixture the provider sends to John. */
export type CoherenceContext = {
  profile: Profile;
  frontier: SkillFrontier;
};

type Check = (recipe: ModelRecipe, context: CoherenceContext) => CoherenceResult;

export function gradeRecipeCoherence(recipe: ModelRecipe, context: CoherenceContext): CoherenceResult[] {
  const checks: Check[] = [
    mealShape,
    rolesResolve,
    ingredientsUsed,
    prepCoveredByIngredients,
    timingsAddUp,
    withinTimeBudget,
    servingsMatch,
    oneSkillNode,
    cuesPresent,
    dutchNames,
    equipmentRespected,
    equipmentListed,
  ];

  return checks.map((check) => check(recipe, context));
}

/** Narrows the shared helper to this file's metric names, so a typo is a compile error. */
function result(metric: CoherenceMetric, pass: boolean, reason: string, score?: number): CoherenceResult {
  return metricResult(metric, pass, reason, score ?? (pass ? 1 : 0));
}

// --- the dishes the cook asked for --------------------------------------------------------

export const mealShape: Check = (recipe, { profile }) => {
  const produced = recipe.dishes.map((dish) => dish.slot);
  const pass = matchesMealShape(profile.meal_shape, produced);

  return result(
    'meal_shape',
    pass,
    pass
      ? `Cooked ${produced.join(', ')} as asked.`
      : `Asked for ${profile.meal_shape.join(', ')}, got ${produced.join(', ')}.`,
  );
};

/**
 * Every line's `dish` must be a role one of the dishes declared.
 *
 * This is the defect that bit on a live call and nowhere else: the model wrote the dish's NAME
 * where its role belongs, `groupByDish` filed those lines under a group no dish owned, and the
 * cook screen showed a shopping-list button with no list under it. Nothing threw.
 */
export const rolesResolve: Check = (recipe) => {
  const orphansIn = (lines: readonly { dish: string }[]) =>
    groupByDish(recipe.dishes, lines)
      .filter((group) => group.name === null)
      .map((group) => group.slot);

  const orphans = [
    ...orphansIn(recipe.ingredients),
    ...orphansIn(recipe.prep),
    ...orphansIn(recipe.steps),
  ];
  const distinct = [...new Set(orphans)];

  return result(
    'roles_resolve',
    distinct.length === 0,
    distinct.length === 0
      ? 'Every line is filed under a declared dish.'
      : `Lines labelled with no declared role: ${distinct.join(', ')}. Those render nowhere.`,
  );
};

// --- the ingredient list against the work ------------------------------------------------

/**
 * Words too generic to prove an ingredient was used.
 *
 * Without this list "olive oil" matches on "oil", which appears in nearly every recipe, and the
 * check passes an ingredient nobody touched. Colours and preparations go the same way.
 */
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  'and', 'the', 'of', 'with', 'for', 'into', 'fresh', 'dried', 'ground', 'whole', 'large', 'small',
  'extra', 'virgin', 'oil', 'sauce', 'powder', 'paste', 'leaves', 'leaf', 'stock', 'red', 'green',
  'white', 'black', 'yellow', 'brown', 'raw', 'cooked', 'plain', 'light', 'dark', 'free', 'range',
]);

/** Meaningful tokens of a name, falling back to all of them when every word is generic. */
function meaningfulTokens(name: string): string[] {
  const tokens = normalizeName(name).split(' ').filter((token) => token.length >= 3);
  const meaningful = tokens.filter((token) => !GENERIC_TOKENS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}

/** Every word of the prose a cook actually follows: prep instructions and step text. */
function workTokens(recipe: ModelRecipe): ReadonlySet<string> {
  const prose = [
    ...recipe.prep.flatMap((item) => [item.item, item.amount, item.instruction]),
    ...recipe.steps.flatMap((step) => [step.text, step.salt_cue ?? '', step.heat_cue ?? '']),
  ].join(' ');

  return new Set(normalizeName(prose).split(' '));
}

/**
 * Every ingredient on the list has to turn up in the prep or the steps.
 *
 * An ingredient that does not is a line on the shopping list the cook pays for and never uses —
 * and the pantry auto-deduct will mark it spent. Matching is by head word rather than verbatim,
 * because steps are prose: "sear the chicken" is how a recipe refers to "chicken thigh", and
 * demanding the full name would fail every honest recipe.
 */
export const ingredientsUsed: Check = (recipe) => {
  const used = workTokens(recipe);
  const unused = recipe.ingredients
    .filter((line) => !meaningfulTokens(line.name_en).some((token) => used.has(token)))
    .map((line) => line.name_en);

  const share = recipe.ingredients.length === 0 ? 0 : 1 - unused.length / recipe.ingredients.length;

  return result(
    'ingredients_used',
    unused.length === 0,
    unused.length === 0
      ? `All ${recipe.ingredients.length} ingredients are used.`
      : `Bought and never used: ${unused.join(', ')}.`,
    share,
  );
};

/**
 * The other direction: nothing in the prep list may be absent from the ingredient list.
 *
 * Checked on prep rather than on step prose because prep names things precisely while steps do
 * not — "beat the eggs" in a step could be reaching for an ingredient named something else, but
 * a prep item IS an ingredient with an amount against it. A prep item with no ingredient line is
 * something the cook discovers they do not have, with their station half built.
 *
 * KNOWN FALSE POSITIVES, measured on the 2026-10-12 sweep: a prep row naming equipment ("Kettle")
 * or a composite ("Spice mix") resolves to no ingredient line and is flagged although the recipe
 * is fine. Tolerable here, where a human reads the reason — which is why this metric is excluded
 * from `PATCH_SAFE_METRICS` rather than used as a gate. Fixing it properly needs the canonical
 * gear list in `CoherenceContext`; until a sweep says it is worth it, the exclusion is the fix.
 */
export const prepCoveredByIngredients: Check = (recipe) => {
  const onList = new Set(
    recipe.ingredients.flatMap((line) => [
      ...meaningfulTokens(line.name_en),
      ...meaningfulTokens(line.name_nl),
    ]),
  );

  const uncovered = recipe.prep
    .filter((item) => !meaningfulTokens(item.item).some((token) => onList.has(token)))
    .map((item) => item.item);

  const share = recipe.prep.length === 0 ? 0 : 1 - uncovered.length / recipe.prep.length;

  return result(
    'prep_covered',
    uncovered.length === 0,
    uncovered.length === 0
      ? 'Every prep item is on the ingredient list.'
      : `Prep calls for what was never bought: ${uncovered.join(', ')}.`,
    share,
  );
};

// --- time ---------------------------------------------------------------------------------

/**
 * No single dish may run longer than the meal's stated total.
 *
 * The comparison is per dish, not the sum of every timer: the cook has several hobs and the
 * three dishes run at once, so a meal with 25 minutes of timers across three dishes can
 * honestly be a 25-minute meal. Summing them would fail nearly every correct recipe. What
 * cannot be true is one dish, which is sequential within itself, outlasting the whole meal.
 */
export const timingsAddUp: Check = (recipe) => {
  const secondsByDish = new Map<string, number>();
  for (const step of recipe.steps) {
    const key = nameKey(step.dish);
    secondsByDish.set(key, (secondsByDish.get(key) ?? 0) + (step.timer_seconds ?? 0));
  }

  const totalSeconds = recipe.total_minutes * 60;
  const longest = [...secondsByDish.entries()].reduce(
    (worst, [dish, seconds]) => (seconds > worst.seconds ? { dish, seconds } : worst),
    { dish: '', seconds: 0 },
  );

  const pass = longest.seconds <= totalSeconds;

  return result(
    'timings_add_up',
    pass,
    pass
      ? `Longest dish is ${Math.round(longest.seconds / 60)} min inside a ${recipe.total_minutes} min meal.`
      : `The "${longest.dish}" dish alone needs ${Math.round(longest.seconds / 60)} min, ` +
          `but the meal claims ${recipe.total_minutes} min.`,
    pass ? 1 : Math.min(1, totalSeconds / longest.seconds),
  );
};

export const withinTimeBudget: Check = (recipe, { profile }) => {
  // The weekday ceiling: the tighter of the two, and the one a cook asking on a Tuesday means.
  const ceiling = profile.time_budget.weekday_minutes;
  const pass = recipe.total_minutes <= ceiling;

  return result(
    'within_time_budget',
    pass,
    pass
      ? `${recipe.total_minutes} min, inside the ${ceiling} min budget.`
      : `${recipe.total_minutes} min against a ${ceiling} min budget.`,
    pass ? 1 : Math.min(1, ceiling / recipe.total_minutes),
  );
};

export const servingsMatch: Check = (recipe, { profile }) => {
  const pass = recipe.servings === profile.default_servings;

  return result(
    'servings_match',
    pass,
    pass ? `Serves ${recipe.servings}.` : `Serves ${recipe.servings}, profile asks for ${profile.default_servings}.`,
  );
};

// --- teaching -----------------------------------------------------------------------------

/**
 * Exactly one stretch technique, at or below the cook's frontier on that attribute.
 *
 * The prompt asks for the lowest tier the main ingredient can carry. A tier above the frontier
 * is a technique the cook has not reached, which is the difference between being taught and
 * being shown off at.
 */
export const oneSkillNode: Check = (recipe, { frontier }) => {
  const node = recipe.skill_node;
  const reached = frontier[node.attribute];
  const pass = node.tier <= reached && node.why.trim().length > 0;

  if (node.why.trim().length === 0) {
    return result('one_skill_node', false, `Taught ${node.attribute} tier ${node.tier} with no reason given.`);
  }

  return result(
    'one_skill_node',
    pass,
    pass
      ? `Teaches ${node.attribute} at tier ${node.tier}, frontier is ${reached}.`
      : `Teaches ${node.attribute} at tier ${node.tier}, above the cook's frontier of ${reached}.`,
  );
};

/**
 * A meal-wide salt plan, and at least one cue a cook can see or hear.
 *
 * Both halves matter and they are different promises: the strategy is the one John is asked for
 * explicitly ("when and why salt goes in, across the whole meal"), while the per-step cues are
 * the thing that replaces "until the oil is ready".
 */
export const cuesPresent: Check = (recipe) => {
  const hasStrategy = recipe.salt_strategy.trim().length > 0;
  const withCue = recipe.steps.filter(
    (step) => (step.salt_cue ?? '').trim().length > 0 || (step.heat_cue ?? '').trim().length > 0,
  );
  const share = recipe.steps.length === 0 ? 0 : withCue.length / recipe.steps.length;
  const pass = hasStrategy && withCue.length > 0;

  const missing: string[] = [];
  if (!hasStrategy) missing.push('no meal-wide salt strategy');
  if (withCue.length === 0) missing.push('not one step gives a salt or heat cue');

  return result(
    'cues_present',
    pass,
    pass ? `Salt strategy present; ${withCue.length}/${recipe.steps.length} steps carry a cue.` : missing.join('; '),
    pass ? share : 0,
  );
};

/**
 * The Dutch column has to be Dutch.
 *
 * Shopping happens in Dutch supermarkets, so an English name in `name_nl` is a cook standing in
 * front of a shelf they cannot read. There is no dictionary here, so the check is that the two
 * columns mostly differ — which catches the real failure (the English name copied across every
 * line) while tolerating the genuine overlaps like "pasta" and "basilicum". Half is the bar: a
 * recipe where most names agree is not a Dutch ingredient list.
 */
const MIN_DUTCH_SHARE = 0.5;

export const dutchNames: Check = (recipe) => {
  const differing = recipe.ingredients.filter((line) => nameKey(line.name_nl) !== nameKey(line.name_en));
  const share = recipe.ingredients.length === 0 ? 0 : differing.length / recipe.ingredients.length;
  const pass = share >= MIN_DUTCH_SHARE;

  return result(
    'dutch_names',
    pass,
    pass
      ? `${differing.length}/${recipe.ingredients.length} ingredients carry a distinct Dutch name.`
      : `Only ${differing.length}/${recipe.ingredients.length} Dutch names differ from the English — ` +
          'the Dutch column looks copied.',
    share,
  );
};

// --- equipment ----------------------------------------------------------------------------

/**
 * Appliances a recipe cannot substitute its way out of.
 *
 * `wok` and `kettle` are deliberately absent: a wok is a pan and a kettle is hot water, and the
 * model reasonably writes "a wok or a large frying pan". Flagging those would make this metric
 * noise. An oven, a grill, an air fryer, a blender or a rice cooker you do not own is a step the
 * cook simply cannot perform.
 */
const BLOCKING_APPLIANCES = ['oven', 'air fryer', 'grill', 'blender', 'rice cooker', 'microwave'] as const;

/**
 * The blocking appliances a recipe's prose names, in the order `BLOCKING_APPLIANCES` lists them.
 *
 * Reads prep instructions and step text, and the list the cook is shown. The prose is normalised
 * once — punctuation gone and whitespace collapsed — so a phrase match is reliable and "ovenproof"
 * stays one token rather than reading as "oven".
 */
function appliancesNamedBy(recipe: ModelRecipe, includeEquipmentList: boolean): string[] {
  const prose = normalizeName(
    [
      ...recipe.prep.map((item) => item.instruction),
      ...recipe.steps.map((step) => step.text),
      ...(includeEquipmentList ? recipe.equipment : []),
    ].join(' . '),
  );
  const tokens = new Set(prose.split(' '));

  const mentioned = (appliance: string) =>
    appliance.includes(' ') ? prose.includes(appliance) : tokens.has(appliance);

  return BLOCKING_APPLIANCES.filter(mentioned);
}

export const equipmentRespected: Check = (recipe, { profile }) => {
  const owned = new Set(profile.appliances.map((name) => nameKey(name)));
  if (profile.oven) owned.add('oven');

  // The equipment list counts too: it is what the Overview tells the cook to set out, so an oven
  // on it is a request for an oven even if no step happens to use the word.
  const missing = appliancesNamedBy(recipe, true).filter((appliance) => !owned.has(nameKey(appliance)));

  return result(
    'equipment_respected',
    missing.length === 0,
    missing.length === 0
      ? 'Every method fits the kitchen on the card.'
      : `Calls for equipment the cook does not have: ${missing.join(', ')}.`,
  );
};

/**
 * The equipment list agrees with the method: every blocking appliance the prep or steps use is on
 * it, and it is not empty.
 *
 * The list is shown on the Overview as "what to set out", and it is only worth showing if it can be
 * trusted — an oven in the steps and not on the list is the cook finding out at the hob. Same
 * appliances as `equipmentRespected` and for the same reason: `wok` and `kettle` are left out
 * because "a wok or a large frying pan" is a legitimate sentence and the list may name either.
 *
 * An empty list fails: every meal this app makes is cooked in something, so an empty one means the
 * field was skipped rather than that nothing is needed.
 */
export const equipmentListed: Check = (recipe) => {
  if (recipe.equipment.length === 0) {
    return result('equipment_listed', false, 'No equipment is listed, although the meal has to be cooked in something.');
  }

  const listed = normalizeName(recipe.equipment.join(' . '));
  const listedTokens = new Set(listed.split(' '));
  const isListed = (appliance: string) =>
    appliance.includes(' ') ? listed.includes(appliance) : listedTokens.has(appliance);

  const unlisted = appliancesNamedBy(recipe, false).filter((appliance) => !isListed(appliance));

  return result(
    'equipment_listed',
    unlisted.length === 0,
    unlisted.length === 0
      ? 'Every appliance the method uses is on the equipment list.'
      : `The method uses ${unlisted.join(', ')}, which is not on the equipment list.`,
  );
};

/**
 * The checks a PATCH is held to: internal consistency only.
 *
 * The excluded ones all compare the recipe against the cook's profile or their original request —
 * `meal_shape`, `within_time_budget`, `servings_match`, `one_skill_node`, `equipment_respected`.
 * A patch is the cook deliberately departing from those: "make it for six" asks the recipe to
 * stop matching their default serving count, and a gate that read that as incoherent would refuse
 * the very change they asked for.
 *
 * What is left is what the recipe owes itself whatever the cook asked: every line belongs to a
 * declared dish, nothing is bought and left unused, the timings add up, the steps carry their
 * cues, and every ingredient has a Dutch name. A patch that breaks one of those has produced a
 * recipe nobody can cook from.
 *
 * `prep_covered` is deliberately NOT here, and that exclusion is measured rather than assumed.
 * On the 2026-10-12 sweep it failed BOTH Opus cells on prep rows reading "Kettle" and "Spice
 * mix" — a prep row may legitimately name equipment, or a composite of several ingredients, and
 * neither resolves to an ingredient line. As an eval metric a human reads the reason and judges
 * it; as a gate that REFUSES a patch, that same looseness rejects an edit the cook asked for,
 * which is the failure this whole feature exists to remove. The one patch operation that could
 * genuinely strand a prep row — `remove_ingredient` — already drops that row itself, so the gate
 * was guarding a state the vocabulary cannot reach.
 */
export const PATCH_SAFE_METRICS: readonly CoherenceMetric[] = [
  'roles_resolve',
  'ingredients_used',
  'timings_add_up',
  'cues_present',
  'dutch_names',
];

/**
 * Whether a patch made the recipe worse, and how. Null when it did not.
 *
 * Compares BEFORE against AFTER rather than judging the result on its own, and that is the whole
 * design: a recipe that was already flawed when generated must not block an unrelated edit, or
 * one bad generation freezes the recipe for the rest of the cook. Only a metric that went from
 * passing to failing is the patch's fault.
 *
 * O(checks x lines): six checks over a recipe of tens of lines, run once per patch, against a
 * model call that took seconds. The cost is not worth avoiding.
 */
export function patchIntroducedIncoherence(
  before: ModelRecipe,
  after: ModelRecipe,
  context: CoherenceContext,
): string | null {
  const passedBefore = new Set(
    gradeRecipeCoherence(before, context)
      .filter((result) => result.pass)
      .map((result) => result.metric),
  );

  for (const result of gradeRecipeCoherence(after, context)) {
    if (!PATCH_SAFE_METRICS.includes(result.metric as CoherenceMetric)) continue;
    if (result.pass) continue;
    if (!passedBefore.has(result.metric)) continue;

    return result.reason;
  }

  return null;
}
