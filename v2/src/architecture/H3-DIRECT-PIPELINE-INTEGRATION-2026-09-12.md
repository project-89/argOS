# Direct H3 prompting in the sitcom pipeline

## Scope and outcome

The cookie GUI now uses direct performance prose with the receipt-driven H3 transport, unless the legacy script path is explicitly selected. This integrates the promising continuous-speech probe; it does **not** establish that a live multi-character simulation is free of gibberish, repeated speech, or acting errors.

No paid H3 run or live cognition trial was started for this implementation. A fresh idle GUI was opened on port 63490, backed by `recordings/sitcom-live-FHu3uK`. Its authenticated state returned `started:false`, `prepared:false`, `render:false`, zero issued versions, `promptStyle:direct`, `handoff:chunk_ack`, and requested chunk duration 10. The cookie profile retains David's relationship history, narrative cognition, experience reconsideration, world maintenance, and open-neighborhood configuration. Existing world-growth authority limits were not expanded.

## Control flow and ownership

1. Existing ECS cognition/actions produce committed public scene history.
2. The existing director selects a safe source interval and budgets its performance. Whole utterances and essential actions remain protected; existing bounded speech-slice fallbacks remain unchanged.
3. The screenwriter emits concise camera/action/sound/dialogue prose instead of timed cue-table text. It retains the complete beat ledger, evidence IDs, directed intervals, performance schedule, and source map alongside the prompt.
4. The initial direct prompt is supplied in configure. Subsequent updates use `prompt`, `prompt_version`, and `replan:true`, without a native script queue. An applied acknowledgement alone cannot release the next direct version: a contiguous chunk receipt must represent the issued version. The existing pacer and duplicate/version guards remain authoritative.
5. Playback uses the issued source maps and actual chunk receipts for thoughts, phone delivery/read/replies, world state, and recordings. This remains planned, chunk-aligned presentation, **not proof of frame-exact H3 depiction**.

There is no new reasoning model, controller, speculative dialogue writer, or audio-first/TTS stage.

## Acting and camera directions

- Dialogue is quoted once per committed passage, with explicit named voice and onscreen/offscreen lip-sync ownership.
- A shot change may continue the same utterance, but does not repeat its words. Cross-room voices are labeled editorial audio bridges, not new sound heard by the pictured characters.
- Speech-time public expression, posture, and physical condition inform vocal tone, facial tension, emphasis, and phrasing. Later state is not backdated onto an earlier line.
- Silent characters retain recorded expressions and posture without speaking lip movements. Ending holds permit subtle facial movement, not invented speech or object-moving actions.
- Actual target/placement choreography is retained for reading, typing, pickup, and other physical actions. A notebook or computer cannot become a guessed phone.
- Private thoughts, memories, message contents, and hidden emotional causes are not exported into H3 prompts. If the public expression remains neutral, this change does not invent distress. Richer performance still depends on expressive public state from the simulation and H3 following it.
- Sparse onset anchors remain where needed. Evidence IDs and exact speech end deadlines stay out of direct dialogue prose. Initial/periodic continuity checkpoints and state deltas remain; this production input is richer than the isolated three-line probe.

## Transport selection and timing

Run `npx tsx src/run-sitcom-demo.ts --h3-direct` for explicit direct mode. This overrides the legacy `ARGOS_H3_SCRIPT_QUEUE=1` environment selection without changing `.env`. Use `--h3-script` to retain native append/timed prompts; conflicting flags fail before simulation creation. Without either CLI flag the legacy environment setting is honored; otherwise direct is the default.

Direct mode explicitly requests native `chunk_duration:10` and requires its configured acknowledgement. Its observed media calibration is **10.125 seconds for the opening and 8.5 seconds for continuations**, not ten seconds of displayed media on every chunk. Other direct duration requests are rejected pending calibration. Chunk receipts outside the existing 250ms tolerance fail closed and preserve evidence; issued performance clocks are never rewritten to fit unexpected media. Script-mode duration experiments remain available separately.

The primary supporting continuous probe is `recordings/h3-continuous-speech-XcuVHQ`: three exact dialogue passages plus a silent update in one direct session. Its clean audit is promising single-run evidence, not a general quality guarantee. The matrix evidence in `recordings/h3-speech-matrix-nzqJ0b` is also small-sample evidence, not proof that transport alone causes every repetition.

## Verification and retained failures

Evidence directory: `recordings/h3-direct-integration-0UzVHX`.

- TypeScript: `npx tsc --noEmit` passed.
- Final regression: **35 suites, 336 tests passed**, covering sitcom server/client/director/performance/presentation and rendering histories, privacy, appearance, recordings, and probe contracts.
- Command: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand 'src/demo/__tests__/sitcom-' src/rendering/__tests__`.
- Saved-history style comparison: all **7 segments / 38 beats / 9 spoken passages** from `h3-bounded-verification-YYYCNY` were recompiled through timed and direct writers. Beats, performance, directed intervals, and source bounds matched exactly between styles. Each committed passage appeared once; all 9 received public acting directions. Direct prompts ranged from 2,046 to 5,280 characters, below the unchanged 12,000-character ceiling.
- That replay deliberately retained the saved media budgets to isolate the formatting change. It does not prove new 8.5-second live packing, provider performance, or NPC phone-response behavior.
- The initial broad regression failed two client fixtures because they represented the first direct chunk as 8.5s. Correcting it to 10.125s exposed one legacy linear-playback expectation: at media 6s, the fixture had not yet reached its source delivery frame. The test now explicitly asserts it remains pending there and becomes delivered at media 7s. No production timing guard or delivery rule was relaxed. Initial, intermediate, and final logs are retained.
- An earlier invocation used Jest without the repository's required experimental VM modules and failed on `import.meta`; the proper runner was used afterward. An initial weak `ProcessEnv` typing error was fixed by passing only the two named configuration fields, not by loosening types.

## Next live gate

One bounded cookie run, explicitly started by the user or requested as the next test, with David's text injection and both raw/UI recording. Inspect exact outbound prompts and received versions; audit speaker ownership, repeated/gibberish words, visible phone handling, emotional delivery, and receipt-to-display timing. Report NPC message reception/read/reply separately from video fidelity. Stop on contract mismatch, preserve failed evidence, and do not silently retry or switch transport. Existing cognition baselines and endurance acceptance gates are unchanged and are not claimed passed by this renderer integration.
