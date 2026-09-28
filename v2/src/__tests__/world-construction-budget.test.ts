import { createSimulation, type ArgosSimulation } from "../index";
import { query } from "bitecs";
import { Agent, Name } from "../ecs/components";
import { createObjectEntity } from "../ecs/prefabs";
import { createIntentGoal } from "../cognition/cognition-system";
import { serializeWorld } from "../persistence/world-persistence";
import { createSystemRegistry } from "../ecs/dynamic-systems";

test("the library refuses authored world construction before allocation when its budget is zero", async () => {
  let sim: ArgosSimulation | undefined;
  try {
    await expect((async () => { sim = await createSimulation({ name: "Bounded construction", enableAI: false,
      enableSpirits: false, evolution: false, dualLoop: false, preset: "minimal", maxWorldEntities: 0,
      rooms: [{ name: "Should not exist" }] }); return sim; })()).rejects.toThrow(/construction budget/i);
  } finally { sim?.stop(); }
});

test("a full construction budget leaves cognition/ticks running and survives the library restore entry point", async () => {
  const options = { name: "Bounded residents", enableAI: false, enableSpirits: false, evolution: false, dualLoop: false, preset: "minimal" as const };
  const sim = await createSimulation({ ...options, maxWorldEntities: 2, rooms: [{ name: "Room" }],
    agents: [{ name: "Ada", role: "resident", startRoom: "Room" }] });
  let restored: ArgosSimulation | undefined;
  try {
    const actor = [...query(sim.world, [Agent, Name])].find(eid => Name.value[eid] === "Ada")!;
    for (let i = 0; i < 10; i++) createIntentGoal(sim.world, actor, `Consider ${i}`, 5);
    await sim.step();
    expect(sim.getWorldConstructionStatus()).toMatchObject({ limit: 2, admitted: 2, remaining: 0 });
    expect(sim.tick).toBeGreaterThan(0);
    const saved = serializeWorld(sim.world, createSystemRegistry()); sim.stop();
    restored = await createSimulation({ ...options, restoreSnapshot: saved });
    expect(restored.getWorldConstructionStatus()).toEqual(sim.getWorldConstructionStatus());
    expect(() => createObjectEntity(restored!.world, { name: "Over budget" })).toThrow(/construction budget/);
    await restored.step(); expect(restored.tick).toBeGreaterThan(saved.tick);
  } finally { sim.stop(); restored?.stop(); }
});
