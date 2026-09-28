/** Native in-world document work. No host filesystem, mail or external tools. */
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import type { AgentAction } from "../cognition/agent-mind";
import type { AffordanceDefinition } from "./schema";
import { Agent, Goal, GoalWorkProgress, Name, ObjectState, WikiDoc, WorkDocument, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getAgentSensoryCapabilities } from "../cognition/sensory-capabilities";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal, assertSimulationTaskActive } from "../runtime/task-scope";
import { subscribeSimulationBoundaries } from "../runtime/simulation-timeline";
import { readGoalSuccessContract } from "../cognition/goal-contract";
import { DOCUMENT_VERBS, WORK_DOCUMENT_INITIAL_VALUES } from "./work-document-schema";

const VERBS = DOCUMENT_VERBS;
type Verb = typeof VERBS[number];
export function isDocumentOperation(action: { type: string; content?: string }): boolean {
  return action.type === "interact" && VERBS.includes(action.content?.trim().split(/\s+/)[0].toLowerCase() as Verb);
}
function key(world: World, eid: number | undefined): string | undefined {
  return eid !== undefined && entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
    ? WorkingMemoryIdentity.id[eid] : undefined;
}
function device(world: World, target: number): number | undefined {
  const wanted = WorkDocument.deviceKey[target]; if (!wanted) return;
  const found = [...query(world, [WorkingMemoryIdentity])].filter(eid => key(world, eid) === wanted);
  return found.length === 1 ? found[0] : undefined;
}
function available(world: World, actor: number, target: number): boolean {
  if (!entityExists(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
    || !entityExists(world, target) || !hasComponent(world, target, WorkDocument) || !hasComponent(world, target, WikiDoc)
    || getAgentSensoryCapabilities(world, actor).visual <= 0) return false;
  const room = getRoomForEntity(world, actor), container = getDirectContainer(world, target);
  if (room === undefined || container !== room && container !== actor) return false;
  if (WorkDocument.deviceKey[target]) {
    const tool = device(world, target);
    if (tool === undefined || getRoomForEntity(world, tool) !== room || !hasComponent(world, tool, ObjectState)
      || !["powered_on", "in_use"].includes(ObjectState.current[tool])) return false;
    const support = getDirectContainer(world, tool);
    if (support !== room && support !== actor) return false;
  }
  return Number.isSafeInteger(WorkDocument.revision[target]) && WorkDocument.revision[target] >= 0
    && ["draft", "reviewed", "finished"].includes(WikiDoc.status[target]);
}

/** Authoring attaches data, not a pending action. Existing body text is retained. */
export function initializeWorkDocument(world: World, target: number, options: { deviceEid?: number } = {}): void {
  assertSimulationTaskActive();
  if (!entityExists(world, target) || !hasComponent(world, target, Name)) throw new Error("A work document requires a named live entity");
  if (hasComponent(world, target, WorkDocument)) throw new Error("Work document already initialized");
  const deviceKey = options.deviceEid === undefined ? "" : workingMemoryEntityRef(world, options.deviceEid)?.key;
  if (deviceKey === undefined) throw new Error("Document device does not exist");
  workingMemoryEntityRef(world, target);
  if (!hasComponent(world, target, WikiDoc)) {
    addComponent(world, target, WikiDoc); WikiDoc.title[target] = Name.value[target]; WikiDoc.body[target] = "";
    WikiDoc.createdAt[target] = Date.now();
  }
  WikiDoc.status[target] = "draft"; WikiDoc.updatedAt[target] = Date.now();
  addComponent(world, target, WorkDocument);
  WorkDocument.revision[target] = WORK_DOCUMENT_INITIAL_VALUES.revision; WorkDocument.reviewedRevision[target] = WORK_DOCUMENT_INITIAL_VALUES.reviewedRevision;
  WorkDocument.deviceKey[target] = deviceKey; WorkDocument.lastWriterKey[target] = WORK_DOCUMENT_INITIAL_VALUES.lastWriterKey; WorkDocument.completedAtSimMs[target] = WORK_DOCUMENT_INITIAL_VALUES.completedAtSimMs;
  if (hasComponent(world, target, ObjectState)) ObjectState.current[target] = "draft";
}

/** The same native status already disclosed by the read affordance. This is
 * not document content, revision review, or proof of the truth of its prose.
 * Perception callers must additionally require a personally visible target. */
export function getAccessibleDocumentStatus(world: World, actor: number, target: number): string | undefined {
  return available(world, actor, target) ? WikiDoc.status[target] : undefined;
}

export function getDocumentAffordances(world: World, actor: number, target: number): AffordanceDefinition[] {
  if (!available(world, actor, target)) return [];
  const revision = WorkDocument.revision[target], status = WikiDoc.status[target];
  const offer = (name: Verb, description: string): AffordanceDefinition => ({ name, requires: [], description });
  // Describe the native process before all of its commands become available.
  // This is capability knowledge, not a prescribed plan or an executable offer
  // for a future revision. Current command admission below remains unchanged.
  const result = [offer("read_document", `Read actual text (revision ${revision}, ${status}); unread text stays private. Lifecycle rules, not available commands: write_document appends a draft and clears review; review_document requires nonempty text; finish_document requires review of the current revision. Finish does not place/deliver the artifact or finish a work period. Finished text cannot be edited.`)];
  if (status !== "finished") {
    result.push(offer("write_document", `Append your own text with write_document {"revision":${revision},"text":"your paragraph"}. Writing takes simulation time; it does not finish the document.`));
    if (WikiDoc.body[target]?.trim() && WorkDocument.reviewedRevision[target] !== revision)
      result.push(offer("review_document", `Read and review the current text with review_document {"revision":${revision}}.`));
    if (WikiDoc.body[target]?.trim() && WorkDocument.reviewedRevision[target] === revision)
      result.push(offer("finish_document", `Finalize the reviewed document with finish_document {"revision":${revision}}. This finishes an artifact, not a scheduled work period.`));
  }
  return result;
}

function goalContract(goal: number): string { return JSON.stringify([Goal.createdAt[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]); }
/** Goals need persistent identity, but are not named perceptible world objects. */
function goalKey(world: World, goal: number): string {
  if (!hasComponent(world, goal, WorkingMemoryIdentity)) {
    addComponent(world, goal, WorkingMemoryIdentity);
    WorkingMemoryIdentity.id[goal] = `entity:${randomUUID()}`;
  } else if (!WorkingMemoryIdentity.id[goal]?.trim()) {
    WorkingMemoryIdentity.id[goal] = `entity:${randomUUID()}`;
  }
  return WorkingMemoryIdentity.id[goal];
}
type WorkRoom = { roomKey: string; roomName: string; workedMs: number };
function goalWorkRooms(world: World, actor: number, goal: number): WorkRoom[] {
  if (!entityExists(world, actor) || !hasComponent(world, actor, Agent) || !entityExists(world, goal)
    || !hasComponent(world, goal, Goal) || !hasComponent(world, goal, GoalWorkProgress)
    || !getRelationTargets(world, actor, HasGoal).includes(goal)
    || GoalWorkProgress.actorKey[goal] !== key(world, actor) || GoalWorkProgress.goalKey[goal] !== key(world, goal)
    || GoalWorkProgress.contract[goal] !== goalContract(goal)) return [];
  try {
    const rows = JSON.parse(GoalWorkProgress.roomsJson[goal]);
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.roomKey === "string" && typeof row.roomName === "string"
      && Number.isFinite(row.workedMs) && row.workedMs >= 0).slice(-32) : [];
  } catch { return []; }
}
export function readProductiveGoalTime(world: World, actor: number, goal: number, roomName: string): number {
  return goalWorkRooms(world, actor, goal).filter(row => row.roomName === roomName).reduce((sum, row) => sum + row.workedMs, 0);
}
function workGoals(world: World, actor: number, room: number) {
  const applies = (proof: any, depth = 0): boolean => !!proof && depth < 16 && (proof.type === "productive_time"
    ? proof.roomName === Name.value[room] && Number.isFinite(proof.atLeastMs) && proof.atLeastMs > 0
    : ["all_of", "any_of"].includes(proof.type) && Array.isArray(proof.conditions) && proof.conditions.some((child: unknown) => applies(child, depth + 1)));
  return getRelationTargets(world, actor, HasGoal).flatMap(goal => {
    if (!hasComponent(world, goal, Goal) || Goal.status[goal] !== "active") return [];
    try {
      const proof = readGoalSuccessContract(goal);
      if (!applies(proof)) return [];
      return [{ goal, key: goalKey(world, goal), contract: goalContract(goal),
        roomKey: workingMemoryEntityRef(world, room)!.key, roomName: Name.value[room] }];
    } catch { return []; }
  });
}

export type DocumentWorkAdmission = Readonly<{ durationMs: number }>;
type IssuedWork = { world: World; actor: number; target: number; verb: Verb; text?: string; startedAt: number;
  durationMs: number; actorKey: string; sourceId: string; signal?: AbortSignal; basis: string;
  goals: ReturnType<typeof workGoals>; current(): boolean; dispose(): void; canceled: boolean; consumed: boolean };
const issued = new WeakMap<DocumentWorkAdmission, IssuedWork>();
function basis(world: World, actor: number, target: number): string {
  const room = getRoomForEntity(world, actor), tool = device(world, target);
  return JSON.stringify([key(world, actor), key(world, room), key(world, target), getDirectContainer(world, target),
    WorkDocument.revision[target], WorkDocument.reviewedRevision[target], WorkDocument.deviceKey[target],
    WikiDoc.title[target], WikiDoc.body[target], WikiDoc.status[target], key(world, tool),
    tool === undefined ? null : [ObjectState.current[tool], getDirectContainer(world, tool)]]);
}
/** Pure readiness check shared by the stored-plan selector and timed admission.
 * Checking a proposal never issues execution authority or counts as work. */
function parseDocumentCommand(world: World, actor: number, target: number, action: { type: string; content?: string }): { verb: Verb; text?: string; durationMs: number } | undefined {
  if (!isDocumentOperation(action) || !available(world, actor, target)) return;
  const verb = action.content!.trim().split(/\s+/)[0].toLowerCase() as Verb;
  if (!getDocumentAffordances(world, actor, target).some(row => row.name === verb)) return;
  const args = action.content!.trim().replace(/^\S+\s*/, "");
  let text: string | undefined;
  if (verb !== "read_document") {
    try {
      const parsed = JSON.parse(args);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || Object.keys(parsed).some(k => !["revision", ...(verb === "write_document" ? ["text"] : [])].includes(k))
        || !Number.isSafeInteger(parsed.revision) || parsed.revision !== WorkDocument.revision[target]) return;
      if (verb === "write_document") {
        if (typeof parsed.text !== "string" || !parsed.text.trim() || parsed.text.length > 1000
          || (WikiDoc.body[target]?.length || 0) + parsed.text.length + 2 > 20_000) return;
        text = parsed.text.trim();
      }
    } catch { return; }
  } else if (args) return;
  const durationMs = verb === "write_document" ? Math.max(2000, text!.length * 50) : verb === "review_document" ? 2000 : verb === "read_document" ? 1200 : 600;
  return { verb, text, durationMs };
}
export function isDocumentCommandAvailable(world: World, actor: number, target: number, content: string): boolean {
  return !!parseDocumentCommand(world, actor, target, { type: "interact", content });
}
/** Describe a currently valid native command, not its prose or effect-array size.
 * Reading gathers information; review/finalization still mutate the artifact.
 * This pure query grants neither execution authority nor productive-time credit. */
export function getDocumentCommandEffect(world: World, actor: number, target: number,
  action: { type: string; content?: string }): "observation" | "mutation" | undefined {
  const command = parseDocumentCommand(world, actor, target, action);
  return command ? command.verb === "read_document" ? "observation" : "mutation" : undefined;
}
export function captureDocumentWork(world: World, actor: number, target: number, action: AgentAction): DocumentWorkAdmission | undefined {
  assertSimulationTaskActive();
  const command = parseDocumentCommand(world, actor, target, action);
  if (!command) return;
  const { verb, text, durationMs } = command;
  const sourceId = getCommittedEvents(world).sourceId ?? startCommittedEvents(world);
  if (getCommittedEvents(world).stopped) return;
  const actorKey = workingMemoryEntityRef(world, actor)!.key;
  workingMemoryEntityRef(world, getRoomForEntity(world, actor)!); workingMemoryEntityRef(world, target);
  const captured = basis(world, actor, target), signal = getSimulationTaskSignal();
  const token = Object.freeze({ durationMs });
  const row: IssuedWork = { world, actor, target, verb, text, durationMs, actorKey, sourceId, signal,
    startedAt: readSimulationTime(world), basis: captured, goals: workGoals(world, actor, getRoomForEntity(world, actor)!),
    current: () => !row.canceled && !signal?.aborted && !getCommittedEvents(world).stopped
      && getCommittedEvents(world).sourceId === sourceId && available(world, actor, target) && basis(world, actor, target) === captured,
    dispose: () => {}, canceled: false, consumed: false };
  row.dispose = subscribeSimulationBoundaries(world, () => { if (!row.current()) row.canceled = true; });
  issued.set(token, row); return token;
}
export function cancelDocumentWork(token: DocumentWorkAdmission | undefined): void {
  const row = token && issued.get(token); if (!row) return; row.canceled = true; row.dispose(); issued.delete(token!);
}
export function commitDocumentWork(world: World, actor: number, target: number, token: DocumentWorkAdmission | undefined): { success: boolean; message: string; changes: string[] } {
  assertSimulationTaskActive();
  const fail = (message: string) => ({ success: false, message, changes: [] });
  const row = token && issued.get(token);
  if (!row || row.world !== world || row.actor !== actor || row.target !== target || row.consumed)
    return fail("Document work requires a valid timed operation and the current document revision.");
  row.consumed = true; row.dispose();
  if (!row.current() || readSimulationTime(world) < row.startedAt + row.durationMs)
    return fail("Document work was interrupted or its original document/device changed.");
  const { verb } = row;
  if (verb === "read_document") return { success: true, changes: [],
    message: `Document revision ${WorkDocument.revision[target]} (${WikiDoc.status[target]}): ${JSON.stringify(WikiDoc.body[target])}` };
  if (verb === "write_document") {
    WikiDoc.body[target] = [WikiDoc.body[target], row.text].filter(Boolean).join("\n\n");
    WorkDocument.revision[target]++; WorkDocument.reviewedRevision[target] = -1;
    WorkDocument.lastWriterKey[target] = row.actorKey; WikiDoc.status[target] = "draft";
  } else if (verb === "review_document") {
    WorkDocument.reviewedRevision[target] = WorkDocument.revision[target]; WikiDoc.status[target] = "reviewed";
  } else {
    WikiDoc.status[target] = "finished"; WorkDocument.completedAtSimMs[target] = readSimulationTime(world);
  }
  WikiDoc.updatedAt[target] = Date.now();
  if (hasComponent(world, target, ObjectState)) ObjectState.current[target] = WikiDoc.status[target];
  if (verb === "write_document" || verb === "review_document") for (const saved of row.goals) {
    if (!entityExists(world, saved.goal) || !hasComponent(world, saved.goal, Goal) || Goal.status[saved.goal] !== "active"
      || key(world, saved.goal) !== saved.key || goalContract(saved.goal) !== saved.contract
      || !getRelationTargets(world, actor, HasGoal).includes(saved.goal)) continue;
    const rooms = goalWorkRooms(world, actor, saved.goal);
    const current = rooms.find(room => room.roomKey === saved.roomKey && room.roomName === saved.roomName);
    if (current) current.workedMs += row.durationMs;
    else rooms.push({ roomKey: saved.roomKey, roomName: saved.roomName, workedMs: row.durationMs });
    addComponent(world, saved.goal, GoalWorkProgress);
    GoalWorkProgress.actorKey[saved.goal] = row.actorKey; GoalWorkProgress.goalKey[saved.goal] = saved.key;
    GoalWorkProgress.contract[saved.goal] = saved.contract; GoalWorkProgress.roomsJson[saved.goal] = JSON.stringify(rooms.slice(-32));
  }
  const message = verb === "write_document" ? `Saved revision ${WorkDocument.revision[target]}; the document is still a draft.`
    : verb === "review_document" ? `Reviewed revision ${WorkDocument.revision[target]}: ${JSON.stringify(WikiDoc.body[target])}`
    : "The reviewed document is finalized. This does not complete an entire scheduled work period.";
  return { success: true, message, changes: [`document: ${Name.value[target]} revision=${WorkDocument.revision[target]} status=${WikiDoc.status[target]}`] };
}
