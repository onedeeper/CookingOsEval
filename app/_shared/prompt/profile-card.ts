import type { Profile } from '../domain/profile.ts';

/**
 * The profile card.
 *
 * The brief is explicit that the card the user reads at the end of setup is exactly
 * what gets injected into John's system prompt. So it is rendered once, here, and
 * used twice: the Profile screen maps over these lines to make each one tappable,
 * and the prompt builder flattens the same lines into text.
 *
 * Keeping one renderer is what stops the card and the prompt drifting apart, which
 * would make the card a lie about how John actually cooks.
 */

export type ProfileCardLine = {
  /** Stable key for the Profile screen's edit targets and for React keys. */
  field: keyof Profile;
  label: string;
  value: string;
};

export function renderProfileCard(profile: Profile): ProfileCardLine[] {
  return [
    { field: 'meal_shape', label: 'Meal', value: profile.meal_shape.join(', ') },
    { field: 'default_servings', label: 'Servings', value: servingsLine(profile) },
    { field: 'time_budget', label: 'Time', value: timeLine(profile) },
    { field: 'stores', label: 'Shops', value: list(profile.stores, 'any supermarket') },
    { field: 'ingredient_languages', label: 'Ingredient names', value: languagesLine(profile) },
    { field: 'protein_favourites', label: 'Proteins', value: proteinLine(profile) },
    { field: 'carb_defaults', label: 'Carbs', value: list(profile.carb_defaults, 'no preference') },
    { field: 'diet_rules', label: 'Diet', value: dietLine(profile) },
    { field: 'sugar_rule', label: 'Sweetness', value: sugarLine(profile) },
    { field: 'spice_level', label: 'Spice', value: profile.spice_level },
    { field: 'cuisine_favourites', label: 'Cuisines', value: cuisineLine(profile) },
    { field: 'appliances', label: 'Equipment', value: equipmentLine(profile) },
    { field: 'max_pans', label: 'Cleanup', value: `up to ${profile.max_pans} pans` },
  ];
}

export function profileCardToText(lines: readonly ProfileCardLine[]): string {
  return lines.map((line) => `${line.label}: ${line.value}`).join('\n');
}

/** The languages each ingredient is named in, written out rather than as tags. */
function languagesLine(profile: Profile): string {
  const names = profile.ingredient_languages.map((tag) => LANGUAGE_LABELS[tag.toLowerCase()] ?? tag);
  if (names.length <= 1) return names[0] ?? 'English';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const LANGUAGE_LABELS: Record<string, string> = {
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

function servingsLine(profile: Profile): string {
  const base = `${profile.default_servings}`;
  return profile.leftovers ? `${base}, with leftovers` : base;
}

function timeLine(profile: Profile): string {
  const { weekday_minutes, weekend_minutes } = profile.time_budget;
  if (weekday_minutes === weekend_minutes) {
    return `${weekday_minutes} min bag to table`;
  }
  return `${weekday_minutes} min on weeknights, ${weekend_minutes} min at weekends`;
}

function proteinLine(profile: Profile): string {
  const parts: string[] = [];
  if (profile.protein_favourites.length > 0) parts.push(profile.protein_favourites.join(', '));
  if (profile.protein_avoid.length > 0) parts.push(`never ${profile.protein_avoid.join(', ')}`);
  return parts.length === 0 ? 'no preference' : parts.join('; ');
}

function dietLine(profile: Profile): string {
  const parts = [...profile.diet_rules];
  if (profile.allergies.length > 0) parts.push(`allergic to ${profile.allergies.join(', ')}`);
  if (profile.dislikes.length > 0) parts.push(`dislikes ${profile.dislikes.join(', ')}`);
  if (profile.goals.length > 0) parts.push(profile.goals.join(', '));

  const { protein_g, calories } = profile.macro_targets;
  if (protein_g !== null) parts.push(`${protein_g}g protein a day`);
  if (calories !== null) parts.push(`${calories} kcal a day`);

  return parts.length === 0 ? 'no restrictions' : parts.join('; ');
}

function sugarLine(profile: Profile): string {
  switch (profile.sugar_rule) {
    case 'sweetener':
      return 'sweetener 1:1, honey where it fits';
    case 'honey':
      return 'honey where it fits, otherwise sweetener';
    case 'sugar':
      return 'regular sugar is fine';
  }
}

function cuisineLine(profile: Profile): string {
  const parts: string[] = [];
  if (profile.cuisine_favourites.length > 0) parts.push(`loves ${profile.cuisine_favourites.join(', ')}`);
  if (profile.cuisine_explore.length > 0) parts.push(`wants to explore ${profile.cuisine_explore.join(', ')}`);
  return parts.length === 0 ? 'all cuisines' : parts.join('; ');
}

/** Hob, appliances, anything spoken, and explicitly whether there is an oven. */
function equipmentLine(profile: Profile): string {
  const hob = profile.hob_type === 'unknown' ? 'hob' : `${profile.hob_type} hob`;
  const appliances = profile.oven ? ['oven', ...profile.appliances] : profile.appliances;

  const parts = [`${profile.hobs}-ring ${hob}`, ...appliances];
  if (profile.equipment_notes !== null && profile.equipment_notes.trim().length > 0) {
    parts.push(profile.equipment_notes.trim());
  }
  // No oven is stated outright rather than left to inference: John must not call for one.
  if (!profile.oven) {
    parts.push('no oven');
  }

  return parts.join(', ');
}

function list(values: readonly string[], fallback: string): string {
  return values.length === 0 ? fallback : values.join(', ');
}
