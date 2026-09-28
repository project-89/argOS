# Change her world

A focused, interactive Argos demonstration: motivate Mara to fetch oil, change the world
before she gets there, and watch her discover the mismatch between memory and reality.

```sh
npm run demo:oil
```

Open the printed `OIL_DEMO_READY` URL. Its temporary access token stays in the browser;
API keys remain server-side. The server is loopback-only, not a public/mobile deployment.
The page is responsive and its exported video is mobile-friendly.

## Controls

- **Start live video:** one bounded fal H3 Director connection, 480p source.
- **Simulation only:** the same world/NPC, without spending video credits. The stage
  explicitly displays a simulation diagram instead of pretending it is generated video.
- **Plant a thought:** add an actual ECS Thought, activate Mara's goal, and wake cognition.
- **Remove the oil can:** a quick intervention available while she is en route.
- **World agent:** natural-language instructions execute create/remove/move/set/declare
  tools on live ECS entities, containment relations and typed component fields.
- **Radio:** deliver a perception to Mara; her own model chooses a response.
- **Stop & save:** stop scheduling, abort pending NPC/world-editor model requests, close
  video, save the composite recording and world/observation snapshots.

Example world edits:

- “Move the Red oil can to the Beacon room. Leave a note on the Kitchen shelf saying I borrowed it.”
- “Block the Spiral stairs.” / “Reopen the Spiral stairs.”
- “Damage the Brass beacon so adding oil won't fix it.”
- “Make the Kitchen cold and lit by flickering red emergency light.”
- “Create a DemoTemperature component with a numeric celsius field; set the Kitchen to -3.”

Stair blocking and beacon damage have explicit mechanics. New component data does **not**
automatically create physics. The editor reports tool failures and has no shell, file,
publishing or video-prompt tools. Core rooms, the followed NPC, shelf and beacon cannot be
deleted in this focused scenario; physical fields can be edited. Other objects are removable.

## What is real, and what is authored

The starting lighthouse, travel duration (18 seconds), shelf inspection duration (4 seconds),
action vocabulary and physical constraints are authored. This uses the library's single
`createSimulation` entry, ECS, containment, Thought/Belief/Memory/Goal components, scheduler,
and system health telemetry. Unrelated automatic wandering, spirits and evolution are disabled
for this repeatable scene. The broader genesis/evolution runner remains available separately.

Mara's choices and spoken lines are generated live from a restricted observation. Remote
world edits are **not** included in that observation. Knowledge changes on local observation,
not on an omniscient state update. Actions validate current ECS state before committing a
receipt: no oil means no successful pickup/refuel. Both branches are regression-tested.

The agent can inspect/take other nearby objects as well as pursue the oil goal, and can
answer radio messages while travelling. This is not yet a general open-world action planner.

The view DTOs and local receipts are debugging/production views, **not a new canonical event
schema** or a claim of Change Record conformance. World snapshots now preserve component
membership, beliefs/goals/thoughts and their ownership links, plus runtime component schemas.
The demo's travel timers/controller state are saved for inspection, not automatically resumed.

## Video and recording

The 1080×1350 (4:5) canvas combines live incoming video/audio, large mute-readable hooks,
actual world facts, Mara's remembered facts, and a simulation transcript. H3 receives only
grounded scene updates; private thoughts never become voiceover. Video is an interpretation:
exact speech/lip sync and visual compliance are not guaranteed.

The world continues ahead of the video. The displayed video source phase and lag estimate
use chunk prompt versions and accumulated playback durations, not frame-level synchronization.
The fact/knowledge panels are explicitly **world now**, not a claim about the currently decoded frame.

Recordings, `world.json`, and `demo.json` go into a unique git-ignored `recordings/missing-oil-*`
directory. Leave the browser open until saving finishes. Recording prefers MP4 with WebM
fallback. A browser download remains available if server-side recording save fails.
Nothing is automatically uploaded or posted to X.

Configuration: `ARGOS_DEMO_SECONDS` (10–120, default 90), `ARGOS_DEMO_PORT` (default 3461).
Use `GOOGLE_GENERATIVE_AI_API_KEY`; live video additionally needs `FAL_KEY`.
Already-dispatched provider work can still be billable after cancellation.

For offline UI checks only, `ARGOS_DEMO_COGNITION=fixture` uses a labelled **TEST POLICY**.
Do not present that mode as autonomous model behavior. Production defaults to live cognition.

## Live verification, 2026-09-03 Pacific

The final recorded run used live Gemini NPC decisions and a live tool-using world editor,
not the test policy. At simulation 7s the operator injected the oil-fetching thought; at 9s
Mara departed; at 12s the world editor deleted the can without notifying her. She arrived
at 27s and completed inspection at 32s, updating her Belief to missing. A radio question
at 32s received a generated response at 36s: “The shelf is empty, I haven't found the oil can yet.”
One attempted action failed its grounding check before the reply; it did not mutate the world.
The 49.16-second portrait export contains the real incoming H3 stream, audio and live data overlays.
Source and final MP4 decode checks passed. The session and local server were stopped afterward.

Separate live world-editor verification moved the can to the beacon room and created a note
on the shelf while Mara was elsewhere; her observation DTO remained unchanged. Unit checks
cover removal, the no-interference refueling branch, relocation/notes, blocked travel, invalid
actions, stop/cancellation, private-thought exclusion, and state/memory rehydration.

An earlier live rehearsal exposed repeated shelf searching and an unstructured JSON response
failure. Decisions now use schema-constrained output, repeated unchanged shelf searches are
rejected, and a pending radio turn explicitly offers the speech action. Words remain generated.
