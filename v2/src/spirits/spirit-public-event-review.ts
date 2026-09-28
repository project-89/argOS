/** Read-only, source-bound native evidence for each spirit's own review.
 * The shared legacy action buffer is not a receipt or acknowledgement owner.
 * A review may summarize a bounded window; omissions are explicit, never
 * interpreted as proof that nothing happened. None of this grants authority. */
import type { World } from "../ecs/world";
import { entityExists, hasComponent } from "bitecs";
import { Room, Removed } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { captureSpiritSourceScope } from "./spirit-cycle-scope";
import type { SpiritRegistry } from "./spirit-registry";
import type { SpiritState } from "./types";

const MAX_RECORDS = 64;
const MAX_SPEECH_RECORDS = 16;
const MAX_SPEECH_CHARACTERS = 2000;
const MAX_RECORD_IDS = 8;
const MAX_DIAGNOSTIC_IDS = 256;
const ENVIRONMENT_RETENTION = 128;
const MAX_ENVIRONMENT_RECORDS = 32;
const PROGRESS_WINDOW_MS = 120_000;
const MAX_PROGRESS_EXECUTIONS = 256;
const MAX_PROGRESS_ENVIRONMENT = 64;
const MAX_PROGRESS_PATTERNS = 16;

type EnvironmentReceipt = Readonly<{ id: string; sourceId: string; sequence: number;
  atSimMs: number; roomKey: string; roomName: string; detail: string }>;
type EnvironmentLedger = { sourceId: string; sequence: number; receipts: EnvironmentReceipt[] };
const environmentLedgers = new WeakMap<World, EnvironmentLedger>();

type Record = {
  kind: PublicCommittedEvent["kind"]; action: string; status: PublicCommittedEvent["status"];
  executionId: string; actorKey: string; actorName?: string; roomKey: string; roomName?: string;
  targetKey?: string; targetName?: string; operation?: PublicCommittedEvent["operation"];
  firstSequence: number; lastSequence: number; firstAtSimMs: number; lastAtSimMs: number;
  receiptCount: number; receiptIds: readonly string[]; receiptIdsOmitted: number;
  /** Only already-spoken slices, not an assertion that the utterance is over. */
  spokenText?: string; spokenCharactersOmitted?: number;
};
type ProgressExecution = {
  key: string; executionId: string; actorKey: string; actorName?: string; roomKey: string; roomName?: string;
  targetKey?: string; targetName?: string; action: string; operation?: PublicCommittedEvent["operation"];
  category: "physical" | "inspection" | "wait_or_rest" | "speech";
  status: PublicCommittedEvent["status"]; spoken: boolean; firstAtSimMs: number; lastAtSimMs: number;
  receiptId: string;
};
type ProgressBaseline = {
  atSimMs: number; executions: readonly ProgressExecution[]; environment: readonly EnvironmentReceipt[];
  /** A conservative expiry for known lost evidence, not an event timestamp. */
  incompleteUntilSimMs: number;
};
export type SpiritPublicProgressCounts = Readonly<{
  physicalCompletions: number; inspectionCompletions: number; waitOrRestCompletions: number;
  failedActions: number; spokenExecutions: number; pendingOutcomes: number; environmentChanges: number;
}>;
export type SpiritPublicProgressInput = Readonly<{
  observedAtSimMs: number; windowStartSimMs: number; windowMs: number;
  previousAcceptedAtSimMs: number | null; sincePreviousAcceptedSimMs: number | null;
  /** Retention completeness below describes this tape, not all world activity. */
  coverage: Readonly<{ basis: "published_public_receipts_only"; allActivityRepresented: false;
    zeroCountsProveInactivity: false; note: string }>;
  completeness: Readonly<{ complete: boolean; eventLedgerGap: boolean; environmentLedgerGap: boolean;
    rollingRetentionLoss: boolean; patternRowsOmitted: number }>;
  /** Unacknowledged receipts available at capture, not clipped to the rolling
   * window. Execution transitions already retained in the baseline count once. */
  sinceReview: SpiritPublicProgressCounts; rolling: SpiritPublicProgressCounts;
  /** Public execution receipts do not contain private observations or conclusions. */
  inspectionContents: "not_available_in_public_action_receipts";
  patterns: readonly Readonly<{
    actorKey: string; actorName?: string; roomKey: string; roomName?: string; targetKey?: string; targetName?: string;
    category: ProgressExecution["category"]; action: string; operation?: PublicCommittedEvent["operation"];
    completedExecutions: number; currentReviewExecutions: number; firstAtSimMs: number; lastAtSimMs: number;
    receiptIds: readonly string[]; receiptIdsOmitted: number;
  }>[];
}>;
export type SpiritPublicEventInput = Readonly<{
  sourceId: string | null; afterSequence: number; throughSequence: number; observedAtSimMs: number;
  droppedBeforeWindow: number; omittedRecords: number; omittedReceipts: number;
  records: readonly Readonly<Record>[];
  environment: Readonly<{ afterSequence: number; throughSequence: number;
    droppedBeforeWindow: number; omittedReceipts: number; receipts: readonly EnvironmentReceipt[] }>;
  progress: SpiritPublicProgressInput;
}>;
export type SpiritPublicEventReviewStatus = Readonly<{
  sourceId: string | null; sourceStopped: boolean; atSimMs: number; accepted: boolean;
  observedAtSimMs: number; observationAgeSimMs: number;
  acknowledgedThroughSequence: number; observedThroughSequence: number;
  acknowledgedEnvironmentThroughSequence: number; observedEnvironmentThroughSequence: number;
  receiptIdsObserved: readonly string[]; receiptIdsOmitted: number;
  /** Historical IDs actually visible in the separate rolling progress patterns. */
  progressReceiptIdsObserved: readonly string[]; progressReceiptIdsOmitted: number;
  droppedBeforeWindow: number; omittedRecords: number; omittedReceipts: number;
  environmentDroppedBeforeWindow: number; environmentOmittedReceipts: number;
  interventionsRequested: number; interventionResults: readonly string[];
  phase?: string; tension?: number;
}>;
type State = {
  registry: SpiritRegistry; sourceId: string | null; acknowledgedThrough: number; acknowledgedEnvironmentThrough: number;
  capture?: object; status?: SpiritPublicEventReviewStatus; progress?: ProgressBaseline;
};
const states = new WeakMap<World, WeakMap<SpiritState, State>>();

/** Native-host call only, after a physical change actually commits. Supply a
 * public sensory description, never model prose, private thoughts or phone
 * contents. This records history; it neither mutates the world nor broadcasts
 * knowledge to residents. Environmental effects need no fictitious NPC actor. */
export function recordSpiritPublicEnvironmentReceipt(world: World,
  receipt: { id: string; atSimMs: number; roomId: number; detail: string }): boolean {
  assertSimulationTaskActive();
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  if (!source.sourceId || source.stopped || typeof receipt?.id !== "string" || !receipt.id.trim() || receipt.id.length > 160
    || !Number.isFinite(receipt.atSimMs) || receipt.atSimMs < 0 || receipt.atSimMs > now
    || typeof receipt.detail !== "string" || !receipt.detail.trim() || receipt.detail.length > 1000
    || !entityExists(world, receipt.roomId) || !hasComponent(world, receipt.roomId, Room)
    || hasComponent(world, receipt.roomId, Removed)) return false;
  const room = workingMemoryEntityRef(world, receipt.roomId); if (!room) return false;
  let ledger = environmentLedgers.get(world);
  if (!ledger || ledger.sourceId !== source.sourceId) {
    ledger = { sourceId: source.sourceId, sequence: 0, receipts: [] }; environmentLedgers.set(world, ledger);
  }
  const previous = ledger.receipts.find(row => row.id === receipt.id);
  if (previous) return previous.atSimMs === receipt.atSimMs && previous.roomKey === room.key && previous.detail === receipt.detail;
  ledger.receipts.push(Object.freeze({ id: receipt.id, sourceId: source.sourceId, sequence: ++ledger.sequence,
    atSimMs: receipt.atSimMs, roomKey: room.key, roomName: room.label, detail: receipt.detail }));
  if (ledger.receipts.length > ENVIRONMENT_RETENTION) ledger.receipts.shift();
  return true;
}

/** Bounded history for other observers; does not capture, supersede or consume
 * a Narrator review. These are past outcomes, not current build authority. */
export function getRecentSpiritEnvironmentOutcomes(world: World) {
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  const ledger = environmentLedgers.get(world);
  if (!source.sourceId || source.stopped || ledger?.sourceId !== source.sourceId || !Number.isFinite(now))
    return { sourceId: source.sourceId, observedAtSimMs: now, receipts: [] as EnvironmentReceipt[], omitted: 0 };
  const recent = ledger.receipts.filter(row => row.atSimMs <= now && now - row.atSimMs <= 60_000);
  return { sourceId: source.sourceId, observedAtSimMs: now,
    receipts: recent.slice(-MAX_ENVIRONMENT_RECORDS).map(row => ({ ...row })),
    omitted: Math.max(0, recent.length - MAX_ENVIRONMENT_RECORDS) };
}

function boundedRecords(events: readonly PublicCommittedEvent[]) {
  const groups: PublicCommittedEvent[][] = [];
  const speech = new Map<string, PublicCommittedEvent[]>();
  for (const event of events) {
    // Match immutable identities as well as execution. Reused numeric slots or
    // a speaker moving rooms must not splice unrelated performances together.
    if (event.kind === "speech" && event.status === "succeeded" && event.text) {
      const key = JSON.stringify([event.executionId, event.actorKey, event.roomKey, event.targetKey, event.action]);
      let group = speech.get(key);
      if (!group) { group = []; speech.set(key, group); groups.push(group); }
      group.push(event);
    } else groups.push([event]);
  }
  groups.sort((a, b) => a[a.length - 1].sequence - b[b.length - 1].sequence);
  const isSpeech = (group: PublicCommittedEvent[]) => group[0].kind === "speech" || group[0].action === "speak";
  const actualWords = groups.filter(group => isSpeech(group) && group.some(event => !!event.text)).slice(-MAX_SPEECH_RECORDS);
  // Speech start/completion metadata must not displace the words actually said.
  const remainingSpeechSlots = MAX_SPEECH_RECORDS - actualWords.length;
  const speechMetadata = remainingSpeechSlots ? groups.filter(group => isSpeech(group) && !group.some(event => !!event.text))
    .slice(-remainingSpeechSlots) : [];
  const spoken = [...actualWords, ...speechMetadata];
  // A busy conversation cannot crowd every native physical outcome away.
  const physical = groups.filter(group => !isSpeech(group)).slice(-(MAX_RECORDS - spoken.length));
  const selected = [...physical, ...spoken].sort((a, b) => a[0].sequence - b[0].sequence);
  const representedIds: string[] = [];
  const records = selected.map(group => {
    const first = group[0], last = group[group.length - 1];
    const ids = group.map(event => event.id); representedIds.push(...ids);
    const text = group.map(event => event.text ?? "").filter(Boolean).join(" ");
    return Object.freeze({ kind: first.kind, action: first.action, status: last.status,
      executionId: first.executionId, actorKey: first.actorKey, actorName: first.actorName,
      roomKey: first.roomKey, roomName: first.roomName,
      ...(first.targetKey ? { targetKey: first.targetKey, targetName: first.targetName } : {}),
      ...(first.operation ? { operation: first.operation } : {}),
      firstSequence: first.sequence, lastSequence: last.sequence,
      firstAtSimMs: first.atSimMs, lastAtSimMs: last.atSimMs,
      receiptCount: group.length, receiptIds: Object.freeze(ids.slice(0, MAX_RECORD_IDS)),
      receiptIdsOmitted: Math.max(0, ids.length - MAX_RECORD_IDS),
      ...(text ? { spokenText: text.slice(0, MAX_SPEECH_CHARACTERS),
        spokenCharactersOmitted: Math.max(0, text.length - MAX_SPEECH_CHARACTERS) } : {}),
    });
  });
  return { records: Object.freeze(records), representedIds,
    omittedRecords: groups.length - selected.length, omittedReceipts: events.length - representedIds.length };
}

/** Native activity comparison only. Speech is never parsed as a physical fact;
 * an inspection is not a discovery; useful repetition and quiet remain choices.
 * Retain no thoughts, goal descriptions, message contents or story judgments. */
function capturePublicProgress(previous: ProgressBaseline | undefined, events: readonly PublicCommittedEvent[],
  environment: readonly EnvironmentReceipt[], now: number, eventGap: boolean, environmentGap: boolean) {
  const start = Math.max(0, now - PROGRESS_WINDOW_MS);
  const previousRows = previous?.executions.filter(row => row.lastAtSimMs >= start && row.lastAtSimMs <= now) ?? [];
  const previousByKey = new Map(previousRows.map(row => [row.key, row]));
  const current = new Map<string, ProgressExecution>();
  for (const event of events) {
    if (event.atSimMs > now) continue;
    const category: ProgressExecution["category"] = event.kind === "speech" || event.action === "speak" ? "speech"
      : event.action === "wait" || event.action === "rest" ? "wait_or_rest"
        : ["observe", "examine"].includes(event.action) || event.operation === "inspecting" || event.operation === "reading"
          ? "inspection" : "physical";
    // A native walk can start and finish in different rooms. Its committed
    // terminal receipt resolves that same execution, not a second pending job.
    // Actor identity and source-bound execution are never numeric ECS slots.
    const key = JSON.stringify([event.actorKey, event.executionId, event.action]);
    const prior = current.get(key);
    current.set(key, { key, executionId: event.executionId, actorKey: event.actorKey, actorName: event.actorName,
      roomKey: event.roomKey, roomName: event.roomName, targetKey: event.targetKey, targetName: event.targetName,
      action: event.action, operation: event.operation, category, status: event.status,
      spoken: !!prior?.spoken || event.kind === "speech" && event.status === "succeeded" && !!event.text,
      firstAtSimMs: prior?.firstAtSimMs ?? event.atSimMs, lastAtSimMs: event.atSimMs, receiptId: event.id });
  }
  const combined = new Map(previousByKey);
  for (const [key, row] of current) {
    const prior = combined.get(key);
    combined.set(key, { ...row, firstAtSimMs: prior?.firstAtSimMs ?? row.firstAtSimMs, spoken: !!prior?.spoken || row.spoken });
  }
  const allExecutions = [...combined.values()].filter(row => row.lastAtSimMs >= start).sort((a, b) => a.lastAtSimMs - b.lastAtSimMs);
  const combinedEnvironment = new Map((previous?.environment ?? []).filter(row => row.atSimMs >= start && row.atSimMs <= now).map(row => [row.id, row]));
  const currentEnvironment = environment.filter(row => row.atSimMs <= now);
  for (const row of currentEnvironment) if (row.atSimMs >= start) combinedEnvironment.set(row.id, row);
  const allEnvironment = [...combinedEnvironment.values()].sort((a, b) => a.atSimMs - b.atSimMs);
  const lost = allExecutions.length > MAX_PROGRESS_EXECUTIONS || allEnvironment.length > MAX_PROGRESS_ENVIRONMENT;
  const incompleteUntilSimMs = Math.max(previous?.incompleteUntilSimMs ?? 0,
    lost || eventGap || environmentGap ? now + PROGRESS_WINDOW_MS : 0);
  const executions = allExecutions.slice(-MAX_PROGRESS_EXECUTIONS), retainedEnvironment = allEnvironment.slice(-MAX_PROGRESS_ENVIRONMENT);
  const isNewStatus = (row: ProgressExecution) => previousByKey.get(row.key)?.status !== row.status;
  const counts = (rows: readonly ProgressExecution[], environmental: number, transitionsOnly = false): SpiritPublicProgressCounts => Object.freeze({
    physicalCompletions: rows.filter(row => row.category === "physical" && row.status === "succeeded" && (!transitionsOnly || isNewStatus(row))).length,
    inspectionCompletions: rows.filter(row => row.category === "inspection" && row.status === "succeeded" && (!transitionsOnly || isNewStatus(row))).length,
    waitOrRestCompletions: rows.filter(row => row.category === "wait_or_rest" && row.status === "succeeded" && (!transitionsOnly || isNewStatus(row))).length,
    failedActions: rows.filter(row => row.category !== "speech" && row.status === "failed" && (!transitionsOnly || isNewStatus(row))).length,
    spokenExecutions: rows.filter(row => row.spoken && (!transitionsOnly || !previousByKey.get(row.key)?.spoken)).length,
    pendingOutcomes: rows.filter(row => row.status === "pending" && (!transitionsOnly || isNewStatus(row))).length,
    environmentChanges: environmental,
  });
  const groups = new Map<string, ProgressExecution[]>();
  for (const row of executions) {
    if (row.category === "speech" || row.status !== "succeeded") continue;
    // Observe/examine are the same class of inspection for this comparison,
    // not evidence that two differently named commands found different facts.
    const key = JSON.stringify([row.actorKey, row.roomKey, row.targetKey, row.category,
      row.category === "inspection" ? null : row.operation ?? row.action]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const patterns = [...groups.values()].sort((a, b) => b.length - a.length || b.at(-1)!.lastAtSimMs - a.at(-1)!.lastAtSimMs);
  const visiblePatterns = patterns.slice(0, MAX_PROGRESS_PATTERNS).map(group => {
    const row = group.at(-1)!, ids = group.map(item => item.receiptId);
    return Object.freeze({ actorKey: row.actorKey, actorName: row.actorName, roomKey: row.roomKey, roomName: row.roomName,
      targetKey: row.targetKey, targetName: row.targetName, category: row.category, action: row.action, operation: row.operation,
      completedExecutions: group.length, currentReviewExecutions: group.filter(item => current.get(item.key)?.status === "succeeded" && isNewStatus(item)).length,
      firstAtSimMs: Math.min(...group.map(item => item.firstAtSimMs)), lastAtSimMs: row.lastAtSimMs,
      receiptIds: Object.freeze(ids.slice(-MAX_RECORD_IDS)), receiptIdsOmitted: Math.max(0, ids.length - MAX_RECORD_IDS) });
  });
  const rollingRetentionLoss = incompleteUntilSimMs > now;
  const progress: SpiritPublicProgressInput = Object.freeze({ observedAtSimMs: now, windowStartSimMs: start, windowMs: PROGRESS_WINDOW_MS,
    previousAcceptedAtSimMs: previous?.atSimMs ?? null, sincePreviousAcceptedSimMs: previous ? now - previous.atSimMs : null,
    coverage: Object.freeze({ basis: "published_public_receipts_only", allActivityRepresented: false,
      zeroCountsProveInactivity: false,
      note: "Some activity, including wait/rest, may emit no public receipt. Zero counts do not establish inactivity. Completeness describes retention of published receipts, not coverage of all behavior." }),
    completeness: Object.freeze({ complete: !rollingRetentionLoss && patterns.length <= MAX_PROGRESS_PATTERNS,
      eventLedgerGap: eventGap, environmentLedgerGap: environmentGap, rollingRetentionLoss,
      patternRowsOmitted: Math.max(0, patterns.length - MAX_PROGRESS_PATTERNS) }),
    sinceReview: counts([...current.values()], currentEnvironment.length, true), rolling: counts(executions, retainedEnvironment.length),
    inspectionContents: "not_available_in_public_action_receipts", patterns: Object.freeze(visiblePatterns) });
  return { progress, baseline: { atSimMs: now, executions, environment: retainedEnvironment, incompleteUntilSimMs } satisfies ProgressBaseline };
}

/** Capture immutable evidence before inference. Only finish(true) from the
 * still-current producer can acknowledge it. Events arriving during inference
 * remain after this capture's high-water mark for the next review. */
export function captureSpiritPublicEventReview(world: World, spirit: SpiritState, registry: SpiritRegistry,
  cycleCurrent: () => boolean) {
  let bySpirit = states.get(world); if (!bySpirit) { bySpirit = new WeakMap(); states.set(world, bySpirit); }
  const source = getCommittedEvents(world);
  let state = bySpirit.get(spirit);
  if (!state || state.registry !== registry || state.sourceId !== source.sourceId
    || state.progress && state.progress.atSimMs > readSimulationTime(world)) {
    state = { registry, sourceId: source.sourceId, acknowledgedThrough: 0, acknowledgedEnvironmentThrough: 0 }; bySpirit.set(spirit, state);
  }
  const token = {}; state.capture = token;
  const sourceCurrent = captureSpiritSourceScope(world, spirit, registry);
  const current = () => bySpirit!.get(spirit) === state && state!.capture === token && sourceCurrent() && cycleCurrent();
  const ledger = getCommittedEvents(world, state.acknowledgedThrough);
  const window = boundedRecords(ledger.events);
  const droppedBeforeWindow = ledger.gap
    ? Math.max(0, (ledger.events[0]?.sequence ?? ledger.latestSequence + 1) - state.acknowledgedThrough - 1) : 0;
  const environmentLedger = environmentLedgers.get(world);
  const environment = environmentLedger?.sourceId === source.sourceId ? environmentLedger : undefined;
  const environmentBacklog = environment?.receipts.filter(row => row.sequence > state!.acknowledgedEnvironmentThrough) ?? [];
  const environmentRecords = environmentBacklog.slice(-MAX_ENVIRONMENT_RECORDS);
  const environmentDropped = Math.max(0, (environment?.receipts[0]?.sequence ?? 1) - state.acknowledgedEnvironmentThrough - 1);
  const progress = capturePublicProgress(state.progress, ledger.events, environmentBacklog, readSimulationTime(world),
    droppedBeforeWindow > 0, environmentDropped > 0);
  const input: SpiritPublicEventInput = Object.freeze({ sourceId: ledger.sourceId,
    afterSequence: state.acknowledgedThrough, throughSequence: ledger.latestSequence,
    observedAtSimMs: readSimulationTime(world), droppedBeforeWindow,
    omittedRecords: window.omittedRecords, omittedReceipts: window.omittedReceipts, records: window.records,
    progress: progress.progress, environment: Object.freeze({ afterSequence: state.acknowledgedEnvironmentThrough,
      throughSequence: environment?.sequence ?? 0, droppedBeforeWindow: environmentDropped,
      omittedReceipts: environmentBacklog.length - environmentRecords.length, receipts: Object.freeze(environmentRecords) }) });
  let finished = false;
  return {
    input,
    finish(result: { accepted: boolean; interventions: readonly { result?: string }[]; phase?: unknown; tension?: unknown }) {
      const completedAtSimMs = readSimulationTime(world);
      if (finished || !current() || completedAtSimMs < input.observedAtSimMs) return false;
      finished = true;
      if (result.accepted) {
        state!.acknowledgedThrough = Math.max(state!.acknowledgedThrough, input.throughSequence);
        state!.acknowledgedEnvironmentThrough = Math.max(state!.acknowledgedEnvironmentThrough, input.environment.throughSequence);
        state!.progress = progress.baseline;
      }
      const phases = ["exposition", "inciting", "rising", "crisis", "climax", "falling", "resolution", "denouement"];
      // Diagnostics list only IDs actually offered to the model. A grouped
      // count/sequence interval is not proof every omitted ID was visible.
      const visibleIds = [...window.records.flatMap(row => row.receiptIds), ...environmentRecords.map(row => row.id)];
      const representedCount = window.representedIds.length + environmentRecords.length;
      const diagnosticIds = visibleIds.slice(-MAX_DIAGNOSTIC_IDS);
      const progressIds = [...new Set(input.progress.patterns.flatMap(row => row.receiptIds))];
      state!.status = Object.freeze({ sourceId: ledger.sourceId, sourceStopped: false,
        atSimMs: completedAtSimMs, observedAtSimMs: input.observedAtSimMs,
        observationAgeSimMs: completedAtSimMs - input.observedAtSimMs, accepted: result.accepted,
        acknowledgedThroughSequence: state!.acknowledgedThrough, observedThroughSequence: input.throughSequence,
        acknowledgedEnvironmentThroughSequence: state!.acknowledgedEnvironmentThrough,
        observedEnvironmentThroughSequence: input.environment.throughSequence,
        receiptIdsObserved: Object.freeze(diagnosticIds),
        receiptIdsOmitted: representedCount - diagnosticIds.length,
        progressReceiptIdsObserved: Object.freeze(progressIds),
        progressReceiptIdsOmitted: input.progress.patterns.reduce((sum, row) => sum + row.receiptIdsOmitted, 0),
        droppedBeforeWindow, omittedRecords: window.omittedRecords, omittedReceipts: window.omittedReceipts,
        environmentDroppedBeforeWindow: environmentDropped, environmentOmittedReceipts: input.environment.omittedReceipts,
        interventionsRequested: result.interventions.length,
        interventionResults: Object.freeze(result.interventions.map(row => row.result)
          .filter((value): value is string => typeof value === "string" && /^[a-z_]{1,64}$/.test(value)).slice(0, 32)),
        ...(typeof result.phase === "string" && phases.includes(result.phase) ? { phase: result.phase } : {}),
        ...(typeof result.tension === "number" && Number.isFinite(result.tension) && result.tension >= 0 && result.tension <= 1
          ? { tension: result.tension } : {}),
      });
      return true;
    },
  };
}

/** Operator diagnostics only: no thoughts, memories, message bodies or prose.
 * Source restart hides old diagnostics; stop retains explicitly historical data. */
export function getSpiritPublicEventReviewStatus(world: World, spirit: SpiritState): SpiritPublicEventReviewStatus | undefined {
  const state = states.get(world)?.get(spirit), source = getCommittedEvents(world);
  if (!state?.status || state.sourceId !== source.sourceId || state.registry.spirits.get(spirit.eid) !== spirit) return;
  return structuredClone({ ...state.status, sourceStopped: source.stopped });
}
