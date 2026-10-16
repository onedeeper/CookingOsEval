# How the test bench works, step by step

Four pictures, from the big picture down to how one test gets its final mark. Each is written to
be followed without any programming background. Under each one, a collapsed **For developers**
table says where each step lives in the code.

**Colour key, used in every diagram:**
🟦 blue = what goes in · 🟧 amber = a step the test bench does itself ·
🟥 red = a call to an AI model, which costs money · 🟩 green = what comes out

---

## 1. The big picture

There are two kinds of test, because John, the app's AI chef, does two different jobs. One is
**writing a meal** from a one-line request. The other is **answering questions while you cook**.
Each AI being compared answers every test, and every answer is marked.

```mermaid
flowchart LR
    subgraph IN["WHAT GOES IN"]
        direction TB
        T1["📝 <b>5 meal requests</b><br/><i>“Something quick, no oven”</i>"]
        T2["❓ <b>9 mid-cook questions</b><br/><i>“I'm out of soy sauce, what now?”</i>"]
        AI["🤖 <b>The AI models to compare</b><br/>4 for meals, 3 for questions"]
        COOK["🏠 <b>One imaginary cook</b><br/>no oven, 3 hobs, a stocked cupboard,<br/>always the same, so it's a fair test"]
    end

    GRID["🔁 <b>Every AI answers every test</b><br/>meals: 5 × 4 = 20 answers<br/>questions: 9 × 3 = 27 answers"]

    subgraph EACH["FOR EACH ANSWER"]
        direction TB
        ASK["👨‍🍳 Ask the AI being tested"]
        MARK["📏 Mark it against the checklist"]
        JUDGE["🧑‍⚖️ Ask the expert AI judge"]
        ASK --> MARK
        ASK --> JUDGE
    end

    subgraph OUT["WHAT COMES OUT"]
        direction TB
        CARD["📊 <b>A scorecard</b><br/>rows = tests, columns = AIs<br/>pass or fail, mark out of 1,<br/>cost, waiting time"]
        DECIDE["✅ <b>A decision</b><br/>which AI the app should use"]
        CARD --> DECIDE
    end

    T1 --> GRID
    T2 --> GRID
    AI --> GRID
    COOK --> EACH
    GRID --> EACH
    EACH --> CARD

    classDef input fill:#e8f0fe,stroke:#4a6fa5,color:#1a1a1a
    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef paid fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    class T1,T2,AI,COOK input
    class GRID,MARK step
    class ASK,JUDGE paid
    class CARD,DECIDE output
```

Each answer costs two AI calls: one for the AI being tested and one for the judge. All 47 answers
together cost about $6.50.

<details>
<summary><b>For developers</b></summary>

| Step | Where it lives |
| --- | --- |
| Meal requests, mid-cook questions | `cases/generate-meal.yaml`, `cases/cook-question.yaml` |
| AIs to compare (model + effort) | the `providers:` list in `promptfoo.*.yaml` |
| The imaginary cook, the recipe asked about | `fixtures/kitchen.ts`, `fixtures/recipes.ts` |
| Every AI × every test | promptfoo builds the grid; `npm run eval:meal` / `eval:cook` |
| Ask the AI being tested | `providers/generate-meal.ts`, `providers/cook-question.ts` |
| Checklist and judge | `graders/`, combined in `asserts/` |
| Scorecard | `npm run eval:view` |
| The key it spends from | `EVAL_ANTHROPIC_API_KEY` in `.env`, never the app's key |

</details>

---

## 2. One meal test, from request to marks

What happens when one AI gets one request, such as *"Something with chicken and a green veg, quick,
no oven."*

```mermaid
flowchart TD
    REQ["📝 <b>The request</b><br/><i>“Something with chicken and a green veg,<br/>quick, no oven.”</i>"]
    KIT["🏠 <b>The imaginary cook</b><br/>their kitchen, cupboard and tastes"]
    BUILD["📋 <b>Put together John's instructions</b><br/>exactly the way the real app does"]
    CALL["🤖 <b>The AI writes a three-dish meal</b><br/>in a fixed recipe format"]
    TIME["⏱️ <b>Stopwatch running</b><br/>how long until it starts answering,<br/>how long until it finishes"]
    OK{"Did a complete,<br/>readable recipe<br/>come back?"}
    FAIL["❌ <b>Test failed, mark 0</b><br/>the cost is still recorded"]
    RECIPE["🍽️ <b>The recipe</b><br/>plus its cost and timings"]
    DET["📏 <b>Checklist: 12 yes/no checks</b><br/>Right dishes for this cook? · Every ingredient used?<br/>Everything prepped was bought? · Timings add up?<br/>Fits the time limit? · Right number of servings?<br/>Teaches exactly one technique? · Salt and heat tips?<br/>Dutch names given? · No oven or missing gadget?<br/>Equipment list complete?"]
    JDG["🧑‍⚖️ <b>Expert judge: 5 questions</b><br/>Could a home cook follow it?<br/>Does the technique really teach something?<br/>Is it what was asked for?<br/>Can it all be bought at the supermarket?<br/>Is the time it claims honest?"]
    MERGE["📊 <b>Combined into one mark</b><br/>see picture 4"]

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

This is the same path the real app takes, except that nothing is saved and nothing is sent to a
phone. Because the test bench uses the app's own code rather than a copy, it can't drift from what
cooks actually get.

<details>
<summary><b>For developers</b></summary>

| Step | Where it lives |
| --- | --- |
| John's instructions | `buildSystemBlocks` + `buildRequestPrompt` in `app/_shared/prompt/john.ts` |
| The fixed recipe format | `ModelRecipeSchema` in `app/_shared/domain/recipe.ts` (structured output) |
| The call and the stopwatch | `messages.stream()` in `providers/generate-meal.ts`: time to first token, total duration |
| The 12 checks | `meal_shape`, `roles_resolve`, `ingredients_used`, `prep_covered`, `timings_add_up`, `within_time_budget`, `servings_match`, `one_skill_node`, `cues_present`, `dutch_names`, `equipment_respected`, `equipment_listed`, in `app/_shared/domain/recipe-coherence.ts` via `graders/recipe-coherence.ts` |
| The 5 judge questions | `MEAL_RUBRIC` in `graders/judge.ts`: `cookable`, `teaches`, `fidelity`, `buyable`, `timing_realistic` (Opus 5.5 at `xhigh`) |

</details>

---

## 3. One mid-cook question, from question to marks

Here John already has a recipe in front of him, and the cook asks something. Some questions only
need words. Others need John to **do** something: change the recipe, note that the cook has run
out of something, or (before cooking has started) offer to rethink the whole meal. Each test says
in advance what the right reply has to do.

```mermaid
flowchart TD
    Q["❓ <b>The question</b><br/><i>“I'm out of soy sauce, what now?”</i><br/>plus what a right answer must do,<br/>e.g. “must change the recipe”"]
    STAGE["📍 <b>When it's asked</b><br/>mid-cook: John may edit the recipe<br/>before cooking: John may only<br/>suggest rethinking the meal"]
    REC["🍽️ <b>The recipe being cooked</b><br/>the same one for every test"]
    BUILD["📋 <b>Put together John's instructions</b><br/>and the actions he's allowed at this stage"]
    CALL["🤖 <b>The AI replies as John</b>"]
    ACT{"Did John try<br/>to take an action?"}
    RUN["✏️ <b>Note the attempt, then try it</b><br/>edit the recipe · update the cupboard ·<br/>suggest a rethink<br/><i>on a practice copy: nothing real changes</i>"]
    LIMIT{"Used fewer than<br/>4 rounds?"}
    OUTCOME["💬 <b>The outcome</b><br/>John's reply, every action he tried,<br/>which recipe lines changed,<br/>the total cost"]
    DET["📏 <b>Checklist: 8 yes/no checks</b><br/>Did he answer? · Edited the recipe when he should?<br/>Was the edit valid? · Did it actually change something?<br/>Suggested a rethink when he should?<br/>Updated the cupboard when told?<br/>Short, without reading the method back?<br/>Didn't use up all his rounds?"]
    JDG["🧑‍⚖️ <b>Expert judge: 3 questions</b><br/>Does it answer what was asked?<br/>Is the cooking advice right?<br/>Does it sound like something said out loud<br/>to someone with their hands full?"]
    MERGE["📊 <b>Combined into one mark</b><br/>see picture 4"]

    Q --> BUILD
    STAGE --> BUILD
    REC --> BUILD
    BUILD --> CALL --> ACT
    ACT -- yes --> RUN --> LIMIT
    LIMIT -- "yes: tell John how it went" --> CALL
    LIMIT -- "no: stop" --> OUTCOME
    ACT -- "no: that's his answer" --> OUTCOME
    OUTCOME --> DET
    OUTCOME --> JDG
    Q -. "what a right answer must do" .-> DET
    DET --> MERGE
    JDG --> MERGE

    classDef input fill:#e8f0fe,stroke:#4a6fa5,color:#1a1a1a
    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef paid fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    class Q,STAGE,REC input
    class BUILD,ACT,RUN,LIMIT,DET step
    class CALL,JDG paid
    class OUTCOME,MERGE output
```

What a right answer must do is written in the test before the AI replies. If it were worked out
afterwards from what the AI did, any reply would look correct.

<details>
<summary><b>For developers</b></summary>

| Step | Where it lives |
| --- | --- |
| Question + expectations | `cases/cook-question.yaml`: `expect_patch`, `expect_pantry`, `expect_rethink`, `status` |
| Instructions + allowed actions | `buildCookQuestionPrompt` in `app/_shared/prompt/john.ts`; `cookToolsFor(status)` in `app/cook-question/tools.ts` |
| The reply | `messages.create()` with `tool_choice: auto`, in `providers/cook-question.ts` |
| The three actions | tools `patch_recipe` (validated and applied in memory), `update_pantry`, `suggest_rethink` (validated only); no database is touched |
| The 8 checks | `answered`, `patched_when_needed`, `patch_valid`, `patch_applied`, `rethink_when_needed`, `pantry_when_told`, `no_restating`, `turn_efficiency`, in `graders/cook-answer.ts` |
| The 3 judge questions | `COOK_RUBRIC` in `graders/judge.ts`: `answers_it`, `correct`, `spoken` |

</details>

---

## 4. How the marks become one result

Both kinds of test end the same way.

```mermaid
flowchart LR
    BROKE{"Did the AI fail<br/>to answer at all?"}
    ZERO["❌ <b>Fail, mark 0</b><br/>with the reason"]
    CHECKS["📏 <b>Checklist marks</b><br/>each one: pass or fail,<br/>and a mark out of 1"]
    JUDGEM["🧑‍⚖️ <b>Judge marks</b><br/>each one: pass or fail,<br/>and a mark out of 1"]
    SILENT["⚠️ <b>Did the judge actually answer?</b><br/>if not, that counts as a fail,<br/>never as a quiet pass"]
    ALL["🔗 <b>Put it all together</b>"]
    PASS["✅ <b>Pass</b> only if every single check passed"]
    SCORE["🔢 <b>Average mark</b><br/>so a near miss and a disaster<br/>don't look the same"]
    COLS["📊 <b>One scorecard column per check</b><br/>so you can see exactly what went wrong"]
    WHY["💬 <b>Why it failed</b>, in words,<br/>plus what the judge cost"]

    BROKE -- yes --> ZERO
    BROKE -- no --> CHECKS
    BROKE -- no --> JUDGEM
    JUDGEM --> SILENT
    CHECKS --> ALL
    JUDGEM --> ALL
    SILENT --> ALL
    ALL --> PASS
    ALL --> SCORE
    ALL --> COLS
    ALL --> WHY

    classDef step fill:#fff4e0,stroke:#b07a1f,color:#1a1a1a
    classDef output fill:#e6f4ea,stroke:#3a7d4a,color:#1a1a1a
    classDef warn fill:#fde8e8,stroke:#b03a3a,color:#1a1a1a
    class BROKE,CHECKS,JUDGEM,ALL step
    class PASS,SCORE,COLS,WHY output
    class ZERO,SILENT warn
```

Why every check must pass: a recipe that needs an oven you don't own is useless however good the
judge thinks it is, and a recipe the judge finds bad is useless however tidy it looks.

Why the judge's silence counts as a failure: on the very first run, the judge ran out of room to
think and returned nothing. Without this rule, those tests would have looked like clean passes.

<details>
<summary><b>For developers</b></summary>

| Step | Where it lives |
| --- | --- |
| Combining | `toGradingResult` in `asserts/shared.ts`; every grader returns the same `MetricResult` shape |
| Judge health check | the `judge_verdict` metric |
| Pass / score / columns / reason | promptfoo's `pass`, `score` (mean), `namedScores`, `reason` |

</details>

---

## What these pictures leave out on purpose

- **Matching ingredients to the app's master ingredient list.** That list lives in the app's
  database, which the test bench doesn't connect to. Every AI is affected the same way, so the
  comparison is still fair, but this part isn't measured.
- **Savings from caching.** Every test starts from scratch, so the costs shown are the worst case.
  Real use costs less.
- **The app's spending limits.** Test runs don't count against any cook's monthly limit and don't
  show up on the app's spending dashboard.
