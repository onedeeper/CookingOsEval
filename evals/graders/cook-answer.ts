import { PantryUpdateSchema } from '../../app/_shared/domain/pantry-update.ts';
import { RethinkSuggestionSchema } from '../../app/_shared/domain/recipe-lifecycle.ts';
import { RecipePatchSchema } from '../../app/_shared/domain/recipe-patch.ts';
import { type MetricResult, metricResult } from './metric.ts';

/**
 * The deterministic half of the cook-question rubric.
 *
 * Asking John something mid-cook has a structural contract underneath the conversation: if the
 * answer changes the recipe it comes back as a `patch_recipe` call, that patch has to validate,
 * and it has to actually match the recipe it is addressing. A model can fail all three while
 * sounding perfectly confident — and this is the half of the sweep that says whether a cheaper
 * model is usable at all, independently of what the judge thinks of its tone.
 *
 * Nothing here calls a model, so it costs nothing and returns the same answer every time.
 */

export const COOK_METRICS = [
  'answered',
  'patched_when_needed',
  'patch_valid',
  'patch_applied',
  'rethink_when_needed',
  'pantry_when_told',
  'no_restating',
  'turn_efficiency',
] as const;
export type CookMetric = (typeof COOK_METRICS)[number];

/**
 * What one run of the cook-question loop did, as the provider observed it.
 *
 * Raw tool inputs rather than parsed ones on purpose: whether they parse is one of the things
 * being measured, so the grader has to see what the model actually sent.
 */
export type CookOutcome = {
  /** The closing text John showed in the sheet. */
  answer: string;
  /** Raw `patch_recipe` inputs, in call order. */
  patches: unknown[];
  /** Raw `update_pantry` inputs, in call order. */
  pantryUpdates: unknown[];
  /** Raw `suggest_rethink` inputs, in call order. */
  rethinks: unknown[];
  /** How many recipe lines `applyRecipePatch` reported as changed, across every patch. */
  changedLines: number;
  /** Model turns the loop took, including the one that closed it. */
  turns: number;
  /** Tools the model asked for that do not exist. */
  unknownTools: string[];
};

/** What this question was written to require. Declared per case, not inferred. */
export type CookExpectation = {
  patch: boolean;
  pantry: boolean;
  /** The cook wants the meal itself different. In review that is a rethink, never a patch. */
  rethink: boolean;
};

type Check = (outcome: CookOutcome, expectation: CookExpectation) => MetricResult;

export function gradeCookAnswer(outcome: CookOutcome, expectation: CookExpectation): MetricResult[] {
  const checks: Check[] = [
    answered,
    patchedWhenNeeded,
    patchValid,
    patchApplied,
    rethinkWhenNeeded,
    pantryUpdatedWhenTold,
    noRestating,
    turnEfficiency,
  ];

  return checks.map((check) => check(outcome, expectation));
}

function result(metric: CookMetric, pass: boolean, reason: string, score?: number): MetricResult {
  return metricResult(metric, pass, reason, score ?? (pass ? 1 : 0));
}

export const answered: Check = (outcome) => {
  if (outcome.unknownTools.length > 0) {
    return result('answered', false, `Reached for tools that do not exist: ${outcome.unknownTools.join(', ')}.`);
  }

  const pass = outcome.answer.trim().length > 0;

  return result(
    'answered',
    pass,
    pass ? 'Closed with an answer.' : 'Left the sheet with nothing in it — the loop ended mid-tool.',
  );
};

/**
 * Patched exactly when the question called for it.
 *
 * Both directions are defects and the second is the easier one to miss: a cook who asked *why*
 * they salt the chicken early, and whose ingredient list silently moved, has lost trust in the
 * recipe in front of them.
 */
export const patchedWhenNeeded: Check = (outcome, expectation) => {
  const patched = outcome.patches.length > 0;

  if (expectation.patch && !patched) {
    return result('patched_when_needed', false, 'Answer changes the recipe but no patch was sent.');
  }
  if (!expectation.patch && patched) {
    return result('patched_when_needed', false, 'Patched the recipe for a question that only needed answering.');
  }

  return result(
    'patched_when_needed',
    true,
    expectation.patch ? 'Sent a patch, as the question needed.' : 'Answered without touching the recipe.',
  );
};

/**
 * Every patch has to survive `RecipePatchSchema` — the same parse the handler runs.
 *
 * A failure is recoverable in production (the handler returns an `is_error` tool_result the model
 * can correct from) but it is not free: it costs another turn, which the cook spends standing at
 * a hob. So it is scored rather than excused.
 */
export const patchValid: Check = (outcome) => {
  if (outcome.patches.length === 0) {
    return result('patch_valid', true, 'No patches to validate.');
  }

  const failures = outcome.patches
    .map((patch, index) => ({ index, parsed: RecipePatchSchema.safeParse(patch) }))
    .filter((entry) => !entry.parsed.success);

  const share = 1 - failures.length / outcome.patches.length;
  const pass = failures.length === 0;

  return result(
    'patch_valid',
    pass,
    pass
      ? `All ${outcome.patches.length} patch(es) validated.`
      : `${failures.length} of ${outcome.patches.length} patch(es) failed the schema: ` +
          failures.map((entry) => `#${entry.index + 1}`).join(', '),
    share,
  );
};

/**
 * A patch that validated still has to have hit something.
 *
 * `applyRecipePatch` skips an operation whose target it cannot find, so a well-formed patch
 * addressing an ingredient name the recipe does not use applies cleanly to nothing. The cook sees
 * the "Updated" toast and no change on screen, which is worse than being told it could not be done.
 */
export const patchApplied: Check = (outcome, expectation) => {
  if (!expectation.patch || outcome.patches.length === 0) {
    return result('patch_applied', true, 'No patch was expected.');
  }

  const pass = outcome.changedLines > 0;

  return result(
    'patch_applied',
    pass,
    pass
      ? `Changed ${outcome.changedLines} line(s).`
      : 'The patch validated and then matched nothing — the recipe is unchanged.',
  );
};

/**
 * Offered a rethink exactly when the cook asked for the meal to be different.
 *
 * This is the review state's counterpart of `patchedWhenNeeded`. Before the lock `patch_recipe` is
 * withheld, so the only way a change reaches the recipe is a rethink — and a model that answers a
 * change request with advice ("skip it, or use tomato purée") leaves the recipe on screen exactly as
 * it was. Both directions are scored: a rethink button under a question about timing tells the cook
 * their question was a complaint.
 */
export const rethinkWhenNeeded: Check = (outcome, expectation) => {
  const offered = outcome.rethinks.length > 0;

  if (expectation.rethink && !offered) {
    return result('rethink_when_needed', false, 'The cook asked for a different meal and no rethink was offered.');
  }
  if (!expectation.rethink && offered) {
    return result('rethink_when_needed', false, 'Offered a rethink for a question that only needed answering.');
  }
  if (!expectation.rethink) {
    return result('rethink_when_needed', true, 'Answered without offering to rebuild the meal.');
  }

  const invalid = outcome.rethinks.filter((rethink) => !RethinkSuggestionSchema.safeParse(rethink).success);
  const pass = invalid.length === 0;

  return result(
    'rethink_when_needed',
    pass,
    pass ? 'Offered a rethink, as the request needed.' : `${invalid.length} rethink(s) failed the schema.`,
    1 - invalid.length / outcome.rethinks.length,
  );
};

export const pantryUpdatedWhenTold: Check = (outcome, expectation) => {
  const updated = outcome.pantryUpdates.length > 0;

  if (!expectation.pantry) {
    return result(
      'pantry_when_told',
      !updated,
      updated
        ? 'Wrote to the pantry without being told anything about it.'
        : 'Left the pantry alone, as it should.',
    );
  }

  if (!updated) {
    return result('pantry_when_told', false, 'The cook said what they had run out of and it was not recorded.');
  }

  const invalid = outcome.pantryUpdates.filter((update) => !PantryUpdateSchema.safeParse(update).success);
  const pass = invalid.length === 0;

  return result(
    'pantry_when_told',
    pass,
    pass ? 'Recorded what they ran out of.' : `${invalid.length} pantry update(s) failed the schema.`,
    1 - invalid.length / outcome.pantryUpdates.length,
  );
};

/**
 * Short, and not the recipe read back.
 *
 * The prompt is explicit — "they are standing at a hob with their hands full" and "never restate
 * the whole recipe". Two signals catch it without a judge: a numbered list, which is the shape of
 * a restated method, and sheer length. The thresholds are generous so that only a genuine wall of
 * text trips them.
 */
const MAX_ANSWER_WORDS = 120;
const RESTATED_STEP_COUNT = 3;
const NUMBERED_LINE = /(?:^|\n)\s*\d+[.)]\s/g;

export const noRestating: Check = (outcome) => {
  const words = outcome.answer.trim().split(/\s+/).filter((word) => word.length > 0).length;
  const numbered = outcome.answer.match(NUMBERED_LINE)?.length ?? 0;

  const problems: string[] = [];
  if (numbered >= RESTATED_STEP_COUNT) problems.push(`reads ${numbered} numbered steps back`);
  if (words > MAX_ANSWER_WORDS) problems.push(`${words} words, too long to hear mid-cook`);

  const pass = problems.length === 0;

  return result('no_restating', pass, pass ? `${words} words, no restated method.` : problems.join('; '), pass ? 1 : 0);
};

/**
 * How many turns the answer took.
 *
 * The handler allows four. Hitting that ceiling means the loop ran out before the model closed
 * its own answer, so the cook got a fallback line rather than a reply — a failure mode a cheaper
 * model is far more likely to reach, and one that costs several calls on the way.
 */
const MAX_TURNS = 4;

export const turnEfficiency: Check = (outcome) => {
  const pass = outcome.turns > 0 && outcome.turns < MAX_TURNS;

  return result(
    'turn_efficiency',
    pass,
    pass
      ? `Answered in ${outcome.turns} turn(s).`
      : `Used all ${MAX_TURNS} turns, so the loop closed the answer instead of the model.`,
    outcome.turns > 0 ? 1 / outcome.turns : 0,
  );
};
