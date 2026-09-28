# Argos → fal H3 Director

Run from `v2` with `FAL_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` in the git-ignored `.env`:

```sh
npm run live:director -- "Your small world seed"
```

Genesis and the narrative scaffold are generated first. Open the `DIRECTOR_READY` URL
printed in the terminal, then press **Start bounded stream**. The receiver is a standalone
local WebRTC test page, not the Argos UI. The key never goes to the browser. The URL contains
a temporary local access token; don't share it.

Defaults: one Director session, 480p, 60-second client deadline including connection setup.
`ARGOS_DIRECTOR_SECONDS` accepts 10–120. `ARGOS_DIRECTOR_PORT` defaults to 3460.
`ARGOS_NPC` selects an existing generated character by name. The page sends `stop`, closes
WebRTC, and stops simulation scheduling at its deadline. The server separately stops the
simulation and refuses further signaling after the deadline. Already-dispatched AI/video work
may finish and remains billable; this is a duration bound, not a dollar-level billing guarantee.
Ctrl-C terminates the local process. A second session requires restarting the command.

The receiver records incoming video and audio from the first playable frame. Stopping the
stream (manually or at the deadline) finalizes the recording, exposes a browser download,
and saves it in the git-ignored `v2/recordings/` directory. MP4 is preferred when the browser
supports it; otherwise it uses WebM. Leave the receiver open until `recording_saved` appears;
closing the tab or killing the process early can lose the recording. Recordings stay local by
default; nothing is automatically published. A localhost/download URL is not accessible from
a phone on another machine. For sharing, export an H.264/AAC MP4 and upload that clip explicitly.

The initial projection carries the selected character's description and confirmed room.
Each received `chunk` requests a fresh snapshot and sends a strictly increasing `prompt_version`.
Telemetry records `sourceTick` for each version; Director reports `prompt_pending`,
`prompt_applied`, and chunk versions. This is an initial live state projection, **not** a
complete canonical event-stream adapter or deterministic frame/time alignment. Actions and
dialogue still need post-execution grounding before they can be safely added. No visual output
is written back as simulation truth.

The receiver is loopback-only and its proxy allowlists Director's ICE/session/heartbeat routes,
pins the model, and allows only one allocation. It is not intended for public deployment.

Contract: https://fal.ai/models/minimax/h3-max/director/api
SDK: `@fal-ai/client` alpha's `fal.realtime.open(wma(...))`.

## First live verification (2026-09-03)

Google model-list authentication and Director ICE returned HTTP 200. A generated lighthouse
world successfully streamed to headless Chrome: 7 chunks reported, 1,277 decoded video frames,
832-pixel video width at the 480p setting, with increasing prompt versions acknowledged.
The first chunk reported 2.091 seconds generation for 10.125 seconds playback. Continuation
chunks reported 8.5 seconds playback. The client stopped at 60 seconds and received
`stream_exhausted` with reason `stopped`. Director advertised `max_session_seconds: 120`.
The simulation reached 20 ticks with no slow ticks. Actual billed cost was not queried.

Remaining runtime defects observed during this integration: generated-system preflight creates
a second world against global component arrays (a validation room overwrote the God entity's
name); `sim.stop()` stops scheduling but does not cancel already-running AI operations. The
test process was terminated after the stream stopped to prevent further work. These need fixing
before an unattended long-duration run. The renderer itself is currently snapshot-only.

## Recording verification (2026-09-03 Pacific)

A 30-second bounded session saved 23.678 seconds of media (connection setup is included in the
session deadline). Exported MP4: 832×480, 568 frames at 24 fps, H.264 Constrained Baseline and
AAC-LC audio, with fast-start metadata. Full-file decoding passed. A one-off fal CDN upload
requested seven-day retention and returned HTTP 206 for a byte-range request. Local originals
remain in `recordings/`; subsequent sessions save locally without automatically sharing.

The first recording attempt exposed an invalid unquoted `codecs` MIME parameter from Chrome.
Uploads now send the base media type. The recording endpoint regression test and a real-browser
synthetic video/audio capture through that endpoint pass. The live retry saved successfully.
