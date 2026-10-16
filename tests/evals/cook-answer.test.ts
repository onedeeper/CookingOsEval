import {
  answered,
  COOK_METRICS,
  gradeCookAnswer,
  noRestating,
  pantryUpdatedWhenTold,
  patchApplied,
  patchValid,
  patchedWhenNeeded,
  rethinkWhenNeeded,
  turnEfficiency,
  type CookExpectation,
  type CookOutcome,
} from '../../evals/graders/cook-answer.ts';

/**
 * The deterministic half of the cook-question rubric.
 *
 * This is where a cheaper model is most likely to come apart, and the failures are structural
 * rather than a matter of taste: it answers in prose when it should have patched the recipe, it
 * emits a patch that does not validate, it emits one that validates and matches nothing, or it
 * burns all four turns getting there. All of that is checkable without a judge — and it is the
 * half that decides whether the cheap model is usable at all, whatever the judge says about tone.
 */

/** A substitution question answered the right way: one valid patch that changed a line. */
function goodOutcome(overrides: Partial<CookOutcome> = {}): CookOutcome {
  return {
    answer: 'Use the chickpeas instead — same pan, same timing, a bit more bite.',
    patches: [
      {
        operations: [
          {
            op: 'replace_ingredient',
            target_name_en: 'rice',
            replacement: { name_en: 'chickpeas', name_nl: 'kikkererwten', amount: 400, unit: 'g', dish: 'carb', aisle: 'dry_goods' },
          },
        ],
      },
    ],
    pantryUpdates: [],
    rethinks: [],
    changedLines: 3,
    turns: 2,
    unknownTools: [],
    ...overrides,
  };
}

const expectPatch: CookExpectation = { patch: true, pantry: false, rethink: false };
const expectTalkOnly: CookExpectation = { patch: false, pantry: false, rethink: false };
const expectRethink: CookExpectation = { patch: false, pantry: false, rethink: true };

describe('a cook question answered the right way', () => {
  it('passes every check', () => {
    const failed = gradeCookAnswer(goodOutcome(), expectPatch).filter((result) => !result.pass);

    expect(failed.map((result) => `${result.metric}: ${result.reason}`)).toEqual([]);
  });

  it('reports one result per declared metric', () => {
    const results = gradeCookAnswer(goodOutcome(), expectPatch);

    expect(results.map((result) => result.metric).sort()).toEqual([...COOK_METRICS].sort());
  });
});

describe('patchedWhenNeeded', () => {
  it('fails when the answer should have changed the recipe and only talked', () => {
    const result = patchedWhenNeeded(goodOutcome({ patches: [], changedLines: 0 }), expectPatch);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('patch');
  });

  it('fails when it patched a recipe that did not need changing', () => {
    // The opposite failure, and the more annoying one: the cook asked why they salt early and
    // their ingredient list moved under them.
    expect(patchedWhenNeeded(goodOutcome(), expectTalkOnly).pass).toBe(false);
  });

  it('passes a plain answer to a plain question', () => {
    expect(
      patchedWhenNeeded(goodOutcome({ patches: [], changedLines: 0 }), expectTalkOnly).pass,
    ).toBe(true);
  });
});

describe('patchValid', () => {
  it('fails when a patch does not validate against RecipePatchSchema', () => {
    // Our own handler would hand this back as an is_error tool_result. It still counts against
    // the arm: a model that needs a correction round trip costs a cook time at the hob.
    const outcome = goodOutcome({ patches: [{ operations: [{ op: 'make_it_nicer' }] }] });

    const result = patchValid(outcome, expectPatch);
    expect(result.pass).toBe(false);
  });

  it('fails when an operation is missing a field the schema requires', () => {
    const outcome = goodOutcome({
      patches: [{ operations: [{ op: 'set_servings' }] }],
    });

    expect(patchValid(outcome, expectPatch).pass).toBe(false);
  });

  it('scores the share of patches that validated', () => {
    const outcome = goodOutcome({
      patches: [...goodOutcome().patches, { operations: [{ op: 'nonsense' }] }],
    });

    expect(patchValid(outcome, expectPatch).score).toBeCloseTo(0.5, 6);
  });

  it('passes vacuously when there were no patches to validate', () => {
    expect(patchValid(goodOutcome({ patches: [] }), expectTalkOnly).pass).toBe(true);
  });
});

describe('patchApplied', () => {
  it('fails on a patch that validated but matched nothing in the recipe', () => {
    // A valid patch addressing an ingredient name that is not in the recipe applies cleanly to
    // nothing. The cook is told it was updated and sees no change.
    const result = patchApplied(goodOutcome({ changedLines: 0 }), expectPatch);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('nothing');
  });

  it('passes vacuously when no patch was expected or sent', () => {
    expect(patchApplied(goodOutcome({ patches: [], changedLines: 0 }), expectTalkOnly).pass).toBe(true);
  });
});

describe('pantryUpdatedWhenTold', () => {
  it('fails when the cook said they had run out and the pantry was not touched', () => {
    const outcome = goodOutcome({ pantryUpdates: [] });

    expect(pantryUpdatedWhenTold(outcome, { patch: true, pantry: true, rethink: false }).pass).toBe(false);
  });

  it('fails when the pantry update does not validate', () => {
    const outcome = goodOutcome({ pantryUpdates: [{ changes: [{ name_en: 'rice' }] }] });

    expect(pantryUpdatedWhenTold(outcome, { patch: true, pantry: true, rethink: false }).pass).toBe(false);
  });

  it('fails when it marked something out that the cook never mentioned', () => {
    // Not a harmless extra: a spurious `out` puts an ingredient the cook has onto the next
    // shopping list, and the database is meant to be the authority on what they have.
    const outcome = goodOutcome({ pantryUpdates: [{ changes: [{ name_en: 'rice', level: 'out' }] }] });

    expect(pantryUpdatedWhenTold(outcome, expectPatch).pass).toBe(false);
  });

  it('passes when it recorded what they ran out of', () => {
    const outcome = goodOutcome({ pantryUpdates: [{ changes: [{ name_en: 'rice', level: 'out' }] }] });

    expect(pantryUpdatedWhenTold(outcome, { patch: true, pantry: true, rethink: false }).pass).toBe(true);
  });
});

/**
 * Reported by a cook on 2026-10-13: in review, "They seem to be out of sweet paprika powder. Can we
 * do something else instead?" got a pantry write and "skip it, or use tomato purée" — and no
 * rethink, so the recipe on screen still listed the paprika. The sweep ran every case locked, so
 * the review state had no coverage at all and nothing could have caught it.
 */
describe('rethinkWhenNeeded', () => {
  const rethinkCall = { constraint: 'no paprika', reason: 'The spice is in every dish, so the meal needs rebuilding.' };

  it('fails when the cook asked for something different in review and no rethink was offered', () => {
    const outcome = goodOutcome({ patches: [], answer: 'Skip it, or use the tomato puree.' });

    const result = rethinkWhenNeeded(outcome, expectRethink);

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no rethink/i);
  });

  it('passes when a rethink was offered for a change the cook asked for', () => {
    const outcome = goodOutcome({ patches: [], rethinks: [rethinkCall] });

    expect(rethinkWhenNeeded(outcome, expectRethink).pass).toBe(true);
  });

  it('fails when a rethink was offered for a question that only needed answering', () => {
    // The other direction matters as much: a cook asking how long dinner takes who is handed a
    // "rebuild the meal?" button has been told their question was a complaint.
    const outcome = goodOutcome({ patches: [], rethinks: [rethinkCall] });

    expect(rethinkWhenNeeded(outcome, expectTalkOnly).pass).toBe(false);
  });

  it('fails when the rethink it offered does not carry a usable constraint', () => {
    const outcome = goodOutcome({ patches: [], rethinks: [{ reason: 'No constraint given.' }] });

    expect(rethinkWhenNeeded(outcome, expectRethink).pass).toBe(false);
  });

  it('passes a plain answer when no rethink was wanted', () => {
    const outcome = goodOutcome({ patches: [], rethinks: [] });

    expect(rethinkWhenNeeded(outcome, expectTalkOnly).pass).toBe(true);
  });
});

describe('noRestating', () => {
  it('fails when the answer reads the whole recipe back at a cook holding a pan', () => {
    const outcome = goodOutcome({
      answer: [
        'Here is the full recipe again:',
        '1. Get the rice on with 600 ml water.',
        '2. Sear the chicken until browned.',
        '3. Add the chilli and toss through.',
        '4. Blister the beans with the garlic.',
      ].join('\n'),
    });

    const result = noRestating(outcome, expectPatch);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('step');
  });

  it('fails on an answer that is simply far too long to hear mid-cook', () => {
    expect(noRestating(goodOutcome({ answer: 'word '.repeat(200) }), expectPatch).pass).toBe(false);
  });

  it('passes a short spoken answer that happens to mention one step', () => {
    const outcome = goodOutcome({ answer: 'Go back to step 2 and give it another minute.' });

    expect(noRestating(outcome, expectPatch).pass).toBe(true);
  });
});

describe('answered', () => {
  it('fails when the loop ran out of turns and left nothing to say', () => {
    expect(answered(goodOutcome({ answer: '   ' }), expectPatch).pass).toBe(false);
  });

  it('fails when the model reached for a tool that does not exist', () => {
    const result = answered(goodOutcome({ unknownTools: ['search_the_internet'] }), expectPatch);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain('search_the_internet');
  });
});

describe('turnEfficiency', () => {
  it('scores a single-turn answer above one that needed the whole loop', () => {
    const quick = turnEfficiency(goodOutcome({ turns: 1 }), expectTalkOnly);
    const laboured = turnEfficiency(goodOutcome({ turns: 4 }), expectTalkOnly);

    expect(quick.score).toBeGreaterThan(laboured.score);
  });

  it('fails when the loop hit its ceiling, which means it never closed the answer itself', () => {
    expect(turnEfficiency(goodOutcome({ turns: 4 }), expectPatch).pass).toBe(false);
  });

  it('passes the two turns a patch legitimately needs: the call, then the closing word', () => {
    expect(turnEfficiency(goodOutcome({ turns: 2 }), expectPatch).pass).toBe(true);
  });
});
