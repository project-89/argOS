# Argos + Aureum: a living, editable mystery world

Research and proposed implementation plan — 26 September 2026.

**Status: research, not an integration release.** No runtime code, dependencies,
models, servers, Claude work, databases, or assets were changed by this pass.
No purchase, provider run, deployment, or new autonomous goal was started.

**Priority update — later on 26 September:** the user wants Aureum kept as a
research direction for now. Its authorable, stateful rules remain promising,
but the next work is better native simulations, a qualified environment kit and
a path into the world on Quest 3. The phases below are a retained integration
proposal, not authorization to start an Aureum import. See the current priority
section in `SPATIAL-RENDERING-AND-ASSET-PIPELINE.md`.

## Recommendation

Use **Argos for the inhabitants and the running physical world**, **Aureum for
selected authored/generated deterministic mechanisms**, and **Three.js for the
presentation**. God and the spirits propose changes through a checked authoring
path. They do not become an alternate source of world truth.

This is a promising composition, not a reason to replace working Argos systems
or import the entire Terminus application. Start with one mechanism and one
beautiful, genuinely walkable room. Keep the current town as a regression fixture.

The eventual experience: stand in an archive courtyard, select an entrance and
say to God, "Put a reading room here, with a locked cabinet and a lamp beside
it." Inspect a proposed layout, approve it, watch it become usable, then see an
NPC independently discover and use it. This is a target demonstration, not a
description of today's capabilities.

## 1. What was inspected

Terminus checkout: `/Users/parzival/workspace/oneirocom/project89/terminus`,
branch `dev`, HEAD `1b0d72a` at inspection. It has existing local changes and
Claude worktrees; none was modified. Its `AGENTS.md` was read. This is a source
snapshot, not a claim about what its deployed service is running.

Argos checkout: HEAD `fe67f548bdbf2fa6ef9560ec660253b7b3c6ec52`, with 872 existing
status entries before this document. Working-tree code, rather than HEAD alone,
was inspected. Existing work and failed evidence remain intact.

### Aureum is more reusable than the bedroom application

Terminus pins independently packaged Aureum artifacts:

| Package | Pinned version | Role |
| --- | --- | --- |
| `@project89/aureum-protocol` | `0.1.0-rc.11` | Typed actions, rules, bindings and receipts |
| `@project89/aureum-runtime` | `0.1.0-rc.9` | Pure evaluation and deterministic scheduling |
| `@project89/aureum-host` | `0.1.0-rc.10` | Persistence, journals, reviewed effect delivery and semantic outbox/range exports; no canon Apply authority |
| `@project89/change-record` | `0.7.0-rc.2` | Semantic change-record contracts and hashing; review is separate policy |

`vendor/aureum/README.md` traces these to canonical `narrative-canon` commit
`edb2e6389caa378ebe7f6d87ef33992ccde3f68f`. Future shared changes belong in that
package source, coordinated with its owners—not in edited vendor tarballs or a
permanent private copy inside Argos. The live canonical checkout may have moved;
the versions above describe the inspected Terminus consumer.

There are four distinct layers that should not be confused:

1. **Readable `.aur` world source.** `app/lib/aur/aur.ts` compiles constrained
   declarations such as `thing`, `when`, `then`, properties and flags into
   region JSON. This is an explicit grammar with a JSON escape hatch, not free
   English being interpreted as executable truth. AI can draft it; validation
   and compilation still determine what it means. Region ordering and compiled
   content are pinned by rule-pack hashes.
2. **Generic Aureum runtime.** Actor IDs, nodes, links, holder checks, knowledge
   facts and rule execution exist independently of a bedroom. Ordered schedules
   support dependency checks, conflict detection and bounded evaluation.
3. **Typed object programs.** `app/lib/worldBindings/` supplies registered
   properties/actions, write grants, prepared programs, bounded puzzle analysis,
   successor staging and presentation bindings. A prepared program receives
   state from its host and returns a result; it need not own a parallel world.
4. **Terminus product adapters.** These connect a particular player's adventure,
   inventory, current room, saved programs, authentication and database. They
   are not a drop-in shared-town engine.

The core supports multiple actor identities. However, the adventure adapter
projects a per-player save, and the object-binding wrapper currently derives an
actor identity from its scope. Neither wrapper should be copied unchanged for
ten independently embodied Argos residents.

### Particularly valuable existing work

- `prepareAureumBindingProgram` validates exact typed state and evaluates without
  modifying its input. Initial values are for a new instance, not a recovery
  fallback that overwrites progress.
- `analyzeAureumBindingProgram` explores native transitions and distinguishes
  unreachable goals, reachable softlocks, reversed protected progress and
  unfinished exploration. One successful path does not prove every reachable
  state is recoverable. Its proof is bounded to its explicit model; it cannot
  certify a missing event source, physical access, clue clarity or NPC behavior.
- `stageAureumBindingRevision` pins current state and pack hashes, preserves
  protected rules and returns a candidate for review. It does not publish it.
- `WorldProjectionDriver` translates public properties into presentation
  channels. It rejects conflicting revisions, ignores duplicates and settles
  after missed revisions rather than replaying old actions.
- The Three adapter has typed target/channel ownership. It cannot call an action
  host when an animation ends.
- The Blender workflow separates semantic `entityId` from articulated `partId`:
  a telephone receiver or book cover can move without becoming another game
  object. Candidate exports and measured motion/contact checks precede promotion.

Terminus also distinguishes its ephemeral authoring workshop from owned canonical
publication. The latter has queued authoring, independent review, detached native
rehearsal and a separate admission operation. Rehearsal reports do not claim full
reachability merely because tested routes worked. This is a useful pattern, not
evidence that Argos already has the same general-purpose publication service.

Argos already has deterministic affordances, rule execution, private cognition,
timed actions, cancellation, native construction and generated-system admission.
It is not missing a deterministic side altogether. Aureum's clearest addition
is a better authored mechanism/program layer with explicit revision and puzzle
analysis, not a second motor, controller or universal replacement executor.

## 2. Keep, reuse, adapt, defer

| Decision | Scope |
| --- | --- |
| Keep | Argos cognition, goals/activities, actor-private memory, native movement, simulation clock, custody, execution identities, current spirit authority and outcome feedback |
| Reuse as a package | Aureum Protocol/Runtime at a pinned, tested version |
| Extract/adapt with the other repo owner | Generic typed object-program compilation, analysis/revision checks and public presentation bindings |
| Adapt, do not copy wholesale | `.aur` authoring front end; stable object/property mappings; actor-scoped actions; canonical state projection |
| Keep one executor per mechanism | A selected Aureum-backed mechanism replaces that mechanism's parallel bespoke rule handler only after parity; never run both on the same write |
| Do not import | Terminus account/reward/Prisma/Next.js stack, its per-player adventure controller, full bedroom-specific scene controller, or a second independent saved world |
| Defer | Broad rule migration, arbitrary world editing, unrestricted daemon Blender access, WebXR, distant-world catch-up, full town rebuild, H3 and new model selection |

## 3. One authoritative world, multiple readers

For this proposed Argos host, the **Argos native commit boundary** remains the
authority. Aureum is the deterministic evaluator inside it, not an independently
ticking server whose state is periodically reconciled with ECS.

| Responsibility | Owner |
| --- | --- |
| Why an NPC acts, what they believe or remember | Existing Argos cognition and owner-private knowledge |
| Position, route, reach, inventory/custody, reserved resources, elapsed action time | Existing Argos native systems |
| Whether a designated mechanism's conditions allow its effects | Pinned Aureum program over a validated projection |
| Committing the allowed state change | Argos host adapter, once, under current authority |
| Object appearances, animation, light and sound presentation | Renderer over permitted committed state/events |
| World/rule/asset changes | Authorized operator or God-approved proposal, then native admission |

Proposed control flow:

```text
NPC intention / player interaction / typed text command
    -> one Argos action admission (identity, authority, access, time)
    -> native approach and timed performance
    -> at the defined effect boundary, project current mechanism facts
    -> Aureum evaluates a pinned program, producing a candidate result
    -> host revalidates and commits the permitted native delta once
    -> native outcome -> private experience/planning + public observations
    -> text / 3D / later audio representations

God/operator request -> staged candidate -> tests + review -> same host boundary
```

### Adapter requirements

1. Stable world/source epoch and entity identity mappings, not display names or
   recycled ECS integers. Bind each request to its real actor and issued execution.
2. Declare a bounded read set and write ownership for each program. Private
   facts stay host-side; neither the mesh manifest nor NPC prompts contain the
   rule's hidden answers. Use a mechanism-scoped revision covering every relevant
   fact, rather than invalidating on every unrelated walking tick.
3. Project only supported coordinates/relations. Reject unsupported operations,
   effects, writes and missing mappings; never silently drop an unknown effect.
   Do not let a rule directly modify protected cognition, authority or inventory
   components to bypass their native owners.
4. Evaluate pure code outside asynchronous model work. At commitment, recheck
   source, execution identity, current grants, relevant state, reach, custody,
   rule revision and cancellation. An initial successful preview is not a
   reservation or proof that the action can still finish.
5. Translate a candidate result into a bounded native change batch. State,
   mechanism progress and completion evidence must agree. A pure Aureum result
   is evaluation evidence, **not proof that Argos applied the physical effects**.
6. Publish memory/perception feedback only from committed outcomes. Retain failed
   attempts and rejected/stale drafts. Use durable request identities for any
   future reload/retry guarantee; in-memory repeatability alone is not exactly-once
   delivery across crashes.

**Open engineering gate:** the current spatial construction path validates before
mutation but explicitly does not promise rollback on an unexpected native commit
failure. Do not wrap a general Aureum state patch around it and call that atomic.
First limit the bridge to an implementable, tested transaction boundary. Cross-
inventory/geometry/program changes require staged validation and a failure-safe
commit design before expansion. No long-running LLM, mesh build or graph analysis
belongs inside that commit section.

### Time, knowledge and story

- Argos simulation time is the gameplay clock. Supply Aureum event timestamps
  from a documented simulation epoch, with stable ordering for equal-time events.
  Wall time remains for request deadlines and performance measurement. Do not
  import the bedroom's per-command turn counter as the town's real-time clock.
  Its source fence ignores neutral turn-count changes; Argos cannot ignore elapsed
  time if it changes a deadline, occupancy, need or physical prerequisite.
- Evaluate a physical effect at its native milestone, not on mouse-down, LLM
  selection or animation completion. For a longer action, define phases explicitly
  if effects genuinely occur before final completion; no second duration is added
  by the rule engine.
- Persist due events/cancellation and active program versions in any later world
  resume contract. Merely reloading rule source or a rendered pose is insufficient.
- World facts, evidence discovered by an actor, testimony and beliefs are
  different things. Finding a letter changes the finder's knowledge; another
  resident does not learn it without perception/communication. The rule evaluator
  may need a hidden fact without exposing it in an action menu or error message.
- Keep authored mystery truth and already-witnessed events stable. A narrator
  may arrange a new opportunity or complication, not rewrite the culprit or make
  an NPC know a clue because the story would move faster.
- Existing all-reachable destination exposure and room-level perception are still
  gaps. Aureum does not automatically add learned maps, optical occlusion or an
  embodied player's restricted view. See `TOWN-MILESTONE.md`.

## 4. Smallest useful integration proof

Do not begin by migrating the entire town or inventing a new detective controller.

**First:** a headless, isolated two-actor fixture (one NPC and one player) with a lamp, a latched
drawer and a private note. Native access/timing is unchanged; Aureum evaluates
the latch's authored prerequisite. Wrong attempts fail, an allowed attempt changes
one controlled property, and examining the revealed note informs only the actor
who actually reads it. UI/text input and NPC actions must use the same command.

**Then:** the same fixture in a small archive room, with the native lamp/drawer
facts bound to real light and articulated drawer movement. Text and 3D must agree
after refresh and after a second actor interacts. No solver path is supplied to
the NPC. This is one room, one NPC, one player and a small clue chain—not a new
ten-person run.

Required offline gates:

- Preconditions and unsupported actions; one native result per action.
- Two actors contend for one object; no duplicate possession or progress.
- Stale revision, replaced entity/world, cancelled or out-of-reach action.
- Duplicate request returns the recorded result; same ID/different request fails.
- No hidden clue in public transport, menus, diagnostic text or another mind.
- Rule update preserves current state and protected progress; a softlock or
  analysis timeout is not accepted as a pass.
- Animation, stale poll, reconnect and missing asset never execute gameplay.
- Native commit failure cannot publish success or leave an unrecorded half-change.
- Snapshot/program restore reproduces the scoped fixture's state, including pending
  work policy; this is not a claim of general Argos spatial resume.

Only after those gates, authorize one short model-driven trial to test independent
discovery/use and feedback to spirits. The broader ten-trial baseline and
ten-minute wall-and-simulation endurance requirements remain unchanged and open.
Do not relabel a deterministic fixture or short demonstration as those passes.

## 5. Rendering direction and asset decision

Target: a restrained, atmospheric New England university quarter—brick and stone,
dark wood, believable proportions, readable interiors, trees and a rain-darkened
courtyard. Favor a coherent small environment over many mismatched packs.
First-person viewing must look good at eye level, not only from the town camera.

The inspected Terminus bedroom study shows what deliberate composition, materials,
lighting and articulated props can add. It is an offline Blender study, **not a
browser performance result**. Its authored room and special-case scripts should
not become the town's monolithic asset. Borrow the part/pivot/verification pattern.
Its source notes also flag poster/artwork clearance before public distribution;
do not copy the room's art wholesale as a presumed rights-cleared starter pack.

### Procurement options, checked 26 September 2026

| Choice | Verified fit | Limitation / next check |
| --- | --- | --- |
| [Quaternius Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit) Source, US$14.99 | CC0; modular Boston/NYC-style exterior kit; FBX/OBJ/glTF and Blender sources | Window interiors are a shader illusion. Build a genuinely enterable room. This is a stylized integration foundation, not the final detailed horror look. |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) Source, US$14.99 | CC0; 120+ clips; FBX/GLB/Blend; companion humanoid rig | Check actual retargeting, contact and timing in our renderer; animations do not add native actions. |
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) Source, US$19.99 | CC0; six bodies and modular hair; compatible rig family | Period clothing and character art direction still need work. |
| [Meshingun Gothic Interior, Unity edition](https://www.fab.com/listings/db4a8b58-d890-41bb-9c3f-ab68f118bbdd) | Stronger detailed archive/university art direction | Confirm source export, materials, exact licence and browser/builder use. Unity delivery is not a ready GLB library. |
| [Meshingun THE LIGHTHOUSE](https://www.fab.com/listings/c2c1fb86-ca62-414a-99e5-6d057f4eba83) | Detailed coastal interior/exterior for a later Innsmouth location | Engine-specific effects; raw interchange delivery not verified; not a whole town. |

The three Quaternius Source packages total **US$49.97 before taxes**, at the
displayed prices checked in this pass. They are the recommended low-friction
**technical qualification kit**, not a promise that another low-poly pack alone
fixes the visual quality problem. Their official specifications are available for
[city](https://quaternius.com/packs/downtowncitymegakit.html),
[animation](https://quaternius.com/packs/universalanimationlibrary.html) and
[characters](https://quaternius.com/packs/universalbasecharacters.html).

For the final aesthetic, my preference is a **small commissioned/cohesively adapted
New England kit**, or a qualified Meshingun interior plus compatible exterior work.
Budget for art direction, collision/interaction preparation and browser conversion,
not just pack count. Do not mix a detailed Gothic room with blocky contemporary
characters and expect lighting alone to unify it. Purchase nothing until the user
selects the look and required rights/delivery are confirmed.

Licensing distinctions matter:

- The Quaternius pages label these assets CC0. [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
  provides broad copyright permission for reuse/modification/distribution; retain
  provenance and consider any separate rights where applicable.
- [Fab's summary](https://www.fab.com/eula) permits compatible-tool project use and
  restricts standalone redistribution. [Fab's NoAI documentation](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)
  describes a generative-AI data-collection restriction. NoAI is not, by itself,
  proof that AI NPCs or voice placement are forbidden. Nor is it permission for
  every end-user asset builder. The Gothic SKUs have differing AI labels.
- Synty's and JustCreate's direct-store restrictions can be broader. Resolve the
  exact purchase channel/SKU and workflow, including browser geometry delivery,
  daemon modification, user arrangement and promotional use. Hiding an export
  button is not a substitute for the needed rights. This is procurement guidance,
  not a legal determination.

### Asset-to-world pipeline

1. **Source library:** retain source files, exact provenance/licence, hashes and
   original scale. Keep authored art separate from generated browser exports.
2. **Isolated Blender preparation:** normalize units/pivots, split usable objects
   from static dressing and articulated parts, prepare materials/textures,
   collision proxies, approach/seat/grip anchors and animation names. Disable
   execution of untrusted imported scripts and restrict daemon tools/paths.
3. **Versioned export:** GLB plus a typed manifest containing geometry dimensions,
   parts, sockets, clips, property bindings and required native capabilities.
   Mechanism programs are separate versioned artifacts. No secret rule literals
   or private memory in the GLB's extras or client manifest.
4. **Validation:** file-format validation plus target-browser material/rig checks,
   physical fit, contact/motion sweeps, door clearance, navigation and memory/frame
   cost. A valid GLB alone proves none of the gameplay requirements.
5. **Staged preview:** load a candidate independently of live world state. Asset
   loading and testing do not block simulation ticks or count as new entities.
6. **Approved publication:** immutable asset version and compatible native
   blueprint/rule revision, with current-state revalidation. An occupied seat or
   active interaction cannot be moved underneath its user. Defer incompatible
   changes or require a separately reviewed physical transition.
7. **Observation:** separately report installed, rendered, reachable and used.
   Feed actual problems and native use back to Watcher/Arbiter/Weaver/Tinker.

[glTF](https://www.khronos.org/gltf/) is the proposed delivery format;
[Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) already fits
the renderer and exposes imported scenes/animations. Compression requires the
appropriate decoder setup. Use the [Khronos validator](https://github.khronos.org/glTF-Validator/)
offline in the pipeline; avoid sending unreleased licensed content to public
services without authorization. No Three.js upgrade is proposed here.

The existing coding release validates bounded text systems/components, not binary
assets. Add a separately scoped asset-release service; do not widen the coding
daemon's text-file path into an arbitrary upload/execution channel.

### First visual qualification slice

One courtyard/street, three coherent facades, one real interior, one rigged and
clothed character, one articulated cabinet, one lamp, one bench and a few trees.
Retain useful static detail as scene geometry rather than entities per leaf,
brick or raindrop. Physics-relevant objects still receive native state.

Check entry at human scale, eye-height composition, readable clues, native
collision versus visible geometry, chair/hand contacts, walking without foot
sliding, and interruption during an interaction. Root motion must not move an
Argos body independently of native locomotion. Check outdoor/indoor lighting and
rain occlusion without a hardcoded apartment-only interpretation.

Measure frame-time percentiles, loading time, draw calls, texture/GPU memory,
repeated asset replacement/cleanup and simulation tick latency on named desktop
and mobile devices. Set explicit budgets before scaling; a future headset trial
must meet its own supported refresh rate. No VR or mobile performance claim is
made by this document.

## 6. Builder mode while standing inside the world

Builder mode is an **authenticated authoring role in the existing world**, not
an NPC prompt with extra privileges. It can coexist with a first-person camera.
An embodied player and an omniscient builder need different server projections
and capabilities even if the same human can explicitly switch modes.

The current orthographic operator viewer is not yet an embodied player. Add
desktop first-person look/input separately: immediate local camera response,
native validated movement/interaction, a real body when playing, and a bounded
player-knowledge view. A freely moving builder camera may be useful first but
must be labeled as an observer, not proof of physical player access. Do not expose
operator thought panels or all reachable destinations to the mystery player.

Two separate input channels:

- **Speak to inhabitants:** ordinary audible speech/message, bounded by location
  and perception. They respond or refuse through their own cognition.
- **Speak to God:** explicitly engaged builder input, with visible mode and
  push-to-talk. NPC dialogue, signs and document text cannot issue builder commands.

Speech recognition produces a draft request, not executable code. Capture selection,
aim point, region, actor/observer mode and base revisions with the request. Resolve
"there" or "that door" to stable references; preview ambiguity rather than guessing
against a changed scene. Display the recognized instruction and proposed result.

### Three lanes, one admission contract

| Lane | Examples | Behavior |
| --- | --- | --- |
| Approved presentation/catalog edits | Change wall palette; place an approved lamp on a valid site | Preview and explicit apply; no invented mechanics; cheap deterministic checks |
| Layout and rule composition | Add a reading alcove; change a cabinet's opening condition | Geometry/access and puzzle analysis, protected-state checks, reviewed publication |
| New assets or mechanics | Model a new device; build a native moisture system | Background daemon sandbox, tests, staged preview and separately authorized release |

God routes the request; existing spirits keep their roles. Weaver develops the
place/opportunity, the relevant builder prepares it, Lawgiver can propose allowed
mechanisms, and Arbiter/Tinker evaluate consistency and failures. The narrator
does not acquire arbitrary build authority. No duplicate autonomous controller
or general free-form JavaScript execution is introduced.

The UX should expose **draft → checking → ready → applied → observed in use**,
alongside rejected/stale/failed states. A translucent preview is authoring-only;
NPCs must not perceive or collide with something that has not been committed.
Use the same typed request path for text first, then microphone input, then later
VR pointing. Do not tie the contract to a particular speech model.

Keep the world running while generation/validation happens off-thread. Reserve
or defer changes that would obstruct a resident or invalidate a current action.
Revalidate at apply; stale geometry is not overwritten from the authoring mirror.
No dependency download, purchase, model upload or arbitrary network destination
can be inferred from a casual in-world instruction.

Undo is a checked inverse/compensating edit, not restoring the whole world.
Recoloring a wall can be reversible; deleting a newly placed item after an NPC
has picked it up is not automatically safe. Preserve memories and events that
already occurred. Show what cannot be undone and why.

For now this is operator creation, explicitly recorded as such. It is not an NPC
building a house from earned wood. Resident construction needs separately modeled
resources, reservations, labor and interruption, even if both yield the same mesh.

## 7. Bounded implementation sequence

These are proposed checkpoints, not authorization to start them during this research.

| Checkpoint | Deliverable | Exit gate |
| --- | --- | --- |
| A. Shared contract | Coordinate Aureum package/API ownership; map one mechanism and its writer | Explicit authority/time/privacy mapping; no dual writer or vendored fork |
| B. Headless bridge | Two actors, one checked rule program, Argos-native admission/completion | The offline failure/contention/replay/privacy gates above |
| C. Presentation bindings | State-driven lamp/drawer in current assets, text/3D parity | Duplicate/reconnect/animation cannot cause effects; timings match native state |
| D. Art qualification | Approved sample kit, one street/room and character | Eye-level visual review, physical navigation/contact and measured target-device budgets |
| E. Desktop first person + typed builder | Separate embodied/observer roles; select target/site, propose approved catalog change, preview/apply/checked undo | Native movement/access and private knowledge preserved; stale/occupied/unauthorized edits rejected; NPC independently uses admitted addition |
| F. Voice + rule authoring | Push-to-talk over the same request contract; checked program successor | Misrecognition cannot silently mutate; progress/knowledge preserved; failed evidence retained |
| G. Growth and mystery | One new useful location/mechanism introduced by approved spirit workflow | Real discovery, native use and feedback—not merely attractive geometry or narrator claims |

Do A–C before a major migration. D can be prepared independently after the user
chooses assets. E begins with existing approved assets; it does not wait for an
unrestricted procedural art pipeline. Defer WebXR, full dynamic town construction
and long-world scaling until the small combined loop earns the next step.

## 8. Evidence and limits of this research

A tiny **in-memory smoke check of the installed Aureum runtime** passed in this
research: fixture logbook transfer updates holder/revision; repeating identical
inputs produces a deeply equal result; state/action/pack inputs remain unchanged;
a stale revision makes no changes; a second actor cannot take that already-held
object (`PRECONDITION_FAILED`, unchanged state). No files, providers, database or
live world were involved. This is not durable duplicate-request verification,
an Argos integration test, a puzzle-solvability proof or a new live run.

Reproduction basis: installed `KEEPER_ACTION_MATCHING_TRUTH.cases[0]` and its
pack; kernel revision 4; actor, second actor, location and logbook nodes; initial
logbook holder = location. Run `evaluateAureumAction` twice from identical original
inputs, then retry against revision 5, then use a second actor with expected
revision 5. Assertions cover one transfer, unchanged original inputs, deeply equal
first/repeat results, `STALE_REVISION`, and a rejected competing transfer whose
post-state hash equals the first result. Both research-agent and primary-agent
executions exited 0. The test was inline Node with installed packages, not a new
test file or package change.

The vendored distribution SHA-256 values were independently checked against its
provenance README:

- Protocol rc.11: `73aaf9747c0ada3e10b2e306fe7bd829ecc211d74adf26b270376353570d3165`.
- Runtime rc.9: `24506e3647cf72265036b513d0c8aae99e3e788e5a6e98183f78dffbdc80fafa`.

Existing Terminus documents report broader historical test evidence, including
the prepared-program/revision/analyzer checks. Those suites were **not rerun** in
this research, and their historical counts must not be presented as today's run.
Neither a source audit nor a render study closes Argos behavior/endurance gates.

### Source map for the next implementer

Terminus paths below are relative to the inspected Terminus root:

- `vendor/aureum/README.md`; `package.json`: provenance and pinned packages.
- `app/lib/aur/aur.ts`; `app/lib/game/world/README.md`;
  `app/lib/game/world/01-mundane/desk.aur`: readable authoring and ordering.
- `app/lib/game/aureumBaseWorldAuthority.ts`: per-player adventure projection;
  do not mistake this for the generic multi-actor package contract.
- `app/lib/worldBindings/aureumBindingProgram.ts:161`: state-supplied execution
  and the current scope-derived actor identity.
- `app/lib/worldBindings/aureumBindingAnalysis.ts:32`: bounded native graph checks.
- `app/lib/worldBindings/aureumBindingRevision.ts:20`: staged successor, source
  pins and protected-rule checks; no installation authority.
- `app/lib/worldBindings/projectionDriver.ts:19` and `:70`: no-action sink,
  revision validation and settle-versus-animate behavior.
- `app/lib/worldBindings/threeBindingAdapter.ts`: registered presentation targets.
- `app/lib/game/aureumBedroomProgramAdmission.ts`: checked bedroom-specific
  admission; reference pattern, not a shared-town implementation.
- `app/lib/server/bedroomObjectProgramService.ts:350` and `:501`: detached native
  rehearsal and separately checked canonical admission.
- `docs/AUREUM-BINDING-PROGRAMS.md`; `docs/AUREUM-WORLD-BINDINGS.md`;
  `docs/AUREUM-R11-DETERMINISTIC-RULE-SCHEDULER.md`: contracts and historical gates.
- `assets/bedroom/README.md`; `scripts/blender/bedroom_export.py`;
  `scripts/blender/verify_bedroom_articulation.py`: entity/part separation,
  export and measured motion checks.

Argos paths are relative to this `v2` root:

- `src/cognition/world-capabilities.ts:33`: existing package/actor capability seam.
- `src/demo/spatial-demo.ts:543`: native invalidation, timed completion and effects.
- `src/world/rules-engine.ts`; `src/world/effect-executor.ts`;
  `src/spirits/rule-admission.ts`: existing rule/affordance ownership to preserve.
- `src/runtime/committed-events.ts`: public executor evidence, separate from minds.
- `src/demo/spatial-catalog.ts`; `src/demo/spatial-contract.ts`: geometry/assets
  and current public/operator transport. New contracts must extend deliberately.
- `src/demo/spatial-town-growth.ts`: limited current furnishing sites/catalog.
- `src/engineering/world-materialization-adapter.ts`: source-fenced native
  construction seam, not approval authority.
- `src/demo/spatial-world-control.ts`: existing allowlisted house-spirit requests;
  not yet a general God builder.
- `src/engineering/release.ts`: bounded text-only coding releases.
- `src/demo/SPATIAL-RENDERING-AND-ASSET-PIPELINE.md`: existing asset-workshop design.
- `src/demo/TOWN-MILESTONE.md`, `TOWN-STORY.md`, `TOWN-WEATHER.md`: current limits,
  bounded results and preserved failures.

Next action if approved: implement **A–B only**, with the current art and no live
model run, and bring back the bridge's evidence before expanding its authority.
