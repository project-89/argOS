# Managed build feedback survives observer failures

2026-09-07. Library integration, not a model-behavior evaluation.

## Production defect

The library's CodingDaemon event handler emits `system:build` before enqueuing
terminal reports for God and the requesting spirit. Typed SimulationBus events
previously delegated directly to EventEmitter. If a public subscriber threw,
delivery stopped at that listener; CodingDaemon caught the exception around the
whole handler. The build still activated or rejected, but later public observers
and the internal God/requester reports could miss its outcome.

This made a failed UI/telemetry subscriber an accidental veto over maintenance
feedback. It was not a failed mechanic or an NPC choosing not to act.

## Repair

Typed observation delivery now isolates each subscriber. Synchronous throws and
rejected returned promises are counted without stopping later listeners. This
includes named actor/room channels, aggregate channels and wildcard observers.
The subscription wrapper returns the callback result so async failures can be
observed. Raw listener wrappers preserve registration order and `once` removal.

`bus.getObserverHealth()` returns a count and a copied last-failure descriptor
(channel and event type, each bounded to 128 characters). It does not retain
exception messages, stacks or event payloads. The first failure produces one
warning; repeated failures increment the counter without repeated log flooding.

Raw `emit("channel", ...)` EventEmitter semantics and command injection are
unchanged. Observer failures are not reported as simulation-system failures.

## Evidence and scope

`src/__tests__/managed-feedback.test.ts` constructs the real library simulation
with its standard spirit hierarchy and God inbox, but autopilot execution,
evolution, narrative engine and server disabled. The builder is the existing
deterministic subprocess fixture. Fetch is guarded and asserted unused. No live
model inference, real builder service, H3, running-demo mutation or server restart.

Both healthy and deliberately throwing public-subscriber variants:

1. Request the counter build using the actual requesting spirit's name.
2. Validate and activate it through the real CodingDaemon.
3. Submit a replacement with an independent incompatible acceptance check.
4. Observe that candidate's rejection, retaining the accepted system.
5. Assert exactly one matching terminal report in the later public listener,
   God inbox and requesting spirit inbox for each job/status pair.
6. Assert God's autopilot remains disabled—receipt did not grant execution.

Original production regression: 31204 exit 1, one healthy case passed and the
broken-subscriber case failed, `/tmp/argos-managed-feedback-red.log`.
First focused pass exposed a test's incorrect singular `system` channel spelling
(99405 exit 1). Corrected to `systems`, and added named actor/room plus async
channel coverage. Final focused: 90537 exit 0, 16 tests / two suites, 2.794s,
`/tmp/argos-managed-feedback-focused2.log`. TypeScript49647 exit 0,
`/tmp/argos-managed-feedback-types2.log`.

Full regression: 91280 exit 0, **282 suites / 3524 passed / 10 skipped**,
201.481s, `/tmp/argos-managed-feedback-full.log`. The three first-failure warnings
are confined to the deliberately failing managed-feedback and SimulationBus
fixtures; none came from another suite. Diff check passed. All processes ended.

These tests assert outcomes outside observer callbacks, so callback isolation
cannot hide their assertions. Broader existing tests that put assertions inside
observers should not be the only evidence for a delivery contract.

The report says `active` or `rejected`, not “world problem solved.” This proves
delivery of installation/validation outcomes. It does not prove a supervisor
made a good decision, an NPC discovered/used a mechanic, or a new system closed
the original observed capability gap. Those still need committed-effect evidence
and a bounded maintenance-enabled behavioral diagnostic.
