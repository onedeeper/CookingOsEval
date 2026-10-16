import type { Effort, ModelId, TokenUsage } from '../../app/_shared/server/models.ts';

/**
 * The promptfoo provider contract, as this harness uses it, plus the one shape an arm has.
 *
 * Typed locally rather than imported from promptfoo: the provider modules are loaded by
 * promptfoo's own bundler, and a type-only dependency on its internals is a thing that breaks on
 * upgrade for no benefit. These are the fields the dashboard reads.
 */

/** One cell of the sweep: which model, at what effort. */
export type ArmConfig = {
  model: ModelId;
  effort: Effort;
};

export type ProviderResponse = {
  /** A recipe object, an answer string, or an error string. Graders narrow it. */
  output?: unknown;
  /** Set instead of `output` when the cell could not produce anything gradeable. */
  error?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  cost?: number;
  metadata?: Record<string, unknown>;
};

/** "opus-5-5/high" — short enough to be a column heading. */
export function armLabel({ model, effort }: ArmConfig): string {
  return `${model.replace(/^claude-/, '')}/${effort}`;
}

type FailureFacts = {
  arm: ArmConfig;
  cost?: number;
  usage?: TokenUsage;
  durationMs: number;
  ttftMs: number | null;
};

/**
 * A failed cell that still reports what it cost.
 *
 * The cost is the point: a model that refuses, times out or writes JSON that will not validate was
 * still billed, and an eval that dropped those cells would make a flaky arm look cheap. Same
 * reasoning as `recordModelCall` writing its ledger row in a `finally`.
 */
export function failureResponse(message: string, facts: FailureFacts): ProviderResponse {
  return {
    error: message,
    ...(facts.cost === undefined ? {} : { cost: facts.cost }),
    ...(facts.usage === undefined
      ? {}
      : {
          tokenUsage: {
            prompt: facts.usage.inputTokens + facts.usage.cacheReadTokens + facts.usage.cacheWriteTokens,
            completion: facts.usage.outputTokens,
            total:
              facts.usage.inputTokens +
              facts.usage.cacheReadTokens +
              facts.usage.cacheWriteTokens +
              facts.usage.outputTokens,
          },
        }),
    metadata: {
      model: facts.arm.model,
      effort: facts.arm.effort,
      duration_ms: facts.durationMs,
      ttft_ms: facts.ttftMs,
      failed: true,
    },
  };
}
