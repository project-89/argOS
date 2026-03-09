## Goal
Enable NPCs to do long-range “office work” (programming, planning, document creation, web research) **grounded in the simulation substrate**, not via freeform chat.

North star: NPC intent → **structured action** → deterministic/verified execution → emitted evidence as stimuli → NPC updates plan → repeat.

This spec describes how to represent “computer + terminal + coding agent” as **world objects** with affordances and a unified execution pathway.

---

## Design Principles
1. **One substrate**: all real effects happen through ECS + canonical containment (`LocatedIn`).
2. **Tools are objects**: “Computer”, “Terminal”, “IDE”, “Browser” are entities with `ObjectType/ObjectState/Traits`.
3. **Capabilities are affordances**: “run_command”, “edit_file”, “open_pr”, “search_web” are affordances (or tool-affordances) with preconditions.
4. **Evidence is mandatory**: results always come back as stimuli containing stdout, diffs, URLs, docs, test results.
5. **Asynchronous by default**: long tasks run via a task queue; agents get partial updates and final completion.
6. **Permissioned by role + access**: you can’t run tools unless you (a) are co-located with the device, and (b) have the required traits/authorization.

---

## Core World Objects (Schema)
### `computer`
- Traits: `device`, `computer`, `usable`, `container` (optional: contains “tabs/sessions”)
- States:
  - `powered_off` (blocked: all tools)
  - `idle`
  - `busy` (long task running)
  - `locked` (requires auth to use)

### `terminal_session` (optional entity; can also be a component on the computer)
- Traits: `session`, `terminal`, `loggable`
- States: `open`, `running`, `closed`

### `coding_agent_session` (optional entity)
- Traits: `session`, `coding_agent`
- States: `idle`, `working`, `waiting_review`, `done`, `failed`

### `document`
- Traits: `artifact`, `document`, `editable`
- States: `draft`, `review`, `final`
- Backing store: can be “in-world” text or external artifact reference.

### `repo_workspace`
- Traits: `artifact`, `repo`, `writable`
- Backing store: local filesystem path (or remote repo reference).

---

## ECS Components (Minimal Additions)
Use ECS where possible; dynamic components only for truly dynamic shapes.

### `ToolAccess`
Tracks “who can use what”.
- `ToolAccess.ownerEid: number`
- `ToolAccess.allowedRolesJson: string[]` (or `allowedTraitsJson`)
- `ToolAccess.policy: "deny" | "allow" | "allow_with_review"`

### `ToolSession`
Tracks long-lived sessions for terminals/browsers/coding agents.
- `ToolSession.sessionId: string`
- `ToolSession.ownerEid: number`
- `ToolSession.kind: "terminal" | "browser" | "coding_agent"`
- `ToolSession.state: "open" | "running" | "idle" | "closed"`
- `ToolSession.lastOutputHash: string`

### `ToolTask`
Represents an in-flight tool action.
- `ToolTask.taskId: string`
- `ToolTask.ownerEid: number`
- `ToolTask.deviceEid: number`
- `ToolTask.toolId: string`
- `ToolTask.status: "queued" | "running" | "succeeded" | "failed"`
- `ToolTask.startedAtMs: number`
- `ToolTask.finishedAtMs: number`
- `ToolTask.resultSummary: string`
- `ToolTask.resultRef: string` (optional pointer to full logs)

### `ArtifactRef` (optional)
For large artifacts you don’t want in ECS arrays.
- `ArtifactRef.kind: "file" | "url" | "doc" | "diff" | "log"`
- `ArtifactRef.uri: string`

---

## Unified “GodAi / NPC” Tool API (Internal)
Everything reduces to one interface executed by the engine:

### `ToolRequest`
- `requestId`
- `actorEid`
- `deviceEid`
- `toolId`
- `params` (JSON)
- `constraints` (timeouts, sandbox, maxBytes, allowNetwork, etc.)

### `ToolResult`
- `requestId`
- `status: "ok" | "error"`
- `summary`
- `artifacts: ArtifactRef[]`
- `stdout/stderr` (optional small payloads inline)
- `metrics` (duration, exit code, tokens)

Execution requirements:
- **Grounding**: actor must be co-located with device (via `getRoomForEntity` / `LocatedIn` tree).
- **Authorization**: actor must satisfy `ToolAccess`/traits.
- **Determinism option**: tests can run in “scripted tool” mode (prebaked outputs) to avoid LLM/tool nondeterminism.

---

## How NPCs Invoke Tools (Action Model)
NPCs should not emit freeform “use Slack …” strings that get regex-parsed.

Preferred approach:
1. NPC chooses `interact` on a device/entity.
2. `interact.content` names an affordance (e.g., `run_command`) plus structured params:
   - Option A (recommended): action schema supports `content` as JSON.
   - Option B: `content` remains text, but the engine validates/parses a strict mini-format.

Example:
- `interact target="computer" content="{\"affordance\":\"run_command\",\"command\":\"npm test\"}"`

Then:
- Affordance → tool binding lookup
- ToolTask is queued
- ToolResult is emitted as stimuli to actor (and optionally watchers/tinkerer)

---

## Tool Bindings (Existing Layer to Extend)
Use `src/world/affordance-tools.ts` as the single registry:
- Add a `COMPUTER_DEV_INTERFACE` that includes:
  - `run_command` (internal: runs shell in workspace sandbox)
  - `read_file`, `write_file`, `apply_patch`
  - `run_tests` (wrapper around `run_command` with repo-aware defaults)
  - `search_web` (mcp: web tools) or internal fetch
  - `open_pr` / `create_branch` (optional)
  - `spawn_coding_agent` (internal: creates `coding_agent_session`)
  - `coding_agent_step` (internal: asks the coding agent to propose next diff / action)

Important: “coding agent” is treated as a **tool**, not a second uncontrolled brain.

---

## Coding Agent Integration (Two Options)
### Option 1: “Sub-agent tool” (recommended)
NPC uses a `spawn_coding_agent` tool on a `computer`.
- Engine creates `coding_agent_session` entity bound to that computer.
- NPC sends tasks to it via `coding_agent_step` (goal + constraints).
- Output returns as `ToolResult` containing diffs + test results.
- NPC reviews/approves before apply (policy-driven).

### Option 2: “Terminal-first”
NPC directly runs commands and edits files via tool bindings.
- More deterministic and inspectable.
- Lower-level; NPC needs more planning/retry scaffolding.

---

## Long-Range Planning & Verification Loop
For “product team” realism, add explicit checkpoints:
1. **Plan**: create tasks/subtasks with acceptance criteria (tests passing, doc rendered, link validated).
2. **Execute**: tool calls.
3. **Verify**: run tests / lint / smoke checks via tools.
4. **Reflect**: postmortem and next actions (feeds planning system).

This should be automated by:
- `planning-system` (plan generation + step tracking)
- a “worker QA loop” (tool result → verify → block merge if fail)

---

## Safety / Governance
- `ToolAccess.policy="allow_with_review"` gates destructive actions (write/apply_patch).
- “Autopilot” can run read-only tasks; write tasks require explicit “approve” affordance or a Spirit/God command.
- Rate limits: per-agent and per-device cooldowns via tool binding constraints.

---

## Tests (What We Should Add Next)
### Behavioral E2E: “Engineer fixes failing tests”
Setup:
- World has `computer` + `repo_workspace`.
- A known failing test is introduced (or a fixture repo).
Success criteria:
- Agent discovers failure via `run_tests`.
- Agent proposes fix (via coding agent or patch tool).
- Agent applies fix.
- Agent re-runs tests to green.
- Evidence captured as stimuli artifacts (logs + diff).

### Behavioral E2E: “Product team pipeline”
Agents:
- PM writes spec doc.
- Engineer implements.
- QA runs tests and files issues if red.
- Tech writer updates docs.
Success criteria:
- All produce artifacts; engineer changes code; QA verifies; writer updates docs; PM posts summary.

Both tests should support:
- `--mode=scripted` (deterministic, no LLM)
- `--mode=ai` (real LLM + real tools)

