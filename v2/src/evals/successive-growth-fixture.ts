/** Prospective setup only. The running evaluator observes; it does not activate
 * the second concern, retire goals, choose actions, or call specialist cognition. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, hasComponent, query, Prefab } from "bitecs";
import { createSimulation, type SimulationConfig } from "../index";
import type { World } from "../ecs/world";
import { Agent, BehaviorPolicy, Goal, GodAgent, Name, Needs, PhysicalObject, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { createIntentGoal } from "../cognition/cognition-system";
import { setGoalContract } from "../cognition/goal-contract";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { ObjectManager } from "../world/object-manager";
import { enableRoomRouteTopology } from "../runtime/room-routes";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSpiritSystemState, type SpiritSystemState } from "../spirits/spirit-system";
import type { DynamicSpiritState } from "../spirits/spirit-factory";
import { observeDinerIdentity } from "./purposeful-diner-support";

export const SUCCESSIVE_GROWTH_PURPOSES = Object.freeze({
  food: "Find somewhere to eat one simple meal",
  seat: "After lunch, find somewhere dry to sit down for a quiet break",
});

/** Read/validate before start, not after a spirit observation happens to assign
 * missing goal identities. Does not name mental entities as world objects. */
export function readSuccessiveGrowthConcerns(world: World, actor: number, foodGoal: number, seatGoal: number) {
  const source = getCommittedEvents(world);
  if (world.time.elapsed !== 0 || !source.sourceId || source.stopped || source.events.length)
    throw Error("Initial concerns must be captured before lived activity");
  const concerns = ([{ eid: foodGoal, kind: "meal", description: SUCCESSIVE_GROWTH_PURPOSES.food },
    { eid: seatGoal, kind: "seat", description: SUCCESSIVE_GROWTH_PURPOSES.seat }] as const).map(row => {
    if (!entityExists(world, row.eid) || !hasComponent(world, row.eid, Goal)
      || !hasComponent(world, actor, HasGoal(row.eid)) || !hasComponent(world, row.eid, WorkingMemoryIdentity)
      || !WorkingMemoryIdentity.id[row.eid]?.trim() || Goal.description[row.eid] !== row.description || Goal.status[row.eid] !== "active")
      throw Error("Missing or mismatched initial concern identity/ownership");
    return { key: WorkingMemoryIdentity.id[row.eid], kind: row.kind, description: row.description, authoredAtSimMs: 0 };
  });
  if (concerns[0].key === concerns[1].key) throw Error("Initial concern identities must be distinct");
  return concerns;
}

export function successiveGrowthConfiguration(enableAI = true): SimulationConfig {
  const disabled = Number.MAX_SAFE_INTEGER;
  return {
    name: "A lunch break in a growing neighborhood", preset: "minimal", enableAI,
    narrativeMind: true, cognitionController: "priority", experienceReconsideration: true,
    enablePlanning: true, enableReflection: true, enableExperienceAppraisal: true,
    enableSpirits: true, godAutopilot: { enabled: true, minPriority: "normal" },
    evolution: { architectInterval: 30, proposalInterval: 5, maxProposalExecutions: 1, autoApproveProposals: false,
      crafterInterval: disabled, stewardInterval: disabled, artificerInterval: disabled,
      lawgiverInterval: disabled, fileRepairInterval: disabled },
    codingDaemons: false, enableNarrativeEngine: false, hostOfficeTools: false,
    enableServer: false, autoPopulateRooms: false, maxWorldEntities: 24,
    dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500, timeScale: 1, timedSpeech: true, timedActions: true,
    rooms: [{ name: "Neighborhood Courtyard", description: "An open-air courtyard between neighborhood buildings. It has no roof, furniture, or food provision." }],
    agents: [{ name: "Ada", role: "visitor", startRoom: "Neighborhood Courtyard",
      systemPrompt: "You are Ada, a practical, warm bicycle mechanic on your lunch break. You choose from what you actually perceive.",
      past: { background: "I repair bicycles in the neighborhood. After a busy morning I like a simple lunch, then a quiet seated break before returning to work.",
        drives: ["Look after myself", "Take a quiet seated break after lunch", "Return to useful work rested"],
        memories: [{ recollection: "Last week I ate lunch after fixing a neighbor's bicycle, then found a dry seat for a short quiet break. I returned to the workshop feeling ready to work.",
          period: "Last week", emotionalTone: "contentment", importance: .6,
          selfBelief: "I work better when I take care of myself", meaning: "Eating and taking a short break are worthwhile",
          cues: ["lunch", "hungry", "break", "seat"], provenance: "authored-history" }] } }],
  };
}

/** Creation-time evaluation scope, not a runtime response to model output. The
 * real scheduler still owns Weaver, proposal dispatch, God and Watcher cadence. */
export function restrictSuccessiveGrowthSpirits(state: SpiritSystemState): DynamicSpiritState {
  if (state.running) throw Error("Successive growth scope must be configured before startup");
  const weaver = state.registry.spirits.get(state.registry.byName.get("The Weaver")!) as DynamicSpiritState | undefined;
  if (!weaver || weaver.spiritType !== "architect") throw Error("Missing native Weaver");
  weaver.architectConfig = { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false,
    canProposeRules: false, canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 };
  for (const spirit of state.registry.spirits.values()) if (spirit.definition.name !== "The Watcher") {
    // Definitions such as NarratorDefinition are shared exports; never mutate
    // their global configuration while scoping this one diagnostic world.
    spirit.definition = { ...spirit.definition, observationInterval: Number.MAX_SAFE_INTEGER };
  }
  return weaver;
}

export async function createSuccessiveGrowthFixture(enableAI = true) {
  const sim = await createSimulation(successiveGrowthConfiguration(enableAI));
  let disableRoutes: (() => void) | undefined;
  try {
    const world = sim.world;
    const actor = [...query(world, [Agent, Name])].find(eid => Name.value[eid] === "Ada");
    if (actor === undefined) throw Error("Missing initial growth actor");
    const room = getRoomForEntity(world, actor);
    if (room === undefined) throw Error("Missing initial courtyard");
    if (hasComponent(world, actor, BehaviorPolicy)) BehaviorPolicy.enabled[actor] = false;
    Needs.hunger[actor] = 65; Needs.energy[actor] = 45;
    const foodPurpose = SUCCESSIVE_GROWTH_PURPOSES.food, seatPurpose = SUCCESSIVE_GROWTH_PURPOSES.seat;
    const foodGoal = createIntentGoal(world, actor, foodPurpose, 7);
    const seatGoal = createIntentGoal(world, actor, seatPurpose, 5);
    setGoalContract(world, foodGoal, { version: 1, kind: "custom", params: {}, description: foodPurpose,
      success: { type: "did_interact_affordance", affordance: "eat" } });
    setGoalContract(world, seatGoal, { version: 1, kind: "custom", params: {}, description: seatPurpose,
      success: { type: "did_interact_affordance", affordance: "sit" } });
    const removed = new ObjectManager(world).spawn("object", { name: "Removed brass key", containedIn: room });
    if (removed === null) throw Error("Removal control creation failed");
    addComponent(world, removed, Removed);
    // Seed identity once before runtime/observation. Later observers must not
    // mint identities or mistake a recycled numeric slot for this same object.
    const physical = [...query(world, [Name])].filter(eid => !hasComponent(world, eid, Prefab)
      && !hasComponent(world, eid, GodAgent) && [Room, PhysicalObject, Agent].some(component => hasComponent(world, eid, component)));
    for (const eid of [...physical, sim.god.eid]) workingMemoryEntityRef(world, eid);
    // Goals intentionally have no Name. Match native intention identity shape
    // at creation, without changing their lifecycle, deadline or goal contract.
    for (const goal of [foodGoal, seatGoal]) {
      addComponent(world, goal, WorkingMemoryIdentity);
      WorkingMemoryIdentity.id[goal] = `goal:${randomUUID()}`;
    }
    const initialPhysical = physical.map(eid => observeDinerIdentity(world, eid));
    const initialKeys = new Set(physical.map(eid => WorkingMemoryIdentity.id[eid]));
    const spirits = getSpiritSystemState(world);
    if (enableAI && !spirits) throw Error("Live fixture requires native spirit scheduling");
    const weaver = spirits ? restrictSuccessiveGrowthSpirits(spirits) : undefined;
    disableRoutes = enableRoomRouteTopology(world);
    const sourceId = getCommittedEvents(world).sourceId;
    if (!sourceId || world.time.elapsed !== 0 || getCommittedEvents(world).events.length) throw Error("Fixture must precede all lived activity");
    readSuccessiveGrowthConcerns(world, actor, foodGoal, seatGoal);
    return { sim, actor, room, foodGoal, seatGoal, foodPurpose, seatPurpose, removed, sourceId,
      initialPhysical, initialKeys, spirits, weaver, disableRoutes };
  } catch (error) {
    disableRoutes?.(); sim.stop(); throw error;
  }
}
