# Foreground proposal admission

## Current continuing-actor protocol

The foreground prompt now requests an explicit validated `control` block.
Those responses integrate historical thought/attention/purpose independently
of the next command, using scoped action dependencies and bounded conversational
continuation. See [ACTOR-CONTROLLER.md](ACTOR-CONTROLLER.md) for the contract,
ownership checks and tests. The whole-envelope behavior described below remains
the conservative compatibility path for responses without that block; invalid
new-format responses never fall back to it.

## Legacy atomic envelope and shared execution protections

A model reply is an intention, not an execution. A local control can become
occupied, lose power, move away or be replaced while that reply is being generated.
It can also change after one actor's reply returns but before a parallel batch is
dispatched. Both boundaries now compare the proposed action's relevant sources.

`foreground-action-admission.ts` captures an opaque, engine-owned request token:
actor identity, current room, local visible/owned target identities and placement,
public state, available action types, command names and the public route catalog.
These are the observer-local surfaces already used for the action menu. No hidden
component values, remote contents, code validity or executor outcomes are queried.
The request also explicitly captures `CognitiveLocalView` before constructing its
context. This is real actor-local sensing and may create legitimate observation
receipts, never an action receipt. Identity metadata for the physical menu is
allocated first so the view does not invalidate itself when a public route gets
its UUID. Formatting and checking the captured view do not perform fresh sensing.

After the reply is parsed, only the selected target, relevant possession/reach and
matching command templates are compared for physical actions. Unrelated props, other commands and
remote private changes do not invalidate the proposal. Native `give` also checks
the specifically named inventory item, independently of the recipient. Visual
inspection can still inspect changed public state; manipulation reconsiders it.
Pure normalization happens before either source admission or cognitive effects:
a model's move to a local object becomes an identity-checked observation. Raw
physical source admission also runs so a newly busy actor cannot turn a stale move
into a seemingly intentional wait. Watcher/policy bookkeeping occurs only after
the normalized proposal is accepted. A package registration generation prevents
hot-reloading even the identical capability object from reviving an older source.

Nonphysical replies (including waiting, thinking and speaking) instead compare
the complete actor-local view at response and dispatch. A quiet "I'll watch them
finish" thought must reconsider when the door already opens or a visible person
leaves during the request, even if the draft names no object. This is deliberately
conservative: an independent personal thought can also be discarded by a local
scene change. No prose keywords, guessed dependencies or extra model call decide
which claims matter. A discarded request yields to a subsequent ordinary cycle;
there is no synchronous retry loop and no fabricated wait execution. Physical
actions retain narrower target admission to avoid starvation from unrelated work.

## Separate body commands from mental updates

A parsed foreground reply now stages its entire mental envelope until actual
dispatch: thought, generated intention, coordination/social review, attention
acknowledgment, conversation history and learning rationale. Returning an action
from `agentThink` does not publish those effects. The executor consumes the exact
private issuance before admitting them or capturing execution/learning evidence.

World-package request cleanup is a separate boundary. `beginDecision().finish()`
runs when inference returns, before the caller dispatches the batch. It releases
in-flight bookkeeping and timers, not the proposal's authority. `isCurrent()`
must remain valid through dispatch unless cancellation, a newer decision, an
explicit world revision or package shutdown has actually superseded it. Keep a
durable generation separate from the in-flight map; deleting the latter in
`finish()` must not cancel every successful model response. Stop and replacement
must still revoke old generations. Package integration tests must run
`runCognitionCycle` **then** `executeActions` with a mocked model, in addition to
testing explicitly supplied physical actions.

The envelope requires the full issued local view, owned goal episodes/status,
and the existing dialogue, working-memory and coordination source checks to
remain current. A still-grounded independent physical command can execute when
its envelope is stale, but **none** of that envelope is admitted. Its stale prose
cannot enter thought history, close a social goal, create/link work, acknowledge
attention, or train a behavior tree. Reconsideration remains awake. A response
already found stale cannot revive its envelope merely because state reverts
before dispatch.

Speech and nonphysical decisions require their envelope. So do physical commands
bound to a newly proposed intention, a new undertaking, or a replacement work
generation from a relink. If their envelope is stale, the entire proposal is
discarded. Existing goal/work bindings and selected physical sources are checked
independently; a stale target or released selected undertaking never falls back
to unbound body execution.

Generated intentions and coordination reviews use private prepare/commit drafts.
Prospective goal/work references let binding validation finish without allocating
an ECS goal or publishing a peer undertaking. Published completion conditions are
copied, not aliased to mutable package declarations, and their continued catalog
availability is checked before commit. Rejected bindings therefore cannot leave
an orphan new intention. Zero-effect reviews do not create unnecessary drafts.
Thought/social-goal notification failures are isolated from admission; observers
cannot veto an already committed update by throwing. This is synchronous staged
admission, not a general-purpose rollback system for arbitrary ECS failures.

`mental_update_discarded` is an operator-only, typed event with request ID,
action type, reason and response/dispatch boundary; it contains no draft thought.
`llm_decision` is now emitted at dispatch, with `mentalUpdate: admitted | omitted`.
An omitted envelope has no learning rationale. This event records an admitted
choice, not an executor outcome or a count of every provider request.

The prompt places the exact issued local view just before current decision
evidence, including visible objects whose commands are currently unavailable.
Only the newest rolling `perception`/`senses` frame enters the current-context
projection; earlier frames remain stored, and distinct speech, attention and
action-result events are not coalesced. Equal-time new frames use admission order
instead of recycled entity IDs. This removes conflicting full-scene frames; it
does not prove why a particular model previously ignored a fresh observation.

An unavailable command that was unavailable throughout is NOT a stale-source
success. It goes to the real executor and can fail honestly. This change addresses
in-flight races, not the reasoning defect of deliberately choosing a known-invalid
action. Exact command bytes are preserved; matching advertised templates does not
mean that a supplied code or argument is correct.

Admitted foreground action objects receive an immutable engine marker. Only the
original object can consume its private issuance, once, in its original world and
actor. Copies, serialized/restored markers, changed arguments or substituted
goal/work references cannot reuse it. Unmarked native and deterministic actions
retain their existing API. The marker must not be stripped to reissue a foreground
proposal as native work.

The executor checks before plan, working-memory, coordination and deferred
execution capture. A discard is not a wait, failure, success or learned episode.
`runCognitionCycle` excludes its private sentinel, and `executeActions` also refuses
the sentinel and its copied marker. Foreground reconsideration stays awake.
Existing `decision_superseded` operator events include the response/dispatch
boundary, source reason, request ID and selected action identity; they are not NPC
stimuli. Foreground-only behavior-tree learning capture now happens after dispatch
admission so a discarded draft cannot overwrite another operation's learning slot.
Actual admitted deferred operations retain their existing execution IDs and
exactly-once proof path, even when physical state changes before completion.

## Rejected decisions are not waiting

Missing/malformed JSON, invalid action schemas, invalid ownership bindings,
unadmitted goals/undertakings, provider failures, deadlines and cancellation return
the same non-executable private sentinel. Changed dialogue, working-memory and
coordination dependencies discard dependent choices or omit an independent body
command's mental envelope; neither path mints a successful wait.
Only live requests are left ready for their next ordinary scheduled cycle. No
synchronous retry or additional inference is issued by rejection handling.

`decision_rejected` is an operator-only event with a typed reason and request ID.
An invalid undertaking reference records its bounded actual JSON value/type,
the issued own catalog's IDs/status/eligibility (up to eight entries), and whether
it matched a prior own speech ID. Object/array values are described by type only;
strings are capped at 180 characters. No raw provider bodies, draft thoughts or
full prompts are copied into this diagnostic. `decision_superseded` retains typed
semantic/source-change reasons separately, so invalid IDs can be distinguished
from an actually changed valid undertaking without relaxing ownership.

A non-wait model proposal suppressed by existing normalization (busy movement,
self interaction, duplicate pending tool) is also rejected, not rewritten into an
intentional wait. Explicit admitted model waits and native/deterministic waiting
retain their execution paths. An unchanged invalid command that reaches the real
executor still fails honestly. Rejection cannot advance a plan, mutate LastAction,
mint a physical action receipt, or consume another pending operation's learning.

Current scene headings and action-source state use the shared visual surface.
Direct own tangible possessions remain known by name, even without sight, but
concealed held objects and other agents do not expose generic ObjectState values.

Selecting a stored deterministic plan step does not create a new thought from
its description. That prose remains in plan history with its original provenance;
the normalized action still follows the existing physical execution/progress
path. Fresh foreground cognition and admitted background reflection can publish
new thoughts. This avoids restamping old plans as current reasoning without
claiming semantic validation of fresh prose.

Known limits:

- This compares observed endpoint availability, not an invented resource lease.
  An unobserved acquire/release cycle that restores the same state is not detected;
  a future public operation-generation contract would be needed for that claim.
- Current target/public-state comparisons are conservative, not a semantic proof
  of which displayed field the model used. Structured field dependencies can make
  this narrower later.
- Existing dialogue/working-memory dependency checks remain source-sensitive;
  full local-view admission is not semantic entailment of model prose. A current
  but mistaken thought or poor action choice is still possible. Historical plans
  and memories remain historical material rather than fresh factual certificates.
- The only new prompt material is structured, bounded current local evidence.
  No new inference request, canned dialogue or scenario keyword was added.
  Offline regressions establish mechanical admission safety; later live
  traces are required to establish the frequency and quality of actual uptake.
