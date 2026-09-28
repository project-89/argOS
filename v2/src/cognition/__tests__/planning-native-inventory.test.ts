import { jest } from "@jest/globals";
import { removeComponent } from "bitecs";
import { Agent, Goal, Inventory, ObjectState, Plan, Traits } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createArgosWorld } from "../../ecs/world";
import { createIntentGoal, executeActions } from "../cognition-system";
import { checkStepPrerequisites, createPlanEntity, generatePlanForGoal, getNextPlannedAction, validateGeneratedPlan, type GeneratedPlan, type PlanStep } from "../planning-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";
import { getWorkingMemory } from "../working-memory";

function fixture() {
  const world = createArgosWorld("Native inventory plans"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workroom" }), remote = createRoomEntity(world, { name: "Landing" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Respect actual possession.", roomId: room });
  const other = createAgentEntity(world, { name: "Bea", role: "resident", systemPrompt: "Respect actual possession.", roomId: room });
  const item = createObjectEntity(world, { name: "Brass spool", roomId: room, portable: true });
  const box = createObjectEntity(world, { name: "Toolbox", roomId: room, portable: false });
  const goal = createIntentGoal(world, actor, "Organize the local workshop materials", 8), registry = createSystemRegistry();
  const plan = (steps: PlanStep[]): GeneratedPlan => ({ goalDescription: Goal.description[goal], steps, estimatedCompletion: "short", potentialObstacles: [] });
  const validate = (steps: PlanStep[]) => validateGeneratedPlan(world, actor, Goal.description[goal], plan(steps));
  const store = (steps: PlanStep[]) => createPlanEntity(world, actor, goal, plan(steps));
  const execute = () => { const step = getNextPlannedAction(world, actor); expect(step).not.toBeNull();
    executeActions(world, [{ eid: actor, action: { type: step!.actionType, target: step!.target, content: step!.content } }], registry); };
  return { world, room, remote, actor, other, item, box, goal, registry, plan, validate, store, execute };
}
const pickup: PlanStep = { description: "Pick up the spool", actionType: "pickup", target: "Brass spool" };
const drop: PlanStep = { description: "Set down the spool", actionType: "drop", target: "Brass spool" };
const give: PlanStep = { description: "Hand the spool to Bea", actionType: "give", target: "Bea", content: "Brass spool" };

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Native plan tests cannot call models")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("a stored pickup→drop→pickup→give chain advances only from real canonical transfers", () => {
  const f = fixture(), steps = [pickup, drop, pickup, give];
  const memory = getWorkingMemory(f.world, f.actor);
  expect(f.validate(steps)).toEqual({ ok: true, issues: [] });
  // Whole-plan projection is read-only; it does not grant future possession now.
  expect(getDirectContainer(f.world, f.item)).toBe(f.room); expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(checkStepPrerequisites(f.world, f.actor, give)).toBe(false);
  const stored = f.store(steps); expect(Plan.currentStep[stored]).toBe(0);
  f.execute(); expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(Plan.currentStep[stored]).toBe(1);
  f.execute(); expect(getDirectContainer(f.world, f.item)).toBe(f.room); expect(Plan.currentStep[stored]).toBe(2);
  f.execute(); expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(Plan.currentStep[stored]).toBe(3);
  f.execute(); expect(getDirectContainer(f.world, f.item)).toBe(f.other); expect(Plan.status[stored]).toBe("completed");
  expect(Goal.status[f.goal]).toBe("active"); // Exhausting a plan is not its goal's verdict.
});

test.each([
  ["drop without ownership", [drop]], ["give without ownership", [give]],
  ["repeat pickup while already held", [pickup, pickup]], ["give twice", [pickup, give, give]],
  ["drop after giving away", [pickup, give, drop]], ["retake from recipient", [pickup, give, pickup]],
] as const)("whole-plan ownership projection rejects %s", (_label, steps) => {
  const f = fixture(); expect(f.validate([...steps]).ok).toBe(false); expect(getDirectContainer(f.world, f.item)).toBe(f.room);
});

test.each([
  ["remote item", (f: ReturnType<typeof fixture>) => setLocatedIn(f.world, f.item, f.remote)],
  ["closed container", (f: ReturnType<typeof fixture>) => { setLocatedIn(f.world, f.item, f.box); ObjectState.current[f.box] = "closed"; }],
  ["held by someone else", (f: ReturnType<typeof fixture>) => setLocatedIn(f.world, f.item, f.other)],
  ["not takeable", (f: ReturnType<typeof fixture>) => { Traits.active[f.item] = "[]"; }],
  ["missing inventory capability", (f: ReturnType<typeof fixture>) => removeComponent(f.world, f.actor, Inventory)],
  ["ambiguous visible item", (f: ReturnType<typeof fixture>) => createObjectEntity(f.world, { name: "Brass spool", roomId: f.room, portable: true })],
] as const)("generated and immediate pickup gates reject %s", (_label, mutate) => {
  const f = fixture(); mutate(f);
  expect(f.validate([pickup]).ok).toBe(false); expect(checkStepPrerequisites(f.world, f.actor, pickup)).toBe(false);
});

test("verified visible open-container contents can be picked up, but visibility cannot bypass a closed lid", () => {
  const f = fixture(); setLocatedIn(f.world, f.item, f.box); ObjectState.current[f.box] = "open";
  const dispose = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, visibleEntities: () => [f.item] });
  expect(f.validate([pickup]).ok).toBe(true); const id = f.store([pickup]); f.execute();
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(Plan.status[id]).toBe("completed");
  setLocatedIn(f.world, f.item, f.box); ObjectState.current[f.box] = "closed";
  expect(f.validate([pickup]).ok).toBe(false); expect(checkStepPrerequisites(f.world, f.actor, pickup)).toBe(false); dispose();
});

test.each([
  ["remote recipient", (f: ReturnType<typeof fixture>) => setLocatedIn(f.world, f.other, f.remote), give],
  ["self recipient", (_f: ReturnType<typeof fixture>) => {}, { ...give, target: "Ada" }],
  ["no receiving inventory", (f: ReturnType<typeof fixture>) => removeComponent(f.world, f.other, Inventory), give],
  ["non-agent recipient", (f: ReturnType<typeof fixture>) => removeComponent(f.world, f.other, Agent), give],
  ["missing item argument", (_f: ReturnType<typeof fixture>) => {}, { ...give, content: undefined }],
  ["ambiguous recipient", (f: ReturnType<typeof fixture>) => createAgentEntity(f.world, { name: "Bea", role: "npc", systemPrompt: "", roomId: f.room }), give],
] as const)("generated and immediate give gates reject %s", (_label, mutate, step) => {
  const f = fixture(); setLocatedIn(f.world, f.item, f.actor); mutate(f);
  expect(f.validate([step]).ok).toBe(false); expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
});

test("an actual receiver departure after pickup retires the stored give without moving the item", () => {
  const f = fixture(), id = f.store([pickup, give]); f.execute(); setLocatedIn(f.world, f.other, f.remote);
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("failed");
  expect(Plan.currentStep[id]).toBe(1); expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
});

test("stale inventory cache cannot manufacture ownership for drop or give", () => {
  const f = fixture(); Inventory.items[f.actor] = JSON.stringify([f.item]);
  expect(f.validate([drop]).ok).toBe(false); expect(f.validate([give]).ok).toBe(false);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
});

test("the executor's real capacity failure cannot advance an admitted inventory plan", () => {
  const f = fixture(); Inventory.maxSlots[f.actor] = 0;
  const id = f.store([pickup, give]); f.execute();
  expect(getDirectContainer(f.world, f.item)).toBe(f.room); expect(Plan.currentStep[id]).toBe(0);
  expect(Plan.status[id]).not.toBe("completed"); expect(Goal.status[f.goal]).toBe("active");
});

test("registry-backed prompt teaches native give fields and does not invent interact-take", async () => {
  const f = fixture(), generate = jest.fn(async (_request: any) => ({ text: JSON.stringify(f.plan([pickup, give])) }));
  expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any })).not.toBeNull();
  const request = generate.mock.calls[0][0];
  expect(request.prompt).toContain("pickup|drop|give"); expect(request.system).toContain("target: recipient name; content: exact item name");
  expect(request.system).toContain("Brass spool"); expect(request.system).toContain("native actions: pickup");
  removeComponent(f.world, f.actor, Inventory);
  expect(f.validate([pickup]).ok).toBe(false);
});

test.each(["use", "examine", "attack", "teleport"])("registration alone does not authorize ungrounded stored action %s", actionType => {
  const f = fixture(), step = { ...pickup, actionType } as PlanStep;
  expect(f.validate([step]).ok).toBe(false); expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
});
