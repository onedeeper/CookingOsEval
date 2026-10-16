/**
 * Pantry quantities are deliberately coarse. The MVP tracks a level, not grams:
 * exact quantities and expiry estimates are explicitly "Later" in the brief.
 */
export const PANTRY_LEVELS = ['plenty', 'low', 'out'] as const;
export type PantryLevel = (typeof PANTRY_LEVELS)[number];

/** How an item got into the pantry. Used to decide what a re-parse may overwrite. */
export const PANTRY_SOURCES = ['photo', 'voice', 'barcode', 'cook'] as const;
export type PantrySource = (typeof PANTRY_SOURCES)[number];

export type PantryEntry = {
  ingredientId: string;
  level: PantryLevel;
};

/**
 * What a recipe line should look like on the Ingredients tab:
 * `have` greys the row out, `low` warns, `missing` joins the shopping list.
 */
export const PANTRY_STATUSES = ['have', 'low', 'missing'] as const;
export type PantryStatus = (typeof PANTRY_STATUSES)[number];

export function levelToStatus(level: PantryLevel | undefined): PantryStatus {
  switch (level) {
    case 'plenty':
      return 'have';
    case 'low':
      return 'low';
    case 'out':
    case undefined:
      return 'missing';
  }
}

/**
 * Ranked one level down, used after a cook that leant on an item heavily.
 * `out` is the floor — the MVP never tracks negative stock.
 */
export function decrementLevel(level: PantryLevel): PantryLevel {
  switch (level) {
    case 'plenty':
      return 'low';
    case 'low':
    case 'out':
      return 'out';
  }
}
