/** Host-owned work identity. Attribution is not a build constraint; instructions,
 * acceptance, protected conditions and the causal source all are. */
import { createHash } from "node:crypto";
import type { World } from "../ecs/world";
import { getCommittedEvents } from "../runtime/committed-events";
import type { BuildRequest } from "./contracts";

export type BuildWorkIdentity = Readonly<{ key: string; sourceId: string; causalKeys: readonly string[] }>;

/** Object insertion order is irrelevant. Array order and all text remain exact;
 * this is not semantic/fuzzy deduplication. Inputs are validated JSON contracts. */
export function canonicalBuildJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export function identifyBuildWork(world: World, request: BuildRequest, causalKeys?: readonly string[]): BuildWorkIdentity | undefined {
  if (causalKeys === undefined) return;
  if (!Array.isArray(causalKeys) || !causalKeys.length || causalKeys.length > 32
    || causalKeys.some(key => typeof key !== "string" || !key.trim() || key.length > 500))
    throw new Error("Build causal identity requires 1-32 bounded host evidence keys");
  const source = getCommittedEvents(world);
  if (!source.sourceId || source.stopped) throw new Error("Causal build work requires a current simulation source");
  const keys = Object.freeze([...new Set(causalKeys)].sort());
  const { source: _attribution, ...contract } = request;
  const key = `work:${createHash("sha256").update(canonicalBuildJson([source.sourceId, keys, contract])).digest("hex")}`;
  return Object.freeze({ key, sourceId: source.sourceId, causalKeys: keys });
}

export function buildWorkSourceCurrent(world: World, work: BuildWorkIdentity): boolean {
  const source = getCommittedEvents(world);
  return !source.stopped && source.sourceId === work.sourceId;
}
