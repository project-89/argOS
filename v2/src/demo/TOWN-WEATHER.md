# Embodied weather — bounded pass, 2026-09-26

## Scope and authority

The existing town retains its native weather, branch incidents, ten residents,
foreground/background cognition and bounded spirit hierarchy. This pass adds
visible atmosphere, branch motion, local rain sensation and one explicitly
operator-approved generated physical mechanic. It does not activate the whole
engineering hierarchy, change models/controllers, or claim autonomous growth.

`--town --evolving --story --weather-mechanic --live` exposes the opt-in profile.
The preview does not enqueue a new build until Start. `ARGOS_WEATHER_RELEASE_DIRECTORY`
may select a previously accepted release store; every release is revalidated
under the current host policy before restoration. Otherwise the new session gets
its own release directory. Default town profiles still have coding disabled.

The one coding-daemon job must produce `SpatialRainWetness` and exactly one
`SpatialWetness.value` scalar component. Host-owned `SpatialRainExposure` marks
existing residents and furniture with identity/source-bound eligibility and
public rain/drying rates. Generated code may read those inputs and its own
output, but may not write weather, movement, identity, cognition, inventory,
exposure, or another component. It cannot create entities or emit narrative
events. Exact release validation applies after tests, on admission and on reload.
Host inputs register before accepted-release restoration and refresh before
tick-boundary worker-result freshness validation.

An accepted worker implements wetting/drying from simulation time. The host does
not supply a substitute implementation if generation fails. Eleven independent
host acceptance tests accompany worker-authored tests. One admission slot and a
120-second build timeout apply; failure is retained, not automatically retried.

## Physical feedback and rendering

- Native rain supplies local visual, auditory, tactile and olfactory evidence,
  subject to existing sensory capabilities. Rain touches skin/clothing and has
  a damp earthy smell in these authored outdoor areas. It does not dictate fear,
  discomfort, goals, or shelter-seeking.
- Admitted wetness makes existing surfaces/clothes visibly damp or wet. The
  actor can feel their own wet clothes; other entities require actual local
  visibility. Public observable state also exposes dry/damp/wet for normal
  perception and memory, not precise omniscient moisture readings.
- Threshold transitions publish source-bound native environmental receipts.
  The Narrator retains its independent acknowledgement cursor. Weaver receives
  a detached, bounded, expiring environmental history without consuming it or
  gaining execution authority. Its future mechanic ideas remain review-only;
  evidence of a historical effect is not permission to build anything.
- The viewer adds sun/cloud backdrop, outdoor rain and weather lighting. The
  sun is atmospheric presentation, **not** a day/night or astronomy simulation.
  Rain excludes indoor footprints even with roofs cut away. Animation advances
  only toward confirmed simulation timestamps and settles on stop.
- A newly witnessed native branch break animates a small limb slumping against
  the standing tree plus canopy recoil. It does not invent a fallen tree or
  blocked path. Joining an already damaged world shows final damage, not replay.

## Limits that remain open

Plants in this town are ornamental. Soil, water use, plant growth, crop harvest,
heat/cold, wind damage, illness and new object types are not implemented here.
Additional mechanics require their own grounded proposal, authority and tests.

The generic managed-worker scheduler rejects stale results, but after a delayed
input transition its next result applies current rates to accumulated elapsed
time. Exact piecewise exposure history across delayed weather/shelter changes
is not proven by this pass. Fixed-input rate integration and stale-overwrite
protection are tested; these are different guarantees.

The real-build check uses manual native weather/movement to isolate generated
physics. It is **not** evidence of an autonomous NPC choosing shelter or Weaver
independently designing and installing its successor. No new end-to-end live
NPC/spirit test or H3 run is included. Earlier failed story-loop evidence stays
in `TOWN-STORY.md`; ten-trial baseline, ten-minute wall AND simulation endurance,
and strict construction-latency gates remain open.

## Verification

### Offline and visual checks

- Final integrated regression: **293/293 tests, 12 suites**.
  `/tmp/argos-weather-regressions-20260926-04.log`.
- Scoped coding lifecycle/admission regressions: **93/93**.
  `/tmp/argos-weather-release-policy-tests-20260926-05.log`.
- Viewer: **85/85**, `/tmp/argos-weather-viewer-final-20260926.log`.
  Final typecheck clean: `/tmp/argos-weather-types-final-20260926.log`.
- Dedicated restore tests use an explicitly human-authored fixture, not evidence
  of live generation. They cover native schema registration before restoration,
  real worker ticks, local observable state, source isolation, scene privacy and
  stopped values. Restored wetness establishes a baseline rather than inventing
  a new dry-to-wet incident.
- Manual browser QA confirmed visible clear sky, sun/clouds, falling rain,
  cutaway indoor masking and persistent damaged-tree pose/caption. Screenshot
  latency missed the brief branch transition; that animation is offline-tested.
  Native rain/cloud motion stops on Stop. Existing character idle rigs still
  animate after Stop; this separate renderer issue is not claimed fixed.
  Evidence: `/tmp/argos-weather-qa.4nHBYj/QA.md`, `session.json`, `world.json`.

Earlier failed evidence remains: initial regression invocation lacked the
repository's required ESM runner; the first valid regression caught an empty
observable-state hook installed in ordinary worlds. The hook is now opt-in
only. Restore-fixture failures exposed the real missing-schema lifecycle gap;
later fixture-only assertion errors are retained in their original logs.

### One real generated mechanic

`recordings/weather-mechanic-check-UZobAp/result.json` records **all 12 declared
checks passing**, one configured Codex-builder job, no NPC/spirit inference and
no H3. Its accepted release passed **33 tests**, including 11 independent host
acceptance tests. Worker completion and successful admission are preserved in
the job diagnostics and `build-events.jsonl`; the original store is untouched.

The check lasted 127.752 wall seconds and advanced 221.9 simulation seconds.
The build activated at simulation 113.6s. Post-build phases explicitly wait for
workers as a diagnostic barrier; these figures are **not a realtime benchmark**.

- After native rain: Eli and Square seat 1 reached wetness 0.50; the indoor
  Workshop worktable stayed at 0. Eli's local body evidence included wet clothes.
- After an evaluator-directed, native completed walk to shelter: Eli's value
  dropped from about 0.689 to 0.539, while the outdoor seat reached 1.0 and the
  indoor control remained 0. No claim of autonomous shelter-seeking.
- After native clear weather: the seat dried to about 0.399; Eli to 0.196.
  Native threshold receipts were recorded and confirmed values survived Stop.
- The fresh live-ready town restored a **copy** of that accepted release under
  the same policy. No second generation and no automatic simulation start.
  Runtime artifacts: `recordings/spatial-AvQ4Wd`; server log:
  `/tmp/argos-weather-town-ready-20260926-01.log`.

The next behavioral gate is a short autonomous run demonstrating inhabitants
using these sensations and subsequent real spirit reviews reacting to the
effects. This check does not close that gate or the earlier story-loop failure.

## Follow-up — world-space atmosphere, 2026-09-26

The initial screen-space backdrop above is superseded by a main-scene sky dome,
lit, instanced 3D cloud clusters and a compact stylized solar marker. The sun
shares the directional light's world direction; this remains art direction,
not new astronomy. Clouds occupy space above town, rather than tracking the
viewport. Town framing excludes atmospheric geometry. Inspection fades clouds
without moving them or changing native weather. Rain retains native outdoor
masking and the committed-time clock. No new ECS entities, physics, cognition
mechanisms, spirit powers or asset permissions were added.

- Viewer regression: **89/89**, including source replacement, invalid/future
  weather, cloud depth, camera independence, focus fading, indoor rain masking,
  reduced motion, stalled-time freezing and geometry/material/instance cleanup.
  `/tmp/argos-atmosphere-viewer-20260926-final.log`.
- Server/native-weather/restore regression: **32/32, 3 suites**.
  `/tmp/argos-atmosphere-regressions-20260926.log`.
- Typecheck clean: `/tmp/argos-atmosphere-types-20260926.log`.
- Isolated no-provider browser check: clear/rain, town orbit and Interiors
  confirmed world-space placement and inspection fading. The first palette
  washed out UI/clouds; it was revised rather than accepted. Both QA sessions
  and native snapshots remain in `/tmp/argos-atmosphere-qa.MSwixk` and
  `/tmp/argos-atmosphere-qa2.7Rhcjf`. This is rendering QA, not behavioral evidence.
- Final live-ready renderer also checked with the compact round sun above the
  town. It restored a copy of the earlier accepted wetness release, with zero
  additional builds and no automatic start. Artifacts: `recordings/spatial-ezhJW9`;
  server log `/tmp/argos-atmosphere-town-ready-20260926-02.log`. The old user's
  server was left untouched; only this pass's own QA/preview servers were stopped.

The future Blender shadow-scene, licensed pack import and versioned asset
publication boundaries are documented in `SPATIAL-RENDERING-AND-ASSET-PIPELINE.md`.
They are designs, not newly enabled daemon capabilities. Existing failed
autonomous-story evidence and baseline/endurance gates remain unchanged.
