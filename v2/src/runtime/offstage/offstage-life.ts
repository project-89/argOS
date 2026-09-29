/** Offstage life: residents the observer cannot perceive keep living without a
 * per-resident foreground model loop. Movement and routine come from traditional
 * AI (learned procedures/behaviour trees, stored plans, schedules, idle life),
 * executed through the normal executor; what happens between people in an
 * unobserved place is summarized once per stretch of time (scene resolver).
 *
 * This module owns the per-world state, configuration, the host adapter, the
 * foreground gate and promotion/demotion bookkeeping. It changes who decides and
 * how often, never what is true: every physical effect still goes through native
 * admission, execution and receipts. Without an attention provider (or with the
 * service not installed) everyone is "presence" and nothing here engages. */
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../../ecs/world";
import { Agent, Mind, Name, ObjectType, WorkingMemoryIdentity } from "../../ecs/components";
import { readSimulationTime } from "../../ecs/simulation-time";
import { isOperatorControlled } from "../../ecs/controlled";
import { readAttention, type AttentionTier } from "../attention";
import { getCommittedSource } from "../committed-events";
import { pendingDirectAddress } from "../../cognition/agent-mind";
import { snapshotAttentionSignals, hasDueAttentionSignal } from "../../cognition/unresolved-attention";
import { wakeForegroundCognition } from "../../cognition/idle-cognition";

export interface OffstageConfig {
  /** Off switch for the whole service (foreground gate, driver and scenes). */
  enabled: boolean;
  /** Simulated gap between driver actions for one free offstage body. */
  driverIntervalMs: readonly [min: number, max: number];
  /** Simulated time an unobserved place accumulates before one scene call. */
  sceneIntervalMs: number;
  /** Wall-clock compute throttle across all places. */
  maxSceneCallsPerMinute: number;
  maxDialogueLines: number;
  maxActions: number;
  maxParticipants: number;
  /** Provider deadline (wall clock). */
  sceneTimeoutMs: number;
  /** Upper bound of one scene's progress on one goal (0..1 scale). */
  maxProgressPerScene: number;
  /** Hands-on work rate: at most this much progress per simulated minute. */
  progressPerSimMinute: number;
  /** A queued scene action not started within this simulated time is dropped. */
  sceneActionTtlMs: number;
}
export const DEFAULT_OFFSTAGE_CONFIG: OffstageConfig = Object.freeze({
  enabled: true, driverIntervalMs: [8_000, 15_000] as const, sceneIntervalMs: 60_000, maxSceneCallsPerMinute: 4,
  maxDialogueLines: 6, maxActions: 4, maxParticipants: 6, sceneTimeoutMs: 60_000,
  maxProgressPerScene: 0.35, progressPerSimMinute: 0.15, sceneActionTtlMs: 90_000,
});

/** What a world package lends the service. All optional except admission. */
export interface OffstageHost {
  /** Running and not paused: world mutations are admitted. */
  admitting(): boolean;
  /** Buildable kinds for scene outcomes that are things in the world. */
  buildCatalog?(): ReadonlyArray<{ assetId: string; name: string; what?: string; where?: string }>;
  /** Materialize a finished resident project through the host's growth path. */
  build?(input: { actor: number; roomId: number; assetId: string; name: string; description: string; near?: string }):
    { ok: true; entityId: number } | { ok: false; reason: string };
  /** Drift to a nearby free spot through the host's own movement authority. */
  stroll?(actor: number): boolean;
  /** Host presentation feed (e.g. the spatial event list). Never a perception. */
  record?(kind: "scene" | "offstage", text: string): void;
}

export type OffstageOrigin = "scene" | "learned" | "plan" | "schedule" | "idle";
export type QueuedSceneAction = { sceneId: string; roomId: number; actorKey: string; queuedAtSimMs: number;
  action: { type: string; target?: string; content?: string } };
export type TrackedOutcome = { eid: number; actorKey: string; origin: OffstageOrigin; roomId?: number; label: string;
  knownReceipts: Set<string>; dispatchedAtSimMs: number };
export type PlaceMemory = { roomKey: string; occupiedSinceSimMs?: number; lastSceneAtSimMs?: number; lastSummary?: string;
  failures: string[]; scenes: number };
export type OffstageStats = {
  scenes: number; sceneFailures: number; sceneRejected: number; droppedItems: number; dialogueLines: number;
  sceneActionsQueued: number; sceneActionsStarted: number; sceneActionsDropped: number;
  outcomes: Record<OffstageOrigin, { started: number; succeeded: number; failed: number }>;
  goalProgress: Array<{ actor: string; goal: string; delta: number; progress: number; atSimMs: number }>;
  goalsCompleted: Array<{ actor: string; goal: string; atSimMs: number }>;
  builds: Array<{ actor: string; name: string; status: "built" | "failed" | "weaver"; detail: string; atSimMs: number }>;
  promotions: number; demotions: number; offstageForegroundAdmissions: number;
  summaries: Array<{ room: string; atSimMs: number; text: string }>;
};

export type OffstageLife = {
  config: OffstageConfig; host?: OffstageHost;
  /** Caller-supplied: a foreground decision for this resident is in flight. */
  isDeliberating: (eid: number) => boolean;
  tiers: Map<number, AttentionTier>;
  nextDriverAtSimMs: Map<number, number>;
  consumedUrgency: Map<number, string>;
  places: Map<number, PlaceMemory>;
  sceneQueue: Map<number, QueuedSceneAction[]>;
  tracked: TrackedOutcome[];
  /** speaker + line of scene-authored dialogue: already answered within the scene. */
  sceneLines: Set<string>;
  /** Lower-cased names of things offstage scenes brought into the world. */
  sceneSources: Set<string>;
  sceneInFlight: boolean;
  sceneCallsAtMs: number[];
  lastRecord: Map<number, string>;
  /** plan:cursor -> when this resident began holding for a scene to answer their wait. */
  heldWaits: Map<string, number>;
  stats: OffstageStats;
  seed: number;
};
const lives = new WeakMap<World, OffstageLife>();
const emptyOutcome = () => ({ started: 0, succeeded: 0, failed: 0 });

export function installOffstageLife(world: World, options: { config?: Partial<OffstageConfig>; isDeliberating?: (eid: number) => boolean } = {}): OffstageLife {
  const config = { ...DEFAULT_OFFSTAGE_CONFIG, ...options.config };
  const [min, max] = config.driverIntervalMs;
  if (!(min > 0 && max >= min) || !(config.sceneIntervalMs > 0) || config.maxSceneCallsPerMinute < 0
    || config.maxDialogueLines < 0 || config.maxActions < 0 || config.maxParticipants < 1) throw new Error("Invalid offstage configuration");
  const previous = lives.get(world);
  const life: OffstageLife = { config, host: previous?.host, isDeliberating: options.isDeliberating ?? (() => false),
    tiers: new Map(), nextDriverAtSimMs: new Map(), consumedUrgency: new Map(), places: new Map(), sceneQueue: new Map(), heldWaits: new Map(),
    tracked: [], sceneLines: new Set(), sceneSources: new Set(), sceneInFlight: false, sceneCallsAtMs: [], lastRecord: new Map(), seed: 0x9e3779b1,
    stats: { scenes: 0, sceneFailures: 0, sceneRejected: 0, droppedItems: 0, dialogueLines: 0, sceneActionsQueued: 0,
      sceneActionsStarted: 0, sceneActionsDropped: 0,
      outcomes: { scene: emptyOutcome(), learned: emptyOutcome(), plan: emptyOutcome(), schedule: emptyOutcome(), idle: emptyOutcome() },
      goalProgress: [], goalsCompleted: [], builds: [], promotions: 0, demotions: 0, offstageForegroundAdmissions: 0, summaries: [] } };
  lives.set(world, life);
  return life;
}
export function getOffstageLife(world: World): OffstageLife | undefined {
  const life = lives.get(world);
  return life?.config.enabled ? life : undefined;
}
/** A host may register before or after the service is installed. */
export function setOffstageHost(world: World, host: OffstageHost | undefined): void {
  let life = lives.get(world);
  if (!life) { if (!host) return; life = installOffstageLife(world, { config: { enabled: false } }); }
  life.host = host;
}
export function getOffstageStats(world: World): OffstageStats | undefined {
  const life = lives.get(world); return life ? structuredClone(life.stats) : undefined;
}

/** The service may act on the world now: installed, enabled, source live, host admitting. */
export function offstageAdmitting(world: World, life = getOffstageLife(world)): life is OffstageLife {
  return !!life && !getCommittedSource(world).stopped && life.host?.admitting() !== false;
}

/** A resident with its own mind, present and active, not possessed by the operator. */
export function isOwnMindResident(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && hasComponent(world, eid, Mind) && !!Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && !isOperatorControlled(world, eid);
}
/** Walls and other structure are not things anyone idly looks at or uses. */
export function isStructure(world: World, eid: number): boolean {
  return hasComponent(world, eid, ObjectType) && ObjectType.typeId[eid] === "structural_wall";
}
export function isOffstage(world: World, eid: number): boolean { return readAttention(world, eid).tier === "offstage"; }

export function offstageRandom(life: OffstageLife): number {
  // xorshift32: deterministic per world, no Math.random in simulation choices.
  let x = life.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; life.seed = x >>> 0;
  return life.seed / 0x1_0000_0000;
}
export function nextDriverDelay(life: OffstageLife): number {
  const [min, max] = life.config.driverIntervalMs;
  return min + Math.round((max - min) * offstageRandom(life));
}

/** Record a scene-authored line: an address answered inside the scene is not a
 * pending direct address that should wake an offstage mind. */
export function sceneLineKey(speaker: string, line: string) { return `${speaker}\u0000${line.trim()}`; }

/** Something that genuinely demands this resident's own attention: someone
 * present spoke to them directly (outside a summarized scene), or a due
 * experienced signal (a knock at their door, a message they noticed). */
function urgencyKey(world: World, eid: number, life: OffstageLife): string {
  // Other offstage residents (and what scenes built) are the scene's business:
  // their words and acts are summarized, not a summons for a live model turn.
  // Otherwise two offstage minds addressing each other would chain live turns.
  const offstageNames = [...query(world, [Agent, Mind])].filter(other => other !== eid && isOwnMindResident(world, other)
    && readAttention(world, other).tier === "offstage").map(other => Name.value[other]?.toLowerCase());
  const routine = new Set([...life.sceneSources, ...offstageNames]);
  const address = pendingDirectAddress(world, eid);
  const parts: string[] = [];
  if (address && !life.sceneLines.has(sceneLineKey(address.speaker, address.content)) && !routine.has(address.speaker.toLowerCase()))
    parts.push(`address:${address.speaker}:${address.content}`);
  if (hasDueAttentionSignal(world, eid)) {
    const now = readSimulationTime(world);
    const due = snapshotAttentionSignals(world, eid).filter(row => (row.status === "unreviewed" || (row.reconsiderAtSimMs ?? Infinity) <= now)
      && !routine.has(String(row.source ?? "").toLowerCase())).map(row => row.id).sort();
    if (due.length) parts.push(`signals:${due.join(",")}`);
  }
  return parts.join("|");
}

/** Read-only readiness gate for the per-resident foreground model loop. Presence
 * and periphery are unchanged. Offstage residents do not deliberate on a cadence;
 * they think once per genuinely new urgent cause, as if someone were with them. */
export function offstageForegroundReady(world: World, eid: number): boolean {
  const life = getOffstageLife(world);
  if (!life || readAttention(world, eid).tier !== "offstage") return true;
  const key = urgencyKey(world, eid, life);
  return !!key && life.consumedUrgency.get(eid) !== key;
}
/** Call when a foreground decision actually starts; consumes an offstage urgency. */
export function noteForegroundDecisionStarted(world: World, eid: number): void {
  const life = getOffstageLife(world);
  if (!life) return;
  const tier = readAttention(world, eid).tier;
  console.log(`[Offstage] foreground decision · ${Name.value[eid]} · ${tier}`);
  if (tier !== "offstage") return;
  const key = urgencyKey(world, eid, life);
  if (key) { life.consumedUrgency.set(eid, key); life.stats.offstageForegroundAdmissions++; console.log(`[Offstage] urgent cause for ${Name.value[eid]}: ${key.slice(0, 200)}`); }
}

/** Promotion wakes a resident's own mind at once (its memory already holds the
 * scenes it lived); demotion hands the body back to the driver and resolver. */
export function trackAttentionTransitions(world: World, life: OffstageLife): void {
  const now = readSimulationTime(world);
  for (const eid of query(world, [Agent, Mind])) {
    if (!entityExists(world, eid) || !Agent.active[eid]) { life.tiers.delete(eid); continue; }
    const tier = readAttention(world, eid).tier, previous = life.tiers.get(eid);
    life.tiers.set(eid, tier);
    if (previous === undefined || previous === tier) continue;
    if (previous === "offstage") {
      life.stats.promotions++;
      // Anything the scene planned for them is theirs to choose again, live.
      const dropped = life.sceneQueue.get(eid)?.length ?? 0;
      if (dropped) { life.stats.sceneActionsDropped += dropped; life.sceneQueue.delete(eid); }
      life.consumedUrgency.delete(eid);
      if (!isOperatorControlled(world, eid)) wakeForegroundCognition(world, eid, { cause: "explicit" });
    } else if (tier === "offstage") {
      life.stats.demotions++;
      // Let an unfinished live choice settle before routine takes over.
      life.nextDriverAtSimMs.set(eid, now + nextDriverDelay(life));
    }
  }
}

/** Offstage residents skip reflection (their scenes become narrative memory);
 * appraisal, planning and goal review keep running at reduced priority. */
export function reflectionFor(world: World, eid: number, configured: boolean | undefined): boolean | undefined {
  return getOffstageLife(world) && readAttention(world, eid).tier === "offstage" ? false : configured;
}
