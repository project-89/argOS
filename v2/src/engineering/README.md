# Continuous world engineering

The simulation stays inhabited while a coding daemon develops its mechanics.
God and approved spirit proposals submit work; the runtime admits validated
component/system releases between ticks. No simulation restart is required.

```text
World observations → spirits / God → engineering request
                                      ↓
                         Codex CLI or Gemini worker
                                      ↓
                       candidate files + executable tests
                                      ↓
                      independent validation / schema checks
                                      ↓
                         tick-boundary release activation
                                      ↓
                     worker computes → checked ECS changes
                                      ↓
                      build results → God / requesting spirit
```

## One library entry point

```ts
import { createSimulation } from "./src/index";

const sim = await createSimulation({
  name: "Salt House",
  genesis: { seed: "A keeper lives above a flooded workshop. Salt corrodes exposed metal." },
  enableSpirits: true,
  evolution: true,
  dualLoop: true,
  enableServer: false,
  codingDaemons: { backend: "codex", directory: "data/live-builds/salt-house" },
});

sim.onSystem(event => {
  if (event.type === "system:build") console.log(event);
});
await sim.start();

const job = sim.requestSystemBuild({
  source: "operator",
  instruction: "Add a corrosion mechanic for exposed brass, using existing object state. Include attachment, protected-object, and saturation tests.",
  protectedConditions: ["A missing tool is an intentional obstacle, not an engine defect."],
});
console.log(job.id, sim.getCodingStatus());
```

`getCodingStatus().activeSystems` identifies the current system owners; historical
jobs retain their admission result even after a newer release supersedes them.
`getCodingStatus().runtime` separates attempts, committed results, stale results,
failures, last committed tick, and maximum observed worker round-trip duration.

`codingDaemons` defaults on when evolution is enabled. Set it to `false` to opt
out. Explicit configuration also permits engineering in an `enableAI:false`
world, which keeps NPC cognition deterministic while testing a live builder.
The existing `npm run live:npc -- "world prompt"` entry point enables this loop
and emits `argos.engineering.v1` JSON lines alongside its NPC projection.
The separate oil-demo runner does not automatically become a full evolving world.

The new God tools are `requestSystemBuild` and `getCodingJobs`. Managed paths
also accept approved Architect/Weaver system proposals and Tinker repairs of
managed systems. An approved proposal stays `building` until activation actually
succeeds; merely queuing it does not count as creating a capability.
Terminal results go to God's autopilot inbox when enabled and to the requesting
spirit matched by name. Entity generation remains with the existing world-crafter
and authoring tools; generated system code cannot spawn arbitrary entities.

## Configuration

Set environment variables in the existing local `.env` (never commit keys):

```dotenv
ARGOS_CODE_BUILDER=codex          # or claude, or gemini
# The codex/claude binaries are found on PATH, ~/.local/bin, Homebrew, or any
# ~/.nvm/versions/node/*/bin (a CLI installed under another Node still runs under
# that Node). Set these only to pin an exact absolute path:
# ARGOS_CODEX_BIN=/absolute/path/to/codex
# ARGOS_CLAUDE_BIN=/absolute/path/to/claude
# Optional explicit model overrides; otherwise the CLI default:
# ARGOS_CODEX_MODEL=...
# ARGOS_CLAUDE_MODEL=sonnet        # alias resolves to the newest Sonnet (claude-sonnet-5-5 on 2026-09-28)

# Gemini roles all default to gemini-3.8-flash:
ARGOS_AGENT_MODEL=gemini-3.8-flash
ARGOS_CODE_MODEL=gemini-3.8-flash
ARGOS_RENDER_MODEL=gemini-3.8-flash
# GOOGLE_GENERATIVE_AI_API_KEY=... (existing key)
```

`ARGOS_CODE_BUILDER=gemini` selects a bounded three-attempt implement/test loop.
`ARGOS_CODE_BUILDER=claude` runs Claude Code headless (`claude -p`) in the same
candidate workspace on the user's Claude subscription: `ANTHROPIC_API_KEY` and a
shell-level `ANTHROPIC_MODEL` are not inherited, the session's tools are limited to
Read/Write/Edit/Glob/Grep/Bash, Bash is pre-approved only for `node validate.mjs`,
and web tools are denied.
Both backends use the same independent admission tests. Model parameter
normalization removes obsolete sampling settings and maps `minimal` thinking
to `low` for Gemini 3.8. Other configured model families pass through unchanged.

Codex uses the installed, authenticated CLI. It runs a local coding harness
with remote model inference—not an offline model. Each job gets a candidate
directory, a schema/world snapshot, `SYSTEM_API.md`, and a bundled executable
validator. It runs with `--ignore-user-config --sandbox workspace-write
--ephemeral`; the child does not inherit simulation API keys. CLI authentication
uses the existing auth store. Gemini uses the existing Google API key.

Configuration also accepts `timeoutMs` (default 180,000), `pollMs` (1,000), and
`maxQueue` (8). One engineering job builds at a time; runtime systems each execute
asynchronously in their own worker. There is no unbounded pool of coding agents.

## Files are releases, not partially written live scripts

```text
data/live-builds/<world>/
  inbox/                   # publish BuildRequest JSON via atomic rename
  jobs/<uuid>/
    host-job.json          # host-owned job status
    candidate/
      components/*.json
      systems/*.ts
      release.json         # written last; declares files, permissions, tests
  releases/<sha256>/       # exact bytes accepted by the host
  active.json              # ordered release index, atomically replaced
```

Publish an inbox file such as `rust.json` containing an `instruction` and `source`.
Optional `acceptance` tests are host-supplied assertions that the coding worker
cannot change. Successfully queued files are renamed with an `.accepted` suffix.
Malformed/partial inbox JSON stays pending; producers should write a temporary
file and rename it into place.

The host checks bounded regular files, rejects escaping paths/symlinks, parses
strict schemas, compiles the restricted TypeScript entry point, and executes
tests in isolated worker heaps. Each system needs at least two tests and a test
demonstrating a real state change; identifying all meaningful negative cases
still requires good acceptance criteria. Exact accepted bytes are hashed and
copied before activation. Editing a candidate afterward does not affect live code.

This is **not** an unrestricted watcher that executes any changed `.ts` file.
New and replacement mechanics enter through a release. Previously accepted
release files are revalidated and reloaded on startup without rebuilding.
Job history/candidates and the release index are retained; retention/compaction
is not implemented yet. Use a distinct directory for each independent world.
Runtime persistence of world entities is separate from persistence of release files.

## Runtime contract

See [contracts.ts](contracts.ts) for the complete file schemas and `SYSTEM_API`.
Each module exports a synchronous `run(ctx)` with:

- `query(...components)`: actual ECS component membership; at least one name required.
- `get(entity, component, field)`: scalar reads.
- `set(entity, component, field, value)`: declared scalar writes.
- `attach(entity, component)`: attach a declared dynamic component with defaults.
- `tick` and `deltaMs`: simulation time; `frequency` is in logical ticks.

Numbers must be finite; strings and mutation counts are bounded. Component
fields are additive: existing fields cannot disappear or change type. Existing
SoA objects and values survive upgrades. New fields receive defaults on entities
already carrying that component. Built-in component definitions cannot be replaced.

Managed systems declare component reads and field writes. Overlapping field
ownership by different managed systems is rejected. Core mind, action, inventory,
and position components are protected; the API has no entity deletion/creation,
relations, external I/O, timers, or async calls. This deliberately narrow first
version covers environmental mechanics, not every future Argos capability.

Generated JavaScript never executes on the simulation thread. A worker computes
against a serialized snapshot (25ms VM execution limit, bounded heap and payload,
2s wall deadline). The host validates the whole result and commits it at a later
tick boundary only if its read snapshot still matches the world. All results ready
at that boundary are checked before any of their disjoint writes are applied.
Unrelated entities without declared read components do not invalidate snapshots. NPC/player
changes win over stale results. Missed execution time accumulates; stale results
retry rather than overwriting newer state. Broad read sets can therefore starve
under constant contention and should be kept small.

Runtime failure discards that invocation's writes and rolls back the release's
still-current systems to their preceding versions, then reports failure upstream.
Additive schemas and earlier legitimate world changes remain; this is code rollback,
not a rewind of lived history. Restart preserves the good code and added schemas.
Stopping cancels queued builds and workers; late results cannot activate after restart.

## Verification

```sh
npm run typecheck
npm test -- --runInBand

# Bounded integration checks: these spend model inference, not H3/video credits.
npm run test:engineering:live
npm run test:engineering:live -- --gemini
```

The live check creates Mara, a workshop, and an exposed brass latch; the daemon
builds and tests corrosion while the simulation runs at 20Hz. Independent tests
require correct elapsed-time progression and no change to protected objects.
Success requires activation followed by a real ECS value change. It writes a
`verification.json` and runtime log to a printed temporary directory and stops.
The request is submitted through the library with a spirit source label; this is
not a claim that an autonomous spirit discovered the mechanic during the probe.

Both Codex and Gemini have passed this live check. Unit coverage additionally
checks admission boundaries, schema identity, operator-test rejection, stale
results, stop/restart, spirit proposal completion, rollback/reload, and runaway
worker timeouts. A multi-hour autonomous God/spirit/NPC evolution soak remains
necessary before treating this as an unattended livestream service.

For interacting mechanics, scarce inventory, overload, request storms, and live
upgrades, see the [simulation pressure evals](../evals/README.md).

## Remaining boundaries

### September 6 builder and maintainer repair

The CLI transport now separates a bounded JSON frame (1 MB) from a bounded whole
session (64 MB). Oversized `item.started`, `item.updated`, and `item.completed`
advisory frames are drained without retaining their payload; completion/error
frames are never silently dropped. Successful process exit, a real
`turn.completed` receipt, independent artifact validation, and tick-boundary
admission are still separate requirements. `worker-diagnostics.json` records only
frame/byte counts, event type, exit state, and an explicit failure code. It does
not retain private command output. The live probe saves `verification.json` on
failure as well as success.

Built-in schemas now declare their actual scalar types and are compile-checked
against the component arrays. Architect entity materialization validates every
requested component/field before allocating an entity, initializes sparse slots,
and requires a real room for non-room entities. Unknown components or wrong types
cannot produce a successful descriptive shell. Unsupported rules fail explicitly.

Architects can abstain. Their context includes a real 30-second event window
(not the former accidental 50 milliseconds), setting/entities, native services,
and recent pending/failed proposals. Automatically designed needs require existing
evidence references and an observable expected change; managed system designs
also declare supported capabilities, written fields, and designer-owned tests
that are immutable to the implementing worker. Evidence references are grounding,
not a semantic proof. Exact normalized duplicates are suppressed; arbitrary
paraphrase-level deduplication and independent evaluation of designer intent remain
open work. An operator may still enqueue an explicit legacy specification directly.

Environmental workers no longer receive private actor components in their world
snapshots, and generated releases cannot declare private cognition reads or
writes. This includes the newer affect, emotional narrative, continuation and
autobiographical components. Native actor cognition and God observations are not
changed by this restriction. Privileged systems that genuinely need private
knowledge require a separate explicit host capability, not an environmental
worker reading thoughts and converting them into public world effects.

`usable-mechanic.test.ts` proves the real validation/admission path without live
inference: a candidate valve-flow system hot-loads while the old runtime ticks;
an inhabitant's native close/open interaction stops/restarts flow and the physical
sound source; host-owned tests reject a plausible wrong replacement. This proves
usable mechanics and safe admission, not autonomous NPC choice or a successful
live coding-model invocation.

- This module does not implement the new canonical event-stream specification.
  Build events and `managed_system_changed` are runtime diagnostics; they are not
  canonical narrative ChangeRecords or a renderer timing protocol.
- `protectedConditions` is guidance to the builder, not an executable invariant
  language. Protect puzzle rules with independent acceptance tests now; a durable
  invariant catalog and runtime semantic enforcement are still needed.
- Existing native/legacy systems and entity/component authoring tools still exist.
  They are not all subject to the managed worker protocol. Field ownership checks
  cover managed systems, not every legacy writer.
- A Node worker/VM is **not** a hostile-code OS security boundary. The CLI sandbox
  limits its authoring workspace, but untrusted community code would need stronger
  process/container isolation. Do not give player thoughts engineering authority.
- Accepted releases can be regenerated from their files; the runtime does not
  promise unlimited disk space, immortal processes, or unavailable-model recovery.

Model/CLI references: [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
