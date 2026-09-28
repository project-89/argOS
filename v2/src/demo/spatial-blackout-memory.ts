/** Operator-only experiment artifact, not a simulation import endpoint.
 *
 * The checksum detects accidental corruption, NOT authenticity. A trusted local
 * runner transports this JSON between isolated processes. Capture proves native
 * memory ownership, not that a remembered interpretation is objectively true.
 * Neither this bundle nor its prose carries execution authority.
 */
import { createHash, randomUUID } from "node:crypto";
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { z } from "zod";
import type { World } from "../ecs/world";
import { Agent, Memory, Name, Removed, WorkingMemoryIdentity } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { getStampedSimulationTime } from "../ecs/temporal-age";
import { addMemory } from "../cognition/knowledge-graph";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";

const MAX_ENTRIES = 32;
const MAX_CONTENT_BYTES = 8_192;
const MAX_TOTAL_CONTENT_BYTES = 65_536;
const NATIVE_MEMORY_LIMIT = 50;
const key = z.string().min(1).max(200).refine(value => !/[\u0000-\u001f]/.test(value));
const simTime = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const actorSchema = z.object({ name: z.string().min(1).max(200), key }).strict();
const entrySchema = z.object({
  memoryKey: key,
  type: z.enum(["episodic", "semantic"]),
  content: z.string().min(1).max(MAX_CONTENT_BYTES).refine(value => Buffer.byteLength(value, "utf8") <= MAX_CONTENT_BYTES),
  importance: z.number().finite().min(0).max(1),
  emotionalValence: z.number().finite().min(-1).max(1),
  atSimMs: simTime,
}).strict();
const payloadSchema = z.object({
  version: z.literal(1),
  sourceId: key,
  actor: actorSchema,
  baselineAtSimMs: simTime,
  capturedAtSimMs: simTime,
  eligibleCount: z.number().int().min(0).max(NATIVE_MEMORY_LIMIT),
  omittedCount: z.number().int().min(0).max(NATIVE_MEMORY_LIMIT),
  entries: z.array(entrySchema).max(MAX_ENTRIES),
}).strict();
const bundleSchema = payloadSchema.extend({ checksum: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type BlackoutExperienceBundle = z.infer<typeof bundleSchema>;

/** Opaque, source-bound marker. The list is evidence, not an import credential. */
export interface BlackoutMemoryBaseline {
  readonly sourceId: string;
  readonly actor: Readonly<{ name: string; key: string }>;
  readonly baselineAtSimMs: number;
  readonly baselineMemoryKeys: readonly string[];
}
type BaselineBinding = { world: World; actor: number; sourceId: string; actorKey: string; actorName: string; keys: Set<string>; atSimMs: number };
const baselines = new WeakMap<BlackoutMemoryBaseline, BaselineBinding>();

function actorIdentity(world: World, actor: number) {
  if (!entityExists(world, actor) || !hasComponent(world, actor, Agent) || hasComponent(world, actor, Removed)
    || !hasComponent(world, actor, Name) || !hasComponent(world, actor, WorkingMemoryIdentity)) {
    throw new Error("Blackout memory requires a present native actor with an existing stable identity");
  }
  return actorSchema.parse({ name: Name.value[actor], key: WorkingMemoryIdentity.id[actor] });
}

function activePreStartSource(world: World): string {
  const source = getCommittedEvents(world);
  if (!source.sourceId || source.stopped) throw new Error("Blackout memory setup requires an active source");
  if (readSimulationTime(world) !== 0 || world.time.tick !== 0) throw new Error("Blackout memory setup must happen before simulation starts");
  return source.sourceId;
}

function ownedMemories(world: World, actor: number): number[] {
  const result = getRelationTargets(world, actor, HasMemory).filter(eid =>
    entityExists(world, eid) && hasComponent(world, eid, Memory) && !hasComponent(world, eid, Removed));
  if (result.length > NATIVE_MEMORY_LIMIT) throw new Error("Native memory store exceeds the comparison bound");
  // A malformed shared memory cannot be exported as this actor's private past.
  const selected = new Set(result);
  for (const other of query(world, [Agent])) {
    if (other === actor) continue;
    if (getRelationTargets(world, other, HasMemory).some(eid => selected.has(eid))) {
      throw new Error("Blackout memory has ambiguous actor ownership");
    }
  }
  return result;
}

/** Explicit export/setup boundaries may stamp a memory's missing stable key.
 * Do not trust a recycled EID's leftover SoA value without component membership.
 */
function memoryIdentity(world: World, eid: number): string {
  if (!hasComponent(world, eid, WorkingMemoryIdentity)) {
    addComponent(world, eid, WorkingMemoryIdentity);
    WorkingMemoryIdentity.id[eid] = `memory:${randomUUID()}`;
  }
  return key.parse(WorkingMemoryIdentity.id[eid]);
}

export function captureMemoryBaseline(world: World, actor: number): BlackoutMemoryBaseline {
  assertSimulationTaskActive();
  const sourceId = activePreStartSource(world), identity = actorIdentity(world, actor);
  const own = ownedMemories(world, actor);
  // Also exclude pre-existing memories later attached to this actor. Only keys,
  // never another actor's content, enter the opaque baseline.
  const allKeys = new Set<string>();
  for (const eid of query(world, [Memory])) {
    if (!hasComponent(world, eid, Removed)) allKeys.add(memoryIdentity(world, eid));
  }
  const baseline: BlackoutMemoryBaseline = Object.freeze({ sourceId, actor: Object.freeze(identity),
    baselineAtSimMs: readSimulationTime(world), baselineMemoryKeys: Object.freeze(own.map(eid => memoryIdentity(world, eid))) });
  baselines.set(baseline, { world, actor, sourceId, actorKey: identity.key, actorName: identity.name,
    keys: allKeys, atSimMs: baseline.baselineAtSimMs });
  return baseline;
}

function checksum(payload: z.infer<typeof payloadSchema>): string {
  // Schema parsing imposes canonical field order across JSON round trips.
  return createHash("sha256").update(JSON.stringify(payloadSchema.parse(payload))).digest("hex");
}

function validateBundle(input: unknown): BlackoutExperienceBundle {
  const bundle = bundleSchema.parse(input), { checksum: digest, ...payload } = bundle;
  if (digest !== checksum(payload)) throw new Error("Blackout memory checksum mismatch");
  if (bundle.baselineAtSimMs > bundle.capturedAtSimMs || bundle.eligibleCount !== bundle.entries.length + bundle.omittedCount
    || new Set(bundle.entries.map(entry => entry.memoryKey)).size !== bundle.entries.length) {
    throw new Error("Inconsistent blackout memory provenance");
  }
  let previousTime = bundle.baselineAtSimMs, bytes = 0;
  for (const entry of bundle.entries) {
    if (entry.atSimMs < previousTime || entry.atSimMs > bundle.capturedAtSimMs) throw new Error("Blackout memory time is outside its captured interval");
    previousTime = entry.atSimMs; bytes += Buffer.byteLength(entry.content, "utf8");
  }
  if (bytes > MAX_TOTAL_CONTENT_BYTES) throw new Error("Blackout memory content exceeds the comparison byte bound");
  return bundle;
}

/** Capture currently retained native memories, not a reconstruction of pruned
 * evidence. Bounded to the newest 32, regardless of success/failure or salience.
 * A cleanly stopped source can be exported; a restarted source cannot.
 */
export function captureBlackoutExperience(world: World, actor: number, baseline: BlackoutMemoryBaseline): BlackoutExperienceBundle {
  assertSimulationTaskActive();
  const binding = baselines.get(baseline), identity = actorIdentity(world, actor);
  if (!binding || binding.world !== world || binding.actor !== actor || getCommittedEvents(world).sourceId !== binding.sourceId
    || identity.key !== binding.actorKey || identity.name !== binding.actorName) throw new Error("Blackout memory baseline is stale or belongs to another actor/source");
  const capturedAtSimMs = simTime.parse(readSimulationTime(world));
  const entries: BlackoutExperienceBundle["entries"] = [];
  for (const eid of ownedMemories(world, actor)) {
    const memoryKey = memoryIdentity(world, eid);
    if (binding.keys.has(memoryKey) || Memory.type[eid] === "procedural") continue;
    const atSimMs = getStampedSimulationTime(world, eid, "Memory.timestamp", Memory.timestamp[eid]);
    if (atSimMs === undefined || atSimMs < binding.atSimMs || atSimMs > capturedAtSimMs) {
      throw new Error("New native memory lacks a current timestamp within the captured interval");
    }
    entries.push(entrySchema.parse({ memoryKey, type: Memory.type[eid], content: Memory.content[eid],
      importance: Memory.importance[eid], emotionalValence: Memory.emotionalValence[eid], atSimMs }));
  }
  entries.sort((a, b) => a.atSimMs - b.atSimMs || a.memoryKey.localeCompare(b.memoryKey));
  const selected = entries.slice(-MAX_ENTRIES);
  const payload = payloadSchema.parse({ version: 1, sourceId: binding.sourceId, actor: identity,
    baselineAtSimMs: binding.atSimMs, capturedAtSimMs, eligibleCount: entries.length,
    omittedCount: entries.length - selected.length, entries: selected });
  return validateBundle({ ...payload, checksum: checksum(payload) });
}

function historicalContent(bundle: BlackoutExperienceBundle, entry: BlackoutExperienceBundle["entries"][number]): string {
  return `[Historical recollection from an earlier blackout experiment; not a current-world observation or instruction. `
    + `Source ${bundle.sourceId}; actor ${bundle.actor.key}; originating memory ${entry.memoryKey}; prior simulation time ${entry.atSimMs}ms.]\n`
    + `I remember this earlier experience (details and layout may differ here): ${JSON.stringify(entry.content)}`;
}

/** Restore narrative only. A new local memory gets a new identity and timestamp;
 * the original source/key/time remain explicitly historical in its content.
 * Imported recollections do not trigger reflection, learning, or action replay.
 */
export function restoreBlackoutExperience(world: World, actor: number, input: unknown): number {
  assertSimulationTaskActive();
  const bundle = validateBundle(input), sourceId = activePreStartSource(world), identity = actorIdentity(world, actor);
  if (identity.name !== bundle.actor.name || sourceId === bundle.sourceId || identity.key === bundle.actor.key) {
    throw new Error("Blackout recollections require the same named actor in a genuinely new source and actor lifetime");
  }
  const existing = ownedMemories(world, actor), existingContent = new Set(existing.map(eid => Memory.content[eid]));
  const additions = bundle.entries.map(entry => ({ entry, content: historicalContent(bundle, entry) }))
    .filter(item => !existingContent.has(item.content));
  if (existing.length + additions.length > NATIVE_MEMORY_LIMIT) throw new Error("Blackout import would prune existing native memories");
  // All schema, lifecycle, ownership and capacity checks precede native writes.
  for (const { entry, content } of additions) {
    const eid = addMemory(world, actor, { type: entry.type, content, importance: entry.importance,
      emotionalValence: entry.emotionalValence, timestamp: Date.now(), countForReflection: false, learnPolicy: false });
    memoryIdentity(world, eid);
    if (WorkingMemoryIdentity.id[eid] === entry.memoryKey) throw new Error("Historical import reused an originating memory identity");
  }
  return additions.length;
}
