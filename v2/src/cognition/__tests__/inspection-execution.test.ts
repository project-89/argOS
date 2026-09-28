import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, LastAction, ObjectState, Plan, Traits } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { completeDeferredAction, createIntentGoal, executeActions, runCognitionCycle } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";
import { getCurrentInspection } from "../inspection-memory";
import { getWorkingMemory } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import type { AgentAction } from "../agent-mind";

function fixture() {
  const world = createArgosWorld("Inspection execution"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Store Room" });
  const remote = createRoomEntity(world, { name: "Remote Room" });
  const actor = createAgentEntity(world, { name: "Sera", role: "resident", systemPrompt: "Act on experience", roomId: room });
  const box = createObjectEntity(world, { name: "Supply cupboard", roomId: room, portable: false });
  addComponent(world, box, Container); ObjectState.current[box] = "open";
  const registry = createSystemRegistry();
  const inspect = (type = "observe") => executeActions(world, [{ eid: actor, action: { type: type as "observe", target: "Supply cupboard" } }], registry);
  return { world, room, remote, actor, box, registry, inspect };
}
beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Inspection regressions are offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["observe", "examine"])("native %s delivers and retains an actual empty-container answer", type => {
  const f = fixture(); f.inspect(type);
  expect(LastAction.success[f.actor]).toBe(true);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toMatchObject({ outcome: "empty" });
  expect(peekPendingStimuli(f.actor).some(event => event.content.includes("Visibly empty"))).toBe(true);
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.id.startsWith("inspection:"))).toHaveLength(1);
});

test("native inspection distinguishes closed unknown contents from open visible contents", () => {
  const f = fixture();
  const fuse = createObjectEntity(f.world, { name: "Secret spare", roomId: f.room, portable: true });
  setLocatedIn(f.world, fuse, f.box); ObjectState.current[f.box] = "locked";
  f.inspect();
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toMatchObject({ outcome: "not_observable" });
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toContain("Secret spare");
  ObjectState.current[f.box] = "open"; captureWorkingMemoryObservation(f.world, f.actor);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
  f.inspect();
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toMatchObject({ outcome: "contents" });
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")?.summary).toContain("Secret spare");
});

test("a failed remote or blind inspection does not manufacture a receipt", () => {
  const f = fixture(); setLocatedIn(f.world, f.box, f.remote); f.inspect();
  expect(LastAction.success[f.actor]).toBe(false);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
  setLocatedIn(f.world, f.box, f.room); addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]';
  f.inspect("examine");
  expect(LastAction.success[f.actor]).toBe(false);
  expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.id.startsWith("inspection:"))).toHaveLength(0);
});

test("deferred package inspection learns only its completed accessible result", () => {
  const f = fixture(); let busy = false, received: AgentAction;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => !busy, busy: () => busy,
    execute: action => { busy = true; received = { ...action }; return true; },
  });
  const action = { type: "observe" as const, target: "Supply cupboard" };
  try {
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
    busy = false; completeDeferredAction(f.world, f.actor, received!, true, "Finished examining the cupboard.");
    expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toMatchObject({ outcome: "empty" });
    expect(getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.id.startsWith("inspection:"))).toHaveLength(1);
  } finally { remove(); }
});

test("an unissued or replayed deferred inspection cannot mint another inspection receipt", () => {
  const f = fixture(), action = { type: "observe" as const, target: "Supply cupboard" };
  completeDeferredAction(f.world, f.actor, action, true, "Unissued result.");
  expect(getCurrentInspection(f.world, f.actor, action.target)).toBeUndefined();
  let busy = false, received: AgentAction;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => !busy, busy: () => busy,
    execute: action => { busy = true; received = { ...action }; return true; } });
  try {
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    busy = false; completeDeferredAction(f.world, f.actor, received!, true, "Actual result.");
    const original = getCurrentInspection(f.world, f.actor, action.target);
    expect(original).toMatchObject({ outcome: "empty" });
    completeDeferredAction(f.world, f.actor, received!, true, "Replayed result.");
    expect(getCurrentInspection(f.world, f.actor, action.target)?.sourceId).toBe(original?.sourceId);
    expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.id.startsWith("inspection:"))).toHaveLength(1);
  } finally { remove(); }
});

test("deferred inspection cannot rebind to a same-name replacement object", () => {
  const f = fixture(), action = { type: "observe" as const, target: "Supply cupboard" };
  let busy = false, received: AgentAction;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => !busy, busy: () => busy,
    execute: action => { busy = true; received = { ...action }; return true; } });
  try {
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    removeEntity(f.world, f.box);
    const replacement = createObjectEntity(f.world, { name: action.target, roomId: f.room, portable: false });
    addComponent(f.world, replacement, Container); ObjectState.current[replacement] = "open";
    busy = false; completeDeferredAction(f.world, f.actor, received!, true, "Old inspection finished.");
    expect(getCurrentInspection(f.world, f.actor, action.target)).toBeUndefined();
    expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.id.startsWith("inspection:"))).toHaveLength(0);
  } finally { remove(); }
});

test("deferred room inspection retains the originally inspected room identity", () => {
  const f = fixture(), action = { type: "observe" as const, target: "Store Room" };
  let busy = false, received: AgentAction;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => !busy, busy: () => busy,
    execute: action => { busy = true; received = { ...action }; return true; } });
  try {
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    busy = false; completeDeferredAction(f.world, f.actor, received!, true, "Room inspected.");
    expect(getCurrentInspection(f.world, f.actor, action.target)).toMatchObject({ outcome: "contents" });
  } finally { remove(); }
});

test("a completion callback cannot change the question that was actually inspected", () => {
  const f = fixture(), action = { type: "observe" as const, target: "Supply cupboard" };
  let busy = false, received: AgentAction;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => !busy, busy: () => busy,
    execute: action => { busy = true; received = { ...action }; return true; } });
  try {
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    busy = false;
    completeDeferredAction(f.world, f.actor, { ...received!, content: "Are there termites inside?" }, true, "Tampered callback.");
    expect(getCurrentInspection(f.world, f.actor, action.target)).toBeUndefined();
    completeDeferredAction(f.world, f.actor, received!, true, "Finished the general look.");
    expect(getCurrentInspection(f.world, f.actor, action.target)).toMatchObject({ outcome: "empty", question: "general inspection" });
    expect(getCurrentInspection(f.world, f.actor, action.target, "Are there termites inside?")).toBeUndefined();
  } finally { remove(); }
});

test("foreground senses a changed cupboard before reconciling its planned inspection", async () => {
  const f = fixture(); f.inspect();
  const goal = createIntentGoal(f.world, f.actor, "Check the supplies", 8);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Check the supplies", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Inspect the cupboard", actionType: "observe", target: "Supply cupboard" }] });
  const fuse = createObjectEntity(f.world, { name: "New fuse", roomId: f.room, portable: true });
  setLocatedIn(f.world, fuse, f.box);
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  try {
    await runCognitionCycle(f.world, f.registry, { tick: 100_000, agentEids: [f.actor], enablePlanning: false });
    expect(getCurrentInspection(f.world, f.actor, "Supply cupboard")).toBeUndefined();
    expect(Plan.status[plan]).toBe("active");
    expect(Plan.currentStep[plan]).toBe(0);
    expect(JSON.parse(Plan.steps[plan])[0].resolution).toBeUndefined();
  } finally { remove(); }
});
