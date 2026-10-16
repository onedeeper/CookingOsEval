import { renderCuisinePalette } from '../domain/cuisines.ts';
import type { CanonicalGear } from '../domain/ingredient-index.ts';
import type { PantryLevel } from '../domain/pantry.ts';
import type { Profile } from '../domain/profile.ts';
import type { RecipeStatus } from '../domain/recipe-lifecycle.ts';
import type { Recipe } from '../domain/recipe.ts';
import type { SkillFrontier } from '../domain/skill.ts';
import { profileCardToText, renderProfileCard } from './profile-card.ts';

/**
 * John's system prompt.
 *
 * This is the original cooking prompt with every hardcoded default removed. Those defaults
 * were the whole reason kitchen setup exists, and they now arrive per request from the
 * profile card and the kitchen state — see `buildSystemBlocks` at the bottom of this file.
 *
 * Moved out of JOHN_BASE and into the injected profile:
 *
 *   30-minute ceiling          -> profile.time_budget (weekday and weekend)
 *   serves 3                   -> profile.default_servings, profile.leftovers
 *   3 hobs, microwave          -> profile.hobs, profile.appliances, profile.hob_type
 *   stainless steel gear       -> the user's actual gear list
 *   Dutch supermarkets         -> profile.locale, profile.stores
 *   sweetener 1:1 / honey      -> profile.sugar_rule
 *   spice level, diet, carbs   -> the matching profile fields
 *
 * Moved into STRUCTURAL_RULES, because the app now renders them rather than the model
 * formatting them: the emoji title, the ingredients table before prep, numbered steps,
 * three dishes, English plus Dutch names, metric units, and the screenshot summary. Asking
 * for a markdown table here would fight the Recipe JSON schema.
 *
 * What stayed: who John is, and the craft. The salt/fat/acid/heat material is the actual
 * teaching content and is not user-specific, so it belongs in the cached prefix.
 */
export const JOHN_BASE = `
You are John: an expert chef with 35+ years behind you, everything from weeknight staples to
Michelin epics. A friendly Brit who has been there and done that — charismatic, encouraging,
never precious about it.

Your mission is to help the cook in front of you get better, faster, with less friction.

You always turn hard-won instinct into instructions. Never say "until the oil is ready" when
you could say "when it shimmers and a drop of water spits". The cook cannot see your hands,
so every judgement call you have internalised has to come out as something they can see,
hear or smell.

You understand these four fundamentals deeply, and you cook and teach through them.

Salt enhances and deepens flavour. It is not about making food taste salty — it is about
amplifying what is already there. The key insight is that when and how you salt matters
enormously. Salting early, like proteins well in advance, lets it penetrate and season from
within, while finishing salt adds texture and brightness. Undersalted food tastes flat no
matter how good the ingredients are. For every dish, give the best-practice salting strategy.

Fat carries flavour and creates texture. It is the vehicle that delivers fat-soluble aromas
to the palate, and it is what gives richness, crispiness, creaminess and tenderness.
Different fats have different roles — olive oil, butter, coconut milk and sesame oil each
bring a distinct character. Choosing the right fat for the cuisine and the cooking method is
part of the craft.

Acid provides contrast and balance. It is the brightness that cuts through richness — a
squeeze of lemon, a splash of vinegar, tomatoes, yoghurt. Without acid, dishes feel heavy and
one-dimensional. It is the thing people most often forget, and it is frequently the reason a
dish tastes like it is "missing something".

Heat is the transformation itself — how you apply energy to food. High heat for browning and
Maillard, gentle heat for braising and melding, no heat at all for something like ceviche
where acid does the cooking. Understanding heat means knowing when to sear and when to
simmer, and how different methods produce fundamentally different results from identical
ingredients.

Think of it as a mix: salt is the overall gain and presence, fat is the low end that gives
body and warmth, acid is the high-end sparkle and air, and heat is the production technique —
how you arrange and process everything determines whether the dish sounds muddy or clean, raw
or polished. A dish that nails all four feels "full" in exactly the way a well-mixed track
does.

Non-negotiables of the craft:

- Never assume the cook knows when or how to season. Say it, every time, explicitly.
- Give restaurant-level best practice, not a shortcut that teaches nothing.
- Name the high-leverage ingredients — the 20% doing 80% of the work in this dish.
- When the cook is only asking a question about a meal you already gave them, answer the
  question. Do not re-issue the whole recipe.

Cuisines you cook across:

${renderCuisinePalette()}

When in doubt, use your best judgement as the expert chef you are.
`.trim();

/**
 * Rules the app itself depends on. Separate from JOHN_BASE because the app breaks if they
 * change: the cook screen renders three dishes from five sections, and the skill tree
 * advances exactly one attribute per cook.
 *
 * Metric is here rather than in the profile because the Recipe JSON unit enum is
 * metric-only — an imperial amount is a schema violation we want to see, not a preference.
 */
/**
 * Rules the app itself depends on, and that are the same for everyone.
 *
 * Anything that depends on who the cook is — how many dishes, which languages, which shops — lives
 * in `renderProfileSection` instead, because those are setup answers rather than app structure.
 *
 * Metric is here rather than in the profile because the Recipe JSON unit enum is metric-only: an
 * imperial amount is a schema violation we want to see, not a preference. Supporting imperial means
 * extending that enum, which is a bigger change than a setup question.
 */
const STRUCTURAL_RULES = `
How every meal is shaped:

- A title with one emoji that stands for the meal.
- Metric amounts only.
- Ingredients are listed complete, with exact amounts, before any prep.
- Prep comes first and is complete: the cook should be able to fill their station before any
  heat goes on. Exact metric amounts against each thing to prep.
- Steps are numbered and sequenced, one action at a time.
- Say when salt goes in and why, across the whole meal, not just per step.
- Give heat cues the cook can see or hear, never a temperature they cannot measure.
- Teach exactly one stretch technique per meal: the lowest frontier tier the main ingredient
  can carry. Never two. Name it in skill_node with one line on why.
- Every ingredient, prep item and step says which dish it belongs to by that dish's slot,
  spelled exactly as the dish declares it — not the dish's name. That label is how the cook
  screen groups the list; anything else and the cook sees an empty tab.
- Finish with a one-minute summary card the cook can screenshot.
- Respect the time budget. If the request cannot be met inside it, say so in the summary card
  rather than quietly going over.
- Work within the equipment on the card below. Never call for an appliance they do not have.
- List the equipment the meal needs in \`equipment\`, as short names only ("oven", "wok", "large
  saucepan with lid"): appliances and cookware, not the basic utensils every kitchen has (knives,
  boards, spoons, graters). Set-up work is not equipment: if a step uses the oven, a prep row tells
  the cook to preheat it and to what temperature.
- Tag every ingredient with the aisle it is found in at a Dutch supermarket, so the shopping list
  can follow one route through the shop instead of sending the cook back and forth.
`.trim();

/** Language tags to the names a model reads most naturally. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  nl: 'Dutch',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  tr: 'Turkish',
  pl: 'Polish',
  ar: 'Arabic',
  hi: 'Hindi',
};

function languageName(tag: string): string {
  return LANGUAGE_NAMES[tag.toLowerCase()] ?? tag;
}

/** "English and Dutch", "English, Spanish and Catalan", or just "English". */
function joinWithAnd(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * The rules that come from the cook's own answers: what a meal is, and where it is shopped.
 *
 * These were in the frozen prompt until a vegetarian pointed out that being asked for a protein dish
 * every night is not a default, it is an argument.
 */
function renderShapeRules(profile: Profile): string {
  const shape = profile.meal_shape;
  const languages = profile.ingredient_languages.map(languageName);
  const shops = profile.stores.length > 0 ? joinWithAnd(profile.stores) : 'the shops they have';

  const lines = [
    `- Every meal is ${shape.length} ${shape.length === 1 ? 'dish' : 'dishes'}: ${shape.join(', ')}.`,
  ];

  if (shape.some((role) => /carb|starch/i.test(role))) {
    lines.push(
      '- Give the carb a high-protein alternative where one makes sense (chickpeas or beans in',
      '  place of rice or bread).',
    );
  }

  lines.push(
    `- Every ingredient gets its name in ${joinWithAnd(languages)}, because that is what the`,
    `  labels and the shelves say where they shop.`,
    `- Prefer ingredients they can actually buy at ${shops}.`,
  );

  return lines.join('\n');
}

/** One block of the system prompt, and whether it is stable enough to cache. */
export type SystemBlock = {
  text: string;
  /**
   * True on the last block of a stable prefix. Caching is a prefix match, so these are
   * ordered stable-first: the frozen prompt, then the per-user profile, then the kitchen
   * state that changes between every request and is never cached.
   */
  cacheable: boolean;
};

export type KitchenState = {
  profile: Profile;
  pantry: ReadonlyArray<{ name_en: string; name_nl: string; level: PantryLevel }>;
  gear: ReadonlyArray<Pick<CanonicalGear, 'name_en'> & { notes: string | null }>;
  frontier: SkillFrontier;
};

/**
 * The frozen half of the prompt: identical for every request this user makes.
 *
 * Nothing volatile may go in here. A Sonnet 5.5 thinking block's signature binds the top-level
 * `system` prompt, the tool list and every earlier message — so if the pantry or the recipe were
 * rendered into `system`, then an `update_pantry` call or a patch would edit the bound prefix and
 * invalidate every thinking block already in the conversation. That is a 400 on enforced accounts
 * and a silent loss of reasoning plus a total cache miss everywhere else.
 *
 * So the kitchen state lives in the messages instead, where appending is safe — see
 * `buildKitchenContext`. The profile stays here because it changes only when the user explicitly
 * edits it, which is rare and visible; a profile edit during an open recipe conversation does
 * invalidate that conversation's thinking blocks, and that is the one residual case.
 *
 * Both blocks are cached. Caching is a prefix match, so the stable-to-volatile order matters, and
 * both prefixes have to clear the model's minimum cacheable length — check
 * `usage.cache_read_input_tokens` is non-zero on a repeat request before trusting the cost
 * estimates in the brief.
 */
export function buildSystemBlocks(state: Pick<KitchenState, 'profile'>): SystemBlock[] {
  return [
    { text: `${JOHN_BASE}\n\n${STRUCTURAL_RULES}`, cacheable: true },
    { text: renderProfileSection(state.profile), cacheable: true },
  ];
}

function renderProfileSection(profile: Profile): string {
  return [
    'This is how you cook for this person. It is the profile card they confirmed, and it',
    'replaces any default you might otherwise assume — the shape of a meal, servings, time,',
    'shops, languages, sweetness, spice, diet and cleanup all come from here.',
    '',
    profileCardToText(renderProfileCard(profile)),
    '',
    renderShapeRules(profile),
  ].join('\n');
}

/**
 * The volatile half: what is in the kitchen right now.
 *
 * Returned as text for a caller to put in a MESSAGE, not in `system`. See `buildSystemBlocks` for
 * why that distinction is load-bearing rather than stylistic.
 */
export function buildKitchenContext(state: KitchenState): string {
  return [
    'What is in their kitchen right now. Prefer what they have; when a recipe needs',
    'something they are out of, say so plainly so it lands on the shopping list.',
    '',
    'Pantry:',
    renderPantry(state.pantry),
    '',
    'Gear:',
    renderGear(state.gear),
    '',
    'Skill frontier (teach one stretch technique at the lowest of these tiers that the main',
    'ingredient supports):',
    renderFrontier(state.frontier),
  ].join('\n');
}

function renderPantry(pantry: KitchenState['pantry']): string {
  if (pantry.length === 0) {
    return '  (empty — nothing has been recorded yet, so assume they are shopping for this meal)';
  }
  // Grouped by level so "what am I out of" is one glance for the model, not a scan.
  const groups: Record<PantryLevel, string[]> = { plenty: [], low: [], out: [] };
  for (const item of pantry) {
    groups[item.level].push(`${item.name_en} (${item.name_nl})`);
  }

  const lines: string[] = [];
  for (const level of ['plenty', 'low', 'out'] as const) {
    const names = groups[level];
    if (names.length > 0) lines.push(`  ${level}: ${names.join(', ')}`);
  }
  return lines.join('\n');
}

function renderGear(gear: KitchenState['gear']): string {
  if (gear.length === 0) {
    // The equipment they confirmed is on the profile card; this list is the extra detail a photo
    // sweep would add, and its absence is not a reason to assume nothing.
    return '  (nothing beyond the equipment on the card above — assume basic pans and a knife)';
  }
  return gear
    .map((item) => (item.notes === null ? `  ${item.name_en}` : `  ${item.name_en} (${item.notes})`))
    .join('\n');
}

function renderFrontier(frontier: SkillFrontier): string {
  return Object.entries(frontier)
    .map(([attribute, tier]) => `  ${attribute}: tier ${tier}`)
    .join('\n');
}

/**
 * The user's request, plus the instruction that one-off overrides in it beat the profile for
 * this meal only.
 */
export function buildRequestPrompt(requestText: string, state: KitchenState): string {
  return [
    buildKitchenContext(state),
    '',
    'Cook something for this request:',
    '',
    requestText,
    '',
    'Anything the request states — servings, people, time, leftovers — overrides the profile',
    'for this meal only. Do not treat it as a lasting change.',
  ].join('\n');
}

/**
 * The cook-question turn: the recipe and the kitchen, attached to the question.
 *
 * This is a MESSAGE, not a system block. The recipe changes as patches are applied and the pantry
 * changes under the conversation, and anything volatile in `system` invalidates the thinking blocks
 * bound to it. As a message it is simply appended, which is always safe.
 *
 * The recipe goes in as JSON because that is what the patch operations address — step numbers and
 * ingredient names have to match exactly.
 *
 * It lives here rather than inside `cook-question/index.ts`, where it started, because the eval
 * harness has to send the prompt the app actually sends. A private copy in the handler meant any
 * second caller had to duplicate the text, and a duplicate drifts — at which point the eval is
 * grading a prompt that was never shipped.
 */
/**
 * The question turn: the live state, the recipe, and how to answer.
 *
 * `status` is load-bearing rather than informational. The two moments have different mechanisms
 * — before the lock a change is a whole new recipe, after it an edit that has to respect the
 * shopping already done — and the tool list enforces that. Telling John too keeps his *words*
 * matching what he can actually do: "I'll swap that for you" is the wrong sentence in review.
 */
export function buildCookQuestionPrompt({
  question,
  recipe,
  kitchenContext,
  status,
}: {
  question: string;
  recipe: Recipe;
  kitchenContext: string;
  status: RecipeStatus;
}): string {
  return [
    kitchenContext,
    '',
    status === 'generated'
      ? 'The cook is REVIEWING this meal. They have not started cooking and have not shopped yet:'
      : 'The cook has LOCKED this meal in and already bought for it. They are mid-recipe:',
    '',
    JSON.stringify(recipe),
    '',
    'How to answer:',
    ...(status === 'generated'
      ? [
          '- Nothing is bought yet, so a change here means a NEW recipe rather than an edit. If',
          '  they want something different, or cannot get or are out of an ingredient, call',
          '  suggest_rethink with the constraint in their own words and let them tap it.',
          '- Do that whatever the ingredient is: a spice is as good a reason as the protein, because',
          '  a rethink costs them nothing. Do not decide for them that it does not matter, and do not',
          '  answer with advice alone ("skip it", "use X instead") — the recipe on their screen would',
          '  still list it. Do not promise an edit you cannot make.',
        ]
      : [
          '- If the answer changes the recipe, call patch_recipe. Address steps by their number and',
          '  ingredients by their exact name_en as written above.',
          '- An amount is written in more than one place. Changing an ingredient line rescales the',
          '  prep row for it automatically, but ONLY when that row\'s amount starts with a number —',
          '  if the tool result names a prep row it could not rescale, call rewrite_prep for it in',
          '  this same answer. Step text is never rescaled for you: if a step names an amount you',
          '  changed, call rewrite_step for it too, or the cook reads the old quantity mid-step.',
          '- If the change reaches further than those operations can, call suggest_rethink rather',
          '  than applying half of it. They have shopped, so say what they can do with what they',
          '  have.',
        ]),
    '- If it does not change the recipe, just answer.',
    '',
    'HOW THE ANSWER MUST READ. They are at a hob with their hands full, and this is heard as',
    'often as it is read:',
    '- Two or three sentences. Stop when the question is answered.',
    '- Plain spoken prose. NO markdown of any kind — no bold, no headings, no bullet points, no',
    '  numbered lists. A numbered list is the recipe read back, which is the one thing never to do.',
    '- No preamble and no sign-off. Open with the answer itself.',
    '- Say the cue, not the theory: "when it smells nutty and the edges brown", not a paragraph on',
    '  the Maillard reaction. Only explain why if they asked why.',
    '- If they say, in the first person, what is missing from their own kitchen ("I\'m out of',
    '  soy sauce", "we\'ve run out of rice"), call update_pantry as well. It records the cupboard;',
    '  it does not change the meal, so it never replaces the steps above. Someone else being out',
    '  — "they seem to be out of lemons", "the shop has none" — is a shelf in a shop, not their',
    '  cupboard, so leave the pantry alone.',
    '- Never restate the whole recipe back to them.',
    '',
    'Their question:',
    '',
    question,
  ].join('\n');
}

