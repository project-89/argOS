# Goal handoff validation

This is a repair to the existing foreground/goal-lifecycle loop, not an additional controller. World growth, model choice and H3 are unchanged.

The Elaine/David trial rejected useful replies because a blanket `planDecision` exclusion also rejected release of an unrelated cookie goal. A later departure both released its own goal and claimed work credit from it. These are different cases.

| Proposal | Admission |
| --- | --- |
| Release A, choose a planner decision/action for independent B | Admit together; A retires, B retains its own authority. |
| Release A, select work relying on A or its descendants without explicit credited handoff | Reject the conflicting authority before either review commits. Different IDs are not sufficient independence. |
| Release/withdraw A and explicitly credit a physical step to the same active purpose | Admit the fresh step through ordinary execution; queue the **review**, leaving A active. |
| Release/withdraw plus well-formed subjective satisfaction for the same goal | Relinquishment wins. Ignore the redundant subjective claim and its citations; no completion, evidence credit or social-success notification. |
| Retain/defer, invalid review, expired/replaced source, assigned/verified work, or contradictory activity disposition | Existing conservative checks remain. No queue-based permission. |

## Ownership and order

The actor still selects its immediate action. GoalLifecycle alone stores lifecycle intent. Native executors still own physical outcomes and receipts. Plan selection is a proposal with fresh arguments, not a receipt.

Retirement and admission share the same owned goal-descendant traversal. Review preparation captures descendants too; changing a parent/child dependency invalidates the old review. All review/action conflicts are checked before commits.

`GoalLifecycle.handoffReviewJson` holds at most one private review draft per goal. It is not consumed by a scheduler, executor or background planner. A subsequent ordinary foreground request projects it as the actor's earlier proposal and asks for reconsideration against current outcomes. Only a fresh, explicitly admitted `goalReview` applies retirement. The actor may choose not to release it.

The draft expires after 60 **simulated** seconds. Projection never refreshes this age. Source, owner, persona, goal episode/status/priority/revision and dependent-goal fingerprints fence the draft. It remains historical serialized data after save/reload, not live authority in a restored source. Explicit review clears it. Expired/invalid data is ignored; no actions replay and no state is silently marked complete.

A failed or superseded action does not auto-retire the purpose; failure remains normal experience for reconsideration. Action preconditions, private-message read authorization, target/location checks, native durations, prior commitment evidence and dispatch-time freshness are unchanged. A release cannot count as fulfilling a dinner commitment.

`goal_handoff_review` records IDs and queue/coalescence flags only, not private reasons, message bodies or purported outcome evidence.

## Evidence and limits

Checkpoint and all test attempts: `recordings/handoff-validation-TMbOTs/`.
Prior live failure remains `recordings/elaine-david-growth-integration-WCoM1t/`.
Offline scripted reproductions verify validation and native execution, not whether the live model will naturally choose these decisions sooner. A new bounded live trial is still needed for that claim. Ten-trial baseline and ten-minute wall/simulation endurance requirements are unchanged.
