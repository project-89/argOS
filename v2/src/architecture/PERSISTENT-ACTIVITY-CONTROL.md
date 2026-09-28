# Persistent activity control — next Stage 3 repair

User direction: an organizing intention can coexist with conversational turns,
habitual actions and brief interruptions. This is an engineering model, not a
claim to reproduce human cognition. Inner monologue is an observation of private
interpretation, not the sole action controller.

Verified current boundary: integrateActorContinuation replaces the complete
foreground purpose on every admitted decision. An independent spoken retort can
therefore remove the selected goal from continuation while its Goal entity stays
active. activity-review.ts describes an encounter opened by completed speech;
it is not a durable work/preparation activity. Merely preserving a goal in a list
does not preserve a resumable organizing activity.

The new background coordination reviewer can recognize an expressed undertaking.
It does not solve this control boundary and must not be treated as its substitute.

## Required behavior and authority

- Separate an actor-chosen ongoing activity from the immediate action proposal.
  Retain owner, stable goal/work reference, bounded plan/cursor reference and
  suspension reason. Existing Goal/Plan and executor receipts remain authoritative;
  do not duplicate success/progress into another contradictory ledger.
- A brief conversational response can be a side action within that activity.
  Speech does not automatically erase the activity or advance its physical plan.
  Current voice/body resource leases determine what can actually coexist.
- A physical interruption may suspend work and retain a return point. Recheck
  possession, route, target identity, changed affordances and plan dependencies
  before resuming. Never replay a stale command solely because it was next before.
- Explicit reconsideration can pause, replace or end an activity. Serious world
  changes may demand reconsideration. Numeric priority alone cannot make a
  scheduled default seize an actor-owned activity.
- Ending/abandoning an activity is not proof that its goal succeeded. Restore
  retains intention and return context, never active leases or execution authority.
- The fast path handles current perception, admitted skill primitives and safe
  resource arbitration. Background planning/reflection/appraisal can propose
  changes without overwriting a newer foreground choice.

## First regressions before implementation

1. Actor chooses a concrete multi-step activity, then answers a routine remark.
   Activity identity and physical plan position survive; speech advances neither.
2. After the side turn, still-valid work can resume without regenerating the
   agenda or assigning the actor a new goal. Show what authorizes the next step.
3. A changed prerequisite during the interruption blocks/revises that step;
   no phantom pickup/movement or success receipt.
4. Actor explicitly changes their mind: the old activity cannot silently resume.
5. Voice/body overlap respects actual resources; a phone read is not concurrent
   with incompatible hand use. Do not classify every spoken remark as harmless.
6. Saved/restored activity requires revalidation and cannot restore a live lease.

Inspect existing actor-continuation, selected-purpose-attention, native timed
actions, motor-plan scopes, goal-pursuit and activity-review before adding a new
controller. Reuse grounded execution and existing skills. Avoid layering another
LLM agenda prompt over the same replacing continuation slot.

No behavioral pass claimed in this document. Keep all prior
failed episodes. Also distinguish a promised immediate departure from plans for
dinner later at the fixture's16:00 clock; do not change old scores retrospectively.

## Foundation implemented; resumption remains unfinished

OngoingActivity is durable actor-owned ECS state, separate from the immediate
CognitiveControl proposal. Accepted foreground choices establish its stable goal
identity; conversational side actions retain it, physical interruptions pause it,
and explicit continue/pause/replace/end dispositions let the actor reconsider.
Goal/Plan remain the only progress/cursor authority. Ending does not complete a goal.
Restore retains the record but requires revalidation. Source, actor, capability
and goal-definition changes invalidate its current validation.

The fast path inhibits paused/ended/unvalidated matching activities. It now also
supports bounded resumption after an independent dispatched speech/thought turn:
no outstanding attention, no active voice, no occupied body or busy package, a
validated activity, and a runtime-bound plan/target must all agree. The next
physical primitive passes the ordinary plan prerequisite/dependency checks, then
gets a fresh immediate continuation and the ordinary executor admission. Selection
does not advance the plan, publish a thought, or complete the goal.

Return bindings retain the chosen plan identity/definition and personally visible
target identities. Replacement plans or same-name replacement objects cannot
inherit that binding. Bindings are not restored. A plan created after the activity
was selected requires another actor choice before this return path can use it.
Unknown future-room targets likewise need fresh grounding. Stored speech, thought,
wait and fresh-decision-required commands do not run through automatic resumption.

This separates the durable activity from the ten-second immediate action lease;
resumption issues a new lease after revalidation, rather than removing its age
check. It currently waits for speech completion; simultaneous voice/body work is
not enabled here. Long-lived multi-room activity and natural follow-through still
require live behavioral evidence, not just these deterministic checks.

## Route continuity is conditional, not blind persistence

The chosen-wait diagnostic (sitcom-logistics-boyfriend-TaJgSx) exposed an
already-admitted plan surviving independent movement. Elaine reached Street at
73s, but an older readiness-thought → Hallway plan then sent her back at76.5s.
The planning admission location check was already present; execution needed a
separate validity check. Keeping an intention does not mean keeping every old
route command.

Plan.routeRoomKey now retains the stable room identity expected before the
remaining route. A matched movement completion updates it; unrelated movement
does not. A mismatch invalidates the route before even a preceding think step
can execute. Normal route legs and save/remap preserve the origin. Restoring a
legacy plan does not fabricate one. This is a plan prerequisite, not a second
physical location ledger or proof of goal completion.

The user's interacting-systems framing remains the design test: motivation and
ongoing activity persist; attention can interrupt; familiar verified primitives
can execute without new monologue; background appraisal and planning can propose
revision. Inner speech is neither compulsory per action nor execution authority.
Do not turn this into a larger prompt that asks a single model to impersonate all
those mechanisms. The remaining live behavior gates still apply.

## Durable interruption context

An accepted detour now retains its purpose, optional actor-authored switch reason,
stable goal identity when present, and starting simulation time within
OngoingActivity. The immediate continuation may change during conversation without
erasing that context. Repeated steps for the same detour do not restart its clock;
reselecting the original activity clears it. Explicit replacement starts a new
activity without inheriting the old interruption. No goal completion is implied.

Explicitly compatible physical side work may keep the organizing activity active;
its detour context is still retained. The elapsed value means time since choosing
that detour, not continuous resource occupation or proof that an action executed.
Restoration retains this history but restores no execution grant. This is bounded
accounting, not an automatic return deadline or a command to honor every promise.

This does not yet fix the entire choice problem from batch03. A decision can still
choose routine work while a departure undertaking remains unresolved. Preserve
that failed evidence; evaluate the new context before claiming improved autonomy.

## Listening is not an automatic organizing-activity pause

Handoff diagnostic t1W7ox at67s records a goal-free wait, “Listen to Jerry's
reaction to the plumbing update.” Unlike its preceding spoken side turn, the
wait automatically paused the organizing activity. Further waits retained the
pause; selecting the original goal later reactivated it. The same mismatch
recurred at116.5s. No explicit activity-disposition change was required by the
old code. This is engine-imposed interruption, not evidence of an actor abandoning
an intention. It does not explain all note-completion or banter failures.

Wait now preserves the existing disposition just like speak/think, unless an
explicit disposition or goal reselection changes it. An already paused activity
stays paused with its original reason. This does not advance a plan, complete a
goal, authorize automatic resumption from wait, or bypass chosen wait/listening
admission and timing. Physical detours still pause by default. Regression checks
cover active preservation, paused preservation, no return candidate and no
progress. Broader behavior gates remain open.

## Background appraisal: execution status is not a changed mind

The appraisal freshness check formerly serialized the entire immediate
ActorContinuation. Even proposed → dispatched or proposed → waiting with the
same choice revision, purpose and self-state converted a pending appraisal into
historical-only memory, preventing otherwise-current affect/intention updates.
Two production regressions reproduced that mismatch. The appraisal-specific
basis now normalizes these execution statuses while retaining choice revision,
purpose, target, times, reasons and whether the action needs revision. This is
not a motor-authority relaxation. A new choice, including an identically worded
one, and a failed/invalidated action still prevent old current-state updates.
Appraisal itself neither dispatches nor replaces the selected action.

This narrow repair does not yet decouple background meaning from ordinary new
foreground choices. In recorded handoff runs, OL57JR's23s/33s reply choices
occurred during appraisals subsequently labeled continuing_purpose_changed;
iGtco0 likewise had a foreground integration at18s during its first appraisal.
DqygQc's two appraisals instead recorded affect_changed. These are not evidence
that execution-status normalization solves those episodes. Evaluate whether
field-specific appraisal integration can preserve emotional interpretation
without overwriting newer affect, goals or an actor's deliberate revision.
Do not simply remove all stale-result fences to make appraisals look successful.

## Advisory goal ranks — 2026-09-10

Foreground admission no longer requires an extra control.switchReason when the
actor chooses a listed lower-ranked goal. Numeric ranks are decision context,
not permission to act. This also covers continuing the same activity: a higher
ranked concern in the list is not, by itself, a newly chosen interruption.
switchReason remains optional, validated private context, not an authority grant.
Both existing prompt variants now share this contract; no controller or model
was added or switched. Existing background/default scheduling ranks are unchanged.

control.goalId still binds a choice to an owned, listed intention. The existing
activity dispositions govern continuation, pause, replacement and ending; goal
lifecycle operations remain separate from physical success. Selecting a lower
rank does not retire, complete or reprioritize the other goals. Conversational
side actions retain the organizing activity. Physical work still needs native
resource, target and timing checks and exact outcome attribution.

Owner/source/goal-definition freshness, local dependencies, privacy and restored
execution restrictions are unchanged. Regression coverage includes repeated
continuation, explicit replacement, optional explanation validation, stale/foreign
goals, and actual timed pickup/drop under both existing controller settings.
Offline admission evidence cannot establish prompt phone response, interesting
behavior, restaurant growth or a successful episode. Preserve the prior failed
live trials and the unchanged ten-trial and ten-minute endurance gates.
