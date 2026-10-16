# The eval harness: technical guide

*The plain-English overview is the [README at the repo root](../README.md). This is the working
guide: commands, costs, and how to extend it.*

What it is for: deciding model and effort with numbers instead of a hunch. `TASK_MODELS` in
`app/_shared/server/models.ts` is a one-line change, and the comment there says that line should not
move without evidence. This is where the evidence comes from.

## Running one

```bash
npm run eval          # both suites, one after the other: 20 + 27 = 47 cells
npm run eval:meal     # generation only
npm run eval:cook     # cook questions only
npm run eval:view     # the dashboard, on localhost
```

It makes real model calls and **costs real money**. Measured per cell:

| arm | provider | judge |
| --- | --- | --- |
| generation, opus-5-5/medium | $0.143 | $0.135 |
| generation, sonnet-5-5/medium | $0.053 | $0.121 |
| cook question, sonnet-5-5/low | $0.018 | $0.029 |

A full 47-cell run is roughly **$6-6.50**, of which about $3.50 is the judge — Opus 5.5 at
`xhigh` runs on every cell, so it costs the same whatever arm it grades. Narrowing with
`--filter-providers` cuts provider and judge cost together.

**`npm run eval` used to pass both configs to ONE promptfoo run.** promptfoo merges multiple `-c`
files into a single matrix instead of running them in turn, so it was every provider against
every test with both prompts: 7 x 14 x 2 = **196 cells**, most of them nonsense (a cook-question
arm answering a generation case). On 2026-10-16 that spent **$13.53**, ran the Anthropic account
out of credit before finishing, and returned no usable data. The script now runs the two suites as
separate invocations, and a test in the main app repo keeps it that way. Narrow it while you are iterating:

```bash
# one arm
npm run eval:meal -- --filter-providers "opus-5-5/high"

# one case (regex against the case's `description`)
npm run eval:meal -- --filter-pattern "no oven"

# one cell — about $0.19
npm run eval:meal -- --filter-providers "sonnet-5-5/medium" --filter-pattern "baseline"

# three runs of each cell. Model output varies, so a single run cannot tell a real
# delta from noise. Do this before believing a small difference.
npm run eval:meal -- --repeat 3

# ignore the cache and call the model again
npm run eval:meal -- --no-cache
```

Then `npm run eval:view` and read the grid: one row per case, one column per arm, a cell per run.
Click a cell for the full recipe, every metric, the cost, and time-to-first-token.

Needs **`EVAL_ANTHROPIC_API_KEY`** in `.env` at the repo root (copy `.env.example`) — its own key, not the app's.

There is deliberately **no fallback to `ANTHROPIC_API_KEY`**. A fallback would silently put the
sweeps back on the balance the live app needs the first time someone restored that variable for
`functions:serve`, and that is how 2026-10-16 happened.

The key alone is not the control, though: **Anthropic credit is pooled per organization, so a
second API key does not get a second balance** (measured — a fresh key returned the same "credit
balance is too low"). What bounds the spend is a **monthly spend limit on the workspace the key
belongs to** (Console -> Workspaces -> pick the workspace -> Spend limits, which also sets alert
thresholds). Two constraints that decide the setup: a limit cannot be set on the **Default
Workspace**, so the eval key has to live in a workspace of its own; and a workspace limit can only
be lower than the organization's.

## What it measures

**Generation** (`promptfoo.generate-meal.yaml`) — 5 requests × 4 arms: Sonnet 5.5 at `medium`
(what shipped until this sweep), Sonnet 5.5 at `high`, Opus 5.5 at `medium` (what ships now — the
sweep moved generation here), Opus 5.5 at `high`.

**Cook questions** (`promptfoo.cook-question.yaml`) — 9 questions × 3 arms: Sonnet 5.5 at `low`
(shipped), Haiku 5.5, Haiku 4.5. A different job from generation: a tool-calling loop over a
recipe that already exists. Six are asked mid-cook (locked, edits by `patch_recipe`); three are asked
in review (`status: generated` in the case, where `patch_recipe` is withheld and a change is a
`suggest_rethink`). Until 2026-10-13 every case ran locked, so review had no coverage.

Each cell is scored twice.

**Deterministically** (`graders/`), free and with no variance — the defects a recipe can carry
while still being schema-valid: an ingredient bought and never used, a prep item that was never on
the shopping list, one dish that alone outlasts the meal's stated total, a line labelled with a
role no dish declared, an oven the cook does not own, an appliance the method uses that is not on
the recipe's equipment list. For cook questions: did it patch when it
should have, did the patch validate, did it match anything, did it burn all four turns.

**By a judge** (`graders/judge.ts`), which costs money and catches what structure cannot — whether
the food is actually good, whether the one technique teaches anything, whether 30 minutes is honest.
In an early run it caught a recipe whose stated 30 minutes could not be met once its salting step
was counted on the critical path. No deterministic check can see that.

The judge is **Opus 5.5 at `xhigh`**, which is at least as capable as the best arm it grades. A
judge weaker than the thing under test silently caps the sweep at the judge's own ceiling.

Every cell also carries a `judge_verdict` column. It is the instrument's own health check: if the
judge returns nothing that parses, the cell **fails** rather than quietly reporting the
deterministic scores as a pass. That is not hypothetical — it happened on the first run, when the
judge's `max_tokens` was too small for `xhigh` thinking, and the cell read as a clean pass.

## Costs

promptfoo's cost column is the **arm's own cost** — what you would pay in production, which is what
the sweep compares. The judge is measurement overhead, identical for every cell, so it is reported
in the cell's reason (`[judge +$0.1406]`) rather than folded into the column.

Measured on one cell: Sonnet 5.5 `medium` generation $0.048, ttft 1.17s, 31.8s total. Judge $0.14.

**Eval spend does not go through `ai_usage`** and so does not count against `MONTHLY_CAP_USD`. That
is deliberate — the ledger is per-cook production spend — but it means a run is invisible to the
spend dashboard.

## Extending it

- **A new case**: add an entry to `cases/*.yaml`. Nothing else.
- **A new arm**: add a provider block to the config. If it names a model not in `MODELS`, add it to
  `app/_shared/server/models.ts` first — with real prices, since `costUsd` is what prices the column.
- **A new deterministic metric**: write the failing test in `tests/evals/`, add the check to
  `graders/recipe-coherence.ts` (or `cook-answer.ts`), and add its name to the `*_METRICS` tuple —
  the "one result per declared metric" test fails until you do, so the dashboard cannot lose a
  column silently.
- **A new judged criterion**: add it to `MEAL_RUBRIC` or `COOK_RUBRIC`. Keys are stable identities;
  renaming one starts a new series rather than continuing the old one.
- **A new task** (photo parsing, transcription, library search): a provider in `providers/`, a
  grader, an assert, a config. The graders and `MetricResult` are shared, so a new task is four
  small files rather than a new harness.

## What it does not measure yet, and why

- **Canonical ingredient resolution and the pantry check.** The canonical list lives in the database
  seed, so an eval run resolves nothing and every line comes back `missing`. Consistent across arms,
  so the comparison holds — but `ingredient_id` and `pantry_status` are untested here. See
  `RESOLVES_AGAINST_CANONICAL` in `fixtures/kitchen.ts`.
- **One-off request overrides.** A case asking "cooking for 5 tonight" would fail `servings_match`
  for a recipe that correctly followed the request, because the grader compares against the profile.
  Fixing it means letting a case carry profile overrides.
- **Prompt caching.** Every cell is a cold prefix, so `cache_read_tokens` is 0 and the cost column is
  the uncached worst case. Production costs less.
- **Photo parsing, transcription, library search.** No providers for them yet.

## Two things that will bite

1. **promptfoo cannot import a `.ts` provider by itself.** The npm scripts launch its CLI through
   Node's own type stripping (`--experimental-transform-types`), the same way `npm run dashboard`
   runs. Calling `promptfoo` directly from the shell fails with `Unknown file extension ".ts"`.
2. **Providers use the nested YAML form** (`- file://…: {label, config}`), not `- id: file://…`.
   With the flat form, `--filter-providers` matches nothing for a `file://` provider, so there is no
   way to re-run a single arm. Verified against promptfoo 0.120.19.

promptfoo is pinned to **0.120.19**: 0.124 requires Node ≥ 22.22 and the development machine runs 22.14.
