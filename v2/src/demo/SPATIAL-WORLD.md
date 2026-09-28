# Argos spatial world — first bounded 3D slice

Argos is the engine. Three.js is a read-only browser renderer, not a second
simulation or an agent controller. This is a new small testbed; it does not replace
the apartment/H3 demo or certify the outstanding long-world acceptance gates.

## Run

For the new data-driven four-house/ten-resident town foundation, see
`TOWN-MILESTONE.md`. `npm run demo:spatial -- --live --town` prepares it without
automatically starting model calls. Autonomous spatial construction remains
gated; the town is an authored native ECS testbed.

For a coastal-horror setting using these same assets and native mechanics, see
`SALTMERE.md`: `npm run demo:spatial -- --live --lovecraft`. It adds an authored
cast/mystery brief and dusk art direction, not a different simulation engine.

```sh
npm run demo:spatial
npm run demo:spatial -- --live
```

Open the printed `SPATIAL_DEMO_READY` link including its fragment token. The
server binds only to loopback. It starts **ready**, not running: click Start.
The first command is labelled **manual physics**, with no AI calls or scripted
autonomy. The second uses the existing configured Argos foreground/background
models and requires the existing Gemini key. No H3 or new model is used.

`ARGOS_SPATIAL_PORT=0` chooses an available port. `ARGOS_SPATIAL_SECONDS` is 10–600,
default 600. Both world-time and wall-time limits stop the session. Stop is final;
relaunch to make a fresh world. The saved world/session JSON is evidence, not a
claim of full spatial-package resume support.

## What is connected

- `createSimulation`: the current native cognition, narrative identity, appraisal,
  memories, intentions, background planning/reflection, dialogue and timed speech.
- `AgentWorldCapabilities`: chooses no actions; supplies local capabilities and
  admits native operations through the existing execution/receipt path.
- `createSpatialWorld`: deterministic bounded ground-plane routes over ECS
  Position. Real walls/furniture collide, room identity changes at actual
  crossings, and cancellation leaves the body where it reached. Target/source/
  actor identities are revalidated. Legacy locomotion is fenced by ownsMovement.
- Native movement reserves distinct arrival/approach endpoints. Room arrivals
  can choose a bounded nearby alternative; object interactions use only authored
  anchors. Present bodies still occupy space when their cognition is inactive.
  A blocked final approach waits at most five simulation seconds, without banking
  movement time, then reports failure if still occupied. Cancellation and source
  cleanup release reservations. This is not continuous crowd/path avoidance.
- Physical pickup/drop and native eating/seating use existing ECS inventory,
  containment, affordance effects and relations. Operations walk into reach and
  take time; changing/removing a target invalidates stale work. Departure releases
  seating only when the body moves. An exact own-seat egress exemption lets a
  seated body stand without ignoring other obstacles.
- A real private phone transport: local notification → physical pickup → timed
  read → private communication/appraisal → independently chosen timed reply.
  Operator texts and planted thoughts are stimuli, not compulsory action scripts.
- The browser polls allowlisted physical snapshots. It interpolates only toward
  already committed positions; it never reports action success or advances time.
  Separate authenticated operator data supplies the thought/message panels.
  `/api/scene` omits those panels and the operator event feed.
- Above-head speech bubbles show only native words already spoken, not the
  forthcoming script. Brief comic text ("bzzzt", "munch munch", "tap tap") follows
  actual phone notifications and successful physical effects; failed/cancelled
  requests do not produce success captions. These are visual cues, not additional
  sound stimuli or generated audio. Source timestamps expire cues, with a bounded
  browser-time fallback so a disconnected view cannot repeat/freeze a bubble.
- The selected character has a compact world-space goal tag and a full sidebar
  card. A validated ongoing activity is distinguished from a leading-priority
  goal; the latter is not presented as a guaranteed next action. This read-only
  operator projection does not put private goals into the public scene transport.

Mara has authored history with Alex and a standing communication motivation. Ivo
has his own purposes. The manual actions panel deliberately bypasses autonomous
choice for physics testing; it is labelled operator control and still uses native
execution validation. No decision or phone reply is scripted in either mode.

## Assets and growth

Selected local Kenney Furniture Kit/Mini Characters assets are CC0; originals,
source URLs and hashes are in `spatial-client/assets/ATTRIBUTION.md` and its asset
manifest. No Synty assets are used. Simple authored walls/phone/food geometry
complements the licensed kit. The curated catalog binds visual IDs to native
object types, footprints, interaction anchors and appearance; a mesh alone
does not create an affordance.

The café button is **operator-triggered authored expansion**, not autonomous
Weaver/God work. Before mutation it validates a complete bounded blueprint,
native types, existing room identities, construction budget and connectivity.
It adds a real room, seating and consumable food to the running ECS. A repeated
request does not refill eaten food. A native commit failure is retained and not
automatically retried or described as an atomic rollback.

The initial scene and café use one floor and a small catalog. Autonomous spirit
layout generation/admission, runtime enrollment of additional residents, arbitrary asset imports,
multi-floor navigation, crowd avoidance, precise hand IK/lip-sync, and complete
spatial save/resume are not claimed. Current door interactions are room-side;
general two-sided portal interactions need an explicit follow-up. Floor drops
require standing clear of seating, so objects cannot be stranded in its collider. Browser
animation is representative, not biomechanical simulation. Voices remain text
in the UI; no generated audio is invented by the renderer.

Real-time needs in this authored afternoon are +10 hunger/hour and -5 energy/hour.
This locally replaces the accelerated minimal-preset rates, not the engine-wide
need calibration still pending in the long-world work.

## Validation

### The Blackout (opt-in)

`npm run demo:spatial -- --live --blackout` opens a fresh, initially paused
two-character repair scenario. Omit `--live` for manual, offline physical tests.
The original apartment demo is unchanged without `--blackout`.

The lighting panel, isolated circuit, closed supplies box and two physical
cartridges are ECS state. Characters inspect the fault, obtain the correct part,
install it while isolated and restore power. Inspection is private evidence;
dialogue can share it. Native containment, identity, reach, timed operations and
current execution authority gate every effect. Removing/damaging the installed
part extinguishes the light. The renderer follows that state; it never repairs
the circuit. The original café button is unavailable in this scenario, because
operator-authored construction is not autonomous need-driven growth.

The bounded diagnostic runner is `node --import tsx
src/demo/spatial-blackout-check.ts --live --directory=<new-directory>`.
It is an explicitly paid-model diagnostic with 180-second wall/simulation and
100-request limits; stops after ten simulated seconds of stable native repair.
`--variant=B` changes the required cartridge. `--memories=<experiences.json>`
imports only actor-owned recollections from a trusted local prior run, not old
plans, possessions, private information from another actor or execution rights.
This is an experimental memory comparison, **not** full-world resume.

See `BLACKOUT-MILESTONE.md` for exact evidence, remaining gates and the missing
native-to-spatial bridge for spirit-built places.

### Extended Blackout and house spirit

`npm run demo:spatial -- --live --extended-blackout` selects the three-room
variant: Apartment → Utility room → Storeroom. The diagnostic panel, dark lamp
and closed supplies box are separated. Cartridges must be discovered and carried
back along real routes. Connections are permanent open passages; this variant
does not pretend the existing one-sided door model supports two-sided locks.
The compact `--blackout` control remains available unchanged in layout.

The sidebar's **Ask the house spirit** box sends an authenticated operator
request, separately from texting or planting NPC thoughts. Its powers are limited
to disconnecting/restoring the lighting circuit and opening/closing the supplies
box. Restoring power requires a real working installed cartridge. It cannot
create entities, teleport characters, change goals or repair missing parts.

Familiar full phrases are immediate deterministic controls; other phrasing uses
the existing configured spirit model to select one allowlisted operation, not
to execute code or write component fields. Each delayed result must still match
its source and physical target state. One pending request, 15-second timeout,
64 requests/session, explicit applied/unchanged/rejected receipt. Manual mode
uses only direct phrases unless a local test deliberately supplies an interpreter.
No private NPC state is sent to this interpreter.

Circuit transitions from either NPC actions or operator intervention now issue
local physical attention/experience events: people near the panel notice its
switch; people in the apartment see the lamp change. The panel also exposes a
public energized indicator. Neither pathway tells characters what to do or
rewrites completed goals. Characters in other rooms do not receive omniscient
reports. A repeated outage is a new situation, not a replay of the old task.

Use `spatial-blackout-check.ts --live --extended --second-outage
--directory=<new-directory>` for the same bounded diagnostic with one prospective
operator intervention after ten seconds of stable native repair. It preserves
failed trials and does not count as the ten-trial or endurance gate. See
`SPATIAL-HOUSE-SPIRIT.md` for this pass's outcomes and limitations.

Run the new spatial world, catalog and demo integration suites, the server
authorization tests, and `node --test src/demo/spatial-client/view-model.test.mjs`.
The broader goal's ten-trial baseline and ten-minute live endurance requirements
remain open; a new renderer does not satisfy or replace them.

### First verification — 2026-09-25

- 160 tests passed across 11 selected backend regression suites; 8 client checks
  passed; TypeScript typecheck and browser bundle passed.
- One bounded live trial, 60 seconds wall / 58.5 seconds simulation, with the
  existing model configuration. Mara picked up the phone at 3.7s, read at 6.0s,
  and sent an independently authored reply at 20.54s. Ivo independently sat,
  approached/ate the pastry, and returned to the chair. No operator action or
  planted thought was used to force those outcomes.
- One background planning request timed out after 15 seconds; foreground work
  continued. This is retained evidence, not an all-green cognition/endurance claim.
- Native browser inspection showed the real 3D scene, seated character,
  current thought, message read receipt and reply. Growth/navigation are covered
  by deterministic integration tests; autonomous 3D world growth is still deferred.
- Evidence: `recordings/spatial-8OZRBx/` (world/session/sampled state), plus
  `recordings/spatial-check-2026-09-25-Rz8HoP/` (all test logs, failed iterations,
  live log and assessment). The final hand-attachment/typing presentation patch
  passed offline checks but has not had a second live trial.
