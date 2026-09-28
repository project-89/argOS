# Background cognition prompt review

Scope: `planning-system.ts`, `autonomous-goals.ts`, `reflection-system.ts`, plus a subsequently requested narrow daemon/narrative prompt cleanup.

## Findings and changes

- **Planning:** Grounding and completion rules were repeated across context and two output prompts. Ordinary character plans also received office-specific file paths, sample tickets, and tool instructions. There is now one concise planning contract and one JSON shape. Tool argument formats appear only for visible capabilities; structured task requirements remain conditional on the goal. Known rooms, physical affordances, action feedback, and the objective success contract remain inputs.
- **Social continuity:** Recent executed actions and actual actor-owned dialogue are data, not an expanding list of conversation prohibitions. New speech invalidates stale queued questions, absent addressees block directed speech, and completed social plans have a bounded reconsideration cadence in code. Prompt cleanup does not replace those mechanisms.
- **Autonomous goals:** A numbered priority recipe mandated social goals from loneliness and socializing at festivals, while demanding a different goal even if existing commitments mattered more. Needs, time tendencies, and commitments now inform character-specific priorities without prescribing a category. The optional first action is explicitly advisory background work.
- **Aspirations:** Occupation examples prohibited interests outside the character's trade and required a fixed personal/practical mix. The prompt now includes the actor's own background and allows interests beyond occupation.
- **Reflection:** The prompt required 2–4 insights despite validation permitting 1–4, and encouraged synthesis even with sparse evidence. Prompt and validator now allow 0–4 grounded insights, distinguish interpretation from observation, and allow no new questions. An empty reflection records that the memories were reviewed without manufacturing memory or retriggering immediately. Reflection remains private background processing, not execution or proof of world state.

## Related mechanism risk (reported separately)

`bt-compiler.ts` originally captured a selected speech line verbatim, omitted its addressee, and learned it behind broad room/social/random conditions. That could replay a context-specific question or answer as ambient speech after its context expired. This was reported to the owner of the behavior-tree changes; it is not fixable by planner wording. No behavior-tree code is changed by this review.

## Adjacent audit and narrow cleanup

- `agent-daemon.ts`: Guidance is delivered as a cognitive stimulus, with cooldowns rather than direct execution. Challenge generation nevertheless asked for jealousy, self-doubt, restless urgency, and an unsettling voice that would not let the actor rest. Its two generation prompts now request optional observation-grounded questions/possibilities; both existing paths already accept empty output without sending a stimulus. Challenge fallback lines and narrative nudge wrappers now offer possibilities instead of asserting needs, arrival, or shifted priorities. This does not validate arbitrary upstream nudge contents or change the advisory delivery mechanism.
- `spirit-cognition.ts`: Its persistence/agency contract correctly treats live ECS evidence as authoritative. The narrative repetition block contradicted that by requiring progression and offering an invented arrival as the improved version of repeated movement. It now permits empty prose for unchanged evidence and explicitly separates movement intent from arrival. Existing JSON and intervention schemas are unchanged.

## Verification

`background-prompt-contracts.test.ts` uses mocked generation and rejects network access. It checks capability-scoped tool formats, stable JSON fields, actual needs/background evidence, preserved physical target rejection, unchanged goal status after planning/reflection, and the background interpretation boundary. Existing planning continuity and integrity tests cover stale social plans and execution-backed advancement.

`advisory-prompt-contracts.test.ts` checks no-whisper results, cognitive-only delivery, optional nudge phrasing, and evidence-only narrative repetition handling with no live calls.

## Follow-up: heard dialogue and stale listening

The live baseline exposed a remaining loop: queued observation/wait steps still anticipated an answer that had already been heard. Planning now records the latest **heard** speech event ID in `Plan.heardDialogueId`, not a copy of the conversation. Own speech and history trimming do not invalidate the plan. New heard dialogue retires speech/person-observation steps and social-plan thinking/waiting; physical movement, interaction, and object/room inspection stay independent. Context and readiness projections only flag/hide stale intentions; action selection or the planning scheduler owns retirement.

The field serializes with ordinary Plan data, and absent legacy evidence fails closed for social steps. A separate existing persistence gap remains: `world-persistence.ts` does not preserve `HasPlan` or remap `Plan.goalEid`, so loading does not currently resume active plans. Full plan reconnection is intentionally outside this bounded fix. Regressions cover the saved marker, missing legacy evidence, heard-vs-own speech, physical-step independence, and pure projection versus scheduler authority.
