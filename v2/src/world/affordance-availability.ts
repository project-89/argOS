import type { World } from "../ecs/world";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { isInteractTargetAccessible } from "./physical-access";
import { canUseAffordance } from "./effect-executor";
import { worldSchema, type AffordanceDefinition } from "./schema";
import { getAgentWorldCapabilities, getAgentVisibleEntities, getAgentVisualEntities } from "../cognition/world-capabilities";
import { Name } from "../ecs/components";
import { matchesAffordanceCommand } from "./affordance-command";
import { getAgentSensoryCapabilities } from "../cognition/sensory-capabilities";
import { isWorldOfficeToolAllowed } from "../office-tools/tool-registry";
import { getDocumentAffordances } from "./productive-work";

/**
 * Returns affordances that are actually usable by `actorEid` on `targetEid` right now.
 *
 * Intentionally lives outside `src/cognition/*` to avoid circular imports:
 * - `cognition-system.ts` imports `builtin-systems.ts`
 * - `builtin-systems.ts` registers actions with `ActionRegistry`
 * - `ActionRegistry` should remain importable without pulling in cognition runtime.
 */
export function getAvailableAffordances(
  world: World,
  actorEid: number,
  targetEid: number
): AffordanceDefinition[] {
  if (!isEntityPresent(world, actorEid) || !isEntityPresent(world, targetEid)) return [];
  const available: AffordanceDefinition[] = [];
  const capabilities = getAgentWorldCapabilities(world, actorEid);
  const supportsNative = (affordance: AffordanceDefinition) =>
    capabilities?.supportsNativeAffordance?.(targetEid, affordance.name) ?? true;

  // Match generic native dispatch, including custody and open-container access.
  // Package/document executors below retain their own admission semantics.
  if (isInteractTargetAccessible(world, actorEid, getRoomForEntity(world, actorEid), targetEid)) {
    for (const affordance of worldSchema.getAllAffordances()) {
      if (!supportsNative(affordance)) continue;
      const check = canUseAffordance(world, affordance, actorEid, targetEid);
      if (check.available) available.push(affordance);
    }
  }

  const documents = getDocumentAffordances(world, actorEid, targetEid).filter(supportsNative);
  const extra = capabilities?.affordances?.(targetEid) || [];
  return [...new Map([...available, ...documents, ...extra].map(a => [a.name, a])).values()]
    .filter(affordance => (affordance.effects ?? []).every(effect => effect.type !== "run_tool" || !!effect.toolId && isWorldOfficeToolAllowed(world, effect.toolId)))
    .filter(affordance => affordance.name !== "examine" || getAgentSensoryCapabilities(world, actorEid).visual > 0);
}

/** A plan may name a known operation before its prerequisites hold. Catalogue
 * knowledge is deliberately separate from getAvailableAffordances: planning
 * does not grant possession, reveal an unread result, or execute a command.
 * Packages without a catalogue retain their existing available-only surface.
 * Never enumerate global schemas to discover hidden or host-only operations. */
export function getKnownAffordances(world: World, actorEid: number, targetEid: number): AffordanceDefinition[] {
  if (!getAgentVisualEntities(world, actorEid).includes(targetEid)) return [];
  const known = getAgentWorldCapabilities(world, actorEid)?.knownAffordances?.(targetEid) ?? [];
  const merged = new Map<string, AffordanceDefinition>();
  for (const definition of [...known.slice(0, 64), ...getAvailableAffordances(world, actorEid, targetEid)]) {
    if (definition.unavailableReason || (definition.effects ?? []).some(effect => effect.type === "run_tool"
      && (!effect.toolId || !isWorldOfficeToolAllowed(world, effect.toolId)))) continue;
    const prior = merged.get(definition.name);
    merged.set(definition.name, { ...definition,
      ...(prior?.requiresFreshDecision || definition.requiresFreshDecision ? { requiresFreshDecision: true } : {}),
      ...(prior?.opensEvidenceBoundary || definition.opensEvidenceBoundary ? { opensEvidenceBoundary: true } : {}) });
  }
  return [...merged.values()];
}

/** Selection policy, not a physical prohibition or a semantic truth checker.
 * Operator/native callers can still use the executor; automatic NPC routines
 * must return to cognition for this live capability's context-sensitive choice. */
export function requiresFreshAffordanceDecision(world: World, actorEid: number,
  action: { type: string; target?: string; content?: string }): boolean {
  if (!["interact", "use"].includes(action.type) || !action.target || !action.content) return false;
  const target = getAgentVisibleEntities(world, actorEid).find(id =>
    Name.value[id]?.trim().toLowerCase() === action.target!.trim().toLowerCase());
  return target !== undefined && getAvailableAffordances(world, actorEid, target)
    .some(a => a.requiresFreshDecision === true && matchesAffordanceCommand(a.name, action.content!));
}
