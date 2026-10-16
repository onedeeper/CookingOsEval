import { evalCoherenceContext } from '../fixtures/kitchen.ts';
import { type CookExpectation, type CookOutcome, gradeCookAnswer } from '../graders/cook-answer.ts';
import { runJudge } from '../graders/judge-call.ts';
import { COOK_RUBRIC } from '../graders/judge.ts';
import { type GradingResult, providerFailure, toGradingResult } from './shared.ts';

/**
 * The assertion promptfoo runs on every cook-question cell.
 *
 * The expectation — should this question have produced a patch, a rethink, a pantry write —
 * is declared per case in the YAML rather than inferred from what the model did. Inferring it
 * would make the metric unfalsifiable: whatever the model chose would look correct.
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

function expectationFrom(vars: Record<string, unknown> | undefined): CookExpectation {
  return {
    patch: vars?.expect_patch === true || vars?.expect_patch === 'true',
    pantry: vars?.expect_pantry === true || vars?.expect_pantry === 'true',
    rethink: vars?.expect_rethink === true || vars?.expect_rethink === 'true',
  };
}

export default async function gradeCookAnswerCell(
  output: unknown,
  context: AssertContext,
): Promise<GradingResult> {
  if (context.providerResponse?.error !== undefined) {
    return providerFailure(context.providerResponse.error);
  }

  const outcome = output as CookOutcome;
  if (typeof outcome !== 'object' || outcome === null || typeof outcome.answer !== 'string') {
    return providerFailure('The provider did not return a cook outcome.');
  }

  const structural = gradeCookAnswer(outcome, expectationFrom(context.vars));

  const judged = await runJudge(COOK_RUBRIC, {
    subject: outcome.answer,
    request: String(context.vars?.question ?? 'an unrecorded question'),
    profile: evalCoherenceContext().profile,
  });

  const headline = `[judge +$${judged.costUsd.toFixed(4)}] ${judged.overall}`;

  return toGradingResult([...structural, ...judged.metrics], headline);
}
