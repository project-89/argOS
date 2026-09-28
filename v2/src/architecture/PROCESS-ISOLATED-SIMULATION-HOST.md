# Process-isolated simulation host

The supported concurrent-world boundary is `createSimulationHost` from the
library entry point. Each host constructs one Argos simulation in its own child
process. Component arrays, registries, module caches and Steward globals are
therefore not shared with another hosted world. This is storage isolation, not
a security sandbox: child processes run under the same user and inherit the
environment. AI, coding and host-tool permissions remain configuration choices.

```ts
import { createSimulationHost } from "./index";
const host = await createSimulationHost({
  name: "Study", enableAI: false, preset: "minimal",
  rooms: [{ name: "Study" }],
});
try {
  const frame = await host.step(250);
  const saved = (await host.snapshot()).world;
  // Persist saved using the caller's chosen storage. Export is not a live ref.
  await host.restore(saved); // New process, restored clock; no automatic start.
} finally {
  await host.close();
}
```

## Current contract

- Inputs are bounded JSON values, not callbacks, live component stores or a
  code-evaluation RPC. At most32 requests are pending per connection.
- Commands execute serially within a worker. Live background systems retain
  their normal runtime scheduling; IPC serialization is not a stop-the-world lock.
- `step`, `start`, `pause`, stimuli, state export and explicit component
  definition/attachment use the actual library world. Attachment requires an
  unambiguous exact entity name. Component values still use registry validation.
- `reset(config)` constructs/validates a candidate process before retiring this
  host's current runtime. Failed candidate initialization leaves the current
  worker usable. Save a snapshot first if the replaced state is needed.
  Concurrent requests during reset reject; pending old-worker calls reject on
  closure. Candidate construction is not an external-effect rollback or sandbox.
- `restore(snapshot)` replaces the worker using a trusted saved ECS/system/schema
  snapshot and the host's existing runtime permissions. Original genesis/setup
  and population generation do not rerun. Caller permissions are not loaded from
  the snapshot. `restoreSnapshot` also supports initial construction from a save.
- Close is terminal/idempotent. A dead worker rejects requests; it is never
  silently restarted. Timed-out mutations are uncertain, so the worker is killed
  and the request is not automatically retried. Parent disconnect closes workers.
- An isolated worker rejects a second `createArgosWorld` construction. Validation
  workflows that need a scratch world must use another process, not bypass this
  guard. The legacy in-process APIs remain for existing single-world integration;
  they do not provide safe concurrent-world isolation.
- Source workers currently run with the installed `tsx` runtime. Packaged/build
  distribution and lifecycle behavior under provider stalls still need validation.

## Unfinished work—not implied by the initial lifecycle tests

Restore now runs at construction before spirit/daemon setup. Deserialization
reuses exactly the seeded God entity, remaps other IDs/relations, restores authored
schema in place and strictly compiles saved systems. God and runtime clocks and
the entity lookup registry are rebound; preset/population generation is skipped.
Two-worker tests prove remapped IDs, independent clocks/counters, subsequent
system execution and component extension. Invalid envelopes preserve the current
worker; a candidate system compile failure also preserves it.

Remaining restore audit: package-specific world-capability callbacks (e.g. the
apartment phone executor) are not serialized/reinstalled by generic construction.
Native agent capability registration now leaves a durable runtime-package
requirement, including after teardown. Generic executable restore rejects marked
snapshots before replacing the current worker. Raw data deserialization preserves
the marker for inspection. This is a rejection boundary, not package reattachment;
legacy unmarked snapshots cannot be assumed safe. Do not use
this generic path to claim a phone demo has been fully revived. AI-on restored
cognition, newly recreated guardians/director continuity and all actor-owned
in-flight state need integrated tests beyond the existing persistence suites.

Saved systems now retain their async scheduling flag (legacy await-bearing code
uses the compiler's existing inference). Restored jobs start with running=false;
old callbacks are not revived. Tests verify synchronous ticks skip async jobs and
pending async jobs are not duplicated. Legacy Promise-returning code without an
async flag or await is not reliably inferable.

Generated-system installation/hot activation has host-facing coverage: a fixture
builder activates a counter while ticks continue, and a rejected replacement
leaves the old worker committing. This is deterministic integration evidence,
not a model-builder or semantic-usefulness evaluation. Event subscriptions and
bounded operator logs still need host-facing coverage. `host.health()` returns read-only
system execution/error telemetry and simulation stats without draining maintenance
queues or serializing the whole world. It caps reports at 500 systems, names at
512 characters and error/reason text at 2,048 characters, with total/truncated
indicators for the report count. This is polling, not a push subscription or a
semantic usefulness judgment. Current IPC still discards worker console streams.
This initial
interface does not yet replace the full `ArgosSimulation` integration surface.
Do not mark the complete isolation/maintenance goal done from reset tests alone.

Hosted coding daemons claim `.argos-host-owner` exclusively in the canonical
engineering directory before reading/writing releases. The lease lasts through
process exit, not merely stop; normal close releases it. A second host or same-store
candidate reset rejects without replacing the original host. Close then reopen is
supported and tested. SIGKILL/crash may leave a stale file: no automatic PID-based
stealing; explicitly verify the previous writer is gone before recovery. Legacy
non-hosted daemons do not yet participate, so mixing them against a hosted store
is unsupported. Automatic same-store reset handoff remains unfinished.

### Managed snapshot restoration

Managed systems now carry release digest and build-job provenance. Raw world
deserialization retains them as inactive, non-executable placeholders; a second
save preserves their intended active state and release requirement. Their module
source is never passed through the ordinary system-body compiler.

Executable library restore requires explicitly caller-enabled coding daemons.
The selected engineering store must contain the matching accepted release
history: effective system names, job IDs, digests and exact module source must
agree. Each release goes through the existing managed compilation and acceptance
checks. Missing or mismatched stores fail rather than silently omitting systems
or substituting a newer release. Accepted replacement history is replayed through
the managed worker adapter; no old worker or in-flight result is resurrected.

During that synchronous history replay only, older schemas retain additive
fields proven by accepted later releases. The restored snapshot's existing field
types must match that accepted history. Ordinary subsequent builds still cannot
delete fields or change types. Paused systems remain paused after rebinding.

This supports **close, then restore against the same store**. It does not solve
live same-store writer handoff; the exclusive process lease remains unchanged.
Legacy snapshots without managed provenance do not gain inferred execution
authority from their descriptive pseudocode and may still fail strict restore.
Native runtime-package reattachment is a separate remaining integration task.
