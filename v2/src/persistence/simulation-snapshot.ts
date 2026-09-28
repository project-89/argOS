import type { SerializedWorld } from "./world-persistence";
import { parseWorldSpecification } from "../world/world-specification";

/** Validate the construction envelope before mutating any runtime. This does
 * not make authored system code trusted; only restore snapshots you trust. */
export function validateSimulationSnapshot(data: SerializedWorld): number {
  if (!data || !Array.isArray(data.entities) || !Array.isArray(data.systems)
    || typeof data.name !== "string" || !Number.isSafeInteger(data.tick) || data.tick < 0)
    throw new Error("Invalid simulation snapshot envelope");
  if (data.worldSpecification !== undefined) parseWorldSpecification(data.worldSpecification);
  if (data.runtimePackages !== undefined && (!Array.isArray(data.runtimePackages)
    || data.runtimePackages.some(name => typeof name !== "string" || !name.trim()))) throw new Error("Invalid runtime package manifest");
  if (data.runtimePackages?.length) throw new Error(`Snapshot requires native package reattachment, unsupported by generic restore: ${data.runtimePackages.join(", ")}`);
  const systemNames = new Set<string>();
  for (const system of data.systems) {
    if (!system || typeof system.name !== "string" || systemNames.has(system.name)) throw new Error("Invalid or duplicate snapshot system");
    systemNames.add(system.name);
    if (system.managedRelease !== undefined && (!system.managedRelease
      || typeof system.managedRelease.digest !== "string" || !/^[a-f0-9]{64}$/.test(system.managedRelease.digest)
      || typeof system.managedRelease.jobId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(system.managedRelease.jobId)
      || typeof system.code !== "string" || !system.code || typeof system.active !== "boolean"))
      throw new Error(`Invalid managed release: ${system.name}`);
  }
  const ids = new Set<number>();
  for (const entity of data.entities) {
    if (!Number.isSafeInteger(entity.id) || entity.id < 0 || ids.has(entity.id)
      || !entity.components || typeof entity.components !== "object" || !Array.isArray(entity.relations))
      throw new Error("Invalid or duplicate snapshot entity");
    ids.add(entity.id);
  }
  const gods = data.entities.filter(entity => entity.components.GodAgent);
  if (gods.length !== 1) throw new Error("A simulation snapshot must contain exactly one God runtime entity");
  if (data.clock && (!Number.isFinite(data.clock.elapsed) || data.clock.elapsed < 0
    || data.clock.tick !== data.tick)) throw new Error("Snapshot clock is invalid or disagrees with its tick");
  if (data.schema) {
    const schema = data.schema as Record<string, unknown>;
    if (["affordances", "objectTypes", "rules"].some(key => !schema[key] || typeof schema[key] !== "object" || Array.isArray(schema[key]))
      || !Array.isArray(schema.traits) || schema.traits.some(trait => typeof trait !== "string"))
      throw new Error("Invalid saved world schema");
  }
  return gods[0].id;
}
