/** Prospective test setup, never a post-start repair or NPC action script. */
import { addComponent, hasComponent, query } from "bitecs";
import { createSimulation } from "../index";
import { Agent, BehaviorPolicy, Name, Needs, Removed, StimulusSource } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { createIntentGoal } from "../cognition/cognition-system";
import { setGoalContract } from "../cognition/goal-contract";
import { registerSystem } from "../ecs/dynamic-systems";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { ObjectManager } from "../world/object-manager";

export async function createIterativeDinerFixture(enableAI = true, version: "v1" | "purposeful-v2" = "v1") {
  const purposeful = version === "purposeful-v2";
  const roomName = "Neighborhood Diner", intention = "Eat one simple lunch here in the Neighborhood Diner";
  const sim = await createSimulation({ name: "An incomplete diner becomes useful", preset: "minimal", enableAI,
    narrativeMind: true, cognitionController: "priority", experienceReconsideration: true, enablePlanning: true, enableReflection: true,
    enableSpirits: false, godAutopilot: false, evolution: false, codingDaemons: false, enableNarrativeEngine: false,
    hostOfficeTools: false, enableServer: false, maxWorldEntities: 20, dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500, timeScale: 1,
    rooms: [{ name: roomName, description: "A newly furnished small neighborhood diner. A table and chair are installed. The food provision has not been fitted out yet; no food has been served here." }],
    agents: [{ name: "Ada", role: "visitor", startRoom: roomName,
      systemPrompt: "You are Ada, a practical, warm bicycle mechanic on your lunch break. You choose from what you actually perceive.",
      past: { background: "I repair bicycles in the neighborhood and enjoy a quiet lunch between jobs.",
        drives: ["Look after myself", "Get back to useful work after a break"],
        memories: [{ recollection: "After a long morning fixing a neighbor's bicycle, I sat down for a simple lunch and felt ready to work again.",
          period: "Last week", emotionalTone: "contentment", importance: .6, selfBelief: "I work better when I take care of myself",
          meaning: "A break can be worthwhile", cues: ["lunch", "hungry"], provenance: "authored-history" }] } }] });
  try {
    const world = sim.world, registry = sim.god.systemRegistry;
    const actor = [...query(world, [Agent, Name])].find(eid => Name.value[eid] === "Ada");
    if (actor === undefined) throw Error("Missing initial diner actor");
    const room = getRoomForEntity(world, actor);
    if (room === undefined) throw Error("Missing initial diner room");
    const objects = new ObjectManager(world);
    const table = objects.spawn("table", { name: "Diner table", containedIn: room });
    const chair = objects.spawn("chair", { name: "Diner chair", containedIn: room });
    const removed = objects.spawn(purposeful ? "object" : "food_item", {
      name: purposeful ? "Removed brass key" : "Removed celebration cake", containedIn: room });
    if (table === null || chair === null || removed === null) throw Error("Initial furnishing/control creation failed");
    addComponent(world, removed, Removed);
    if (purposeful) {
      // Match the established sitcom's creation-time policy choice, not a new
      // controller or a host override of an actor's subsequent decisions.
      if (hasComponent(world, actor, BehaviorPolicy)) BehaviorPolicy.enabled[actor] = false;
      addComponent(world, removed, StimulusSource);
      StimulusSource.stimulusType[removed] = "sound";
      StimulusSource.template[removed] = "The brass key rings against metal.";
      StimulusSource.interval[removed] = 1000;
      StimulusSource.lastEmit[removed] = 0;
    }
    Needs.hunger[actor] = 65;
    const goal = createIntentGoal(world, actor, intention, 7);
    setGoalContract(world, goal, { version: 1, kind: "custom", params: {}, description: intention,
      success: { type: "all_of", conditions: [{ type: "in_room", roomName }, purposeful
        ? { type: "did_interact_affordance", affordance: "eat" }
        : { type: "need_at_most", need: "hunger", atMost: 40 }] } });
    if (!registry.systems.has("GoalEvaluationSystem")) registerSystem(registry, createGoalEvaluationSystem());
    return { sim, actor, room, goal, table, chair, removed, intention };
  } catch (error) { sim.stop(); throw error; }
}
