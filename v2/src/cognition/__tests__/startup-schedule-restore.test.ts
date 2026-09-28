import { jest } from "@jest/globals";
import { query } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../../index";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createGodAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Schedule } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld } from "../../persistence/world-persistence";
import { getSchedule, initializeSchedule } from "../schedule-system";

let restored: ArgosSimulation | undefined;
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Startup schedule restore checks are offline"));
});
afterEach(async () => {
  restored?.stop(); await restored?.drainPendingOperations(1000); restored = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

function savedWorld() {
  const world = createArgosWorld("Saved routine"); initializePrefabs(world);
  createGodAgentEntity(world, { name: "God", worldName: "Saved routine", narrative: "A resident's own routine." });
  const room = createRoomEntity(world, { name: "Home" });
  const actor = createAgentEntity(world, { name: "Resident", role: "visitor", systemPrompt: "Choose freely.", roomId: room });
  Object.assign(world.time, { tick: 40, elapsed: 8000, simulationDay: 9, simulationHour: 18, timeOfDay: "evening" });
  return { world, actor, save: () => serializeWorld(world, createSystemRegistry()) };
}
async function restore(snapshot: ReturnType<typeof serializeWorld>) {
  restored = await createSimulation({ name: "Restored routine", restoreSnapshot: snapshot,
    enableAI: false, enableSpirits: false, enableNarrativeEngine: false, evolution: false,
    codingDaemons: false, godAutopilot: false, enableServer: false, dualLoop: false });
  return restored;
}

test("constructor restore preserves a deliberately absent schedule despite active baseline maintenance", async () => {
  const source = savedWorld();
  expect(getSchedule(source.world, source.actor)).toBeUndefined();
  const simulation = await restore(source.save()), actor = simulation.god.registry.byName.get("Resident")!;
  expect(simulation.god.systemRegistry.systems.get("DailySchedulePlanner")?.active).toBe(true);
  expect(getSchedule(simulation.world, actor)).toBeUndefined();
  expect([...query(simulation.world, [Schedule])]).toEqual([]);
  expect(simulation.world.time.tick).toBe(40);
  expect(simulation.world.time.elapsed).toBe(8000);
});

test("constructor restore preserves every authored schedule field rather than replacing or advancing the routine", async () => {
  const source = savedWorld();
  const schedule = initializeSchedule(source.world, source.actor, [{ name: "work", startHour: 18, duration: 2,
    location: "Archive", priority: 8, interruptible: false, description: "Keep the agreed archive appointment." }], 0.23);
  Schedule.currentActivity[schedule] = "work";
  Schedule.nextTransition[schedule] = 20;
  Schedule.plannedDay[schedule] = 7; // Maintenance must not silently carry this forward during restore.
  Schedule.lastUpdated[schedule] = 12345;
  const snapshot = source.save(), expected = snapshot.entities.find(entity => entity.id === schedule)!.components.Schedule;
  const simulation = await restore(snapshot), actor = simulation.god.registry.byName.get("Resident")!;
  const current = getSchedule(simulation.world, actor)!;
  expect(current).toBeDefined();
  expect(simulation.god.systemRegistry.systems.get("DailySchedulePlanner")?.active).toBe(true);
  expect([...query(simulation.world, [Schedule])]).toEqual([current]);
  expect(Object.fromEntries(Object.entries(Schedule).map(([field, values]) => [field, values[current]]))).toEqual(expected);
  expect(simulation.world.time.simulationDay).toBe(9);
});
