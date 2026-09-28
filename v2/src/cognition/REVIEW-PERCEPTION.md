# Perception and evidence review — 2026-09-04

## Findings and changes

The formatted sensory paragraph previously respected blind/deaf traits, but cognition separately stored every raw queued event as a structured `Perception`. Those structured records feed attention, recovery and model context. Occupied actors also received the unfiltered records directly, and durable tool/failure memory capture happened before filtering. A safe-looking prompt was therefore not a safe evidence boundary.

`sensory-capabilities.ts` now owns modality inference, trait-derived capabilities and `filterPerceivableStimuli`. The shared filter belongs **before** memory capture, busy-actor delivery and structured perception admission. Sensory rendering, room broadcasts, named-agent routing and committed dialogue recall use the same capability rules. Blind/deaf traits disable their channels even when an enhanced-sense trait is also present. Explicit mental input and executor/tool feedback remain available through the cognitive channel; a phone notification must still specify its actual audible/tactile modality, not deliver unread message text as a thought.

Queue events now retain their emission timestamp and intensity through copying, pagination and requeueing. Sensory conversion no longer resets event time to processing time. Formatting labels older evidence with its source and age, while cached environmental observations are refreshed against the current ECS fingerprint. This distinguishes “Ivo said it was here ten seconds ago” from a current possession or location assertion.

Local object affordances and notable state were also exposed through a default cognitive “intuition” channel, bypassing blindness. Those sight-derived observations now require vision. `getAgentVisibleEntities` similarly gates local and package-visible surfaces, while retaining an actor's own possessions through proprioception/touch. Explicit prior memory and supplied cognitive input are not erased by loss of sight.

Optional ECS fields had another boundary bug: sensing read global SoA slots without checking component attachment. Removed/reused entities could inherit stale descriptions, object states and traits in observation text; non-array trait JSON could also crash olfactory sensing. Optional sensory reads now require `hasComponent`, and trait decoding validates arrays.

The idle scheduler receives `getAgentSensoryFingerprint`: a stable signature of actual permitted sensory output, own room, inventory and capabilities. Clocks and private minds are absent. A sighted observer notices a lamp's state change; a blind observer does not wake for it unless it also produces a perceivable sound. Private remote changes are excluded.

The follow-up projection audit also checks foreground cognition, planning, autonomous goal formation and schedules. Foreground/autonomous context no longer enumerates unseen people, room prose and objects; unavailable sight is labelled unknown rather than asserting an empty room. A speaker's previous attributed words and the listener's own possessions remain available. Generic social context no longer reads another actor's private `Agent.role` directly. Planning inherits the shared visible/owned entity filter; schedules supply an authored location-name catalog and owned knowledge, not current private room state. The room catalog is deliberate supplied map knowledge, not a claim that every room has been explored.

Native directed speech now checks hearing before changing the recipient's focus/arousal. Native `observe` and `examine` reject visual inspection without sight, with failed action/procedure evidence and no leaked target description. A failed inspection does not become a successful plan step.

The same `examine` restriction applies to advertised affordances, direct effect execution and `interact examine`. An unavailable visual action cannot be intercepted by a custom world package or fall through to a permissive variant. Distinct nonvisual actions such as feeling a held object's shape remain available. This is a bound on the existing native visual vocabulary; future sensory-specific affordances should declare their modality explicitly rather than rely on a text-only name.

The separate foreground action-menu projection now follows these boundaries too: blind actors do not receive an enumeration of silent co-located people or advertised visual inspection actions. Destination labels are not a window into remote rooms' current descriptions. `AgentWorldCapabilities.movementTargets()` optionally supplies public destinations reachable in one movement action; explicit empty lists stay empty, and only existing `Room` entities are admitted. Legacy worlds retain an authored room-name catalog. This prevents a package's multi-room map from being advertised as permission to move directly between every pair of rooms.

## Preserved boundaries

- Committed dialogue records only words actually spoken by oneself or heard locally. Model plans, unexecuted speech and another actor's private thoughts do not enter this ledger.
- Dialogue claims remain attributed evidence, never inventory transfers or component-success proof. Original room, event identity and age survive later movement and persistence.
- Closed-container contents and unread phone-message entities are not recursively exposed as visible room contents.
- Filtering does not acknowledge attention. A permitted event still waits for an actual admitted decision; a filtered event must never create a wakeup, memory or synthetic “heard” state.

## Tests

`perception-boundaries.test.ts` covers modality normalization, enhanced/disabled precedence, silent events, mental-channel availability, local vs remote hearing, routing, retained time/intensity, stale SoA fields, malformed traits, blind context boundaries and stable idle signatures. Existing sensory and social-memory suites cover cache invalidation, persistence and claim-versus-proof separation.

`perception-admission.test.ts` exercises the actual cognition cycle for available and physically occupied actors: unreadable/unheard events must not appear in either structured perceptions or durable memory, and retained input must keep its original time/intensity. It also checks that directed speech cannot mutate a deaf listener's focus or arousal.

`perception-context-projections.test.ts` captures mocked planner, autonomous-goal and schedule requests to check the shared visual boundary and continued access to known possessions. No paid model calls are required.

An explicit idle-signature regression varies own thoughts, focus, arousal, continuous needs, action receipts and recent successful-action history across multiple clock steps. None changes the sensory signature. These own-cognition records are not included in `generateStimuliForAgent(..., [])`; formatted prompt history is a separate layer.

## Limits / follow-up

This is modality and room-level evidence control, not a geometric perception engine. Hearing range, sound propagation through doors, lighting, occlusion, gaze and tactile exploration of unknown objects are not generally simulated. Package `context()` hooks remain responsible for what they claim an actor knows; they cannot be sanitized from arbitrary prose after the fact. Named/routed cognitive events are explicit engine delivery, not proof of an acoustic path. The generic queue and static ECS component arrays still require the repository's existing process isolation for simultaneous independent worlds; this patch does not claim to solve global-store ownership.
