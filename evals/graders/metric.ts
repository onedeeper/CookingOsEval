/**
 * One metric's verdict, and the shape every grader in this directory returns.
 *
 * Shared so the promptfoo assertion that turns grader output into `namedScores` has exactly one
 * thing to understand, whatever it is grading. A grader that invented its own shape would need
 * its own adapter, and the dashboard's columns would stop lining up between tasks.
 */
export type MetricResult = {
  metric: string;
  pass: boolean;
  /** 0..1. Boolean checks report 1 or 0; share-based checks report the share. */
  score: number;
  /** Written for a human reading one cell of the dashboard, so it names the offending line. */
  reason: string;
};

export function metricResult(
  metric: string,
  pass: boolean,
  reason: string,
  score = pass ? 1 : 0,
): MetricResult {
  return { metric, pass, score, reason };
}
