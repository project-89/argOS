# World development activation checkpoint — 2026-09-27

Latest: [tick cost, queue pressure and Narrator delivery](TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md).
Previous live trial: [Narrator progress and timing checkpoint](NARRATOR-TIMING-CHECKPOINT.md).
One subsequent bounded retry showed Mara reading/replying and investigating,
Ivo beginning to follow through, but only 0.812× world speed under load.
Clock semantics are repaired; autonomous useful growth, narrative quality and
responsive ten-resident throughput are not accepted. Earlier evidence below
is retained as history, not overwritten by the retry.

Follow-up: one five-minute live Saltmere stress observation is recorded in
[`TOWN-CRISIS-RESULTS.md`](TOWN-CRISIS-RESULTS.md). It demonstrated resident
cleanup → memory → Narrator observation and correct duplicate-build rejection,
but did **not** demonstrate a town-wide dramatic response or autonomous growth.
Failed delivery, untraced initial action handoff, repeated investigation,
passive narrative choices and runtime queues remain open. No live retry or
behavioral-gate closure is implied by that observation.

The subsequent [offline crisis repair checkpoint](TOWN-CRISIS-REPAIR.md) records
causal fixes and safety regressions. Narrative progress/useful autonomous growth
still require behavioral evidence; the original ready server was not restarted.

## Scope and implemented changes

The request was to activate broader development in Saltmere and provide a
user-facing conversation with God. This uses the existing God, spirit,
engineering, ECS execution and renderer paths; it does not add another
cognition controller or change models.

- `--develop`: a distinct 30-minute default profile, with explicit finite
  resource budgets. Existing non-development launch modes retain their scope.
- Watcher, Arbiter, Narrator, Weaver and Tinker are configured. God reviews
  proposals and operator requests; the managed coding daemon admits tested
  systems. New buildings/models/native actions remain adapter work.
- Authenticated, source-bound **Ask God** panel: public inspection, native
  weather, catalog placement and managed scalar-mechanic requests. Separate
  request/reply/job/effect status, UUID retry handling and stop cancellation.
- Public, identity-bound `SpatialDevelopmentInput`; composable admitted
  `SpatialDev…` outputs; local visible measurements and spirit outcome receipts.
  Native movement, collision, inventory, messages, thoughts and decisions remain
  under their existing owners.
- No generic phone-ownership goal for residents without an authored phone
  relationship. Existing standing motivations no longer demand automatic plans.
  The UI projects ongoing activity and chosen finite purpose before standing
  motivations. It does not reorder goals or choose actions for residents.

## Evidence preserved

Worktree state and pre-turn source checkpoint:
`/tmp/argos-development-20260927.OsW4cj`.
Existing unrelated edits were not reset or committed.

The first broad spatial regression selection had **725 passing and five failing
tests**. Those five failed assertions expected background goal formation to be
disabled whenever unfinished finite work existed. The isolated pre-turn source
reproduced the same failures: **five failed, 16 passed**, recorded at
`/tmp/argos-predevelopment-baseline.JFi9K0/baseline-tests.log`.
Only stale test expectations were corrected, with explicit active-goal and
zero-progress retention checks. Their subsequent six-suite selection passed
**90/90** (`/tmp/argos-agenda-fixture-correction.NGFdJ2`). No shared goal
generation or goal-lifecycle behavior was changed for that correction.

The subsequent broad spatial regression run passed **756/756 across 38
suites**, including the corrected fixtures, goal projection and numeric value
policy boundary tests. Output is preserved in
`/tmp/argos-development-20260927.OsW4cj/spatial-regressions-final.log`.
The final six-suite God/development/worker integration selection passed
**79/79** (`integration-verified.log` in that directory), and a fresh browser
unit selection passed **110/110** (`client-verified.log`). Typecheck and scoped
whitespace checks passed.

Other focused results before final hardening:

- 232 passed, two existing skips across 12 standing-plan/cognition suites.
- 92 engineering tests across four suites for entity scoping, admitted schema
  history and builder context.
- 181 development/architecture tests across seven suites, including real
  worker execution of two separately admitted, coupled mechanics: moisture
  changes over time and plant growth consumes committed moisture.
- 25 God-console/host-surface tests across two suites.
- 110 browser-client tests. Typecheck passed.

## Final review repairs

- Tinker selection now checks exact active registry membership before each
  review. A foreign, inactive or replaced Tinker cannot inspect/maintain this
  world's systems. Two new red regressions were preserved in
  `/tmp/argos-tinker-isolation-red.log`; the corrected coordinator/health
  selection passed **23/23** in `/tmp/argos-tinker-isolation-green.log`.
- The generated-value host policy validates complete release defaults and
  worker mutation batches, including current attachment defaults, again at the
  final application boundary. Invalid numeric output rolls back through the
  existing failed-evidence/repair path rather than partially writing ECS state.
  Four engine suites passed **99/99**, including 13 new value-policy cases:
  `/tmp/argos-value-policy-final.Zh1q08`. Expected red tests and two intervening
  fixture/instrumentation failures were retained, not overwritten:
  `/tmp/argos-value-policy-red.oIo2NT`,
  `/tmp/argos-value-policy-green.tHMZAP`, and
  `/tmp/argos-value-policy-regression.FTLMNU`.
- The former logging-only Tinker report tool now queues actual source-bound,
  version-bound messages to the same world's native God. Reports expire 120
  simulated seconds after observation. Unavailable/stale reporting is rejected;
  a queued receipt does not claim review or repair.
  In-flight deactivation or replacement also revokes bound maintenance tools,
  while accepted advice survives a subsequent valid inspection. Final reporting,
  Tinker health, delivery and inbox tests passed **61/61 across five suites**:
  `/tmp/argos-artificer-revocation-final.json`. False-success and revocation red
  evidence remains in `/tmp/argos-artificer-reporting-red.json` and
  `/tmp/argos-artificer-revocation-red.json`.

Selections overlap; these counts must **not** be summed as unique tests.
Worker artifacts were scripted offline fixtures, not model-generated success.

The one actual provider-backed browser test was operator weather control, with
manual NPCs. Request at 4.6 simulated seconds, native rain at 7.3 seconds, reply
at 9.0 seconds; independent cloudy weather retained elsewhere. Saved stopped
session/world: `recordings/spatial-8n9fN9`. This proves the operator-to-native
effect-to-renderer path, not autonomous cognition or generated-code quality.

## Still open / next checks

1. User exercise of **Ask God** in the fresh live development town; distinguish
   requested work, validated/active jobs and actual physical effects.
2. One bounded provider-backed mechanic build and observed native execution.
   Do not infer success from a queued job or a God reply.
3. Autonomous need → spirit proposal → God approval → build → resident use →
   feedback, with the original behavioral evidence and failures retained.
4. Tinker's inspection currently uses native wrapper telemetry; isolated worker
   runtime metrics and disabled/rolled-back-release diagnosis are not a complete
   performance/effectiveness review. Managed automatic rollback/repair is real,
   but this is not evidence of comprehensive self-improvement.
5. Native adapters for genuinely new places, geometry, animations, affordances
   and their cognition effects. Scalar fields alone are not those capabilities.
6. Original ten-trial baseline and ten-minute endurance gates remain open.
   No live autonomous NPC run, H3 run or endurance test was started in this pass.

See [World development](WORLD-DEVELOPMENT.md) for launch instructions, resources
and present capabilities. No acceptance gate is closed by this checkpoint.

## Ready handoff

Final development server: loopback port **51090**, run directory
`recordings/spatial-ZEjWTa`, log `server-final.log` in the checkpoint directory.
The private URL is provided in the conversation, not copied into this document.
Browser-verified **Ready to begin · 00:00**, ten residents, five configured
spirits, eight shared engineering jobs and the **Ask God** panel. The final live
world was not started; pressing Start enables paid NPC/spirit cognition.

Only the two temporary servers created during this implementation were stopped.
The user's prior world server was not altered. Saved outcomes and both before/
after source archives are retained; no recordings were deleted.
