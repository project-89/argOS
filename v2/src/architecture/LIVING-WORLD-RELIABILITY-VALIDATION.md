# Living-world reliability validation

Execution resumed by explicit user instruction on 2026-09-06. Work is incomplete.
No H3 calls or demo-server restarts are authorized by this initial checkpoint.

## Stage 0: baseline and rubric

Frozen source fingerprints and configured model IDs are in
[LIVING-WORLD-RELIABILITY-BASELINE.json](LIVING-WORLD-RELIABILITY-BASELINE.json).
The existing tree is extensively dirty; HEAD is not a reconstruction of it.
Historical Fx4yPS/W04xMz recordings and prior test logs remain untouched.

The prospective rubric in execution notes section 9 is adopted before new live
tuning: ten scored episodes, at least eight passing, zero critical integrity or
privacy violations, at least three autonomous multistep completions over two
task types, and explicit evidence for deliberate revisions. Missing adoption is
inconclusive. Foreground p95 <=5s is a measured target, not a provider guarantee.
No new live episode has run. Existing journals already expose continuation,
activity review, completed contributions, physical receipts and projection;
add instrumentation only where the next reproduction exposes a missing link.

## Stage 1: SocialMemory restore regression (validated)

Source review reconfirmed that the explicit loader omits `fragmentsJson` and
`contributionsJson`. Test the production serialization/deserialization path
before changing the loader. Historic heard prefixes may remain remembered, but
restoration must not issue a new hearing notification or resume speech.

### Reproduction and repair

The fresh-process suite initially had a fixture import mistake (corrected before
using its results). The valid pre-fix run then failed 7 of 8 checks:
`/tmp/argos-reliability-social-red.log`. It proved lost contribution purposes and
foreign sparse-slot fragment residue, not just a missing property in source.

The loader now restores bounded own-turn-linked contribution purposes and heard
prefixes. Restored prefixes are explicitly historical; new fragment intake and
flush cannot reuse them as active speech. Missing/invalid legacy fields default
without reading old sparse slots. Rehydrated turns do not carry producer-issued
activity receipts, so restore cannot manufacture a new conversation engagement.

An adjacent explicit-loader field audit found only one other omitted component
in that audit: God's six monitoring fields. Its custom serializer omitted them
as well. Two additional tests failed before repair
(`/tmp/argos-reliability-god-restore-red.log`). Both serialization and restoration
now retain narrative goals/monitoring values, with safe legacy defaults matching
the normal 30-second observation interval. No callback, job or host authority is
restored. This audit is not a claim that every generic/EID-valued field has been
fully verified.

Focused union passed: **9 suites / 101 tests** in 9.989s,
`/tmp/argos-reliability-stage1-union.log`. Includes fresh-process restoration,
real recycled slots, malformed/legacy snapshots, own versus peer purposes,
working/cognitive memory, temporal ages, listening and speech-fragment flushing.
Initial post-social-fix TypeScript passed; final stage TypeScript is being run.
No model/provider calls or live behavior trials were needed for this stage.

Final stage TypeScript passed (`/tmp/argos-reliability-stage1-final-typecheck.log`).
Proceeding to truthful work outcomes. The broader goal remains incomplete.

Full post-stage-1 gate passed: **263 suites / 3,298 tests**, 10 skipped, 161.742s
(`/tmp/argos-reliability-stage1-full.log`). No suite failed.

## Stage 2: truthful productive work (in progress)

Three boundaries need separate evidence: physical interaction, time actually
spent working, and a completed artifact. A schedule's four-hour work period must
not complete on power-on; being in the room must not discard it either. Native
document writing/review/finalization will use real ECS content and revisions,
with time credited only after admitted work commits. Fictional computer use
does not grant host tools or create an email/report by descriptive text.

The scheduled-work reproduction failed all three original checks before repair
(`/tmp/argos-reliability-work-red.log`). Work now uses `productive_time`; being
in its room neither suppresses the goal nor completes it. Its admission budget
covers its required productive duration. The exact old room-plus-interaction
contract is interpreted with the same productive proof without rewriting saved
history; an already-expired legacy attempt is not resurrected.

Native `WorkDocument` + `WikiDoc` now hold real written text, revision, review
and finalization state. `GoalWorkProgress` credits completed writing/review time,
bound to actor, goal incarnation/contract, and room. Writing, reviewing and
finalizing are separate timed operations. Source changes, observed device power
interruptions, inaccessible/moved targets, edited content/revision and competing
edits invalidate pending work. Restoring a save retains content/time but cannot
replay pending work. This is not a document-quality evaluator or a guarantee of
autonomous adoption. Timing constants still require realism tuning.

The first document run passed 13/15: work was committed but not credited because
the named-object identity helper rejected unnamed goals. Goal identity is now
assigned independently. The expanded work/schedule union passed **25 tests**
(`/tmp/argos-reliability-work-focused.log`), including admission-token forgery,
copy, transfer, early commit/replay, and false backend-result checks.

Default stimulus-only send_text/send_email/check_email/browse_web/search_files
are unavailable without implementation. Generic keyboard use remains explicitly
nonproductive. Package-owned physical phone operations retain their own backend.
The duet contains a native writable notebook and an actor-selectable finalization
condition, without a forced writing goal. Its integration/privacy/phone suite
passed **9 tests** (`/tmp/argos-reliability-duet-work.log`).

The initial full gate found two director failures after native pickup vocabulary
was accidentally changed by this work. Restored the original native vocabulary;
only document operations add their new operation labels. Director + document
regressions then passed **51 tests**
(`/tmp/argos-reliability-work-render-regression.log`). Final full gate pending.

Final stage-2 full gate passed **265 suites / 3,324 tests**, 10 skipped, 164.755s
(`/tmp/argos-reliability-stage2-final-full.log`); TypeScript passed as well
(`/tmp/argos-reliability-stage2-final-typecheck.log`). Stage-3 regression test
expectations were edited after this run had already loaded/passed that suite;
they have their own red run below. This gate is not stage-3 validation.

## Stage 3: observed intention loss (diagnosis / reproduction)

Historical Fx4yPS gives a specific coffee failure, not just a model-quality guess:
Jerry's goal 364 is active at 181s when he chooses Kitchen, and still active at
183.5s while listening during movement. At 187.5s it is engine-paused with reason
"Exploration paused without a success criterion; its attempted plan is not
proof." His mug pickup is now linked to the unrelated return-to-Living-Room goal
328. He returns with an empty mug and later banters. The goal was not completed;
the engine removed it from active pursuit on a partial-plan completion.

`maintainGoalLifecycles` treated any completed plan as a reason to pause an
exploratory intention, even if another plan for it was active. A completed
arrival/inspection should be neither whole-goal proof nor automatic withdrawal.
Two regression expectations fail on the old behavior
(`/tmp/argos-reliability-partial-plan-red.log`, 2 failed / 40 passed). Next repair:
retain the intention across completed partial plans, keeping bounded review,
actual waiting-for-new-evidence and parent retirement safeguards. Do not claim
this alone solves prolonged banter or autonomous follow-through.

Repair implemented: completed partial plans no longer pause the broader
intention or retire a newer active plan. Waiting-for-new-evidence, bounded
review time, explicit actor deferral and parent retirement remain. Focused union
passed **89 tests** (`/tmp/argos-reliability-partial-plan-green.log`). A real
apartment executor test then completed move/pickup/pour/drink while leaving the
unverified larger intention active; the full focused-apartment suite passed
**10 tests** (`/tmp/argos-reliability-coffee-partial-plan.log`). Actions in that
test are fixture-selected, not autonomous behavior. TypeScript passed.

### Live diagnostic 01 — breakup, core services

Retained artifacts: `recordings/sitcom-breakup-boyfriend-utE9lY`.
120 sim seconds / 120.567 wall seconds; priority controller, reconsideration and
narrative mind on; Gemini 3.8 Flash; world maintenance off; no H3. Mean ECS tick
6.15ms, no slow ticks. Elaine foreground median/p95 1386/3967ms; Jerry 1256/3177ms.
There was one rejected inference timeout and one schema rejection; zero queue
failures is not a claim that every model response succeeded.

First read 27.7s; actual typed reply delivered 35.89s ("Understood. Goodbye,
Alex."). Elaine disclosed the breakup at completed speech 54.9s; Jerry's
subsequent speech expressed concern. Second read 59.2s and disclosure 74.5s;
no second reply. Emotional/phone causal chain is evidenced. Continued venting
and related jokes through 115s are plausible but repetitive. No autonomous
productive task was adopted; practical follow-through is **inconclusive**, not
passed. This short core run does not validate maintenance or H3 performance.

Next diagnostic is the separately labelled `writing` condition: two fixed
operator texts request writing/reviewing/finalizing a note, placing it in Kitchen
and reporting back. All choices/effects remain NPC/native-executor-owned. The
text's claim about a spare key is a sender claim to transcribe, not a new ECS
fact about a real key. Evaluate actual document state/containment and timing of
the reply, not whether the NPC says it is done. Preserve refusal as a legitimate
outcome and score missing task adoption as inconclusive.

### Live diagnostic 02 — practical text / non-adoption

`recordings/sitcom-writing-boyfriend-pp5iRD`: 120s, core services, same model and
controller. Reads at 13.7/32.7s; clarification reply at 74.465s. Elaine questioned
why Alex wanted a note for Jerry while Jerry was present, and Jerry disputed
the spare-key claim. No document was written. This is **not a productive-task
pass**; there is positive evidence of skepticism/clarification, not a stalled
phone backend. Mean ECS tick 5.34ms, no slow ticks; foreground p95 Elaine 3146ms,
Jerry 2839ms. The source claim was not installed as a physical key fact.

### Controlled writer — established task, autonomous execution

New `document-work-testbed.ts` gives Wren a blank report, a separately readable
source artifact and an initial owned finalization task. It does not dictate
actions. `document-work-check.ts` records bounded trials with no H3/host office
tools. This tests competence after task adoption, not spontaneous adoption.

`recordings/document-work-y1Evkx` (90s): report finalized at 33.6s after real
read/write/review/finish operations. It faithfully retained the source's two
railing observations and explicitly limited assessment. Before completion Wren
made two malformed command attempts; after completion, a default work template
generated repeated invalid self-observation plans and there were duplicate
active schedule goals. Artifact completion passed; overall control health did
not. Do not erase that distinction or the retained failed actions.

The syntax bug had two formatting boundaries. The action-menu data retained
help, but the final foreground formatter dropped it; the background planner also
discarded it. Both now include bounded command descriptions. The final-formatter
regression failed 1/23 before repair; command-help/visibility union passed 45
tests (`/tmp/argos-reliability-command-help-green.log`). Earlier claims about
foreground visibility referred only to menu data and were insufficient.

Schedule reproduction failed both added checks: preplanning duplicated an
already-active slot, and fallback work planning repeatedly created self-inspection
plans. Preplanning now recognizes unsettled slots; work templates no longer
manufacture activity in lieu of a selected productive task. Awaiting-evidence
plans are not overwritten by the template producer. Focused union passed 30
tests (`/tmp/argos-reliability-work-template-green.log`).

`recordings/document-work-NcT279` (90s): valid JSON writing on first attempt,
faithful report finalized at 32.1s. The prior self-inspection template storm was
absent. Two subsequent stale-revision writes still occurred: the engine had
compiled this content/revision-bound command into a literal reusable habit.

New document commands now retain ordinary action/memory evidence but are not
compiled into broad room/need-triggered literal BT branches or one-step
procedural habits. Parameterized document skills remain future work; normal
learning for other capabilities is unchanged. Four cache regressions failed
before repair; document + BT suites passed 44 tests afterward
(`/tmp/argos-reliability-document-cache-green.log`). Next run checks behavior
with this fix. No stage-3 final full-suite gate has run yet.

Remaining observed design issues to keep visible: plan/macro cursors still
inflate `Goal.progress` to 90/95 despite being explicitly non-success estimates;
replace that conflation with actual goal-specific progress and separate activity
liveness. Legacy serialized placeholder device schemas need the same unavailable
boundary as current defaults. Do not call all of Stage 2 or 3 complete yet.

### Writer 03: stored-plan replay, not only learned habits

`recordings/document-work-1ODwKn` (90s): accurate report finalized at 24.6s;
mean ECS tick 1.62ms, zero slow ticks. Two stale-revision writes still occurred
after the literal-cache guard. The earlier cache diagnosis identified an unsafe
path but did not establish the sole cause: a stored plan also replayed the old
command, then failed for repeated step failure. Task completion passed; control
health still failed. All three writer attempts remain retained.

The stored-plan selector previously checked only the advertised verb. It now
uses the same pure argument/revision/readiness parser as native timed admission,
without minting a token, changing the artifact or granting plan credit. This is
checked at dispatch, not by predicting future document revisions for an entire
multi-step plan. A changed document makes the old step ineligible; it is not
evidence that the actor executed that step. Regression failed before repair;
28 document tests and TypeScript passed afterward
(`/tmp/argos-reliability-document-plan-{red,green}.log`,
`/tmp/argos-reliability-plan-typecheck.log`). A full regression gate is underway.

The authored source document's ObjectState now agrees with its finished WikiDoc
state. Subsequent writer configurations also fingerprint BT/procedural learning,
affordance availability and physical activity sources.

### Full gate and remaining learning/legacy paths

Stage-3 snapshot full gate passed **266 suites / 3,335 tests**, 10 skipped,
175.326s (`/tmp/argos-reliability-stage3-full.log`). This includes partial-plan,
schedule-template, command-help and dispatch revision checks, but precedes the
following two additional repairs.

Goal completion had a third literal-learning path: whole action sequences were
compiled into shared skills. `compileSequenceToSkill` now refuses a sequence
containing document commands; it does not strip essential steps and pretend the
remaining sequence achieves the goal. Successful action/memory evidence remains.
Parameterized document skills are still unimplemented.

The native affordance admission boundary now recognizes the exact old canned
stimulus-only definitions even when restored without `unavailableReason`.
Replacement tool-backed definitions with the same names are not blocked by this
compatibility check; actual tool authorization/delivery remain separate gates.
Nine new cases failed before repair; focused learning/execution union passed 81
tests. Additional backend-compatibility assertions passed all 33 document tests.
TypeScript passed (`/tmp/argos-reliability-legacy-cache-{red,green,typecheck}.log`,
`/tmp/argos-reliability-backend-compatibility.log`). Subsequent full gate pending.

Writer 03 foreground operation latency: median 926ms, p95 2,199ms over 28
operations. This is a one-actor diagnostic, not a four-actor load claim.

### Writer 04: stale physical replay stopped; further quality work remains

`recordings/document-work-7H11Ft` ran 90 simulated seconds. The report was
finalized at 34.1s with the source's complete observations and limitation intact.
Exactly one write, one review and one finalization committed; no physical action
failed. The obsolete revision-0 stored step was retired before dispatch. No
document literal goal skill was compiled, and no self-observation template storm
recurred. Subsequent quiet/waiting was not counted as productive work.

This is not an error-free cognition result: one foreground response timed out
at 27s, a later plan proposal attempted unavailable finalization, and redundant
document reads remained. Finalization latency varied across the four trials
(33.6, 32.1, 24.6, 34.1s); do not claim monotonic performance improvement.
The targeted stale physical replay regression is absent in this run, not proved
impossible for every generated or restored policy.

Mean ECS tick 1.15ms, zero slow ticks. Foreground operation p95 was 1,833ms over
29 operations, but its 10ms median includes deterministic fast paths and waits:
this is **not model-only latency** and does not erase the timeout. Earlier
foreground figures are also scheduler-operation metrics unless stated otherwise.

Final source gate passed **266 suites / 3,344 tests**, 10 skipped, 170.336s:
`/tmp/argos-reliability-final-full.log`. TypeScript passed
(`/tmp/argos-reliability-final-typecheck.log`); `git diff --check` passed.
All four writer trials and both new social trials have stopped. No H3 calls,
demo restart, model-selection changes, commits or unattended automation.
The overall reliability goal remains incomplete.

### Next execution checkpoint

1. Final gate is recorded above. On resume, inspect newer work before starting
   the next reproduction; do not reuse these counts for later source edits.
2. Separate partial-plan/procedure cursor progress and exhausted-attempt state
   from actual Goal.progress. The current 95 sentinel also prevents automatic
   macro restart; removing it without replacing that guard would reintroduce
   loops. Preserve separate liveness and restore safety with regressions.
   Relevant boundaries: `markGoalMacroProgress`, `tryCompleteGoalFromMacro`,
   `selectProceduralAction`, `advanceAgentPlan`, and `expireStaleGoals`' cached
   activity timestamp. Cursor/goal percentages currently have several consumers.
   Also reproduce ProcedureState restoration: its explicit loader copies an
   active status and cursor, while procedural memories themselves survive. Audit
   fresh selection/ownership gates before claiming restored execution is inert.
3. Continue autonomous coffee/social-distraction follow-through trials. The
   physical partial-plan fix has mechanical proof; the baseline coffee failure
   is not yet replaced by repeated autonomous completion evidence.
4. Continue the remaining ECS reuse/isolation and maintenance stages in order;
   do not jump from a working report to an open-world or H3 readiness claim.

## Continued execution: attempt history versus achievement

The preceding turn was progress, not a wait or blocker. Current source confirmed
that plan exhaustion wrote 90 and procedural exhaustion wrote 95 into
`Goal.progress`; the latter also prevented endless macro restart. Three added
assertions failed before repair (`/tmp/argos-goal-attempt-red.log`).

New built-in `GoalAttempt` stores actor/goal identity, the goal contract, actual
activity time, and bounded exhausted macro signatures. Real matched actions
renew inactivity separately from objective progress. Merely starting a procedure
or reconciling already-reached locations does not earn activity/progress.
Plan/macro exhaustion no longer writes 90/95. Both automatic selection and policy
start reject an exhausted macro for the same goal episode; a genuinely different
goal contract does not inherit that history. Legacy 95 inhibition is retained
conservatively for data without attempt metadata, not newly manufactured as a
progress estimate. Direct authored/legacy percentages have not been globally
rewritten, and arbitrary objective percentages are not inferred.

The same audit reproduced restored ProcedureState returning `active`.
Restoration now retains a bounded signature/cursor as `needs_revision`; stale
action receipts do not advance it, selection cannot directly resume it, and a
fresh admitted start begins a new execution rather than reviving the old cursor.
This is a procedural restore repair, not proof of the entire multiworld/restore
stage. Attempt data survives EID remapping without granting progress; ownership,
changed-contract and future-time guards are covered.

Focused gate: **94 tests** across five suites; TypeScript passed
(`/tmp/argos-goal-attempt-focused.log`, `/tmp/argos-goal-attempt-typecheck.log`).
Restore red: `/tmp/argos-goal-attempt-restore-red.log` (1 failed / 2 passed).
Full source gate is running (`/tmp/argos-attempt-full.log`).

Next no-H3 diagnostic is predeclared before running: a two-actor, core-only,
120s `coffee` practical-text condition. Two fixed outside messages invite coffee
and allow a later dinner; no goal/action/feeling is injected. Existing finite pot
and held-mug mechanics remain unchanged. Non-adoption is inconclusive; adoption
followed by unexplained abandonment is a failure; completion requires actual
pour/drink receipts and matching ECS supply/cup changes. The operator snapshot
now records pot portions and each mug's contents, location and drink count.

### Coffee 01: autonomous physical follow-through; rendering failed separately

`recordings/sitcom-coffee-boyfriend-GP8gEG` completed 120 simulated seconds,
core services on, maintenance/H3 off. Full source gate immediately before it:
**267 suites / 3,348 passed tests**, 10 skipped, 166.65s
(`/tmp/argos-attempt-full.log`); TypeScript passed.

- Elaine read the two outside texts at 15.7s and 34.7s, disclosed their content
  to Jerry, chose the blue mug, picked it up, poured at 63.5–65.5s and drank at
  73.5–76.5s. The spoken “already poured” followed the actual pour.
- Jerry independently picked up the red mug, poured at 70–72s and drank at
  78.5–81.5s, then put down the empty mug.
- ECS supply fell from four portions to two. Both mugs became filled then
  empty, each with one actual drink receipt. This is two autonomous completions
  within one episode, not two independent trials.
- Elaine's typed reply was delivered at 82.555s: “Sounds good, having some
  coffee now. Will text you when I head out!” Neither reply nor coffee was forced.
- Mean ECS tick 6.47ms, zero slow ticks. Foreground-operation p95 Jerry 3,118ms,
  Elaine 5,144ms; the latter narrowly misses the prospective 5s target. Continued
  banter and sparse expressed thoughts remain quality observations, not proof of
  absent cognition or automatically a failure when companionship is the purpose.

**The overall command exited 1:** the offline performance projector stopped at
source cursor 76,500.001ms with `performance_overflow`: overlapping essential
gestures could not both receive coverage in its one-focal-action shot deck.
Actual simulation continued to 120s; no H3 was called. Keep physical follow-through
success distinct from this failed renderer-readiness gate. The saved public
events, source capture and prompts provide the later offline regression fixture.
Do not solve it by serializing the world, dropping a gesture or inventing coverage.

The live trace also showed duplicate afternoon-work goals in Living Room and
Kitchen. Current-activity admission recomputed a fallback room after movement,
changing its signature and creating a second goal for the same schedule slot.
Two new active/paused relocation cases failed before repair. It now reuses the
existing unsettled slot before resolving a new destination; paused intent stays
paused, and a queued goal activates against its original contract. This fixes a
second producer path, beyond the earlier preplanner deduplication. Focused
schedule/timing union passed 12 tests (`/tmp/argos-schedule-relocation-{red,green}.log`).

Schedule source full gate passed **267 suites / 3,350 tests**, 10 skipped,
166.446s (`/tmp/argos-attempt-schedule-full.log`); TypeScript passed. This gate
precedes the direct-action liveness completion below.

### Direct-action liveness completion

Further inspection found that recording only plan/macro activity missed valid
foreground choices made without a stored plan. The central accepted-action hook
now records activity for its explicitly captured goal after the existing
identity/contract checks. It does not credit a newly urgent goal or infer current
ownership from a stale result. Wait/rest do not renew activity through this hook;
plan and macro waiting paths likewise do not manufacture activity or progress.
An exhausted wait-only macro still gets a replay-inhibition record.

Two new direct-action assertions failed before repair
(`/tmp/argos-direct-attempt-red.log`). Five-suite identity/ownership/execution
union passed 98 tests, TypeScript passed; final liveness/document/execution union
passed 75 tests including wait-only exhaustion. Logs:
`/tmp/argos-direct-attempt-green.log`, `/tmp/argos-direct-attempt-typecheck.log`,
`/tmp/argos-attempt-liveness-final.log`. Final full gate is underway.

These changes do not remove the normal inactivity policy or reinterpret
unbounded waiting as work. Review longer explicitly chosen waits against that
policy during the long-run stage; no human-like patience claim is established.

Coffee-01 memory inspection: 13 Elaine and 8 Jerry narrative entries existed at
the end, despite only one expressed foreground thought in the transcript.
They retain source/evidence envelopes. Do not equate a quiet thought overlay with
an empty inner history, or expose those private entries as public facts. Some
subjective recollections still contain assumptions (Jerry called the blank
notebook “my material”); structural attribution prevents world-state proof but
does not establish perfect epistemic wording. This remains a realism review item.

Next repeated coffee diagnostic uses the same two fixed texts and 120s core-only
configuration after the final gate. It is a diagnostic across a small code change,
not a secretly substituted trial or a completed fixed-version evaluation matrix.

Final source gate after direct-action/wait liveness repair: **267 suites /
3,351 passed tests**, 10 skipped, 165.133s
(`/tmp/argos-attempt-final-full.log`). TypeScript passed
(`/tmp/argos-attempt-final-typecheck.log`); diff check passed. Coffee diagnostic
02 has started on this source; no runtime files will be changed during the run.

### Coffee 02: repeat follow-through, schedule fix holds, early claim remains

`recordings/sitcom-coffee-boyfriend-0P3TK7` completed 120s and exited 0.
Both characters again physically completed coffee, this time with Jerry first:
Jerry picked up at 71.3s, finished pouring at 75s and drinking at 79s. Elaine
picked up at 64.8s, finished pouring at 85s and drinking at 100.5s. The pot fell
from four portions to two; each mug had one drink and was empty at the end.
Some deterministic fast-path actions were absent from the model-action console
format; committed action receipts and ECS state, not that console filter, proved
Jerry's completion. Four cup completions across two episodes are not four trials.

Elaine read at 18.7s and 50.2s. Her first reply was delivered at 39.125s:
“Sounds great, having a cup now. See you soon!” This preceded even picking up her
mug by 25.675s and was not an accurate current physical-state report. It did not
change ECS contents or certify success. Record it as a semantic-grounding issue,
not proof that the phone or coffee executor failed. No forced second reply.

The prior room-dependent duplicate work slots were absent: each actor retained
one active afternoon-work goal in Living Room, at 0 progress. Mean tick 4.59ms,
zero slow ticks; foreground-operation p95 Jerry 2,805ms / Elaine 3,044ms. Offline
projection reached source 120,000ms in 17 packets with no reported error/tail.
This does not repair Coffee-01's overlapping-gesture failure or prove H3 playback.

Activity review was genuinely running, not missing: just before shutdown both
actors had completed three reviews, repeatedly choosing to hear a comeback and
enjoy companionship. The final stopped snapshot omits ephemeral review state;
inspect pre-stop frames before inferring a wiring omission. Banter was prolonged,
but physical progress occurred alongside it. Pressure-test competing obligations
and changed physical prerequisites instead of imposing a turn quota on a scene
whose standing goal is companionship and whose outside sender explicitly removed
urgency. The early inaccurate text remains independently actionable.

### Resume checkpoint after continued execution

- Final gate remains 267 suites / 3,351 tests; no runtime source changed during
  Coffee-02. Both coffee trials are terminal, all logs/recordings retained.
- Attempt/progress separation, procedural restore reconsideration, direct-action
  liveness and same-slot relocation deduplication are implemented and validated.
- Next: trace the premature physical-state claim through actor-local evidence,
  continuation and narrative extraction; pressure-test a changed prerequisite
  while a social exchange continues. Keep subjective claims separate from ECS
  facts; do not implement coffee-specific compulsory behavior.
- Continue finite-resource extraction, isolation and validated maintenance stages;
  neither repeated coffee nor a green suite completes the full objective.
- Preserve Coffee-01 as the later offline overlapping-gesture regression. No H3
  provider session until the remaining simulation gates and separate agreement.

## Changed-prerequisite trial: physical integrity holds, stored text crosses a decision boundary

Added opt-in `--intervention=drain-first-pour` to the focused coffee evaluator.
The helper changes only the actual pot quantity/state during an observed pending
pour with a current body reservation and matching actor/target/source identities.
It records the operation ID and before/after quantities. No admission means
`not_triggered`, not success. There is no injected thought, reaction or goal.
Offline tests cover actual interrupted completion, no liquid creation, no
historical/stopped trigger, cancelled body reservation and replaced target.

Trial `recordings/sitcom-coffee-boyfriend-9iGqXn`, label
`reliability-coffee-prerequisite-01`, ran the full 120 seconds, core-only,
priority controller, reconsideration/narrative mind on, configured model unchanged,
no H3. The full suite did not run concurrently with this latency trial.

- Jerry began pouring at 42s; the operator removed four portions immediately
  after admission. Completion failed at 44s; mugs remained empty, no drink and no
  repeated impossible pour occurred. His 46s activity review explicitly noted
  the empty pot. He told Elaine at about56.2s; she responded at61.9s. This is real
  evidence uptake and public disclosure, not a prescribed recovery action.
- Elaine collected her cookie and closed its tin. Coffee was now impossible;
  this is not counted as an autonomous coffee completion. Both sustained jokes
  about the absent coffee through the end. Each had three activity reviews;
  the reviews were not missing, but continued to expect the next reply.
- Mean synchronous tick 2.44ms, zero slow ticks. Foreground scheduler p95:
  Jerry 3,702ms (36 completed operations), Elaine 3,154ms (40). These include
  fast paths and are not raw provider latency. The narrower emitted decision
  event sample gives 3,700ms/3,991ms; do not interchange the populations.
- Elaine's message, delivered at 54.03s, inaccurately said she was having a cup.
  Crucial trace: background plan 138 first appeared at 43s with steps **close
  tin -> send exact prewritten reply -> pick up mug**. The reply began at48.5s,
  without a fresh foreground decision; her continuation still referred to an
  earlier spoken acknowledgment. The physical phone receipt is truthful about
  sending text, not proof that the text's coffee claim is true.
- Actor-local perception did expose empty mugs/pot. The foreground prompt already
  distinguishes planned/attempted actions from completed ones. Adding another
  honesty sentence would not fix background text automatically executing later.
  Next repair: a capability-declared fresh-decision boundary for context-sensitive
  commands, retaining a goal/proposal but not replaying their authored wording
  through plans or learned routines. No semantic keyword policing or forced reply.
- Offline projection failed independently: `performance_overflow`, committed
  speech/gestures needed 10,651ms against an8,500ms budget, cursor38,220.001ms,
  seven issued versions. The physical/cognitive world continued to120s. The
  runner's exit1 correctly preserves this renderer failure; do not call the
  run an overall pass or launch H3. Outer log:
  `/tmp/argos-coffee-prerequisite-live-01.log`.

This is a retained diagnostic failure/partial success, not a fixed-version
matrix pass. No runtime source changed during the trial.

### Fresh command selection repair (subsequent source version)

- Added `AffordanceDefinition.requiresFreshDecision`, an automatic-selection
  policy rather than a physical prohibition. The apartment phone declares it
  for reply; an unrelated `transmit_update` test proves this is not a spelling
  rule. Generic capabilities may opt in for other context-dependent judgments.
- Stored plan readiness/admission rejects such a command and leaves the owning
  goal active for reconsideration. A learned procedure yields at that command;
  the public fast selector also checks legacy behavior/contract candidates.
  Native/direct execution remains available with its existing physical checks.
- Background planning sees the live policy in command help and is instructed
  to stop automatic planning before that decision boundary. A stale command is
  identified as requiring reconsideration, not mislabeled physically impossible.
- No text is rewritten or semantically censored; no actor is forced to reply.
  This fixes a demonstrated route by which background-generated text became an
  automatic outward assertion. Fresh cognition can still make a bad assertion,
  so behavioral improvement requires a new trial, not inference from green tests.
- Red regression:3 failures/1 pass in `/tmp/argos-fresh-command-red.log`.
  Focused gate:58 passed across fresh-command, native phone, background prompt
  and productive-work tests (`/tmp/argos-fresh-command-focused.log`).
- Pre-repair full suite (intervention only):268 suites/3,356 passed/10 skipped,
  184.237s, `/tmp/argos-prerequisite-full.log`; TypeScript passed. This is not
  the full-suite count for the later fresh-decision source version.
- Scope note: the older standalone Mara `phone-demo.ts` capability has not yet
  been opted in. Speech's existing evidence fences, generated dialogue and
  typed commands elsewhere need separate audit; this change is not a claim
  that all communication now has equivalent semantics.
- Subsequent full gate:269 suites/3,362 passed/10 skipped,169.821s
  (`/tmp/argos-fresh-command-full.log`), TypeScript passed
  (`/tmp/argos-fresh-command-final-typecheck.log`), `git diff --check` clean.
  No source changes between this gate and the next live trial.

### Prerequisite-02: fresh-decision source, no reply adoption

`recordings/sitcom-coffee-boyfriend-cZti8k`, label
`reliability-coffee-prerequisite-02`; same120s/core-only/priority/narrative/
reconsideration configuration and fixed texts/intervention. No H3, source frozen
for the trial, no concurrent test suite. Terminal exit0. Outer log:
`/tmp/argos-coffee-prerequisite-live-02.log`.

- Jerry admitted a pour at46s, pot changed4->0, completion failed48s. He
  expressly noticed at49.5s and disclosed the empty pot about53.9s. Elaine
  responded about60s. No filled mug, drink or repeated impossible pour.
- Elaine actually moved back to Living Room at65.5s, Jerry at71.5s. Both
  continued joking about the missing coffee/cookie, then imaginary bakery
  police. Returning to conversation was a genuine choice after infeasibility,
  but this does not establish that pacing/extended banter is tuned well.
- Texts were actually read at17.2s/31.2s. Neither received a reply. There was
  no inaccurate outgoing message, but **no adopted reply means no behavioral
  proof of improved wording**. The second message asks to text when leaving;
  nobody left for dinner, so no reply is not itself a failure or evidence of
  deliberate decline. Keep the demonstrated automatic-replay repair separate.
- Mean synchronous tick5.99ms, zero slow ticks. Foreground scheduler p95:
  Jerry2,584ms/Elaine4,178ms,37 completed operations each. These include fast
  paths, not only provider calls.
- Offline projection17 versions through120,000ms, no reported error/reason.
  This does not repair the retained Coffee-01/Prerequisite-01 overflow cases.
- Narrative review candidate: Elaine's latest recollection says she told Jerry
  visibility outside was shot and wipers were making frosting. It retains
  own-speech attribution, but loses the explicit imagined-joke framing seen in
  Jerry's recollection. No ECS weather/car mutation occurred. Test preservation
  of hypothetical/joking modality separately rather than claiming physical
  corruption or using literal-word censorship.

Checkpoint: all tests and trials terminal.269 suites/3,362 passed/10 skipped,
TypeScript and diff checks green; goal still incomplete. Next bounded checks:
1. Predeclare an outcome-question trial (e.g. ask how the coffee turned out
   after the intervention) to offer a natural reason for a fresh reply. Preserve
   non-adoption as inconclusive; do not inject the answer or enforce replying.
2. Apply/audit the same capability boundary in the older Mara phone package;
   test foreground admission and native transport, not just selector rejection.
3. Continue the reusable finite-resource extraction and isolation stages. Avoid
   spending the whole goal on stochastic coffee banter or declaring a10-run
   fixed-version matrix from these changing-source diagnostic trials.

## Mara policy propagation, finite-portion extraction, isolation reproduction

- Mara's shared-runtime `phone-demo.ts` reply capability now declares the same
  fresh-decision policy as the apartment. The production integration test in
  `phone-living-world.test.ts` verifies the command remains discoverable after
  actual reading, cannot run as a stored plan step, and still types/delivers via
  deliberate native execution.32 tests passed across the phone, shared-runtime,
  continuity and fresh-command suites (`/tmp/argos-mara-fresh-final.log`).
  Initial regression placement in the legacy injected-decider fixture was
  wrong: that fixture intentionally has no shared capability registration.
  Retained red logs reflect that harness error, not a failed production policy.
- Extracted `world/finite-portions.ts`, exported from the library entry point.
  It binds existing component columns instead of keeping duplicate inventory.
  Supply availability, vessel state/counter validity, finite transfer and
  consumption now have one implementation used by the apartment executor.
  Legacy `SitcomCoffee`/`SitcomCup` serialized fields remain authoritative.
- Kernel tests use differently named coffee/mug and oil-reservoir/lantern-chamber
  seeds with differently named bound ECS columns. They prove conservation,
  empty supply, no double transfer/consume, stale expected counters, removed
  entities, wrong component/target, invalid/fractional/infinite quantities and
  counter overflow. Native apartment tests still exercise real timed pours,
  physical revalidation and the mid-pour intervention.47 focused tests passed
  before adding a library-export smoke test (`/tmp/argos-portions-focused.log`).
- Scope: these are commit primitives, not standalone action authorization.
  The caller still owns identity, source epoch, reach, possession, reservation,
  duration, effects/labels and receipts. This extraction does not yet prove a
  second full autonomous world using the mechanic, nor fix move-away-and-back
  history/ABA issues or arbitrary resource types/capacities. Stage4 is open.
- Read-only fresh-process probe reproduced both isolation failures:
  create worldA/entity1 with Name=`ONLY_A` and registry component`ProbeOnlyA`;
  create worldB/entity1 with Name=`ONLY_B`, initialize its registry. Result:
  `{aEid:1,bEid:1,aNameAfterCreatingB:"ONLY_B",registryHadA:true,
  registryHasAAfterB:false}`. No live user server or saved world was modified.
- Isolation design selected per the recorded plan: one active world per worker
  process, with a normal library host API and explicit legacy in-process limits.
  A numeric identity fence or shared allocator alone cannot isolate registry
  resets and Steward globals. Next implementation must enforce construction/
  reset/restore lifecycle in the worker; test two hosts with overlapping names
  and schemas, ticking, extension, resets and teardown. Do not claim this host
  exists yet, or run two library worlds concurrently in the existing process.
- Final gate:270 suites/3,372 passed/10 skipped,167.41s
  (`/tmp/argos-portions-full.log`), TypeScript passed
  (`/tmp/argos-portions-final-typecheck.log`), diff check clean. All tests
  terminal; no live model/H3 trials, server restarts or commits this turn.

## Process host: initial enforced lifecycle boundary

Implemented `runtime/simulation-host.ts` and its internal child-process worker,
exported as `createSimulationHost` from the library. Each worker constructs one
actual `ArgosSimulation`. Config/value IPC is bounded and does not expose eval or
live ECS references. Reset replaces the worker process; close/disconnect tear it
down. Requests are serialized, reject while resetting/closed, and uncertain
timed-out mutations terminate the worker rather than silently retrying.

`createArgosWorld` rejects second construction when running under the process
host. Legacy in-process APIs remain documented as unsafe for concurrent worlds;
their behavior was not silently rewritten for every existing caller/test.
See `PROCESS-ISOLATED-SIMULATION-HOST.md` for the explicit boundary and limits.

Three initial tests launch real child processes:
- Two simulations have overlapping entity/component names but distinct values,
  schemas and clocks. Reset A changes its PID and permits a new schema of the
  same name without changing B's complete exported state (apart from the export
  wall timestamp). Closing A leaves B able to tick and retain its values.
- Invalid attachment and prevalidated invalid reset input fail explicitly while
  the existing worker remains usable. Requests after close reject.
- A second raw world construction inside an isolated process is rejected.

Focused gate:3 passed (`/tmp/argos-host-green.log`); initial test failure compared
snapshot `savedAt` wall timestamps, not differing simulation state, and was
corrected to compare all other exported fields. No provider calls in these tests.

Incomplete: restore is deliberately absent rather than implemented as duplicate
entity loading. Current deserializeWorld appends into a supplied world, while
createSimulation has already seeded and bound a God agent/runtime. Next repair
must place restore at construction and rebind actual runtime state, then prove
restored ticking and extension across workers. Generated-system hot activation,
bounded logs/health/events, stalls/crashes/races and packaged-runtime discovery
also need coverage. This is progress toward stage4, not completion of it.
- Final gate:271 suites/3,375 passed/10 skipped,247.783s
  (`/tmp/argos-host-full.log`), TypeScript passed
  (`/tmp/argos-host-final-typecheck.log`), diff check clean. All test workers
  terminal; no H3/model runs, user-server restarts or commits this turn.

## Host restore construction and candidate replacement

- `SimulationConfig.restoreSnapshot` and `SimulationHost.restore` now restore
  trusted saves in a fresh worker. Construction reuses the one seeded God entity
  through an explicitly validated deserializer option, remaps other entities and
  relations, rebuilds God lookups and initializes God/local/runtime/server ticks
  from the save. Preset/population/scaffold generation is skipped; genesis/setup
  and schedule regeneration cannot be combined with restore. Daemon/spirit
  construction follows loading; AI-on integration is not yet behaviorally proved.
- Saved schema now carries affordances (including fresh-decision policy), runtime
  affordances, object types, rules and traits. Restore replaces its maps in place
  so God/rules/object-manager references retain the same authority. Legacy saves
  without schema remain readable. This is not a host-permission restore.
- Candidate workers initialize and export successfully before the current worker
  is closed. Invalid/duplicate entity envelopes, missing God and inconsistent
  clocks reject before replacement. Strict restored-system compilation rejects
  a bad candidate, and tests verify the original PID/clock remain usable.
- IPC values/config are cloned before awaits so later caller mutation cannot
  alter queued data or retained runtime permissions. Worker loader resolution is
  relative to the library via `createRequire`, not the caller's working directory.
  `import.meta.resolve` initially failed under Jest's VM and was replaced.
- Actual two-worker restore tests deliberately shift A's saved IDs by1000, verify
  exactly one correctly bound God, lookup IDs, saved clocks and values, run a
  restored authored counter on the next tick, and extend A without changing B.
  This is runtime execution evidence, not only JSON equality. Candidate compile
  failure and undefined/invalid restore also have regressions.
- Focused restore gate6 tests passed (`/tmp/argos-host-restore-atomic.log` before
  final input-copy/undefined refinements). Full final gate271 suites/3,378 passed/
  10 skipped,192.086s (`/tmp/argos-restore-full.log`); TypeScript passed
  (`/tmp/argos-restore-full-typecheck.log`); diff clean. All tests terminal.

Important unfinished restore requirements found in this audit:
1. Package-specific capability callbacks are not serialized/reinstalled. Add a
   durable package-requirement/manifest and explicit rejection or reattachment.
   Do not silently treat a restored apartment phone's component data as an
   operational phone executor. Generic isolated-host snapshots are the tested
   path; native demo package revival is not proved.
2. SerializedSystem omits SystemDefinition.async. Its deserializer currently
   compiles code with await but does not restore its async scheduler flag. Fix
   serialization/legacy inference and test delayed restored work in the actual
   lane before claiming async maintenance survives restore.
3. Continue host event/log/health exposure, crash/reset-race coverage, validated
   generated hot activation and AI-on restored cognition/guardians. No full
   stage4/5 completion claim follows from synchronous counter tests.

No provider/H3 runs, user-server restart or commit this turn. Goal remains open.

### Restore scheduler lanes and native package requirements

Saved systems now serialize their async flag; restore retains it or applies the
existing await heuristic for legacy code, and clears the old running flag. Tests
prove async work does not run in synchronous ticks or duplicate while pending.
Explicit async code without await retains its lane. Old callbacks are not revived.

Native agent capability registration leaves a sticky runtime package requirement.
It survives capability disposal and data-only deserialize/reserialize. Generic
executable restore rejects marked snapshots before replacing the current worker;
the host test verifies its PID remains unchanged. This does not implement package
reattachment or detect every legacy snapshot lacking a marker.

Validation: focused 3 suites / 10 tests passed in
`/tmp/argos-restore-lanes-tests.log`. Full suite: 273 suites / 3,382 passed /
10 skipped, 194.5s, `/tmp/argos-package-lanes-full.log`. TypeScript passed
(`/tmp/argos-package-lanes-full-typecheck.log`); git diff --check clean.
No provider calls, H3 runs, demo-server restarts or commits. Continue host
observability, generated hot activation and integrated cognition/maintenance
validation; overall goal remains incomplete.

### Isolated host health inspection

Added library-exported SimulationHostHealth and host.health(): read-only registry
health and simulation stats, bounded system count and error strings. No event or
error queues are consumed. A real worker restores a deliberately throwing authored
system, steps, reports its error identically on repeated inspection, and continues
to a second tick. Focused host suite: 7/7 passed, 9.952s,
`/tmp/argos-host-health-tests.log`; TypeScript passed in
`/tmp/argos-host-health-typecheck.log`. Full suite not rerun for this change.
This does not prove useful generated behavior or maintenance recovery. No models,
H3 calls, server restarts or commits. Goal remains active.

### Managed engineering host entry point

Added requestSystemBuild/getCodingStatus forwarding to the actual simulation
daemon; disabled engineering rejects without enabling builders. No direct code
activation bypass added. Existing valve integration proves validated hot-load,
native physical interaction, and rejected replacement in its in-process fixture;
host-enabled activation is still unproved. Audit: legacy system-baker testSystem
invokes fn(world,testCtx) on its supplied world; system-loader preflight constructs
a scratch world, incompatible with the hosted second-world guard. Use managed
daemon for host integration rather than these legacy paths.

First focused run failed only because the new assertion expected “enabled” rather
than the actual “Enable codingDaemons” error. Corrected exact assertion; rerun
2 suites/8 tests passed, 10.444s, `/tmp/argos-host-engineering-retest.log`.
TypeScript passed (`/tmp/argos-host-engineering-typecheck.log`). No full suite,
provider calls, H3, server restarts or commits. Goal remains incomplete.

### End-to-end managed host activation, deterministic builder subprocess

The host test now uses a local executable fixture via ARGOS_CODEX_BIN inherited
only during worker construction (parent environment restored immediately).
No inference runs. It exercises the actual builder transport, candidate files,
independent admission, tick-boundary activation, dynamic component attachment,
managed execution worker and ECS commit. World PID stays unchanged, clock advances,
counter value increases and coding status reports committed results.

First run rejected the fixture for missing boundary/negative acceptance coverage;
added a negative-input test without altering validation. Rerun: host suite 8/8,
14.933s, `/tmp/argos-host-activation-retest.log`. TypeScript passed in
`/tmp/argos-host-activation-types.log`. This proves the plumbing with a deterministic
counter, not an AI builder's design quality or autonomous spirit maintenance.
Temporary candidate/release artifacts remain in the OS temp directory for review.
No H3, model calls, demo-server restart or commit; full goal remains open.

### Hosted replacement rejection preserves actual execution

Extended the managed host integration with a second request whose host acceptance
requires an incompatible result (100 instead of the fixture's increment). Actual
candidate validation rejects it; original job retains active ownership and the
same process commits a further ECS increment AFTER rejection. This last temporal
assertion avoids mistaking work during validation for continued post-rejection
execution. Final host suite: 8/8, 17.485s,
`/tmp/argos-host-rejection-final.log`; TypeScript passed in
`/tmp/argos-host-rejection-types.log`; diff clean. No full suite rerun or models.

Next isolation issue from source audit: CodingDaemon defaults its directory from
world.meta.name and has no directory ownership lock. Same-name hosts therefore
select the same release/inbox files despite independent process memory. Explicit
shared paths have the same issue. Need tested ownership/collision policy, including
reset candidate overlap, before claiming concurrent engineering isolation.

### Hosted engineering directory ownership

Hosted CodingDaemon initialization claims an exclusive canonical-directory lease
before release access. Holds through process exit; normal close releases only its
own token. Tests cover alias collisions, replaced-token preservation, second-host
and same-store reset rejection preserving the old PID, then close/reopen restoring
the accepted release. 2 suites/10 tests pass, 13.903s,
`/tmp/argos-directory-owner-final.log`; TypeScript passed in
`/tmp/argos-directory-owner-types.log`; diff clean. No full suite or provider runs.

Limits: crash/SIGKILL leaves a conservative stale lease requiring explicit recovery;
same-store automatic reset handoff not implemented; legacy non-hosted daemons do
not participate. This is cooperative writer exclusion, not a filesystem security
sandbox. Goal remains open.

### Integrated regression checkpoint and batch start

Full suite terminal and green: 274 suites, 3,386 passed, 10 skipped, 206.667s,
`/tmp/argos-host-integrated-full.log`. TypeScript passed in
`/tmp/argos-host-integrated-types.log`; diff clean. Only after tests ended, started
batch01 coffee01: 120s core-only production cognition, no H3, existing models.
Artifacts `recordings/sitcom-coffee-boyfriend-Uw7dlU`; log
`/tmp/argos-b01-coffee-01.log`, exec session74806. Running, not yet scored.

### Native cancellation terminal receipts

Batch01 episodes1–3 are now terminal; reviews in LIVING-WORLD-BATCH-01.md.
Episode3 exposed a native reading interval started119s,expected120.2s with silent
cancellation at120s. Added regression for unfinished pickup: failed before fix
because only pending event existed (/tmp/argos-cancel-before.log). Native timeline
cancellation now publishes failed terminal interval at actual time, fenced by
actor identity/source and pending ownership; no action effect or plan completion.
Replacement identity test suppresses stale attribution. 3 focused suites/46 tests
pass (/tmp/argos-cancel-focused.log), TypeScript passes (/tmp/argos-cancel-types.log),
diff clean. Existing director tests pass but exact document/renderer shutdown
integration and package-specific cancellation still need new coverage.
No model/H3 run this turn. Batch01 closes incomplete after3 episodes because
production source changed; preserve all evidence, label successor separately.

### Apartment timed-action cancellation

Added actual phone-read stop regression: initially only pending event, so test
failed (/tmp/argos-phone-cancel-before.log). Package cancellation now publishes a
failed terminal interval while original pending ownership/source/actor identity
still match. Failed cancellation receipts may publish during package stop but
never after source seal; normal pending/success publication remains stopped.
Message remains unread, secret absent from public events, repeated stop emits no
duplicate. 2 suites/45 tests pass (/tmp/argos-phone-cancel-after.log), TypeScript
passes (/tmp/argos-phone-cancel-types.log), diff clean. Still need explicit full
director-tail integration for document reading and source replacement test. No
provider calls, H3, demo-server restart or commit this turn.

### Full document-to-director cutoff regression

Actual offline duet native read starts119000,expects120200; stop120000 emits
failed terminal receipt and director drains through source120000 with reasonnull.
No completion effect is invented. Separate native cancellation test closes/replaces
the event source before cancellation and verifies no old receipt enters the new
ledger. 3 focused suites/77 tests pass,4.032s,
`/tmp/argos-cancel-integration.log`; TypeScript passes
`/tmp/argos-cancel-integration-types.log`. Full suite started separately in
`/tmp/argos-cancel-full.log`; not yet terminal at this entry. No live model run.

Subsequent checkpoint: full suite terminal exit0,274suites/3391passed/10skipped,
185.088s, `/tmp/argos-cancel-full.log`. Only after completion started batch02
coffee01,120s core-only production cognition, same settings,noH3. Log
`/tmp/argos-b02-coffee-01.log`; unscored/running. No source change during run.

### Post-batch continuity diagnostics (not acceptance replacements)

After persistent-activity, actor-selected waiting and route-origin repairs,
clean full regression passed279suites/3458tests/10skipped191.594s:
`/tmp/argos-route-origin-clean-full.log`. Detailed intermediate failures and fixes
remain in RELIABILITY-NOTES. Batch02 remains closed failed; no scores replaced.

Three subsequent unchanged-source120s focused/core-only diagnostics,priority
controller,reconsideration/narrative-mind on, noH3:

- `sitcom-logistics-boyfriend-ePUXP3`: two texts answered, cookie retained,
  documentrevision3 butunfinished. Conversation explicitlycontinued by encounter
  reviews. No departureattempt; stale-route repair not tested live.
- `sitcom-coffee-boyfriend-mBYh5d`: Elaine pickedmug74.8s,poured81.5,drank106.
  Finitepot4→3,mugempty/drinks1. Actualautonomouschain despiteextendedbanter.
- `sitcom-coffee-boyfriend-dg2Jra`: drain-first-pour triggered41.5,Jerry'spour
  failed43.5;pot0,bothmugsempty/drinks0. He reportedempty pot49.2;Elaine responded
  and later interpretedhisexcuseagainstherpreviouslyreadtext. Noinventeddrink.

Allthreefinished120s,failed:null,offlineprojectioncursor120000/reasonnull,zero
slowticks. Mean ticks5.64/5.41/6.15ms respectively. These support specific
mechanical and behavioral claims, not a general realism or repeatedbatchpass.
Longsoaks,maintenance-on,growth and actualH3 remain separate requirements.

## 2026-09-07 — managed release snapshot restore

Production host regression initially failed with `Could not restore system:
Count` (14521 exit 1; `/tmp/argos-managed-restore-red.log`). Managed module source
was being restored through the ordinary system-body compiler. Repaired using
explicit release provenance, inert raw-deserialization placeholders, and matching
caller-selected accepted release history before managed-worker rebinding.

First focused host/raw persistence checks: 84110 exit 0, 12 tests / 2 suites,
17.641s. Expanded initial checks: 18668 exit 0, 110 tests / 14 suites, 29.043s.
Strengthening replacement coverage with an additive field then reproduced a
second defect: older accepted releases rejected the newer saved field
`Rust.wet` (34303 exit 1, two failing cases;
`/tmp/argos-managed-additive-red.log`). Both compatibility checking and schema
application needed to retain fields proven by validated later release history.
The first partial repair still failed at schema application (65259 exit 1).

Final expanded checks: 38103 exit 0, 110 tests / 14 suites, 29.379s,
`/tmp/argos-managed-restore-verified.log`. Coverage includes actual hosted counter
progress before/after restore, rejection of missing stores and altered source,
inert raw loading and re-saving, latest accepted replacement, additive schema,
active/paused state, and rejection of subsequent field removal. TypeScript first
caught an optional saved-default assignment; after guarding it, 34021 exit 0
(`/tmp/argos-managed-restore-types-final2.log`). Full suite follows below.

No model calls, H3, default changes, server restarts, or recording modifications.
This is deterministic lifecycle evidence, not an autonomous maintenance or
naturalness pass. Same-store live reset remains rejected by the writer lease;
close-then-restore is the supported tested path. Native runtime packages and
legacy managed snapshots without provenance remain explicitly unsupported by
generic executable restore.

Full regression: 79955 exit 0, **281 suites / 3517 passed / 10 skipped**, 195.463s,
`/tmp/argos-managed-restore-full.log`. This includes the optional-default guard.
Whole-worktree `git diff --check` passed. All invoked processes are terminal.

## 2026-09-07 — explicit bounded architect correction

Reproduced historical duplicate checks preventing any same-need/name correction
after a failed build. Added explicit `revisionOf` plus cited failed-proposal
evidence, failure reasons in architect context, a two-correction chain budget,
and fresh-state admission after design. Pending/completed/rejected work cannot
be retried; duplicate branches and unavailable ancestry fail closed.

Production architect/CodingDaemon/native-valve integration now proves rejected
rate-three candidate -> failure reason in both model prompts -> explicit revised
proposal -> accepted rate-two worker -> close stops / reopen resumes quantity.
Native ticks continue while building, and exactly two jobs are present. Model
outputs, builder artifacts and physical actions are deterministic fixtures—not
autonomous God/NPC behavior or a complete maintenance-enabled model evaluation.

Red8437 exit1 one failed/six passed. Invalid-path fixture54788 exit1 was corrected
without changing package validation. Integration4516 exit0 nine tests; expanded
64044 exit0 47 tests/four suites/3.78s; types21274 exit0. FULL42155 exit0,
**281 suites / 3520 passed / 10 skipped**,195.863s,
`/tmp/argos-architect-recovery-full.log`. Diffcheck clean, processes terminal.
See MAINTENANCE-REVISION-DIAGNOSIS.md for contracts, artifacts and remaining gaps.

## 2026-09-07 — library maintenance report delivery under observer failure

Real library integration found typed EventEmitter delivery could let a throwing
public subscriber abort CodingDaemon's entire event callback, losing later
public delivery and God/requester inbox reports while builds still activated or
rejected. Red31204 exit1: healthy variant passed; broken subscriber failed.
Fixture uses standard spirit hierarchy, actual library event wiring and managed
subprocess builder; God execution/evolution/server are off and fetch unused.

Typed observer delivery now isolates synchronous and async failures (including
named actor/room channels), preserves once/order, and exposes bounded copied
observer health without storing payload/exception text. Raw string EventEmitter
calls and command injection unchanged. First focused99405 exit1 exposed a test's
wrong singular channel name; corrected to systems. Final90537 exit0,16tests/
twosuites2.794s; types49647 exit0. Full91280 exit0: **282 suites / 3524 passed /
10 skipped**,201.481s,/tmp/argos-managed-feedback-full.log. All three expected
observer warnings came only from intentional-failure fixtures, not swallowed
assertions in unrelated suites. Diffcheck clean; all processes terminal.

Both terminal states reach later public listener, God inbox and requester inbox
exactly once while God's autopilot remains disabled. This proves report receipt,
not supervisor judgment or closure of a world capability gap. Details and limits
in MANAGED-FEEDBACK-DELIVERY.md. No model/H3 calls or demo-server changes.

## 2026-09-07 — live maintenance pipeline diagnosis and schema-grounded design

Two bounded no-H3 diagnostic runs retained. V18oSY: 179.5simsec/359ticks,
mean2.64ms,0slowticks, zero active generated mechanics. God requested its first
build only at172.736wallsec; shutdown cancelled it. Earlier designer non-admission
reasons were not captured, so do not infer them. Mara repeatedly inspected
unchanged props; no generated-water response occurred.

Added operator-only, world-scoped bounded architect diagnostics and runner
post-stop terminal job/inbox evidence. Follow-up F8IBAC:299simsec/598ticks,
300.351sampledwallsec,mean4.01ms,0slowticks, zero active generated mechanics.
Three designs missed mandatory contract fields, a fourth invented built-in
fields, and its worker was rejected for redefining Container. An overlapping
God request was cancelled at shutdown. Both CLI exits0 mean diagnostic completion,
not acceptance. Artifact directories and protocols are in
MAINTENANCE-LIVE-DIAGNOSTIC.md; failed recordings remain unchanged.

Reproduction28002 exit1: two new schema/prompt tests failed, ten existing passed.
Designer now receives complete valid managed JSON example, authoritative public
field schemas, correct tick frequency and elapsed-time semantics. Admission
rejects invented/wrong-type built-in fixture fields and write coordinates before
building. Focused57752 exit0,49tests/3suites3.398s; types16517 exit0. No NPC policy,
model defaults, H3 or demo-server changes. Full suite recorded separately below.

Schema-only full85673 exit0:283suites/3528passed/10skipped198.723s,
/tmp/argos-managed-design-contract-full.log.

Read/write/context boundary regressions then exposed six newer private cognition
components omitted from the managed policy (WorkingMemoryIdentity already had
write protection). Red66467 exit1,13failed/44passed; forbidden packages reached
ready. PRIVATE_MANAGED_COMPONENTS now includes these records and protected state
includes all private state by construction. Focus80299 exit0,64tests/5suites
6.141s; types54565 exit0; FULL83211 exit0,**283suites/3540passed/10skipped**,
197.001s,/tmp/argos-managed-cognition-boundary-full.log. Scoped diffcheck clean.
No full-suite failures. One prospectively recorded300s verification follows;
these deterministic results are not a live maintenance or behavioral pass.

## 2026-09-07 — F42UWy live mechanic, then current-state feedback repair

Post-contract/boundary verification86549 exit0, recordings/maintenance-growth-
F42UWy. 300.308sampledwallsec/299simsec/598ticks, mean5.17ms,0slowticks,
observerfailures0. Exactly one proposal/job, active after four acceptance checks.
First builder pass hit length; second stopped normally. No added physical props.
Weaver design admitted34.5simsec; first sampled activation/water72s; Mara first
sampled seeing risingwater75s; cap10reached82s; nativeclose84–85s. Actual final
ECS: valveclosed, FluidLevel.volume10. 456workerattempts/454commits/1stale/0failures;
commits include no-ops. God received active-build report. Process2382 terminal,
lock released, no H3/defaultchanges/serverrestart. All original artifacts kept.

One live causal maintenance chain, not repeated-growth/realism acceptance. At
capacity before closure, so no claim that Mara prevented overflow; closed-valve
acceptance below capacity is separate evidence. Spirits/nudges enabled and not
an unaided-cognition control. Post-success monitoring and stale close nudges
remain visible. See MAINTENANCE-LIVE-DIAGNOSTIC.md for scope and precise sequence.

Code trace found spirit prompt only got object names/placement, omitting public
ObjectState.current and Description.value. Added regression through real snapshot
and mocked-provider spirit cognition, with open->closed change and private-field
sentinel excluded. Red30665 exit1,onefailed/fivepassed. Fix carries bounded public
fields from actual component membership into spirit prompt; no new action rules
or lexical suppression. Focus50093 exit0,36tests/5suites4.243s; types23830 exit0.
Final full suite recorded below. No live behavior result after this last repair.

Final71506 exit0: **283suites/3541passed/10skipped**,198.795s,
/tmp/argos-spirit-physical-feedback-full.log. Scoped diffcheck clean; all owned
processes terminal. Live F42UWy predates this last public-state projection fix;
keep that distinction when reporting behavior. Broader goal remains incomplete.
