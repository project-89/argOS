import type { EscapePerturbationStage, EscapeRoomEvent, EscapeTopology } from "../demo/escape-room";
import { evaluateGenerativeAgentsRun } from "./generative-agents-evaluation";
import { findInterruptedUnlockRecovery } from "./escape-room-recovery-evidence";

export interface EscapeEvaluationState {
  topology?: EscapeTopology;
  elapsedMs: number;
  escaped: boolean;
  actors: Array<{ id: number; name: string; room: string }>;
}
export interface EscapeEvaluationOptions {
  topology?: EscapeTopology;
  live: boolean;
  violations: readonly string[];
  interruptionRequested?: boolean;
  interruptionApplied?: boolean;
  interruptionStage?: EscapePerturbationStage;
  runtimeError?: string | null;
}

/** Independent trace reconstruction for the relay's changed dependency graph.
 * A renamed snapshot/milestone is not proof: actual operation identities,
 * cooperative elapsed work, continuous exclusive supply and a later real unlock
 * must be present. These are operator evaluations, never actor instructions. */
function relayCausalProof(tape: readonly EscapeRoomEvent[], actorIds: ReadonlySet<number>) {
  const normalized = (text: string | undefined) => (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const control = (e: EscapeRoomEvent, target: string, command: string) => e.kind === "action"
    && e.action?.type === "interact" && normalized(e.action.target) === target && normalized(e.action.content) === command;
  const before = (a: EscapeRoomEvent, b: EscapeRoomEvent) => a.elapsedMs < b.elapsedMs || a.elapsedMs === b.elapsedMs && a.sequence < b.sequence;
  const between = (e: EscapeRoomEvent, a: EscapeRoomEvent, b: EscapeRoomEvent) => before(a, e) && before(e, b);
  const bodyConflict = (start: EscapeRoomEvent, end: EscapeRoomEvent) => tape.some(e => between(e, start, end)
    && e.actorId === start.actorId && ["action", "movement"].includes(e.kind) && ["pending", "succeeded"].includes(e.status ?? "")
    && e.action && e.action.executionId !== start.action?.executionId
    && !["speak", "think", "wait", "reflect", "remember", "plan"].includes(e.action.type));
  const pairs = (target: string, command: string | RegExp, duration: number) => tape.flatMap(end => {
    const content = normalized(end.action?.content);
    if (end.status !== "succeeded" || !control(end, target, content)
      || (typeof command === "string" ? content !== command : !command.test(content))
      || end.actorId === undefined || !actorIds.has(end.actorId) || !end.action?.executionId) return [];
    const same = tape.filter(e => e.action?.executionId === end.action!.executionId && e.kind === "action");
    const starts = same.filter(e => e.status === "pending" && e.actorId === end.actorId && control(e, target, content));
    if (starts.length !== 1 || same.filter(e => e.status === "succeeded").length !== 1 || same.some(e => e.status === "failed")) return [];
    const start = starts[0]!;
    return before(start, end) && !bodyConflict(start, end) && end.elapsedMs - start.elapsedMs === duration && Number.isSafeInteger(start.roomId)
      && start.roomId === end.roomId ? [{ start, end }] : [];
  });
  const helperFor = (start: EscapeRoomEvent, end: EscapeRoomEvent, target: string) => {
    const candidates = tape.filter(e => control(e, target, "hold") && e.status === "succeeded" && e.elapsedMs === end.elapsedMs
      && e.actorId !== start.actorId && e.actorId !== undefined && actorIds.has(e.actorId) && e.action?.executionId);
    for (const terminal of candidates) {
      const same = tape.filter(e => e.kind === "action" && e.action?.executionId === terminal.action!.executionId);
      const starts = same.filter(e => e.status === "pending" && e.actorId === terminal.actorId && control(e, target, "hold"));
      if (starts.length !== 1 || same.filter(e => e.status === "succeeded").length !== 1 || same.some(e => e.status === "failed")) continue;
      const held = starts[0]!;
      if (before(held, start) && before(start, terminal) && !bodyConflict(held, terminal) && end.elapsedMs - held.elapsedMs <= 45_000
        && held.roomId === start.roomId && terminal.roomId === start.roomId) return { start: held, end: terminal };
    }
  };
  const powerWrite = (e: EscapeRoomEvent) => e.kind === "operator_edit" && !!e.powerTrip
    || e.status === "succeeded" && e.kind === "action" && e.action?.type === "interact"
      && normalized(e.action.target) === "power router" && /^route (off|pump|optics|exit)$/.test(normalized(e.action.content));
  const suppliedThroughout = (start: EscapeRoomEvent, end: EscapeRoomEvent, route: string) => {
    const previous = tape.filter(e => before(e, start) && powerWrite(e)).at(-1);
    return !!previous && control(previous, "power router", `route ${route}`)
      && !tape.some(e => between(e, start, end) && powerWrite(e) && !control(e, "power router", `route ${route}`));
  };
  for (const pump of pairs("drain pump", "pump", 8000)) {
    const helper = helperFor(pump.start, pump.end, "pump bypass");
    if (!helper || !suppliedThroughout(pump.start, pump.end, "pump")) continue;
    const coil = tape.find(e => before(e, pump.start) && e.status === "succeeded" && control(e, "generator", "install")
      && e.actorId !== undefined && actorIds.has(e.actorId));
    const crank = tape.find(e => before(e, pump.start) && e.status === "succeeded" && control(e, "drain pump", "install")
      && e.actorId !== undefined && actorIds.has(e.actorId));
    const locker = crank && tape.find(e => before(e, crank) && e.status === "succeeded" && control(e, "crank locker", normalized(e.action?.content))
      && /^unlock \d{4}$/.test(normalized(e.action?.content)) && e.actorId !== undefined && actorIds.has(e.actorId));
    const archive = coil && tape.find(e => before(e, coil) && e.kind === "movement" && e.status === "succeeded"
      && e.action?.type === "move" && normalized(e.action.target) === "archive" && e.actorId !== undefined && actorIds.has(e.actorId));
    const threshold = tape.find(e => e.kind === "milestone" && e.visibility === "operator" && e.status === "succeeded"
      && e.text === "threshold_drained" && e.elapsedMs === pump.end.elapsedMs && between(e, pump.start, pump.end));
    if (!archive || !coil || !crank || !locker || !threshold) continue;
    for (const unlock of pairs("exit keypad", /^enter \d{4}$/, 2000)) {
      if (!before(pump.end, unlock.start) || !helperFor(unlock.start, unlock.end, "exit release")
        || !suppliedThroughout(unlock.start, unlock.end, "exit")) continue;
      const opened = tape.find(e => e.kind === "milestone" && e.visibility === "operator" && e.status === "succeeded"
        && e.text === "exit_open" && e.elapsedMs === unlock.end.elapsedMs && between(e, unlock.start, unlock.end));
      // Both branches must be evidenced, but neither is required to finish first.
      // Pair the real private read receipt with its operator-only physical marker;
      // an ordinary successful inspection of a blank display is insufficient.
      const codeRead = tape.find(e => before(e, unlock.start) && e.status === "succeeded" && control(e, "optical bench", "read")
        && e.actorId !== undefined && actorIds.has(e.actorId) && e.action?.executionId
        && tape.some(marker => marker.kind === "milestone" && marker.visibility === "operator" && marker.status === "succeeded"
          && marker.text === "exit_code_read" && marker.elapsedMs === e.elapsedMs && before(marker, e))
        && tape.some(detail => detail.kind === "action_detail" && detail.visibility === "private" && detail.status === "succeeded"
          && detail.actorId === e.actorId && detail.elapsedMs === e.elapsedMs && detail.action?.executionId === e.action!.executionId
          && /read the exit code: \d{4}\./.test(detail.text)));
      const prism = codeRead && tape.find(e => before(e, codeRead) && e.status === "succeeded" && control(e, "optical bench", "install"));
      const opticalSupply = codeRead && tape.filter(e => before(e, codeRead) && powerWrite(e)).at(-1);
      const exits = tape.filter(e => e.kind === "movement" && e.status === "succeeded" && e.action?.type === "move"
        && normalized(e.action.target) === "courtyard");
      if (!opened || !codeRead || !prism || !opticalSupply || !control(opticalSupply, "power router", "route optics")
        || ![...actorIds].every(id => exits.some(e => e.actorId === id && before(unlock.end, e)))
        || exits.some(e => !before(unlock.end, e))) continue;
      return { observed: true, archiveArrivalSequence: archive.sequence, coilInstallSequence: coil.sequence,
        lockerOpenSequence: locker.sequence, crankInstallSequence: crank.sequence,
        codeReadSequence: codeRead.sequence, prismInstallSequence: prism.sequence,
        branchOrder: before(codeRead, pump.end) ? "optics-first" as const : "pump-first" as const,
        archiveArrivalMs: archive.elapsedMs, coilInstalledMs: coil.elapsedMs, codeReadMs: codeRead.elapsedMs,
        pumpStartedMs: pump.start.elapsedMs, drainedMs: pump.end.elapsedMs,
        unlockStartedMs: unlock.start.elapsedMs, openedMs: unlock.end.elapsedMs,
        pumpStartSequence: pump.start.sequence, pumpCompletionSequence: pump.end.sequence,
        pumpActorId: pump.start.actorId, helperId: helper.start.actorId,
        unlockStartSequence: unlock.start.sequence, unlockCompletionSequence: unlock.end.sequence };
    }
  }
  return { observed: false };
}

/** Mechanics determine escape; prose and a quiet transcript cannot establish it.
 * Live-cognition coverage is a separate gate from the explicit scripted solver. */
export function evaluateEscapeRoomRun(events: readonly EscapeRoomEvent[], state: EscapeEvaluationState, options: EscapeEvaluationOptions) {
  if (!Number.isFinite(state.elapsedMs) || state.elapsedMs < 0) throw new Error("Invalid escape observation duration");
  const seen = new Set<number>();
  const tape = events.filter(e => Number.isSafeInteger(e.sequence) && e.sequence >= 0 && Number.isFinite(e.elapsedMs)
    && e.elapsedMs >= 0 && e.elapsedMs <= state.elapsedMs && typeof e.text === "string")
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.sequence - b.sequence)
    .filter(e => !seen.has(e.sequence) && !!seen.add(e.sequence));
  const expectedIds = new Set(state.actors.map(a => a.id));
  const castPresent = state.actors.length === 3 && expectedIds.size === 3
    && state.actors.every(a => Number.isSafeInteger(a.id) && a.id >= 0 && !!a.name.trim());
  const actorNames = Object.fromEntries(state.actors.map(a => [a.id, a.name]));
  const isPhysicalReceipt = (e: EscapeRoomEvent) => ["action", "movement"].includes(e.kind);
  const terminal = tape.filter(e => isPhysicalReceipt(e) && e.action && ["succeeded", "failed"].includes(e.status || ""));
  const escapedByAction = new Set(terminal.filter(e => e.status === "succeeded" && e.action?.type === "move"
    && e.action.target?.trim().toLowerCase() === "courtyard" && e.actorId !== undefined).map(e => e.actorId!));
  const thoughtActors = new Set(tape.filter(e => e.kind === "thought").map(e => e.actorId));
  const decisionActors = new Set(tape.filter(e => e.kind === "decision_latency" && Number.isFinite(Number(e.text))
    && Number(e.text) >= 0).map(e => e.actorId));
  const unlockRecovery = findInterruptedUnlockRecovery(tape);
  const topology = options.topology ?? state.topology ?? "observatory";
  const topologyConsistent = (topology === "observatory" || topology === "relay")
    && (state.topology === undefined || state.topology === topology);
  const relayProof = topology === "relay" ? relayCausalProof(tape, expectedIds) : null;
  const gates = {
    topologyConsistent,
    topologyCausalProof: topology !== "relay" || relayProof?.observed === true,
    completeCast: castPresent,
    physicalExitOpenAndEscaped: state.escaped === true,
    everyoneActuallyOutside: castPresent && state.actors.every(a => a.room === "Courtyard"),
    everyExitHasCommittedMovement: castPresent && state.actors.every(a => escapedByAction.has(a.id)),
    invariantsHold: options.violations.length === 0,
    runtimeCompletedWithoutError: !options.runtimeError,
    requestedInterruptionOccurred: !options.interruptionRequested || options.interruptionApplied === true,
    interruptedUnlockRecovered: options.interruptionStage !== "exit_unlock_started" || unlockRecovery.observed,
    liveCognitionObserved: !options.live || castPresent && state.actors.every(a => thoughtActors.has(a.id) && decisionActors.has(a.id)),
  };
  // Vacuous acceptance is not observed evidence. Keep the existing pass
  // contract, but make conditional coverage explicit for humans and consumers.
  const gateApplicability: Partial<Record<keyof typeof gates, boolean>> = {
    topologyCausalProof: topology === "relay",
    requestedInterruptionOccurred: options.interruptionRequested === true,
    interruptedUnlockRecovered: options.interruptionStage === "exit_unlock_started",
    liveCognitionObserved: options.live,
  };
  const byActor = state.actors.map(actor => {
    const own = tape.filter(e => e.actorId === actor.id);
    const latency = own.filter(e => e.kind === "decision_latency").map(e => Number(e.text))
      .filter(ms => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
    const quantile = (p: number) => latency.length ? latency[Math.max(0, Math.ceil(latency.length * p) - 1)] : null;
    return { id: actor.id, name: actor.name, room: actor.room, thoughts: own.filter(e => e.kind === "thought").length,
      thoughtTypes: Object.fromEntries([...new Set(own.filter(e => e.kind === "thought").map(e => e.thoughtType || "unclassified"))]
        .map(type => [type, own.filter(e => e.kind === "thought" && (e.thoughtType || "unclassified") === type).length])),
      speech: own.filter(e => e.kind === "speech" && e.status === "succeeded").length,
      decisions: latency.length, decisionMedianMs: quantile(.5), decisionP95Ms: quantile(.95),
      failedActions: own.filter(e => isPhysicalReceipt(e) && e.status === "failed").length };
  });
  // Private explanatory detail supplements, but does not duplicate, an executor receipt.
  const generic = evaluateGenerativeAgentsRun(tape.filter(e => e.kind !== "action_detail"), state.elapsedMs, { actorNames, milestoneRules: [] });
  return { version: 1, topology, causalProof: relayProof, passed: Object.values(gates).every(Boolean),
    provenance: options.live ? "autonomous shared Argos cognition" : "scripted mechanics fixture — not autonomous evidence",
    elapsedMs: state.elapsedMs, gates, gateApplicability, byActor, violations: [...options.violations], runtimeError: options.runtimeError || null,
    interruption: { requestedStage: options.interruptionStage ?? null, applied: options.interruptionApplied === true, unlockRecovery },
    mechanics: { terminalActions: terminal.length, failedActions: terminal.filter(e => e.status === "failed").length,
      codeAttempts: terminal.filter(e => e.action?.type === "interact" && /^(?:enter|unlock)\s/.test((e.action.content || "").trim().toLowerCase())).length,
      actualExitReceipts: escapedByAction.size },
    diagnostics: generic.metrics,
    limitations: [
      "A scripted successful fixture establishes solvability, never model planning quality.",
      "Physical escape alone does not establish that clues were reasoned through rather than guessed; review seed-specific read/action traces.",
      "Speech claims, thoughts and goal-completed text do not establish escape or physical effects.",
      "These gates do not automatically detect all semantic hallucinations, private-knowledge leaks or conversational loops.",
      "A single seed is not evidence of generalization. Repetition metrics are lexical review candidates, not naturalness scores.",
      "Decision timing measures the whole foreground attempt, including deterministic choices; it is not isolated model latency. Thought types distinguish background insights when the source supplies them.",
      "Wait/rest receipts do not distinguish deliberate model choices from policy fallbacks. Intent attribution is unavailable without matching admitted-decision provenance; neither decision IDs alone nor timestamp proximity establishes it.",
    ] };
}

export function formatEscapeRoomEvaluation(result: ReturnType<typeof evaluateEscapeRoomRun>): string {
  return `# ${result.topology === "relay" ? "Flooded Relay" : "Drowned Observatory"} evaluation\n\n${result.provenance}.\n\n` +
    `Outcome: **${result.passed ? "observed escape with required gates" : "incomplete / failed gates"}** after ${(result.elapsedMs / 1000).toFixed(1)} simulated seconds.\n\n` +
    `| Gate | Result |\n| --- | --- |\n${Object.entries(result.gates).map(([gate, pass]) => `| ${gate} | ${result.gateApplicability[gate as keyof typeof result.gates] === false ? "not applicable" : pass ? "observed" : "not observed"} |`).join("\n")}\n\n` +
    `| Character | Thoughts | Speech | Decision median | Decision p95 | Failed actions |\n| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    result.byActor.map(a => `| ${a.name} | ${a.thoughts} | ${a.speech} | ${a.decisionMedianMs ?? "n/a"} | ${a.decisionP95Ms ?? "n/a"} | ${a.failedActions} |`).join("\n") +
    `\n\nTiming columns are wall milliseconds. Raw successful wait/rest receipts: ${result.diagnostics.actions.rawWaitOrRestReceipts}; intentional model-wait attribution: unavailable.\n\n${result.violations.length ? `Violations:\n\n${result.violations.map(v => `- ${v}`).join("\n")}\n\n` : ""}` +
    `${result.runtimeError ? `Runtime error: ${result.runtimeError}\n\n` : ""}` +
    `## Limits\n\n${result.limitations.map(l => `- ${l}`).join("\n")}\n`;
}
