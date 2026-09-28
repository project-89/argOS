# Spatial viewer boundary

## Experience: Watch · Inhabit · Analysis

Built against `../INHABIT-CONTRACT.md`. The mode switcher (top centre, keys
`1`/`2`/`3`) is always visible. Transitions are pure (`modes.mjs`); the
snapshot stays authoritative for control (`control`) and pause (`paused`).

- **Watch**: the god's-eye diorama, story feed, weather chip and resident roster.
  Each resident offers **Take control** (`POST /api/control/take`) and
  **Interview**. **Enter as a visitor** calls `POST /api/control/visitor`; a
  world that hasn't begun is started first. Operator tools (phone, planted
  thoughts, house spirit, build requests, diagnostics) sit in one drawer.
- **Inhabit** (`inhabit-view.mjs`): a perspective camera over the right
  shoulder (C toggles first person) with wall collision, drag or pointer-lock
  look, WASD/arrows → `walk {dx,dy}` relative to the camera heading (≤6 Hz while
  held, never two in flight, nothing at rest), E → the nearest `control.nearby`
  thing (several verbs open a 1–4 chooser; "Talk" opens the talk box), Enter →
  `say` to the nearest resident or the room, hold V → push-to-talk. Subtitles
  show only `control.heard` (excerpts grow in place; the completed turn replaces
  them and is the only one voiced). Room labels, overhead speech and goals are
  hidden: the body knows what it perceives. O shows the operator-only "nearby
  minds" panel. P pauses; Release lets go.
- **Analysis** (`analysis-view.mjs`): entering pauses a running world (and
  resumes on exit only if Analysis paused it; also on tab close). The town is
  shown as a desaturated model on a white lab field without sky, haze or sea.
  Left: God console (`/api/god/ask`, receipts as chips, God's voice). Right: the
  interview chair (`/api/interview`) with a still portrait rendered from the
  resident's own model, **In character / Analysis** register, **Let them
  remember** (in character only) and per-register sessions. Click a resident in
  the scene to seat them.

Keyboard: `1` Watch · `2` Inhabit (opens the body chooser without a body) ·
`3` Analysis · `Esc` closes the innermost thing (talk box, verb chooser, chooser
sheet), then steps out of Inhabit, or resumes out of Analysis · `W A S D`/arrows
walk · drag look · `E` interact (`1`–`4` while the chooser is open) · `Enter`
talk · hold `V` speak (Inhabit → say, Analysis → last-used panel) · `C` camera
view · `O` nearby minds · `P` pause/resume · `M` mute voices.

Voice (`voice-client.mjs`): `/api/voice/cast` `enabled` shows or hides voice UI.
Lines are synthesized only when they will play (heard lines in Inhabit, God,
interview replies), one at a time with the next prefetched, capped per minute,
stale lines dropped; 429 backs off for `retryAfterSeconds`, 503/404 hide voice.
Playback uses Web Audio `decodeAudioData` (the page CSP has no blob media
source). Push-to-talk records 16 kHz 16-bit WAV through the Web Audio graph,
falling back to MediaRecorder webm/opus.

Device independence: `createBodyControls` (`inhabit-controls.mjs`) is the only
path to the body: `walk(dx, dy)`, `interact(verb, targetKey)`, `say(text,
targetKey)`. `xr-entry.mjs` feature-detects `immersive-vr` for the **Enter VR**
button and documents the WebXR follow-up (`TODO(webxr)`); it is not implemented.

QA: `?mode=analysis&interview=Leon` opens a mode and seats a resident on load.
Checks: `node --test` in this directory (modes, inhabit controls/camera,
subtitles, voice queue/capture, analysis state, plus the renderer suites).

## Renderer boundary


This is a Three.js **view of Argos**, not another game simulation. The server supplies authored geometry, authoritative entity positions, and native activity state through `SpatialViewState`.

- The client interpolates only between observed positions, clamps at the newest observed point, and never dispatches an action from an animation completion callback.
- Native `sitting` / `seated` state selects the seated clip. Actual observed displacement selects walking. A pending movement request alone does not make a character walk or arrive.
- A confirmed held phone gets a presentation-only mesh offset to the loaded character's animated right arm, with an approximate right-hand fallback during loading. Source positions and ownership remain unchanged; pending pickups do not attach it, and drops remove the offset. This is illustrative attachment, not grasp physics or inverse kinematics.
- A removed entity disappears. A newly built entity appears only once present in the server snapshot. Mesh loading has a procedural fallback and never stalls the world.
- Speech bubbles and comic action/sound captions use explicit source cues, never guessed action names from an admission. Identical polls cannot renew their lifetime. Stop, source change, missing entities, source expiry, and bounded wall expiry clear them. Only one current bubble per entity/kind is shown. Sound captions name their physical source.
- Current ongoing activity or leading goal appears for the selected actor, from the private operator DTO. It does not select an action or grant execution authority. No completed goal is presented as active.
- Private current thoughts and phone records are displayed only in the operator panel. They are not used as input to a rendering model or sent to an external service. All runtime assets are local.
- Message, planted-thought, explicit operator-action, start, terminal stop, and authored expansion controls use separate authenticated API routes. Manual mode is visibly labeled; no autonomous behavior is invented in the client.
- Speech audio comes only from the voice endpoints above. There is no custom mesh authoring, inverse kinematics, or browser-owned movement collision (the Inhabit camera's wall collision is presentation only). Model animations illustrate native activity; they do not grant physical effects.

Serve `index.html`, bundle `client.mjs` as `/client.js`, serve `styles.css` and this directory's `assets/` as `/assets/`. Supply the operator bearer token in the URL fragment, which is not sent with static requests. The client uses it only in API authorization headers.

Offline checks: `node --test src/demo/spatial-client/view-model.test.mjs`. Asset licenses, official sources and content hashes live in `assets/`.

The optional `blackout` scenario projects only public `title`, `phase`, completion,
and power status. Apartment surfaces dim when `scenario.power` is `off`; native
`on` restores their original materials and a warm lamp light. Other rooms keep
their original lighting. Procedural panel, supply-box, and cartridge visuals
carry only their supplied entity names/ObjectState labels, never puzzle answers.
None of these presentation changes modify ECS components or grant a repair.
The authored café button is hidden and disabled for Blackout; the backend's
growth summary stays visible. Manual panel operations use the existing explicit
`Interact` target/operation control and still require native admission/completion.
Scenario checks: `node --test src/demo/spatial-client/scenario-view.test.mjs`.

Town viewing uses the same transport: `rooms[].bounds` drives initial and explicit
Overview framing, including portrait viewports and worlds away from the origin.
Ordinary state updates and newly built rooms do not reset a user-controlled camera;
Overview includes the latest extents. Resizing refits only an untouched overview.
Room geometry is rebuilt on a bounds/material revision or source replacement.
Following can select any resident; offscreen speech is not clamped onto that
resident's close-up. The scrollable roster has no two-character assumption.

Neutral `actor-a`, `actor-b`, and `actor-f` aliases reuse the three checked-in CC0
character assets. Actor colors tint the torso only, never the face. These are
catalog appearances, not newly generated character models.

`scenario.id === 'town'` labels the authored town and displays the supplied growth
summary. Scenario worlds do not expose the old authored café button. The client
does not claim or enable autonomous construction; spatial growth remains gated by
the server. `canText: false` disables messaging without disabling thought planting.
All client checks: `node --test src/demo/spatial-client/*.test.mjs`.

Town rooms may explicitly declare `environment: 'outdoor'`: their bounded floor
becomes lawn/paving rather than floorboards. Decorative paths stay inside that
room's footprint and create no walkability across gaps. `tree` uses a low-poly
trunk/canopy inside its catalog envelope; the native narrower trunk collider is
unaffected. Building metadata now supplies cottages, café/workshop shopfronts,
pitched roofs, chimneys, window trim and porch awnings. Entrances resolve to native
door/passage positions and never acquire an invented closed door slab.

Overview also includes confirmed mesh envelopes beyond room edges and clears
residual OrbitControls damping before resetting. Tests exercise the actual Three
camera/control matrices at a 719×1120 viewport. Read-only camera telemetry is on
`#canvas-host`'s `data-camera-diagnostics` attribute (viewport/backing dimensions,
frustum, fitted/current zoom, and view mode) for visual QA.

`town-architecture.mjs` owns presentation-only architecture and park detailing.
One continuous lawn joins the visible lots; paving and flowers stay inside
outdoor room footprints. Lawn between registered rooms is decorative land, not
new navigation authority. Windows, porches, roofs and signs likewise create no
affordances/colliders. Native trees remain ECS entities. Static trim/flowers are
batched by material per independently revealable building section.

Town overview shows roofs and hides indoor floating labels/public speech that
would otherwise appear through them. Follow reveals the selected resident's
current building; the explicit Interiors button reveals all interiors. The
operator sidebar can still select any resident and inspect their permitted
private state. Outside speech is not moved into someone else's close-up.

The separate **Ask the house spirit** form submits bounded operator requests to
`/api/world-command`; it does not use NPC messaging, planted thoughts, or the
authored café route. Example chips fill a draft and never submit automatically.
Server availability plus local/server pending state govern the controls. Only
validated `applied`, `unchanged`, or `rejected` receipts are shown as confirmed;
network/invalid-response outcomes remain explicitly unconfirmed. Old-source
responses are ignored. No receipt changes scene state; the next snapshot does.
The `passage` asset is a permanent open decorative frame, not a door/collider.
Checks: `node --test src/demo/spatial-client/world-control-view.test.mjs`.

The separate **Ask God** development panel is hidden unless the host supplies
`development.enabled: true`. It shows only reported capabilities, session request
and build-job limits, operator/God messages, and build-job statuses. NPC phone
messages and planted thoughts remain separate controls. All displayed content
uses literal `textContent`, not HTML. The panel does not infer new capabilities
from a model response or call any build/action API itself.

`POST /api/god-command` sends `{text, requestId}` with a browser-generated UUID;
the bounded text is at most 2000 characters. Its acknowledgement contains the
current `sourceId`, matching `requestId`, a request-processing status, and
`atSimMs`. A successful HTTP response confirms only that status, never an applied
world effect. Snapshot operator messages use the request ID as their own ID and
report subsequent queued/working/completed/failed/cancelled transitions. A local
pending request survives lagging polls; late responses cannot overwrite a new
source or a newer request. Uncertain delivery retains the original draft and
retries the exact same UUID/text only on another explicit click. Busy controls
never submit or discard a draft automatically. An acknowledged draft clears
once, without erasing a newly composed next request; switching sources clears
the old source's draft and local receipt. Completed replies, reported build jobs,
and native effects are explicitly distinct. Checks:
`node --test src/demo/spatial-client/development-control-view.test.mjs`.

An optional **Generated details** inspector appears only when visible entities
have host-published `details` scalars. It lists at most 24 entities with 24 fields
each, accepts only finite numbers within ±1,000,000 or booleans, and renders names
and values as literal text. This reads neither NPC thoughts nor arbitrary ECS
fields. Names such as `Growth.height` do not change geometry, imply units, animate
a plant, or grant an action. Missing/replaced entities and source changes clear
the old values. The current viewer selects actors, so this separate entity list
makes generated prop measurements visible without changing camera picking.

Native weather is presented in the same 3D scene/camera as the town: lit cloud
forms above native room footprints, atmospheric sky, falling rain and
weather-dependent illumination. The sun's direction agrees with the key light.
This replaces the first pass's separate screen-positioned sky backdrop. These
are presentation meshes, not new ECS entities or a claim that a day/night,
astronomy or wind simulation exists. Cloud extents never enlarge the town's
overview fit. Inspection can fade clouds obstructing a followed character or
revealed interiors. Rain remains depth-tested against world geometry and
excludes indoor room footprints even when roofs are cut away. Clouds/rain
interpolate toward observed simulation timestamps only: stalled polling or a
stopped simulation cannot keep weather advancing indefinitely. Reduced-motion
mode keeps a sparse static rain reading. No extra assets or external requests.

The exact public `scenario: { id: 'town', theme: 'lovecraft' }` selects Saltmere's
coastal mystery presentation. `theme-view.mjs` projects a muted dusk palette;
`theme-scene.mjs` adds gentle visual haze, static decorative water beyond every
registered floor, and at most twelve soft indoor fill lights. Warm windows and
fill are set dressing, not claims about native lamps, electricity, or occupancy.
The water has no entity, collider, destination, action, or navigation authority;
it and the atmospheric haze never enlarge overview framing. No private thought,
story prose, room name, or uncommitted event selects the theme. Normal town and
Blackout retain their existing palettes. A source/theme change restores ordinary
lighting and removes the coastal backdrop. This is art direction, not a new
day/night or fog simulation: cloud counts, rain sites, solar direction, and wet
surfaces still depend only on their existing committed snapshot fields. Roof
cutaways, camera controls, speech, thoughts, and phone behavior are unchanged.
Checks include exact-flag selection, detached/non-mutating projection, bounds,
reversibility, weather independence, and unchanged native architecture envelopes.

An observed native tree transition from `normal` to `branch_damage` now animates
a small limb slumping vertically against its trunk and a brief canopy recoil
over 2.2 simulation seconds. The trunk/collider never moves and no path blockage
is invented. Joining/reloading a damaged world, changing sources, replacing an
entity, or reconnecting after a long sample gap shows the final pose without
replaying the incident. Completion, stop and native `pruned` state settle it.

Optional public `entities[].wetness` is accepted only as a finite value in 0..1.
It darkens/glosses each instance's own materials and shows Damp (>=.05) or Wet
(>=.5). Missing output, rain, narration, or pending generation never produces
local wetness. Materials restore from their own baselines before tinting; dry
instances and the asset cache remain unchanged. The optional operator
`townLife.mechanic` diagnostic reports build status separately from confirmed
world changes. Tests: `node --test src/demo/spatial-client/environment-view.test.mjs`.

See `../SPATIAL-RENDERING-AND-ASSET-PIPELINE.md` for the renderer/native-state
boundary, art direction and proposed daemon/Blender authoring workshop. The
workshop is a future asset staging service, not an existing Blender integration
or permission for imported meshes/animations to change native behavior.
