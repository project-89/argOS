# H3 extended sessions

Implemented 2026-09-05 for `npm run demo:sitcom:ui`. No longer paid session was
started to verify this change. This removes the sitcom live receiver's two-minute
ceiling; the separate older phone/oil demos and headless evaluation runner have
their own budgets.

## Duration and spending

The live UI offers **2 / 5 / 10 / 20 / 30 minutes**, default **10 minutes**.
`ARGOS_DEMO_SECONDS` sets the default (integer 10–1800 seconds); the UI displays
and can override it before starting. The selected duration is a local spending
ceiling, not a claim about the account's approved provider limit. The approval
email did not state a numeric limit.

The [official Director API](https://fal.ai/models/minimax/h3-max/director/api)
reports `session_info.max_session_seconds`, which may be null. A valid reported
limit only shortens the selected duration. Repeated, larger, or null values never
extend it. Provider time is measured from allocation, not arrival of late
metadata. First media starts the local playback deadline; an absolute deadline
also bounds setup plus the selected budget. Setup itself is limited to 60 seconds.
No unsupported duration or `chunk_duration` configure fields are sent.

Each receiver still permits only one allocation, including uncertain failures.
The browser sends a heartbeat every 10 seconds. After 30 seconds without one,
the receiver stops cognition and disallows further provider proxy requests;
the browser also closes its stream on lease/upload/provider errors. Page exit
attempts immediate shutdown. These are best-effort connection safeguards, not
a promise to override provider billing after a network partition.

## Recording and replay

- Raw video and the video/thought/phone composition are separate MediaRecorders.
  Their one-second emissions upload immediately, sequentially, with identical
  retry bytes and SHA-256 verification on the receiver. No whole-session Blob
  is retained or uploaded at stop.
- Upload pieces are at most 8 MiB. Browser pending data is bounded at 32 MiB per
  recorder; disk quotas are 1 GiB raw and 1.5 GiB composition. Backlog, quota or
  filesystem failure stops the session. Bitrate targets are not guaranteed
  output sizes. Disk availability is checked before allocation with margin for
  both recordings and diagnostic exports.
- Parts are written to exclusive `.part` files with checksum manifests.
  Each recording finalizes independently via fsync and rename. A stopped run
  permits 120 seconds to finish draining; interrupted prefixes are retained,
  explicitly incomplete and not guaranteed playable. They are not silently
  substituted for a complete video.
- Finalized replay uses native video URLs and range requests, not fetch-to-Blob.
  URLs carry separate read-only, media-kind-specific capabilities; those cannot
  authorize world control or private diagnostics. Keep the main session URL
  private: its fragment is the operator credential.

## World and source evidence

Frames, private cognition events and public executor events are appended while
the world runs to `audience-frames.jsonl`, `sitcom-events.jsonl` and
`public-events.jsonl`. Files are exclusive-created with mode 0600. A journal has
an 8 MiB pending-write ceiling, 256 MiB storage ceiling, and 30,000 audience-frame
ceiling in the receiver. Errors are explicit and stop the run.

`GET /state?afterFrame=N&limit=200` reads bounded cursor pages from disk. The
client keeps the complete bounded frame tape; it never evicts early thoughts to
pretend a source gap is synchronized. `frames.json` and standalone `replay.html`
are streamed from complete journal records at shutdown. Long private/public
transcripts remain in JSONL, not repeated in every state response.

The public visual history retains up to 2,000,000 ms, 20,000 captures, 65,536
events and 128 MiB of serialized payload. This is bounded buffering, not an
unlimited queue. Actual JS heap overhead is larger than payload bytes. Missing
history or a too-large interval ends projection explicitly; it never jumps the
source playhead. Private thoughts, contacts and unread texts remain outside the
H3 projection.

The testbed's existing short event caches remain bounded. If they roll over,
`result.json` labels its in-memory evaluation as **tail-only**, and its
`completeDiagnostics` gate remains false. The full incremental journals and
replay are still available; a full archive is not mislabeled as a full-run
cognition evaluation.

## Verification and limits

Offline coverage includes 30 minutes / 3,600 actual simulation ticks, draining
all 211 committed 8.5-second windows from that backlog, 7,201-frame cursor paging,
6,500-frame complete export, duration/lease/provider-cap behavior, upload retries,
independent finalization, storage limits and corrupt/truncated evidence.
A real fragmented H.264/AAC MP4 was uploaded in pieces and decoded with ffmpeg.
The production browser entrypoint is tested with virtual timers and transport.

The native in-app browser also completed the isolated
`npx tsx src/demo/sitcom-recording-smoke.ts` test using the production client and
receiver, with provider imports replaced by clearly labeled synthetic media and
all external model access blocked. Both streamed MP4s finalized, reopened through
native media URLs, and decoded without ffmpeg errors: raw 832×480 H.264/AAC,
10.020 s; composition 1280×720 H.264/AAC, 9.997 s. Evidence is retained in
`recordings/OFFLINE-recording-smoke-0hD2Ot`. This is recording-pipeline evidence,
not model output. The full suite passed 2,455 tests (10 skipped); final targeted
client/server/duration checks passed 55 tests and typecheck passed.

This is not a paid 30-minute H3 soak or proof of thirty-minute browser memory/FPS
stability. A selected longer run is now available for that experiment. Provider
repetition and pixel/action fidelity remain separate limitations: extending
duration does not fix synchronization or invent actions the NPCs did not take.
