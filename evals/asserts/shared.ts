import type { MetricResult } from '../graders/metric.ts';

/**
 * Turning a list of metric results into the one shape promptfoo's dashboard reads.
 *
 * `namedScores` is what becomes a column per metric, which is the whole reason the graders return
 * a list rather than a verdict: a single pass/fail would hide the trade a sweep exists to find —
 * that a cheaper arm holds structure and drops teaching, say.
 */

export type GradingResult = {
  pass: boolean;
  score: number;
  reason: string;
  namedScores: Record<string, number>;
  componentResults: { pass: boolean; score: number; reason: string }[];
};

/**
 * Pass means every metric passed.
 *
 * Both halves are real requirements — a recipe that calls for an oven the cook lacks is unusable
 * whatever the judge says about it, and one the judge finds genuinely bad is unusable however
 * neatly it is structured. The mean score is what ranks the cells that fail, so a near miss and a
 * disaster are still distinguishable.
 */
export function toGradingResult(metrics: MetricResult[], headline: string): GradingResult {
  if (metrics.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: `${headline} — no metrics were produced, which is a harness fault, not a verdict.`,
      namedScores: {},
      componentResults: [],
    };
  }

  const failed = metrics.filter((metric) => !metric.pass);
  const score = metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length;

  const namedScores: Record<string, number> = {};
  for (const metric of metrics) {
    namedScores[metric.metric] = metric.score;
  }

  return {
    pass: failed.length === 0,
    score,
    reason:
      failed.length === 0
        ? `${headline} — all ${metrics.length} metrics passed.`
        : `${headline} — ${failed.length} failed: ` +
          failed.map((metric) => `${metric.metric} (${metric.reason})`).join(' | '),
    namedScores,
    componentResults: metrics.map((metric) => ({
      pass: metric.pass,
      score: metric.score,
      reason: `${metric.metric}: ${metric.reason}`,
    })),
  };
}

/** A cell the provider could not produce anything for. Scored zero, with the reason kept. */
export function providerFailure(error: unknown): GradingResult {
  const message = typeof error === 'string' ? error : JSON.stringify(error);
  return {
    pass: false,
    score: 0,
    reason: `The call did not produce anything gradeable: ${message}`,
    namedScores: {},
    componentResults: [],
  };
}
