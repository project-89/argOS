# Heard appraisal and continuous attention

## Behavioral fault, not missing notification knowledge

In the retained `sitcom-breakup-boyfriend-lOwWap` trace, Elaine explicitly notices
the waiting notification at 69s and chooses to hear Jerry first. At 75.5s, a
queued utterance is invalidated as `goal_changed`, although her active goals and
priorities are unchanged: cleanup removed expired schedule history. Later
vibration reminders can also invalidate a current decision as `source_changed`.
Repeated retries consume the interval in which a remembered intention could
become an action. The second read eventually completes at 99.2s.

These are separate from the model's choice to continue the conversation. Faster
model output alone cannot repair invalidation caused by irrelevant bookkeeping.

## Changes

- Independent foreground admission and receipt appraisal depend on active,
  in-progress and paused intentions. Deleting terminal history is not a change
  of purpose. Activation, retirement, ownership and live priority changes still
  invalidate stale work. Nothing marks a goal completed by self-report.
- A trusted producer may supply `addPerception(..., { signalKey })` for repeated
  emissions of one attention signal. Every emission remains a perception, but
  repeated emissions become observations rather than new interruption tokens.
  Recognition is local to an actor identity and runtime source. New signals and
  first hearing by another actor remain attention. Unkeyed events and dangers
  retain their existing behavior. A producer must use a new key for a genuinely
  new signal; do not use one permanent key for unrelated events.
- The apartment's repeating notification uses its physical phone and latest
  delivered incoming-message identities, never the sender or body. Notifications
  still vibrate every six simulation seconds. This token is engine metadata,
  not an extra fact or private-message access granted to an NPC.
- Reading one message reports the remaining unread indicator to the actual
  reader. `readCommunication({ unreadRemaining })` keeps notification salience
  when that observed indicator remains set. There is no automatic read or reply.
  While a powered phone is held by a sighted actor, their current context also
  exposes the unread indicator separately from previously read messages. A
  history of read messages must not masquerade as the current inbox state.
- Foreground purpose selection explicitly permits information gathering as a
  means to the same purpose, rather than equating a goal with a single topic or
  action type. All choices remain grounded in known objects and affordances.
- An independent response (`control.goalId: null`) no longer requires a separate
  `switchReason`. It does not transfer or erase a goal commitment. Explicitly
  choosing a lower-ranked goal still requires a reason. In the diagnostic live
  run Jerry's decisions were rejected at 74.5, 76, 78, 81 and 84 seconds solely
  by the old switch-reason check, before he eventually managed to respond.

## Heard-speech appraisal

With `experienceReconsideration: true` and appraisal enabled, the existing
foreground request offers an optional `appraiseSpeechIds` selection. It lists
at most twelve eligible, complete, actually heard turns. A decision can select
up to three for the existing private receipt-appraisal lane. Ordinary chatter
does not automatically schedule a call; no keyword classifier or required
emotional response is added.

The model selects IDs, not receipt content. The engine constructs attributed
receipts from the listener's own dialogue ledger. Own speech, remote speech,
unread messages, and incomplete fragments are ineligible. The immutable issued
turns, actor lifetime, runtime source, option state, queue capacity and simulation
time are checked before queueing. Already queued IDs are not offered again.
The channel remains chronological; older unselected turns do not re-enter behind
newer appraised evidence. This is bounded event review, not retrospective search.

Appraisal receives the listener's own recent completed dialogue and existing
personal concerns for context. It can reinterpret priorities using the existing
intention-reconsideration API. A heard claim does not become an objective world
fact or an obligation to help. Foreground salience selection uses the existing
decision call; each selected batch still requires a separate bounded appraisal
call. This is not zero-cost appraisal or a claim of parallel foreground appraisal.

`heard_appraisal_selected` records the selection boundary. Appraisal diagnostics
record actual admission/discard and receipt IDs. `schemaField` on rejected
foreground decisions identifies the failing validation field without recording
private provider output. Selection is not proof of an admitted appraisal.

## Scope and limitations

### A chosen deferral is not reminder backoff

`reconsiderAtSimMs` belongs to the last explicit review: the actor's chosen
duration for deferral, or the default interval after consideration. Merely
including a cue in another admitted request never moves that deadline or changes
its recorded reason. The private context says when that review is overdue.

`nextPresentationAtSimMs` separately limits due reminder-driven interruptions to
one per 30 simulated seconds. Ordinary intervening prompt inclusions do not
slide it forward; actual new signals retain their own eligibility. An explicit
new review clears that engine backoff so a deliberately chosen shorter revisit
is honored. Presentation remains neither consideration nor resolution.

Prepared reviews capture validated primitive inputs and original cue identity,
and are single-use. `reviewRevision` fences competing same-tick reviews even
when they choose identical reasons and deadlines. Re-emission may advance the
last-observed age without revoking a review; original-onset replacement, changed
review, owner/source change, rewind and cancelled tasks cannot authorize it.
These optional fields live in the existing private `Attention.signalsJson`;
legacy rows without them retain their recorded review state.

This does not force response timing or encode breakup-specific behavior. A
character may still postpone checking, refuse to respond, or pursue an awkward
conversation. It does not yet add an explicit contingent intention representation
for “after this response, do X.” Live tests must distinguish that behavioral
choice from cancellations, speech duration, waiting for a turn and actual motor
execution. Runtime appraisal queues are not restored as execution authority;
ordinary memories, intentions and dialogue are ECS state.
