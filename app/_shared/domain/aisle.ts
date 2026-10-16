/**
 * Where an ingredient is found in a supermarket, so a shopping list can follow the route through
 * the shop instead of making the cook walk back and forth.
 *
 * `AISLES` is in walking order, and that order is the feature: produce is at the entrance of a
 * Dutch supermarket, frozen goods are collected last so they do not thaw in the trolley, and
 * `other` has no place in the store so it closes the list. It is a typical route, not any one
 * chain's real floor plan — every shop lays itself out differently.
 *
 * These are shop sections, not food types. The canonical ingredient `category` ('protein',
 * 'pantry', 'carb') cannot answer this: "protein" covers chicken and tofu and "pantry" covers oil
 * and tinned tomatoes, which live in different parts of the shop. The model tags each ingredient
 * with one of these instead, and it is a field the schema constrains to this list.
 */
export const AISLES = [
  'produce',
  'bakery',
  'meat_fish',
  'dairy_eggs',
  'dry_goods',
  'oils_sauces_spices',
  'frozen',
  'other',
] as const;
export type Aisle = (typeof AISLES)[number];

/** How each aisle is headed on the list. */
export const AISLE_LABELS: Record<Aisle, string> = {
  produce: 'Fruit & veg',
  bakery: 'Bread & bakery',
  meat_fish: 'Meat & fish',
  dairy_eggs: 'Dairy & eggs',
  dry_goods: 'Tins, pasta, rice & dry goods',
  oils_sauces_spices: 'Oils, sauces & spices',
  frozen: 'Frozen',
  other: 'Other',
};

/** One aisle's worth of lines, headed with its label. */
export type AisleGroup<Line> = {
  aisle: Aisle;
  label: string;
  lines: Line[];
};

/**
 * Lines grouped by aisle, in walking order, with empty aisles dropped. Within an aisle the lines
 * keep the order they were written in.
 *
 * A line whose aisle is not on the list goes under `other` rather than nowhere. That is the same
 * rule `groupByDish` follows and for the same reason: a line that matches no group renders in no
 * group, and an ingredient missing from a shopping list is the one failure this list cannot have.
 *
 * O(lines + aisles): one pass into buckets, then one walk over the fixed list.
 */
export function groupByAisle<Line extends { aisle: Aisle }>(lines: readonly Line[]): AisleGroup<Line>[] {
  const buckets = new Map<Aisle, Line[]>();

  for (const line of lines) {
    const aisle = isAisle(line.aisle) ? line.aisle : 'other';
    const bucket = buckets.get(aisle);
    if (bucket === undefined) {
      buckets.set(aisle, [line]);
    } else {
      bucket.push(line);
    }
  }

  return AISLES.flatMap((aisle) => {
    const bucketed = buckets.get(aisle);
    return bucketed === undefined ? [] : [{ aisle, label: AISLE_LABELS[aisle], lines: bucketed }];
  });
}

function isAisle(value: string): value is Aisle {
  return (AISLES as readonly string[]).includes(value);
}
