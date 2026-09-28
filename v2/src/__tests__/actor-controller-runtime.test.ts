import { jest } from "@jest/globals";
import { query } from "bitecs";
import { createSimulation } from "../index";
import { Agent, BehaviorPolicy, Name } from "../ecs/components";
import { getDirectContainer } from "../ecs/location";
import { createObjectEntity } from "../ecs/prefabs";
import { createIntentGoal } from "../cognition/cognition-system";
import { createPlanEntity } from "../cognition/planning-system";
import { registerAgentWorldCapabilities } from "../cognition/world-capabilities";

test("the library fast controller isolates a faulty actor and advances a healthy actor's known plan", async () => {
  jest.useFakeTimers();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Runtime controller test is offline"));
  const sim = await createSimulation({ name: "Controller fault isolation", enableAI: false, enableSpirits: false,
    dualLoop: true, ecsTickRate: 20, timedActions: false, preset: "minimal", rooms: [{ name: "Room" }],
    agents: [{ name: "Faulty", role: "tester", startRoom: "Room" }, { name: "Healthy", role: "tester", startRoom: "Room" }] });
  try {
    const [bad, good] = ["Faulty", "Healthy"].map(name => [...query(sim.world, [Agent, Name])].find(eid => Name.value[eid] === name)!);
    // Isolate plan continuation, not the library's optional default policy.
    BehaviorPolicy.enabled[good] = false;
    const room = getDirectContainer(sim.world, good)!;
    const key = createObjectEntity(sim.world, { name: "Key", roomId: room, portable: true, traits: ["takeable"] });
    registerAgentWorldCapabilities(sim.world, bad, { context: () => "", ready: () => { throw new Error("Unloaded actor package"); }, busy: () => false, execute: () => false });
    const goal = createIntentGoal(sim.world, good, "Collect the key", 10);
    createPlanEntity(sim.world, good, goal, { goalDescription: "Collect the key", estimatedCompletion: "soon", potentialObstacles: [],
      steps: [{ description: "Collect", actionType: "pickup", target: "Key" }] });
    await sim.start(); await jest.advanceTimersByTimeAsync(150);
    expect(getDirectContainer(sim.world, key)).toBe(good);
    expect(fetch).not.toHaveBeenCalled();
  } finally { sim.stop(); jest.useRealTimers(); jest.restoreAllMocks(); }
});
