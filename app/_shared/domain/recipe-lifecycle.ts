import { z } from 'zod';

/**
 * A recipe's life: proposed, committed to, cooked.
 *
 * The split is the whole point of locking. Changes cluster BEFORE the cook starts — while a
 * recipe is only proposed, a change is a *regeneration*, which is coherent by construction and
 * needs no patch vocabulary at all. Once it is locked the shopping is done, so a change has to
 * respect what was bought, and that is what `patch_recipe` is for.
 *
 * Using one mechanism for both moments is what made a sweeping change impossible to express:
 * "I don't have soy sauce, what can I do?" cannot be said in patch operations, because it also
 * moves the salt strategy, the prep and the steps. Asked before the lock, it does not have to be.
 */

export const RECIPE_STATUSES = ['generated', 'locked', 'cooked'] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

/**
 * The cap `generate-meal` puts on `request_text`.
 *
 * Declared here because `addConstraint` has to respect it: a request that grew past the limit
 * would turn the next regeneration into a 400 — the feature failing at the fourth change rather
 * than the first, which is exactly the kind of silent cliff this codebase keeps finding.
 */
export const MAX_REQUEST_CHARS = 1000;

/** How a constraint is joined to the request it narrows. */
const CONSTRAINT_SEPARATOR = ' — ';

/**
 * Which moves are legal.
 *
 * `locked -> generated` is the rethink, and it is deliberately allowed: a cook who has shopped
 * and found something missing needs a way back to the mechanism that can rewrite the whole meal.
 *
 * `generated -> cooked` is also allowed, and that is not sloppiness. Every recipe already in the
 * library is `generated` — locking did not exist when they were written — so requiring a lock
 * before finishing would strand all of them behind a button their row can never have pressed.
 */
const ALLOWED: Record<RecipeStatus, readonly RecipeStatus[]> = {
  generated: ['locked', 'cooked'],
  locked: ['generated', 'cooked'],
  cooked: [],
};

export function canTransition(from: RecipeStatus, to: RecipeStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Narrows a request with one more constraint, keeping the earlier ones.
 *
 * Appending to `request_text` rather than adding a column is deliberate on two counts: the
 * accumulated request is exactly what the next regeneration needs to send, and `request_text` is
 * already weighted into library search, so "the one without soy sauce" stays findable.
 *
 * When the result would exceed what `generate-meal` accepts, the OLDEST text is dropped and the
 * newest constraint kept — the cook just said it, so it is the one that must survive.
 *
 * O(length of the request): a handful of short strings, joined.
 */
export function addConstraint(requestText: string, constraint: string): string {
  const trimmed = constraint.trim();
  if (trimmed === '') return requestText;

  const combined = `${requestText}${CONSTRAINT_SEPARATOR}${trimmed}`;
  if (combined.length <= MAX_REQUEST_CHARS) return combined;

  // Keep the tail, which holds the newest constraints, and mark that something was dropped so
  // the model is not left to infer a complete request from a sentence starting mid-word.
  const marker = '…';
  const kept = combined.slice(combined.length - (MAX_REQUEST_CHARS - marker.length));
  return `${marker}${kept}`;
}

/**
 * `suggest_rethink` — John's way of saying "this needs a new recipe, not an edit".
 *
 * It carries a constraint rather than a recipe, because the regeneration is what writes the
 * recipe. Keeping the shape in the domain means the handler, the tool definition and the app all
 * read the same declaration.
 */
export const RethinkSuggestionSchema = z.object({
  constraint: z
    .string()
    .min(1)
    .max(300)
    .describe(
      'The new constraint to generate against, in the cook\'s own terms and nothing more — ' +
        '"no soy sauce", "nothing that needs the oven". Not a recipe, not an explanation.',
    ),
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe('One short sentence for the cook on why this needs a rethink rather than an edit.'),
});
export type RethinkSuggestion = z.infer<typeof RethinkSuggestionSchema>;
