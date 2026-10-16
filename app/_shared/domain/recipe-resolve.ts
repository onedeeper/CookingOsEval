import { buildNameIndex, type CanonicalIngredient, type NameIndex, resolveName } from './ingredient-index.ts';
import { levelToStatus, type PantryLevel } from './pantry.ts';
import type { ModelRecipe, ModelRecipeIngredient, Recipe, RecipeIngredient } from './recipe.ts';

/**
 * Fills the two Recipe JSON fields we own rather than the model: `ingredient_id`
 * and `pantry_status`.
 *
 * The pantry in the database is the only authority on what the user has. The model
 * is told what the pantry holds, but where it contradicts the database the database
 * wins — otherwise the Ingredients tab could grey out a row for something that is
 * not in the kitchen, which is the "did they trust the pantry?" failure the brief's
 * tester calls are meant to catch.
 */
export type Kitchen = {
  ingredients: readonly CanonicalIngredient[];
  /** ingredient_id -> level. An absent id means the user does not have it. */
  pantry: ReadonlyMap<string, PantryLevel>;
};

/** Resolves one model-authored ingredient line against the kitchen. */
export type IngredientResolver = (line: ModelRecipeIngredient) => RecipeIngredient;

/**
 * Builds the name index once (O(total names)) and returns an O(1)-per-line resolver.
 * Reused by both first generation and later patches, so a mid-cook swap resolves
 * against exactly the same canonical list the recipe was generated against.
 */
export function makeIngredientResolver(kitchen: Kitchen): IngredientResolver {
  const index = buildNameIndex(kitchen.ingredients);
  return (line) => resolveLine(line, index, kitchen.pantry);
}

export function resolveRecipe(modelRecipe: ModelRecipe, kitchen: Kitchen): Recipe {
  const resolve = makeIngredientResolver(kitchen);
  return { ...modelRecipe, ingredients: modelRecipe.ingredients.map(resolve) };
}

function resolveLine(
  line: ModelRecipeIngredient,
  index: NameIndex<CanonicalIngredient>,
  pantry: ReadonlyMap<string, PantryLevel>,
): RecipeIngredient {
  // Try the English name, then the Dutch one: the model gives both, and either may
  // be the one our canonical list happens to know.
  const canonical = resolveName(index, line.name_en) ?? resolveName(index, line.name_nl);

  if (canonical === undefined) {
    // An unmatched line counts as missing rather than silently "have": telling
    // someone they own something they don't is the costlier mistake at the store.
    return { ...line, ingredient_id: null, pantry_status: 'missing' };
  }

  return {
    ...line,
    ingredient_id: canonical.id,
    pantry_status: levelToStatus(pantry.get(canonical.id)),
  };
}

/**
 * Re-runs only the pantry check, leaving resolved ids alone. Used when the pantry
 * changes under an already-open recipe (a voice update, or a deduct after a cook).
 */
export function reapplyPantryStatus(recipe: Recipe, pantry: ReadonlyMap<string, PantryLevel>): Recipe {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((line) => ({
      ...line,
      pantry_status: line.ingredient_id === null ? 'missing' : levelToStatus(pantry.get(line.ingredient_id)),
    })),
  };
}
