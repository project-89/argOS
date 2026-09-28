import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { Goal, Memory, Plan } from "../../ecs/components";
import { HasMemory } from "../../ecs/relations";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createIntentGoal } from "../cognition-system";
import { checkStepPrerequisites, createPlanEntity, getNextPlannedAction, type PlanStep } from "../planning-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { serializeProceduralSkillV1, selectProceduralAction, tryStartProcedureExecution } from "../procedural-skills";
import { drainPendingStimuli } from "../stimulus-queue";
import { selectFastAgentAction } from "../agent-mind";
import { setAgentBehaviorPolicy } from "../behavior-policy";

const removers: Array<() => void> = [];
function fixture(command: string, fresh: boolean) {
  const world = createArgosWorld("Communication decision boundary"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose your own actions.", roomId: room });
  const target = createObjectEntity(world, { name: "Desk console", roomId: room, portable: false });
  const goal = createIntentGoal(world, actor, "Update my colleague", 8);
  removers.push(registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, affordances: id => id === target ? [{ name: command, requires: [], requiresFreshDecision: fresh }] : [] }));
  const step: PlanStep = { description: "Update my colleague based on what has actually happened", actionType: "interact",
    target: "Desk console", content: `${command} {"text":"The work is done."}` };
  return { world, actor, target, goal, step };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline command policy tests")); });
afterEach(() => { removers.splice(0).forEach(fn => fn()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["reply", "transmit_update"])("%s remains available for a fresh choice but its stored wording cannot auto-execute", command => {
  const f = fixture(command, true);
  expect(getAvailableAffordances(f.world, f.actor, f.target).some(a => a.name === command)).toBe(true);
  expect(checkStepPrerequisites(f.world, f.actor, f.step)).toBe(false);
  const id = createPlanEntity(f.world, f.actor, f.goal, { goalDescription: Goal.description[f.goal], estimatedCompletion: "short",
    potentialObstacles: [], steps: [f.step] });
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(Plan.currentStep[id]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
});

test("capability policy, not command spelling, controls stored execution", () => {
  const f = fixture("reply", false);
  expect(checkStepPrerequisites(f.world, f.actor, f.step)).toBe(true);
});

test("a learned procedure cannot replay context-sensitive wording either", () => {
  const f = fixture("transmit_update", true), memory = addEntity(f.world);
  addComponent(f.world, memory, Memory); addComponent(f.world, f.actor, HasMemory(memory));
  Memory.type[memory] = "procedural";
  Memory.content[memory] = serializeProceduralSkillV1({ kind: "procedure_v1", signature: "test|send", name: "Send update",
    trigger: { affordance: "transmit_update" }, steps: [{ type: "interact", target: f.step.target, content: f.step.content }],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } });
  expect(tryStartProcedureExecution(f.world, f.actor, "test|send")).toBe(true);
  expect(selectProceduralAction(f.world, f.actor)).toBeNull();
});

test("the legacy behavior-policy route also yields to a current decision", () => {
  const f = fixture("transmit_update", true); Goal.status[f.goal] = "completed";
  setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "interact", target: f.step.target, content: f.step.content } });
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
});
