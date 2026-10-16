import { profileFromQuickStart } from '../../app/_shared/domain/profile.ts';
import { beginnerFrontier } from '../../app/_shared/domain/skill.ts';
import type { KitchenState } from '../../app/_shared/prompt/john.ts';
import type { CoherenceContext } from '../graders/recipe-coherence.ts';

/**
 * One fixed kitchen, used by every arm of every sweep.
 *
 * This is what makes the comparison mean anything: the only thing that changes between two cells
 * of the dashboard is the model and the effort. Reading a real kitchen out of Postgres would make
 * runs non-comparable the moment anyone's pantry changed, and would make a regression
 * indistinguishable from someone finishing the rice.
 *
 * It is deliberately a *constrained* kitchen — no oven, three hobs, a modest pantry. A generous
 * kitchen cannot fail the `equipment_respected` check, so it would not measure one of the things
 * the prompt promises.
 */

/** No oven: the constraint most likely to be ignored, so the one most worth watching. */
export const EVAL_PROFILE = profileFromQuickStart({
  equipment: ['hob', 'microwave', 'kettle'],
  hobs: 3,
  notes: 'One large non-stick frying pan, one saucepan, a wok, a box grater. No oven at all.',
});

/**
 * A plausible mid-week pantry: enough that a recipe can lean on it, short enough that a shopping
 * list is still expected. Levels matter — `low` and `out` are what John is supposed to route
 * around, and a pantry that is all `plenty` never tests that.
 */
export const EVAL_PANTRY: KitchenState['pantry'] = [
  { name_en: 'olive oil', name_nl: 'olijfolie', level: 'plenty' },
  { name_en: 'salt', name_nl: 'zout', level: 'plenty' },
  { name_en: 'black pepper', name_nl: 'zwarte peper', level: 'plenty' },
  { name_en: 'garlic', name_nl: 'knoflook', level: 'plenty' },
  { name_en: 'onion', name_nl: 'ui', level: 'plenty' },
  { name_en: 'rice', name_nl: 'rijst', level: 'plenty' },
  { name_en: 'pasta', name_nl: 'pasta', level: 'plenty' },
  { name_en: 'chickpeas', name_nl: 'kikkererwten', level: 'plenty' },
  { name_en: 'soy sauce', name_nl: 'sojasaus', level: 'plenty' },
  { name_en: 'cumin', name_nl: 'komijn', level: 'plenty' },
  { name_en: 'paprika powder', name_nl: 'paprikapoeder', level: 'plenty' },
  { name_en: 'lemon', name_nl: 'citroen', level: 'low' },
  { name_en: 'butter', name_nl: 'boter', level: 'low' },
  { name_en: 'yoghurt', name_nl: 'yoghurt', level: 'low' },
  { name_en: 'eggs', name_nl: 'eieren', level: 'out' },
  { name_en: 'tomato paste', name_nl: 'tomatenpuree', level: 'out' },
];

export const EVAL_GEAR: KitchenState['gear'] = [
  { name_en: 'frying pan', notes: 'large, non-stick' },
  { name_en: 'saucepan', notes: null },
  { name_en: 'wok', notes: null },
  { name_en: 'box grater', notes: null },
  { name_en: 'chef knife', notes: null },
];

export function evalKitchen(): KitchenState {
  return {
    profile: EVAL_PROFILE,
    pantry: EVAL_PANTRY,
    gear: EVAL_GEAR,
    // A beginner on every attribute, so a tier above 1 is a check that can actually fail.
    frontier: beginnerFrontier(),
  };
}

/** The same kitchen as the graders see it. */
export function evalCoherenceContext(): CoherenceContext {
  const kitchen = evalKitchen();
  return { profile: kitchen.profile, frontier: kitchen.frontier };
}

/**
 * The canonical ingredient list is NOT part of this fixture, and that is a named gap.
 *
 * Resolution against canonical ids lives in the database seed (~160 ingredients), so an eval run
 * resolves nothing and every line comes back `missing`. That is consistent across arms, so the
 * comparison holds — but it means this harness does not measure `ingredient_id` resolution or the
 * pantry check. Closing it means loading the seed, which is week-2 work alongside the photo sweep.
 */
export const RESOLVES_AGAINST_CANONICAL = false;
