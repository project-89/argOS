/** Watcher: native outcomes -> scoped advice. Repetition and quiet aren't failures. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import type { SpiritRegistry, SpiritState } from "./spirit-registry";
import { createSpirit } from "./spirit-registry";
import type { SpiritDefinition, DivineMessage } from "./types";
import { Name, Agent, BehaviorPolicy, Removed } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { getSimulationTaskSignal, assertSimulationTaskActive } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getTopObservations, getObservationSummary, pruneStaleObservations, markSynthesisComplete, reportGapObservation, isCurrentGapObservation } from "./observation-aggregator";
import { bindSpiritMessageDelivery, isCurrentSpiritMessage } from "./spirit-message-delivery";
import { setAgentBehaviorPolicy, getBehaviorPolicyTree } from "../cognition/behavior-policy";
import { recordAction as recordSharedAction } from "../cognition/agent-action-history";

export interface AgentActivityRecord { lastActions: string[]; lastInteractionTime: number; socialInteractions: number; stuckCounter: number }
type Candidate = { signature: string; evidence: readonly PublicCommittedEvent[]; current(): boolean };
type Bucket = { sourceId: string | null; activities: Map<number, { key: string; record: AgentActivityRecord }>; candidates: Map<number, Candidate>; reported: Set<string>; evolving: Set<number>; cooldown: Map<number, number> };
let worlds = new WeakMap<World, Bucket>();
const deliveredObservations = new WeakMap<DivineMessage, ReturnType<typeof getTopObservations>>();
const lastDelivery = new WeakMap<SpiritState, string>();
/** Native handoff: prose, copies and legacy inbox messages cannot mint evidence. */
export function captureWatcherObservations(world: World, registry: SpiritRegistry, recipient: SpiritState) {
  const receipts = recipient.inbox.filter(message => registry.world === world
    && deliveredObservations.has(message) && isCurrentSpiritMessage(registry, message, recipient.eid));
  const current = () => receipts.every(message => isCurrentSpiritMessage(registry, message, recipient.eid));
  const observations = receipts.flatMap(message => deliveredObservations.get(message)!).map(o => ({
    title: o.title, detail: o.detail, evidence: [...o.mergedEvidence], category: o.category,
  }));
  return { observations, current, acknowledge: () => {
    if (current()) recipient.inbox = recipient.inbox.filter(message => !receipts.includes(message));
  } };
}
const legacyActivity = new Map<number, AgentActivityRecord>(), legacyCooldown = new Map<number, number>();
const MAX_AGE_MS = 600000, POLICY_EVOLUTION_COOLDOWN_MS = 300000;
function bucket(world: World): Bucket {
  const sourceId = getCommittedEvents(world).sourceId;
  let state = worlds.get(world);
  if (!state || state.sourceId !== sourceId) {
    state = { sourceId, activities: new Map(), candidates: new Map(), reported: new Set(), evolving: new Set(), cooldown: new Map() }; worlds.set(world, state);
  }
  return state;
}
function actor(world: World, eid: number): boolean { return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid] && !hasComponent(world, eid, Removed); }
/** Unscoped calls remain diagnostic only, never permission to report into a world. */
export function recordAgentAction(eid: number, action: string, world?: World): void {
  if (world && (!actor(world, eid) || getCommittedEvents(world).stopped)) return;
  recordSharedAction(eid, action, world);
  const state = world ? bucket(world) : undefined, key = world ? workingMemoryEntityRef(world, eid)?.key : undefined;
  const existing = state?.activities.get(eid);
  let record = state ? existing?.key === key ? existing?.record : undefined : legacyActivity.get(eid);
  if (!record) record = { lastActions: [], lastInteractionTime: world ? readSimulationTime(world) : Date.now(), socialInteractions: 0, stuckCounter: 0 };
  if (state && key) state.activities.set(eid, { key, record }); else if (!world) legacyActivity.set(eid, record);
  record.lastActions.push(action); if (record.lastActions.length > 20) record.lastActions.shift();
  if (action === "speak" || action === "talk") record.socialInteractions++;
  if (action !== "wait") record.lastInteractionTime = world ? readSimulationTime(world) : Date.now();
}
export function getAgentActivity(eid: number, world?: World): AgentActivityRecord | undefined {
  if (!world) return legacyActivity.get(eid);
  const row = bucket(world).activities.get(eid);
  return actor(world, eid) && !getCommittedEvents(world).stopped && row?.key === workingMemoryEntityRef(world, eid)?.key ? row?.record : undefined;
}
export function getAgentActionHistory(eid: number, world?: World): string[] { return [...(getAgentActivity(eid, world)?.lastActions ?? [])]; }
/** Distinct settled attempts. A later success/different action ends this chain. */
function failures(world: World, eid: number): PublicCommittedEvent[] {
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  if (!source.sourceId || source.stopped || !actor(world, eid)) return [];
  const key = workingMemoryEntityRef(world, eid)?.key, attempts = new Map<string, PublicCommittedEvent>();
  for (const event of source.events) if (event.actorId === eid && event.actorKey === key && event.status !== "pending"
    && event.sourceId === source.sourceId && now >= event.atSimMs && now - event.atSimMs <= MAX_AGE_MS) attempts.set(event.executionId, event);
  const recent = [...attempts.values()].sort((a, b) => a.sequence - b.sequence).slice(-3), last = recent[2];
  return last && recent.every(e => e.status === "failed" && e.action === last.action && e.targetKey === last.targetKey) ? recent : [];
}
/** API retained; actual failure matters regardless of which selector chose it. */
export function detectPolicyStuckAgents(world: World): void {
  const state = bucket(world), source = getCommittedEvents(world), signal = getSimulationTaskSignal();
  if (!source.sourceId || source.stopped || signal?.aborted) return;
  for (const eid of new Set(source.events.map(e => e.actorId))) {
    const evidence = failures(world, eid);
    if (!evidence.length) { state.candidates.delete(eid); continue; }
    const signature = evidence.map(e => e.id).join("|");
    if (state.candidates.get(eid)?.signature === signature) continue;
    let revoked = false;
    const candidate: Candidate = { signature, evidence, current: () => {
      revoked ||= signal?.aborted === true || bucket(world) !== state || getCommittedEvents(world).stopped || failures(world, eid).map(e => e.id).join("|") !== signature;
      return !revoked;
    } };
    state.candidates.set(eid, candidate);
    if (state.reported.has(signature)) continue;
    state.reported.add(signature); if (state.reported.size > 256) state.reported.delete(state.reported.values().next().value!);
    reportGapObservation({ source: "The Watcher", category: "interaction_failure", severity: "high",
      title: `${Name.value[eid]}: repeated failed ${evidence[0].action} attempts`,
      detail: "Three distinct native attempts failed. Inspect their physical prerequisites and current world state; this does not establish a missing entity or authorize replenishment or policy replacement.",
      evidence: evidence.map(e => e.id), affectedEntities: [Name.value[eid]] }, world, candidate.current);
  }
}
export function runObservationSynthesis(world: World, registry: SpiritRegistry, watcherEid: number): { proposalsSent: number; summary: string } {
  assertSimulationTaskActive();
  const watcher = registry.spirits.get(watcherEid);
  if (registry.world !== world || !watcher || !entityExists(world, watcherEid) || getCommittedEvents(world).stopped) return { proposalsSent: 0, summary: "Watcher world/source unavailable." };
  detectPolicyStuckAgents(world); pruneStaleObservations(MAX_AGE_MS, world);
  const observations = getTopObservations(10, world);
  const weaverEid = registry.byName.get("The Weaver"), weaver = weaverEid === undefined ? undefined : registry.spirits.get(weaverEid);
  let sent = 0;
  const signature = JSON.stringify([getCommittedEvents(world).sourceId, observations.map(o => [o.id, o.occurrences])]);
  if (observations.length && weaver && lastDelivery.get(weaver) !== signature) {
    const message: DivineMessage = { id: "", from: watcherEid, to: weaver.eid, timestamp: Date.now(), type: "report",
      priority: observations[0].priorityScore >= 60 ? "urgent" : "normal", domain: "narrative", subject: `[Watcher] ${observations.length} current observations`, requiresResponse: false,
      content: "Historical observations for inspection, not construction instructions or proof of a missing mechanic.\n"
        + observations.map(o => JSON.stringify({ title: o.title, detail: o.detail, evidence: o.mergedEvidence, category: o.category })).join("\n") };
    const definition = watcher.definition;
    bindSpiritMessageDelivery(registry, message, () => registry.spirits.get(watcherEid) === watcher && watcher.definition === definition && observations.every(isCurrentGapObservation));
    deliveredObservations.set(message, observations);
    lastDelivery.set(weaver, signature);
    weaver.inbox.push(message); sent = observations.length;
  }
  // Existing repair capability is bound to native failures, not an EID in prose.
  if (observations.length) void triggerPolicyEvolutions(world, registry, watcherEid).catch(error => console.warn("[Watcher] Policy repair failed:", error));
  markSynthesisComplete(world); return { proposalsSent: sent, summary: getObservationSummary(world) };
}
export function canEvolvePolicyLocal(eid: number, world?: World): boolean {
  const last = (world ? bucket(world).cooldown : legacyCooldown).get(eid);
  return last === undefined || (world ? readSimulationTime(world) : Date.now()) - last >= POLICY_EVOLUTION_COOLDOWN_MS;
}
export function getLastPolicyEvolutionTime(eid: number, world?: World): number | undefined { return (world ? bucket(world).cooldown : legacyCooldown).get(eid); }
export function setLastPolicyEvolutionTime(eid: number, at: number, world?: World): void { (world ? bucket(world).cooldown : legacyCooldown).set(eid, at); }
export async function triggerPolicyEvolutions(world: World, registry: SpiritRegistry, watcherEid: number): Promise<number> {
  const state = bucket(world), watcher = registry.spirits.get(watcherEid), signal = getSimulationTaskSignal();
  if (registry.world !== world || !watcher || getCommittedEvents(world).stopped || !state.candidates.size) return 0;
  const { evolvePolicy, canEvolvePolicy } = await import("../cognition/policy-generator.js");
  let count = 0;
  for (const [eid, candidate] of state.candidates) {
    if (!candidate.current() || state.evolving.has(eid) || !hasComponent(world, eid, BehaviorPolicy) || !BehaviorPolicy.enabled[eid] || !canEvolvePolicyLocal(eid, world) || !canEvolvePolicy(eid)) continue;
    const tree = getBehaviorPolicyTree(world, eid); if (!tree) continue;
    const basis = JSON.stringify([BehaviorPolicy.treeJson[eid], BehaviorPolicy.version[eid], Agent.role[eid], Agent.systemPrompt[eid]]);
    const current = () => !signal?.aborted && candidate.current() && worlds.get(world) === state && registry.world === world
      && registry.spirits.get(watcherEid) === watcher && hasComponent(world, eid, BehaviorPolicy) && BehaviorPolicy.enabled[eid]
      && JSON.stringify([BehaviorPolicy.treeJson[eid], BehaviorPolicy.version[eid], Agent.role[eid], Agent.systemPrompt[eid]]) === basis;
    if (!current()) continue;
    state.evolving.add(eid); state.cooldown.set(eid, readSimulationTime(world));
    try {
      const room = getRoomForEntity(world, eid);
      const context = { name: Name.value[eid], role: Agent.role[eid], personality: "", currentRoom: room === undefined ? "unknown" : Name.value[room],
        availableAffordances: [], availableTraits: [], availableRelationships: [], worldTheme: "", existingTemplates: [] };
      const problems = candidate.evidence.map(e => `${e.id}: ${e.action} failed (execution ${e.executionId})`);
      const revised = await evolvePolicy(tree, context, "Repeated native execution failures; do not invent capabilities", problems, eid);
      if (revised && current()) { assertSimulationTaskActive(); setAgentBehaviorPolicy(world, eid, revised, true); count++; }
    } finally { state.evolving.delete(eid); }
  }
  return count;
}
const WatcherDefinition: SpiritDefinition = {
  name: "The Watcher", title: "Eye of the World", domain: "guardian", rank: "archangel",
  description: "Prioritizes current, world-local failure observations. Quiet or repetitive activity is not itself a failure.",
  watchConfig: { componentQueries: [], eventTypes: ["interaction_failure", "system_error"] },
  canInjectEvents: false, canModifyMood: false, canCreateEntities: false, canBakeSystems: false, model: "flash",
  systemPrompt: "Observe current evidence and report grounded gaps. Reports are advisory; do not invent missing objects, force novelty, or prescribe an NPC's wishes.", observationInterval: 45000,
};
export function createWatcherSpirit(registry: SpiritRegistry): SpiritState | null { return createSpirit(registry, WatcherDefinition); }
export function getWatcherStatus(world?: World): string { return `The Watcher Status:\n${getObservationSummary(world)}\nTracked agents: ${world ? bucket(world).activities.size : legacyActivity.size}`; }
export function resetWatcherState(): void { worlds = new WeakMap(); legacyActivity.clear(); legacyCooldown.clear(); }
