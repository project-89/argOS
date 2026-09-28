# Historical question candidates — bounded repair

## Observed failure

In `recordings/project89-gate-HWJ0Kr`, Jerry's reflection generated three
questions at 135s after starting at 121.5s. `local_view_changed` removed all
three while retaining two sourced historical insights. The same trial showed
successful explicit speech-to-phone follow-through, but no outgoing text reply.
This repair addresses question retention, not compulsory communication.

## Keep / change / defer

- Keep the existing reflection lane, actor-owned ECS `ReflectionState.questions`,
  foreground selector, planning, models, timing and action authority.
- Change only question provenance/admission and their projections. Add no new
  controller, scheduler, component, goal generator or automatic action.
- Defer further live trials, H3, prompt-to-world work, and George's separately
  observed invalid reflection schema field. No previous gate is upgraded.

## Implemented contract

Reflection now asks for `questionsRaised:[{question,sourceIds}]`: at most four
questions, 400 characters each, with 1–8 unique exact issued source IDs. Legacy
string questions remain supported, but cannot survive stale context without
citations. Questions may still be an empty array.

For a sourced question, admission checks owner, world, runtime source, active
actor, identity, clock, unchanged question-store basis, exact output integrity
and the question's individual cited sources. A missing, foreign or changed
source cannot be substituted. No model-provided status or provenance is trusted.

If the original full current-context checks pass, a new sourced question is
stored as `open`. Otherwise, still-valid cited evidence allows it to survive
only as `candidate`. The engine records exact source excerpts, request ID,
request consideration simulation time and storage simulation time. These are
historical interpretations of owned evidence, not verified world facts.

Candidates remain on the same bounded twelve-row question store. They do not
evict open questions or other candidates; closed rows alone can be replaced.
Duplicate new output cannot reopen closed questions or promote candidates.
Even if the earlier scene reappears before storage, a candidate already admitted
as historical cannot silently become current.

Only background reflection sees `HISTORICAL QUESTION CANDIDATES`. Foreground
and planning projections exclude them. The existing `questionReviews` path can
freshly choose `open`, `answered` or `parked`, citing that new request's evidence.
Review still requires the full unchanged current-context and source checks;
stale reviews cannot answer or promote a candidate. Neither status creates a
goal, plan, thought utterance or execution grant.

Per-result candidate metadata is process-local and engine-owned. Save/reload
preserves historical rows and excerpts but restores no inference authority.
A copied/forged sourced result cannot use the trusted legacy string-storage API
to mint provenance. Candidate output is rechecked at storage, not merely once
when inference returns. Diagnostics count retained candidates separately from
total questions so retention cannot be mistaken for fresh promotion.

## Verification

Retained red baseline: `/tmp/argos-question-candidates-before.log`, two new
tests failed and seventeen existing tests passed. First repair: 72 tests passed
across questions/freshness. Expanded safety check: 100 tests / 3 suites passed
in `/tmp/argos-question-candidates-safety.log`.

Final broad regression: **764 passed, 5 existing skipped, 25 suites passed**
in `/tmp/argos-question-candidates-broad.log`. Typecheck passed in
`/tmp/argos-question-candidates-types-second.log`; targeted whitespace checks
passed. Existing dirty-worktree changes and all failed live evidence were
preserved. No commit/reset, live provider run, or H3 request.

Coverage includes actual speech and local-view changes during inference;
fresh promotion/answer/parking versus stale review rejection; unknown/foreign/
duplicate/changed citations; per-question filtering of changed evidence;
tampering/copying; new question-store state; stopped/replaced sources; actor/world
isolation; explicit consideration/storage simulation times; no automatic
promotion on scene restoration or repeated output; inert ECS round-trip;
capacity and absence of goal/plan/inner-speech creation.

## Limits and next gate

The repair is offline-verified, not live-verified. It cannot retroactively recover
the previous run's discarded questions: their text and citations were not saved.
The new model output must actually cite sources; unsourced legacy output still
uses the old conservative freshness rule.

Candidates wait for the existing reflection process to reconsider them. No new
fast lane or scheduling trigger was added. A continually changing scene may
still prevent fresh review from committing; retention alone does not establish
review liveness or better choices. That must be measured, not assumed.

Next bounded live gate, only when separately requested: measure sourced question
generation, candidate retention, fresh review, continued native action choices,
and actual phone replies under the same scenario. Preserve failures, including
no reply or no promotion. Ten-trial baseline, ten-minute endurance, and combined
interactive-demo acceptance remain outstanding.

## Single authorized live check — `project89-gate-HE4FDh`

Completed at 180s with no interruption or harness failure. Same formative
history, configured Gemini models, high background reasoning, first message and
conditional follow-up, plus visitor request. No edits during execution, H3,
additional run or automatic retry. Artifacts: `recordings/project89-gate-HE4FDh`
contains `result.json`, `world.json`, `runtime.log` (mode 0600). Console log:
`/tmp/argos-question-candidates-live-2026-09-21.log`.

### Retention passes; live review not demonstrated

Jerry's reflection issued 110.5s and returned 132s. It generated 3 insights and
2 sourced questions. `local_view_changed` still excluded the current insight,
but retained both questions as candidates and two historical insights. Candidate
questions concern how Morpheus entered and whether he is the unknown texter.
The question wording includes the actor's assumptions, not engine-certified
facts. Both remain candidates in the final saved ECS state.

George's reflection issued 132s, returned 143.5s: 2 insights/2 questions. The
same freshness boundary retained one historical insight and both candidates.
No invalid-schema reflection occurred in this trial; the preceding failure is
not thereby diagnosed or proven fixed.

Neither actor issued another reflection/review in the bounded run. Final
importance accumulators are Jerry 41 and George 36.5, below threshold 100;
each has reflectionCount 1. Thus this is **not** a fresh review that failed
admission: no second review was observed. The repair preserves four candidate
questions, but timely promotion and behavioral use remain unproven. No candidate
was exposed as a current foreground/planning question.

### Phone and visitor outcomes

- First text delivered 26.2s, read 40.2s. Jerry's native reply was sent 60.745s
  and delivered **60.945s**: "It has a white rabbit and says PROJECT 89 — WHO IS
  WATCHING? Who is this?"
- Follow-up sent 61s, delivered 61.2s, read **73.7s**. No second outgoing reply
  by 180s. The full two-round phone/combined gate still fails.
- The first reply predates reflection issuance and candidate retention. It
  cannot be attributed to the candidate repair. This single stochastic trial
  is not repeatability evidence.
- Jerry created an intention to text a test question at 81s (priority 8), later
  reprioritized it to 5 at 106s, and the trace records retirement at 128s. Saved
  `GoalLifecycle.reason`: "The sender or someone connected to them is standing
  in my apartment; texting is pointless now." Goal progress remains 0, not
  successful completion. This is a chosen shift based on an inference about
  Morpheus, not proof of his identity or a lost unread receipt. The standing
  phone concern remains active.
- Morpheus proposed 50.5s, God-approved 66.5s (proposer 10, approver 6 equals
  actual God 6), constructed on Street 67.5s, Hallway 75.5s, Living Room 82.5s.
  At 106s the old proposal evidence becomes inadmissible with `actor_intention`,
  **after** successful construction. That does not reverse construction or
  establish the cause of the prior pre-approval expiry.
- Jerry: 46 issued foreground requests, 45 returned, 40 integrated, 5
  superseded; no rejected decisions. No explicit next-purpose selection/review
  in this trial. Provider p50/p95 1.778s/4.301s (not full response latency).
  George had one foreground timeout at 176.5s. 301 diagnostic entries, 0 dropped.

### Next bounded decision

Two separate questions remain: how an existing cognitive lane can reconsider
candidates promptly without requiring a full new reflection, and whether the
second text would be answered absent the visitor he treats as a better source.
Do not conflate those or make replies mandatory. A visitor-delayed comparison
would change the scenario and must be explicitly labeled, not silently replace
the baseline. No further mechanism or trial was added here. All failed evidence,
ten-trial baseline and ten-minute endurance requirements remain intact.

## Delayed-visitor comparison — `project89-gate-9Av1yr`

One separately authorized 180s run completed, exit 0, no interruption or harness
failure. Added opt-in `--delayed-visitor` to `src/run-project89-gate.ts`: requires
`--visitor`, requests the same opportunity at 120s instead of the default 10s,
and records that timing in modelConfig. Same formative history, configured
Gemini 3.8 Flash models, high background reasoning and conditional phone
protocol. No cognition/scheduling change, H3 or automatic retry. Typecheck
passed (`/tmp/argos-delayed-visitor-types.log`). This is a changed-condition
comparison, not another passing baseline trial.

Evidence: `recordings/project89-gate-9Av1yr/{result.json,world.json,runtime.log}`
(each mode 0600); console `/tmp/argos-delayed-visitor-live-2026-09-21.log`.
257 control-loop diagnostic entries, zero dropped. Broad regression tests were
not rerun for this harness-only timing change; the earlier results remain above.

### Phone outcome and foreground handoff

- First message delivered 26.2s, read **62.7s**. No outgoing reply by 180s.
  The conditional second message was therefore never sent.
- Jerry chose a phone next-purpose at 41.5s, ready after speech completed at
  46.960s. At 48.5s and 51.5s he returned the matching move and goal but omitted
  both nextPurpose and nextPurposeReview. Admission rejected both with
  `invalid_schema`, field `control.nextPurpose`. This is a concrete contract
  problem, not evidence that he chose to ignore the phone. He subsequently
  reached the Kitchen at 58.5s and read it. One foreground timeout at 88.5s
  is also preserved; neither issue explains the entire subsequent non-reply.
- After reading, he opened the drawer, obtained the card, and discussed it
  with George. At 120.220s his completed speech states the card's actual text.
  At 172.260s he says, "Whoever it is, they want to know what it says. Should I
  text back?" His final selected purpose is listening to George's warning.
- The standing investigation and phone goals remain active (priorities 7 and
  6). Repeated purposes refer to listening before deciding how to reply, but
  no post-read explicit next-purpose handoff is returned. Awareness of the
  request persists; execution does not follow. This supports investigating
  conversation-to-intention follow-through, not adding mandatory replies.
- Jerry provider p50/p95: 1.789s/4.085s; George: 1.946s/4.177s. These are model
  request latencies, not end-to-end communication response times.

### Reflection and world growth

George's reflection issued 140s, stored at 156.5s: 3 generated insights and 2
questions; `physical_memory_changed` retains 1 historical insight and both
questions as candidates. Jerry issued 154s, stored at 168.5s: 3 insights and 2
questions; `dialogue_changed` retains 1 historical insight and both candidates.
Jerry's questions concern who planted the card and who accessed the drawer.
Neither actor issues a second reflection. Final importance: Jerry 20, George
46, threshold 100, reflectionCount 1 each. Again retention works, but fresh
review/promotion and behavioral use are not demonstrated.

Visitor request at 120s was reviewed 144s, proposed 168.5s, last observed
admissible and pending; God began a proposal batch at 175.5s. No approval or
construction occurred within the bound. Two earlier God report batches record
expiry failures (122s and 155s), before this proposal existed. The final saved
opportunity is expired after stop; the last pre-stop sampled state is pending.
Do not attribute that final status to a specific dependency failure: none is
recorded for this proposal. The shortened visitor window does not establish
that the builder cannot complete it. Morpheus never entered the scene.

### Interpretation and exact next steps

Delaying the visitor was not sufficient for a reply in this trial. It removes
an actual visitor encounter as the explanation for this particular non-reply,
but does not quantify a causal timing effect across stochastic runs. The full
phone/combined gate still fails. Ten-trial baseline and ten-minute endurance
requirements remain outstanding.

1. Offline reproduce a ready next-purpose followed by a matching move with no
   review. Inspect the issued contract and existing response handling before
   proposing the smallest repair; preserve explicit take/cancel semantics,
   ownership and freshness checks rather than silently granting authority.
2. Separately trace how "inspect then reply" is represented across the native
   inspection outcome and subsequent conversation. Distinguish an explicit
   decision to defer from an unretained follow-up; do not force phone priority.
3. Separately design timely candidate reconsideration within an existing lane,
   preserving current-evidence review before foreground/planning exposure.
   This comparison intentionally did not alter scheduling.
4. Regress any approved repair offline, then request a single labeled bounded
   comparison. No additional live run or cognition mechanism was added here.

Subsequent authorized offline follow-up:
[handoff and reply audit](HANDOFF-AND-REPLY-AUDIT-2026-09-21.md). Ready-review
prompt/example and retry feedback repaired without changing admission. Native
inspection-to-reply tests pass. Saved prompts confirm background reply choices
were present but unreviewed; activity appraisal/selection is the remaining
behavioral focus. Final regressions: 923 passed, 5 existing skips, 29 suites;
typecheck passed. No additional live trial or candidate scheduler change.
