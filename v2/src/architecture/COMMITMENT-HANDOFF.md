# Private commitments into existing personal planning

The coordination reviewer recognizes an undertaking in actual owned speech or
a sent text. CoordinationMemory is the ledger; saying it, linking a goal, sending
a reply, and finishing a supporting goal are not proof the undertaking happened.
Neither a counterproposal nor an outgoing receipt proves another party agreed.

## Owners and handoff

1. `coordinationPlanningContext` reads own open undertakings and resolves their
   stable goal identity. Active, paused, queued and pending linked intentions
   already represent work. An absent or ended link makes a follow-up eligible for
   review, not for execution. Heard promises remain attributed words, not duties
   automatically assigned to the listener.
2. `autonomous-goals` uses its existing bounded personal-review lane for this
   input alongside newly admitted appraisals, even if routine goals remain active.
   One review considers the supplied batch. Ordinary time passage, report chatter
   and the review's own link do not keep reopening it. No-new-intention is valid.
   Readiness acknowledgements are transient existing scheduler state; the ledger,
   adopted goals and deferrals are ECS/persisted state. A fresh runtime may review
   an unresolved unlinked undertaking again, but never reconstruct a completed
   action or invent another person's agreement.
3. The actor may propose a distinct subjective intention with an explicit
   `followUp.undertakingId`. Prepare validates the current owned source and goal
   basis, then commits the new Goal and a supporting link synchronously. It does
   not make the old reply task a parent (which would retire the meeting with it),
   or automatically label the new goal as fulfilling the entire promise.
4. Optional `reviewAtSimMs` is a chosen reconsideration time with a reason, not a
   parsed/certified appointment. It must be within a simulated day of the original
   communication timestamp; a legacy source with unknown simulation time cannot
   authorize a timed follow-up. Context supplies exact original words, source
   timestamp/age, current world time, actual private correspondence, and existing
   intentions. Interpretation is still model judgment and requires live evidence.
5. `goal-pursuit` prepares an initial deferral using the existing GoalLifecycle
   deferred record and fast-clock resumer. Foreground deferral remains 10–60s.
   The source-anchored time never slides forward with inference latency. If it
   passed during inference, the new intention starts active for consideration.
   Future waiting preserves the original post-review execution budget. Waking
   establishes a bounded inactivity-review opportunity, not action/progress proof.
6. The ordinary planner can prepare work once the goal is active. Foreground
   selection/ongoing activity, native target/resource/temporal checks and executor
   outcomes retain authority. No travel, speech, calendar event or world generation
   is directly executed by this handoff. Explicit appraisal can still relinquish
   a paused intention; withdrawing an undertaking remains a separate ledger choice.

## Safety and limits

Stale/relinked/released work, changed owner/source/goals, new personally read
correspondence and cancellation invalidate an in-flight proposal before effects.
No unread text, other actor's private memory or remote world state is consulted.
Save/remap retains source time, stable link and chosen deferral; existing restart
policy reconsiders a deferred goal and does not replay an old plan or action lease.

This is a handoff repair, not a new controller, time-language parser or automatic
compliance system. No promise mandates immediate departure. No live behavioral,
ten-trial, endurance or H3 acceptance claim follows from its offline tests.

The earlier experience-to-review boundary is described in
[APPRAISAL-INTENTION-HANDOFF.md](APPRAISAL-INTENTION-HANDOFF.md). A request is not
an undertaking: the actor must actually choose or express one first.
