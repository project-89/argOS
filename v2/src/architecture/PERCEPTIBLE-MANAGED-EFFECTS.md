# Perceptible managed effects: existing path verified

2026-09-07. Test-only change; no runtime/prompt changes or provider calls.

The sensory system does not enumerate every ECS component. It reads visible
objects' public Description and ObjectState after the shared visibility resolver.
The cache fingerprint includes these same fields. Managed systems can update
those declared public fields alongside the physical quantity they represent.
An aggregate managed_system_changed count is not itself a sensory description;
do not broadcast it as an unlocated fact or expose arbitrary component data.

## Evidence

`src/engineering/__tests__/perceptible-mechanic.test.ts` uses real release
validation, managed workers, commit fencing and production sensory/cache code.
A deterministic builder introduces WaterGauge and RisingWater; depth and the
public gauge description are computed together. The test verifies:

- Finished worker output remains invisible before commit.
- Committed public appearance changes immediately invalidate nearby perception
  caching; no ten-second TTL wait is needed.
- A hidden gauge changes in ECS but stays hidden from the nearby actor.
- Another room's actor sees neither the change nor a changed visual fingerprint.
- The committed change receipt includes the originating job and release digest.
- An intervention after worker computation invalidates its stale result: local
  perception sees the intervention, not the discarded update, and no additional
  managed change receipt is emitted.

Passed on the existing runtime: 90901 exit0, one test/0.709s,
`/tmp/argos-perceptible-mechanic.log`. No failing case was manufactured and no
redundant notification system was added. Expanded visibility/perception/usable
mechanic checks: 51416 exit0,36 tests/four suites/1.738s,
`/tmp/argos-perceptible-mechanic-expanded.log`. TypeScript87054 exit0,
`/tmp/argos-perceptible-mechanic-types.log`. Diffcheck clean.

No new full-suite claim: the previous 282-suite/3524-pass baseline predates this
additional test; production source is unchanged in this turn.

## Remaining diagnostic

This does not prove a real builder authors a faithful public appearance or that
an autonomous actor acts on it. A quantity-only mechanic may be real but lack a
public representation; hidden variables need not be sensed. The next live
diagnostic must separate observed need, spirit review, build admission/validation,
committed effect, local perception and autonomous behavior. Installation or
fluent narration is not proof of solving the problem.

Existing harness audit:

- `src/evals/living-world-soak.ts` supports explicit 180–600s no-H3 Gemini runs,
  but requests an operator-authored SoakClock instrument. Useful load evidence,
  not autonomous spirit-driven useful growth.
- `src/behavioral-tests/70-self-evolution-stress-test.ts` disables library spirits
  and planning, manually manages spirits and assigns behavior policies. Its final
  exit allows two failed checks. Do not use it unchanged as proof of the current
  library maintenance contract.

Neither runner was launched. Next add/adapt a bounded diagnostic with production
coordinator wiring, explicit all-required gates, isolated artifacts/store,
shutdown/resource limits and one-run ownership before the live run. Do not
force an NPC to adopt a goal or use the new capability to manufacture success.
