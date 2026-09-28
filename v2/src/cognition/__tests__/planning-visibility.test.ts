import { jest } from "@jest/globals";
import { addComponent, getRelationTargets } from "bitecs";
import { Container, Name, ObjectState, Traits } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createArgosWorld } from "../../ecs/world";
import { createIntentGoal } from "../cognition-system";
import { inventoryStepIssue } from "../planning-inventory";
import { generatePlanForGoal, runPlanningSystem, type GeneratedPlan } from "../planning-system";
import type { PlanningEvent } from "../planning-telemetry";
import { drainPendingStimuli } from "../stimulus-queue";
import { registerAgentWorldCapabilities } from "../world-capabilities";

const cleanup: Array<() => void> = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Planning visibility tests stay offline")); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Planner sensory boundary"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" }), remote = createRoomEntity(world, { name: "Annex" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use local evidence", roomId: room });
  const other = createAgentEntity(world, { name: "Visible friend", role: "resident", systemPrompt: "Private", roomId: room });
  const goal = createIntentGoal(world, actor, "Consider my next step", 8);
  const object = (name: string, parent = room, traits: string[] = ["takeable"]) => {
    const id = createObjectEntity(world, { name, portable: true, roomId: room, traits }); setLocatedIn(world, id, parent); return id;
  };
  const events: PlanningEvent[] = [];
  const hook = jest.fn((id: number) => [{ name: `operate ${Name.value[id]} ${ObjectState.current[id] || "ready"}`, description: "Current labelled command", requires: [] }]);
  let supplied: number[] = [];
  cleanup.push(registerAgentWorldCapabilities(world, actor, { ready: () => true, busy: () => false, context: () => "",
    execute: () => false, visibleEntities: () => supplied, affordances: hook, onPlanningEvent: event => events.push(event) }));
  const proposal: GeneratedPlan = { goalDescription: "Consider my next step", steps: [
    { description: "Consider what I know", actionType: "think", content: "I should consider my next step." },
  ], estimatedCompletion: "short", potentialObstacles: [] };
  return { world, room, remote, actor, other, goal, object, events, hook, proposal,
    expose: (...ids: number[]) => { supplied = ids; },
    run: (planGenerator: () => Promise<GeneratedPlan>) => runPlanningSystem(world, { agentEids: [actor], planGenerator }) };
}

test.each([false, true])("background prompt retains own item names, never unseen labels/contents (blind=%s)", async blind => {
  const f = fixture(), held = f.object("Carried instrument", f.actor, ["hidden"]);
  ObjectState.current[held] = "PRIVATE_LABEL";
  const bag = f.object("My bag", f.actor); addComponent(f.world, bag, Container); ObjectState.current[bag] = "closed";
  const child = f.object("PRIVATE_CONTENTS", bag), hidden = f.object("PRIVATE_ROOM_OBJECT", f.room, ["hidden"]);
  const foreign = f.object("PRIVATE_FOREIGN_ITEM", f.other), remote = f.object("PRIVATE_REMOTE_ITEM", f.remote);
  f.expose(held, child, hidden, foreign, remote);
  if (blind) { addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]'; }
  const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify(f.proposal) }));
  expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any })).not.toBeNull();
  const system = generate.mock.calls[0][0].system;
  expect(system).toContain("Carried instrument: your possession (not currently seen); native actions: drop");
  expect(system).not.toMatch(/PRIVATE_LABEL|PRIVATE_CONTENTS|PRIVATE_ROOM_OBJECT|PRIVATE_FOREIGN_ITEM|PRIVATE_REMOTE_ITEM/);
  if (blind) expect(system).not.toContain("Visible friend");
  for (const target of [held, child, hidden, foreign, remote]) expect(f.hook.mock.calls.some(([id]) => id === target)).toBe(false);
});

test("background prompt discovers ordinary visible nested controls and native pickup, not hidden siblings", async () => {
  const f = fixture(), box = f.object("Open toolbox"); addComponent(f.world, box, Container); ObjectState.current[box] = "open";
  const visible = f.object("Brass tool", box), hidden = f.object("PRIVATE_TOOL", box, ["hidden"]);
  f.expose(hidden);
  const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify(f.proposal) }));
  await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any });
  const system = generate.mock.calls[0][0].system;
  expect(system).toContain("operate Brass tool"); expect(system).toContain("native actions: pickup");
  expect(system).not.toContain("PRIVATE_TOOL"); expect(f.hook.mock.calls.some(([id]) => id === visible)).toBe(true);
});

test("unseen owned label changes do not query private commands or spuriously invalidate a pending background plan", async () => {
  const f = fixture(), held = f.object("Carried instrument", f.actor, ["hidden"]);
  ObjectState.current[held] = "PRIVATE_BEFORE"; f.expose(held);
  let resolve!: (plan: GeneratedPlan) => void;
  const pending = new Promise<GeneratedPlan>(r => { resolve = r; });
  const running = f.run(() => pending);
  ObjectState.current[held] = "PRIVATE_AFTER";
  resolve(f.proposal); await running;
  expect(f.events.at(-1)).toMatchObject({ stage: "admitted" });
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(1);
  expect(f.hook.mock.calls.some(([id]) => id === held)).toBe(false);
});

test.each(["visible label changes", "direct possession ends", "vision returns"])("public planning fingerprint still rejects a stale proposal when %s", async change => {
  const f = fixture(), item = f.object("Instrument", change === "visible label changes" ? f.room : f.actor);
  if (change === "vision returns") { addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]'; }
  if (change === "direct possession ends") Traits.active[item] = '["hidden"]';
  ObjectState.current[item] = "before"; f.expose(item);
  let resolve!: (plan: GeneratedPlan) => void;
  const pending = new Promise<GeneratedPlan>(r => { resolve = r; });
  const running = f.run(() => pending);
  if (change === "visible label changes") ObjectState.current[item] = "after";
  else if (change === "direct possession ends") setLocatedIn(f.world, item, f.room);
  else Traits.active[f.actor] = "[]";
  resolve(f.proposal); await running;
  expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "visible_state_changed" });
  expect(f.events.some(event => event.stage === "admitted")).toBe(false);
});

test.each(["closed", "locked", "closed; locked"])("native inventory planning respects %s over stale open traits", state => {
  const f = fixture(), box = f.object("Toolbox", f.room, ["open"]), tool = f.object("Brass tool", box);
  addComponent(f.world, box, Container); ObjectState.current[box] = state; f.expose(tool);
  expect(inventoryStepIssue(f.world, f.actor, { actionType: "pickup", target: "Brass tool" })).toBeDefined();
  ObjectState.current[box] = "open";
  expect(inventoryStepIssue(f.world, f.actor, { actionType: "pickup", target: "Brass tool" })).toBeUndefined();
});
