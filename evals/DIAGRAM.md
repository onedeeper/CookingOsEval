# How the eval harness works, from inputs to outputs

Four diagrams, from the big picture down to how one cell is scored. They render on GitHub and in
VS Code's Markdown preview (Mermaid). The prose in `README.md` explains *why*; these show *what
flows where*.

---

## 1. The big picture

What goes in, what promptfoo does with it, and what comes out.

```mermaid
flowchart LR
    subgraph IN["INPUTS"]
        direction TB
        CMD["npm run eval / eval:meal / eval:cook<br/><i>optional: --filter-providers,<br/>--filter-pattern, --repeat 3</i>"]
        CFG["promptfoo.*.yaml<br/><b>the arms</b>: model + effort"]
        CASES["cases/*.yaml<br/><b>the cases</b>: a request or a question,<br/>plus what a good answer must do"]
        FIX["fixtures/<br/>kitchen.ts: one fixed cook — no oven, 3 hobs<br/>recipes.ts: one fixed recipe to ask about"]
        SHARED["app/_shared<br/><b>the shipped code</b>: prompt, schemas,<br/>tools, price table"]
        KEY["EVAL_ANTHROPIC_API_KEY<br/>from .env<br/><i>the harness's own key — never the app's,<br/>and no fallback to ANTHROPIC_API_KEY</i>"]
    end

    GRID["promptfoo builds the grid<br/><b>every case × every arm = one cell</b><br/>generation: 5 × 4 = 20<br/>cook questions: 9 × 3 = 27"]

    subgraph CELL["FOR EACH CELL"]
        direction TB
        PROV["Provider<br/>runs the real production path<br/>with this arm's model + effort"]
        API[("Anthropic API<br/>the arm's model")]
        ASSERT["Assert<br/>scores the output"]
        JUDGE[("Anthropic API<br/>Opus 5.5 judge, xhigh")]
        PROV <--> API
        PROV -- "output + cost + timings" --> ASSERT
        ASSERT <--> JUDGE
    end

    subgraph OUT["OUTPUTS"]
        direction TB
        ROW["Per cell: pass/fail, score 0–1,<br/>one column per metric,<br/>arm cost, ttft, duration, reason"]
        DASH["npm run eval:view<br/>dashboard grid: rows = cases,<br/>columns = arms"]
        DECIDE["A decision with numbers behind it:<br/>change one line in TASK_MODELS / TASK_EFFORT"]
        ROW --> DASH --> DECIDE
    end

    CMD --> GRID
    CFG --> GRID
    CASES --> GRID
    GRID --> PROV
    FIX --> PROV
    SHARED --> PROV
    KEY --> PROV
    ASSERT --> ROW

    classDef input fill:#e8f0fe,stroke:#4a6fa5,color:#1a1a1a
    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef paid fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    class CMD,CFG,CASES,FIX,SHARED,KEY input
    class GRID,PROV,ASSERT step
    class API,JUDGE paid
    class ROW,DASH,DECIDE output
```

**Key:** blue = inputs · amber = the harness's own steps · red = a paid API call · green = outputs.

Two paid calls per cell: the arm being tested (what the cost column shows) and the judge (measurement
overhead, about $0.14 a cell, shown in the cell's reason). A full run is about $6.50.

---

## 2. Inside one generation cell

`providers/generate-meal.ts` → `asserts/meal.ts`. Input: one line a cook might type. Output: a
recipe and its scores.

```mermaid
flowchart TD
    REQ["Case: the cook's request<br/><i>e.g. 'something quick with what I have'</i>"]
    KIT["fixtures/kitchen.ts<br/>profile, pantry, gear"]
    BUILD["Build the prompt exactly as production does<br/>buildSystemBlocks + buildRequestPrompt"]
    CALL[("messages.stream()<br/>arm's model + effort<br/>output must match ModelRecipeSchema")]
    TIME["Measure as it streams:<br/>time to first token, total time"]
    OK{"Valid recipe<br/>came back?"}
    FAIL["Failed cell: score 0<br/><i>still reports what it cost</i>"]
    RECIPE["Recipe JSON<br/>+ cost, tokens, ttft, meal_shape_ok"]
    DET["Deterministic checks — free, no variance<br/>meal_shape · roles_resolve · ingredients_used<br/>prep_covered · timings_add_up · within_time_budget<br/>servings_match · one_skill_node · cues_present<br/>dutch_names · equipment_respected · equipment_listed"]
    JDG[("Judge: Opus 5.5 at xhigh<br/>MEAL_RUBRIC<br/>cookable · teaches · fidelity<br/>buyable · timing_realistic")]
    MERGE["Combine into one cell result<br/>see diagram 4"]

    REQ --> BUILD
    KIT --> BUILD
    BUILD --> CALL --> TIME --> OK
    OK -- no --> FAIL
    OK -- yes --> RECIPE
    RECIPE --> DET
    RECIPE --> JDG
    DET --> MERGE
    JDG --> MERGE

    classDef input fill:#e8f0fe,stroke:#4a6fa5,color:#1a1a1a
    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef paid fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    class REQ,KIT input
    class BUILD,TIME,OK,DET step
    class CALL,JDG paid
    class RECIPE,MERGE,FAIL output
```

Nothing is saved and nothing is streamed to a phone. Otherwise this is the `generate-meal`
handler's path, imported from `_shared`, so the eval cannot drift from what ships.

---

## 3. Inside one cook-question cell

`providers/cook-question.ts` → `asserts/cook.ts`. Input: a question asked from John's bottom sheet,
about a recipe that already exists. Output: John's answer, every tool call he tried, and scores.

```mermaid
flowchart TD
    Q["Case: the cook's question<br/>+ status: locked (mid-cook) or generated (review)<br/>+ expect_patch / expect_pantry / expect_rethink"]
    REC["fixtures/recipes.ts<br/>the fixed recipe being cooked"]
    KIT["fixtures/kitchen.ts"]
    BUILD["Build the prompt as production does<br/>buildCookQuestionPrompt<br/>tools = cookToolsFor(status)"]
    CALL[("messages.create()<br/>arm's model, tool_choice: auto")]
    TOOLS{"Did John<br/>call a tool?"}
    RUN["Record the attempt FIRST, then run it in memory<br/>patch_recipe → validate, apply to recipe<br/>update_pantry → validate only<br/>suggest_rethink → validate only<br/><i>no database is touched</i>"]
    LIMIT{"Fewer than<br/>4 turns used?"}
    OUTCOME["Cook outcome:<br/>answer text, patches, pantry updates,<br/>rethinks, lines changed, turns used<br/>+ cost summed over every turn"]
    DET["Deterministic checks vs. the case's expectations<br/>answered · patched_when_needed · patch_valid<br/>patch_applied · rethink_when_needed<br/>pantry_when_told · no_restating · turn_efficiency"]
    JDG[("Judge: Opus 5.5 at xhigh<br/>COOK_RUBRIC<br/>answers_it · correct · spoken")]
    MERGE["Combine into one cell result<br/>see diagram 4"]

    Q --> BUILD
    REC --> BUILD
    KIT --> BUILD
    BUILD --> CALL --> TOOLS
    TOOLS -- yes --> RUN --> LIMIT
    LIMIT -- "yes: send tool results back" --> CALL
    LIMIT -- no --> OUTCOME
    TOOLS -- "no: final answer" --> OUTCOME
    OUTCOME --> DET
    OUTCOME --> JDG
    Q -. "expectations" .-> DET
    DET --> MERGE
    JDG --> MERGE

    classDef input fill:#e8f0fe,stroke:#4a6fa5,color:#1a1a1a
    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef paid fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    class Q,REC,KIT input
    class BUILD,TOOLS,RUN,LIMIT,DET step
    class CALL,JDG paid
    class OUTCOME,MERGE output
```

The expectations come from the case, not from what the model did. If they were inferred, any choice
the model made would look correct.

---

## 4. How a cell becomes one score

`asserts/shared.ts`. The same for both suites, which is why every grader returns the same
`MetricResult` shape.

```mermaid
flowchart LR
    PF{"Did the provider<br/>fail?"}
    ZERO["score 0, fail<br/>reason = the error"]
    M1["Deterministic metrics<br/>each: pass, score 0–1, reason"]
    M2["Judge metrics<br/>each: pass, score 0–1, reason"]
    JV["judge_verdict<br/>fails if the judge returned<br/>nothing that parsed"]
    TGR["toGradingResult"]
    PASS["<b>pass</b> = every metric passed"]
    SCORE["<b>score</b> = mean of all metrics<br/><i>ranks the near misses</i>"]
    NAMED["<b>namedScores</b> = one dashboard<br/>column per metric"]
    REASON["<b>reason</b> = which failed and why<br/>+ the judge's cost"]

    PF -- yes --> ZERO
    PF -- no --> M1
    PF -- no --> M2
    M2 --> JV
    M1 --> TGR
    M2 --> TGR
    JV --> TGR
    TGR --> PASS
    TGR --> SCORE
    TGR --> NAMED
    TGR --> REASON

    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    classDef warn fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    class PF,M1,M2,TGR step
    class PASS,SCORE,NAMED,REASON output
    class ZERO,JV warn
```

A cell passes only if **every** metric passes: a recipe that needs an oven the cook doesn't own is
unusable whatever the judge thinks, and a recipe the judge finds bad is unusable however tidy its
structure. The mean score is there so a near miss and a disaster still read differently.

---

## What the diagrams leave out on purpose

- **Canonical ingredient resolution.** The canonical list lives in the database seed, so in an eval
  run every line resolves to nothing. That is the same for every arm, so comparisons hold, but the
  pantry check isn't measured. (`RESOLVES_AGAINST_CANONICAL` in `fixtures/kitchen.ts`.)
- **Prompt caching.** Every cell starts cold, so the cost column is the uncached worst case.
- **The spend ledger.** Eval calls don't go through `recordModelCall`, so they don't count against
  any cook's cap and don't appear on the spend dashboard.
