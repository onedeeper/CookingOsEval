import { z } from 'zod';

/**
 * The skill tree runs invisibly in the MVP: no visible tree, no badges. All it does
 * is track a frontier tier per attribute and hand the generation prompt one stretch
 * technique per meal.
 */
export const SKILL_ATTRIBUTES = ['salt', 'fat', 'acid', 'heat'] as const;
export type SkillAttribute = (typeof SKILL_ATTRIBUTES)[number];

export const LOWEST_TIER = 1;
export const HIGHEST_TIER = 5;

export const SkillNodeSchema = z.object({
  attribute: z.enum(SKILL_ATTRIBUTES),
  tier: z.int().min(LOWEST_TIER).max(HIGHEST_TIER),
  why: z.string().describe('One line, shown in Overview: why this technique, now.'),
});
export type SkillNode = z.infer<typeof SkillNodeSchema>;

export type SkillFrontier = Record<SkillAttribute, number>;

/** A beginner starts at the lowest tier on every attribute. */
export function beginnerFrontier(): SkillFrontier {
  return { salt: LOWEST_TIER, fat: LOWEST_TIER, acid: LOWEST_TIER, heat: LOWEST_TIER };
}

export const COOK_RATINGS = ['nailed_it', 'bit_rough'] as const;
export type CookRating = (typeof COOK_RATINGS)[number];

/**
 * "Nailed it" advances the practised attribute by one tier, capped at the highest.
 * "Bit rough" holds the frontier where it is — the brief never moves a tier backwards,
 * because a single rough cook is noise, not evidence of lost skill.
 */
export function advanceFrontier(
  frontier: SkillFrontier,
  practised: SkillAttribute,
  rating: CookRating,
): SkillFrontier {
  if (rating === 'bit_rough') {
    return frontier;
  }
  return { ...frontier, [practised]: Math.min(frontier[practised] + 1, HIGHEST_TIER) };
}
