import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PantryUpdateSchema } from '../_shared/domain/pantry-update.ts';
import { type RecipeStatus, RethinkSuggestionSchema } from '../_shared/domain/recipe-lifecycle.ts';
import { RecipePatchSchema } from '../_shared/domain/recipe-patch.ts';

/**
 * Cook-mode tools.
 *
 * Input schemas are generated from the same zod schemas the handler validates with,
 * so the tool the model sees and the shape we accept cannot drift apart.
 *
 * `strict: true` is deliberately not set. The patch schema is a discriminated union,
 * which compiles to `oneOf`, and rather than bet on strict mode's support for that we
 * validate every call ourselves and hand the model an `is_error` result it can correct
 * from. That path is exercised on every malformed call, not just in theory.
 *
 * `search_library` is the third tool in the brief and arrives with the library in
 * week 3; adding it is a schema plus a case in the handler's tool switch.
 */

export const PATCH_RECIPE = 'patch_recipe';
export const UPDATE_PANTRY = 'update_pantry';
export const SUGGEST_RETHINK = 'suggest_rethink';

function inputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema;
}

const SUGGEST_RETHINK_TOOL: Anthropic.Tool = {
  name: SUGGEST_RETHINK,
  description: [
    'Offer to generate a NEW recipe instead of editing this one. While the recipe is still being',
    'reviewed (not locked) this is the ONLY way to change it, so use it for any change the cook',
    'asks for, however small — an ingredient they cannot get, a different cuisine, a spicier',
    'version. Once it is locked, use it when the change would ripple through the whole meal and',
    'no patch can express it: a constraint that moves the salt plan, the prep and the steps',
    'together.',
    'This does not rewrite anything by itself: it offers the cook a one-tap rethink, and they',
    'decide. Prefer it over a long list of patch operations, and reach for it rather than',
    'half-applying a change you cannot finish.',
  ].join(' '),
  input_schema: inputSchema(RethinkSuggestionSchema),
};

/**
 * The tools John gets, which depend on where the recipe is in its life.
 *
 * Before the lock, `patch_recipe` is deliberately WITHHELD. Offering it is what makes a model
 * try to say "I have no soy sauce" in three ingredient swaps, leaving the salt strategy
 * describing a sauce that is gone — and before the lock there is no reason to try, because
 * nothing has been bought and a regeneration is both cheaper to get right and coherent by
 * construction.
 *
 * After the lock the shopping is done, so an edit has to respect it: patching is the mechanism,
 * and the rethink stays available for the change no patch can express.
 */
export function cookToolsFor(status: RecipeStatus): Anthropic.Tool[] {
  // A cooked recipe is history — read, not edited. It gets the locked set so a question about a
  // past cook still works, and the handler is what refuses the writes.
  return status === 'generated'
    ? [SUGGEST_RETHINK_TOOL, UPDATE_PANTRY_TOOL]
    : [PATCH_RECIPE_TOOL, UPDATE_PANTRY_TOOL, SUGGEST_RETHINK_TOOL];
}

const PATCH_RECIPE_TOOL: Anthropic.Tool = {
  name: PATCH_RECIPE,
  description: [
    'Edit the recipe the cook is looking at. Use this whenever your answer changes',
    'what they should buy, prep or do — a substitution, a different amount, a',
    'rewritten step, a different number of servings.',
    'Make the smallest set of operations that leaves the recipe correct. A swap usually',
    'needs only replace_ingredient: the old ingredient\'s NAME is rewritten for you',
    'wherever it appears in prep and steps.',
    'Amounts are not the same — they are written again on each prep row and sometimes in',
    'the step text. Changing an ingredient line rescales its prep row when that row starts',
    'with a number; when the tool result says it could not, call rewrite_prep. Step text is',
    'never rescaled for you, so call rewrite_step for any step that names an amount you',
    'changed.',
    'If the change would ripple further than these operations can reach, call suggest_rethink',
    'instead of applying part of it.',
  ].join(' '),
  input_schema: inputSchema(RecipePatchSchema),
};

const UPDATE_PANTRY_TOOL: Anthropic.Tool = {
  name: UPDATE_PANTRY,
  description: [
    'Record what the cook has, is low on, or has run out of, when they tell you',
    'during a cook. Use the English name from the canonical list.',
  ].join(' '),
  input_schema: inputSchema(PantryUpdateSchema),
};

/**
 * Every cook-mode tool. `cookToolsFor` is what a handler should call — this is the full set, kept
 * for the tests that assert on a description regardless of which state offers it.
 */
export const COOK_TOOLS: Anthropic.Tool[] = [
  PATCH_RECIPE_TOOL,
  UPDATE_PANTRY_TOOL,
  SUGGEST_RETHINK_TOOL,
];
