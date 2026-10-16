import { nameKey } from './ingredient-index.ts';

/**
 * A meal is a list of dishes, and each dish has a role — "protein", "veg", "carb", "one pot",
 * "mezze". The roles come from the cook's own meal shape in their profile, so they are free text
 * rather than a fixed set: kitchen setup offers presets and a button to add your own.
 *
 * Ingredients, prep items and steps each name the role they belong to, which is how the cook screen
 * groups them.
 */

/** How a role is shown as a group heading. */
export function formatRole(role: string): string {
  return role.trim().toUpperCase();
}

/**
 * The heading above a group of lines: "PROTEIN · Chilli chicken", or just the role when no dish
 * declared it. One formatter so Ingredients and Prep cannot label the same group differently.
 */
export function formatDishHeading(group: { slot: string; name: string | null }): string {
  return group.name === null ? formatRole(group.slot) : `${formatRole(group.slot)} · ${group.name}`;
}

/** Roles compare case- and space-insensitively, because the model varies both. */
export function sameRole(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}

/** One dish's worth of lines. `name` is null when no dish declared this role — see `groupByDish`. */
export type DishGroup<Line> = {
  slot: string;
  name: string | null;
  lines: Line[];
};

/**
 * Lines grouped under the dish they belong to: declared dishes first, in the order the meal
 * lists them, then any role the model used that no dish declared. Empty groups are dropped.
 *
 * That last part is the point. The sections used to walk the dishes and filter the lines, so a
 * line whose role matched nothing rendered nowhere — and the model does get this wrong, writing
 * the dish's *name* ("Chilli chicken") where its role ("protein") belongs. The cook got a
 * shopping-list button with no list under it, and no error anywhere. A heading that reads oddly
 * is a far smaller failure than an ingredient list that is silently empty.
 *
 * O(dishes + lines): the dishes go into a map keyed by `nameKey` once, rather than a scan per line.
 */
export function groupByDish<Line extends { dish: string }>(
  dishes: ReadonlyArray<{ slot: string; name: string }>,
  lines: readonly Line[],
): DishGroup<Line>[] {
  const groups = new Map<string, DishGroup<Line>>();
  for (const dish of dishes) {
    groups.set(nameKey(dish.slot), { slot: dish.slot, name: dish.name, lines: [] });
  }

  for (const line of lines) {
    const key = nameKey(line.dish);
    let group = groups.get(key);
    if (group === undefined) {
      group = { slot: line.dish, name: null, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(line);
  }

  return [...groups.values()].filter((group) => group.lines.length > 0);
}
