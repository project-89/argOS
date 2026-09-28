/** Operator evidence only. Scan ECS, not an authored cast list. Never deliver
 * this omniscient view to a character, or score a description as a capability. */
import { Prefab, query, hasComponent, getRelationTargets } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Room, Name, Description, GodAgent, Removed, PhysicalObject, ObjectType,
  ObjectState, Mind, Goal, Plan, Perception, WorkingMemoryIdentity } from "../ecs/components";
import { AdjacentTo, HasGoal, HasPlan } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { getWorldConstructionStatus } from "../runtime/world-construction-budget";

export function snapshotInhabitedWorld(world: World) {
  const ids = [...query(world, [Name])].filter(id => ![Prefab, GodAgent, Removed].some(c => hasComponent(world, id, c))
    && [Agent, Room, PhysicalObject, ObjectType].some(c => hasComponent(world, id, c)));
  if (ids.length > 200) throw new Error("Inhabited-world diagnostic entity bound exceeded");
  return { sourceId: getCommittedEvents(world).sourceId, atSimMs: readSimulationTime(world),
    construction: getWorldConstructionStatus(world),
    entities: ids.map(id => ({ id, key: hasComponent(world, id, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[id] : null,
      name: Name.value[id], description: Description.value[id],
      kind: hasComponent(world, id, Agent) ? "agent" : hasComponent(world, id, Room) ? "room" : "object",
      containerId: getDirectContainer(world, id) ?? null, roomId: getRoomForEntity(world, id) ?? null,
      state: hasComponent(world, id, ObjectState) ? ObjectState.current[id] : null,
      routes: hasComponent(world, id, Room) ? getRelationTargets(world, id, AdjacentTo) : [],
      actor: hasComponent(world, id, Agent) ? { active: Agent.active[id], role: Agent.role[id],
        mind: hasComponent(world, id, Mind) ? { mode: Mind.mode[id], focus: Mind.focus[id], arousal: Mind.arousal[id] } : null,
        continuation: snapshotActorContinuation(world, id),
        goals: getRelationTargets(world, id, HasGoal).filter(g => hasComponent(world, g, Goal)).map(g => ({
          id: g, description: Goal.description[g], status: Goal.status[g], kind: Goal.kind[g], priority: Goal.priority[g] })),
        plans: getRelationTargets(world, id, HasPlan).filter(p => hasComponent(world, p, Plan)).map(p => ({
          id: p, goalId: Plan.goalEid[p], status: Plan.status[p], currentStep: Plan.currentStep[p] })),
        perceptions: getAgentPerceptions(world, id).map(p => ({ id: p, type: Perception.type[p], source: Perception.source[p],
          content: Perception.content[p], timestamp: Perception.timestamp[p] })),
      } : null,
    })),
  };
}
