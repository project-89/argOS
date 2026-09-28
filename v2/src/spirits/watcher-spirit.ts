/** Watcher: native outcomes and stagnation -> scoped advice relayed to Weaver, Narrator and God. */
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import type { SpiritRegistry, SpiritState } from "./spirit-registry";
import { createSpirit, getActiveSpirits } from "./spirit-registry";
import type { SpiritDefinition, DivineMessage } from "./types";
import { Name, Agent, BehaviorPolicy, Removed, Goal, ObjectType, PhysicalObject } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { getSpiritPublicEventReviewStatus } from "./spirit-public-event-review";
import type { AggregatedObservation, GapObservation } from "./observation-aggregator";
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
type Liveliness = { company: Map<number, number>; goals: Map<number, { goal: number; description: string; progress: number; since: number }>;
  tension: { at: number; value: number }[]; startedAt?: number; relayed: Map<string, { signature: string; at: number }> };
type Bucket = { sourceId: string | null; activities: Map<number, { key: string; record: AgentActivityRecord }>; candidates: Map<number, Candidate>; reported: Set<string>; evolving: Set<number>; cooldown: Map<number, number>; life: Liveliness };
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
    state = { sourceId, activities: new Map(), candidates: new Map(), reported: new Set(), evolving: new Set(), cooldown: new Map(),
      life: { company: new Map(), goals: new Map(), tension: [], relayed: new Map() } }; worlds.set(world, state);
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
// ---------------------------------------------------------------------------
// Liveliness: the Watcher watches the world, not only its failures.
// Deterministic detectors over native state; no model call.
// ---------------------------------------------------------------------------
export const STAGNATION_LIMITS = Object.freeze({ idleShare: 0.6, idleWindow: 10, idleMinChoices: 5, quietCompanyMs: 40_000,
  flatTensionReviews: 3, flatTensionBand: 0.05, stuckGoalMs: 120_000, untouchedObjectMs: 180_000,
  narratorRelayMs: 60_000, godRelayMs: 90_000, godMinPriority: 40 });
const IDLE = new Set(["wait", "rest", "sleep", "idle", "pause"]);
const LIFE_CATEGORIES = new Set(["behavioral_gap", "social_gap", "narrative_gap"]);
const residents = (world: World) => [...query(world, [Agent, Name])].filter(eid => actor(world, eid));
function idleShare(world: World, eid: number): { share: number; choices: number } {
  const recent = getAgentActionHistory(eid, world).slice(-STAGNATION_LIMITS.idleWindow);
  return { share: recent.length ? recent.filter(action => IDLE.has(action)).length / recent.length : 0, choices: recent.length };
}
function lastSpeechIn(world: World, room: number): number {
  const source = getCommittedEvents(world);
  let last = -Infinity;
  for (const event of source.events) if (event.kind === "speech" && event.roomId === room && event.sourceId === source.sourceId) last = Math.max(last, event.atSimMs);
  return last;
}
function topGoal(world: World, eid: number): number | undefined {
  return safeGetRelationTargets(world, eid, HasGoal).filter(goal => hasComponent(world, goal, Goal) && Goal.status[goal] === "active")
    .sort((a, b) => (Goal.priority[b] ?? 0) - (Goal.priority[a] ?? 0))[0];
}
function narratorTension(world: World, registry?: SpiritRegistry): { at: number; value: number } | undefined {
  const eid = registry?.byName.get("The Narrator"), narrator = eid === undefined ? undefined : registry!.spirits.get(eid);
  if (!narrator) return;
  const review = getSpiritPublicEventReviewStatus(world, narrator);
  if (review && typeof review.tension === "number") return { at: review.atSimMs, value: review.tension };
  const tension = narrator.narrativeState?.tension;
  return typeof tension === "number" && Number.isFinite(tension) ? { at: readSimulationTime(world), value: tension } : undefined;
}
const touched = (world: World, eid: number) => getCommittedEvents(world).events.some(event => event.targetId === eid);

/** Report stagnation as ordinary gap observations: idle residents, silent
 * company, flat story tension, goals without progress, untouched story objects. */
export function detectStagnation(world: World, registry?: SpiritRegistry): GapObservation[] {
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  if (!source.sourceId || source.stopped || !Number.isFinite(now)) return [];
  const life = bucket(world).life, found: GapObservation[] = [], L = STAGNATION_LIMITS;
  life.startedAt ??= now;
  const report = (obs: Omit<GapObservation, "id" | "timestamp" | "source">, current: () => boolean) =>
    found.push(reportGapObservation({ source: "The Watcher", ...obs }, world, () => { try { return current(); } catch { return false; } }));
  const people = residents(world);
  for (const eid of people) {
    const name = Name.value[eid], idle = idleShare(world, eid);
    if (idle.choices >= L.idleMinChoices && idle.share > L.idleShare) report({ category: "behavioral_gap", severity: "medium",
      title: `${name} is mostly waiting`, affectedEntities: [name],
      detail: `${name} spent ${Math.round(idle.share * 100)}% of their last ${idle.choices} choices waiting or resting. They need something to want, fear, answer or go and see.` },
      () => actor(world, eid) && idleShare(world, eid).share > L.idleShare);
    const goal = topGoal(world, eid), row = life.goals.get(eid);
    if (goal === undefined) { life.goals.delete(eid); continue; }
    const description = Goal.description[goal] ?? "", progress = Goal.progress[goal] ?? 0;
    if (!row || row.goal !== goal || row.description !== description || row.progress !== progress) { life.goals.set(eid, { goal, description, progress, since: now }); continue; }
    if (now - row.since > L.stuckGoalMs) report({ category: "behavioral_gap", severity: "medium", title: `${name} is stuck on a goal`, affectedEntities: [name],
      detail: `${name} has pursued "${description.slice(0, 200)}" for ${Math.round((now - row.since) / 1000)}s without progress. A way in, an obstacle with a face, or a reason to give it up would move them.` },
      () => topGoal(world, eid) === goal && (Goal.progress[goal] ?? 0) === progress && Goal.status[goal] === "active");
  }
  const rooms = new Map<number, number[]>();
  for (const eid of people) { const room = getRoomForEntity(world, eid); if (room !== undefined) rooms.set(room, [...(rooms.get(room) ?? []), eid]); }
  for (const room of [...life.company.keys()]) if ((rooms.get(room)?.length ?? 0) < 2) life.company.delete(room);
  for (const [room, present] of rooms) {
    if (present.length < 2) continue;
    const since = life.company.get(room) ?? now; life.company.set(room, since);
    const quietSince = Math.max(since, lastSpeechIn(world, room)), names = present.map(eid => Name.value[eid]);
    if (now - quietSince > L.quietCompanyMs) report({ category: "social_gap", severity: "medium", title: `Silent company in ${Name.value[room]}`,
      roomContext: Name.value[room], affectedEntities: names,
      detail: `${names.join(", ")} have shared ${Name.value[room]} for ${Math.round((now - quietSince) / 1000)}s without a word spoken. Something to say, show, ask or argue about would open it.` },
      () => residents(world).filter(eid => getRoomForEntity(world, eid) === room).length >= 2 && lastSpeechIn(world, room) <= quietSince);
  }
  // One sample per Narrator review; without review receipts, sample the ledger
  // no more often than a review cadence (20s sim).
  const tension = narratorTension(world, registry), last = life.tension.at(-1);
  if (tension && (!last || tension.at !== last.at && (tension.at !== now || now - last.at >= 20_000))) {
    life.tension.push(tension); if (life.tension.length > 12) life.tension.shift();
  }
  const recent = life.tension.slice(-L.flatTensionReviews);
  if (recent.length >= L.flatTensionReviews && Math.max(...recent.map(r => r.value)) - Math.min(...recent.map(r => r.value)) < L.flatTensionBand) {
    const value = recent.at(-1)!.value, count = life.tension.length;
    report({ category: "narrative_gap", severity: value < 0.4 ? "high" : "medium", title: "Story tension is flat",
      detail: `Story tension has held near ${value.toFixed(2)} across the last ${recent.length} Narrator reviews. Pressure is due: a discovery, an arrival, a message, a secret brushing the surface.` },
      () => life.tension.length === count);
  }
  if (now - life.startedAt >= L.untouchedObjectMs) {
    const untouched = [...query(world, [PhysicalObject, Name])].filter(eid => PhysicalObject.portable[eid] && !hasComponent(world, eid, Agent)
      && !hasComponent(world, eid, Removed) && !["food_item", "smartphone"].includes(hasComponent(world, eid, ObjectType) ? ObjectType.typeId[eid] : "")
      && !touched(world, eid)).slice(0, 3);
    if (untouched.length) report({ category: "narrative_gap", severity: "low", title: "Story objects nobody has touched",
      affectedEntities: untouched.map(eid => Name.value[eid]),
      detail: `No one has handled ${untouched.map(eid => Name.value[eid]).join(", ")} in ${Math.round((now - life.startedAt) / 1000)}s. A reason to find, move, read or hide them would bring them into play.` },
      () => untouched.every(eid => !touched(world, eid)));
  }
  return found;
}

/** Stagnation reaches the Narrator (story sag) and God (world needs) as
 * scoped messages. Only current observations travel; resolved ones expire. */
function relayStagnation(world: World, registry: SpiritRegistry, watcher: SpiritState): number {
  const L = STAGNATION_LIMITS, life = bucket(world).life, now = readSimulationTime(world);
  const rows = getTopObservations(20, world).filter(o => LIFE_CATEGORIES.has(o.category) && o.reporters.includes("The Watcher"));
  if (!rows.length) return 0;
  const definition = watcher.definition, eid = watcher.eid;
  const send = (key: string, to: number, rows: AggregatedObservation[], subject: string, lead: string, tail: string,
    priority: DivineMessage["priority"], every: number, deliver: (message: DivineMessage) => void) => {
    const signature = rows.map(o => o.title).sort().join("|"), last = life.relayed.get(key);
    if (last && last.signature === signature && now - last.at < every * 2 || last && now - last.at < every) return 0;
    const message: DivineMessage = { id: "", from: eid, to, timestamp: Date.now(), type: "report", priority, domain: "narrative",
      senderLabel: definition.name, subject, requiresResponse: false,
      content: [lead, ...rows.map(o => `- ${o.title}: ${o.detail}`), tail].join("\n") };
    bindSpiritMessageDelivery(registry, message, () => registry.spirits.get(eid) === watcher && watcher.definition === definition && rows.some(isCurrentGapObservation));
    deliver(message); life.relayed.set(key, { signature, at: now }); return 1;
  };
  let sent = 0;
  const narratorEid = registry.byName.get("The Narrator"), narrator = narratorEid === undefined ? undefined : registry.spirits.get(narratorEid);
  const rowsForNarrator = rows.slice(0, 4);
  if (narrator && getActiveSpirits(registry).includes(narrator)) sent += send("narrator", narrator.eid, rowsForNarrator, "[Watcher] The story is sagging",
    "The Watcher sees the living town going slack (native activity, no interpretation):",
    "These are openings for pressure through your world grants and the residents' daemons: something to hear, find, receive, be asked or be tempted by.",
    rows[0].priorityScore >= 60 ? "high" : "normal", L.narratorRelayMs, message => narrator.inbox.push(message));
  const needs = rows.filter(o => o.priorityScore >= L.godMinPriority).slice(0, 3);
  if (needs.length && registry.godAgentEid !== undefined) sent += send("god", registry.godAgentEid, needs, "[Watcher] The world needs something to happen",
    "World needs relayed by the Watcher (deterministic stagnation signals):",
    "Consider staging an event, placing a story prop, approving a build, or commissioning a system that gives these residents something to do, want or discover.",
    needs[0].priorityScore >= 60 ? "high" : "normal", L.godRelayMs, message => registry.messageQueue.push(message));
  return sent;
}

export function runObservationSynthesis(world: World, registry: SpiritRegistry, watcherEid: number): { proposalsSent: number; summary: string } {
  assertSimulationTaskActive();
  const watcher = registry.spirits.get(watcherEid);
  if (registry.world !== world || !watcher || !entityExists(world, watcherEid) || getCommittedEvents(world).stopped) return { proposalsSent: 0, summary: "Watcher world/source unavailable." };
  detectPolicyStuckAgents(world); detectStagnation(world, registry); pruneStaleObservations(MAX_AGE_MS, world);
  relayStagnation(world, registry, watcher);
  const observations = getTopObservations(10, world);
  const weaverEid = registry.byName.get("The Weaver"), weaver = weaverEid === undefined ? undefined : registry.spirits.get(weaverEid);
  let sent = 0;
  // Persisting stagnation is one observation, not a fresh report every cycle.
  const signature = JSON.stringify([getCommittedEvents(world).sourceId, observations.map(o => `${o.id}:${LIFE_CATEGORIES.has(o.category) ? 0 : o.occurrences}`).sort()]);
  if (observations.length && weaver && lastDelivery.get(weaver) !== signature) {
    const message: DivineMessage = { id: "", from: watcherEid, to: weaver.eid, timestamp: Date.now(), type: "report",
      priority: observations[0].priorityScore >= 60 ? "urgent" : "normal", domain: "narrative", subject: `[Watcher] ${observations.length} current observations`, requiresResponse: false,
      content: "Current observations from the Watcher: failures to inspect and stagnation to answer with something residents can use, want or discover.\n"
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
  description: "Watches the living world: repeated failures, and also stagnation (residents stuck waiting, silent company, flat story tension, goals without progress, untouched story objects). Relays story sag to the Narrator and world needs to God.",
  watchConfig: { componentQueries: [], eventTypes: ["interaction_failure", "system_error"] },
  canInjectEvents: false, canModifyMood: false, canCreateEntities: false, canBakeSystems: false, model: "flash",
  systemPrompt: "Watch the world as it is lived. Report what is failing and what has gone slack, and send it where it can become story or world: the Narrator, the Weaver and God.", observationInterval: 45000,
};
export function createWatcherSpirit(registry: SpiritRegistry): SpiritState | null { return createSpirit(registry, WatcherDefinition); }
export function getWatcherStatus(world?: World): string { return `The Watcher Status:\n${getObservationSummary(world)}\nTracked agents: ${world ? bucket(world).activities.size : legacyActivity.size}`; }
export function resetWatcherState(): void { worlds = new WeakMap(); legacyActivity.clear(); legacyCooldown.clear(); }
