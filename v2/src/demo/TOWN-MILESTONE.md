# A town that can become a world

Status: authored spatial foundation, not autonomous settlement construction.
The latest visual/layout revision is described under **Village presentation
pass** below; prior geometry and acceptance records remain as historical evidence.
The native cognition/controller/model configuration is unchanged. No H3, paid
asset purchase, farming/economy controller, or live endurance run is included.

## First slice

`npm run demo:spatial -- --town` opens manual/no-model physics testing.
`npm run demo:spatial -- --live --town` prepares the same world with native
cognition; it starts only after Start. Both use the existing 10–600 second
session bounds. Ten-person live model latency is not yet measured.

The authored seed contains four shared homes, Common Square, Corner Cafe,
Shared Workshop and Community Garden, and ten adult residents. The 32×18m
floor plan has fixed open passages, real walls/furniture, reachable interaction
anchors, finite pastries, seats and individual physical phones. No harvest,
cook, craft, pay or build operation is implied by an occupation or mesh.

The first layout was a contiguous block of rooms. User feedback requested an
actual outdoor town; the revision separates the four one-room houses and shared
buildings around a green commons, with native solid-trunk ornamental trees.
Landscape between floor parcels is scenery, not an implied navigable shortcut.
House interiors remain visible as cutaways. The larger shared outdoor floor is
the real walking connection; the visual grass does not itself grant movement.

Residents have different initial hunger/energy levels, authored formative
memories, housemates, personal aspirations and an opening intention. Existing
background cognition may form subsequent intentions; no itinerary or choice
is scripted. Meaningful quiet time is allowed. Rates remain +10 hunger/hour
and −5 energy/hour; deprivation is not accelerated to conceal weak agency.
Phone stimuli reveal neither sender nor message before a native read. Only
three authored remote relationships have special context; others do not
inherit Mara's friendship with Alex.

`spatial-scenario.ts` is the host-side package seam: a detached blueprint,
navigation bounds, resident identities/history/needs/appearance and a bounded
construction budget. It preflights all bindings before creating a simulation.
`spatial-town.ts` is data, not another controller. Other authored packages can
use `SpatialDemo.create({ world: definition })` without a new executor.

The renderer fits rooms from state rather than assuming the apartment's
dimensions, supports selecting/following any resident and retains operator
camera control during updates. Private operator panels remain separate from
the public physical scene. Construction is labelled gated, and the existing
operator-authored cafe button cannot substitute for town growth.

## Keep / reuse / defer

Keep ECS authority, owner-private memory, current goal/activity ownership,
timed native actions, source/identity cancellation, inventory/custody, real
outcome feedback and construction receipts. The renderer never creates success.

Reuse the existing Weaver → God → builder approvals and native materialization
checks when attaching spatial construction. Do not enable these in the town
before the spatial commit bridge passes. A semantic room alone is not a usable
3D place. New NPCs likewise require explicit capability/phone/body enrollment.

Do not activate the older generated resource/commerce/animal files wholesale:
the audited foraging uses grid positions and logs wood rather than conserving
inventory, consumption can fabricate purchases, and animals take random
per-tick grid steps. Generic worker/merchant behavior trees are not implemented
resource trades or recipes. These paths must be adapted and tested separately.

Defer arbitrary asset imports, two-sided lockable doors, actor/actor avoidance,
multi-floor routing, complete spatial save/resume and large unbounded maps.
Current food/seat contention still commits through native state; actors do not
yet avoid each other's bodies while walking. More assets improve presentation,
not simulation capabilities. The existing CC0 assets suffice for this gate.

## Next construction contract (not implemented by this slice)

One approved construction manifest must bind native types and exact identities
to geometry, collider footprints, interaction anchors, appearances, entrances
and connected navigation. The preflight must include **existing** obstacles,
not only the new parcel, with explicit land/grid/entity budgets and a current
source/demand. Register physical usability before publishing a new route.
Retain failed/partial construction receipts instead of pretending rollback or
refunding consumed authority. Independent NPC use is a separate usefulness gate.

Two different authorities must remain explicit:

- **Spirit growth:** a God-approved addition installs missing opportunity into
  the world. It is not work accomplished by an NPC or silently earned resources.
- **Resident construction:** an NPC-selected intention reserves real materials
  and a site, performs timed work, and yields a structure only after native
  completion. A cancelled/competing job cannot spend the same wood twice or
  finish merely because narration says a house appeared.

The smallest convincing later production chain is finite ingredients → timed
preparation → meal → consumption, then a material/work chain for one bench or
shelter. Plants require growth on simulation time, finite harvest, and water/
soil rules where actually installed. Animals can reuse deterministic skills
only after their needs, movement and effects use the same physical executor.
Commerce adds conserved ownership/payment, not dialogue that invents stock.

## Knowledge is not geometry — identified gap

The town currently supplies all geometrically reachable room names through
`spatial.movementTargets`. The motor computes paths using the full physical
map. This is destination knowledge supplied by the host, **not** proof of an
actor learning a mental map. In addition, `planningRoomTargets` in
`cognition/planning-system.ts` lists every Room when room-route topology is not
installed; filtering just the spatial menu would leave this second exposure.

Remote contents and private communications remain restricted. Observation is
room-level, not optical field-of-view/occlusion. Existing working memory keeps
owner-bound last-seen object locations/states and native outcomes. Social memory
retains personally heard, attributed dialogue. Narrative/episodic memory can
remember a place, but no durable learned town topology currently governs both
foreground and planning destinations. A bounded working-memory fact list is
not a permanent spatial atlas.

Next knowledge gate, before calling growth discovery realistic:

1. Explicit authored familiarity: home, personally familiar places and routes,
   rather than every place merely because the engine allocated it.
2. Actor-owned place knowledge with provenance: directly visited/seen versus
   named/recommended in dialogue. A report of stock is not fresh stock evidence.
3. One projection used by foreground menus, package context and background
   planning; physical reachability/execution remains independently validated.
4. Discover visible entrances/signs and newly built places through local
   perception. A distant new building must not silently appear in every mind.
5. Test newcomer versus long-term resident, hearing directions, an undiscovered
   addition, stale remembered stock, identity replacement and save/reload.

This is a knowledge/adapter handoff, not a replacement cognition controller.
No claim is made that the current town has passed this gate.

## Gates and evidence

This slice checks offline native mechanics, not autonomous behavior. Retain
every test failure and rerun outcome. No deterministic operator action counts
as evidence that a model chose it.

Next live gate: a bounded ten-resident observation measuring first decision
latency, foreground/background queue waits, native action receipts, useful
post-intention activity and unchanged private perception. Then one approved
spatial expansion, one independently chosen use, and feedback to its source
spirit. Only after that add resource-consuming construction.

The existing ten-trial baseline and at least 600 wall **and** 600 simulation
second endurance requirements remain open and unchanged. A large static town
or passing geometry tests do not meet them. The prior after-repair evidence in
`AFTER-REPAIR-PASS.md` and all failed behavioral evidence remain preserved.

Initial offline regression: 61/61 assertions across scenario, catalog and
existing spatial demo suites; typecheck passed. Evidence:
`/tmp/argos-town-first-regression-20260926.log`,
`/tmp/argos-town-typecheck-20260926.log`. Final combined results follow below.

### Final detached-town validation (2026-09-26)

- **295/295 tests, 16 suites**, including the new native town runtime tests,
  geometry/catalog/scenario preflight, spatial execution, existing Blackout,
  server authorization/private scene and cognition handoff regressions.
  `/tmp/argos-town-outdoor-final-regression-20260926.log`.
- **42/42 viewer tests**, including real Three.js camera/OrbitControls framing,
  optional needs display and outdoor/tree presentation.
  `/tmp/argos-spatial-town-outdoors-tests.log`.
- Browser bundle succeeds (`/tmp/argos-spatial-town-outdoors-build.log`);
  repository typecheck succeeds (`/tmp/argos-town-outdoor-typecheck-20260926.log`).
- Town-native runtime suite verifies ten simultaneous timed routes, private
  unread/read phone transport, three actual food consumptions followed by
  last-portion contention (one winner, one failure), needs/aspirations wiring,
  gated construction and source-stop cancellation. These are operator-driven,
  fetch-blocked mechanical checks, not model-generated decisions.
- Browser QA on a 720×1120 view: detached homes, outdoor commons, six trees,
  whole-town overview, resident selection and Noor's native 45 hunger/60 energy
  readouts verified. The first contiguous-layout preview clipped horizontally;
  the final rebuilt preview fits with actual zoom equal to fitted zoom (.288).
  Residual pan/orbit damping on reset was fixed and regression tested. The exact
  cause of untouched initial clipping in the earlier bundle remains unproven.
  An existing Three.js soft-shadow deprecation warning remains nonfatal.

Final layout: 8 places, 10 residents, 63 props and 30 walls: **111 authored
physical entities**. Preserve intermediate logs (the earlier 61/285 assertion
runs and 24/27 layout runs overlap final coverage; do not sum them).

Fresh preview: `http://127.0.0.1:53304/` using the private fragment link from
`/tmp/argos-town-outdoor-ui-20260926.log`; recordings directory
`recordings/spatial-vh9YAQ`. It was left **ready, world time zero**, with no live
cognition trial started. Only this pass's unused first preview on port52613 was
stopped and saved for the rebuild; other user sessions were preserved. No
autonomous construction, farming, learned mental-map or endurance gate passed.

## Village presentation pass (2026-09-26)

User feedback: even the detached layout remained a set of boxes with too little
outdoor space. This pass changes the authored geography and presentation, not
cognition, models, growth authority, or the simulation clock.

- New 48×36m world envelope, four spaced cottages, detached café/workshop,
  a large outdoor common and community garden. Native destinations, walls,
  trees, seats and finite food remain physical ECS entities.
- The town explicitly selects a .5m navigation grid (7,081 possible cells).
  The 10,000-cell bound stays intact. Existing apartment/Blackout packages keep
  their .25m grid. Movement stays at 1.25m/s on committed simulation time.
  The selected coarse grid is checked with the actual continuous collision
  geometry before ECS allocation, not only the catalog's .25m flood fill.
- Building metadata selects a roof/façade style and colors over a real indoor
  footprint. Its front must have an actual native entrance. Roofs, windows,
  trim and ground textures are presentation, not new interaction authority.
- Exterior overview shows recognizable buildings; follow/interior controls
  reveal rooms for observation without changing the world's state.
- Sidewalk/lawn presentation marks outdoor space without conferring new
  navigation outside registered floor parcels. Parks use real outdoor floors;
  peripheral terrain is scenery. No phantom water, harvest, roads with traffic,
  commerce or construction service is implied by decoration.

The actor-specific place-knowledge gap above remains open. Improved scenery
must not be represented as a cognition or autonomous-growth acceptance gate.
Evidence for the previous contiguous and detached previews is preserved.

Expanded physical layout: **137 authored physical entities** (8 places,
89 props, 30 walls, 10 residents). Registered outdoor floor is **77.4%** of
the walkable parcel area, including 26 actual solid-trunk trees. Exterior
presentation does not turn the green gaps between houses into extra paths.

Verification for this presentation pass (no model calls):

- **294/294 across 15 engine suites**: `/tmp/argos-village-regression-first.log`.
  Includes scenario preflight, catalog, spatial engine, server authority,
  Blackout/after-repair, standing motivation and persistence regressions.
- **7/7 expanded native runtime tests**:
  `/tmp/argos-spatial-town-expanded-first-2026-09-26.log`. Native routes cross
  the actual Willow House and café entrances via the outdoor common, return
  home, and move no faster than .125m per 100ms tick. Ten concurrent arrivals,
  finite pastry contention, private phone contents and stop cancellation pass.
  Test-driver journey budgets were lengthened for the physically larger map;
  no live cognition or endurance acceptance threshold was changed.
- **28/28 focused catalog/path tests**: `/tmp/argos-park-town-first.log`
  (overlaps the 294-test suite; do not sum it again).
- **23/23 scenario preflight tests**: `/tmp/argos-town-grid-proof-first.log`
  (also overlapping). A narrow passage reachable at .25m but not .5m is rejected
  before world allocation when the coarse motor resolution is selected.
- TypeScript check passed: `/tmp/argos-village-typecheck-final.log`.

These are deterministic/mechanical checks, not a ten-resident autonomous life
trial. The ten-trial baseline and ten-minute endurance gates remain open.

Existing unrelated diagnostic limitation observed in the expanded runtime log:
the builtin `NarrativeEvents` system can emit a stock candle-flicker line with
no candle in the town. It is registered independently of the AI narrative-engine
flag (`src/index.ts`, `src/systems/builtin-systems.ts`). This `narrative_event` is not
an ECS construction or a committed physical action; the live world-event bridge
does not admit that event type as NPC perception. It remains ungrounded narration
to audit separately, not evidence of a newly simulated object or a passed
narrator-usefulness gate. No additional controller or behavior change was made.

Final presentation checks:

- **51/51 viewer tests**, browser bundle passed:
  `/tmp/argos-town-art-direction-final-tests.log`,
  `/tmp/argos-town-art-direction-final-build.log`.
- Rebuilt browser verified solid cottage roofs, windows/shutters/chimneys,
  distinct café/workshop, continuous landscape, park paths and native trees.
  Following Mara reveals only her house and cuts away the near walls; global
  Interiors reveals all buildings. Click-to-pin and animated roof fades are
  suggestions only, not implemented. Indoor prop labels no longer leak through
  roofs; outdoor-to-outdoor permanent passages have no freestanding frame.
- Desktop and narrow/mobile layout checks completed. The mobile drawer had
  created horizontal overflow; binding it to the app's positioned overflow
  boundary fixed it (487px viewport /487px scroll width). Drawer opens/closes,
  all camera controls remain available; temporary viewport override reset.
- Final preview console has no warnings/errors. Native physics did not start.
  The initial preview's 860 draw calls/68,944 triangles included shadow passes;
  static decorative geometry is merged by material. This is not a FPS benchmark.

Final preview: `http://127.0.0.1:54878/` with private fragment link in
`/tmp/argos-village-final-preview-20260926.log`; recordings directory
`recordings/spatial-SXVmQg`. Left **ready at 0 seconds**, exterior overview.
Only this pass's unused interim preview on54528 was stopped/saved for rebuilding
(`recordings/spatial-8PVdIL/session.json`, `world.json`); older sessions preserved.
No recording, paid generation, new live AI trial, or autonomous growth was run.

## Burst-walking repair (2026-09-26)

The user-started live town above subsequently exposed a performance gap:
**326 ticks /32.6 simulated seconds in192.7 wall seconds**, with113 slow ticks.
The correctness gates had verified physical movement, not ten-character live
prompt-preparation cost. Preserve that evidence in
`/tmp/argos-village-final-preview-20260926.log` and its saved world/session.

Diagnosis: the same foreground projections repeatedly called `movementTargets`,
each of which rebuilt geometry and computed full paths to every room. The
isolated no-network baseline took904.947ms for combined decision projections,
876.150ms in seven repeated route-menu reads. Evidence:
`/tmp/argos-spatial-context-bench-20260926-02.log` (the earlier01 log preserves
a harness startup failure, not a world outcome). Async model tasks and physics
share the JavaScript thread; synchronous request preparation blocked both.
Separately, the viewer used simulation deltas as interpolation durations despite
250ms-plus-response-time polling. Alternating200/300ms deltas repeatedly ended
walking early, reset its animation cycle, and duplicate refreshes snapped it.

Repair scope:

- Immutable geometry snapshots and a bounded lattice cache retain continuous
  collision results. Exact four-neighbor BFS order/path behavior remains.
  Continuous endpoint connectors and native movement segments stay checked.
- Adapter geometry fingerprints include live room identity/bounds/entries and
  obstacle identity/position/dimensions. Raw ECS changes invalidate derived
  data; cached menus still validate actor/source/room/exact position and seat
  permissions. Nine geometry snapshots and128 actor menus maximum; stop/dispose
  clears them. Execution still performs fresh target/identity/collision checks.
- Viewer smoothing follows received snapshots with a small bounded delay
  (typically300ms, maximum550ms), never extrapolates planned movement, leaves
  duplicates alone, and preserves walking clip phase. Source changes, stops,
  removals and reduced motion settle explicitly. No animation gains ECS authority.
- New ten-character timing gate exercises actual foreground projections while
  native bodies move and an existing tree's ECS position changes halfway.

Evidence retained so far:41/41 spatial-world safety tests,
`/tmp/argos-nav-cache-first-tests.log`;27 path-cache +28 town tests,
`/tmp/argos-spatial-path-cache-green.log`;59/59 viewer tests and bundle pass,
`/tmp/argos-view-motion-final-20260926.log`,
`/tmp/argos-view-motion-bundle-20260926.log`.
Path-cache red/intermediate logs remain; a collision-count assertion was corrected
to match19 mandatory uncached connector checks (177→19, not an assumed10×).

The first continuous timing gate **failed inside Jest's VM**:5.5 simulated
seconds in16.194 wall seconds, projectionp95 427ms. Preserve
`/tmp/argos-spatial-town-performance-20260926-01.log`.
The unchanged production-runtime benchmark after the repair measured22.144ms
combined projections (seven route reads0.844ms), zero fetch/source change:
`/tmp/argos-spatial-context-bench-20260926-postfix-01.log`.
The continuous timing workload therefore runs in an isolated production Node/tsx
child; its workload and acceptance thresholds are unchanged, not loosened to
accommodate VM overhead. Final timing/live evidence is recorded below when run.

The native moving-world gate **also failed**, so VM overhead was not the full
explanation:8 simulated seconds in11.852 wall seconds (0.675×), projectionp95
168ms and one1492ms tick. Preserve
`/tmp/argos-spatial-town-performance-20260926-02-native.log` and the phase report
`/tmp/argos-spatial-town-performance-20260926-03-phases.log`.
Phase attribution found warm route lookupp95 only11ms; local perception/menu
enumeration was now dominant. System attribution in
`/tmp/argos-spatial-town-performance-20260926-04-systems.log` traced the1.5s
native spike specifically to `DayPlanPreplanner` searching room affordances.

Additional read-path repairs, without disabling schedules or changing cadence:

- Spatial package context enumerates visible entities once per synchronous
  catalogue construction, not once again for each prop. Remote targets are
  rejected before constructing the local scene. Execution still revalidates.
- Ordinary spatial worlds no longer register an empty observable-instrument
  hook. The real Blackout instrument hook and its post-hook mutation/privacy
  fences remain installed. Native public object-state perception is unchanged.
- Generic affordance admission resolves actor/tool traits only when the target
  qualifies and the affordance actually requires them. No inventory cache;
  pickup/drop, state changes and removed tools remain fresh at admission.

The performance gate remains separate from autonomous behavioral acceptance.
The ten-trial baseline and ten-minute endurance requirements are still **open**;
none of these short checks substitutes for them.

Final read-path repair adds canonical `isAgentVisualEntity`: a fresh bounded
containment-membership check instead of enumerating a crowded room per target.
It matches native graph visibility, including depth, sensory limits, hidden
ancestors and foreign inventories. Custom visibility hooks fall back to the full
reader with its mutation fences; there is no cross-call visibility cache.

Retained intermediate result
`/tmp/argos-spatial-town-performance-20260926-05-localreads.log`:0.914× real-time,
but projectionp95 74ms still failed the unchanged60ms gate. After membership
optimization the native gate passed:8 simulated seconds in8.472 wall seconds,
projectionp95 39.794ms, tick-gapp95 103.814ms, maximum277.715ms. Geometry edited
midway, all ten bodies moved at unchanged1.25m/s, no model calls, no source change.
Evidence: `/tmp/argos-spatial-town-performance-20260926-06-membership.log`.
The isolated Jest wrapper repeated the pass at0.921×, projectionp95 46.381ms:
`/tmp/argos-town-motion-gate-final-20260926.log`.

Regression results:

- 555/555 engine tests across 27 suites: navigation, physical actions, spatial
  demo/server/scenarios, goal/motivation, perception/freshness, schedules and
  affordance safety (`/tmp/argos-motion-regressions-20260926.log`).
- 46/46 native sight/privacy tests across 3 suites, including 8 differential
  membership tests (`/tmp/argos-direct-visual-final-20260926.log`). The initial
  red result remains in `argos-direct-visual-first-20260926.log`: five legacy
  purity assertions assumed agents had no identity at creation, although native
  aspiration authoring assigns one. They now assert unchanged before/after
  identity presence **and key**; hidden props still cannot gain identities.
- 59/59 viewer tests (`/tmp/argos-town-motion-view-final-20260926.log`), including
  duplicate snapshots, jitter, unchanged-speed endpoint interpolation, gait
  phase, source replacement, stop/removal and reduced motion. Browser bundle
  built successfully at server startup; typecheck passed
  (`/tmp/argos-motion-typecheck-20260926-final.log`).

One bounded live ten-NPC check, with browser polling/rendering and real model
calls, completed and saved automatically after30 wall seconds:

- 288 ticks /28.8 simulated seconds; measured 30.166 wall seconds (0.955×).
- All 10 residents walked; 116 observations, zero stagnant polls; response p95
  29.243ms, maximum237.768ms. Browser error log empty. Follow view observed Mara
  walking outside Willow House into the square and settling when stopped.
- Mean native tick 9.03ms; 2 slow ticks remain (first 328ms). This is not an exact
  1.000× or zero-jitter claim, nor a long-run/behavioral acceptance pass.
- Two background plan requests timed out; one proposed pickup plan failed native
  accessibility validation. Shutdown cancelled pending plans/actions normally.
  These failures are retained, not counted as completed plans. Only2 residents
  articulated a thought during this short trial; all10 moved. No forced movement
  or operator messages were injected in the live check.

Live evidence: `/tmp/argos-town-motion-live-20260926.log`,
`/tmp/argos-town-motion-live-result-20260926.log`,
`/tmp/argos-town-motion-live-samples-20260926.json`,
`recordings/spatial-i5sc4A/session.json`, `recordings/spatial-i5sc4A/world.json`.
Next acceptance work remains a longer bounded cognition/clock observation,
especially background plan latency. Do not claim growth, behavioral-baseline or
endurance gates from this movement repair. No model, H3, speed, authority or
autonomous-growth settings changed.

Fresh user preview: `http://127.0.0.1:62451/`, private fragment link in
`/tmp/argos-town-motion-ready-20260926.log`, source directory
`recordings/spatial-J5GmEp`. Rebuilt browser bundle and verified **ready at 0s**,
ten residents, normal exterior overview; Start was left for the user. The saved
30s trial server on 62256 was gracefully closed; older user servers and every
recording were preserved. Independent final privacy/authority review found no
actionable new issue in the membership helper or synchronous context reuse.
