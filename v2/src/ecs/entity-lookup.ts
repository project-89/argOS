import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "./world";
import { Agent, Name, ObjectType, PhysicalObject, Room } from "./components";
import type { EntityRegistry } from "./tools";

function normalizeName(raw: string): string {
  // Normalize common formatting variations:
  // - "Iron_Ingot" -> "iron ingot"
  // - "food [fresh]" -> "food" (strip state annotations)
  // - trim + lowercase + collapse spaces
  return String(raw || "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreCandidate(queryNorm: string, candidateNorm: string): number {
  if (!candidateNorm) return 0;
  if (candidateNorm === queryNorm) return 100;
  if (candidateNorm.startsWith(queryNorm)) return 80;
  if (candidateNorm.includes(queryNorm)) return 65;
  if (queryNorm.includes(candidateNorm) && candidateNorm.length >= 3) return 55;
  return 0;
}

function getCandidateNames(world: World, eid: number): string[] {
  const out: string[] = [];
  const name = Name.value[eid];
  if (typeof name === "string" && name.trim()) out.push(name);

  if (hasComponent(world, eid, ObjectType)) {
    const typeId = ObjectType.typeId[eid];
    const instanceName = ObjectType.instanceName[eid];
    if (typeof instanceName === "string" && instanceName.trim()) out.push(instanceName);
    if (typeof typeId === "string" && typeId.trim()) out.push(typeId);
  }

  // Include some common aliases (underscores/spaces variants) to be tolerant.
  return Array.from(
    new Set(
      out
        .flatMap((n) => [n, n.replace(/_/g, " "), n.replace(/\s+/g, "_")])
        .map((n) => String(n).trim())
        .filter(Boolean)
    )
  );
}

export function resolveEntityName(world: World, registry: EntityRegistry, eid: number): string | undefined {
  const cached = registry.byId.get(eid);
  if (cached) return cached;
  if (entityExists(world, eid) && hasComponent(world, eid, Name)) {
    const n = Name.value[eid];
    if (typeof n === "string" && n.trim()) return n;
  }
  return undefined;
}

export function resolveEntityId(world: World, registry: EntityRegistry, name: string): number | undefined {
  const raw = String(name || "").trim();
  if (!raw) return undefined;

  // Fast path: registry exact hit, validated against world.
  const cached = registry.byName.get(raw);
  if (cached !== undefined) {
    if (entityExists(world, cached)) return cached;
    registry.byName.delete(raw);
    registry.byId.delete(cached);
  }

  const needle = normalizeName(raw);
  if (!needle) return undefined;

  // Search all named entities (plus a few common pools for safety).
  const pool = new Set<number>();
  for (const eid of Array.from(query(world, [Name]))) pool.add(eid);
  for (const eid of Array.from(query(world, [Room]))) pool.add(eid);
  for (const eid of Array.from(query(world, [Agent]))) pool.add(eid);
  for (const eid of Array.from(query(world, [PhysicalObject]))) pool.add(eid);
  for (const eid of Array.from(query(world, [ObjectType]))) pool.add(eid);

  let bestEid: number | undefined;
  let bestScore = 0;

  for (const eid of pool) {
    if (!entityExists(world, eid)) continue;
    const candidates = getCandidateNames(world, eid);
    if (candidates.length === 0) continue;

    let localBest = 0;
    for (const c of candidates) {
      const s = scoreCandidate(needle, normalizeName(c));
      if (s > localBest) localBest = s;
      if (localBest === 100) break;
    }

    if (localBest > bestScore || (localBest === bestScore && bestEid !== undefined && eid < bestEid)) {
      bestScore = localBest;
      bestEid = eid;
    }
  }

  if (bestEid === undefined || bestScore <= 0) return undefined;

  // Cache canonical name + the input alias to reduce future scans.
  const canonical = resolveEntityName(world, registry, bestEid) || raw;
  registry.byName.set(canonical, bestEid);
  registry.byId.set(bestEid, canonical);
  if (canonical !== raw) registry.byName.set(raw, bestEid);

  return bestEid;
}

export function syncEntityRegistryFromWorld(world: World, registry: EntityRegistry): void {
  // Populate/refresh registry with all currently named entities.
  for (const eid of Array.from(query(world, [Name]))) {
    if (!entityExists(world, eid)) continue;
    const n = Name.value[eid];
    if (typeof n !== "string" || !n.trim()) continue;
    registry.byName.set(n, eid);
    registry.byId.set(eid, n);
  }
}

