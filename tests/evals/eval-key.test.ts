import { requireAnthropicKey } from '../../evals/lib/env-local.ts';

/**
 * The eval harness must spend from its OWN Anthropic key.
 *
 * On 2026-10-16 a 196-cell sweep exhausted the account's credit balance and took generation, cook
 * questions and transcription down for every user of the live app. Neither `MONTHLY_CAP_USD` nor
 * `GLOBAL_MONTHLY_CAP_USD` can prevent that: both count only calls recorded through
 * `recordModelCall`, and the harness calls Anthropic directly.
 *
 * So the separation is a second key with its own spend limit set in the Anthropic console. The
 * part that has to be enforced here is that there is **no fallback** to `ANTHROPIC_API_KEY`. A
 * fallback would look like it worked and silently put the evals back on the app's balance the
 * first time someone restored that variable for `functions:serve` — which is the same failure
 * wearing a different hat.
 */
describe('the eval harness key', () => {
  /**
   * The lookup is injected rather than read from disk, because the real
   * `secretFromEnvLocal` falls through to `.env` — so a test that only cleared
   * `process.env` passed or failed depending on whether the developer running it happened to have
   * a key on that machine. The assertions below are the same either way.
   */
  const only = (present: Record<string, string>) => (name: string) => present[name] ?? null;

  it('uses the eval-only key', () => {
    const lookup = only({
      EVAL_ANTHROPIC_API_KEY: 'sk-ant-eval-key',
      ANTHROPIC_API_KEY: 'sk-ant-app-key',
    });

    expect(requireAnthropicKey(lookup)).toBe('sk-ant-eval-key');
  });

  it('refuses to fall back to the app key, and says why', () => {
    const lookup = only({ ANTHROPIC_API_KEY: 'sk-ant-app-key' });

    expect(() => requireAnthropicKey(lookup)).toThrow(/EVAL_ANTHROPIC_API_KEY/);
    // The reason matters: whoever hits this needs to know it is deliberate, not a missing default.
    expect(() => requireAnthropicKey(lookup)).toThrow(/balance|spend limit|outage|app/i);
  });

  it('never reads the app key, even when the eval key is absent', () => {
    const asked: string[] = [];
    const lookup = (name: string) => {
      asked.push(name);
      return null;
    };

    expect(() => requireAnthropicKey(lookup)).toThrow();
    expect(asked).toEqual(['EVAL_ANTHROPIC_API_KEY']);
  });
});
