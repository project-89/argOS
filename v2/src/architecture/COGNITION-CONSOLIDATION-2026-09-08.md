# Cognition consolidation — bounded control-loop pass

2026-09-08. Active priority, superseding cognition mechanism expansion. Checkpoint:
recordings/cognition-consolidation-checkpoint-01.PHlxjc/README.md. Baseline06 is
still 6/10; the S5 diagnostic is separate. The implementation snapshot below now
has a fresh9/10 baseline and600sim/602.120wall-second endurance health pass. A
completion-audit lifecycle bypass is now corrected offline; amended-source live
acceptance remains OPEN. See the follow-up section below.

## Ownership map (before consolidation)

| Concept | Durable owner / writes | Read / act boundary |
| --- | --- | --- |
| Needs, affect, enduring concerns | Needs/Mind and narrative emotional-life state; deterministic dynamics, admitted affect/appraisal, reflection | Salience and context, not motor authority or physical success |
| Goals / personal intentions | Goal + GoalLifecycle + HasGoal; goal-lifecycle admits creation; goal-pursuit admits foreground defer/release/withdraw; intention-reconsideration admits background edits; autonomous/schedule sources also create proposals | Native goal-evaluation owns objective success. Subjective social satisfaction is explicitly separate. Cleanup/expiry is not accomplishment |
| Ongoing activity | OngoingActivity; recordOngoingActivityChoice via accepted actor continuation; goal review settles its activity | Organizing purpose and interruption/return point, not the current command. Safe automatic resumption additionally requires a current runtime return grant |
| Immediate intention | CognitiveControl; actor-continuation integrates accepted purpose and updates exact revision status | foreground-action-admission owns the current runtime execution grant. Restored prose alone cannot execute |
| Strategy / plan | Plan + HasPlan; background planning or admitted bounded motor plan; cursor changes through plan reconciliation and captured native outcomes | Plan is a proposal/skill sequence, not authority for fresh speech, phone commands or unseen facts |
| Fresh decision frontier | PlanningDecision attached to Plan; planner prepares; foreground selects/defers/declines | Cannot execute its own prose or authorize speculative successors |
| Conversation / engagement | SocialMemory + activity-review encounter state and owned heard/completed-turn receipts | activity-review means SOCIAL ENGAGEMENT review, not ownership of OngoingActivity. Closing an encounter does not finish a practical goal |
| Promises / joint work | CoordinationMemory; owned speech/sent receipts and admitted coordination reviews | Reports are not native completion. Physical work uses captured command/target identity |
| Immediate condition wait | actor-wait runtime state and admitted wait authority | Condition-based readiness; no goal success from timeout or merely heard agreement |
| Stored plan wait | Plan step + plan-evidence-barrier | Same evidence-grounding primitives; a stored wait is not automatically an actor-selected waiting commitment |
| Body / voice / package job | Temporal/native execution records, package capability and exact deferred execution identity | Executors own duration, resource occupancy and effects. Cognition cannot declare a pending action complete |

Key source modules are under src/cognition. Public ECS schemas and relations
remain the interface. Runtime grants are deliberately not durable authority.

## Control loop and precedence

```
world clock + native completions
  -> actor-scoped perception / working memory / attention
  -> settle existing admitted continuation (if any)
  -> availability + readiness + goal/plan maintenance
  -> existing automatic selector OR foreground deliberation
  -> validate mental update and execution separately
  -> native executor / timed body or voice
  -> exact completion evidence -> memory, plans, readiness, next actor step
```

### Live admission: index.ts and cognition-system.ts

WorldTick advances simulation time and native systems independently of inference.
ActorControl calls runActorControlStep per actor, including intake while that
actor is deliberating. It admits filtered stimuli, resumes eligible deferred
goals, polls an already admitted foreground continuation first, then checks body/
voice availability and readiness. It observes local state, reconciles coordination
and plans, and invokes selectFastAgentAction. A missing automatic choice requests
the per-actor asynchronous AgentCognition lane, not a new controller.

runCognitionCycle handles queued-event admission, round-robin budgeting and
parallel model requests. It preserves busy/nonadmitted actors' inputs, gathers
actor-local observations, and uses capability/source task cancellation fences.
agentThink rechecks the SAME fast selector after queue delay; that is deliberate
freshness, not a second independent priority policy.

### Automatic selection: agent-mind.ts selectAutomaticAgentAction

Exact current order; earlier returns exclude later branches:

1. Task/source guard; settle actor wait. A live owned purpose needing revision
   requires deliberation. Compute new attention/reconsideration.
2. Without reconsideration or occupancy, try a granted, still-current physical
   return step for the organizing activity. No fresh-command replay.
3. Existing `situated` mode: only the admitted continuation's allowed plan step;
   otherwise deliberate (or disabled-LLM wait). Keep this existing mode.
4. Live actor-owned purpose in default mode: require a dispatched continuation
   and its selected goal. Try that goal's plan step, then its non-wait contract
   candidate; an awaiting-decision plan requires fresh deliberation. Return here.
5. Compatibility/no-owned-purpose branch: top-goal awaiting-decision barrier;
   then procedural skill (unless reconsidering).
6. Failure recovery unless a behavior policy or new external attention takes
   precedence. A recovery wait only substitutes for cognition without a key.
7. Deterministic addressed-speech reply when AI/key is absent.
8. Organization contract priority (eligible ticket/wiki workflow).
9. Plan step when there is no policy or a deliberately chosen goal takes priority.
10. Behavior policy when no new speech, reconsideration or deliberate goal: direct
    action or start_procedure (including its existing learning record).
11. Remaining non-organization contract candidate.
12. No-AI/key/disabled-LLM wait, else fresh foreground model choice.

The outer selectFastAgentAction rejects fresh-decision-required affordances from
ALL automatic branches. Agent model output and public/direct executeActions calls
still pass native capability, local visibility, physical and temporal guards.

Nested paths matter: procedural-skills can resume a macro, auto-start a proven
goal macro, or substitute a learned skill for a plan interaction. It consults
getNextPlannedAction, which performs mutating reconciliation, not just lookup.
capturePlanExecution also consults this function before capturing issuance identity.
Neither call should be replaced with a naive current-cursor read during a refactor.
Policy/contract/no-AI paths are supported compatibility paths, NOT proven dead code.

Other entry points do not change that precedence: run-dev-server, run-simulation
and run-sandbox call runCognitionCycle then executeActions. The lil/MUD adapters
inject directed perception and call agentThink directly before native execution
(lil additionally filters hostile actions). Demo/eval dispatchers and operator
APIs can supply actions explicitly; those are external action inputs, not another
NPC deliberator, and operator actor actions remain disabled in the baseline.
createCognitionSystem is registration metadata with no compiled thinker.

The separate deterministic world systems are compatibility mechanisms, not part
of the live model selector: schedule/needs systems create candidate goals; legacy
goalPursuit and grid pursuit perform deterministic movement only behind their
AI-authority guard. World/system registration determines their ordering. Keep
those boundaries, rather than activating them as an extra live cognition path.
ActionRegistry publishes action definitions; registration is not a choice or
permission to execute. Dynamically authored world systems are outside this pass.

### Foreground vs background

| Lane | Responsibility | Handoff |
| --- | --- | --- |
| ActorControl, fast | Intake, readiness, safe continuation/resumption, lifecycle checks | Requests inference only when needed; never awaits planning/appraisal |
| AgentCognition, foreground | Immediate interpretation, choice, optional admitted mental updates | Frozen local/context fences; mental acceptance separate from later body/voice dispatch |
| ExperienceAppraisal, subconscious | Meaning, affect, narrative experience and eligible intention edits | Actor-owned actual read/heard experience only; stale present meaning becomes historical-only memory |
| CoordinationReview, subconscious | Interpret owned communication about commitments | Prepared source-bound memory updates, not speech execution |
| Planning, subconscious | Strategy proposals for eligible/current goals | Plan / PlanningDecision, never background-authored fresh executable dialogue |
| PersonalReview / Subconscious | Existing shared runAgentSubconscious chooses one due expensive faculty: reflection, autonomous goal, image reflection | Distinct scheduling readiness, same implementation; no second cognition agenda |

Legacy awaited batch tick/runFullCognitiveCycle remain supported. They explicitly
await planning/reflection in a different scheduling mode. Do not erase them as
dead code or quietly make live inference wait on them. Existing god/spirit/daemon
lanes are outside this pass; no expansion, removal or activation for these tests.

## Native outcomes back into cognition

executeActions captures actor/goal/plan episode, command, target, working-memory
before-state, coordination and wait authority BEFORE dispatch. Timed native work
resumes through exact action identity; package completion uses an exact owned
executionId and matching action/actor. Late A cannot settle identical retry B.

Successful/pending/failed issuance updates LastAction bookkeeping and appropriate
coordination/readiness. PENDING is neither a physical receipt nor progress.
At real completion, working-memory-observation records actor-owned physical facts,
original purpose and actual completion time. Witness projections do not copy
private purpose. Inspection is local. addMemory feeds salience; perception carries
completion/failure; coordination records proof against captured work; native goal
attempt history and captured plan cursor can advance; procedure/BT learning sees
the actual result. Current unrelated goals/plans cannot inherit an old receipt.

Native objective success remains GoalEvaluationSystem's job. A completed plan,
an exhausted macro, a timeout, an utterance, and a closed encounter are not objective
success. Activity-situation projects receipts back into social review and existing
appraisal; receipt creation does NOT itself enqueue a new physical-failure appraisal.

Two completion paths have different policies: synchronous step failure counts
repeated failures before replanning; package deferred failure fails its captured
plan directly. Their hook order also differs. A wholesale common completion handler
would be a behavioral change, not harmless extraction. Keep both admissions and
policies for this bounded pass. LastAction is not promoted into an outcome bus.

There is also a distinct legacy office-job completion adapter:
systems/office-tool-job-system.ts. Actual job issuance/results feed ToolResult,
stimuli, LastAction, coordination, goal action learning and captured plan progress.
It has office-specific diagnostic-failure advancement and repeated-failure policy.
Host office execution is OFF in the acceptance configuration, but this is a live
compatibility implementation, not dead code. Keep it and its regression coverage;
do not silently merge its failure semantics with package/native completion.

## Overlap findings and smallest plan (before source implementation)

### KEEP

- All semantic layers above; especially ongoing activity vs immediate purpose vs
  social engagement. Clarify names in documentation rather than merge their state.
- Existing centralized action precedence and its two freshness entry points.
- Background/foreground source fences, native outcome identity, ECS schemas,
  privacy projections, simulation-clock deadlines and public compatibility modes.
- Both completion admissions and their distinct existing failure policies.

### MERGE

- Eight copies of goal-plan retirement into ONE plan-lifecycle transition helper.
  Callers retain authority to decide goal completion/expiry/review and select the
  owned plan set. The helper owns which unfinished plan states retire; it does not
  edit goals, advance cursors, end physical jobs, delete evidence or mint grants.
- Mechanical first: preserve each caller's current accepted states and enumeration
  (including goal-cleanup's precomputed global index). Test the actual old behavior.
- Separate behavior correction afterward: expiry, schedule replacement and cleanup
  currently omit awaiting_decision while five other paths retire it. Once a goal
  ends, its still-pending decision draft must retire too. Add failing regressions
  first, unify that state set, then remove the temporary compatibility parameter.

### REMOVE

- The eight duplicated plan-retirement loops and, after the separate correction,
  their inconsistent status lists. Preserve all failed/completed/retired plan data.
- No controller, model, capability, memory system or supported public API is removed.
  No other path is proven superseded sufficiently to delete in this bounded pass.

### Why this scope

This removes multiple owners of the same lifecycle invariant, rather than merely
splitting large files. The action-selection policy already has one top-level
owner; native outcomes have legitimately different execution lifetimes. Avoid
inventing an arbiter/outcome bus to make a diagram look cleaner. Stale waits,
banter and appraisal-trigger changes remain recorded issues, not hidden additions.

## Execution and acceptance

1. Checkpoint and map/proposal (this document); no live run yet.
2. Offline characterization tests. Mechanical retirement consolidation, targeted
   tests and typecheck; preserve red and green logs separately.
3. Separate awaiting-decision lifecycle regression/fix. Verify that callbacks
   remain alive, terminal evidence/cursors unchanged, other owners unaffected,
   and retired proposals cannot be selected.
4. Full regression and types. Record exact result and remaining limitations.
5. Freeze a fresh predeclared ten-trial baseline with unchanged cases/budgets,
   >=8/10, no critical privacy/authority/physical-integrity failures, all-outcome
   foreground p95 <=5 s per world AND pooled. No censored failures/top-up trials.
6. Only after those gates pass: one actual ten-minute sustained endurance run.
   If they fail, preserve the cohort, report the boundary and seek direction if
   another repair would expand beyond this bounded consolidation.

H3 and world generation remain deferred. No model changes, features, or new controller.

## Execution log

Map and minimal proposal presented before source changes. Retirement is housed in
the existing plan-state.ts module, not another controller or runtime service.

- New characterization fixture first failed 14/56 because it omitted actor identity;
  fixture corrected, original log preserved. Original production behavior: 56/56.
- Mechanical pass: eight callers delegate to retireGoalPlans, retaining legacy
  state differences via a temporary parameter. Eight suites, 312 pass / 3 opt-in
  skips; typecheck clean. Exact intermediate source saved as mechanical-source.tar.gz
  in the checkpoint directory, SHA-256
  b6684ce311fbec16a9a09837e0300a8077000ea0ebbf516f116de8ed6e7ca3fa.
- Separate behavior tests: initial 4 failures included a test fixture attempting
  selection without a matching action; corrected to a prepared decline. Rerun
  gives four genuine awaiting-decision retirement failures / 79 passes: the three
  lifecycle paths plus a real apartment phone frontier. Both red logs retained.
- Behavior correction removes the temporary parameter: all callers retire active,
  awaiting-evidence and awaiting-decision drafts. No goal/progress/cursor or native
  job writes were added. Targeted 83/83 and final typecheck pass. Source search
  confirms one Plan.status="retired" writer and eight callers outside tests.
- Full regression PASS: 332 suites, 4,584 tests passed / 10 opt-in skips, 88.652 s.
  Terminal session71904 exited0; final typecheck session66468 exited0. No new live
  cohort had run at this point. No acceptance credit.
- Next: fresh prospective cohort recordings/cognition-baseline-consolidation-01.mWPbVY,
  original order S5/P5/S2/P2/S3/P3/S4/P4/S1/P1. Freeze all source before zero-network
  sampler preflight, then sequential cases. During the freeze update only evidence
  and progress in that directory. No behavior changes between trials.

Logs and exact intermediate source are in the checkpoint directory. Behavioral
acceptance and endurance remain outstanding; all old failures remain preserved.

## Endurance-discovered follow-up — proposed before implementation

Fresh consolidation01 baseline9/10 (S2FAIL), p95social3600/puzzle3563/pooled3574ms.
Endurance01.n81yxG completed600sim/602.120wall seconds,322settledattempts,p954343ms,
no observedcritical integrity/health violation; native/prompt evidence retained.
Do not treat those as amended-source gates or proof that social behavior is golden.

Completion audit found a missing handoff, not a need for another controller:
social-memory.reviewSocialGoal owns subjective satisfaction and setscompleted,
but does not call the shared plan-lifecycle transition. Jerry's goal28completed218s
leftplan73active; goal205completed467s leftplan263active through600. The native
active-goal selection fence prevented these tags being execution authority, but
the state is incoherent. The eight earlier duplicate loops were consolidated;
this ninth path previously omitted cleanup altogether.

Smallest explicit decisions:

- KEEP subjective social satisfaction, owned reciprocal evidence, standing-desire
  protection and closure history in social-memory. Do not equate it to native
  physical objective success or alter admission conditions.
- MERGE the successfully completed social goal's plan cleanup into the existing
  retireGoalPlans helper. No new state/service/controller/terminal-goal sweep.
- REMOVE no faculty/API. Retire only matching owned unfinished plan states;
  retain terminal plans, cursors, evidence, closures and pendingnativejobs.
- TEST first: add this completion path to the existing seven-state retirement
  matrix and ensure rejected/foreign/physical/standing reviews do not retire plans.
  This is an explicit behavioral follow-up, not disguised mechanical extraction.
- Audit other direct terminal-status assignments for the same missing handoff;
  distinguish never-admitted queued/new goals and guarded compatibility paths.
  Do not mechanically merge their different success semantics.
- Then full regressions and a fresh original ten-trial cohort plus actual ten-minute
  endurance on amendedsource. Preserve the successful prior-source evidence and
  every failure; no top-up or acceptance weakening. H3/worldgen remain deferred.

Writer audit, before follow-up edits: the no-AI builtin GoalPursuitSystem also
ends existing goals on arrival or unresolved destination without retiring plans.
KEEP its AI/domain guards and completion/failure criteria; MERGE only those two
owned-plan cleanup handoffs into the same helper. Characterize both against the
seven-state matrix. This changes no live AI movement arbitration. The immediate
movement receipt in cognition-system creates a fresh goal synchronously after
the move (or returns undefined), so no prior plan can need retirement there.
DayPlanActivation's terminal writes accept only queued, never-admitted goals;
planning admits active goals only. KEEP those creation/activation paths unchanged.

Follow-up implemented: three missing cleanup handoffs now call retireGoalPlans,
with actor-owned HasPlan enumeration. Eleven transitions share the unfinished-plan
state rule; no goal-terminal sweep or execution authority was introduced. Separate
behavioral red log:10fail/88pass; green:98pass. Full332suites/4605pass/10opt-in skips,
87.773s, types clean. All logs and exact source in
recordings/cognition-consolidation-social-closure-01.gcDsEF. No other production
changes relative to consolidation01; its failed evidence stays intact.

NEXT, not yet acceptance: freeze fresh cohort
recordings/cognition-baseline-consolidation-02.Q0tXGt; unchanged original ten cases
and all-outcome gates, then fresh actual ten-minute endurance only if accepted.

Later checkpoint: cohort02 CLOSED INCOMPLETE. S5 behavior passed; P5 native
escape/recovery passed, but one background response audit was unavailable at
shutdown. Eight cases not run, no acceptance. Runtime abort was preserved, not
used to reconstruct the answer. Eval-only follow-up removes independent cloned
response observation: one pass-through body stream records the EOF/error actually
delivered to the SDK. Failure evidence, privacy, bounds and pending consumers
remain explicit; no engine/controller/model/shutdown changes. Offline25recorder
tests plus transport/journal coverage pass; full332suites/4625pass/10opt-in skips,
types clean. Logs: recordings/cognition-consolidation-provider-audit-01.mtq1Z7.
NEXT: fresh original cohort03.QMBycR and, only if accepted, fresh600wall/600sim
endurance. Do not relaunch/top-up closed cohort02 or transfer prior-source gates.

## Monitor audit after consolidation03 — eval-only, not another cognition pass

Consolidation03 closed INCOMPLETE: six full passes, S2/P3 behavioral failures,
S1 stopped at148.5/180s on ten process-census timeouts, P1 never launched.
All1217foregroundattempts settled; observedpooledp954062ms is not fullcohort
acceptance. Source stayed frozen throughout. S3 exercised native writing and
S4 correctedhandoff/departure; S2 prolongedbanter and P3 cross-roomwaiting remain.
Closure: recordings/cognition-baseline-consolidation-03.QMBycR/cohort-assessment.md.

Offline guard review preserved fail-on-missing-census behavior and exposed a
separate virtual ownership bug: a recreated group could inherit the old leader's
numericPGID authority despite a differentbirth identity. No evidence of a live
foreignprocesssignal. Smallestkeep/remove/merge plan was presented before edits:
retain separate CLI/sampling policies and allcaps; share only pure ownership
calculation; remove two duplicate loops; separately invalidate observed reused
leaders BEFORE admitting groupmembers. No psfrequency,timeout,grace,resource,
NPC/model/prompt/controller/clock/native-execution changes.

Mechanical extraction retained11pass/1fail; separate ownershipred2fail/10pass,
then12/12unitpass. Frozen-wrappervirtualaudit12/12; legacyCLI11pass with1 sampler
test inapplicable (it never had that feature). Focused44pass, typesclean.
Full333suites/4637pass/10existingopt-inskip,85.822s, session29907exit0. Logs and
before/mechanical/after source archives in
recordings/cognition-consolidation-monitor-audit-01.vSzilr.

HistoricalOScensusstall cause remainsunproven. Permanent loss of enumeration
cannot certify cleanup; the guard keeps failure explicit and awaits a fresh
census instead of declaring unknown descendants absent. This limitation was
tested/documented, not disguised as successful bounded hostmonitoring.

NEXT: prospective originalcohort04.wbCrUX, same10cases/gates, sharedownership
helper in sourcefreeze. Zero-network RSS/descendant/stop-sampler checks BEFORE
inference. Only after fullbaselineacceptance: freshactual600wall/600sim endurance.
No reuse of prior-sourceendurance or P1top-up. Worldgeneration/H3 remain deferred.
