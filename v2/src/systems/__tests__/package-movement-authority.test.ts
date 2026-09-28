import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GridPosition, Schedule } from "../../ecs/components";
import { HasGoal, HasSchedule } from "../../ecs/relations";
import { getDirectContainer } from "../../ecs/location";
import { createSystemRegistry, registerSystem, runSystems, type SystemDefinition } from "../../ecs/dynamic-systems";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { clearMovementTarget, createGoalPursuitSystem, createMovementSystem, createRoomArrivalSystem, getMovementTarget, setMovementTarget } from "../builtin-systems";
import { goalPursuitSystem, scheduleExecutionSystem } from "../deterministic-behavior-systems";

function fixture() {
  const world = createArgosWorld("Package locomotion authority"); initializePrefabs(world);
  world.time.simulationHour = 20;
  const origin = createRoomEntity(world, { name: "Common Room", x: 0, y: 0 });
  const destination = createRoomEntity(world, { name: "Utility Room", x: 200, y: 0 });
  const packaged = createAgentEntity(world, { name: "Package actor", role: "keeper", systemPrompt: "test", roomId: origin, gridPosition: { x: 0, y: 0 } });
  const native = createAgentEntity(world, { name: "Native actor", role: "keeper", systemPrompt: "test", roomId: origin, gridPosition: { x: 0, y: 0 } });
  const unregister = registerAgentWorldCapabilities(world, packaged, {
    ownsMovement: true, ready: () => true, busy: () => false,
    context: () => "", execute: () => false,
  });
  for (const eid of [packaged, native]) {
    clearMovementTarget(eid);
    const schedule = addEntity(world);
    addComponent(world, schedule, Schedule); addComponent(world, eid, HasSchedule(schedule));
    Schedule.activities[schedule] = JSON.stringify([{ name: "night shift", startHour: 20, duration: 2, location: "Utility Room" }]);
    Schedule.currentActivity[schedule] = "night shift";
  }
  const run = (system: SystemDefinition) => {
    const registry = createSystemRegistry();
    registerSystem(registry, { ...system, frequency: 0, lastRun: 0 });
    runSystems(world, registry, 1, 500);
    expect(registry.errors).toEqual([]);
  };
  run({ name: "ScheduleFixture", description: "Create actual schedule movement goals", pseudocode: "", active: true, frequency: 0, lastRun: 0, compiledFn: scheduleExecutionSystem });
  const movementGoal = (eid: number) => getRelationTargets(world, eid, HasGoal).find(goal => Goal.kind[goal] === "move_to_room")!;
  expect(movementGoal(packaged)).toBeDefined();
  expect(Goal.description[movementGoal(packaged)]).toBe("Go to Utility Room for night shift");
  return { world, origin, destination, packaged, native, run, movementGoal,
    close: () => { unregister(); clearMovementTarget(packaged); clearMovementTarget(native); } };
}

test("Movement leaves an idle package actor's grid and canonical room alone despite a competing target", () => {
  const f = fixture();
  try {
    for (const eid of [f.packaged, f.native]) setMovementTarget(eid, f.destination);
    f.run(createMovementSystem());
    expect({ x: GridPosition.x[f.packaged], y: GridPosition.y[f.packaged] }).toEqual({ x: 0, y: 0 });
    expect(getDirectContainer(f.world, f.packaged)).toBe(f.origin);
    expect(Goal.status[f.movementGoal(f.packaged)]).toBe("active");
    expect(GridPosition.x[f.native]).toBe(1);
    expect(getMovementTarget(f.native)).toBe(f.destination);
  } finally { f.close(); }
});

test("RoomArrival cannot overwrite package containment even when its grid is in another room", () => {
  const f = fixture();
  try {
    for (const eid of [f.packaged, f.native]) GridPosition.x[eid] = GridPosition.x[f.destination];
    f.run(createRoomArrivalSystem());
    expect(getDirectContainer(f.world, f.packaged)).toBe(f.origin);
    expect(GridPosition.x[f.packaged]).toBe(GridPosition.x[f.destination]);
    expect(GridPosition.y[f.packaged]).toBe(0);
    expect(Goal.status[f.movementGoal(f.packaged)]).toBe("active");
    expect(getDirectContainer(f.world, f.native)).toBe(f.destination);
  } finally { f.close(); }
});

test.each([
  ["grid goal pursuit", () => createGoalPursuitSystem(), false],
  ["legacy deterministic goal pursuit", () => ({ name: "LegacyGoalPursuit", description: "Legacy movement writer", pseudocode: "", active: true, frequency: 0, lastRun: 0, compiledFn: goalPursuitSystem }), true],
] as const)("%s cannot commandeer an idle package actor for a schedule goal", (_name, create, teleports) => {
  const f = fixture();
  try {
    setMovementTarget(f.packaged, f.origin); // Even a stale native target is not retargeting authority.
    f.run(create());
    expect(getDirectContainer(f.world, f.packaged)).toBe(f.origin);
    expect({ x: GridPosition.x[f.packaged], y: GridPosition.y[f.packaged] }).toEqual({ x: 0, y: 0 });
    expect(getMovementTarget(f.packaged)).toBe(f.origin);
    expect(Goal.status[f.movementGoal(f.packaged)]).toBe("active");
    if (teleports) {
      expect(getDirectContainer(f.world, f.native)).toBe(f.destination);
      expect(Goal.status[f.movementGoal(f.native)]).toBe("completed");
    } else {
      expect(getMovementTarget(f.native)).toBe(f.destination);
    }
  } finally { f.close(); }
});
