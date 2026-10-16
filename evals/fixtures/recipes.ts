import type { ModelRecipe, Recipe } from '../../app/_shared/domain/recipe.ts';
import { resolveRecipe } from '../../app/_shared/domain/recipe-resolve.ts';

/**
 * The recipe a cook is looking at when they ask John something.
 *
 * Fixed, like the kitchen, so every arm of the cook-question sweep is asked about the same dish.
 * It is written to give the questions something to bite on: a rice dish to swap (the pantry has
 * chickpeas), a chilli to dial down, a step with a timer, and an ingredient the cook can plausibly
 * have run out of.
 *
 * Resolved through `resolveRecipe` against an empty canonical list, which is what the handler would
 * produce for an unseeded kitchen — every line comes back `missing`. See `RESOLVES_AGAINST_CANONICAL`
 * in `kitchen.ts`: this harness does not measure pantry resolution.
 */

const MODEL_RECIPE: ModelRecipe = {
  title: 'Chilli chicken with blistered beans and rice',
  emoji: '🌶️',
  total_minutes: 28,
  servings: 3,
  dishes: [
    { slot: 'protein', name: 'Chilli chicken', high_protein_option: null },
    { slot: 'veg', name: 'Blistered green beans', high_protein_option: null },
    { slot: 'carb', name: 'Steamed rice', high_protein_option: 'chickpeas instead of rice' },
  ],
  skill_node: {
    attribute: 'heat',
    tier: 1,
    why: 'Learning to read a pan by sight and sound, before anything goes in it.',
  },
  salt_strategy:
    'Salt the chicken the moment it is cut so it has twenty minutes to pull moisture and season ' +
    'through. The beans get salted as they come off the heat, or they weep and steam. A big pinch ' +
    'in the rice water.',
  equipment: ['frying pan', 'wok', 'saucepan with lid'],
  ingredients: [
    { name_en: 'chicken thigh', name_nl: 'kippenbout', amount: 600, unit: 'g', dish: 'protein', aisle: 'meat_fish' },
    { name_en: 'red chilli', name_nl: 'rode peper', amount: 2, unit: 'piece', dish: 'protein', aisle: 'produce' },
    { name_en: 'garlic', name_nl: 'knoflook', amount: 4, unit: 'clove', dish: 'protein', aisle: 'produce' },
    { name_en: 'soy sauce', name_nl: 'sojasaus', amount: 2, unit: 'tbsp', dish: 'protein', aisle: 'oils_sauces_spices' },
    { name_en: 'green beans', name_nl: 'sperziebonen', amount: 400, unit: 'g', dish: 'veg', aisle: 'produce' },
    { name_en: 'lemon', name_nl: 'citroen', amount: 1, unit: 'piece', dish: 'veg', aisle: 'produce' },
    { name_en: 'olive oil', name_nl: 'olijfolie', amount: 2, unit: 'tbsp', dish: 'veg', aisle: 'oils_sauces_spices' },
    { name_en: 'rice', name_nl: 'rijst', amount: 300, unit: 'g', dish: 'carb', aisle: 'dry_goods' },
    { name_en: 'salt', name_nl: 'zout', amount: 1, unit: 'tsp', dish: 'carb', aisle: 'oils_sauces_spices' },
  ],
  prep: [
    {
      item: 'chicken thigh',
      amount: '600 g, cut into 3 cm pieces',
      instruction: 'Cut and salt right now, so it seasons while you do everything else.',
      dish: 'protein',
    },
    { item: 'red chilli', amount: '2, finely sliced', instruction: 'Slice thin, seeds in.', dish: 'protein' },
    { item: 'garlic', amount: '4 cloves, sliced', instruction: 'Slice, do not crush.', dish: 'protein' },
    { item: 'green beans', amount: '400 g, topped and tailed', instruction: 'Top and tail, leave whole.', dish: 'veg' },
    { item: 'lemon', amount: '1, cut in half', instruction: 'Halve it, ready to squeeze.', dish: 'veg' },
    { item: 'rice', amount: '300 g, rinsed', instruction: 'Rinse until the water runs clear.', dish: 'carb' },
  ],
  steps: [
    {
      number: 1,
      text: 'Rice into the saucepan with 600 ml water and the salt. Lid on, lowest heat once it boils.',
      salt_cue: 'A big pinch now — rice cannot be salted later.',
      heat_cue: null,
      dish: 'carb',
      timer_seconds: 720,
    },
    {
      number: 2,
      text: 'Get the frying pan properly hot with a little oil, then lay the chicken in one layer.',
      salt_cue: null,
      heat_cue: 'The oil shimmers and moves like water; a drop of water spits straight back out.',
      dish: 'protein',
      timer_seconds: 420,
    },
    {
      number: 3,
      text: 'Garlic and chilli in with the chicken, then the soy sauce. Toss until it glazes.',
      salt_cue: 'The soy is salt too — taste before adding any more.',
      heat_cue: 'The garlic should smell sweet, never sharp or brown.',
      dish: 'protein',
      timer_seconds: 180,
    },
    {
      number: 4,
      text: 'Beans into the wok with the olive oil on the highest heat you have. Leave them alone to blister.',
      salt_cue: 'Salt them as they come off, not before.',
      heat_cue: 'They should squeak, then blacken in patches.',
      dish: 'veg',
      timer_seconds: 300,
    },
    {
      number: 5,
      text: 'Squeeze the lemon over the beans off the heat and serve everything together.',
      salt_cue: null,
      heat_cue: null,
      dish: 'veg',
      timer_seconds: null,
    },
  ],
  high_leverage_ingredients: ['red chilli', 'soy sauce', 'lemon'],
  summary_card:
    'Salt the chicken the second it is cut. Rice on first. Pan hot before the chicken goes in. ' +
    'Beans last, on the highest heat, salted off the heat with lemon.',
};

/** A fresh copy per call: the cook-question loop applies patches to it. */
export function evalRecipe(): Recipe {
  return resolveRecipe(MODEL_RECIPE, { ingredients: [], pantry: new Map() });
}
