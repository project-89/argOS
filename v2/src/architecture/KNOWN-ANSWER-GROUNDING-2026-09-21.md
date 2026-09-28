# Known-answer grounding: bounded follow-up

Follow-up to [unsupported cue and repeatability checks](UNSUPPORTED-CUE-AND-REPEATS-2026-09-21.md).

## Evidence and scope

The two unchanged action-choice repeats completed both phone exchanges, but
their verification questions were not fully grounded. `uxJGKO` asked George's
shirt color when appearance specified a plaid pattern, not its color. `V7PdVt`
asked about breakfast without an identified pre-existing breakfast event or
memory, then Jerry later claimed a particular cereal. That later speech proves
he made the claim, not that he previously ate it. Unknown answers can be valid
open questions; they are not yet known-answer verification tests.

Physical working memory already separates observations from action receipts.
Social and narrative memory retain attributed dialogue and source times. The
gap is not a missing universal memory system: some legacy projections flatten
memory types into “past experiences,” and extracted belief source names do not
explicitly distinguish speech from verification. Foreground instructions also
lacked a concise distinction between an open question and a known-answer test.

## Changes

- Foreground: unspecified details remain unknown. A known-answer test needs an
  answer already supported by observations or supplied memories; open questions
  and inspection remain available. A new self-authored claim cannot establish
  an earlier event.
- Legacy recall: label recollections/interpretations and retain episodic versus
  semantic type. Belief confidence describes conviction, not verification.
- Interaction extraction: apply claim attribution to the character's own
  speech as well as other people's. New speech-derived beliefs deterministically
  retain `speaker (spoken claim)` as their source even if model confidence is 1.
  Existing beliefs are not rewritten or retrospectively assigned provenance.

No schema, model, action priority, controller, execution authority or scenario
answer changes. No compulsory reply, fabricated wardrobe/breakfast, semantic
speech censor or new world-generation mechanism. Characters can still hold
false beliefs, speculate, and ask questions they cannot yet verify.

## Offline validation

- 197 tests passed across eight suites: memory prompt grounding, interaction
  context, working-memory consumers, narrative mind, narrative recall groups,
  foreground planner decisions, activity review, and Project 89.
- Typecheck and scoped whitespace/diff check passed.
- A second boundary group passed 101 tests across six suites (physical working
  memory, observation, recall limits/private retrieval, perception admission,
  perception boundaries, communication memory): 298 tests across 14 suites in
  total. `/tmp/argos-known-answer-boundaries-rerun-2026-09-21.log`.
- Its first attempt had two assertion failures because recall-count tests
  matched the old `[remembered ...]` label. Updated their match to include the
  new explicit memory type; retained the same expected counts, privacy checks
  and no-strengthening assertions. Preserved
  `/tmp/argos-known-answer-boundaries-2026-09-21.log`. No production edits
  during the live trial.
- Regression log: `/tmp/argos-known-answer-regression-2026-09-21.log`.
- Typecheck log: `/tmp/argos-known-answer-types-2026-09-21.log`.
- Initial focused run: 40 passed, one new fixture failed because it asked for
  narrative evidence while its mocked response contained only a belief. Fixed
  the fixture to return an attributed memory too; no production change for this
  failure. Preserved `/tmp/argos-known-answer-unit-2026-09-21.log`.

These establish prompt/projection delivery and deterministic attribution, not
that the language model will always choose grounded questions. A bounded live
check is recorded separately below; do not pool it with earlier prompt variants.

## Live check

One 180-second trial, unchanged formative-history scenario, high background
reasoning, conditional two-message protocol, delayed visitor request, no H3.
Console: `/tmp/argos-known-answer-live-2026-09-21.log`.
`recordings/project89-gate-2EIl1y`: completed at 180s, exit 0, not interrupted,
no run-level failure. Result, world and runtime log are mode 0600.

| Event | Simulation time |
| --- | --- |
| First text delivered / read | 26.2s / 29.2s |
| First reply delivered | 85.425s |
| Follow-up delivered / read | 85.7s / 89.7s |
| Second reply delivered | 104.465s |

First reply: “It says Project 89 — Who is watching? with a rabbit. Who is this?”
Second: “All right, if you're outside our world, tell me what George is wearing
right now.” Follow-up read-to-delivery was 14.765s; first read-to-delivery was
56.225s. Do not claim an overall speed improvement from this sample.

The question is checkable against local appearance, but the run **fails sustained
grounding**. At 117s Jerry thinks George wears a brown suede jacket; at 156s he
repeats it. George's ECS appearance remains “plaid shirt, tan trousers, glasses,”
and actual appearance perceptions supplied it to Jerry at 58s and 131s. A fresh
accurate cue therefore did not prevent the repeated invented interpretation.
At 11.5s Jerry also thought “A phantom buzz” after finding no notifications,
before the real text. This is an imagined/phantom explanation, not a native buzz
receipt; no early incoming content was revealed. Preserve it as unsupported
reasoning rather than claiming the opening-cue issue disappeared.

Other outcomes, not suppressed:

- George had seven `control.activityReview.unissued_evidence` rejections at
  38, 43, 46, 49, 52.5, 56.5 and 59.5s. Jerry had one timeout at 54.5s.
  The early rejected response bodies are outside the final ten-pair conversation
  window; the saved diagnostics establish rejection type/times, not the exact
  invalid IDs. Do not guess which IDs he cited or relax their authority checks.
- 292 control-loop diagnostics, zero dropped. Jerry foreground p50/p95
  1.452/2.926s; George 1.975/3.104s.
- Narrator reviewed the visitor request at 140s; Morpheus proposal issued at
  161.5s and remained pending, not built. Three expired God reviews before stop.
- Both native phone exchanges completed; no third incoming message was sent.
  Waiting for an answer to the second reply is not itself a failure.

## Post-trial source-projection repair (offline only)

Inspection found the current-local-view block omitted clothing altogether. Its
saved 156s input lists George's expression and held card, but no wardrobe. The
full dynamic system context is not persisted with these user turns, so this
does not prove clothing was absent from every part of that request. Appearance
notices and historical thoughts are separate paths. The omission from current
local evidence is nevertheless concrete and unnecessary.

Added only current clothing to that existing local evidence projection, using
the same read-only physical appearance helper as the appearance emitter. Only
actually visually observable people are queried. Clothing includes configured
baseline dress and actually worn garments, not pocket contents. Empty dress
stays unspecified. This is existing ECS data, not generated narrative detail.

Clothing participates in existing whole-view and selected-entity freshness
checks, reported as public-fields changes. Presence-only dependencies stay valid
when someone changes clothes. Tests cover detached snapshots, source changes,
blind/remote/unspecified cases, carried versus worn garments, and hidden
possessions. 57 local-view/appearance tests passed. This repair occurred after
the single live run and has **not** been live-validated. No second run launched.

Final combined regression after the projection repair: **355 tests passed in
16 suites**, 11.601s. Final typecheck and scoped diff check passed.
Logs: `/tmp/argos-known-answer-final-regression-2026-09-21.log` and
`/tmp/argos-known-answer-final-types-2026-09-21.log`.

The legacy MUD/LIL conversation callers without explicit perspective/receipt
remain an attribution follow-up; this pass does not guess their speaker or
rewrite saved memories. Native production speech carries explicit perspective.

## Exact next checks

1. One unchanged bounded trial of the current clothing projection; inspect
   both the question and subsequent expected-answer reasoning. Check no
   invented notification cues, no privacy leakage, and both native replies.
2. Reproduce the repeated unissued-evidence rejection with retained issued
   review IDs and the rejected model field, then fix any projection/recovery
   mismatch without accepting unissued evidence or forcing action choice.
3. Only if grounding still fails with the supplied current facts, trace how
   historical self-authored interpretations compete with those facts. Avoid
   another prompt blanket or scenario-specific rejection as the first response.

The ten-trial baseline, ten-minute endurance and combined visitor interaction
requirements remain open. Prior failures and all earlier artifacts remain intact.
