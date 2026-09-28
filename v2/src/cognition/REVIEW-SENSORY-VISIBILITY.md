# Sensory visibility audit — 2026-09-05

The original read-only audit below was recorded during the trial 9/10 freeze.
Its reproductions and benchmark checks are historical evidence, not claims that
the later repair was already present in those trials.

## Sixth-continuation implementation

`sensory-system.ts` now consumes the shared pure `getAgentVisualEntities` surface
graph for visual people/objects, sight-derived affordance awareness, default
danger cues, and notable object states. `getNotableObjectStates(world, actorId)`
is observer-bound; it no longer accepts a room as authority to enumerate secrets.
The resolver, not a second sensory traversal, decides whether native nested
container contents are visible. Admitted child objects retain their current
description/state and an admitted visible-parent label in the sensory text.
Typed exposed `Surface` supports use “on”; opaque or open `Container` enclosures
retain “inside.” Newly discovered nested contents require `PhysicalObject` or
`Agent`, matching the inspection contract. A Name-only unread message nested in
an open physical object cannot become scene text or receive an observed identity,
even when a package advertises its ID. Legacy direct-room Name-only objects remain
compatible in this bounded change; generated physical objects already carry the
proper prefab marker.

The environmental cache uses only visual fields actually rendered and exact
enabled auditory/olfactory emission projections. It excludes unrelated raw
traits, hidden visual state, closed interiors and disabled channels. Pending
events remain fresh and retain their original source time. The cache regression
also measures actual visible-description reads, proving that private mutations
do not trigger environmental reformatting rather than merely checking equal text.

Sound and smell deliberately do not use the visual filter. A concealed authored
ambient source can still buzz or smell of smoke. A blind/deaf actor loses the
disabled modality while preserving other enabled channels. Direct own inventory
remains known through the existing possession projection, without promoting a
concealed item's description, screen state or danger traits into sight.

`__tests__/sensory-visibility-integration.test.ts` covers concealed/invisible/hidden
people and objects, visible/hidden native open-box children, nested/closed/stale
open-trait ancestry, package candidate bypasses, foreign inventory, cyclic
containment, hidden own possessions, per-modality cache behavior, and actual
AI-disabled `runCognitionCycle` → stored senses → `buildAgentContext`. Fetch is
forbidden throughout. Current scene headings and target menus are integrated by
their respective owners through the same resolver, not through secret-name
redaction.

Still intentionally outside this bounded repair: propagation/attenuation of
sound or smell from nested containers and recognition-sensitive emission labels.
Existing ambient emitters are public authored emissions; a `Name` substituted
into their template is treated as that emission's source label. Generated worlds
must not put secret payloads in public descriptions, public state, or those
labels. A future modality-specific source contract should distinguish a known
phone/voice from an unidentified muffled sound without inventing visual access.
The older mixed `Room.ambience` fallback also emits the whole authored string as
sound when it contains `hear`, `sound`, or `noise`; separating that untyped prose
into modality-specific authored fields remains future work. This repair claims
consistent entity-surface admission, not semantic redaction of public prose.

## Original frozen audit

Only this document was initially added. Ephemeral in-memory checks used
AI-disabled worlds and a throwing `fetch` guard; no model requests or test-file
edits were made during that freeze.

## Finding: the prompt has multiple visibility authorities

The new `cognitive-local-view.ts` and visual observation admission correctly use
strict public local surfaces. Legacy sensory prose and other prompt projections
still enumerate a broader set. A safe new local-view paragraph does not undo
secret information already present elsewhere in the same prompt.

Confirmed path, exercised rather than inferred:

`runCognitionCycle` → `generateStimuliForAgent` → `formatStimuliForPrompt` →
`addPerception(type="perception", source="senses")` → `buildAgentContext`.

Relevant entry points:

- `sensory-system.ts:generateVisualStimuli`: people use broad
  `getAgentVisibleEntities`; direct-room objects have no concealment filter;
  open-container child names are manually expanded without child concealment checks.
- `sensory-system.ts:generateCognitiveStimuli`: affordances and danger enumerate
  room occupants independently of the strict visible set. A visually hidden entity
  can be named by an apparent “intuition” even when sight is later corrected.
- `sensory-system.ts:getNotableObjectStates`: accepts a room, not an observer, and
  independently exposes hidden object names and blockers such as “needs unlocking.”
- `agent-mind.ts:buildAgentContext`: `Others Present` enumerates all same-room
  agents when sight is enabled; known objects use the broad capability target list.
  These headings leak independently of the stored sensory frame.
- `action-registry.ts:buildAvailableActionsContext` and its people/target menu projection
  also use broad room/target discovery. They belong in the same follow-up audit;
  fixing only descriptive prose leaves actionable names exposed.

`cognition-system.ts:renderRoomPerception` is another exported legacy formatter
with broad occupants and a fallback that labels all another actor's inventory as
“holding.” No production call site was found in this bounded review, so it was not
the exercised live cognition path and should not be presented as one.

## Minimal reproductions and controls

Use `createArgosWorld` + initialized prefabs, one sighted observer in Study, set
`world.meta.aiEnabled=false`, and register a minimal ready/free world capability
if needed to force a foreground cycle. No generated decisions are required.

1. Add a same-room person with `Traits.active=["hidden","hostile"]` and a distinctive
   public description. Add a same-room object with `Traits.active=["hidden","locked"]`,
   a distinctive `ObjectState.current`, and `Description.value`.
2. Add an open container in that room. Place an ordinary named child and a child
   with `Traits.active=["hidden"]` directly inside it.
3. Run `generateStimuliForAgent(world, actor, [])`, then the actual AI-disabled
   `runCognitionCycle(world, registry, {agentEids:[actor], enablePlanning:false})`.
   Read `buildAgentContext(world, actor)` afterward.

Observed output:

| Surface | Strict current view | Legacy stimulus / actual prompt |
| --- | --- | --- |
| Hidden person | Excluded | Name and description in SIGHT; name also in affordances/danger |
| Hidden direct-room object | Excluded | Name, state and description in SIGHT; name/blocker in awareness |
| Hidden child of open container | Excluded | Child name in `(inside Open box)` |
| Ordinary child of open container | Not discovered natively by strict helper | Legitimately visible child name in open-container prose |

All five test markers (hidden person, hidden object, hidden state, hidden
description, hidden child) reached the actual stored-senses prompt. This is not
merely a cache signature or operator-log disclosure.

A second ephemeral check isolated container semantics:

- Ordinary `ObjectState.current="closed"`: child name remained absent.
- The same closed container with a stale `open` trait: child name was exposed.
  Legacy `isOpenContainer` treats that trait as overriding the closed state;
  the strict containment boundary correctly gives closed/locked state precedence.

Positive modality controls also passed: a blind observer had no SIGHT, retained
their own satchel in the inventory section, and heard a hidden ambient alarm.
Concealed is not synonymous with silent or untouchable. Do not fix this by applying
one visual filter to every sensory modality.

## Authored escape benchmark check

No actual escape-code disclosure was found. AI-disabled fixture seed 88901 was
run separately on observatory and relay, sampling all three actors' contexts plus
formatted sensory prose at every milestone and action-detail event: 156 and 162
samples respectively. Both physically escaped. The actual exit code was absent
before its first private read and absent from never-reading bystanders throughout
the no-speech fixture. This establishes only that bounded check, not universal
privacy of arbitrary generated worlds.

The fixed scenarios keep unread clue/code text out of public descriptions and
states, use closed containment for the crank, and emit private read detail only
to its reader. The general hidden-surface defect therefore does not invalidate
the reviewed authored benchmark runs. Preserve the current two-run production
freeze; prioritize the generalized boundary next continuation.

## Proposed generalized boundary

Use one actor-local **perceptible surface graph**, with explicit modality and
provenance, instead of independent name filtering in each formatter:

1. A pure visual resolver admits current room surfaces, visible people, and
   visible objects. Traverse legitimately open public containers with bounded,
   cycle-safe ancestry. Closed/locked state wins over an old `open` trait. Apply
   concealment at every traversed ancestor and leaf. Never traverse another
   person's inventory merely because the person is visible. Package-supplied
   target IDs cannot bypass containment or concealment.
2. Preserve direct own possessions through tactile/proprioceptive evidence when
   blind or detached. Knowing the satchel is yours does not automatically reveal
   its sealed interior or unread labels. Decide tactile detail through a declared
   touch surface, not by reusing visual raw state.
3. Reuse this visual graph for current scene text, public activity, sight-derived
   affordances, notable-state awareness, prompt headings, observation receipts,
   and corresponding target menus. Keep actual evidence admission at sensing
   boundaries; pure readers/formatters must not allocate identities or receipts.
4. Auditory and olfactory sources use their own emission/reachability rules.
   Hiding an alarm must not mute it. Nested sources need explicit propagation or
   attenuation through containers, rather than either global enumeration or
   visual visibility. A recognizable voice/owned phone may identify its source;
   an unknown muffled sound should not automatically reveal an internal entity
   name. Use authored public emission labels and actor-recognized evidence, not
   an ad hoc list of sensitive names. Preserve legitimate explicit mental input
   and executor feedback as separate channels.
5. A sight-derived danger cue cannot secretly inspect hidden traits. If a world
   deliberately grants a nonvisual danger sense, give it an explicit capability
   and attributed emission rather than the default intuition path.

Do not simply replace every broad list with today's strict helper: it currently
does not discover ordinary children of native open containers unless the package
lists them. First establish shared bounded open-container traversal so the repair
does not break legitimate container puzzles.

## Cache noninterference and acceptance checks

`computeRoomFingerprint` currently includes broad people/object descriptions,
states, traits and manually expanded child names. Its inputs must become the same
admitted surfaces used by each modality's output. A hidden or sealed child mutation
must not produce fresh visual knowledge or change the observer's visible-world
signature. Opening a visible container must invalidate it. A changed audible
emission may still invalidate sound even when its source is visually hidden.
Pending delivered events remain uncached and retain their source time.

Required offline regressions should cover the complete prompt path, not only a
safe formatter: hidden/invisible/concealed persons and objects; hidden open-box
children; contradictory closed-state/open-trait; visible ordinary open-box items;
foreign inventory and nested/cyclic containers; blind own inventory; deaf sound
rejection; hidden but audible sources; per-modality cache noninterference; and
unchanged historical memories without new private-location evidence. Check that
pure lookup does not create identities and that denied perception creates no
memory, attention, goals or action-availability claims.
