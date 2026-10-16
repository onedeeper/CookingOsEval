import { z } from 'zod';
import { buildNameIndex, type CanonicalIngredient, resolveName } from './ingredient-index.ts';
import { PANTRY_LEVELS, type PantryLevel, type PantrySource } from './pantry.ts';

/**
 * A batch of pantry changes, spoken or inferred.
 *
 * Shared by `update_pantry` (John's tool during a cook) and the voice pantry parse,
 * so "I'm out of cumin" updates the kitchen the same way whichever route it arrives by.
 */

export const PantryChangeSchema = z.object({
  name_en: z.string().min(1).describe('English name of the ingredient, matching the canonical list.'),
  level: z.enum(PANTRY_LEVELS),
});
export type PantryChange = z.infer<typeof PantryChangeSchema>;

export const PantryUpdateSchema = z.object({
  changes: z.array(PantryChangeSchema).min(1),
});
export type PantryUpdate = z.infer<typeof PantryUpdateSchema>;

export type ResolvedPantryChange = {
  ingredientId: string;
  name_en: string;
  level: PantryLevel;
  source: PantrySource;
};

export type PantryUpdatePlan = {
  resolved: ResolvedPantryChange[];
  /**
   * Names that matched nothing canonical. Reported back rather than dropped — an
   * item silently missing from the pantry is the failure the review card exists to
   * prevent, and the same honesty applies to a spoken update.
   */
  unresolved: string[];
};

/**
 * Resolves spoken names onto canonical ids. O(changes) after an O(ingredients) index
 * build, so a 40-item voice dump stays one pass rather than 40 scans of the list.
 */
export function planPantryUpdate(
  update: PantryUpdate,
  ingredients: readonly CanonicalIngredient[],
  source: PantrySource,
): PantryUpdatePlan {
  const index = buildNameIndex(ingredients);
  const resolved: ResolvedPantryChange[] = [];
  const unresolved: string[] = [];

  for (const change of update.changes) {
    const canonical = resolveName(index, change.name_en);
    if (canonical === undefined) {
      unresolved.push(change.name_en);
      continue;
    }
    resolved.push({
      ingredientId: canonical.id,
      name_en: canonical.name_en,
      level: change.level,
      source,
    });
  }

  return { resolved, unresolved };
}

/** One line a human can read back, for the toast and the review card. */
export function describePantryPlan(plan: PantryUpdatePlan): string {
  const updated = plan.resolved.map((change) => `${change.name_en}: ${change.level}`);
  if (updated.length === 0) {
    return 'Nothing in the pantry changed';
  }
  const tail = plan.unresolved.length === 0 ? '' : ` (didn't recognise ${plan.unresolved.join(', ')})`;
  return `${updated.join(', ')}${tail}`;
}
