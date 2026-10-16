/**
 * Model registry and task assignment.
 *
 * The brief's rule: start every AI task on Claude Sonnet 5.5, and move a task to
 * a cheaper model only where the eval set shows equal quality. A cheap model
 * fumbling an early recipe would lose testers and confound the test.
 *
 * So moving a task between models is a one-line edit in TASK_MODELS, and nothing
 * else in the codebase names a model. There is no eval set yet, which is exactly
 * why that one line should not move on a hunch.
 */

export const MODEL_IDS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type ModelSpec = {
  /** USD per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  /**
   * `output_config.effort` errors on Haiku 4.5, so it must not be sent there. This
   * flag is the only place that difference is encoded. Haiku 5.5 and Sonnet 5.5
   * both accept it.
   */
  supportsEffort: boolean;
  /**
   * Sonnet 5.5 and Haiku 5.5 take adaptive thinking; Haiku 4.5 has no adaptive
   * mode and would need a `budget_tokens` budget instead.
   */
  supportsAdaptiveThinking: boolean;
};

/**
 * Which edition of the price table below computed a given `cost_usd`.
 *
 * Stored on every ledger row. Prices change, and `cost_usd` is what we were billed at the time —
 * so it must never be recomputed from the token counts later. When these numbers are updated, bump
 * this, and a row's cost stays explainable.
 */
export const MODEL_PRICE_BASIS = '2026-10-11';

export const MODELS: Record<ModelId, ModelSpec> = {
  /**
   * In the registry so the eval harness can price an Opus arm with the same `costUsd` the
   * ledger uses — an eval whose cost column comes from a second price table is comparing
   * quality against a fiction.
   *
   * It is a registry row and nothing more: `TASK_MODELS` still sends generation to Sonnet 5.5.
   * Moving it needs the eval's numbers, which is the point of having them.
   *
   * Thinking cannot be disabled here at any effort level, and effort defaults to `medium`
   * rather than `high` — so `TASK_EFFORT` must be read as load-bearing for this model, not as
   * a hint. Prices verified against the published table for the basis above.
   */
  'claude-opus-5-5': {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
  },
  'claude-sonnet-5-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
  },
  /**
   * Released 2026-10-07. Capabilities verified against the Models API: effort at every level,
   * adaptive thinking and structured output all supported, 1M in / 128k out.
   *
   * **The prices below are UNVERIFIED** — the Models API does not publish pricing, and the
   * "under-100k prompt tier" they came from implies a second, higher tier this table cannot
   * express. `cost_usd` and therefore the spend cap are computed from these, so check them
   * against the invoice before moving a task here.
   */
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
  },
  'claude-haiku-4-5': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    supportsEffort: false,
    supportsAdaptiveThinking: false,
  },
};

export const AI_TASKS = [
  'generate_meal',
  'cook_question',
  'parse_capture',
  'parse_pantry_voice',
  'library_search',
  'upgrade_list',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * Current assignment. Every judgement call starts on Sonnet 5.5 per the brief; the two
 * on Haiku are the ones the brief assigns there from the start, because they are
 * mechanical mappings onto a canonical list rather than judgement calls.
 *
 * Haiku 5.5 is in the registry above and is a reasonable candidate for several of these —
 * but moving one needs eval evidence, not a hunch, and the eval set does not exist yet.
 */
export const TASK_MODELS: Record<AiTask, ModelId> = {
  generate_meal: 'claude-opus-5-5',
  cook_question: 'claude-sonnet-5-5',
  parse_capture: 'claude-sonnet-5-5',
  parse_pantry_voice: 'claude-haiku-4-5',
  library_search: 'claude-sonnet-5-5',
  upgrade_list: 'claude-haiku-4-5',
};

/**
 * Effort per task. Recipe generation runs at `medium`: the brief's cost target is
 * about $5 per active user per month, and Sonnet 5.5's levels were recalibrated, so
 * this is a number to re-tune against the eval set rather than assume.
 */
export const TASK_EFFORT: Record<AiTask, Effort> = {
  generate_meal: 'medium',
  cook_question: 'low',
  parse_capture: 'medium',
  parse_pantry_voice: 'low',
  library_search: 'low',
  upgrade_list: 'low',
};

/**
 * The output ceiling for one recipe generation, thinking included.
 *
 * Shared so the handler and the eval harness cannot disagree: the harness used to carry its own
 * copy of 8,000, and a sweep graded against a ceiling production does not have measures nothing.
 * Measured 2026-10-13 (Opus 5.5, medium): recipes use 5,500 to 7,700 tokens including thinking, so
 * 8,000 truncated the longest request mid-string. This is a ceiling, not a spend: only the tokens
 * a generation actually writes are billed.
 */
export const GENERATE_MEAL_MAX_TOKENS = 12_000;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/**
 * USD for one call. Logged per call so the brief's per-user spend cap is enforceable.
 *
 * Every token count is sanitised first. This is the money boundary, and the numbers come from a
 * provider response: a missing field yields `undefined`, which arithmetic turns into `NaN`, and a
 * single `NaN` row makes `sum(cost_usd)` NaN for the whole month — which silently disables the
 * spend cap, because `NaN >= 10` is false. A negative count would *credit* the user. Neither can
 * be allowed to leave this function.
 */
export function costUsd(model: ModelId, usage: TokenUsage): number {
  const spec = MODELS[model];
  const perToken = (tokens: number, perMTok: number) => (countable(tokens) / 1_000_000) * perMTok;

  return (
    perToken(usage.inputTokens, spec.inputPerMTok) +
    perToken(usage.outputTokens, spec.outputPerMTok) +
    perToken(usage.cacheWriteTokens, spec.cacheWritePerMTok) +
    perToken(usage.cacheReadTokens, spec.cacheReadPerMTok)
  );
}

/** A token count we are willing to charge for: finite and not negative. */
export function countable(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
}
