# Bounded live performance scheduling

Implemented September 6, 2026. This is a text/timing contract, not evidence that
H3 obeyed it. H3 remains disabled while behavioral validation continues.

September 11 follow-up: [shot-local direction](SHOT-LOCAL-DIRECTION.md) binds
the existing performance to explicit cast/speaker/camera intervals without
changing its clock or claiming audiovisual provider validation.

Later September 11: the recorded `sitcom-live-l3KteW` H3 run exposed excessive
ending holds and a repeated chunk. [Packing and queued handoff](H3-PACING-REPAIR.md)
documents the bounded repair, measured replay improvement, and the still-gated
native script-append adapter. The disabled-H3 statement above records the
September 6 checkpoint, not the current existence of recorded live evidence.

## Four clocks, one causal boundary

Wall time owns network timeouts and provider cost. Simulation time owns physical
actions and knowledge acquisition. Performance time is a pre-issued arrangement
of already committed public evidence. Provider/player time selects which issued
performance is being displayed. A text enters the authoritative world now; it
cannot rewrite footage already issued from that world.

`SitcomDirector({ scheduling: "performance" })` evaluates feasible committed
windows by their actual performance budget. The receiver and focused evaluation
opt into this policy. The legacy `source_windows` policy remains available for
historical deterministic fixtures.

## What the scheduler protects

- Exact delivered speech words and their execution/evidence identity; no draft or
  unspoken suffix becomes dialogue.
- Whole pickup/read/typing gestures and their real resulting possession state.
- Phone vibrations have 800ms audible budgets. Repeated onsets retain their
  simulation-time spacing within and across issued packets. Discarded candidate
  compilations do not advance the sound clock.
- Issued prompts and source maps are immutable. A repeated provider version is
  an ending hold, not another iteration of its dialogue.
- A terminal state-only update to an existing unheld prop in an unoccupied room
  can be recorded as `unfilmedTail`, not manufactured into a new full clip.
  This is explicitly unshown state, not proof the fact is unimportant. Object
  appearance/removal/movement, actor changes, held items, sounds and actions are
  not eligible for this exception. All original state remains in the world and
  source journal.

## Speech longer than one chunk

The observed Tr9yXl failure is preserved in a deterministic regression: Elaine's
20-word line at source 95s requires more than the 8.5s continuation allowance.
The complete-turn compiler rejects it rather than racing or omitting words.

When no complete-turn packet fits, performance scheduling can fall back to an
actually delivered sentence/clause boundary. It also evaluates an extending
clause when it saves at least 1000ms of ending hold versus the best complete-turn
packet. It does not split an already feasible turn just to re-time that turn.
Each slice retains execution ID,
first/last word-evidence sequence, whether it starts/resumes the utterance, and
whether it ends at a phrase boundary, real completion, or interruption. A phrase
boundary does not complete the world action. Later prompts quote only their new
words. Phone gestures remain indivisible. If no safe feasible clause exists,
coverage fails explicitly; arbitrary long unpunctuated speech is not silently
truncated. This fallback still requires controlled audiovisual provider tests.

## Backpressure

The production `SitcomLivePacer` limits issued, unplayed performance to 28s. It
requests a source pause at 30s of lead over the mapped audience, resuming below
16s source lead and 14s queued performance. These are configurable policy bounds,
not latency claims. A 250ms host sample can overshoot the source bound by one
sample. The receiver explicitly uses the existing simulation pause/resume API;
it does not modify simulation-time semantics or rewrite old history. It owns
only pauses it requested. Simulation-only sessions never use this pacing.

Authenticated browser receipts supply actual media playhead and bounded deltas
of provider chunk metadata. The server derives source position itself from the
registered performance. Merely applying a prompt does not release it. The UI
labels source pacing. Messages can be queued while paced, but their physical
delivery awaits resumed simulation time.

A materially short first representation of a version fails with
`provider_chunk_shorter_than_performance`; a skipped issued version fails with
`provider_skipped_issued_performance`. The receiver saves and stops instead of
hanging on permanent queue debt or claiming missing dialogue was depicted.
Short repeated ending-hold chunks remain valid. Out-of-order metadata waits for
its contiguous prefix. This conservative adapter needs a controlled H3 contract
test before enabling a user-facing video run.

## Ten-minute virtual-provider evidence

The regression runs the real ApartmentSitcom, committed director, performance
compiler and playback/pacing interfaces, with a synthetic provider that varies
generation latency, sometimes repeats a whole previous version, and consumes
media in real time. It makes no model or provider calls.

Observed deterministic trace:

| Measure | Result |
| --- | ---: |
| Virtual wall duration | 600,000ms |
| Simulation advancement | 574,500ms |
| Issued prompt versions / provider chunks | 57 / 64 |
| Played media | 534.875s |
| Explicit source pacing pause | 25,500ms |
| Peak source lead | 30,180ms |
| Peak queued performance | 25,500ms |
| Covered spoken-word events | 342, exactly once |
| Reported coverage fault | None |

The slight source-bound overshoot is within one host sample. The simulation
slows under renderer pressure rather than building an unbounded future. This
does not prove natural cognition, successful phone reply behavior, H3 audio
intelligibility, or pixel-level thought/video alignment. Those remain separate
evaluation gates.

Regression sources: `src/demo/__tests__/sitcom-live-pacing.test.ts`,
`sitcom-performance.test.ts`, `sitcom-director.test.ts`,
`sitcom-screenplay.test.ts`, `sitcom-server.test.ts`, and `sitcom-client.test.ts`.
