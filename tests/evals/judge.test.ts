import {
  buildJudgePrompt,
  judgeOutcomeMetrics,
  COOK_RUBRIC,
  JudgeVerdictSchema,
  judgeToMetrics,
  LOWEST_PASSING_SCORE,
  MEAL_RUBRIC,
} from '../../evals/graders/judge.ts';
import { goodRecipe, kitchenContext } from './recipe-fixture.ts';

/**
 * The judge's pure parts: the rubric it is handed and the arithmetic that turns its verdict into
 * dashboard columns.
 *
 * The call itself is not tested here — it costs money and lives with the providers. What is
 * tested is everything that can be wrong without spending anything: a criterion missing from the
 * prompt (so the judge silently never scores it), a subject the judge cannot see, or a 1-5 score
 * mapped onto the wrong side of the pass line.
 */

describe('buildJudgePrompt', () => {
  it('names every criterion of the rubric it was given', () => {
    const prompt = buildJudgePrompt(MEAL_RUBRIC, {
      subject: JSON.stringify(goodRecipe()),
      request: 'Something with chicken and a green veg, quick, no oven.',
      profile: kitchenContext().profile,
    });

    for (const criterion of MEAL_RUBRIC.criteria) {
      expect(prompt).toContain(criterion.key);
      expect(prompt).toContain(criterion.question);
    }
  });

  it('puts the subject and the original request in front of the judge', () => {
    const prompt = buildJudgePrompt(MEAL_RUBRIC, {
      subject: JSON.stringify(goodRecipe()),
      request: 'Something with chicken and a green veg, quick, no oven.',
      profile: kitchenContext().profile,
    });

    expect(prompt).toContain('Chilli chicken with greens and rice');
    expect(prompt).toContain('no oven');
  });

  it('includes the profile card, because half the rubric is "right for this cook"', () => {
    const prompt = buildJudgePrompt(MEAL_RUBRIC, {
      subject: '{}',
      request: 'anything',
      profile: kitchenContext().profile,
    });

    // The equipment line is the one that decides whether a roasted dish is a defect.
    expect(prompt.toLowerCase()).toContain('microwave');
  });

  it('states the scale, so a verdict of 3 means the same thing on every run', () => {
    const prompt = buildJudgePrompt(COOK_RUBRIC, {
      subject: 'Use the chickpeas instead.',
      request: 'Can I swap the rice?',
      profile: kitchenContext().profile,
    });

    expect(prompt).toContain('1');
    expect(prompt).toContain('5');
  });

  it('tells the judge not to rewrite the thing it is judging', () => {
    const prompt = buildJudgePrompt(MEAL_RUBRIC, {
      subject: '{}',
      request: 'anything',
      profile: kitchenContext().profile,
    });

    expect(prompt.toLowerCase()).toContain('do not');
  });
});

describe('the two rubrics', () => {
  it('score different things, because a recipe and a mid-cook answer are not alike', () => {
    const mealKeys = MEAL_RUBRIC.criteria.map((criterion) => criterion.key);
    const cookKeys = COOK_RUBRIC.criteria.map((criterion) => criterion.key);

    expect(mealKeys).not.toEqual(cookKeys);
  });

  it('give every criterion a unique key, or the dashboard loses a column', () => {
    for (const rubric of [MEAL_RUBRIC, COOK_RUBRIC]) {
      const keys = rubric.criteria.map((criterion) => criterion.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('judgeToMetrics', () => {
  const verdict = {
    scores: [
      { key: 'cookable', score: 5, reason: 'Sound method, honest cues.' },
      { key: 'teaches', score: 3, reason: 'One technique, thinly explained.' },
      { key: 'fidelity', score: 1, reason: 'Ignored the no-oven constraint.' },
    ],
    overall: 'Cookable but not what was asked for.',
  };

  it('prefixes every metric so judge columns never collide with the deterministic ones', () => {
    const metrics = judgeToMetrics(JudgeVerdictSchema.parse(verdict));

    expect(metrics.map((metric) => metric.metric)).toEqual([
      'judge_cookable',
      'judge_teaches',
      'judge_fidelity',
    ]);
  });

  it('maps the 1-5 scale onto 0-1, with 1 scoring zero and 5 scoring one', () => {
    const metrics = judgeToMetrics(JudgeVerdictSchema.parse(verdict));

    expect(metrics[0]?.score).toBeCloseTo(1, 6);
    expect(metrics[1]?.score).toBeCloseTo(0.5, 6);
    expect(metrics[2]?.score).toBeCloseTo(0, 6);
  });

  it(`passes at ${LOWEST_PASSING_SCORE} and fails below it`, () => {
    const metrics = judgeToMetrics(JudgeVerdictSchema.parse(verdict));

    expect(metrics[0]?.pass).toBe(true);
    expect(metrics[1]?.pass).toBe(true);
    expect(metrics[2]?.pass).toBe(false);
  });

  it("carries the judge's reason through, because a score with no reason teaches nothing", () => {
    const metrics = judgeToMetrics(JudgeVerdictSchema.parse(verdict));

    expect(metrics[2]?.reason).toContain('no-oven');
  });
});

describe('JudgeVerdictSchema', () => {
  it('rejects a score outside the scale rather than letting it skew the average', () => {
    const parsed = JudgeVerdictSchema.safeParse({
      scores: [{ key: 'cookable', score: 9, reason: 'Great.' }],
      overall: 'Fine.',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects a verdict with no scores at all', () => {
    expect(JudgeVerdictSchema.safeParse({ scores: [], overall: 'Fine.' }).success).toBe(false);
  });
});

describe('judgeOutcomeMetrics', () => {
  const full = {
    scores: MEAL_RUBRIC.criteria.map((criterion) => ({
      key: criterion.key,
      score: 4,
      reason: 'Fine.',
    })),
    overall: 'Good.',
  };

  it('always reports a judge_verdict column, so a cell cannot be silently unjudged', () => {
    const metrics = judgeOutcomeMetrics(JudgeVerdictSchema.parse(full), MEAL_RUBRIC);

    expect(metrics.map((metric) => metric.metric)).toContain('judge_verdict');
  });

  it('FAILS the cell when the judge returned nothing that validated', () => {
    // The defect this pins: a run where every deterministic check passed and the judge produced
    // no verdict reported as a pass. That is a broken instrument reading as a result, and it is
    // the one failure an eval harness must never hide.
    const metrics = judgeOutcomeMetrics(null, MEAL_RUBRIC);

    const verdict = metrics.find((metric) => metric.metric === 'judge_verdict');
    expect(verdict?.pass).toBe(false);
    expect(metrics.every((metric) => metric.pass)).toBe(false);
  });

  it('fails the verdict column when the judge skipped a criterion', () => {
    const partial = {
      scores: [{ key: MEAL_RUBRIC.criteria[0]!.key, score: 4, reason: 'Fine.' }],
      overall: 'Good.',
    };

    const metrics = judgeOutcomeMetrics(JudgeVerdictSchema.parse(partial), MEAL_RUBRIC);
    const verdict = metrics.find((metric) => metric.metric === 'judge_verdict');

    expect(verdict?.pass).toBe(false);
    expect(verdict?.reason).toContain(MEAL_RUBRIC.criteria[1]!.key);
  });

  it('passes the verdict column when every criterion was scored', () => {
    const metrics = judgeOutcomeMetrics(JudgeVerdictSchema.parse(full), MEAL_RUBRIC);
    const verdict = metrics.find((metric) => metric.metric === 'judge_verdict');

    expect(verdict?.pass).toBe(true);
    expect(metrics).toHaveLength(MEAL_RUBRIC.criteria.length + 1);
  });
});
