# Activity entry context versus present intent

2026-09-07. Follow-up to the standing-desire repair; no new live trial.
Retained evidence: sitcom-handoff-boyfriend-YswWm4 cognitive-frames and events.

The old5s purpose remains in OngoingActivity through85s: go Kitchen, check phone,
get cookie. That alone does not establish stale execution or forgotten work.
Actual immediate continuations at33s explicitly vent about the plumbing chore;
43s selects cookie pickup;55s shares the correction;78s explicitly chooses
sarcasm “before handling the note”;86s selects notebook pickup. The evening goal
remains goal24 throughout those choices. Completed cookie/phone plans and a
pending work plan are visible in the saved frames. The handoff eventually
finishes truthfully. Therefore this trace contradicts a simple loss-of-task
explanation; it does not prove the extended conversation is desirable pacing.

Source recordOngoingActivityChoice intentionally preserves the entry purpose
for same-goal decisions. Replacing it with every immediate purpose would erase
the organizing activity on each joke—the opposite of the user's requirement.
But formatOngoingActivity presented this entry purpose as current purpose without
its organizing goal description, inviting confusion between initial strategy
and enduring concern. It now labels entryChoicePurpose as historical and supplies
the exact current own organizingGoal description beside the existing goalId,
status/revalidation and interruption metadata. Stored ECS activity, identity,
time, plan bindings, grant fences and action authority are unchanged. Current
immediate purpose remains in ActorContinuation, not a duplicated activity field.
The situated instruction also now refers to listed review operations, avoiding
its obsolete generic release instruction for standing desires.

Regression exercises an entry choice “Collect my coat” followed by same-goal
“Check my keys”: context retains historical coat choice, exposes the goal
“Prepare to leave”, and does not mutate ECS, plan progress or current continuation.
First red99826 exit1:1failure/14passes0.768s,
/tmp/argos-activity-context-red.log. Focused94490 exit0:188tests/3suites2.367s,
/tmp/argos-activity-context-focused.log. Types42930 exit0,
/tmp/argos-activity-context-types.log. These precede only the small situated
instruction wording change; recheck that before a new live run. Full prior
standing-repair baseline remains3503passed; no full-suite claim for this edit.

Next meaningful investigation: temporal opportunities for ordinary work around
speech. selectAutomaticAgentAction admits an ongoing-activity return only with
no fresh attention, no own speech, no body/capability busy state, a validated
bound physical plan and eligible independent side turn. Same-goal choices instead
use the10s situated-plan lease. In this trial the actor repeatedly explicitly
chose same-goal conversation, so broadening return authority to any old plan
would bypass those choices. Measure actual speech occupancy, opportunity windows,
eligible grounded remaining steps and deliberate waits before changing policy.
Do not simply remove the speech/body checks or force work after N jokes. A
deliberately selected compatible skill may eventually run alongside speech, but
needs clear actor authority, resource contracts and interruption tests first.

Broader acceptance, soaks, maintenance/growth and H3 remain incomplete. Batch04
stays closed failed. No live run, server restart or provider session started here.
