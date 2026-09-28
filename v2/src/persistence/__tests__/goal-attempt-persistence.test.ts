import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GoalAttempt, Memory, ProcedureState } from "../../ecs/components";
import { HasMemory } from "../../ecs/relations";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createIntentGoal } from "../../cognition/cognition-system";
import { recordGoalAttemptActivity, readGoalAttemptActivity, exhaustGoalMacro, isGoalMacroExhausted } from "../../cognition/goal-attempt";
import { tryStartProcedureExecution, onProcedureActionResult, selectProceduralAction, serializeProceduralSkillV1 } from "../../cognition/procedural-skills";
import { deserializeWorld, serializeWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Attempt source"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Choose", roomId: room });
  const goal = createIntentGoal(world, actor, "Investigate", 5);
  const registry = createSystemRegistry();
  function restore() {
    const snapshot = JSON.parse(JSON.stringify(serializeWorld(world, registry)));
    const restored = createArgosWorld("Restored"); initializePrefabs(restored);
    for (let i = 0; i < 17; i++) addEntity(restored);
    const loaded = deserializeWorld(restored, createSystemRegistry(), snapshot);
    return { world: restored, actor: loaded.oldToNewId.get(actor)!, goal: loaded.oldToNewId.get(goal)! };
  }
  return { world, actor, peer, goal, restore };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline attempt restoration")));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("exhausted attempt and real activity survive remapping without becoming goal progress", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 42_000);
  recordGoalAttemptActivity(f.world, f.actor, f.goal); exhaustGoalMacro(f.world, f.actor, f.goal, "goal:investigate|one");
  const r = f.restore();
  expect(r.goal).not.toBe(f.goal);
  expect(readGoalAttemptActivity(r.world, r.actor, r.goal)).toBe(42_000);
  expect(isGoalMacroExhausted(r.world, r.actor, r.goal, "goal:investigate|one")).toBe(true);
  expect(isGoalMacroExhausted(r.world, r.actor, r.goal, "goal:investigate|different")).toBe(false);
  expect(Goal.progress[r.goal]).toBe(0);
});

test("another actor, changed goal, or future activity cannot inherit an old attempt", () => {
  const f = fixture(); recordGoalAttemptActivity(f.world, f.actor, f.goal);
  exhaustGoalMacro(f.world, f.actor, f.goal, "goal:investigate|one");
  expect(readGoalAttemptActivity(f.world, f.peer, f.goal)).toBeUndefined();
  GoalAttempt.lastActivitySimMs[f.goal] = 1_000_000;
  expect(readGoalAttemptActivity(f.world, f.actor, f.goal)).toBeUndefined();
  Goal.description[f.goal] = "Investigate a new incident";
  expect(readGoalAttemptActivity(f.world, f.actor, f.goal)).toBeUndefined();
  expect(isGoalMacroExhausted(f.world, f.actor, f.goal, "goal:investigate|one")).toBe(false);
});

test("restored procedural cursor remains intent until fresh admission, not a replayed command", () => {
  const f = fixture(); const memory = addEntity(f.world);
  addComponent(f.world, memory, Memory); addComponent(f.world, f.actor, HasMemory(memory));
  Memory.type[memory] = "procedural";
  Memory.content[memory] = serializeProceduralSkillV1({ kind: "procedure_v1", name: "Consider", signature: "consider|one",
    trigger: { affordance: "consider" }, steps: [{ type: "think", content: "First" }, { type: "think", content: "Second" }],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } });
  expect(tryStartProcedureExecution(f.world, f.actor, "consider|one")).toBe(true);
  onProcedureActionResult(f.world, f.actor, { type: "think", content: "First" }, { success: true });
  const r = f.restore();
  expect(ProcedureState.stepIndex[r.actor]).toBe(1);
  expect(ProcedureState.status[r.actor]).toBe("needs_revision");
  expect(selectProceduralAction(r.world, r.actor)).toBeNull();
  onProcedureActionResult(r.world, r.actor, { type: "think", content: "Second" }, { success: true });
  expect(hasComponent(r.world, r.actor, ProcedureState)).toBe(true);
  expect(ProcedureState.stepIndex[r.actor]).toBe(1);
  expect(tryStartProcedureExecution(r.world, r.actor, "consider|one")).toBe(true);
  expect(selectProceduralAction(r.world, r.actor)?.content).toBe("First");
});
