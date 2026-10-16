import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  createAnthropic,
  readUsage,
  thinkingFor,
} from '../../app/_shared/server/anthropic.ts';
import { costUsd } from '../../app/_shared/server/models.ts';
import { requireAnthropicKey } from '../lib/env-local.ts';
import type { MetricResult } from './metric.ts';
import {
  buildJudgePrompt,
  JUDGE_EFFORT,
  JUDGE_MODEL,
  JudgeVerdictSchema,
  type JudgeSubject,
  type Rubric,
  judgeOutcomeMetrics,
} from './judge.ts';

/**
 * The judge's one API call, kept apart from `judge.ts` so the rubric and the score arithmetic
 * stay unit-testable without a key.
 *
 * Structured output rather than "reply with JSON": the verdict has to parse or the cell has no
 * columns, and `output_config.format` is what makes that a guarantee instead of a hope.
 */

export type JudgeOutcome = {
  metrics: MetricResult[];
  overall: string;
  costUsd: number;
};

/**
 * Generous on purpose. At `xhigh` the judge thinks far more than it writes, and thinking is billed
 * against the same ceiling — the first version capped this at 4,000 and every verdict came back
 * empty, because the budget was spent before the JSON closed. It cost full price and produced
 * nothing, and it reported as a pass until `judge_verdict` existed to catch it.
 */
const JUDGE_MAX_TOKENS = 16000;

export async function runJudge(rubric: Rubric, subject: JudgeSubject): Promise<JudgeOutcome> {
  const anthropic = createAnthropic(requireAnthropicKey());

  const message = await anthropic.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    system:
      'You are a demanding but fair cooking judge. You grade one thing at a time against a ' +
      'rubric, you use the whole scale, and you never confuse "I would have done it differently" ' +
      'with "this is wrong".',
    messages: [{ role: 'user', content: buildJudgePrompt(rubric, subject) }],
    output_config: { effort: JUDGE_EFFORT, format: zodOutputFormat(JudgeVerdictSchema) },
    ...thinkingFor(JUDGE_MODEL),
  });

  const verdict = message.parsed_output ?? null;
  const judgeCost = costUsd(JUDGE_MODEL, readUsage(message.usage));

  // `judgeOutcomeMetrics` owns the "unjudged" case, including the column that fails for it, so
  // the dashboard shows a broken judge rather than a quiet pass.
  return {
    metrics: judgeOutcomeMetrics(verdict, rubric, `stop_reason: ${message.stop_reason}`),
    overall:
      verdict === null
        ? `The judge returned nothing that validated (stop_reason: ${message.stop_reason}); unjudged.`
        : verdict.overall,
    costUsd: judgeCost,
  };
}
