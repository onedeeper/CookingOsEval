import type Anthropic from '@anthropic-ai/sdk';
import { PantryUpdateSchema } from '../../app/_shared/domain/pantry-update.ts';
import { applyRecipePatch, RecipePatchSchema } from '../../app/_shared/domain/recipe-patch.ts';
import {
  type RecipeStatus,
  RethinkSuggestionSchema,
} from '../../app/_shared/domain/recipe-lifecycle.ts';
import { makeIngredientResolver } from '../../app/_shared/domain/recipe-resolve.ts';
import type { Recipe } from '../../app/_shared/domain/recipe.ts';
import {
  buildCookQuestionPrompt,
  buildKitchenContext,
  buildSystemBlocks,
} from '../../app/_shared/prompt/john.ts';
import {
  assertNotRefused,
  createAnthropic,
  readUsage,
  textOf,
  thinkingFor,
  toSystemParam,
  toolUsesOf,
} from '../../app/_shared/server/anthropic.ts';
import { costUsd, MODELS, type ModelId, type TokenUsage } from '../../app/_shared/server/models.ts';
import { cookToolsFor, PATCH_RECIPE, SUGGEST_RETHINK, UPDATE_PANTRY } from '../../app/cook-question/tools.ts';
import type { CookOutcome } from '../graders/cook-answer.ts';
import { evalKitchen } from '../fixtures/kitchen.ts';
import { evalRecipe } from '../fixtures/recipes.ts';
import { requireAnthropicKey } from '../lib/env-local.ts';
import { type ArmConfig, type ProviderResponse, armLabel, failureResponse } from '../lib/provider.ts';

/**
 * One arm of the cook-question sweep: a question asked from the bottom sheet, for real.
 *
 * The loop mirrors `cook-question/index.ts` — same system blocks, same question framing (from
 * `buildCookQuestionPrompt`, which was moved into `_shared` precisely so this file cannot hold a
 * drifting copy), same tools generated from the same zod schemas, same four-turn ceiling, same
 * `auto` tool choice. What it does not do is touch the database: there is no row to update and no
 * pantry to write, so tool calls are validated and applied in memory and the *attempt* is what
 * gets recorded.
 *
 * That difference is the point. The grader needs the raw tool inputs — whether they validate is
 * one of the things being measured — and it needs to know whether a patch that validated actually
 * matched anything in the recipe. A handler that swallowed a bad patch into an `is_error` round
 * trip would hide both.
 */

/** The handler's own ceiling. A question should need a call, a result, and a closing answer. */
const MAX_TURNS = 4;
const MAX_TOKENS = 4000;

export default class CookQuestionProvider {
  private readonly config: ArmConfig;
  /** Named `providerId`, not `label`: promptfoo sets its own `label` on a provider. */
  private readonly providerId: string;

  constructor(options: { id?: string; config?: Partial<ArmConfig> } = {}) {
    const model = (options.config?.model ?? 'claude-sonnet-5-5') as ModelId;
    this.config = { model, effort: options.config?.effort ?? 'low' };
    this.providerId = options.id ?? `cook-question:${armLabel(this.config)}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string, context?: { vars?: Record<string, unknown> }): Promise<ProviderResponse> {
    const { model, effort } = this.config;
    const question = prompt.trim();
    const status = statusFrom(context?.vars);
    const kitchen = evalKitchen();

    const anthropic = createAnthropic(requireAnthropicKey());
    const resolveIngredient = makeIngredientResolver({ ingredients: [], pantry: new Map() });

    let recipe: Recipe = evalRecipe();
    const outcome: CookOutcome = {
      answer: '',
      patches: [],
      pantryUpdates: [],
      rethinks: [],
      changedLines: 0,
      turns: 0,
      unknownTools: [],
    };

    // Built once and never rebuilt: a thinking block binds the system prompt, so regenerating it
    // between turns with a patched recipe in it would invalidate every block in the conversation.
    const systemParam = toSystemParam(buildSystemBlocks(kitchen));
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        // Most cases are mid-cook questions, which is the locked state: shopping done, edits by
        // patch. A case can set `status: generated` to ask in review instead. The status has to
        // travel with the prompt AND the tool list, or the sweep grades John against a setup the
        // handler would never have given him.
        content: buildCookQuestionPrompt({
          question,
          recipe,
          kitchenContext: buildKitchenContext(kitchen),
          status,
        }),
      },
    ];

    const totals: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
    let cost = 0;
    const startedAt = Date.now();

    try {
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const message = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: systemParam,
          messages,
          tools: cookToolsFor(status),
          // `auto` is the only option: Sonnet 5.5 and Opus 5.5 both reject a forced tool_choice.
          tool_choice: { type: 'auto' },
          output_config: MODELS[model].supportsEffort ? { effort } : {},
          ...thinkingFor(model),
        });

        outcome.turns = turn + 1;

        const usage = readUsage(message.usage);
        totals.inputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        totals.cacheWriteTokens += usage.cacheWriteTokens;
        totals.cacheReadTokens += usage.cacheReadTokens;
        // Summed per turn rather than from the totals: one question can take three calls, and the
        // price table is per call.
        cost += costUsd(model, usage);

        assertNotRefused(message);

        outcome.answer = textOf(message.content) || outcome.answer;
        // Replayed unchanged and append-only, thinking blocks included.
        messages.push({ role: 'assistant', content: message.content });

        const toolUses = toolUsesOf(message.content);
        if (toolUses.length === 0) break;

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          results.push(this.runTool(toolUse, outcome, recipe, resolveIngredient, (updated) => {
            recipe = updated;
          }));
        }

        messages.push({ role: 'user', content: results });
      }

      return {
        output: outcome,
        tokenUsage: {
          prompt: totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
          completion: totals.outputTokens,
          total:
            totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens,
        },
        cost,
        metadata: {
          model,
          effort: MODELS[model].supportsEffort ? effort : 'n/a',
          duration_ms: Date.now() - startedAt,
          turns: outcome.turns,
          cache_read_tokens: totals.cacheReadTokens,
          answer: outcome.answer,
          status,
          patches: outcome.patches.length,
          rethinks: outcome.rethinks.length,
          changed_lines: outcome.changedLines,
          question,
        },
      };
    } catch (error) {
      return failureResponse(error instanceof Error ? error.message : String(error), {
        arm: this.config,
        cost,
        usage: totals,
        durationMs: Date.now() - startedAt,
        ttftMs: null,
      });
    }
  }

  /**
   * Runs one tool call, recording what was attempted before deciding whether it was any good.
   *
   * The recording happens first and unconditionally: a patch that fails the schema still tells you
   * something about the arm, and it is exactly what a cheaper model gets wrong.
   */
  private runTool(
    toolUse: Anthropic.ToolUseBlock,
    outcome: CookOutcome,
    recipe: Recipe,
    resolveIngredient: ReturnType<typeof makeIngredientResolver>,
    commit: (updated: Recipe) => void,
  ): Anthropic.ToolResultBlockParam {
    if (toolUse.name === PATCH_RECIPE) {
      outcome.patches.push(toolUse.input);

      const parsed = RecipePatchSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        return errorResult(toolUse.id, `That patch did not validate: ${parsed.error.message}`);
      }

      const applied = applyRecipePatch(recipe, parsed.data, resolveIngredient);
      commit(applied.recipe);
      outcome.changedLines += applied.changes.length;

      return okResult(
        toolUse.id,
        applied.changeLog.length === 0
          ? 'Nothing matched, so the recipe is unchanged. Check the names and step numbers.'
          : `Applied: ${applied.changeLog.join('; ')}.`,
      );
    }

    if (toolUse.name === UPDATE_PANTRY) {
      outcome.pantryUpdates.push(toolUse.input);

      const parsed = PantryUpdateSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        return errorResult(toolUse.id, `That pantry update did not validate: ${parsed.error.message}`);
      }

      // Nothing to write to, so the result reports what the handler's would: the names it took.
      return okResult(toolUse.id, `Updated ${parsed.data.changes.length} item(s).`);
    }

    if (toolUse.name === SUGGEST_RETHINK) {
      outcome.rethinks.push(toolUse.input);

      const parsed = RethinkSuggestionSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        return errorResult(toolUse.id, `That rethink did not validate: ${parsed.error.message}`);
      }

      // The same words the handler returns, so the model's closing turn is graded on what it
      // would really have been told.
      return okResult(
        toolUse.id,
        'Offered the cook a one-tap rethink against that constraint. Nothing has changed ' +
          'yet — they decide. Tell them briefly why, and stop there.',
      );
    }

    outcome.unknownTools.push(toolUse.name);
    return errorResult(toolUse.id, `Unknown tool: ${toolUse.name}`);
  }
}

/** `locked` unless a case says it is asked in review; anything else is a typo in the YAML. */
function statusFrom(vars: Record<string, unknown> | undefined): RecipeStatus {
  const declared = vars?.status;
  if (declared === undefined || declared === 'locked') return 'locked';
  if (declared === 'generated') return 'generated';
  throw new Error(`Unknown recipe status in a case: ${String(declared)}. Use "generated" or "locked".`);
}

function okResult(toolUseId: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content };
}

function errorResult(toolUseId: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content, is_error: true };
}
