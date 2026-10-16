import { z } from 'zod';
import { AISLES } from './aisle.ts';
import { MAX_DISHES } from './profile.ts';
import { sameRole } from './dish.ts';
import { PANTRY_STATUSES } from './pantry.ts';
import { SkillNodeSchema } from './skill.ts';
import { UNITS } from './units.ts';

/**
 * Recipe JSON — the contract between the model, the database and the cook screen.
 *
 * Two shapes, one definition:
 *
 *   ModelRecipeSchema  what Claude returns (structured output)
 *   RecipeSchema       what we store and render = model shape + fields WE own
 *
 * The fields we own are `ingredient_id` and `pantry_status`. Asking the model for
 * them would invite hallucinated UUIDs and a pantry read that disagrees with the
 * database, so they are resolved locally in `recipe-resolve.ts` instead.
 *
 * Every optional-looking field is `.nullable()` rather than `.optional()`: strict
 * structured output requires every key to be present, so "absent" is spelled `null`.
 */

/**
 * The role a line belongs to, matching one of the `slot` values in `dishes`. Free text because the
 * cook defines their own meal shape in setup.
 */
const dishRole = z
  .string()
  .min(1)
  .max(40)
  .describe(
    'Which dish this belongs to: copy one of the `slot` values from `dishes` exactly (e.g. "protein"). ' +
      'Never the dish\'s name — the cook screen groups by this, and a name here leaves the group empty.',
  );

export const ModelRecipeIngredientSchema = z.object({
  name_en: z.string().min(1),
  name_nl: z.string().min(1),
  amount: z.number().nonnegative(),
  unit: z.enum(UNITS),
  dish: dishRole,
  /**
   * Where a shopper finds it, so the shopping list can follow the route through the shop. A shop
   * section rather than a food type: the canonical `category` cannot say that chicken and tofu, or
   * oil and tinned tomatoes, are in different parts of the shop.
   */
  aisle: z
    .enum(AISLES)
    .describe(
      'The supermarket section a shopper walks to for this, in a Dutch supermarket such as Albert ' +
        'Heijn or Jumbo. Fresh fruit, veg and fresh herbs: produce. Tinned and dried goods, pasta, ' +
        'rice, pulses and stock: dry_goods. Oils, vinegars, sauces, spices and dried herbs: ' +
        'oils_sauces_spices. Chilled tofu goes with dairy_eggs. Use other only when nothing fits.',
    ),
});
export type ModelRecipeIngredient = z.infer<typeof ModelRecipeIngredientSchema>;

export const RecipeIngredientSchema = ModelRecipeIngredientSchema.extend({
  /** Canonical ingredient this line resolved to, or null when nothing matched. */
  ingredient_id: z.string().nullable(),
  pantry_status: z.enum(PANTRY_STATUSES),
  /**
   * Defaulted here, though the model must write it. This is the stored shape, parsed on every open,
   * and a recipe saved before `aisle` existed has no such key: requiring it would make every
   * earlier recipe throw. `other` files it at the end of the list, where it still shows.
   */
  aisle: z.enum(AISLES).default('other'),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const PrepItemSchema = z.object({
  item: z.string().min(1),
  amount: z.string().describe('Exact amount as prepped, e.g. "2 cloves, finely sliced".'),
  instruction: z.string().min(1),
  dish: dishRole,
});
export type PrepItem = z.infer<typeof PrepItemSchema>;

export const StepSchema = z.object({
  number: z.int().min(1),
  text: z.string().min(1),
  salt_cue: z.string().nullable().describe('e.g. "season now, it needs time to pull moisture".'),
  heat_cue: z.string().nullable().describe('e.g. "oil shimmers, a drop of water spits".'),
  dish: dishRole,
  timer_seconds: z.int().positive().nullable(),
});
export type Step = z.infer<typeof StepSchema>;

export const DishSchema = z.object({
  slot: z
    .string()
    .min(1)
    .max(40)
    .describe('This dish\'s role, from the requested meal shape (e.g. "protein"). Lines refer to it by this value.'),
  name: z.string().min(1),
  high_protein_option: z
    .string()
    .nullable()
    .describe('Swap that raises protein, e.g. "chickpeas instead of rice". Null when not useful.'),
});
export type Dish = z.infer<typeof DishSchema>;

/**
 * The appliances and cookware the steps use, as names only. Anything more — a temperature, "preheat
 * the oven" — is set-up work and belongs in `prep`, which is where the cook already looks for it.
 */
const equipmentList = z
  .array(z.string().min(1).max(40))
  .max(10)
  .describe(
    'Appliances and cookware the steps use, as short names only: "oven", "wok", "large saucepan ' +
      'with lid". Leave out basic utensils every kitchen has (knives, boards, spoons, graters, ' +
      'colanders). No temperatures or instructions here — preheating and other set-up goes in `prep`.',
  );

/**
 * Fields shared by both shapes, split in two so the two schemas cannot drift.
 *
 * The split point is the ingredient list, and the order of these keys is load-bearing:
 * structured output writes them in schema order, and the cook screen renders each section
 * as it arrives rather than waiting for the closing brace. So a field written late is a tab
 * the cook cannot open until late.
 *
 * This order is the one STRUCTURAL_RULES already states — title, ingredients "listed
 * complete ... before any prep", prep, numbered steps, and finish with the summary card —
 * and it puts the two tabs a cook opens first, Overview and Ingredients, before the long
 * tail of steps. `ingredients` used to sit dead last, which contradicted the prompt and put
 * the pantry check and the shopping list 27 seconds into a 30-second generation.
 */
const recipeHead = {
  title: z.string().min(1),
  emoji: z.string().min(1).describe('One emoji that stands for the meal.'),
  total_minutes: z.int().positive().describe('Bag to table, including prep.'),
  servings: z.int().positive(),
  /**
   * The dishes, in the shape the cook asked for.
   *
   * Length and roles are NOT fixed here: "one protein, one veg, one carb" is this user's default,
   * not everyone's, and a vegetarian or a one-pot cook sets a different shape in setup. What the
   * schema can enforce is that the roles are distinct — the cook screen groups ingredients by role,
   * so a duplicate would make one group swallow the other.
   *
   * Whether the roles are the ones that were actually requested is checked by `matchesMealShape` at
   * the boundary, where the profile is known.
   */
  dishes: z
    .array(DishSchema)
    .min(1)
    .max(MAX_DISHES)
    .refine((dishes) => new Set(dishes.map((dish) => dish.slot.trim().toLowerCase())).size === dishes.length, {
      message: 'Each dish needs its own role.',
    }),
  /**
   * The one stretch technique, and the meal-wide salt plan, both decided before the steps
   * are written — so the steps can teach the technique and follow the plan rather than
   * having them summarised back afterwards.
   */
  skill_node: SkillNodeSchema,
  salt_strategy: z.string().min(1).describe('When and why salt goes in, across the whole meal.'),
  /**
   * Written right after the salt plan, so the Overview — which shows it — is still complete before
   * the ingredient list begins. Decided before the steps, like the technique and the salt plan, so
   * the steps are written against it rather than the list being reconstructed from them.
   */
  equipment: equipmentList,
};

/** Written after the ingredient list: the work itself, then the card that closes the meal. */
const recipeTail = {
  prep: z.array(PrepItemSchema).min(1),
  steps: z.array(StepSchema).min(1),
  high_leverage_ingredients: z
    .array(z.string())
    .describe('The 80/20: the few items doing most of the work in this meal.'),
  summary_card: z.string().min(1).describe('The one-minute screenshot card.'),
};

export const ModelRecipeSchema = z.object({
  ...recipeHead,
  ingredients: z.array(ModelRecipeIngredientSchema).min(1),
  ...recipeTail,
});
export type ModelRecipe = z.infer<typeof ModelRecipeSchema>;

export const RecipeSchema = z.object({
  ...recipeHead,
  // Defaulted for the same reason as `aisle`: this is what is parsed on every open, and a recipe
  // saved before the field existed has no such key. Overriding a key keeps its position.
  equipment: equipmentList.default([]),
  ingredients: z.array(RecipeIngredientSchema).min(1),
  ...recipeTail,
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Steps belonging to one dish, in order. Used by the Cook tab's dish filter. */
export function stepsForDish(recipe: Recipe, dish: Dish['slot']): Step[] {
  // Compared loosely, because roles are free text: the model may write "Protein" on the dish and
  // "protein" on the lines, and a strict comparison would hide every step of that dish.
  return recipe.steps.filter((step) => sameRole(step.dish, dish));
}

/**
 * Every line the cook still has to buy. Drives the one-tap shopping list.
 *
 * Takes only the field it reads, so the Ingredients tab can call it while the rest of the
 * recipe is still being written.
 */
export function missingIngredients(recipe: Pick<Recipe, 'ingredients'>): RecipeIngredient[] {
  return recipe.ingredients.filter((ingredient) => ingredient.pantry_status === 'missing');
}

/**
 * Whether a generated recipe has the dishes that were asked for.
 *
 * The schema cannot check this — it does not know the profile. This runs where the profile is in
 * hand, right after the model answers, so a recipe that quietly dropped the veg or invented a
 * dessert is caught before it is saved rather than discovered mid-cook.
 */
export function matchesMealShape(requested: readonly string[], produced: readonly string[]): boolean {
  if (requested.length !== produced.length) return false;

  const remaining = [...produced];
  for (const role of requested) {
    const index = remaining.findIndex((candidate) => sameRole(candidate, role));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}
