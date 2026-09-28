import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { query } from "bitecs";
import { createSimulation, getWorldSpecification, type ArgosSimulation, type WorldSpecificationInput } from "../index";
import { Agent, Name } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getCoreDrives } from "../cognition/goal-learning";
import { getIdentityAnchors } from "../cognition/narrative-memory";
import { buildAgentContext } from "../cognition/agent-mind";
import { serializeWorld } from "../persistence/world-persistence";

const spec: WorldSpecificationInput = { version: 1,
  setting: { name: "Harbor", genre: "coastal mystery", premise: "Two friends shelter from a storm.", tone: "uneasy warmth" },
  story: { style: "Ordinary concerns alongside a mystery" },
  inhabitants: [{ name: "Esme", role: "net mender", startRoom: "Net loft",
    past: { background: "I have known Jo since childhood.", drives: ["Protect my friends without controlling them"],
      memories: [{ recollection: "PRIVATE_RECOLLECTION: Jo once trusted me with a spare key.", importance: .8,
        emotionalTone: "warmth", selfBelief: "I can be trusted", meaning: "Trust is earned", cues: ["Jo", "key"], period: "last winter" }] } },
    { name: "Jo", role: "harbor worker", startRoom: "Net loft" }],
  opportunities: ["A lighthouse investigation may become possible"], discovery: ["Evidence requires observation"] };
let sim: ArgosSimulation | undefined;
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("World specification library test is offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => { sim?.stop(); await sim?.drainPendingOperations(1000); sim = undefined;
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("authored library path consumes the cast, private past, and 100ms profile without a new controller", async () => {
  sim = await createSimulation({ name: "Harbor", worldSpecification: spec, preset: "minimal", enableAI: false,
    rooms: [{ name: "Net loft" }] });
  const actors = [...query(sim.world, [Agent])], esme = actors.find(id => Name.value[id] === "Esme")!, jo = actors.find(id => Name.value[id] === "Jo")!;
  expect(actors).toHaveLength(2); expect(Name.value[getRoomForEntity(sim.world, esme)!]).toBe("Net loft");
  expect(getCoreDrives(sim.world, esme)).toEqual(["Protect my friends without controlling them"]);
  expect(getIdentityAnchors(sim.world, esme)[0].monologue).toContain("PRIVATE_RECOLLECTION");
  expect(buildAgentContext(sim.world, jo)).not.toContain("PRIVATE_RECOLLECTION");
  expect(buildAgentContext(sim.world, esme)).not.toContain("lighthouse investigation may become possible");
  expect(sim.world.meta.cognitionController).toBe("priority");
  expect(sim.getCodingStatus()).toBeNull(); expect(sim.getEvolutionStatus().enabled).toBe(false);
  const before = sim.world.time.elapsed; await sim.step(); expect(sim.world.time.elapsed - before).toBe(100);
});

test("specification roundtrip through public entry point retains characters without authoring them again", async () => {
  sim = await createSimulation({ name: "Harbor", worldSpecification: spec, preset: "minimal", enableAI: false,
    maxWorldEntities: 40, rooms: [{ name: "Net loft" }] });
  const saved = serializeWorld(sim.world, sim.god.systemRegistry);
  const esme = [...query(sim.world, [Agent])].find(id => Name.value[id] === "Esme")!;
  const anchors = getIdentityAnchors(sim.world, esme).map(anchor => anchor.monologue);
  sim.stop(); await sim.drainPendingOperations(1000);
  sim = await createSimulation({ name: "Restored harbor", restoreSnapshot: saved, enableAI: false });
  const actors = [...query(sim.world, [Agent])], restoredEsme = actors.find(id => Name.value[id] === "Esme")!;
  expect(actors).toHaveLength(2);
  expect(getIdentityAnchors(sim.world, restoredEsme).map(anchor => anchor.monologue)).toEqual(anchors);
  expect(getWorldSpecification(sim.world)?.setting.genre).toBe("coastal mystery");
  expect(sim.getWorldConstructionStatus().limit).toBe(40);
  expect(sim.getCodingStatus()).toBeNull(); expect(sim.getEvolutionStatus().enabled).toBe(false);
  const conflicting = { ...spec, setting: { ...spec.setting, genre: "space comedy" } };
  await expect(createSimulation({ name: "Bad restore", restoreSnapshot: saved, worldSpecification: conflicting, enableAI: false }))
    .rejects.toThrow("retain the saved world specification");
  expect(getWorldSpecification(sim.world)?.setting.genre).toBe("coastal mystery");
});
