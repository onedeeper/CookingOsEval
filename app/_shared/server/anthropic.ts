import Anthropic from '@anthropic-ai/sdk';
import type { SystemBlock } from '../prompt/john.ts';
import type { CallFacts } from './usage.ts';
import {
  type AiTask,
  countable,
  type Effort,
  MODELS,
  type ModelId,
  TASK_EFFORT,
  TASK_MODELS,
  type TokenUsage,
} from './models.ts';

/**
 * The one place that knows how to talk to the Claude API.
 *
 * Per-model request differences live here and nowhere else, because they are the
 * part of this integration most likely to change under us:
 *
 *   - Sonnet 5.5 and Haiku 5.5 take adaptive thinking and `output_config.effort`.
 *   - Haiku 4.5 rejects `effort` outright, so it must not be sent.
 *   - Forced tool use (`tool_choice: any` / `tool`) is rejected by Sonnet 5.5, so
 *     structured output is how we guarantee a Recipe JSON comes back, and tools are
 *     always offered with `auto`. (Haiku 5.5 accepts a forced choice, but we keep
 *     `auto` so thinking can still run before a tool call.)
 */

export function createAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/** Effort, only where the model accepts it. */
export function effortFor(model: ModelId, task: AiTask): { effort?: Effort } {
  return MODELS[model].supportsEffort ? { effort: TASK_EFFORT[task] } : {};
}

/** Adaptive thinking, only where the model has it. */
export function thinkingFor(model: ModelId): { thinking?: Anthropic.ThinkingConfigParam } {
  return MODELS[model].supportsAdaptiveThinking ? { thinking: { type: 'adaptive' } } : {};
}

export function modelFor(task: AiTask): ModelId {
  return TASK_MODELS[task];
}

/**
 * Turns prompt blocks into a system parameter, putting a cache breakpoint at the end
 * of each stable run. Caching is a prefix match, so `buildSystemBlocks` orders the
 * blocks stable-first and this function just marks the boundaries.
 */
export function toSystemParam(blocks: readonly SystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((block) => ({
    type: 'text',
    text: block.text,
    ...(block.cacheable ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

/**
 * Normalises SDK usage into the shape the cost table and the spend log want.
 *
 * Every field is defaulted, not just the cache ones: a response missing `input_tokens` would
 * otherwise put `undefined` into the cost arithmetic and write a `NaN` cost, which disables the
 * monthly spend cap for the rest of the month.
 */
export function readUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: countable(usage.input_tokens),
    outputTokens: countable(usage.output_tokens),
    cacheWriteTokens: countable(usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: countable(usage.cache_read_input_tokens ?? 0),
  };
}

/**
 * What the ledger needs to know about a finished call, read out of the SDK's shape.
 *
 * Here rather than in `usage.ts` because this is the file that knows the provider's API —
 * `usage.ts` stays provider-agnostic so a call billed by the minute can report its own cost.
 */
export function callFactsOf(message: Anthropic.Message): CallFacts {
  return {
    usage: readUsage(message.usage),
    providerMessageId: message.id,
    stopReason: message.stop_reason,
  };
}

/** Concatenated text of an assistant turn, for display and for the chat log. */
export function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function toolUsesOf(content: readonly Anthropic.ContentBlock[]): Anthropic.ToolUseBlock[] {
  return content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
}

/**
 * Raised when the model declines a request. Checked before reading content, because
 * a refusal arrives as HTTP 200 with `stop_reason: 'refusal'`.
 */
export class ModelRefusedError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined this request${category === null ? '' : ` (${category})`}.`);
    this.name = 'ModelRefusedError';
  }
}

/** Raised when a turn stopped before the model had finished saying what it meant to. */
export class ModelDidNotFinishError extends Error {
  constructor(readonly stopReason: string) {
    super(`The model stopped before finishing (${stopReason}).`);
    this.name = 'ModelDidNotFinishError';
  }
}

/**
 * Stop reasons that mean the turn is incomplete rather than done.
 *
 * These matter as much as a refusal, and are easier to miss. A turn that stopped on `max_tokens`
 * can carry a half-written `tool_use` whose JSON input is truncated — and in the cook-question loop
 * that block would be stored into the replayable history and its empty text shown to the cook as
 * John's answer.
 */
const INCOMPLETE_STOP_REASONS: ReadonlySet<string> = new Set([
  'max_tokens',
  'model_context_window_exceeded',
]);

export function assertNotRefused(message: Pick<Anthropic.Message, 'stop_reason' | 'stop_details'>): void {
  const stopReason = message.stop_reason;

  if (stopReason !== null && INCOMPLETE_STOP_REASONS.has(stopReason)) {
    throw new ModelDidNotFinishError(stopReason);
  }

  if (stopReason !== 'refusal') return;

  const details = message.stop_details;
  const category = details !== null && details !== undefined && 'category' in details ? details.category : null;
  throw new ModelRefusedError(category ?? null);
}
