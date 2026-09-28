import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, ObjectState, Plan } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createIntentGoal } from "../cognition-system";
import { getCurrentInspection, recordInspectionResult } from "../inspection-memory";
import { getNextPlannedAction, getPlanForGoal, runPlanningSystem, type GeneratedPlan } from "../planning-system";
import { captureWorkingMemoryObservation } from "../working-memory-observation";

function fixture() {
  const world = createArgosWorld("Inspection phase ordering"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Store Room" });
  const actor = createAgentEntity(world, { name: "Sera", role: "resident", systemPrompt: "Act on evidence.", roomId: room });
  const cupboard = createObjectEntity(world, { name: "Supply cupboard", portable: false, roomId: room });
  addComponent(world, cupboard, Container); ObjectState.current[cupboard] = "open";
  const goal = createIntentGoal(world, actor, "Check the supplies", 8);
  const draft: GeneratedPlan = { goalDescription: "Check the supplies", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Inspect the cupboard", actionType: "observe", target: "Supply cupboard" }] };
  const generate = () => runPlanningSystem(world, { agentEids: [actor], background: true, planGenerator: async () => draft });
  return { world, room, actor, cupboard, goal, generate };
}
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Phase-order regression is offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("background plan admission cannot consume an old inspection before fresh foreground perception", async () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.cupboard);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")?.outcome).toBe("empty");
  const fuse = createObjectEntity(f.world, { name: "New fuse", portable: true, roomId: f.room });
  setLocatedIn(f.world, fuse, f.cupboard);
  await f.generate();
  const plan = getPlanForGoal(f.world, f.actor, f.goal)!;
  // Planning has not admitted a percept, so it cannot prematurely erase a step.
  expect(Plan.status[plan]).toBe("active"); expect(Plan.currentStep[plan]).toBe(0);
  expect(JSON.parse(Plan.steps[plan])[0].resolution).toBeUndefined();
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "observe", target: "Supply cupboard", currentStep: 0 });
});

test("an unchanged inspection can still cover the new plan once foreground perception admits it", async () => {
  const f = fixture(); const inspection = recordInspectionResult(f.world, f.actor, f.cupboard)!;
  await f.generate(); const plan = getPlanForGoal(f.world, f.actor, f.goal)!;
  expect(Plan.status[plan]).toBe("active");
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.status[plan]).toBe("awaiting_evidence");
  expect(JSON.parse(Plan.steps[plan])[0].resolution.sourceId).toBe(inspection.sourceId);
});
