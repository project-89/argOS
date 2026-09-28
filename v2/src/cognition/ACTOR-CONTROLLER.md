# Continuing actors, asynchronous deliberation

An opt-in [situated selection experiment](SITUATED-CONTROLLER.md) now shares
this executor and admission path. Priority arbitration remains the default;
the experiment is not evidence of improved social behavior by itself.
An independent [receipt-driven reconsideration experiment](EXPERIENCE-RECONSIDERATION.md)
retains priority selection while allowing appraisals to reorganize personal
intentions. Both features remain explicit runtime options.
The [heard-appraisal and attention corrections](HEARD-APPRAISAL-AND-ATTENTION.md)
extend that experiment to selected heard speech, distinguish recurring signals
from new interruptions, and keep historical goal cleanup out of live admission.
An independent response preserves existing goals and does not require a separate
switch rationale; explicitly choosing a lower-ranked goal still does.

The simulation clock does not wait for a model. Neither should a known next
plan step. The runtime now runs `ActorControl` on its fast world tick, outside
the foreground model queue. It admits perceivable pending events, reconciles
current observations and plans, then either executes a deterministic step or
requests asynchronous cognition. It never starts inference itself.

An actor with an in-flight foreground request keeps receiving perceptions but
does not concurrently select another command. Other actors' model calls cannot
occupy its deterministic execution capacity. Appraisal retains its separate
owned-state arbitration before new foreground work. Planning/reflection remain
in the reserved subconscious lane; world building remains background work.

## Three distinct lifetimes

1. **Experience:** an actually admitted observation or heard/read event. An
   inference attempt alone never marks it consciously integrated.
2. **Interpretation and purpose:** a valid model update grounded in that issued
   experience. It can persist even if the immediate action becomes unavailable.
3. **Command:** a proposed action, still subject to live source, possession,
   reach, target, capability, body/voice and execution-evidence checks.

The foreground prompt requests `control: {version: 2, purpose, goalId,
localDependencies: [...], switchReason?}`. The engine validates this contract before using the
new path. Responses without it keep the earlier conservative atomic admission;
an invalid control block is rejected, never silently downgraded.
Version 1 is still accepted for existing callers. Version 2 binds the continuing
purpose to an owned, listed goal (or `new`/`null`). A detour below the current
priority requires an explicit reason. This is decision accountability, not a
semantic guarantee that a model's chosen action actually advances its goal.

## Goal pursuit and reconsideration

An enabled routine behavior policy no longer bypasses every stored plan. A
highest-priority agent-generated intention, or an explicitly focused goal,
gets its grounded next plan step first. If it needs deliberation, routine BT
fallback cannot silently take over. Unintegrated attention still interrupts;
authored schedule microplans retain their existing policy fallback.

`goalReview` can defer or release an owned, generated subjective/exploratory
intention. It cannot retire an authored objective or bypass a physical success
contract. Deferral preserves priority and progress, changes status to `paused`,
and saves a private reason and bounded 10–60 simulated-second review deadline.
Release means `retired`, never `completed`.

The actor selects an exact wake condition from personally experienced channels,
heard speakers, or a timed review. Unread message content is unavailable. A new
receipt on the selected channel or a new heard turn from that speaker wakes the
goal early; unrelated channels and the actor's own words do not. This is new
evidence to reconsider, not evidence that the requested outcome happened.
Eligibility, ownership, definition, priority, source and selected evidence are
checked before committing a review. A reply arriving during inference cannot
be swallowed by an obsolete decision to wait.

The fast controller resumes due intentions even while inference is running.
Their old executable plans are retired, preserving history but requiring fresh
planning. A source restart also requests reconsideration of durable deferrals.
Existing social settlement still requires actual spoken/heard exchanges;
deferral does not extend that proof mechanism to text messages.

The historical mental update admits once, before physical dispatch. It records
only attention actually included in its prompt as integrated; events arriving
during inference remain unintegrated. New speech can demand fresh wording
without erasing the prior thought. Actor/source replacement, cancellation,
changed owned priorities/affect, invalid goal/work bindings, and obsolete cited
coordination evidence still reject incompatible mental patches.

Thoughts retain their authored timestamp and separate `observedAtSimMs` basis.
The next prompt labels that basis as historical. No model interpretation becomes
a fresh sensing receipt, another actor's knowledge, or successful execution.

## Immediate action dependencies

The local-view issuance exposes a bounded catalog of exact IDs: observed room
fields, own body/fields, public routes, and specific observed entities. The
model selects which additional current local facts its immediate action or
words require. Unknown, duplicate, remote, or over-limit IDs fail validation.
An empty list does not disable owner, room, sensory, producer, selected target,
physical action, or relevant speech checks. Dependency validation is pure: it
creates no observations or identities.

These dependencies are not semantic proof of arbitrary prose. The model can
misjudge which facts matter, just as it can choose a bad action. The engine
still owns physical legality and completion evidence. The scoped contract
eliminates the old requirement that every unrelated local state remain fixed.

New direct speech, words from the selected conversational partner, or new
room-directed speech for a room-directed reply can invalidate pending wording.
Fresh hazards, directed intent/attention, daemon interventions and action
failures also demand reconsideration. Unrelated visual activity does not.
New owned priorities/affect invalidate an obsolete pending command as well.

## Conversation continuity

`CognitiveControl` is private ECS state containing a purpose, proposed action
type/target, revision, status and source timing—not an executable script.
When the floor is occupied, an already integrated speech proposal can wait for
up to 15 simulated seconds. Its exact in-process issuance and dependencies are
rechecked every eligible controller tick. If still valid when the floor opens,
it can execute once without another model call. If stale, only that proposal
is dropped: its purpose remains `needs_revision` in the next model context.

The executor alone emits heard words and completion receipts. A waiting thought
is not dialogue; `dispatched` is not goal completion. Copies, changed arguments,
consumed proposals, restarted sources and replacement actors cannot replay work.
Restoring a world retains the private purpose as `needs_revision` and restores
no pending speech authority. Multi-step continuity remains in owned ECS goals,
plans, coordination records and learned behavior trees.

### Bounded turn ownership across wording revisions

An integrated speech intention now requests a FIFO place in its local
conversation. Rewording for the same audience retains that place; choosing a
different action or audience releases it or joins anew. The request contains no
utterance and cannot execute anything. Physical speech still consumes the exact
freshly validated proposal. Explicit `speechMode: "interrupt"` bypasses the
normal turn order, but never the actor's own occupied voice.

Reservations expire after the current utterance's expected end plus a 3-second
authoring grace, with a 30-second total bound. A stalled revision cannot silence
the room indefinitely. Identity, source, room, package or external intent changes
invalidate the reservation. Reads remain pure; expired requests cannot revive
after a later conversation. No reservation survives save/restore.

### Short foreground motor plans

An optional `motorPlan` chooses 2–4 local physical steps in the existing
foreground response, including the immediate action first. It must serve a
listed owned goal without replacing an active plan. Initial steps are pickup or
drop; the final step may also interact or observe. All targets must already be
locally observed. This first version deliberately does not speculate about
objects beyond a proposed walk or actions after a newly read result.

These are ordinary ECS plans, advanced by actual executor receipts on the fast
controller. Existing prerequisite, possession, attention and failure checks
remain. Runtime-issued source/target bindings additionally reject replacement
objects, changed commands, source restart and expiry after 30 simulated seconds.
Restoration retains the plan as data but requires reconsideration, not replay of
its former motor authority. Finishing this prefix is not completing its goal.

Direct edits to the private `CognitiveControl` ECS data are detected even when
the editor does not increment its revision. The edited purpose is preserved as
needing reconsideration; an older in-flight interpretation or queued speech
cannot overwrite it or treat that edit as permission to execute old words.
Faults in one actor's package are isolated by the runtime controller so later
actors still get their turn on the same world tick.

## Verification and limits

`actor-controller.test.ts` tests noisy-room progress, removed targets, scoped
dependencies, new relevant speech, floor resumption, expiry, stop/restart,
identity replacement, one-shot issuance, goal/work integration, save/restore,
perception during inference and deterministic progress with both foreground
model slots held. Local-view tests cover narrow-source purity and privacy.

The existing strict legacy admission, physical execution, coordination and
speech tests remain intact. This is not a replacement of the goal lifecycle,
planner or memory model. Background plan admission still has conservative
scene/dialogue guards; goal feasibility and narrative quality require further
live evaluation. Increasing simulation time scale cannot make model inference
instantaneous, and this change does not repair or measure H3 playback latency.
