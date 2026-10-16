import {
  COHERENCE_METRICS,
  cuesPresent,
  dutchNames,
  equipmentListed,
  equipmentRespected,
  gradeRecipeCoherence,
  ingredientsUsed,
  mealShape,
  oneSkillNode,
  prepCoveredByIngredients,
  rolesResolve,
  servingsMatch,
  timingsAddUp,
  withinTimeBudget,
} from '../../evals/graders/recipe-coherence.ts';
import { goodRecipe, kitchenContext } from './recipe-fixture.ts';

/**
 * The deterministic half of the eval rubric.
 *
 * These are the defects a structured recipe can carry while still being schema-valid — which is
 * exactly the set the schema cannot catch and a cook finds at the hob. Each check is scored on
 * its own so the dashboard can show which arm of the sweep regressed what, rather than one
 * pass/fail that hides the trade.
 *
 * Every test here spoils ONE field of a passing recipe, so a failure names the defect.
 */

describe('a recipe with nothing wrong with it', () => {
  it('passes every coherence check', () => {
    const results = gradeRecipeCoherence(goodRecipe(), kitchenContext());
    const failed = results.filter((result) => !result.pass);

    expect(failed.map((result) => `${result.metric}: ${result.reason}`)).toEqual([]);
  });

  it('reports one result per declared metric, so the dashboard has no missing columns', () => {
    const results = gradeRecipeCoherence(goodRecipe(), kitchenContext());

    expect(results.map((result) => result.metric).sort()).toEqual([...COHERENCE_METRICS].sort());
  });
});

describe('mealShape', () => {
  it('passes when the dishes are the roles the profile asked for', () => {
    expect(mealShape(goodRecipe(), kitchenContext()).pass).toBe(true);
  });

  it('fails when a dish is missing, which is a meal the cook did not ask for', () => {
    const recipe = goodRecipe({
      dishes: [
        { slot: 'protein', name: 'Chilli chicken', high_protein_option: null },
        { slot: 'veg', name: 'Garlic greens', high_protein_option: null },
      ],
    });

    expect(mealShape(recipe, kitchenContext()).pass).toBe(false);
  });

  it('passes on a casing difference, because roles are free text and the model varies them', () => {
    const recipe = goodRecipe({
      dishes: [
        { slot: 'Protein', name: 'Chilli chicken', high_protein_option: null },
        { slot: 'Veg', name: 'Garlic greens', high_protein_option: null },
        { slot: 'Carb', name: 'Steamed rice', high_protein_option: null },
      ],
    });

    expect(mealShape(recipe, kitchenContext()).pass).toBe(true);
  });
});

describe('rolesResolve', () => {
  it('fails when a line carries the dish NAME instead of its role', () => {
    // The live-only defect: every unit test stayed green and the Ingredients tab rendered empty.
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      ingredients: recipe.ingredients.map((line, index) =>
        index === 0 ? { ...line, dish: 'Chilli chicken' } : line,
      ),
    });

    const result = rolesResolve(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Chilli chicken');
  });

  it('fails when a prep item or a step is orphaned too, not only an ingredient', () => {
    const recipe = goodRecipe();

    expect(
      rolesResolve(
        goodRecipe({ prep: recipe.prep.map((item, i) => (i === 0 ? { ...item, dish: 'nonsense' } : item)) }),
        kitchenContext(),
      ).pass,
    ).toBe(false);
    expect(
      rolesResolve(
        goodRecipe({ steps: recipe.steps.map((step, i) => (i === 0 ? { ...step, dish: 'nonsense' } : step)) }),
        kitchenContext(),
      ).pass,
    ).toBe(false);
  });
});

describe('ingredientsUsed', () => {
  it('fails when an ingredient is bought and then never mentioned again', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      ingredients: [
        ...recipe.ingredients,
        { name_en: 'lemon', name_nl: 'citroen', amount: 1, unit: 'piece', dish: 'veg', aisle: 'other' },
      ],
    });

    const result = ingredientsUsed(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('lemon');
  });

  it('scores the share used, so a near miss is not the same number as a shambles', () => {
    const recipe = goodRecipe();
    const oneUnused = goodRecipe({
      ingredients: [
        ...recipe.ingredients,
        { name_en: 'lemon', name_nl: 'citroen', amount: 1, unit: 'piece', dish: 'veg', aisle: 'other' },
      ],
    });
    const twoUnused = goodRecipe({
      ingredients: [
        ...recipe.ingredients,
        { name_en: 'lemon', name_nl: 'citroen', amount: 1, unit: 'piece', dish: 'veg', aisle: 'other' },
        { name_en: 'star anise', name_nl: 'steranijs', amount: 2, unit: 'piece', dish: 'protein', aisle: 'other' },
      ],
    });

    expect(ingredientsUsed(oneUnused, kitchenContext()).score).toBeGreaterThan(
      ingredientsUsed(twoUnused, kitchenContext()).score,
    );
  });

  it('counts an ingredient named by its head word in a step, not only verbatim', () => {
    // Steps are prose: "sear the chicken" uses "chicken thigh". Being strict here would fail
    // every real recipe and the metric would be ignored, which is worse than being lenient.
    expect(ingredientsUsed(goodRecipe(), kitchenContext()).pass).toBe(true);
  });
});

describe('prepCoveredByIngredients', () => {
  it('fails when prep calls for something that is not on the ingredient list', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      prep: [
        ...recipe.prep,
        { item: 'eggs', amount: '2, beaten', instruction: 'Beat with a fork.', dish: 'protein' },
      ],
    });

    const result = prepCoveredByIngredients(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('eggs');
  });
});

describe('timingsAddUp', () => {
  it('passes when each dish fits inside the stated total, cooking dishes in parallel', () => {
    // The hobs are the reason: three dishes run at once, so the honest test is the longest
    // single dish against the total, never the sum of every timer.
    expect(timingsAddUp(goodRecipe(), kitchenContext()).pass).toBe(true);
  });

  it('fails when one dish alone runs longer than the whole meal is supposed to take', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      total_minutes: 10,
      steps: recipe.steps.map((step) => (step.dish === 'carb' ? { ...step, timer_seconds: 1_800 } : step)),
    });

    const result = timingsAddUp(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('carb');
  });

  it('does not fail a meal whose dishes only exceed the total when summed', () => {
    // 600 + 480 + 120 + 300 = 1500s = 25 min of timers across three parallel dishes.
    expect(timingsAddUp(goodRecipe({ total_minutes: 20 }), kitchenContext()).pass).toBe(true);
  });
});

describe('withinTimeBudget', () => {
  it('fails when the meal is over the profile"s weekday ceiling', () => {
    expect(withinTimeBudget(goodRecipe({ total_minutes: 45 }), kitchenContext()).pass).toBe(false);
  });

  it('reads the ceiling from the profile, not from a constant', () => {
    const generous = kitchenContext({ time_budget: { weekday_minutes: 60, weekend_minutes: 60 } });

    expect(withinTimeBudget(goodRecipe({ total_minutes: 45 }), generous).pass).toBe(true);
  });
});

describe('servingsMatch', () => {
  it('fails when the recipe serves a different number of people than the profile', () => {
    expect(servingsMatch(goodRecipe({ servings: 2 }), kitchenContext()).pass).toBe(false);
  });
});

describe('oneSkillNode', () => {
  it('fails when the stretch technique is above the cook"s frontier tier', () => {
    const recipe = goodRecipe({ skill_node: { attribute: 'heat', tier: 4, why: 'Because.' } });

    const result = oneSkillNode(recipe, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('tier 4');
  });

  it('passes at the frontier tier itself, which is the one it is supposed to teach', () => {
    expect(oneSkillNode(goodRecipe(), kitchenContext()).pass).toBe(true);
  });
});

describe('cuesPresent', () => {
  it('fails when no step gives a salt or heat cue the cook can act on', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      steps: recipe.steps.map((step) => ({ ...step, salt_cue: null, heat_cue: null })),
      salt_strategy: '',
    });

    expect(cuesPresent(spoiled, kitchenContext()).pass).toBe(false);
  });

  it('fails when the meal-wide salt strategy is missing, even if steps have cues', () => {
    expect(cuesPresent(goodRecipe({ salt_strategy: '   ' }), kitchenContext()).pass).toBe(false);
  });
});

describe('dutchNames', () => {
  it('fails when the Dutch column is just the English name copied across', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      ingredients: recipe.ingredients.map((line) => ({ ...line, name_nl: line.name_en })),
    });

    const result = dutchNames(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('tolerates the handful of ingredients that genuinely share a name', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      ingredients: recipe.ingredients.map((line, index) =>
        index === 0 ? { ...line, name_nl: line.name_en } : line,
      ),
    });

    expect(dutchNames(spoiled, kitchenContext()).pass).toBe(true);
  });
});

describe('equipmentRespected', () => {
  it('fails when a step calls for an oven the cook does not have', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      steps: recipe.steps.map((step, index) =>
        index === 0 ? { ...step, text: 'Roast the beans in the oven at 200C.' } : step,
      ),
    });

    const result = equipmentRespected(spoiled, kitchenContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('oven');
  });

  it('passes when the cook actually has the appliance the step names', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      steps: recipe.steps.map((step, index) =>
        index === 0 ? { ...step, text: 'Roast the beans in the oven at 200C.' } : step,
      ),
    });

    expect(equipmentRespected(spoiled, kitchenContext({ oven: true })).pass).toBe(true);
  });

  it('checks prep instructions as well as steps', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      prep: recipe.prep.map((item, index) =>
        index === 0 ? { ...item, instruction: 'Blitz in the blender until smooth.' } : item,
      ),
    });

    expect(equipmentRespected(spoiled, kitchenContext()).pass).toBe(false);
  });

  it('does not flag a wok, which is a pan the cook can substitute', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      steps: recipe.steps.map((step, index) =>
        index === 0 ? { ...step, text: 'Get a wok or a large frying pan smoking hot.' } : step,
      ),
    });

    expect(equipmentRespected(spoiled, kitchenContext()).pass).toBe(true);
  });
});

describe('equipmentRespected and the equipment list', () => {
  it('also reads the list the recipe shows the cook: an oven listed but not owned fails', () => {
    // The list is what the Overview tells the cook to set out. A recipe whose steps never say "oven"
    // but whose list does is still sending them to an appliance they do not have.
    const spoiled = goodRecipe({ equipment: ['frying pan', 'oven'] });

    const result = equipmentRespected(spoiled, kitchenContext());

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('oven');
  });
});

/**
 * Added 2026-10-13 with the Overview's "You'll need" list. The list is only worth showing if it
 * agrees with the recipe: an oven in the steps and not on the list is the cook finding out at the
 * hob, which is the failure the list exists to prevent.
 */
describe('equipmentListed', () => {
  const ovenStep = () => {
    const recipe = goodRecipe();
    return recipe.steps.map((step, index) =>
      index === 0 ? { ...step, text: 'Roast the beans in the oven at 200C.' } : step,
    );
  };

  it('fails when a step uses an appliance that is not on the list', () => {
    const spoiled = goodRecipe({ steps: ovenStep(), equipment: ['frying pan'] });

    const result = equipmentListed(spoiled, kitchenContext({ oven: true }));

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('oven');
  });

  it('passes when the appliance the step uses is listed', () => {
    const spoiled = goodRecipe({ steps: ovenStep(), equipment: ['oven', 'frying pan'] });

    expect(equipmentListed(spoiled, kitchenContext({ oven: true })).pass).toBe(true);
  });

  it('checks prep instructions as well as steps', () => {
    const recipe = goodRecipe();
    const spoiled = goodRecipe({
      prep: recipe.prep.map((item, index) =>
        index === 0 ? { ...item, instruction: 'Preheat the oven to 200C.' } : item,
      ),
      equipment: ['frying pan'],
    });

    expect(equipmentListed(spoiled, kitchenContext({ oven: true })).pass).toBe(false);
  });

  it('fails an empty list, because every meal is cooked in something', () => {
    const result = equipmentListed(goodRecipe({ equipment: [] }), kitchenContext());

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no equipment|empty/i);
  });

  it('does not demand a wok be listed, since it is a pan the cook can substitute', () => {
    const recipe = goodRecipe();
    const wokStep = recipe.steps.map((step, index) =>
      index === 0 ? { ...step, text: 'Get a wok or a large frying pan smoking hot.' } : step,
    );

    expect(equipmentListed(goodRecipe({ steps: wokStep, equipment: ['frying pan'] }), kitchenContext()).pass).toBe(true);
  });
});

