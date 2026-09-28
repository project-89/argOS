# Situated controller experiment

Opt in through `createSimulation({ ..., cognitionController: "situated" })`.
The default remains `"priority"`. This is a Generative-Agents-inspired policy
ablation inside Argos, not a port or benchmark of Smallville or TinyTroupe.
Select it at simulation creation, including when loading a saved world; this
experimental policy is runtime configuration, not persisted character memory.

## Hypothesis

Numeric priority arbitration and automatic return to available tasks can make a
character preserve tasks better than reconsider purposes. Let the foreground
model choose what matters from the same observations, persona, memory, affect,
concerns and goals, without requiring a justification for lower-ranked action.
The enduring concern need not disappear when one strategy is blocked.

## Differences between arms

- Situated selection replaces the priority instruction with a short whole-
  situation decision instruction. It uses the existing version-2 purpose and
  action envelope; it adds no inference call or scripted reaction.
- Numeric priorities remain stored and visible, but choosing a lower-ranked
  goal or independent response does not require `switchReason`.
- Saved plans are presented as proposals rather than mandatory priority work.
- The situated fast path only recruits a plan for the actor's currently chosen
  purpose, not the highest numeric goal. Unselected routine BT, procedural,
  failure-recovery and contract arbitration yield to deliberation in this arm.
  This is therefore a selection-policy experiment, not just a prompt change.
- A purpose can run its grounded plan for at most ten simulated seconds after
  integration before another decision is needed. New attention interrupts
  earlier. This is a reconsideration interval, not an action duration or an
  assertion that a decision takes ten seconds.

The controller does not rewrite priorities, manufacture relationship changes,
retire assigned objectives, or claim subjective thoughts as physical proof.
The existing allowed personal goal reviews and new-goal mechanism remain.
Planner/reflection/appraisal/autonomous-goal producers remain unchanged for this
first ablation, including the background planner's priority-based scheduling.
Thus this is not yet a unified replacement of all competing cognitive producers.

Both arms keep the same model, inference limits, knowledge boundaries, task
queues, physics, action menu, conversation floor, ownership, source checks,
finite action durations and executor completion receipts. The sitcom already
disables learned routine policies; other worlds may show a different tradeoff.
No H3, god, spirits, world evolution or authored NPC reaction is enabled here.

## Evaluation protocol

Run the fixed 120-simulation-second boyfriend scenario under both controllers,
with the same two operator messages at 8s and 28s. Retain every trial and its
source fingerprints. Repeat each arm; stochastic episodes cannot establish a
winner from one appealing transcript. The `--condition=neutral` arm preserves
the same boyfriend and timing while changing only message content.

    npm run eval:sitcom:breakup:live -- --controller=priority --label=priority-a
    npm run eval:sitcom:breakup:live -- --controller=situated --label=situated-a

Review literal events and cognitive frames for:

1. Actual message delivery, perception, read and reply timings.
2. A coherent post-read change of purpose that persists beyond the immediate
   reply. Sharing, withholding, withdrawing, seeking company or continuing a
   task for a changed reason may be plausible; disclosure is not compulsory.
3. Other characters reacting only to actually heard words or visible behavior.
   Their knowledge cannot be inferred from an operator-only thought panel.
4. Repeated demands, repeated actions and return to stale conversation.
5. Completed actions and exchanges, not merely stated intentions.
6. Foreground task median/p95, call count, rejected/superseded decisions and
   unsuccessful or unanswered messages. Report simulation and wall time apart.

The neutral arm should not be required to ignore all messages. It tests whether
the apparent dramatic change is specific to the experience rather than a
controller that simply abandons every existing activity after any stimulus.

## Regression coverage

Controller tests cover world-local/default selection, unknown policy rejection,
free purpose selection without goal mutation, unchosen plans not executing,
lower-priority two-step plans advanced by real timed receipts, attention/expiry/
identity/source/private-edit invalidation, invalid goal/dependency/envelope
rejection, and a controller switch during inference. Existing priority-policy
tests remain in place. A saved purpose is never a restored executable command.
