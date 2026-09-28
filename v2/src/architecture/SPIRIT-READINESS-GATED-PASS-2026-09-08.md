# Spirit readiness: bounded offline checkpoint

Started 2026-09-08 (2026-09-09 04:16 UTC). This is a deliberately gated test pass,
not an open-ended goal or authorization for a live simulation.

## Bounds agreed before execution

- Offline only: zero live provider requests, coding jobs, H3, servers or episodes.
- At most 25 minutes of this work session; one selected regression/gate run,
  one typecheck. No repeat-until-green, production repair or model change.
- Add at most three diagnostic gate suites / eighteen cases, concentrating on
  the weakest confirmed coverage. Reuse existing boundary/outcome regressions.
- Keep proposed readiness assertions separate from the default regression suite
  (`*.gate.ts`). Their failures are real HOLD results, not expected-failure passes.
- Preserve raw failures, counts and logs. A blocked network attempt or process
  timeout fails the checkpoint; no live fallback or automatic continuation.
- Stop and report results. A small repair pass and any live budget require a new
  user decision. The prior ten-trial cognition and ten-minute endurance evidence
  remains unchanged; this is not a replacement or a hierarchy endurance pass.

## Checkpoint before additions

HEAD: fe67f548bdbf2fa6ef9560ec660253b7b3c6ec52, branch main. Git status initially
711 entries. Existing dirty work and prior evidence belong to the user and remain
untouched. No active product goal. The previous cognition consolidation is complete.
The runner will capture tracked diff/status and hashes before tests, and compare
production source hashes afterward. New files are tests, tooling and this report.

## Evidence map and declared gate cases

| Role | Reused coverage in this checkpoint | New gate / remaining uncertainty |
| --- | --- | --- |
| Narrator | Grounded snapshots, optional nudges, private delivery, stale-cycle rejection, quiet-work tolerance | Model judgment and pacing still require live evidence |
| Arbiter | Shared spirit freshness and reporting | Existing ordinary prop recognized; removed prop rejected; another world's prop absent; absent target is not auto-construction authority |
| Watcher | Policy observations/cooldowns | Fresh empty world abstains; successful repetitive work is not a blockage; current gap reaches Weaver; another world's actor activity does not become a report |
| Crafter | Failure evidence, deliberate removal, source scope, no refill | Live authored response quality remains open |
| Steward | Explicit population, room scope, empty transit abstention, admission budgets | Useful inhabited venue behavior remains open |
| Weaver | Proposal admission, real native construction, purpose/beneficiary/data checks | Real-model useful growth remains open |
| Tinker | Actual fast-loop failure reaches tools; native failures not silently replaced; coordinator error handling | Real fault/repair/recovery gate remains open |
| Lawgiver | Coordinator stubs are not semantic evidence | Native matching/nonmatching effect; idle abstention; malformed response; unsupported effect; mixed invalid effects; duplicate rule name; private cognition write declaration; stale source while inference is pending |

These 16 cases are declared before execution. Scripted provider responses exercise
real admissions/executors; they do not count as successful model decisions.

## Later gates — proposal only, NOT authorized or launched

1. Fix only concrete failed offline boundaries in a separately bounded pass.
   Preserve the initial failure report; rerun the same assertions without weakening.
2. After offline safety passes, propose at most six live specialist probes with a
   shared request/time/job budget and a positive plus abstention/control case.
   Stop on safety failure; no replacement attempts to inflate success.
3. Only after explicit review, one short integrated growth episode: observed need
   -> useful construction -> actual NPC use -> health/feedback. No H3.

Do not interpret a stub, registered spirit, generated description, active system,
or completed test process as proof that a useful world grew.

## Results — HOLD, checkpoint finished and stopped

One invocation: `node src/evals/spirit-readiness-offline.cjs`.
Artifacts: `recordings/spirit-readiness-offline-iaEEyh/` (raw logs, Jest JSON,
protocol, source hashes, pre-test tracked diff/status, exits and verdict).

- 24 suites: 21 existing suites PASS; 3 new gate suites FAIL.
- 409 tests: 401 PASS / 8 FAIL. Existing regressions account for393 passes;
  new readiness cases account for8 passes /7 engine-boundary failures /1 fixture
  failure. No skip, automatic retry or repaired-source run.
- Tests13.186s; normal project typecheck8.273s, exit0. The project's normal
  tsconfig excludes spirit tests; this is not static typechecking of the new gates.
- No timeout, no blocked/attempted network use. All provider output in the new
  admission probes was scripted. No live-model quality credit.
- Source hashes matched before/after tests. Test PID95138 and typecheck PID95229
  independently confirmed gone. No engine/prompt/controller/model modification.

| Gate | Result | Evidence / interpretation |
| --- | --- | --- |
| A1 | FAIL | Existing native ordinary prop returned null from entityExistsByName. Lookup checks Agent/Room/StimulusSource, omitting ordinary named physical objects. |
| A2 | PASS | Removed prop stays absent after inspection. |
| A3 | PASS | Another world's prop is not returned by lookup. |
| A4 | FAIL | Missing target becomes autoFixable:true with a create-entity recommendation. This is misleading advice, not proof a builder actually obeyed it. |
| W1 | PASS | No evidence produces no work request in the fresh fixture. |
| W2 | INVALID FIXTURE | Test omitted required roomId on publishCommittedEvent; native input validation correctly rejected it before the desired assertion. This is NOT evidence that successful repetitive work was misclassified. Preserve this result; correct the fixture in the next pass. |
| W3 | PASS | Explicit gap becomes a message in Weaver's inbox; no policy inference. This tests forwarding, not autonomous discovery or usefulness. |
| W4 | FAIL | Recording actor activity in world A leads to a stuck-behavior report delivered to world B's Weaver. Shared activity state is not filtered by world. |
| L1 | PASS | Generated/approved add-trait rule changes the matching native object on a tick, not its nonmatching control. |
| L2 | PASS | Idle Lawgiver issues no inference or rule. |
| L3 | PASS | Malformed author response does not activate and retains request. |
| L4 | PASS | Unsupported-only effect rejected, proposal retained. |
| L5 | FAIL | Mixed supported/unsupported effects are silently reduced and the changed rule approved. |
| L6 | FAIL | An existing rule name does not prevent generated approval; defineRule replaces the existing map entry. |
| L7 | FAIL | A rule declaring a private Mind.arousal write is admitted. This tests admission ONLY; it does not demonstrate a successful private-field write or data exfiltration. |
| L8 | FAIL | After stopping the world during pending inference, runLawgiverCycle still approves one rule. Source stop is not checked by this older path. |

These are real implementation differences, not merely different prompt wording.
The managed builder path already has stronger boundaries than this legacy
Lawgiver path; its validation cannot be assumed to apply to every rule writer.
Arbiter helpers are called by native action-failure sites. Its generic model
prompt has a persistence reminder, but that does not correct false helper reports.

## Exact next steps, not performed

1. Lawgiver-only repair checkpoint: validate complete rules atomically; deny
   private/protected write coordinates; refuse unowned replacement; bind pending
   work to a current world/source and cancellation. Reuse existing authority/schema
   helpers where possible. Keep failed requests/proposals as evidence. Do not
   introduce a new rules engine or silently grant cross-world rule authority.
2. Separate Arbiter checkpoint: world-local canonical named-entity lookup plus
   evidence-only missing-target recommendations. Do not auto-materialize repairs.
3. Separate Watcher checkpoint: world/source-owned activity and report inputs,
   then correct W2 by carrying the fixture room into its committed receipts and
   test successful repetition against actual failures. Do not infer stuckness
   from a novelty quota or invent a new actor controller.
4. Rerun these SAME gates after authorized fixes, preserving this directory.
   Only then consider the live probes described above, with explicit budgets.

Stop condition reached: bounded offline evidence acquired, safety gates HOLD.
No scheduled continuation, live run or automatic repair. Prior ten-trial baseline
and ten-minute cognition endurance remain unchanged and do not become spirit
acceptance by association.
