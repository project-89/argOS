# Working-memory consumers

## Failure traced

In `recordings/generative-agents-obBRAe/events.jsonl`, Ivo successfully gives the Spare fuse to Mara at 41s. His 43.5s thought remembers that transfer. Sera's 45s claim that he still has the fuse contradicts it. By 47–51.5s Ivo doubts both the transfer and the earlier pickup, then leaves to search the empty cupboard. At 58s reflection promotes this confusion into a new remembered interpretation.

The old planner had dialogue excerpts, importance-ranked memories, plan history and one tool-result cache, but no durable, current-by-subject account of observed transfers. No amount of keeping the ECS correct makes a missing receipt appear in cognition.

## Changes

- Foreground cognition, planning, autonomous goal generation and reflection now receive the actor-owned physical working-memory projection before older recollections. Claims remain in dialogue recall; this integration does not convert dialogue to possession facts.
- Foreground model results compare their selected action, thought and proposed goal references against the captured working evidence before admitting any of them. A relevant correction rejects the obsolete draft without installing its thought/goal/conversation; unrelated changes preserve independent physical actions. Existing dialogue-relevance checks remain separate.
- Idle foreground signatures include meaningful working-memory revision. New knowledge wakes a quiet actor even without another prompt-line refresh; repeated confirmation alone does not.
- Autonomous goal admission and the quiet/no-goal review include the working-memory revision. A meaningful change reopens deliberation; an unchanged confirmation does not.
- Background social plans capture source dependencies in an engine-owned `PlanStep.workingMemoryDependency`. Model-provided dependency metadata is overwritten. In-flight and stored social steps are reconsidered when their referenced physical evidence changes.
- Dependency fingerprints use observed subject identity keys and labels, not fresh ECS lookups or value labels. Mentioning a destination room does not create a dependency on every item located there; words such as "off" and "closed" do not create dependencies on unrelated objects sharing that state. They ignore source timestamp changes and unrelated objects. A matching completed own action also supersedes a pending social draft. The fingerprint persists in the existing plan-step JSON without numeric entity references.
- Current physical steps retain live reach/affordance checks, including before background admission. A stale upcoming question is hidden from context while a still-valid physical step can continue. Readers do not retire plans; selection/scheduling owns that mutation.
- Reflection drops a world/goal interpretation or question if its referenced physical evidence changed while inference was running. Unaffected historical/self/social insights remain available. Reflection still cannot satisfy physical goals.

## Boundaries

Dependencies match complete observed subject labels or stable subject keys, case-insensitively and across punctuation. They do not claim to resolve pronouns, semantic equivalence, abbreviated names or the meaning of arbitrary prerequisite prose. Naming Ivo does not implicitly name all of his possessions. The full source account is supplied to the model for reconciliation; execution remains the physical authority. Existing dialogue-change guards are separate and still broader than semantic relevance.

The consumer layer does not infer social commitments from free-form speech. Actual dialogue, active goals and stored plans remain those separate inputs. It also does not by itself correct an erroneous model interpretation when no new source event arrives; the live evaluation is needed to measure whether the new grounded context improves that behavior.

## Offline evidence

Ten focused suites: 224 tests passed, 5 existing live tests skipped. Typecheck passed. Coverage includes cross-prompt source ordering, a handoff arriving during foreground cognition or background planning, same-value refreshes, unrelated object changes, stale next-step projection, legacy dependency absence, model metadata rejection, physical-plan preservation, foreground/autonomous quiet wake, and partial reflection admission after correction. No provider or H3 calls were made for these tests.

Final dependency audit reproduced and fixed an overly broad value-label match. Nine focused suites were rerun after switching to subject-only matching: 195 tests passed, 5 existing live tests skipped; typecheck passed. New regressions prove that an unrelated mug moving out of a referenced room, and unrelated objects changing shared "off"/"closed" states, do not stall foreground movement. Explicit Spare fuse handoff guards still pass.
