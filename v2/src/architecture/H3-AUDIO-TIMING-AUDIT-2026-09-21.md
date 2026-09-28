# H3 five-minute demo: speech repetition and performance timing

Read-only diagnosis of `recordings/sitcom-live-SS9UYk`, requested after the
user reported near-universal duplicated voicing. No new H3 session, upload,
production model change, renderer change, or cognition mutation.

## Result

The user is right that a 1:1 source/media clock does not certify useful 1:1
performance. Selected complete sentences are delivered substantially faster
than the engine's estimates, and are then spoken again across the following
ten-second media boundary. Their first delivery also starts substantially
later than the issued source map expects. The thought/phone overlays follow
that issued map, not measured speech onsets.

This is stronger evidence for cross-boundary speech repetition than for
same-chunk empty-tail padding alone. It does not identify whether prompt
expansion, audiovisual continuation, script handling, or provider audio
assembly is responsible. It does not prove exactly half the full recording
is redundant.

## Measurements

Times below are seconds from the saved raw recording, **not wall-clock time**.
The two local blind ASR models agree on both occurrences of each sentence;
the displayed bounds are the small.en estimates, rounded to 0.01s.

| Complete line (abbreviated) | Engine allocation | First delivery | Repeat | Boundary |
| --- | ---: | --- | --- | ---: |
| Jerry: “George, will you freeze … What were you going to say?” | 5.36s | 36.04–39.84 | 40.28–42.08 | 40s |
| Jerry: “All right, we're in the same room now. What were you saying?” | 5.46s | 46.60–48.86 | 50.26–51.84 | 50s |
| Jerry: “Relax, Costanza … I just texted them back to ask who it is.” | 6.78s | 116.24–120.44 | 120.68–124.58 | 120s |
| Morpheus: “To awaken you from a simulation designed to keep your mind bound to routine.” | 6.02s | 246.08–250.22 | 250.74–254.46 | 250s |

- Allocation totals **23.62s**; first deliveries total **14.40s**; repeated
  deliveries total **11.00s**. The first deliveries take 61% of their allocation;
  repeats consume 43% of the measured first-plus-repeat spans in this sample.
- These samples were selected for clear duplicated complete lines, **not**
  randomly. Do not extrapolate 43% to the whole five-minute recording.
- First-delivery onsets lag their scheduled onsets by 6.04, 6.10, 5.24 and
  5.08 seconds respectively. This is within-film performance mismatch,
  separate from the roughly 20-second source-to-browser buffering delay.
- An exploratory exact-token scan finds >=5-word repeated passages starting
  within 2.5 seconds after **21 of 29** internal boundaries. This is an ASR
  candidate count, not a human-audited repetition rate or causal test.
- The full blind transcript also contains unsupplied words, recognition errors,
  uncertain joins and incomplete endings. Do not label it a perfect transcript.

## Engine/transport findings

- Thirty distinct outgoing script entries and thirty distinct recorded
  script versions for 0–300s. The repeated version 30 receipt begins after
  the saved recording's endpoint; it cannot explain these earlier repeats.
- Every selected sentence above was supplied once, complete, in one prompt.
  The successor prompts do not supply it again. Thus sentence splitting is
  **not necessary** for this repetition, though it is a separate weakness.
- Across all prompted dialogue, 18 of 32 utterances are split into 50 slices.
  No overlap of issued word evidence was found in the prior audit. Isolated
  fragments such as “keys.” and “There” still make temporal interpretation hard.
- `src/cognition/timed-speech.ts` authors speech at 400ms per token (150 wpm),
  plus 300ms onset and punctuation pauses. This is not a calibrated H3 voice.
- The direct prompts omit precise onset/duration cues that remain in the
  sidecar schedule. Numerical schedule correctness cannot enforce H3 delivery.
- Client recording clones the received audio into raw and composed streams;
  it does not synthesize NPC speech, mix those recordings together, or replay
  sentences. The raw file has one audio track and starts at PTS 0.

## Method, limits, and preserved evidence

All work stayed local. A cached isolated `uv --no-project` environment installed
`faster-whisper==1.2.1` and downloaded small.en/base.en weights. No repository
dependency manifest was changed. No recording was uploaded to an ASR provider.

Audio was extracted at 16kHz mono PCM with FFmpeg `aresample` preserving the
presentation clock. Extraction logged no warnings; original media was not
changed. Small.en transcribed the full recording; base.en independently
transcribed 30–55, 102–125 and 240–257 seconds. Neither received the expected
script, speaker names, or an initial prompt. Both used temperature zero,
beam five, word timestamps, and no previous-text conditioning.

These are **machine-estimated** word times, not human listening or verified
speaker attribution. Speaker names in the table come from intended source
dialogue, not a finding that H3 used the right visible mouth or voice.

A waveform cross-correlation check compared three first/repeat pairs,
including a range of uniform resampling factors. Best correlations were
0.09–0.20, versus 1.0 for identical self-controls. This does **not** support
simple sample-identical replay; it cannot rule out regenerated repetition,
nonuniform time warping, codec differences, or other provider processing.
Nonzero RMS confirms audio is present in both sets of measured spans.

Artifacts alongside the original recording:

- `timing-audio.wav`: locally extracted audio.
- `timing-transcribe.py`: reproducible blind ASR invocation.
- `timing-transcript-small.jsonl`, `timing-transcript-base-check.jsonl`:
  full machine evidence, including confidence and word timestamps.
- `timing-measure.mjs`, `timing-measurements.json`: reproducible exact-text
  matches, candidate boundary scan, sample aggregates, and source hashes.
  Assertions verify two occurrences in each ASR output for each selected line.
- `timing-waveform-check.py`, `timing-waveform-check.jsonl`: signal check.
- `timing-repeat-example-242-257.mp4`: 15-second excerpt of the Morpheus
  example; raw audio/video, no time stretching, a smaller re-encode.

The selected four source lines are each matched twice in both ASR results.
No production regression tests were run because no production code changed.
All prior failed evidence and broader acceptance gates remain unchanged.

## Recommended next decision

1. Treat cross-boundary repeated speech as the primary measured rendering
   defect, not as a solved clock problem. Preserve these examples for Fal;
   sharing/uploading still requires authorization.
2. Do not globally accelerate cognition or shorten all speech durations from
   four selected lines. That would change conversational semantics without
   demonstrating an H3 fix.
3. Sentence-boundary cleanup remains justified, but cannot be presented as the
   fix for these complete-line counterexamples. Likewise a quiet post-line
   action has already failed to eliminate repeats in an earlier isolated test.
4. Any next paid experiment should use a frozen, complete-line script and
   change one continuation/history variable, then score duplicate words and
   actual onset/duration—not merely receipt version or source/media duration.
   Prior preloaded-script repeats mean a live-append-only explanation is
   already insufficient. No further paid experiment authorized or launched
   by this diagnostic pass.
