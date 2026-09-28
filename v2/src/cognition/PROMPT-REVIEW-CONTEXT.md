# Context and auxiliary cognition prompt review

Scope: `schedule-system.ts`, `grounded-cognition.ts`, `sensory-system.ts`, `action-registry.ts`, and `ecs/persona.ts`. This is the auxiliary-context review, not a claim that every model-facing path in the repository was reviewed here. No live model calls were used for this review.

## Changes

- **Grounded cognition:** removed repeated incoming-message copies, mandatory acknowledgments, external-message priority commands, and the invented `#general` destination. Local people, incoming messages, observations, and recorded events/thoughts are separate. The prompt distinguishes unknown information from nonexistent things and thoughts/reports from completed actions. It asks for one appropriate action; incoming speech does not prescribe the response. The existing action JSON fields and optional Slack `use` contract remain. The Slack contract is omitted when `use` is unavailable.
- **Schedule generation:** condensed duplicate instructions into one 5–8-activity daily-routine request. Kept the JSON fields, hours, duration units, and priority range. Names come from the supplied location list; a missing list is stated plainly rather than replaced by “Various locations.”
- **Sensory context:** removed decorative modality emojis, boxes, and repeated failure commands. Failure feedback still comes first and each supplied feedback body is preserved. Inventory describes possessions, not hand occupancy. Without a world, inventory is explicitly unavailable rather than falsely empty. Observed object states are presented as state, not mandatory tasks.
- **Action registry:** kept executable action names, required target/content labels, and affordance descriptions. Need values now describe hunger, energy, and social satisfaction without instructing the actor to eat, rest, or seek company.
- **Persona:** kept character fields, trait descriptions, beliefs, skills, goals, and authored habits. Replaced repeated instructions to perform the persona with one context sentence. Persona creation requests consistent fictional details without repeatedly demanding a rich backstory. Sampling-dimension and sampling-plan prompts were inspected and retained: they already state a specific structured task without directing ongoing NPC behavior.

## Contracts deliberately retained

The exact `🚨 CRITICAL - YOUR LAST ACTION FAILED` heading remains. Failure recovery and procedural-skill readers recognize `FAILED` / `🚨 CRITICAL` in stored perception content. Removing that marker requires a compatible structured-feedback reader migration, not cosmetic replacement. Success headings and modality headings are not used by those readers.

Formatting does not rewrite supplied observations, utterances, or action-result bodies. An upstream producer can still contain older emphatic language; that producer must be reviewed independently. Neither persona descriptions nor prompt requests establish physical truth, authorize an action, complete a shared goal, or resolve an affordance.

`prompt-context.test.ts` captures actual model-call inputs with mocked `generateText` / `generateObject`. It covers single-copy messages, a permitted quiet choice despite incoming speech, local versus remote actors, optional Slack action availability, schedule output contracts, persona constraints, non-imperative needs, and compatibility with deterministic failure recovery. Sensory tests cover preserved feedback order/content and possession versus hand-state wording. These are contract tests, not evidence that a live model now produces better dialogue.

## Remaining system-level limitations

1. **Legacy grounded cognition state/admission:** its session memory and enhanced-agent initialization still key state by numeric EID, not world identity. The legacy JSON parser casts an action type and does not perform the main cognition path's strict action-shape/capability admission. This helper also lacks processed-message lifecycle tracking. A shorter prompt does not repair any of those behaviors.
2. **Schedule locality:** available schedule locations currently enumerate all world rooms, not an actor's explored/known rooms. Parsed locations are not resolved to canonical room IDs at generation, and deterministic fallback activities can use role/location keywords. The prompt's listed-location request is not an execution validator.
3. **Schedule/population structure:** daily schedule cleanup bounds activity counts and individual timing fields but does not prove full-day coverage or non-overlap. Sampling-plan generation has a structured schema but no native proof that requested quantities sum to the requested population size. More prose is not a substitute for validation.
4. **Persona application:** `applyPersonaToEntity` puts the persona backstory in the general `Description` component and scales Big Five values to 0–100. Public appearance and private background must be separated by the relevant data/visibility pipeline; trait-scale consumers need a compatibility audit. These application behaviors were left unchanged in this prompt-only pass.
5. **Caller-supplied context:** custom system prompts, persona prose, additional context, and recorded text are preserved as authored. This pass does not sanitize arbitrary instructions embedded in those inputs or migrate every upstream event producer. Trust/source boundaries belong in context assembly and action admission.

No repetition counters, mandatory social replies, scripted character decisions, or scenario-specific repair recipes were added to these prompts. Continued behavior should be judged with native action/goal evidence and sustained dialogue evaluation, including both the baseline and the opt-in multi-person repair challenge.
