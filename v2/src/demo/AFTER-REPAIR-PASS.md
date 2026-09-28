# After-repair continuity: bounded handoff repair

This pass repairs existing cognition handoffs. It does not introduce a duration/dwell controller, change models, force actors to believe simulation claims, or authorize another endurance run. It is not an acceptance declaration for Argos overall.

## Preserved observation

Original operator session: `recordings/spatial-hsmtHS/session.json`, `world.json`, and `/tmp/argos-extended-ui-final.log`. Do not overwrite these files or discard unsuccessful behavior.

- A real native repair powered the lamp at259.1 simulation seconds. The material repair contract was complete.
- Mara read the final simulation-revelation text at263.5s and replied at268.8s: she challenged the sender's identity. No unread message remained. Skepticism is a permissible character response, not a transport failure.
- Ivo proposed “give it a minute” at271.8s; Mara agreed at279.1s. Many subsequent foreground choices were ordinary waits. Ivo selected a stability report at348.3s and began speaking at349s. The operator stopped at351.5s during that utterance.
- That is roughly70 seconds after Mara's agreement, not an indefinite scheduler freeze. The record still exposes inefficient repeated decision-making and poor transition beyond the repair.
- Ivo's investigation and Mara's check-in concerns remained self-directed custom goals, not the completed physical restoration contract. The unresolved cause must not become false success merely because an inspection or repair plan finished.
- Standing communication with Alex remained active. A standing desire should inform future choices, not permanently occupy the only slot for new finite intentions.

Ordinary `wait` completes immediately. `wait-experience.ts` already projects elapsed simulation time; `world-clock.ts` supplies lived time. This pass leaves those semantics intact. Existing typed waits concern evidence, not a promised one-minute dwell. No claim is made that every original readiness wake was explained: the original session did not retain per-call readiness reasons/provider prompts.

## Keep / change / defer

Keep native ECS goals, goal contracts, foreground action admission, exploratory review, actor-owned next purpose, timed spatial actions, genuine outcome receipts, and actor-private memory. Keep legitimate waiting and uncertainty.

Change only existing handoffs:

1. Standing desires do not suppress ordinary finite agenda formation after completed/deferred work. Existing finite intentions, capacities, cooldowns, quiet-review backoff and in-flight guards still apply.
2. Personal concern review can author an exploratory intention instead of labelling every resulting concern social. It cannot author executable actions, native success proof, or arbitrary completion contracts.
3. Check that a finite exploration reaches review, and a fresh actor decision can retain, defer or release it. Deferral/release are not investigative success. A different selected purpose must be able to reach a real spatial action.
4. Authored drives live in private, owner-bound `AuthoredAspirations` ECS state instead of an unpersisted numeric-ID map. Both ordinary agenda formation and personal review receive them; changing them invalidates older in-flight proposals. Save/reload preserves the stored drives. Legacy saves without that component contain no recoverable drive data and are not given invented autobiographical motivations.

This does not make the underlying singleton component arrays safe for concurrent
worlds with colliding entity IDs. Production worlds retain the existing
process-isolation requirement. Aspiration ownership checks fail closed on such
a collision; they are not a second authoritative copy of character data.

Defer duration/dwell work, new controllers, new cognition mechanisms, scene-generation/model changes, world growth, and H3. The operator café is not autonomous growth.

## Offline integrated regression

`src/demo/__tests__/spatial-after-repair.test.ts` uses a manual/no-network `SpatialDemo` and actual native repair commands. Scripted operator actions are explicitly **fixture setup**, not live autonomous repair evidence. Foreground responses are mocked to test admission and execution, not to claim that a model will choose these decisions.

Cases:

- Real possession, isolation, installation and power-on complete the physical repair; the standing communication desire remains active without suppressing future finite agenda formation.
- An unresolved exploratory goal reaches its native reconsideration boundary and pauses execution. A fresh mocked foreground review can defer or release it without gaining progress or claiming the cause was solved.
- After deferral a different selected purpose can consume the actual available pastry through the native timed executor. Admission alone cannot consume it; the old investigation is not completed.
- A voluntary observation wait remains valid. Elapsed waiting does not award investigation success or invent evidence.

`spatial-after-repair-protocol.test.ts` covers tail flag validation, unchanged default request budget, incompatible intervention rejection, partial-tail accounting, and the absence of automatic behavioral-success assertions.

Focused final result: **17 tests passed across two suites**, with network calls prohibited. Log: `/tmp/argos-after-repair-integration-final.log`. These tests were added after the production repairs were already on disk; they are integrated regression coverage, not independently captured pre-fix failures.

Initial root goal-eligibility checks passed 67 assertions. A broader run was
started while the aspiration API migration was incomplete and failed on old
call signatures; this was an intermediate integration failure, not live behavior
evidence. After call-site migration, 298 core regression tests and 250 adjacent
spatial/history/engineering tests passed, and typecheck passed. Their logs are
`/tmp/argos-after-repair-core-regression-20260925.log`,
`/tmp/argos-after-repair-spatial-regression-20260925.log`, and
`/tmp/argos-after-repair-typecheck-20260925.log`. A final combined gate follows
the final ownership and active-work checks; these intermediate counts must not
be added together with overlapping reruns as separate coverage.

Initial fixture failures remain recorded separately from production regressions in `/tmp/argos-after-repair-integration-first.log` and `/tmp/argos-after-repair-integration-second.log`. Native reconsideration sets a goal to `paused` with a pending review; it does not leave execution active. A closing review refers to that goal in `goalReview` but must not select its paused execution as `control.goalId`. The fixture was corrected to those intended contracts rather than changing production lifecycle behavior. Intermediate source migration also overlapped the first run; only the frozen final result is acceptance evidence for this testbed.

## Single live observation protocol

Use the existing runner with an explicit tail:

```sh
npx tsx src/demo/spatial-blackout-check.ts --live --extended --after-repair-tail=60 --directory=recordings/<new-unique-after-repair-evidence-directory>
```

The directory must not already exist. The runner refuses to overwrite it. Run only after the relevant offline gates and typecheck pass and the parent approves launch.

Final combined offline gate: **664/664 assertions across 27 suites passed**;
typecheck passed. Logs:
`/tmp/argos-after-repair-final-regression-20260925.log` and
`/tmp/argos-after-repair-final-typecheck-20260925.log`.
One live run was then launched with the command above using
`recordings/blackout-after-repair-20260925-01` (unchanged models, extended layout,
60-second tail). The outcome is recorded below once the bounded run settles;
launch is not a success claim.

Hard bounds:

- 180 seconds of simulation time and 180 seconds wall time **for the entire run**, not an extra allowance after the repair.
- 160 HTTP attempts only when the explicit tail option is used. The original checker default remains 100. Each HTTP attempt retains the existing 25-second timeout; stopping cancels outstanding work and allows at most 8 seconds for drain accounting.
- One world/source, unchanged models and priority controller, no growth, no H3, no retries, no evaluator NPC actions, goals or repair injection.
- Tail begins only after a native repair has remained powered for10 simulation seconds. If the repair is late or missing, retain the partial/no-tail result; do not extend any bound.
- `--second-outage` cannot be combined with this mode. A clean after-repair handoff is the observation in scope.
- Tail completion is only an observation boundary. `observedEntireTail` is not `behavioralSuccess`, and it never completes or retires a goal.

Retained artifacts include protocol, provider issue/settlement bodies without credentials, committed events, runtime diagnostics, scene frames, actor-owned goal/continuation/wait projections, the exact tail-start snapshot, final state, native world save and actual episodic memory export. These are private local operator evidence, not public renderer data.

Qualitative review criteria, not an exact script:

1. Repair completion is native and physically supported; no missing part, failed action or dialogue claim counts as completion.
2. After repair, actors may wait or converse. Examine whether finite concerns are reviewed coherently and whether one voluntary non-repair purpose becomes actionable. A character may also give a grounded reason to defer it.
3. No repeated unsupported inspections or stale execution merely because an old goal remains listed. Unresolved questions may persist as paused/retired/retained intentions with honest status.
4. Any next action must commit natively, and its outcome must feed normal cognition/memory. A proposed plan, thought, generated goal or admission alone is not action success.
5. Standing friendship/communication must remain available; choosing another activity must not erase identity or private history.
6. Preserve failures, slow transitions, repeated wait choices, and lack of new purpose as evidence. One acceptable run is neither repeatability nor full realism proof.

## Recorded live outcome — one trial, no retry

Evidence: `recordings/blackout-after-repair-20260925-01/`, with console log
`/tmp/argos-blackout-after-repair-live-20260925-01.log`.

- Stopped at the predeclared tail boundary: 121.6 simulated seconds / 125.473
  wall seconds; full 60.3-second observed tail started at 61.3s.
- 120 provider attempts, 116 successful responses, four failed/aborted attempts,
  zero active HTTP requests after drain. Preserve the request failures in
  `provider.jsonl`: id15 timed out at 4.004s, id72 at 15.039s, id81 at 15.001s,
  id113 was aborted after 7.408s. These are not four successful decisions.
- Ivo installed the actual Amber cartridge and restored power at 50.6s.
  The native repair contract completed and both repair goals closed.
- Voluntary next behavior: Ivo began returning at 58.9s, arrived at 67.1s, and sat
  in the actual chair at 71.6s. Mara began returning at 66.5s, arrived at 71.0s,
  and picked up her actual phone at 77.4s. No message or next NPC action was
  injected by the evaluator.
- Both formed post-repair intentions through the **ordinary aspiration-driven
  agenda lane**, not only the exceptional personal-review path. Personal reviews
  #51/#52 declined new work; ordinary requests #59 (Mara, 1.933s) and #61 (Ivo,
  1.280s) then chose phone/relax and return/relax intentions, admitted at 62.8s
  and 63.8s. This specifically exercises the repaired standing-motivation gate.
  Mara's later phone-read receipt records no unread messages, as expected in
  this no-injected-message protocol.
- The tail then contains repeated rest,
  waiting and affirmations of relaxing. This is evidence of a next-purpose
  transition, not of a diverse continuing day or elimination of repetitive
  conversation. The finite observation cannot establish what they would do
  after a genuinely longer rest.
- The three timeouts were Ivo appraisal (#15), Ivo planning (#72), and Mara
  planning (#81). The fourth failed request (#113) was Mara planning cancelled
  by the declared run boundary, not another timeout. Foreground physical work
  continued while those background tasks were pending.
- Preserve a remaining fidelity issue: only Ivo has a native chair relation.
  Mara examined the green sofa but never actually sat. Ivo's later subjective
  social-goal review described them as "both seated" without native support for
  Mara. It did not award fabricated physical repair proof, but it is still an
  overconfident body-state assertion. The test does not count Mara as seated.
- The tail selected ten ordinary waits (Mara six, Ivo four), predominantly
  listening during actual speech. Roughly seven low-information lines reaffirmed
  relaxing. This is not the original prolonged lamp-watch episode, and the two
  different runs should not be presented as a controlled quantitative comparison.
- Fast-system diagnostics report no failures, average tick time 5.12ms and one
  slow tick. This is one sample, not a comparative performance benchmark.

The original operator-provoked repeated-outage/simulation-claim sequence was
not replayed in this clean-tail trial. Its behavioral outcome is not declared
fixed. No second trial, prompt inflation, new drive mechanism or larger run was
launched to obtain a more entertaining ending.

Fresh interactive UI was prepared separately, still ready/unstarted at handoff:
`recordings/spatial-46MMKk`, server log `/tmp/argos-after-repair-ui-20260925.log`.
The prior `spatial-hsmtHS` world/server and saved evidence were left intact.

## Gates still open

The ten-trial baseline and at least600 wall seconds **and**600 simulation seconds endurance requirements remain OPEN. This pass cannot satisfy them. Retained-memory comparison, need-driven native spatial growth and renderer reintegration retain their existing gates; none is enabled or passed by this repair.
