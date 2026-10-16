import { z } from 'zod';
import { type EquipmentId, equipmentName, MINIMAL_EQUIPMENT } from './equipment.ts';

/**
 * The Profile is what kitchen setup produces and what replaces the hardcoded
 * defaults in the cooking prompt. Every field here is either asked about in setup
 * or inferred from the photo sweep.
 *
 * Defaults match the brief, so a user who skips every setup question still gets the
 * behaviour the original prompt hardcoded.
 */

export const HOB_TYPES = ['gas', 'induction', 'ceramic', 'unknown'] as const;
export type HobType = (typeof HOB_TYPES)[number];

export const SPICE_LEVELS = ['mild', 'medium', 'hot'] as const;
export type SpiceLevel = (typeof SPICE_LEVELS)[number];

export const SUGAR_RULES = ['sweetener', 'honey', 'sugar'] as const;
export type SugarRule = (typeof SUGAR_RULES)[number];

export const SKILL_SELF_RATINGS = ['beginner', 'comfortable', 'confident'] as const;
export type SkillSelfRating = (typeof SKILL_SELF_RATINGS)[number];

export const TimeBudgetSchema = z.object({
  weekday_minutes: z.int().positive(),
  weekend_minutes: z.int().positive(),
});

export const MacroTargetsSchema = z.object({
  protein_g: z.int().positive().nullable(),
  calories: z.int().positive().nullable(),
});

/**
 * What a meal is made of, as a list of dish roles.
 *
 * The original prompt hardcoded "one protein, one veg, one carb", which is a fine default and a bad
 * assumption: a vegetarian was still being asked for a protein dish, and someone who wanted a single
 * one-pot dinner had no way to say so. The roles are free text because the cook can add their own —
 * the model reads them as prose, and the app only groups by them.
 */
export const MEAL_SHAPE_PRESETS = [
  { id: 'classic', label: 'Protein, veg and a carb', shape: ['protein', 'veg', 'carb'] },
  { id: 'veg_forward', label: 'Two veg and a carb', shape: ['veg', 'veg', 'carb'] },
  { id: 'main_side', label: 'A main and a side', shape: ['main', 'side'] },
  { id: 'one_pot', label: 'One pot, one dish', shape: ['one pot'] },
] as const;

/** More than this and the cook screen's tab bar stops being usable. */
export const MAX_DISHES = 5;

export const ProfileSchema = z.object({
  name: z.string().nullable(),
  locale: z.string().describe('IETF tag, e.g. "nl-NL". Drives shops and ingredient availability.'),
  /** Names are shown in both languages on the Ingredients tab. */
  ingredient_languages: z.array(z.string()).min(1),
  stores: z.array(z.string()),
  meal_shape: z.array(z.string().min(1)).min(1).max(MAX_DISHES),
  default_servings: z.int().positive(),
  leftovers: z.boolean(),
  time_budget: TimeBudgetSchema,
  hob_type: z.enum(HOB_TYPES),
  hobs: z.int().positive().describe('How many rings the user actually uses at once.'),
  oven: z.boolean(),
  appliances: z.array(z.string()),
  /**
   * Free-text equipment the taps did not cover, spoken or typed: "a cast iron skillet and a
   * stick blender". Kept as prose rather than resolved to canonical gear, because the photo
   * sweep in kitchen setup is what does that properly — this is the quick-start path.
   */
  equipment_notes: z.string().nullable(),
  protein_favourites: z.array(z.string()),
  protein_avoid: z.array(z.string()),
  carb_defaults: z.array(z.string()),
  diet_rules: z.array(z.string()),
  allergies: z.array(z.string()),
  goals: z.array(z.string()),
  macro_targets: MacroTargetsSchema,
  sugar_rule: z.enum(SUGAR_RULES),
  spice_level: z.enum(SPICE_LEVELS),
  cuisine_favourites: z.array(z.string()),
  cuisine_explore: z.array(z.string()),
  dislikes: z.array(z.string()),
  max_pans: z.int().positive(),
  skill_self_rating: z.enum(SKILL_SELF_RATINGS),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Exactly the defaults the brief lists for a skipped setup question, which are the
 * values the current cooking prompt hardcodes.
 */
export const DEFAULT_PROFILE: Profile = {
  name: null,
  locale: 'nl-NL',
  ingredient_languages: ['en', 'nl'],
  stores: ['Albert Heijn', 'Jumbo'],
  meal_shape: ['protein', 'veg', 'carb'],
  default_servings: 3,
  leftovers: false,
  time_budget: { weekday_minutes: 30, weekend_minutes: 30 },
  hob_type: 'unknown',
  hobs: 3,
  oven: false,
  appliances: ['microwave'],
  equipment_notes: null,
  protein_favourites: [],
  protein_avoid: [],
  carb_defaults: ['rice', 'chickpeas'],
  diet_rules: [],
  allergies: [],
  goals: [],
  macro_targets: { protein_g: null, calories: null },
  sugar_rule: 'sweetener',
  spice_level: 'medium',
  cuisine_favourites: [],
  cuisine_explore: [],
  dislikes: [],
  max_pans: 3,
  skill_self_rating: 'beginner',
};

/**
 * What the quick-start screen collects: a few equipment taps, how many rings, and anything
 * spoken that the taps missed.
 */
export type QuickStartKitchen = {
  equipment: readonly EquipmentId[];
  /** Null when they did not say, or did not pick a hob. */
  hobs: number | null;
  notes: string | null;
};

/**
 * Builds a profile from the quick-start answers.
 *
 * Everything not asked about stays at the default the original prompt hardcoded, so someone
 * who answers one question still gets sensible cooking. The only thing this really pins down
 * is equipment — because heat cues and method depend on it, and a recipe that calls for an
 * oven nobody has is useless.
 */
export function profileFromQuickStart(kitchen: QuickStartKitchen): Profile {
  const equipment = kitchen.equipment.length === 0 ? MINIMAL_EQUIPMENT : kitchen.equipment;
  const hasHob = equipment.includes('hob');

  return {
    ...DEFAULT_PROFILE,
    oven: equipment.includes('oven'),
    // The hob is the cooking surface, not an appliance to list alongside the microwave.
    appliances: equipment.filter((id) => id !== 'hob' && id !== 'oven').map(equipmentName),
    // One ring unless they said otherwise: assuming three a cook does not have is how a
    // recipe becomes impossible to follow halfway through.
    hobs: hasHob ? (kitchen.hobs ?? 1) : 1,
    equipment_notes: kitchen.notes,
  };
}

/**
 * A one-off override spoken in a request ("cooking for 5 tonight") applies to that
 * recipe only and is never written back to the profile. A lasting change ("I've gone
 * vegetarian") goes through an explicit "Update your profile?" tap instead — see the
 * brief's Profile card rules.
 */
export const RequestOverridesSchema = z.object({
  servings: z.int().positive().nullable(),
  leftovers: z.boolean().nullable(),
  minutes: z.int().positive().nullable(),
});
export type RequestOverrides = z.infer<typeof RequestOverridesSchema>;

export const NO_OVERRIDES: RequestOverrides = { servings: null, leftovers: null, minutes: null };

/** The profile as it applies to one request, with any one-off overrides folded in. */
export function profileForRequest(profile: Profile, overrides: RequestOverrides): Profile {
  const servings = positiveCount(overrides.servings);
  const minutes = positiveCount(overrides.minutes);

  return {
    ...profile,
    default_servings: servings ?? profile.default_servings,
    leftovers: overrides.leftovers ?? profile.leftovers,
    time_budget:
      minutes === null ? profile.time_budget : { weekday_minutes: minutes, weekend_minutes: minutes },
  };
}

/**
 * An override only wins if it could actually be a count.
 *
 * The one caller parses the request body first, so a zero cannot reach here today — but this is
 * the function the next caller will reach for, and "cooking for 0" would produce a profile that
 * fails its own schema on the way into the prompt.
 */
function positiveCount(value: number | null): number | null {
  if (value === null) return null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Reads a stored profile, recovering field by field.
 *
 * The app ships over the air and setup questions get added as the product is built, so a row written
 * last week can be missing a field that exists today. That is ordinary, not corruption, and it must
 * never be what stands between a cook and dinner — the first time it happened the app refused to
 * open and put a validator dump on screen.
 *
 * Each field is validated on its own and only taken from the row if it passes, so a missing field
 * falls back to its default and an invalid one is dropped rather than carried into John's prompt.
 * Whatever comes out is parsed again, which means this can only ever return a valid Profile.
 *
 * Shared deliberately: the app reads profiles directly from Postgres and the edge functions read
 * them too, and the two sides disagreeing about what is readable is its own class of bug.
 */
export function recoverProfile(raw: unknown): Profile {
  const parsed = ProfileSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_PROFILE;
  }

  const stored = raw as Record<string, unknown>;
  const recovered: Record<string, unknown> = { ...DEFAULT_PROFILE };

  for (const [field, fieldSchema] of Object.entries(ProfileSchema.shape)) {
    if (!(field in stored)) continue;
    if (fieldSchema.safeParse(stored[field]).success) {
      recovered[field] = stored[field];
    }
  }

  const rebuilt = ProfileSchema.safeParse(recovered);
  return rebuilt.success ? rebuilt.data : DEFAULT_PROFILE;
}
