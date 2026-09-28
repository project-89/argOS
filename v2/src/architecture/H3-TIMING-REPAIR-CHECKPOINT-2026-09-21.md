# H3 timing repair checkpoint — before paid comparison

Follow-up to [the measured audio audit](H3-AUDIO-TIMING-AUDIT-2026-09-21.md).
The user asked to fix the issues. This checkpoint records a **partial repair**,
not a claim that repeated voices or within-film timing are solved.

## Implemented

- Production client now waits for `configured` with version 1 before issuing
  successor prompts. A script `prompt_applied` receipt can precede configuration;
  it no longer authorizes sending another update. Resolution/duration checks
  must also succeed. The controlled speech probe uses the same acknowledgement
  predicate and waits as well.
- Demo supports explicit `ARGOS_H3_MEMORY=1..50`, validated at launch and server
  creation, propagated to the exact logged/sent configure. The default remains
  12 pending comparative video evidence. This does not change NPC models or
  memory, and cannot mutate an existing H3 session.
- Server builds one authoritative configure object for both the client response
  and outgoing-prompt verification, avoiding two constructions drifting apart.
- UI labels say **planned scene timing / H3 acting may differ**, and the
  composition labels the source map as planned, acting unverified. Thought and
  phone chronology still use the immutable source map; no guessed 5-second
  offset, invented depiction receipt, or retroactive time stretching was added.
- Added a controlled memory-depth replay from saved public outgoing messages.
  Two arms preserve the same first six 10-second native-append packets, premise,
  resolution and pair seed. Only memory differs (12 vs 1). One 60-second run
  per arm, 120-second wall cap, two session allocations, no retries or live NPCs.
  Neither audio generation nor external transcription is introduced.
- Replay input rejects unsupported fields, audio/image URLs, noncontiguous
  versions, unexpected offsets and incompatible durations. The existing
  authentication, single-successor queue and recording guards remain.

## Frozen proposed comparison

Source: `recordings/sitcom-live-SS9UYk/h3-outgoing.jsonl`.
Dry preflight: `recordings/sitcom-live-SS9UYk/memory-comparison-preflight.json`.
It preserves the six original public prompt strings byte-for-byte. The original
run had no seed; both new arms use the same fixed seed, so neither is claimed
pixel-identical to the original video. The pair still differs only in memory.

After explicit spending approval:

```sh
npx tsx src/rendering/h3-speech-probe.ts --memory-comparison=recordings/sitcom-live-SS9UYk/h3-outgoing.jsonl
```

This serves a private local page with one button per arm; launching the server
does not start a Fal session. The browser starts each paid arm explicitly.
Use local ASR to score repeated words and their boundaries in both recordings,
and preserve failures. A single successful arm is exploratory, not proof of
reliability. Do not automatically switch the production default on that alone.

## Deliberately not changed

- The measured examples repeat **complete, once-supplied** sentences. Their
  defect cannot be explained solely by fragmented source sentences.
- Fixed-window word slicing remains an acknowledged problem. Whole-line
  lookahead must not leak a not-yet-delivered suffix, conceal an interruption,
  move dialogue into another room, create a speech backlog, or stretch world
  time. No speculative redesign of that contract was slipped into this pass.
- Native 150-wpm speech timing and cognition remain unchanged. Four selected
  render examples do not justify accelerating all NPC speech or rescheduling
  their perceptions/actions.
- No paid generation launched in this checkpoint; an asynchronous request for
  the two-minute comparison's roughly $10 budget was sent and is unanswered.
- No running GUI server was restarted, so its already-built browser bundle is
  unchanged. These UI/client changes apply on the next server launch.
- No commit/staging performed in the inherited large dirty worktree.

## Verification

- 137 tests across nine renderer/demo suites pass, including server configure
  logging, history validation, setup-ack identity, saved-replay invariants,
  sentence/word-evidence preservation, direct directions and native intervals.
- TypeScript `--noEmit` passes.
- Saved first-minute replay preflight succeeds without calls to Fal or NPCs.
- Another 41 tests across four playback/drain/recording suites pass: **178 tests
  across 13 suites total**. The probe browser bundle builds; both edited browser
  modules pass syntax checks. Whitespace validation passes.

Logs: `/tmp/argos-h3-repair-regression-2026-09-21.log`,
`/tmp/argos-h3-repair-types-final-2026-09-21.log`,
`/tmp/argos-h3-repair-playback-2026-09-21.log`,
`/tmp/argos-h3-memory-probe-build-2026-09-21.log`.

Remaining gates: actually reduce cross-boundary repetition, measure audiovisual
onset adherence, and solve whole-utterance projection without weakening source
authority/privacy/time correctness. Broader cognition baseline/endurance gates
are unaffected and remain open.

## Authorized comparison completed

The user subsequently approved the pair. Both one-minute arms completed;
evidence is `recordings/h3-speech-probe-Qej9s4/REVIEW.md`. Fal confirmed the
requested memory values, and actual sent payloads differed only in memory.
Both arms repeat the same complete Jerry line twice inside 30–40s; both also
repeat opening speech. Two blind local ASR models corroborate those repeats.
Memory 1 is **not** promoted as a fix; the default remains 12. The result also
establishes within-chunk repetition, not only a cross-boundary problem.
No additional runs, external uploads, or production cognition changes followed.

## Subsequent authorized speech-density pair

The user then authorized sparse versus fuller dialogue in ten-second chunks.
See `recordings/h3-speech-probe-dnnI6W/REVIEW.md`. Both sixty-second recordings
completed without retries. Same actor/camera/seed/memory/settings, six preloaded
beats, only quoted text changed; no live cognition or clock changes.

Sparse delivered all six lines, repeating the fifth. Fuller delivered its first
five 25-word passages in approximately 8–9s spans, but omitted the first sentence
of its sixth passage and repeated the second. Two blind local ASRs corroborate
the pattern. Fuller dialogue improves pacing in this sample but **does not pass
dialogue-fidelity gates**. No production change follows from this pair; do not
slow world time or pad characters' dialogue to disguise renderer failures.

Ten fixture regression tests and typecheck pass. The repeated/missing speech,
whole-utterance projection and broader baseline/endurance gates remain open.
