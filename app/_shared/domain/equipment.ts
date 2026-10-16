/**
 * Equipment the cook can say they have, as tappable options.
 *
 * The brief's kitchen setup infers gear from a photo sweep, but there is a second case the
 * app has to serve: someone who wants to cook *now* and will not spend ten minutes
 * photographing a kitchen — on holiday, in someone else's flat, in an Airbnb. For them the
 * equipment question is still asked, because heat cues are wrong without it, but it is
 * asked as a handful of taps.
 *
 * Shared between the quick-start screen and the profile, so the option a user taps and the
 * value stored under it cannot drift.
 */

export const EQUIPMENT_OPTIONS = [
  { id: 'hob', label: 'Stove / hob', hint: 'Rings you can put a pan on' },
  { id: 'oven', label: 'Oven', hint: 'Roasting and baking' },
  { id: 'microwave', label: 'Microwave', hint: 'Steaming and reheating' },
  { id: 'air_fryer', label: 'Air fryer', hint: '' },
  { id: 'wok', label: 'Wok', hint: 'Proper high-heat stir-frying' },
  { id: 'grill', label: 'Grill / BBQ', hint: '' },
  { id: 'kettle', label: 'Kettle', hint: 'Faster boiling water' },
  { id: 'rice_cooker', label: 'Rice cooker', hint: '' },
  { id: 'blender', label: 'Blender', hint: 'Sauces and soups' },
] as const;

export type EquipmentId = (typeof EQUIPMENT_OPTIONS)[number]['id'];

/** How each option is named to John. Plain words, because he reads them as prose. */
const PROMPT_NAMES: Record<EquipmentId, string> = {
  hob: 'hob',
  oven: 'oven',
  microwave: 'microwave',
  air_fryer: 'air fryer',
  wok: 'wok',
  grill: 'grill',
  kettle: 'kettle',
  rice_cooker: 'rice cooker',
  blender: 'blender',
};

export function equipmentName(id: EquipmentId): string {
  return PROMPT_NAMES[id];
}

/**
 * The barest kitchen worth cooking in: one ring and a pan.
 *
 * Used when someone skips the question outright. It is deliberately pessimistic — a recipe
 * that assumes an oven nobody has is useless, while one that assumes a single pan still
 * works in a kitchen that has more.
 */
export const MINIMAL_EQUIPMENT: EquipmentId[] = ['hob'];
