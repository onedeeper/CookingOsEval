import { z } from 'zod';
import type { Profile } from '../../app/_shared/domain/profile.ts';
import { profileCardToText, renderProfileCard } from '../../app/_shared/prompt/profile-card.ts';
import { type MetricResult, metricResult } from './metric.ts';

/**
 * The half of the rubric no amount of code can check: whether the food is any good.
 *
 * The deterministic graders prove a recipe is coherent — every ingredient used, the timings
 * possible, the equipment owned. A recipe can satisfy all of that and still be a bad dinner, or
 * teach its one technique so thinly that the cook learns nothing. That is a judgement, so it
 * takes a model.
 *
 * Two things keep this honest:
 *
 *   - **The judge is at least as capable as the best arm it grades.** A judge weaker than the
 *     thing under test rewards whatever it happens to understand, which quietly caps the sweep
 *     at the judge's own ceiling. See `JUDGE_MODEL`.
 *   - **It scores against named criteria, one at a time, with a reason.** A single "is this
 *     good, 1-10" is a number nobody can act on and that drifts between runs. A criterion the
 *     judge has to answer in words is one you can argue with — and when the judge disagrees with
 *     your taste, the rubric is what you edit.
 *
 * The scale is 1-5 and `LOWEST_PASSING_SCORE` is the bar. Both are deliberately coarse: finer
 * gradations from a judge are noise dressed as precision.
 */

/**
 * The judge model, named here rather than in `_shared/server/models.ts`.
 *
 * `models.ts` is the only place *production* names a model, and that rule holds. This is the eval
 * harness, whose entire job is naming models and comparing them — a sweep that could not name an
 * arm would have nothing to measure. The price table stays single-source: `costUsd` in `models.ts`
 * is what prices this call, which is why Opus 5.5 was added to that registry.
 *
 * Opus 5.5 at `xhigh`: the best arm under test is Opus 5.5 at `high`, and a judge must not be the
 * weaker party. Thinking cannot be disabled on this model, so effort is the only depth control.
 */
export const JUDGE_MODEL = 'claude-opus-5-5' as const;
export const JUDGE_EFFORT = 'xhigh' as const;

export const LOWEST_SCORE = 1;
export const HIGHEST_SCORE = 5;
/** 3 of 5: good enough to put in front of a cook, not good enough to be pleased about. */
export const LOWEST_PASSING_SCORE = 3;

export const JudgeVerdictSchema = z.object({
  scores: z
    .array(
      z.object({
        key: z.string().min(1).describe('The criterion key, copied exactly from the rubric.'),
        score: z.int().min(LOWEST_SCORE).max(HIGHEST_SCORE),
        reason: z.string().min(1).describe('One or two sentences. Name the line that decided it.'),
      }),
    )
    .min(1),
  overall: z.string().min(1).describe('One sentence a human can read in the dashboard.'),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export type Criterion = {
  /** Stable across runs: it becomes a dashboard column, so renaming one starts a new series. */
  key: string;
  /** The question the judge answers. Written as a question so a 1 and a 5 mean opposite things. */
  question: string;
};

export type Rubric = {
  name: string;
  /** What the judge is looking at, so the prompt can say "the recipe" or "John's answer". */
  subjectLabel: string;
  criteria: Criterion[];
};

export const MEAL_RUBRIC: Rubric = {
  name: 'meal',
  subjectLabel: 'recipe',
  criteria: [
    {
      key: 'cookable',
      question:
        'Would a home cook following these steps exactly end up with good food? Look for a method that ' +
        'actually works, cues they can act on, and nothing that would burn, undercook or sit cold.',
    },
    {
      key: 'teaches',
      question:
        'Does the one stretch technique genuinely teach something, with a reason the cook can carry to ' +
        'another dish — rather than being named and dropped?',
    },
    {
      key: 'fidelity',
      question:
        'Is this what was asked for, for this cook? Weigh the request itself against the profile card: ' +
        'diet, dislikes, equipment, time and shops.',
    },
    {
      key: 'buyable',
      question:
        'Could the cook buy every ingredient at the shops on their card, and are the Dutch names the ones ' +
        'actually printed on the shelf?',
    },
    {
      key: 'timing_realistic',
      question:
        'Is the stated total honest for a home cook working alone with the hobs they have, including prep ' +
        'and the time dishes spend waiting on each other?',
    },
  ],
};

export const COOK_RUBRIC: Rubric = {
  name: 'cook_answer',
  subjectLabel: "answer John gave",
  criteria: [
    {
      key: 'answers_it',
      question: 'Does it actually answer the question that was asked, rather than something adjacent?',
    },
    {
      key: 'correct',
      question:
        'Is the cooking advice right? A confident wrong substitution or timing is the worst outcome here.',
    },
    {
      key: 'spoken',
      question:
        'Does it read as something said to someone with their hands full — short, no preamble, no markdown, ' +
        'no reading the recipe back?',
    },
  ],
};

export type JudgeSubject = {
  /** The recipe JSON, or John's answer. Whatever is being judged, as text. */
  subject: string;
  /** What the cook originally asked for. Half the rubric is unanswerable without it. */
  request: string;
  profile: Profile;
};

/**
 * The judge's user turn.
 *
 * The profile card goes in verbatim — the same text John was given — because "is this right for
 * this cook" cannot be scored against a profile the judge cannot see. Using the same renderer
 * means the judge and the cook are reading the same card, not two descriptions of one.
 */
export function buildJudgePrompt(rubric: Rubric, { subject, request, profile }: JudgeSubject): string {
  return [
    `You are grading one ${rubric.subjectLabel} produced by a cooking assistant, against the card`,
    'of the cook it was produced for.',
    '',
    'The cook they were cooking for:',
    '',
    profileCardToText(renderProfileCard(profile)),
    '',
    'What the cook asked for:',
    '',
    request,
    '',
    `The ${rubric.subjectLabel} to grade:`,
    '',
    subject,
    '',
    `Score each criterion from ${LOWEST_SCORE} to ${HIGHEST_SCORE}, where ${LOWEST_SCORE} is`,
    `unusable, ${LOWEST_PASSING_SCORE} is good enough to put in front of this cook, and`,
    `${HIGHEST_SCORE} is what you would expect from a chef who knows them. Use the whole scale:`,
    'a rubric where everything scores 4 measures nothing.',
    '',
    'The criteria, by key:',
    '',
    ...rubric.criteria.map((criterion) => `- ${criterion.key}: ${criterion.question}`),
    '',
    'Return one entry per criterion, with the key copied exactly. In each reason, name the specific',
    `line or amount that decided the score. Do not suggest a better ${rubric.subjectLabel} and do not`,
    `rewrite it — you are measuring this one, not improving it.`,
  ].join('\n');
}

/**
 * The verdict as dashboard columns.
 *
 * Prefixed `judge_` so a judge criterion and a deterministic metric can never land in the same
 * column — they are different kinds of evidence and averaging them silently would be the worst of
 * both.
 */
export function judgeToMetrics(verdict: JudgeVerdict): MetricResult[] {
  return verdict.scores.map((entry) =>
    metricResult(
      `judge_${entry.key}`,
      entry.score >= LOWEST_PASSING_SCORE,
      `${entry.score}/${HIGHEST_SCORE} — ${entry.reason}`,
      (entry.score - LOWEST_SCORE) / (HIGHEST_SCORE - LOWEST_SCORE),
    ),
  );
}

/**
 * The judge's verdict as dashboard columns, plus a column for the judge itself.
 *
 * `judge_verdict` is always present and it is the instrument's own health check. A run once
 * reported a clean pass on a cell where the judge had returned nothing that validated: every
 * deterministic check was green, the judged criteria were simply absent, and the cell read as a
 * success. A broken instrument reporting as a result is the one failure an eval harness must never
 * hide — so a missing or incomplete verdict fails the cell, loudly, in its own column.
 */
export function judgeOutcomeMetrics(
  verdict: JudgeVerdict | null,
  rubric: Rubric,
  /** Why it came back empty, when it did. `max_tokens` here means the budget was too small. */
  diagnosis?: string,
): MetricResult[] {
  if (verdict === null) {
    return [
      metricResult(
        'judge_verdict',
        false,
        'The judge returned nothing that validated, so this cell is unjudged. Not a verdict on the ' +
          `arm.${diagnosis === undefined ? '' : ` (${diagnosis})`}`,
      ),
    ];
  }

  const scored = new Set(verdict.scores.map((entry) => entry.key));
  const missing = rubric.criteria.filter((criterion) => !scored.has(criterion.key));

  return [
    ...judgeToMetrics(verdict),
    metricResult(
      'judge_verdict',
      missing.length === 0,
      missing.length === 0
        ? `Scored all ${rubric.criteria.length} criteria.`
        : `The judge skipped: ${missing.map((criterion) => criterion.key).join(', ')}.`,
    ),
  ];
}
