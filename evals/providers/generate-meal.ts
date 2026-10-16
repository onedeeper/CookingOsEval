import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { matchesMealShape, ModelRecipeSchema } from '../../app/_shared/domain/recipe.ts';
import { buildRequestPrompt, buildSystemBlocks } from '../../app/_shared/prompt/john.ts';
import {
  assertNotRefused,
  createAnthropic,
  readUsage,
  thinkingFor,
  toSystemParam,
} from '../../app/_shared/server/anthropic.ts';
import {
  costUsd,
  GENERATE_MEAL_MAX_TOKENS,
  MODELS,
  type ModelId,
} from '../../app/_shared/server/models.ts';
import { evalKitchen } from '../fixtures/kitchen.ts';
import { requireAnthropicKey } from '../lib/env-local.ts';
import { type ArmConfig, type ProviderResponse, armLabel, failureResponse } from '../lib/provider.ts';

/**
 * One arm of the generation sweep: `generate-meal`, run for real.
 *
 * This deliberately calls the production path rather than reimplementing it — `buildSystemBlocks`,
 * `buildRequestPrompt`, `ModelRecipeSchema` and `costUsd` are all imported from `_shared`. That is
 * the whole reason this is a custom provider instead of promptfoo's built-in `anthropic:` one: a
 * YAML copy of the prompt would drift from the shipped prompt within a week, and the eval would
 * quietly start measuring something nobody runs.
 *
 * Only two things differ from the handler, and both are deliberate:
 *
 *   - **The model and effort come from the arm, not `TASK_MODELS`.** That is the sweep. Whether
 *     effort may be sent at all still comes from `MODELS[model].supportsEffort`, so the one
 *     per-model API difference is not re-encoded here.
 *   - **Nothing is streamed to a client and nothing is saved.** It still uses `messages.stream()`,
 *     because a few thousand output tokens on a non-streaming request risks an HTTP timeout, and
 *     because time-to-first-token is the number a cook actually feels — it is reported per cell.
 */

type Config = ArmConfig;

export default class GenerateMealProvider {
  private readonly config: Config;
  /** Named `providerId`, not `label`: promptfoo sets its own `label` on a provider. */
  private readonly providerId: string;

  constructor(options: { id?: string; config?: Partial<Config> } = {}) {
    const model = (options.config?.model ?? 'claude-sonnet-5-5') as ModelId;
    this.config = { model, effort: options.config?.effort ?? 'medium' };
    this.providerId = options.id ?? `generate-meal:${armLabel(this.config)}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const { model, effort } = this.config;
    const kitchen = evalKitchen();
    const requestText = prompt.trim();

    const anthropic = createAnthropic(requireAnthropicKey());
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;

    try {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: GENERATE_MEAL_MAX_TOKENS,
        system: toSystemParam(buildSystemBlocks(kitchen)),
        messages: [{ role: 'user', content: buildRequestPrompt(requestText, kitchen) }],
        output_config: {
          // Effort only where the model takes it: Haiku 4.5 errors outright on the field.
          ...(MODELS[model].supportsEffort ? { effort } : {}),
          format: zodOutputFormat(ModelRecipeSchema),
        },
        ...thinkingFor(model),
      });

      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type !== 'text_delta') continue;
        firstTokenAt ??= Date.now();
      }

      const message = await stream.finalMessage();
      const usage = readUsage(message.usage);
      const finishedAt = Date.now();

      // The ledger's own arithmetic, so a cell's dollar figure and an invoice line agree.
      const cost = costUsd(model, usage);

      assertNotRefused(message);

      const recipe = message.parsed_output;
      if (recipe === null || recipe === undefined) {
        // Structured output failed validation. A real defect for this arm, not a harness error —
        // so it is a scored failure that still reports what it cost.
        return failureResponse('Structured output did not validate against ModelRecipeSchema.', {
          cost,
          usage,
          arm: this.config,
          durationMs: finishedAt - startedAt,
          ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        });
      }

      return {
        output: recipe,
        tokenUsage: {
          prompt: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
          completion: usage.outputTokens,
          total: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens,
        },
        cost,
        metadata: {
          model,
          effort: MODELS[model].supportsEffort ? effort : 'n/a',
          duration_ms: finishedAt - startedAt,
          // Measured at ~1.5s against a 28-48s generation, so a ledger with only the total
          // would describe a wait nobody had.
          ttft_ms: firstTokenAt === null ? null : firstTokenAt - startedAt,
          cache_read_tokens: usage.cacheReadTokens,
          stop_reason: message.stop_reason,
          provider_message_id: message.id,
          // Checked in the handler right after the model answers; surfaced here so the dashboard
          // shows it rather than hiding it inside a grader.
          meal_shape_ok: matchesMealShape(
            kitchen.profile.meal_shape,
            recipe.dishes.map((dish) => dish.slot),
          ),
          request: requestText,
        },
      };
    } catch (error) {
      return failureResponse(error instanceof Error ? error.message : String(error), {
        arm: this.config,
        durationMs: Date.now() - startedAt,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      });
    }
  }
}
