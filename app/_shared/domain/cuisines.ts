/**
 * The cuisine palette John draws from.
 *
 * Not user-specific — it is the range he cooks across. The user's own preferences
 * (`cuisine_favourites`, `cuisine_explore`) are chosen *from* this list, so it lives here
 * and is used twice: rendered into the system prompt, and shown as chips in kitchen setup
 * "grouped by region" exactly as the brief describes.
 */

export type CuisineRegion = {
  region: string;
  cuisines: string[];
};

export const CUISINE_REGIONS: CuisineRegion[] = [
  { region: 'Mexico and Central America', cuisines: ['Mexico', 'Yucatán'] },
  { region: 'India and South Asia', cuisines: ['Northern India', 'Southern India', 'Bengal', 'Nepal'] },
  { region: 'Middle East and North Africa', cuisines: ['Middle East', 'Morocco'] },
  { region: 'Africa', cuisines: ['East Africa', 'West Africa', 'North East Africa'] },
  {
    region: 'Mediterranean and Southern Europe',
    cuisines: ['Greece', 'Italy', 'Northern Italy', 'Southern Italy', 'Spain'],
  },
  { region: 'France', cuisines: ['France', 'Normandy', 'Provence', 'Southern France'] },
  {
    region: 'Central and Eastern Europe',
    cuisines: ['Hungary', 'Eastern European Jewish', 'Northern and Eastern Europe'],
  },
  { region: 'Central and Southeast Asia', cuisines: ['Central Asia', 'Burma'] },
];

/** Flat list, for validating a stored preference against the palette. */
export const ALL_CUISINES: string[] = CUISINE_REGIONS.flatMap((entry) => entry.cuisines);

/** Rendered into the system prompt, grouped so the model reads the range at a glance. */
export function renderCuisinePalette(): string {
  return CUISINE_REGIONS.map((entry) => `  ${entry.region}: ${entry.cuisines.join(', ')}`).join('\n');
}
