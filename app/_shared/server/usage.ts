import type { SupabaseClient } from '@supabase/supabase-js';
import { costUsd, countable, MODEL_PRICE_BASIS, type AiTask, type TokenUsage } from './models.ts';

/**
 * Recording what a paid call cost, whatever it did.
 *
 * One rule: a provider call is never made without a ledger row. It used to be logged by hand on
 * the success path of each handler, which meant a timeout or a 500 left no trace at all — so the
 * ledger under-counted exactly when things were going wrong, and because the spend cap is the sum
 * of this table, a bad day quietly raised the cap.
 *
 * The write therefore happens in a `finally`, and the only way to make a call is to go through
 * this function. Same trick as `contextFrom` uses for authentication: make the thing that must not
 * be forgotten the thing you cannot avoid calling.
 */

/** How a paid call ended, matching the `ai_call_status` enum. */
export type CallOutcome = 'ok' | 'refused' | 'incomplete' | 'error';

/**
 * Stop reasons that mean the turn did not finish, as opposed to a refusal.
 *
 * Kept next to the outcome mapping rather than in `anthropic.ts`, because this is the ledger's
 * reading of a turn; `assertNotRefused` is the handler's, and the two are allowed to differ — a
 * refused call still cost money and still gets a row.
 */
const INCOMPLETE_STOP_REASONS: ReadonlySet<string> = new Set([
  'max_tokens',
  'model_context_window_exceeded',
]);

export function outcomeOf(stopReason: string | null): CallOutcome {
  if (stopReason === 'refusal') return 'refused';
  if (stopReason !== null && INCOMPLETE_STOP_REASONS.has(stopReason)) return 'incomplete';
  return 'ok';
}

/** What a provider billed when it does not bill by token. */
export type BilledUnits = {
  units: number;
  /** What the units are, e.g. `audio_seconds`. Recorded so the cost can be re-derived. */
  unit: string;
  costUsd: number;
};

/** What the call reports back about itself, for the ledger. */
export type CallFacts = {
  usage: TokenUsage;
  /** The provider's own id, which is what makes this table reconcilable against the invoice. */
  providerMessageId: string | null;
  stopReason: string | null;
  /** Set instead of relying on `usage` where the provider meters something else. */
  billed?: BilledUnits;
};

export type CallContext = {
  userId: string;
  task: AiTask | 'transcribe';
  model: string;
  /** Defaults to anthropic, the only token-billed provider here. */
  provider?: string;
  /** Groups the calls one user action made; asking John a question can take three. */
  requestId: string;
};

/**
 * Runs a paid call, timing it and writing exactly one ledger row either way.
 *
 * `markFirstToken` is for a streamed call: time to first token is the number a cook actually
 * feels, and it is nothing like the total. Generation measured 1.5s to first token against 28-48s
 * end to end, so a ledger with only the total would say the wait was 40 seconds when what the
 * cook saw was a second and a half.
 */
export async function recordModelCall<T>(
  admin: SupabaseClient,
  context: CallContext,
  run: (markFirstToken: () => void) => Promise<{ result: T; facts: CallFacts }>,
): Promise<T> {
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;

  // Only the first report counts: a stream handler calling this per delta must not keep moving
  // the number forward.
  const markFirstToken = () => {
    firstTokenAt ??= Date.now();
  };

  let facts: CallFacts | null = null;
  let failure: unknown = null;

  try {
    const outcome = await run(markFirstToken);
    facts = outcome.facts;
    return outcome.result;
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    await writeRow(admin, {
      context,
      facts,
      failure,
      durationMs: Date.now() - startedAt,
      ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    });
  }
}

const NO_TOKENS: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

async function writeRow(
  admin: SupabaseClient,
  entry: {
    context: CallContext;
    facts: CallFacts | null;
    failure: unknown;
    durationMs: number;
    ttftMs: number | null;
  },
): Promise<void> {
  const { context, facts, failure, durationMs, ttftMs } = entry;

  // A call that threw tells us nothing about its tokens, so they are zero rather than guessed.
  // The row is still worth having: it is the only record that the call happened at all.
  const usage = facts?.usage ?? NO_TOKENS;
  const billed = facts?.billed;

  const row = {
    user_id: context.userId,
    task: context.task,
    model: context.model,
    provider: context.provider ?? 'anthropic',
    request_id: context.requestId,
    status: failure !== null ? ('error' as const) : outcomeOf(facts?.stopReason ?? null),
    error_code: failure === null ? null : errorCodeFor(failure),
    duration_ms: durationMs,
    ttft_ms: ttftMs,
    provider_message_id: facts?.providerMessageId ?? null,
    // Sanitised here as well as in `costUsd`, because these are the columns the reports read
    // and `int not null` will reject a NaN outright — losing the whole row, not just a number.
    input_tokens: countable(usage.inputTokens),
    output_tokens: countable(usage.outputTokens),
    cache_write_tokens: countable(usage.cacheWriteTokens),
    cache_read_tokens: countable(usage.cacheReadTokens),
    billed_units: billed?.units ?? null,
    billed_unit: billed?.unit ?? null,
    cost_usd: billed?.costUsd ?? priceFor(context.model, usage),
    price_basis: MODEL_PRICE_BASIS,
  };

  const { error } = await admin.from('ai_usage').insert(row);

  if (error !== null) {
    // Never thrown. Losing a ledger row under-counts the cap, which is bad; losing a recipe the
    // cook already waited half a minute for is worse.
    console.error('ai_usage insert failed', {
      task: context.task,
      status: row.status,
      message: error.message,
    });
  }
}

/**
 * Prices a token-billed call, or returns 0 for a model the price table does not know.
 *
 * A provider billed by something other than tokens passes its own cost in `billed`, so reaching
 * here with an unknown model means a new model id was deployed without a price — which must not
 * write a NaN into the column the spend cap sums.
 */
function priceFor(model: string, usage: TokenUsage): number {
  const priced = costUsd(model as Parameters<typeof costUsd>[0], usage);
  return Number.isFinite(priced) ? priced : 0;
}

/**
 * A short, greppable name for a failure. Never a stack trace, and never a message: those carry
 * hosts, ids and prompt fragments, and this column is read in a dashboard.
 */
function errorCodeFor(failure: unknown): string {
  if (typeof failure !== 'object' || failure === null) return 'unknown';

  const name = 'name' in failure && typeof failure.name === 'string' ? failure.name : 'Error';
  const status = 'status' in failure && typeof failure.status === 'number' ? failure.status : null;

  return (status === null ? name : `${name}:${status}`).slice(0, 59);
}
