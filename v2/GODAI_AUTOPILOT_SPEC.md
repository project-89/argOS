## GodAI Autopilot (Closed-Loop Governance) — Spec

### Problem
Today, spirits/daemons can observe and report, but **GodAI is not automatically invoked** to act on those reports. In `createSimulation()`, spirit reports are effectively dropped because the spirit system’s `messagesForGodAI` return value is ignored and no callback is registered.

This breaks the intended hierarchy:
- **Spirits**: autonomous observers, proposers, maintainers
- **GodAI**: authoritative executor (world edits, rule/system creation, approvals)

### Goal
Create a robust “bridge” so that:
1) Spirits/daemons can message GodAI.
2) GodAI can autonomously triage and act on messages under strict budgets.
3) The simulation remains responsive (fast ECS loop never blocks).
4) Runaway costs/loops are prevented via gating and backoff.

### North Star Behavior
- Spirits run on their own cadence and produce reports/alerts/requests.
- Those messages become **tickets** (or inbox items) stored on GodAgent state.
- A periodic **GodAI Autopilot** AI-operation consumes tickets and issues `godCommand(...)` calls to address them.
- GodAI actions remain grounded: verify with tool calls, avoid hallucinated entities.

### Non-Goals (v1)
- Fully structured ticket schemas emitted by every spirit (we accept freeform messages).
- Automatic approval of all proposals (keep “GodAI decides”).
- Deterministic “guaranteed fix” semantics (we add verification/budgets, not perfect resolution).

---

## Architecture

### Components
1) **Message capture (Spirit → GodAI)**
   - Use the existing `setGodAgentCallback(...)` hook in `src/spirits/spirit-system.ts`.
   - Callback must be fast: it only enqueues messages into an inbox buffer.

2) **Ticket/Inbo​x store (GodAgentState)**
   - Store a bounded inbox array (sorted by priority+recency).
   - Track last-run timestamps and failure counts for throttling/backoff.

3) **GodAI Autopilot AI-operation (slow loop)**
   - Runs periodically in dual-loop runtime as a queued async task.
   - If inbox is non-empty and budgets allow, synthesizes a single command prompt
     and calls `godCommand(...)` (which itself queues long tasks like baking).

4) **Command mutex**
   - Ensure only one `godCommand` runs at a time to avoid concurrent world-edit races
     (human commands vs autopilot vs other internal callers).

---

## Policy & Safety (Runaway Prevention)

### Gating
- Minimum interval between autopilot runs (`minRunIntervalMs`).
- Only run if inbox has ≥1 message meeting `minPriority`.
- Maximum messages per run (`maxMessagesPerRun`).
- Exponential backoff on repeated failures.

### Prompt Contract (Grounding + Verification)
Autopilot prompt instructs GodAI:
- Start by identifying highest priority issues.
- Only refer to ECS entities after verifying (use `listEntities/queryEntities`).
- Prefer deterministic changes (rules/systems) over one-off narration.
- Verify completion with tool calls (list systems/rules/types, task status).
- If unable to act, send directives back down to the appropriate spirit.

### Observability
Autopilot retains:
- A short history of actions taken (text summary)
- Last-run timestamps and outcome
- Inbox snapshot counts

---

## Integration Points

### `createSimulation()` (default runtime)
- If spirits enabled:
  - Always register `setGodAgentCallback` to avoid dropping messages.
  - If autopilot enabled and dual-loop is enabled:
    - Register a new AI operation: `GodAutopilot`.

### Configuration (proposed)
`SimulationConfig.godAutopilot?: boolean | { ... }`
- Default behavior (recommended):
  - Enabled when `enableAI:true`, `enableSpirits:true`, `dualLoop:true`
  - `minPriority="high"`, conservative intervals

---

## Testing Strategy

### Unit tests
- Enqueue + prioritization ordering.
- Throttle/backoff logic.
- Autopilot cycle calls the provided executor when conditions met.

### Behavioral check (manual)
- Start a sim with spirits enabled and autopilot enabled.
- Confirm spirit reports are not dropped and GodAI acts periodically.

