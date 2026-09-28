# Continuing-actor controller: implementation and evidence

## Outcome

The controller now preserves an admitted historical interpretation and owned
purpose independently of whether its next action executes. Known plan/behavior
steps run on the fast world tick outside model concurrency. Physical authority,
relevant speech freshness, ownership, cancellation and one-shot execution remain
enforced. The contract is documented in
[ACTOR-CONTROLLER.md](../cognition/ACTOR-CONTROLLER.md).

Two new 120-second production-cognition episodes completed with no H3 and no
recording failure. They establish substantially better retention of inner life,
not consistently good narrative follow-through or a faster model. Both episodes
produced two physically typed and delivered breakup replies. Only the first
episode disclosed the breakup to friends during the evaluation window.

## Artifacts and conditions

- Earlier appraisal-v1 comparison: `recordings/sitcom-breakup-boyfriend-rUZ1Au/`.
- Initial controller: `recordings/sitcom-breakup-boyfriend-wr7YE6/`, label
  `actor-controller-v1`.
- Controller with corrected speaking-turn capability description:
  `recordings/sitcom-breakup-boyfriend-rNs1c5/`, label
  `actor-controller-handoff-v1`.

Each new run includes configuration/source fingerprints, complete private and
public event journals, sampled cognitive frames (including controller state),
transcript, world snapshot and replay. Messages were the same fixed breakup
inputs at 8 and 28 simulated seconds, from David, Elaine's boyfriend of two
years. No emotion, decision, goal replacement, reply or disclosure was forced.
The runtime used the existing configured Gemini 3.8 Flash model. H3 and world
evolution were off; this is not a full god/spirit world-growth evaluation.

These are different stochastic episodes, not matched-seed trials. The earlier
comparison also predates the appraisal structured-output improvement, which
contributes to faster appraisal in both new runs. Timing differences must not
be attributed solely to the controller.

## Observed outcomes

All times in this table are seconds of simulation time since episode start.

| Elaine evidence | Earlier appraisal v1 | Initial controller | Corrected handoff description |
| --- | ---: | ---: | ---: |
| Foreground cycle starts | 42 | 34 | 32 |
| Retained foreground reasoning thoughts | 6 | 29 | 27 |
| Separate admitted appraisals | 2 | 2 | 2 |
| First message actually read | 22.70 | 22.70 | 24.70 |
| First admitted appraisal | 28.00 | 24.00 | 26.00 |
| First reply delivered | 34.25 | 29.99 | 36.295 |
| Second message actually read | 37.20 | 46.20 | 53.20 |
| Second reply delivered | 50.74 | 57.315 | 66.74 |
| First completed breakup disclosure | 75.76 | 39.08 | None by 120 |

Cycle starts include deterministic work/cancelled requests, so these are not
model-success percentages. The earlier review counted 39 distinct foreground
request dispositions, not all 42 cycle starts. In the new runs, controller
revision counts independently match the 29 and 27 retained reasoning thoughts.
The second run additionally records exact `cognition_integrated` events.

The first controller run contains this actual spoken disclosure at 39.08s:

> David just dumped me. In a text message! Two whole years, George!

George subsequently exploits the distraction to obtain and eat the cookie.
Elaine separately tells Jerry at 86.44s and discusses the return of her things
at 118.72s. Private information reaches peers through actual audible speech,
not through her private controller state.

In the second run Elaine becomes distressed, authors priority-9 intentions,
and types both replies, but obtains the cookie herself and continues the public
cookie argument. Her only completed public turn is about holding the cookie.
Friends therefore do not get a magical breakup disclosure. This is a failure
of the desired narrative outcome, not a successful disclosure hidden by lag.

## What the run taught us

The initial prompt still described a busy speech floor as requiring waiting or
observation. That contradicted the new controller's ability to hold a validated
proposal. The follow-up changes the action contract, not the scenario: a
character who wants the next turn may propose speech now; the engine waits and
rechecks it. Waiting/observing does not itself request a speaking turn.

No waiting speech revisions were sampled for Elaine in the initial run. Three
distinct revisions entered `waiting` in the follow-up, and a retained proposal
eventually dispatched without replacing its integrated purpose. Offline tests
prove the exact one-shot and invalidation behavior. Additional operator events
for waiting, revision and resumption were added after these live runs so future
evaluations need not infer lifecycle transitions from sampled frames.

Foreground request-slot wall timing was not improved: Elaine's initial run had
p50 1,433ms / p95 4,872ms; follow-up p50 1,453ms / p95 2,464ms. The earlier
request-disposition analysis reported p50 966ms / p95 4,203ms with a different
request population. These are not isolated provider benchmarks. The immediate
win is less discarded cognitive work and queue-independent deterministic
execution, not a claim of reduced inference latency.

## Mechanical coverage

- Unrelated visible changes no longer invalidate independent interpretation.
- Only attention included in the successful interpretation is acknowledged;
  newer speech/hazards remain pending.
- A removed physical target still blocks execution while purpose survives.
- Explicit local dependencies protect statements requiring current facts.
- Relevant new dialogue retires wording without erasing the prior experience.
- Deferred speech cannot execute twice, through a copy, after expiry, after
  listener departure, across source restart, or in a replacement actor.
- New goals/work bindings survive their own integration without self-invalidating.
- Saved ECS restores purpose as needing reconsideration, never queued commands.
- A known plan advances while both foreground model slots are occupied.
- The library runtime isolates a faulty actor package from healthy actors.
- Direct ECS purpose edits retire pending command authority and cannot be
  overwritten by an older in-flight interpretation, even at the same revision.

The tests use offline model stubs and physical execution receipts; they do not
substitute canned live behavior or bypass goal/possession checks.

Final verification after ECS-edit and actor-fault hardening: **214 suites
passed; 2,617 tests passed, 10 skipped**. Typecheck and scoped whitespace checks
passed. Final full-suite output: `/tmp/argos-controller-release-tests.log`;
typecheck output: `/tmp/argos-controller-release-typecheck.log`. No existing
interactive UI/H3 server was restarted and no H3 session was allocated.

## Remaining work

1. **Goal follow-through and closure:** priority-9 breakup intentions can coexist
   with a return to cookie-focused behavior. A requested call/visit is not an
   available action in this testbed and needs a grounded external-dependency
   lifecycle, not endlessly repeated demands or scripted acceptance.
2. **Interruption efficiency:** repeated listening/observing thoughts and some
   failed/stale command proposals remain. A preserved thought is not proof of
   good reasoning. Measure event-to-useful-action and repeated-intent rates.
3. **Background planning:** its existing conservative scene/dialogue admission
   remains. It needs separate dependency-specific evaluation rather than having
   those guards removed as collateral to this foreground change.
4. **Model contract reliability:** occasional invalid-schema/timeout responses
   remain; they still fail closed and cannot create execution evidence.
5. **Broader evaluation:** repeat seeds, neutral stimuli, interruption schedules,
   and longer recovery windows before calling cognition golden. H3 rendering,
   playback alignment and an Astra provider comparison remain untested here.
