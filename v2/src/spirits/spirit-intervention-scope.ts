import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Room, Removed, WorkingMemoryIdentity } from "../ecs/components";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { captureSpiritSourceScope } from "./spirit-cycle-scope";
import type { SpiritRegistry } from "./spirit-registry";
import type { InterventionTarget, SpiritState } from "./types";

export type SpiritInterventionScope = (target: InterventionTarget) => { eid: number; isCurrent: () => boolean } | undefined;

/** Host-owned bindings captured before inference. These guard source and target
 * identity/location, not the semantic relevance of an arbitrary suggestion. */
export function captureSpiritInterventionScope(world: World, spirit: SpiritState, registry: SpiritRegistry,
  sourceCurrent = captureSpiritSourceScope(world, spirit, registry)): SpiritInterventionScope {
  const bindings = new Map<string, { eid: number; current: () => boolean }[]>();
  for (const kind of ["agent", "room"] as const) {
    for (const eid of query(world, [kind === "agent" ? Agent : Room, Name])) {
      if (hasComponent(world, eid, Removed) || kind === "agent" && !Agent.active[eid]) continue;
      const own = identity(world, eid); if (!own) continue;
      const name = Name.value[eid], persona = kind === "agent" ? Agent.systemPrompt[eid] : undefined;
      const current = () => {
        if (!sourceCurrent() || !own()) return false;
        if (!hasComponent(world, eid, kind === "agent" ? Agent : Room)) return false;
        // A whisper is an inner voice: it follows the person, so walking into
        // another room while the spirit thinks does not void it. Identity and
        // persona still bind it to the same individual.
        if (kind === "agent" && (!Agent.active[eid] || Agent.systemPrompt[eid] !== persona)) return false;
        // A new same-name entity must not make the target ambiguous after capture.
        return [...query(world, [kind === "agent" ? Agent : Room, Name])].filter(id => Name.value[id] === name
          && !hasComponent(world, id, Removed) && (kind !== "agent" || Agent.active[id])).length === 1;
      };
      const key = `${kind}:${name}`, rows = bindings.get(key) ?? [];
      rows.push({ eid, current }); bindings.set(key, rows);
    }
  }
  return target => {
    const rows = bindings.get(`${target.type}:${target.name}`);
    if (rows?.length !== 1 || target.eid !== undefined && target.eid !== rows[0].eid) return;
    return { eid: rows[0].eid, isCurrent: () => { try { return rows[0].current(); } catch { return false; } } };
  };
}

function identity(world: World, eid: number): (() => boolean) | undefined {
  const ref = workingMemoryEntityRef(world, eid); if (!ref) return;
  return () => entityExists(world, eid) && !hasComponent(world, eid, Removed)
    && hasComponent(world, eid, Name) && Name.value[eid] === ref.label
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === ref.key;
}
