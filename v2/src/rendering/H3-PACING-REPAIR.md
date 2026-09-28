# H3 pacing repair — September 11, 2026

Status: packing implemented; native append implemented behind an explicit gate.
At the initial repair checkpoint no new paid H3 session had been run. The
subsequent requested test `recordings/sitcom-live-rIUQMi` stopped on the second
chunk: its active script2 retained premise prompt1, contrary to our equality
guard. The adapter now uses the issued `script_version` in script mode and keeps
raw premise/script identities in telemetry. Native playback was10s per chunk;
the follow-up now budgets both native opening and continuation at10s before
issuing any source map. This is captured transport calibration, still awaiting
another live H3 check. See that run's `REVIEW.md`; the phone and
pacing gates did not pass. No automatic paid retry followed.

Existing recordings and failed
evidence are unchanged. The existing receiver process still has its previously
loaded code; restart into a new episode before testing these changes.

## Two independent causes

The three-minute `recordings/sitcom-live-l3KteW` run allocated 60.135s to ending
holds in versions 1–20, which intersect the recorded movie. That is scheduled
time, not a measurement of actual silence. Some holds contain idle source time
compressed out of earlier positions. Fixed 8.5s continuations also create real
padding when a whole line is much shorter than a chunk.

The old selector stopped examining clause candidates as soon as any whole-turn
candidate fit. A short line could therefore buy a whole chunk even when the
next delivered clause could safely use its remaining capacity.

Separately, v5 was represented twice, costing another 8.5s. The browser sent v6
only 26ms after the first v5 chunk arrived; this was not chiefly a slow polling
timer. The provider admitted v6 too late for the next chunk. Cutting local
compilation time alone is not evidence that this missed handoff is fixed.

## Packing change (enabled in performance scheduling)

Evaluate whole and existing safe-clause candidates. Prefer the best complete
turn unless a candidate extends it and reduces ending hold by at least 1000ms.
Preserve the 2.5 words/sec budget plus articulation allowance, 500ms minimum
ending safety margin, indivisible essential actions, notification cadence,
public-only projection, immutable source maps and exact word-evidence coverage.
No utterance is declared finished just because an editorial clause ends.

The saved dialogue/state portion at source32–164s contains no timed non-speech
actions or phone sounds. Its original whole-turn cuts can be reproduced exactly
using saved word timestamps and the existing 20s candidate horizon:

| Same 219 committed words and state deltas | Old policy | New packing |
| --- | ---: | ---: |
| Windows | 18 | 15 |
| Scheduled media | 153s | 127.5s |
| Ending holds | 52.080s | 26.260s |
| Packets using explicit speech slices | 0 | 9 |

This saves 25.5s of media, rather than merely relabeling silence. The replay
asserts every word sequence is covered once. Its source horizon is already
recorded; it does not establish how much future evidence will be available at
each request in a new live session. It also excludes earlier phone/movement
coverage, and includes two versions beyond the end of the recorded video.
Do not substitute these figures for a full-movie before/after measurement.

Reproduce: `npx tsx recordings/sitcom-live-l3KteW/compare-packing.ts`.
The production-director regression also recreates the recorded v5–v7 dialogue
at its source times: three original chunks become two, with all words preserved
and unchanged per-line performance budgets. This is not an autonomous cognition
trial and not proof that H3 will articulate the new clause seams correctly.

## Native append handoff (opt-in)

The [Fal Director API](https://fal.ai/models/minimax/h3-max/director/api), checked
September 11, distinguishes replacing a prompt from appending a script. An
appended script starts after the running script's last text beat is represented
and its audio tails finish. An admission acknowledgement is not playback proof.

`ARGOS_H3_SCRIPT_QUEUE=1` enables this adapter in `src/run-sitcom-demo.ts`:

- Configure a premise plus one script beat at offset0 containing the already
  compiled opening. Subsequent packets are single offset0 scripts with
  `script_mode: "append"`, never prompt replacements.
- A typed script admission may reserve one successor. At most two versions
  remain unrepresented. No future/private world state is consulted.
- `/next` keeps `admittedVersion` separate from `settledVersion`. Only chunk
  metadata settles transport; only actual playback releases performance debt
  or selects the thought/phone UI. Admission alone does neither.
- Keep the existing 28s performance/30s source-lead bounds. The oldest pending
  packet keeps its own 45s timeout even when a successor is queued.
- Source exhaustion waits for the final issued version to be represented before
  sending stop. Rejection, unsupported scripts, identity disagreement or existing
  short/skipped-chunk failures stop and save; no fallback may replace or skip an
  uncertain packet. A provider repeat remains a held source interval, not a
  replay of its words in the source timeline.
- Persist script identity/origin/offset/queue, generation time and scheduling
  lead telemetry for the next contract test. Saved renderer status records the
  selected handoff mode.

No unsupported duration field, model switch, invented filler, speculative
action, native TTS or second story controller was added. `H3_MEDIA_TIMING` keeps
the legacy10.125s/8.5s profile separate from the observed native10s/10s profile.
Opening compilation, continuations, and admission accounting use that choice.
Three unplayed native packets would exceed28s and therefore buffer; no threshold
was relaxed. Native chunks differing by more than250ms from this calibration
stop/save instead of silently adding a long hold or stretching issued maps.
Raw timing evidence is recorded before validation. Actual short coverage remains
a failure, not an invitation to re-time the map.

## Verification and remaining gate

Follow-up calibration/provenance pass:360 tests across33 suites passed (rendering,
demo, sensory and cognitive-boundary regressions), and typecheck passed after
correcting a test-only character-union typing error. New tests cover native10s
opening/continuation maps, unchanged28s debt backpressure, legacy timing, rejected
duration drift, real/absent/older sound samples and notification privacy.

One bounded60s **cognition-only** check followed, with world maintenance off:
`recordings/sitcom-neutral-boyfriend-kzDXyq/REVIEW.md`. Both messages were read
and replied to; no pre-delivery buzz claim was found in the recorded behavior.
Its offline legacy director nevertheless failed on simultaneous Jerry coffee
pour/Elaine phone read coverage. Preserve that failed gate and repair the exact
overlap offline before the next H3 contract run described below. No paid retry
occurred. The saved rIUQMi run remains unchanged.

Rendering/demo regressions: 293 tests across 32 suites passed, including the
existing ten-minute jitter/duplicate virtual-provider test. The final regression
rerun and typecheck both passed after the diagnostic edits. The initial new
server test failed because it requested an uncommitted third source window;
the server correctly buffered. The fixture now advances source time explicitly.
No production timing threshold was loosened to make it pass.

Next: one bounded 60–90s focused H3 run with native append enabled, one operator
text, both raw/composed recording and full logs. Verify (1) script/chunk identity
and duration, (2) no skipped words or repeated lines at clause seams, (3) no
unintended repeat window, (4) phone read/typing/reply and thoughts still follow
actual playback, and (5) measured holds and source lead. Preserve a failed run
and keep append gated if any contract fails. Do not call the repeated-chunk bug
resolved from mock-provider tests alone. A slow provider may still miss a
deadline even with early queuing.

This does not reopen world generation or cognition changes, and does not replace
the ten-trial cognition baseline or the ten-minute **live** endurance gate.
