# Real-time camera contract

## Why this changes the renderer

The direct-prompt run `recordings/sitcom-live-VhhtKI` used 120 seconds of video to cover 22.42 seconds of source time. It retained every room's dialogue in one global performance queue. Overlapping conversations triggered word-sized packets and 95.26 seconds of scheduled ending holds. This is unacceptable for a live simulation, even if every evidence ID survives.

**Delay is allowed. Time dilation is not.** The direct GUI now uses `scheduling:realtime`. Native-script/legacy editorial scheduling and old recording playback remain available for compatibility; those older modes do not acquire a new 1:1 guarantee.

## Implemented contract

- Every direct media interval covers exactly the same duration of already-committed source: 10.125 seconds initially, then 8.5 seconds per calibrated continuation. No candidate search for a shorter or longer source interval, no word-sized segment fallback, no artificial ending hold, no compression of lived quiet time.
- The source map is an affine translation: `sourceMs = segmentStart + mediaOffsetMs`, with rate 1 everywhere. UI thoughts, message delivery/read/reply, world state, and replay use that same mapping.
- Insufficient source buffers rather than being stretched. A sealed short tail is retained in history and reported as `incomplete_realtime_tail`; it is not padded into a full clip or silently declared filmed.
- Native physical durations are retained, not expanded to editorial gesture minimums. Ongoing gestures can continue across updates. A crossing phone vibration carries only its remaining tail, not a new buzz.
- Playback validates real-time metadata and rejects non-unit source maps. Repeated provider versions or actual chunk lengths differing by more than 1ms from the issued real-time budget produce explicit failures, not hidden holds or clock rescaling. Existing bounded buffer, recording, authority, source, privacy, and retention guards remain.

## One camera is not the entire world

The camera chooses Elaine's historically recorded room **at the beginning of each media interval**. It stays in that room for that interval; the next interval can follow her to another room. A room switch re-establishes only that room's public setting, cast, wardrobe, and props. Camera selection never invents a destination or reaches into the live/future ECS.

The complete public `Screenplay.beats` ledger remains intact. `performance.coverage` classifies every beat as:

- `prompted`: supplied to this camera's prompt. This is not proof of H3 depiction.
- `off_camera`: retained world evidence outside this camera's scope, not queued for later reenactment.
- `competing_audio`: another overlapping local voice excluded from this clear foreground audio track, retained explicitly in the ledger. Selection uses original native onset order, not alternating delivered words.

This changes the coverage contract deliberately. One stream no longer promises to audibly perform every simultaneous conversation. Other rooms and NPCs keep running. We do not serialize global cognition, cancel their actions, or silently erase their dialogue to accommodate H3.

Room-scoped sound selection is conservative: remote sounds are not automatically imported. Richer acoustic camera mixing and following a character mid-segment remain future work, not hidden assumptions. Dialogue can still span native update boundaries; those are fixed-time continuations, not separate 8.5-second clips per word. H3's fidelity to such continuations remains unverified.

## Rendering-history repair discovered by the native test

A first native action at source zero can lazily assign the room its stable identity. A sparse event witness with that first identity was previously treated as a replacement of the initial unkeyed room, erasing unmentioned occupants from the assembled baseline. This made the real-time camera correctly fail `camera_subject_unavailable` even though Elaine remained in the ECS.

The merge now treats an initial identity assignment as continuity, preserves an already-known identity when a sparse witness lacks one, and still distinguishes two known different lifetime keys. Same-time occupant preservation and actual room-reuse tests cover this repair. No live-state fallback was added to conceal missing historical evidence.

## Verification

Current evidence: `recordings/realtime-replay-dGw9iX`.

- Recompiled the exact failed live source without new NPC inference or H3 generation.
- **Five segments: 44.125 seconds of source in 44.125 seconds of planned media.** All 1,765 sampled playheads advance at 1:1, within floating-point tolerance of 0.000001ms.
- David's delivery maps to source/media **23.7s**, in segment 3. The corresponding segment also contains the local phone buzz at source 23.7s.
- All speech evidence through source 44.125s remains exactly once in the full beat ledger. Coverage: 15 prompted beats, 13 off-camera beats. No competing-audio exclusions were needed for this particular replay. The remaining 1.375s sealed tail is not issued.
- Separate synthetic five-minute playback test confirms 300s media maps to 300s source. This is not a five-minute live/model or cognition endurance test.
- Tests cover native simultaneous conversations in different rooms, same-room foreground-audio coverage, fixed source windows, buffering/short tails, sound continuation, historical room changes, 1:1 mapping, repeated chunks, and both shorter/longer provider-duration mismatch.
- Final regression: **36 suites / 346 tests passed**, using the repository's experimental-VM-modules Jest runner. TypeScript `--noEmit` and whitespace checks passed. Full regression and typecheck logs are retained with the replay.
- Initial offline replay assertion failed on JavaScript floating-point noise (`4025.0000000000005` versus `4025`); the corrected assertion uses the stated sub-microsecond tolerance, not a relaxed rate requirement.
- The native parallel-room test exposed the real sparse-witness identity bug above. Its failure is preserved. A follow-up room fixture also initially used the wrong appearance entity ID; the fixture was corrected without weakening entity-identity validation. Both failure logs are retained.

## Limits and next gate

No paid video run was performed for this change. This establishes a tested **engine-issued real-time clock and camera projection**, not guaranteed H3 lip sync, visual timing, cast stability, or clean speech. Initial prompts are still more complex than the successful isolated speech probe. The saved run's unread-phone cognition outcome is not retrospectively fixed.

Next: one explicitly authorized bounded H3 run with the new default, verifying contiguous 1:1 media/source progression, phone delivery in the corresponding scene, intelligible dialogue, actor identity, and actual physical performance. Preserve and stop on a mismatch; no automatic retry. Cognition baselines and endurance gates are unchanged and are not claimed passed here.

## Subsequent live gate — mixed result

The authorized run is now preserved at `recordings/sitcom-live-8PvJUC/REVIEW.md`. Thirteen unique received versions maintained the 1:1 contract, with no inserted ending holds or missed provider deadlines. Elaine read David's text 9.5s after delivery and replied; the saved UI shows that reply. Pickup/reading were depicted, but clear typing was not established.

This is **not** a clean live acceptance pass. The source reached 120s, then a sealed 7.875s remainder triggered `incomplete_realtime_tail`. The client treated this as fatal and stopped before draining already-generated media: the recording is only 102.207s. Later audio also speaks a timestamp direction and contains unclear/gibberish speech; cast/wardrobe continuity varies. Clock correctness does not imply audiovisual adherence. Next work is short-tail/drain handling, simpler model-facing stage directions, and sentence-boundary fidelity while preserving the 1:1 source contract. No automatic second live run was made.

## Follow-up repair — offline verified

`recordings/realtime-fixes-QUb26G/REVIEW.md` records the bounded repair. A verified sealed short remainder now returns normal completion with explicit `unfilmedTail` coverage; it does not advance the filmed cursor. The receiver drains only the frozen acknowledged frontier, retains late receipts without admitting repeat performances, and reports the unfilmed remainder. Genuine source faults and spending/timeout guards remain fatal. The earlier failed run is not relabeled successful.

Direct prose drops numerical scheduler onsets, repeated silence instructions and empty micro-cuts, while preserving exact dialogue, public acting, physical actions and voice ownership. Timed/legacy output is unchanged. The full saved run recompiles with identical evidence and timing, and 32.85% fewer prompt characters. All 36 suites / 350 regression tests pass. No new paid video was generated: coarse prose does not promise exact action onsets, and sentence-split/gibberish fidelity remains a live gate.

## Live follow-up of the repair

One subsequent authorized run is saved at `recordings/sitcom-live-k8oRLC/REVIEW.md`. Draining completed at 112.067s against the 112.125s target (within the existing 60ms completion tolerance), explicitly reporting the 7.875s unfilmed source tail. A late repeated version was retained in receipts but excluded from the recording. Recorded intervals remained 1:1, with no pacing failure or provider deadline miss.

Opening/middle audio samples were largely intelligible without numeric stage-direction narration; word fidelity and boundary handling remain imperfect, and the ending audit was incomplete. Elaine recognized but repeatedly deferred her phone, leaving the message unread at source 120s. Thus the drain repair has live evidence, but neither full audiovisual fidelity nor the interactive phone behavior is a clean pass. No automatic retry was made.
