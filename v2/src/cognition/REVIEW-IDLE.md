# Foreground pacing and scheduler review

The `generative-agents-YRABVL` challenge run completed the real cooperative repair at 41s, but generated 223 thoughts over 179s, including 91 post-goal wait/rest actions and 39 observation actions. Quiet behavior was being selected repeatedly rather than inhabited for a while.

## Cause and implementation

The per-actor foreground operation runs at interval 1. A world package returning `ready() === true` also bypassed the legacy arousal-based cadence inside `runCognitionCycle`. Physical availability therefore meant "request another decision" even if nothing relevant had changed since choosing to wait.

`idle-cognition.ts` separates physical availability from cognitive readiness. Successful quiet action receipts establish a bounded foreground backoff of 2, 5, 10, 20, then at most 30 seconds. A first observation gets a shorter 1-second reconsideration. The ledger is world-scoped, runtime-only, and records no invented action, thought, physiological recovery, or goal completion.

Readiness is checked before queueing and again before dispatch. It wakes on an admissible pending event, explicitly notified meaningful attention, changed actor-perceivable local state or own inventory, actual dialogue, owned goal contract/lifecycle changes, and new plan steps. Critical needs remain eligible; physical and social action steps in active owned plans remain eligible. Low energy alone does not force another decision while actual rest recovery is already underway; new danger and attention still wake the actor. Continuous world clocks, need drift, goal progress estimates, plan timestamps and the actor's own monologue are not wake events. Repeated unchanged observation does not keep the model busy.

Only actual execution outcomes establish pacing, after plan advancement. Failed/pending work and non-quiet actions clear it. The physical package's readiness gate remains authoritative: an incoming event must not teleport an actor out of a long-running physical action.

## Boundaries reviewed

- The fast ECS loop is synchronous and independent of model requests. Physics and world maintenance continue while foreground cognition yields.
- Foreground, subconscious and builder lanes have independent concurrency reservations. Held builders cannot occupy the foreground or subconscious budget; held planning cannot occupy foreground slots.
- The scheduler already rechecks readiness at dispatch, cancels queued work on stop, and isolates tasks by runtime scope. It now checks an operation's interval and single-flight status before its potentially expensive sensory readiness probe, so in-flight models do not rebuild a local snapshot every physics tick. No new generic scheduler loop was needed.
- Planning and reflection have their own readiness conditions and continue while the foreground is idle. A new plan can wake the actor instead of waiting for its idle deadline.
- Readiness uses the sensory system's permitted, timestamp-free fingerprint, not omniscient component scans or other characters' private memory. Modality-aware pending input filtering belongs to the perception boundary.
- The ledger deliberately does not serialize a sleep deadline. A restored world gets a fresh first decision; this is not a claim that the whole runtime can be resumed from an ECS checkpoint.

## Deterministic evidence and limits

Focused tests cover bounded reconsideration over a three-minute unchanged scene, immediate external/local-state wake, preserved inputs while physically occupied, hidden/remote/blind perception boundaries, active versus detached plans, failures, critical needs, read-only probes, independent worlds, and continuing physics/background work. The three-minute fixture admits between 6 and 12 foreground checks instead of up to 361 half-second checks; it does not score this as narrative success.

This is scheduling, not a personality fix. A model can still choose repetitive speech when new conversation arrives; a broken goal lifecycle can still generate fresh bad plans. Those require separate source-grounded goal and social behavior checks. Deadline and need thresholds are bounded defaults, not a demonstrated optimum for every world. Critical hazards intentionally favor responsiveness over reduced model usage.

## Follow-up: background social-plan race

The admission guard now snapshots the actor's latest committed public utterance as well as heard speech when a background plan begins. If foreground cognition has already asked a question while that request was running, a subsequently returned social plan is discarded as stale instead of asking it again. Private thoughts and model-history text do not count as spoken evidence. Physical-only plans still admit. This guard applies only to in-flight admission; executing the spoken step of an already committed plan does not invalidate its own following listening or physical step.

The accompanying goal-lifecycle tests separately pressure native physical/need proofs, already-satisfied and duplicate criterion rejection, malformed model/engine data, exploratory pause without success, dependent-intention retirement, and direct ECS edits to parent contracts. No test treats a completed plan or fewer model calls as successful world state.
