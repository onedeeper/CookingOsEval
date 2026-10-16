import type { ModelRecipe } from '../../app/_shared/domain/recipe.ts';
import { DEFAULT_PROFILE, type Profile, profileFromQuickStart } from '../../app/_shared/domain/profile.ts';
import { beginnerFrontier } from '../../app/_shared/domain/skill.ts';
import type { CoherenceContext } from '../../evals/graders/recipe-coherence.ts';

/**
 * A recipe that passes every coherence check, and a deep-merge to break exactly one thing.
 *
 * The builder is deliberately a *passing* recipe: every grader test starts from it and spoils
 * one field, so a test that fails tells you which check caught which defect. A builder that
 * started from something already broken would make half the suite ambiguous.
 */

export function kitchenContext(overrides: Partial<Profile> = {}): CoherenceContext {
  return {
    profile: { ...profileFromQuickStart({ equipment: ['hob', 'microwave'], hobs: 3, notes: null }), ...overrides },
    frontier: beginnerFrontier(),
  };
}

/** Three dishes, three roles, 25 minutes, every line labelled and every ingredient used. */
export function goodRecipe(overrides: Partial<ModelRecipe> = {}): ModelRecipe {
  return {
    title: 'Chilli chicken with greens and rice',
    emoji: '🌶️',
    total_minutes: 25,
    servings: DEFAULT_PROFILE.default_servings,
    dishes: [
      { slot: 'protein', name: 'Chilli chicken', high_protein_option: null },
      { slot: 'veg', name: 'Garlic greens', high_protein_option: null },
      { slot: 'carb', name: 'Steamed rice', high_protein_option: 'chickpeas instead of rice' },
    ],
    skill_node: { attribute: 'heat', tier: 1, why: 'Learning when a pan is actually hot enough.' },
    salt_strategy: 'Salt the chicken now so it has time to pull moisture; the greens at the end.',
    equipment: ['frying pan', 'saucepan with lid'],
    ingredients: [
      { name_en: 'chicken thigh', name_nl: 'kippenbout', amount: 500, unit: 'g', dish: 'protein', aisle: 'meat_fish' },
      { name_en: 'red chilli', name_nl: 'rode peper', amount: 2, unit: 'piece', dish: 'protein', aisle: 'produce' },
      { name_en: 'green beans', name_nl: 'sperziebonen', amount: 300, unit: 'g', dish: 'veg', aisle: 'produce' },
      { name_en: 'garlic', name_nl: 'knoflook', amount: 3, unit: 'clove', dish: 'veg', aisle: 'produce' },
      { name_en: 'rice', name_nl: 'rijst', amount: 300, unit: 'g', dish: 'carb', aisle: 'dry_goods' },
    ],
    prep: [
      { item: 'chicken thigh', amount: '500 g, cut in 3 cm pieces', instruction: 'Cut and salt now.', dish: 'protein' },
      { item: 'red chilli', amount: '2, finely sliced', instruction: 'Slice thin.', dish: 'protein' },
      { item: 'green beans', amount: '300 g, topped', instruction: 'Top and tail.', dish: 'veg' },
      { item: 'garlic', amount: '3 cloves, sliced', instruction: 'Slice thin.', dish: 'veg' },
      { item: 'rice', amount: '300 g, rinsed', instruction: 'Rinse until the water runs clear.', dish: 'carb' },
    ],
    steps: [
      {
        number: 1,
        text: 'Get the rice on with 600 ml water, lid on.',
        salt_cue: 'A big pinch of salt in the water.',
        heat_cue: null,
        dish: 'carb',
        timer_seconds: 600,
      },
      {
        number: 2,
        text: 'Sear the chicken thigh in a hot pan until browned.',
        salt_cue: null,
        heat_cue: 'The oil shimmers and a drop of water spits.',
        dish: 'protein',
        timer_seconds: 480,
      },
      {
        number: 3,
        text: 'Add the red chilli to the chicken and toss through.',
        salt_cue: null,
        heat_cue: null,
        dish: 'protein',
        timer_seconds: 120,
      },
      {
        number: 4,
        text: 'Blister the green beans with the garlic in the same pan.',
        salt_cue: 'Salt the greens as they come off the heat.',
        heat_cue: 'They should squeak and blacken in patches.',
        dish: 'veg',
        timer_seconds: 300,
      },
    ],
    high_leverage_ingredients: ['red chilli', 'garlic'],
    summary_card: 'Salt the chicken early, get the rice on first, finish the greens last.',
    ...overrides,
  };
}
