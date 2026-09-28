# Spatial presentation and daemon asset workshop

## Decision — 2026-09-26

Argos owns simulation truth. The 3D viewer owns its presentation. An asset
workshop may propose and test changes, but is not a second simulation authority.
Most visible detail does not require an ECS entity. This is the same boundary
already used for building trim, floorboards, character rigs and rain particles.

**Implemented now:** authored native town, validated spatial construction,
local GLB assets/animation playback, public scene projection, generated wetness,
and a world-space weather rendering pass. Existing cognition and execution
authority remain unchanged.

**Design only:** an automated Blender workshop, hot-published arbitrary asset
packs, automatic rig retargeting, and generated interaction/animation bindings.
No Blender installation, pack purchase, or broader daemon permissions are part
of this pass. The current wetness daemon still has its one-mechanic scope.
The present coding release format validates text systems/components, not binary
GLBs or Blender projects. A typed asset-release service would reuse its design
principles, not silently pass binary content through that text-only interface.

## What belongs where

| Concern | Owner | Examples |
| --- | --- | --- |
| Meaningful facts and consequences | ECS/native systems | Who is wet; where a tree stands; whether a seat is occupied; an action's admitted start and confirmed completion |
| Geometry and presentation | Viewer/asset library | Cloud puffs, droplets, leaves, window trim, shaders, character bones, animation blending, rendering detail levels |
| Candidate content and tests | Isolated asset workshop | Blender scene, proposed mesh/rig/material changes, navigation fixtures, preview recordings |

A tree may be one entity with a damaged-branch state. It does not need an entity
for every leaf. If a branch becomes a portable log that can be carried, traded
or burned, it needs corresponding native state and capabilities. A new mesh
alone never supplies them.

Weather conditions and their physical consequences remain authoritative.
Decorative cloud shapes and drift do not currently imply a wind simulation.
The sun's display and directional illumination share a direction, but there is
no new native day/night or astronomy model. Any later shadow, temperature or
wind effect that changes agents' experience must receive native state too.

## Art direction for the current town

- A readable, warm, inhabited miniature town: grounded forms, soft light,
  restrained colors, recognizable silhouettes and varied but coherent detail.
- World-space atmosphere: substantial rounded clouds above the buildings,
  shaded undersides, cooler overcast/rain conditions and locally masked rain.
  No viewport-pinned weather stickers.
- Town framing stays based on navigable places and confirmed objects, not the
  sky's enormous bounds. Inspection can fade obstructing clouds without moving
  them or changing simulated weather.
- Keep mobile costs bounded. Shared geometry, modest detail and instancing
  where appropriate come before expensive volumetric rendering.
- Imported packs should form a coherent visual language. Do not force an asset
  into an incorrect footprint by stretching it just because it fits the old
  placeholder's dimensions; validate its real dimensions and interaction space.

## The future shadow scene

Use a **persistent, disposable authoring mirror**, not a world fork that can
overwrite live state. It is built from a versioned public world snapshot plus
asset references. It contains geometry, placements, rigs, collision proxies
and interaction markers. Private thoughts, messages and memories are not
needed for visual authoring and should stay out of its default input.

Blender's in-memory scene can remain loaded for iteration, with checkpointed
project files and immutable exported candidates so a crashed worker can resume.
Changes to the live world can refresh unedited portions of the mirror. Candidate
edits retain their base revision and are revalidated against current world state
before publication; a stale mirror never becomes a full-world restore.

The proposed sequence is:

1. **Request:** a spirit/operator identifies an evidenced content or capability
   need within a specific permission and resource budget.
2. **Stage:** a daemon edits an isolated Blender project or procedural asset
   source. It can reuse an approved pack. It cannot edit the live asset directory
   or execute arbitrary exported scripts in the browser.
3. **Validate:** export a candidate GLB and a manifest; check the actual imported
   result in the target viewer, not just Blender's render. Independently test any
   native system/component change needed for the advertised behavior.
4. **Approve and publish:** authorize the specific content/mechanic changes.
   Recheck current entities, source/revisions, routes and in-progress actions.
   Publish immutable asset versions and native changes at an appropriate world
   boundary. A client reports the version it loaded; it does not report success
   for native actions merely because an animation ended.
5. **Observe:** compare actual native use, rendering errors, frame cost and
   navigation results with the request. Feed those outcomes to the spirits.
   Roll back an asset binding independently where safe; never undo unrelated
   NPC experiences, inventory or progress by restoring the old shadow scene.
   A change to native physics may require a separately reviewed compensating
   change. Existing spatial construction preflights proposals but does not
   promise automatic rollback after an unexpected native commit failure.

## Proposed asset contract and gates

This is a design checklist, not a newly implemented manifest schema.

- Stable asset ID, immutable version/content hash, source/provenance and
  permission to use and serve it. Keep licensed source material out of public
  release paths unless permitted.
- Units, coordinate conventions, pivot/origin and measured bounds.
- Named animation clips with durations and rig/socket information; presentation
  bindings for native activities such as walking, sitting, carrying and eating.
- Collision/occlusion proxies, support surfaces, entrances, approach points,
  interaction anchors and any navigation implications. Decorative geometry
  must not imply physical access that the engine does not have.
- Declared native affordances and their actual executors, requirements, timing
  and outcomes. An attractive chopping clip is not a food-preparation system.
- Static geometry/texture/material/animation budgets and measured browser
  checks, including mobile-target viewports, source replacement and cleanup.
- Regression fixtures: reach a chair and sit without clipping; approach a
  table; carry an object with its socket aligned; walk through a doorway;
  preserve timed actions, inventory and interrupted-action semantics.
- Publication while an asset is in use: either preserve compatible bindings
  and geometry or defer the swap. Do not displace residents or invalidate an
  ongoing operation merely to make an export fit.

## Small next asset milestone

Once an approved/licensed pack is available, import a small representative kit:
one house, one tree, one usable seat/table and one rigged character. Prove scale,
navigation, sitting, carrying and animation timing in the existing renderer
before expanding the catalogue. Additional animations can illustrate existing
actions; genuinely new actions still require native simulation support.

For weather physics evidence and its remaining timing/behavioral limits, see
`TOWN-WEATHER.md`. For bounded spirit authority and earlier autonomous story
failures, see `TOWN-STORY.md`. This rendering/authoring plan closes none of the
ten-trial, ten-minute endurance or autonomous world-growth acceptance gates.

## Aureum and in-world authoring research

The 26 September follow-up, `AUREUM-INTEGRATION-AND-IN-WORLD-BUILDER-PLAN.md`,
maps Terminus's packaged Aureum evaluator, typed object programs, state-to-3D
bindings and Blender part metadata onto Argos. It proposes one authoritative
native commit path, a bounded two-actor mechanism proof, asset qualification and
an explicit in-world God builder role. This is a researched plan, not an installed
integration or a change to current daemon permissions.

## Current priority: an inhabited place, then Quest 3 — 26 September

The user has deferred Aureum implementation. Improve native simulation and
qualify a coherent environment kit first. VR and speaking to inhabitants are
an explicit product target, not a reason to replace Argos or its Three renderer.
No asset has been purchased/imported and no headset test has been performed.
This checkpoint implements only native endpoint ownership. The new scenario,
asset qualification and XR/voice stages below remain planned work.

### The three proposed packs

These are source-page assessments, not performance measurements or purchase
decisions. Choose one visual direction for the first location.

| Pack | Useful evidence | Decision / qualification needed |
| --- | --- | --- |
| [Meshingun Gothic Interior](https://www.fab.com/listings/c856b256-c060-4337-8156-8b604ce0cadd) | 400 modular assets/prefabs; Unreal and Unity delivery | Strong archive/university direction. Raw portable mesh delivery and conversion need verification. Unreal lighting, material tools and book generator do not transfer automatically to Three. |
| [Fishing Village](https://www.fab.com/listings/ee978015-00c2-49b9-aac6-59ade88e96fc) | Blender and Unreal sources; modular coastal architecture, piers, boats and market props; 2K–4K PBR textures | Preferred detailed coastal direction. Its fantasy/medieval silhouettes need art direction for New England. Complete walkable interiors, geometry cost and export need inspection. |
| [ithappy Horror Mansion](https://www.fab.com/listings/fb77697c-de92-473e-8da8-e240e87dae1d) | 712 assets; Blender, FBX and GLB listed; furnished/environment props | Strongest first standalone-Quest candidate on published specifications. This is ithappy, not Synty. A connected, usable interior and native collision/navigation still need validation. |

[ithappy's technical specification](https://ithappystudios.com/environment/horror-mansion/)
lists approximately 569K triangles across the inventory, three materials and one
1024-pixel color texture. These support a provisional lightweight-rendering
recommendation; the whole-pack triangle total is not an assembled scene budget.
None of the three listings establishes that suitable rigged NPCs and animations
are included. Qualify characters separately, including locomotion, sitting,
carrying, gestures and consistent scale/style.

The exact Fab listings mark Fishing Village AI usage Yes, and the other two No.
[Fab describes NoAI](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)
as a restriction on generative-AI data collection. Do not infer from that badge
alone that an AI-controlled character is forbidden, or that every asset-editing
daemon workflow is permitted. Review the actual purchase terms and obtain any
needed permission for mesh/texture inputs to models, browser delivery and the
intended end-user builder. Catalog IDs and placement instructions are a distinct
workflow from feeding licensed source assets to a generative model.

Qualification starts with a courtyard or short pier, one furnished room and one
rigged resident—not importing every asset into the current flat town. Check units,
pivots, door clearances, interaction anchors, collision proxies, room membership,
visibility, texture cost and animation bindings. Use static lighting, instancing,
texture compression and selective live shadows where appropriate. A real headset
session, including head motion and conversation, must establish comfort and frame
time; a desktop screenshot or vendor VR label cannot do so.

### Better simulation: smallest next behavioral slice

The current story town is not missing all backstory: story mode already authors
memories, aspirations, relationships and an active Narrator prompt. However, its
gathering is deliberately gentle and its branch incident explicitly leaves the
path clear. Ignoring harmless branches is not by itself a failed mind. The last
preserved town trial also recorded ten-agent queue pressure and an intended
narrative opportunity that changed while the model was thinking.

Use three residents in a small archive/house and courtyard: a caretaker, a host
or archivist, and a visiting researcher. Give them different private histories,
relationships and concrete reasons to care about the place. Reuse the existing
Blackout inspection, isolation, part custody, installation and power mechanics.
Disagreement over a prior repair is authored background, not evidence that a
current culprit or sabotage mechanic exists. Reading clues, access deadlines and
deductions need native mechanics before they can become acceptance criteria.

Before the next live trial:

1. Prevent identical native arrival/approach endpoints from stacking bodies.
   This is destination ownership, not a claim of full moving-crowd avoidance.
2. Author one explicit bounded scenario profile. Keep the existing restriction
   against silently swapping arbitrary worlds into town story/growth mode.
3. Ground spirit interventions in current public opportunities. Revalidate the
   participants/purpose used by a delayed proposal, not just the physical target.
   Do not reveal private memories, script NPC reactions or grant new powers to
   make the story appear active.

Then one prospective bounded trial, with no hidden retries: changed native state
is perceived, a resident independently responds, an actual action succeeds or
fails, and the result reaches memory and the next spirit review. Refusal can be
meaningful; offline forced repairs do not prove autonomous behavior. Preserve the
ten-trial baseline and ten-minute endurance requirements as separate open gates.

### Quest implementation sequence

1. **Inside the scene:** retain the desktop camera and add an XR perspective rig,
   human scale, controller selection and world-space public subtitles. Use one
   XR-compatible animation loop. Head/hand tracking stays local and immediate;
   it never waits on snapshot polling or cognition. This is initially spectator
   VR, not yet a character recognized by the inhabitants.
2. **Inside the simulation:** add one server-owned human participant with a
   distinct control mode and scoped credentials. Prove typed local speech first:
   NPC perception and the existing cognitive loop choose any response. Existing
   operator `speak` controls impersonate an NPC and must not be reused as the
   human's speech identity. Private minds/phones/God endpoints remain inaccessible.
3. **Speak and hear:** explicit push-to-talk transcription enters that same native
   speech path. Voice output renders the NPC's exact committed utterance with
   stable speaker identity and positional playback. Deduplicate by speech/source
   ID, handle interruptions and cancel stale audio. Do not synthesize every
   growing subtitle fragment or use playback as proof of a native outcome.
4. **Move and interact:** validated body destinations/teleport anchors, followed
   by broader locomotion and interactions. Local head tracking does not give a
   client permission to teleport its authoritative body or acquire remote items.
5. **Builder mode:** explicit operator capability switch; preview, validate and
   approve catalog placement/native changes. Talking to God is a separate channel
   from speaking audibly to inhabitants. No raw model output edits the live world.

The current server binds to Mac loopback, uses HTTP-origin checks and has one
operator credential. Quest access needs a deliberately configured secure private
route and separate participant authority, not removal of those checks. Microphone
and immersive entry each need user consent. Current hearing is room-based rather
than acoustic distance/occlusion; positional audio alone will not fix that model.

Implementation references:
[Three WebXR setup](https://threejs.org/manual/pages/how-to-create-vr-content.html),
[Meta headset testing](https://developers.meta.com/horizon/documentation/iwsdk/guides/02-testing-experience/),
[WebXR security](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Permissions_and_security).

### Evidence for this checkpoint

Before edits, the offline `spatial-world`, `spatial-town-runtime` and
`spatial-town-story-integration` suites passed: **57 tests across three suites**.
Tests reject provider fetches. This establishes a deterministic baseline, not a
live cognition, asset-import, VR-performance or autonomous-story acceptance pass.
No model run, server restart, public exposure or asset purchase occurred during
the research. Existing failed evidence remains in `TOWN-STORY.md`.

The first native arrival-reservation implementation was too aggressive: checking
the destination's body occupancy on every movement tick aborted a journey when
another moving resident merely crossed its future endpoint. The initial broader
offline check retained **73 passes and two failures across six suites**. Both
failures were in `spatial-town-runtime`: a diner did not reach the cafe, and only
seven of ten concurrent trips completed. Blackout, extended Blackout, repair
memory, scenario and story integration passed; TypeScript checking also passed.
The ten-trip and finite-food assertions are not to be weakened. Final-approach
occupancy must be checked before writing the destination position without
turning a temporary, distant crossing into a failed intention.

After moving the occupancy check to final approach, the ten-trip case recovered.
The next focused check had **58 passes and one failure**: the finite-food fixture
expected two bodies to reserve a single authored anchor. The fixture now explicitly
provides two opposite-table approach anchors; both admissions, one successful
consumption, one failure, correct hunger change and no duplication remain required.
Production object geometry does not invent additional interaction anchors.

The native endpoint fix now uses work-owned reservations, bounded alternate room
arrivals and a maximum five-simulation-second final-approach hold. Holding cannot
bank movement for a later teleport. Existing source/identity/custody guards remain;
present inactive bodies still occupy space. This is a bounded physical change,
not a cognition change, full crowd avoidance, new scenario or XR implementation.

Final independent regression: **129/129 tests passed across seven suites**
(`spatial-world`, `spatial-scenario`, `spatial-blackout`,
`spatial-extended-blackout`, `spatial-blackout-memory`, `spatial-town-runtime`,
`spatial-town-story-integration`), with TypeScript `--noEmit` passing. The focused
executor/town rerun independently passed **61/61**. Two existing callback tests
use independent endpoints so their failure/revocation assertions still exercise
callback handling rather than invalid double-booking. No live behavioral gate
has been rerun or closed. The current browser/server session was left untouched.
