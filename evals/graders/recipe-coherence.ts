/**
 * The deterministic recipe rubric, which now lives in the shipped domain.
 *
 * It moved to `_shared/domain/recipe-coherence.ts` because `cook-question` needs it too: a patch
 * that leaves the recipe incoherent has to be caught before it is saved, and grading a patched
 * recipe by a second copy of these checks would mean the sweep and the app disagreeing about what
 * "coherent" means — which is the drift `_shared` exists to prevent.
 *
 * `CoherenceResult` is structurally identical to this directory's `MetricResult`, so this is a
 * re-export and not an adapter. The import path stays put so the promptfoo configs do not move.
 */
export {
  COHERENCE_METRICS,
  PATCH_SAFE_METRICS,
  type CoherenceContext,
  type CoherenceMetric,
  type CoherenceResult,
  cuesPresent,
  dutchNames,
  equipmentListed,
  equipmentRespected,
  gradeRecipeCoherence,
  ingredientsUsed,
  mealShape,
  oneSkillNode,
  patchIntroducedIncoherence,
  prepCoveredByIngredients,
  rolesResolve,
  servingsMatch,
  timingsAddUp,
  withinTimeBudget,
} from '../../app/_shared/domain/recipe-coherence.ts';
