import { ModelRecipeSchema } from '../../app/_shared/domain/recipe.ts';
import { evalCoherenceContext } from '../fixtures/kitchen.ts';
import { runJudge } from '../graders/judge-call.ts';
import { MEAL_RUBRIC } from '../graders/judge.ts';
import { gradeRecipeCoherence } from '../graders/recipe-coherence.ts';
import { type GradingResult, providerFailure, toGradingResult } from './shared.ts';

/**
 * The assertion promptfoo runs on every generation cell: the deterministic rubric, then the judge.
 *
 * The two halves are deliberately asymmetric. The coherence checks run on a parsed recipe and
 * cost nothing, so they always run. The judge costs money, so it runs only on a recipe that
 * parsed — judging something the schema rejected would spend Opus tokens restating what the
 * parse already said.
 */

/**
 * A note on cost. promptfoo's cost column is the ARM's own cost, and deliberately so: that is the
 * number you would pay in production, and it is what the sweep compares. The judge is measurement
 * overhead — identical for every cell — so folding it in would make every arm look the same amount
 * worse and tell you nothing. It is reported in the cell's reason instead, so a run's true spend is
 * still visible.
 */

type AssertContext = {
  vars?: Record<string, unknown>;
  providerResponse?: { error?: string; metadata?: Record<string, unknown> };
};

export default async function gradeMeal(output: unknown, context: AssertContext): Promise<GradingResult> {
  if (context.providerResponse?.error !== undefined) {
    return providerFailure(context.providerResponse.error);
  }

  const parsed = ModelRecipeSchema.safeParse(output);
  if (!parsed.success) {
    // The provider already validates, so reaching here means the shape changed under us.
    return providerFailure(`The recipe did not match ModelRecipeSchema: ${parsed.error.message}`);
  }

  const recipe = parsed.data;
  const coherence = gradeRecipeCoherence(recipe, evalCoherenceContext());

  const judged = await runJudge(MEAL_RUBRIC, {
    subject: JSON.stringify(recipe, null, 2),
    request: String(context.vars?.request ?? 'an unrecorded request'),
    profile: evalCoherenceContext().profile,
  });

  const headline =
    `${recipe.emoji} ${recipe.title} ` +
    `[judge +$${judged.costUsd.toFixed(4)}]: ${judged.overall}`;

  return toGradingResult([...coherence, ...judged.metrics], headline);
}
