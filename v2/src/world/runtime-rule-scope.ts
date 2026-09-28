import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import type { RuleDefinition } from "./schema";

/** Runtime authority, deliberately absent from serialized world definitions. */
const grants = new WeakMap<RuleDefinition, { world: World; current: () => boolean; definition: string }>();
const definition = (rule: RuleDefinition) => JSON.stringify({ ...rule, enabled: true });

export function captureRuleSource(world: World): () => boolean {
  const source = getCommittedEvents(world), issuedAt = readSimulationTime(world);
  let valid = source.sourceId !== null && !source.stopped && Number.isFinite(issuedAt);
  return () => {
    try {
      const now = readSimulationTime(world), live = getCommittedEvents(world);
      valid = valid && !live.stopped && live.sourceId === source.sourceId && Number.isFinite(now) && now >= issuedAt;
    } catch { valid = false; }
    return valid;
  };
}

export function grantRuntimeRule(world: World, rule: RuleDefinition, sourceCurrent: () => boolean): void {
  if (rule.executionScope !== "lawgiver-runtime" || !sourceCurrent()) throw new Error("Invalid runtime rule scope");
  grants.set(rule, { world, current: sourceCurrent, definition: definition(rule) });
}

export function assertRuntimeRuleRestoreOwnership(world: World, rule: RuleDefinition): void {
  const grant=grants.get(rule);
  if(grant && grant.world!==world && grant.current())throw Error("Cannot steal a live rule grant from another world");
}

export function canExecuteRule(world: World, rule: RuleDefinition): boolean {
  // Only explicitly trusted host/base rules may be unscoped. Unknown markers fail closed.
  if (rule.executionScope === undefined) return true;
  const grant = grants.get(rule);
  return rule.executionScope === "lawgiver-runtime" && !!grant && grant.world === world
    && rule.enabled !== false && grant.current() && grant.definition === definition(rule);
}
