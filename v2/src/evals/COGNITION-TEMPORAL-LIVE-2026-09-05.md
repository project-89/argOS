# Temporal execution and bounded live cognition — 5 September 2026

This is a new, explicitly requested pass after the completed twelve-trial
overnight campaign. Two live escape trials were authorized for this pass, each
with a 300-second wall-time cap. The paused overnight automation was not resumed.
No H3/FAL generation was requested or run.

## What changed

- One shared deadline scheduler orders physical work, word delivery and public
  scene captures within an outer simulation tick. Body and voice are independent
  resources. Work completion is not inferred from an expected deadline.
- Speech is heard progressively. Partial hearing is attributed and cannot stand
  in for a complete-turn receipt. Coherent batches wake cognition; public word
  events do not expose an unspoken suffix. Only a terminal utterance event closes
  the full speech interval.
- Native atomic actions and escape-room reading, handling, transfers and controls
  have finite durations. Actual completion revalidates identities and current
  physical preconditions and retains original plan/goal/evidence attribution.
- Failure pacing is scoped to a world and actor, correcting cross-world
  contamination found by the new native-action regression tests.
- Goal and memory ages have separate lived-time metadata; provider budgets and
  source/evidence identities keep their original clock domains. Save/reload
  cannot age a world by time spent offline or replay pending physical callbacks.
- A headless library adapter records public committed intervals and builds H3
  configure envelopes. Provider version/duration metadata maps playback to that
  exact source history. Missing history or incompatible mapping is explicit.

## Live trials

Both trials use the production shared cognition, planning and physical executor,
with `gemini-3.8-flash`, finite speech and finite actions. They are not scripted
physical-oracle runs. Each requests an actual power interruption during an
already-running final unlock. Evidence is the real interrupted operation plus
later successful retry, not a previously reached milestone.
The puzzle laws were fixed authored systems; autonomous world evolution and H3
were disabled to isolate cognition. These trials do not validate continuous
god/spirit-driven code generation or open-ended social life.

### Flooded Relay, seed 60793

- Passed all evaluation gates: all three actors outside at **124,000 simulated
  milliseconds**, zero invariant violations, and a real interrupted-unlock
  recovery. Physical trace reconstruction confirms the changed relay dependency
  graph, exclusive power routing and continuous helper support.
- 54 committed thoughts, nine completed utterances, 46 successful physical
  actions; one failed physical operation, the deliberately interrupted unlock.
- 151 completed foreground operations: **922ms median**, **2,653ms p95**,
  **7,075ms maximum** wall duration. These include deterministic/no-op/discarded
  decisions as well as model-powered decisions; they are not pure model latency
  or video latency. First committed thought: **2,000ms simulation time**.
- Zero exact same-speaker duplicate utterances and zero lexical speech-repeat
  candidates in the existing heuristic detector. This does not establish
  semantic truth or natural conversation.
- Artifacts: `recordings/escape-room-1JRHYw`.
- Checkout source/test hash at process launch:
  `b5c9231d525a9789060187aedb7a768b5e1632a3c00738e5516ddf23b341a454`.

### Drowned Observatory, seed 80471

- Passed all evaluation gates: all three actors physically outside at **195,500
  simulated milliseconds**, zero invariant violations, and real recovery after
  power failed during the active final unlock.
- 88 committed thoughts, 21 completed utterances, 59 successful physical actions
  and two failed physical operations.
- 190 completed foreground operations: **1,044ms median**, **3,212ms p95**,
  **8,011ms maximum** wall duration, using the same mixed-operation measurement
  as the relay trial. First committed thought: **2,000ms simulation time**.
- Zero exact same-speaker duplicates; three lexical speech-repeat candidates
  (14.3% of utterances). That distinction matters: absence of exact looping is
  not proof of natural or consistently up-to-date conversation.
- Artifacts: `recordings/escape-room-npwWJq`.
- Checkout source/test hash at process launch:
  `8149075cec1ff2fc7d9a8b9e4128641d9d19f474bb7027ae8859f58046d83d4e`.

The cognition/speech/timeline implementation was held fixed during the pair;
independent test and legacy-module work continued in the checkout. Launch hashes
identify checkout state, not a claim that every file stayed frozen afterward.

## Quality findings, not hidden by a passing escape score

- Initial parallel long utterances still repeat the same situation across
  different speakers. This is not an exact same-speaker loop, but conversational
  turn-taking and brevity are not yet convincingly natural.
- A sentence already being spoken can become stale as the world changes. In the
  live pair, a claim about the powered keypad continued across the actual power
  cut. The engine did not make the claim true; power remained physically off
  until restored. Mid-utterance self-correction remains a cognition capability
  to evaluate, not something the video renderer should invent.
- Generic public “operating” descriptions can cause another character to confuse
  installing a part with already running the mechanism. Actual current work
  needs an explicit safe public label; private intentions and command arguments
  must not be exposed to solve this.

After the live pair, a closed public operation vocabulary was connected to native
body reservations and escape capabilities (for example, installing versus
pumping). Native grid boundaries were also merged with the speech timeline, and
adversarial review added replacement-plan, renamed-target and inactive-worker
safety checks. These final changes have offline verification only; no third live
trial was run and no improvement in conversational quality is inferred from them.

## Offline verification

- Full offline suite: **191/191 suites passed; 2,268 tests passed, 10 existing
  opt-in tests skipped** (`npm test -- --runInBand --silent`, 94.738 seconds).
- `npm run typecheck` passed; `git diff --check` clean.
- The 637 TypeScript source/test files were unchanged throughout that final run.
  Sorted path/content SHA-256:
  `089e9b030bed418f4e6e6fb511788d833c7380145716e3253c8d8dcba56daa59`.
- Final review regressions cover in-place replacement plan/goal episodes,
  renamed same-label physical targets, inactive workers/helpers, native public
  operation visibility, exact grid/speech boundaries, partial hearing and
  committed-renderer retention, identity, stop and playback mapping.
- The preceding full run found only two stale generic-operation label assertions;
  those expectations were updated to the specific public operations. Physical
  admission, deadline, privacy and failure assertions were retained.

Logs: `/tmp/argos-final-verified-suite.log`,
`/tmp/argos-final-verified-typecheck.log`,
`/tmp/argos-final-complete-pressure.log`.

Independent pressure suite passed **8/8** again on the final production source:
three coupled-physics seeds with 128 entities × 200 ticks (614,400 field assertions), intervention/removal safety,
mutation-budget isolation, rejection of wrong physical laws, 600 competing
inventory attempts by twelve NPCs, and coding-worker timeout/recovery storms.
Artifacts: `stress-test-output/pressure-2026-09-05T19-22-45-593Z/results.json`.

The native contention oracle now advances the actual pickup/drop intervals and
explicitly rejects possession changing at intention time. Existing invariants
were not weakened to accommodate delays.

The headless renderer adapter is tested offline. It is not yet the phone UI's
active transport, and no new Argos-to-displayed-H3 latency is claimed here.
See [the interval adapter contract](../rendering/committed-intervals.md) and
[the bounded legacy migration audit](../architecture/LEGACY-TEMPORAL-MIGRATION.md).
