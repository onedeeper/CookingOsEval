import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads a secret out of `.env` at the repo root.
 *
 * Deliberately not a dotenv dependency: parsing `KEY=value` is a handful of lines.
 */

/** Resolved from this file rather than the cwd: promptfoo runs providers from its own directory. */
function envLocalPath(): string {
  // `__dirname` is undefined under ESM, which is how promptfoo loads these modules.
  const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../.env');
}

export function secretFromEnvLocal(name: string): string | null {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;

  let contents: string;
  try {
    contents = readFileSync(envLocalPath(), 'utf8');
  } catch {
    return null;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const separator = trimmed.indexOf('=');
    if (trimmed.slice(0, separator).trim() !== name) continue;

    const value = trimmed.slice(separator + 1).trim();
    return value === '' ? null : value;
  }

  return null;
}

/** The variable the harness spends from. Deliberately not the one the app uses. */
export const EVAL_KEY_NAME = 'EVAL_ANTHROPIC_API_KEY';

/**
 * The harness's own key, or a readable failure.
 *
 * **There is deliberately no fallback to `ANTHROPIC_API_KEY`.** The evals and the live app used to
 * draw on one credit balance, and on 2026-10-16 a 196-cell sweep exhausted it — taking generation,
 * cook questions and transcription down for every user. Neither `MONTHLY_CAP_USD` nor
 * `GLOBAL_MONTHLY_CAP_USD` can stop that: both count only calls recorded through
 * `recordModelCall`, and this harness calls Anthropic directly, so it is invisible to the ledger.
 *
 * The separation is a second key with its own spend limit set in the Anthropic console. A fallback
 * would undo it silently the first time someone restored `ANTHROPIC_API_KEY` for
 * `functions:serve`: the sweep would run, look fine, and be spending the app's balance again. So
 * the absence of that fallback is the control, and `tests/evals/eval-key.test.ts` pins it.
 */
export function requireAnthropicKey(lookup: (name: string) => string | null = secretFromEnvLocal): string {
  const key = lookup(EVAL_KEY_NAME);
  if (key === null) {
    throw new Error(
      `No ${EVAL_KEY_NAME}. The eval harness spends from its own key, with its own spend limit, ` +
        'so a sweep cannot drain the balance the live app needs and cause an outage. It will NOT ' +
        'fall back to ANTHROPIC_API_KEY. Put an evals-only key in .env as ' +
        `${EVAL_KEY_NAME}, or export it.`,
    );
  }
  return key;
}
