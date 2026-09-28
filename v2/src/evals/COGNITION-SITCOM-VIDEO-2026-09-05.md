# The Last Cookie: live cognition + H3 receiver test

Date: 2026-09-05. This is a completed end-to-end engineering run, **not** a claim that cognition or renderer fidelity is solved.

## Deliverables

Run directory: `recordings/sitcom-live-p8LjDS/`.

- `argos-engine-update-40s.mp4`: 40-second excerpt of the actual UI composition, beginning at recording time 54.125s. 1280×720, 24fps, H.264/AAC, fast-start MP4, 5.57 MB. No rewritten thoughts, invented reply, or reordered events.
- `argos-the-last-cookie-ui.mp4`: full approximately 120-second video + selected current thought + phone + ECS facts, converted to 24fps H.264/AAC. The original `ui-composition.mp4` is preserved.
- `argos-the-last-cookie-raw.mp4`: raw 832×480 H3 recording, remuxed without re-encoding or overlays. Original provider-stream capture also preserved.
- `world.json`, `events.jsonl`, `public-events.jsonl`, `frames.json`, `segments.json`, `playback.json`, `result.json`, and `replay.html`: saved world and audit evidence. These contain operator/private NPC diagnostics and should not be uploaded wholesale with a public clip.

`npm run demo:sitcom:ui` starts a new loopback-only, token-protected, single-use receiver. It does not start a paid session until Go live is clicked. Saved replay was verified after browser refresh without allocating another session. The receiver for this completed run remains on port 3464.

## What actually happened

Four production Argos agents, using configured `gemini-3.8-flash`, ran for 120 simulation seconds. The initial world/personas/goals and an outside text at 25s were seeded. Dialogue and action choices were model-selected, not a scripted screenplay. A second text was entered through the browser at 44.5s; no thoughts were planted during this video run.

| Actor | Admitted authored thoughts | Completed speech turns | Decision-slot p50 / p95 |
| --- | ---: | ---: | --- |
| Jerry | 20 | 5 | 901 / 2652 ms |
| George | 11 | 6 | 958 / 3608 ms |
| Elaine | 6 | 2 | 1125 / 2943 ms |
| Kramer | 13 | 4 | 1016 / 1757 ms |

Total: 50 thoughts and 17 completed speech turns, 219 spoken transcript words. Request-slot latency includes deterministic selections; it is not a pure model-latency or successful-admission metric. The lexical evaluator flagged no repeated speech at its current threshold; this is not proof of naturalness.

Elaine acquired the actual cookie at 19.8s, winning a simultaneous pickup over Kramer. His failed pickup was a real ownership conflict, not an engine exception. She acquired her phone at 30.8s. The cookie remained intact in her inventory at the end.

- Scheduled text: queued 25.0s, delivered/heard 25.2s, read 33.7s.
- Browser text: queued 44.5s, delivered/heard 44.7s, read 51.2s.
- Four physical notification buzzes; no observed pre-read message-body leak.
- At 52.5s Elaine thought: “George is still rambling about 'capital' while someone is sending creepy prank texts to my phone. But I already have the cookie in my hands, so I'm not giving it up.”
- **No typed or delivered reply.** The outside-reply gate is false. Message delivery/read and suspicious uptake are demonstrated; a two-way phone exchange is not.

The episode exercises cognition, background planning, perception, timed speech/actions, object ownership, phone state and rendering integration. Autonomous world generation/evolution was disabled; this is not evidence for that subsystem. The nested testbed provenance retains `h3:false`; `renderRequested:true`, the playback metadata and recorded media establish the separate renderer run.

## Renderer results and limits

One bounded 480p H3 session was started. The world pre-buffered 8.5 committed seconds before configuration. Only already-lived public scene windows went to H3; private thoughts and unread message bodies were kept out of its prompts.

- First media/recording began 15.353s after Go live, 6.807s after configuration.
- 14 contiguous chunks represented 11 source windows. Window 12 was issued/applied but had no recorded chunk before the cap.
- First chunk: 10.125 media seconds for 8.5 simulation seconds. Subsequent chunks: 8.5 seconds.
- Three repeated **prompt versions** added 25.5 seconds of held source state (21.25% of the recording). This does not mean identical pixels.
- Prompt submission to first corresponding chunk: median 7.672s; range 6.737–18.189s.
- The recording covers through source time 92.863s of the 120-second world. The last 27.137 simulation seconds are not depicted within the video cap.
- No unknown versions, source discontinuities, or dropped audience frames; 593 saved frames.

Audience state follows actual chunk versions/durations with explicit within-window retiming. During repeated versions it holds the last known source endpoint. This is metadata alignment, not verified frame-exact execution of every event. Browser/decoded-frame review showed recognizable characters and animated conversation, but object/room staging was not a reliable literal depiction of ECS state; phone-reading frames were not visually convincing. The readable UI supplies authoritative message/state information. H3 audio wording and lip-sync were not independently transcribed or certified.

## Cognitive issue exposed

Elaine's first committed thought occurred at 52.5s, mapping to video time 54.125s. It was captured immediately: **not a missing UI event or merely video lag**.

Before that point, nine valid physical actions executed while their accompanying mental updates were discarded (seven changed-dialogue, one changed-goal, one changed-local-view). Eleven further drafts were superseded, and one response had malformed JSON. The global heard-fragment/public-view/goal freshness fence can starve inner-life admission during active conversation even while valid physical actions proceed. The composition's default Elaine focus amplified this into a blank opening; the main UI still showed other actors' thoughts.

Next cognition work should separate grounded, historical self-thought admission from side effects on current goals, plans, memories and actions, using explicit dependency/provenance checks. Do not simply admit stale mental bundles or fabricate filler thoughts to make the UI busy. Add a sustained-conversation test requiring bounded time to an admitted, grounded thought while preserving stale-action and privacy barriers.

Next renderer work should address prompt-version repeats and visible object/room continuity before claiming the timing problem is solved.

## Changes and verification

- Completed phone reads now emit an attention event, giving new message contents a foreground consideration opportunity instead of allowing a stored movement plan to bypass them. It does not require a reply.
- Cookie consumption changes its visible Description to crumbs at physical completion, alongside authoritative food state.
- Added standalone video-first receiver, actual-chunk playback mapper, committed-window director, independent raw/UI capture, bounded/authenticated controls and persistence, and saved replay.
- Full suite: **201 suites, 2352 tests passed, 10 skipped**, 130.201s.
- Final browser-client/presentation tests: **14/14 passed** with the project's ESM test invocation; `npm run typecheck` passed.
- Live browser checks: startup, actual incoming media, manual text submission, read receipts, automatic cap/save, raw and composition downloads, and refresh into saved replay.
- Exports probed as H.264/AAC MP4; full UI export decoded without errors. Frames from the original composition and raw recording were visually inspected.

Two preceding non-H3 trials are preserved: `sitcom-YBRnmD` (George ate the cookie) and `sitcom-qL0zte` (Elaine recovered it; read at 28.2s and skeptical reaction at 29.5s). Different physical outcomes are useful evidence of branching, not proof of general cognition robustness.

## Suggested update caption

Four NPC minds. One last cookie. I texted Elaine from outside their world. In the simulation, her phone buzzed, she picked it up, read the message—and decided it was a creepy prank. Argos runs the world state and cognition; H3 renders the scene. Still tuning thought continuity and render timing. An actual engine test, not a scripted conversation.
