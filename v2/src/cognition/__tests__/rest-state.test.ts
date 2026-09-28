import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets, hasComponent, query, removeEntity } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { AllComponents, Agent, Goal, InCombat, Needs, RestState } from "../../ecs/components";
import { AllRelations } from "../../ecs/relations";
import { createSystemRegistry, runSystems, type SystemContext } from "../../ecs/dynamic-systems";
import { createRestRecoverySystem } from "../../systems/builtin-systems";
import { locationNeedSatisfactionSystem, needsBasedMovementSystem, needsDecaySystem } from "../../systems/deterministic-behavior-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { beginRest, endRest, isResting, updateRestState } from "../rest-state";
import { drainPendingStimuli } from "../stimulus-queue";
import { completeDeferredAction, executeActions } from "../cognition-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";

function fixture(roomName = "Common Room") {
  const world = createArgosWorld("Real rest"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: roomName });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
  addComponent(world, actor, Needs);
  Needs.energy[actor] = 10; Needs.hunger[actor] = 20; Needs.social[actor] = 80;
  return { world, actor };
}
function context(world: World, delta = 1000): SystemContext {
  return { world, delta, tick: 1, components: AllComponents, relations: AllRelations,
    query, hasComponent, getRelationTargets, emit: jest.fn(), log: jest.fn() } as unknown as SystemContext;
}

beforeEach(() => drainPendingStimuli());
afterEach(() => { drainPendingStimuli(); jest.restoreAllMocks(); });

test("rest admission does not restore energy; fractional elapsed steps do", () => {
  const f = fixture();
  expect(beginRest(f.world, f.actor)).toBe(true);
  expect(isResting(f.world, f.actor)).toBe(true);
  expect(Needs.energy[f.actor]).toBe(10);
  for (let i = 0; i < 4; i++) updateRestState(f.world, 250);
  expect(Needs.energy[f.actor]).toBe(12);
  expect(drainPendingStimuli()).toEqual([]);
  const started = RestState.startedAt[f.actor];
  expect(beginRest(f.world, f.actor)).toBe(true);
  expect(RestState.startedAt[f.actor]).toBe(started);
  endRest(f.world, f.actor);
  updateRestState(f.world, 10_000);
  expect(isResting(f.world, f.actor)).toBe(false);
  expect(Needs.energy[f.actor]).toBe(12);
});

test("completion emits one personal body receipt and clamps large elapsed steps", () => {
  const f = fixture();
  const other = createAgentEntity(f.world, { name: "Ivo", role: "resident", systemPrompt: "test" });
  beginRest(f.world, f.actor);
  updateRestState(f.world, 100_000);
  expect(Needs.energy[f.actor]).toBe(100);
  expect(isResting(f.world, f.actor)).toBe(true);
  const feedback = drainPendingStimuli();
  expect(feedback).toHaveLength(1);
  expect(feedback[0]).toMatchObject({ targetEid: f.actor, type: "rest_complete", source: "body" });
  expect(feedback.some(stimulus => stimulus.targetEid === other)).toBe(false);
  updateRestState(f.world, 100_000);
  expect(drainPendingStimuli()).toEqual([]);
  Needs.energy[f.actor] = 99; // A separate world disturbance cannot spam the same episode's receipt.
  updateRestState(f.world, 1000);
  expect(drainPendingStimuli()).toEqual([]);
});

test("inactive, deleted, missing-needs and fighting actors gain no rest recovery", () => {
  const f = fixture();
  for (const delta of [0, -1000, NaN, Infinity]) { beginRest(f.world, f.actor); updateRestState(f.world, delta); }
  expect(Needs.energy[f.actor]).toBe(10);
  addComponent(f.world, f.actor, InCombat); InCombat.targetEid[f.actor] = 9;
  expect(beginRest(f.world, f.actor)).toBe(false);
  updateRestState(f.world, 1000);
  expect(Needs.energy[f.actor]).toBe(10);
  InCombat.targetEid[f.actor] = -1; Agent.active[f.actor] = false;
  expect(beginRest(f.world, f.actor)).toBe(false);
  const nonActor = addEntity(f.world);
  expect(beginRest(f.world, nonActor)).toBe(false);
  removeEntity(f.world, f.actor);
  expect(isResting(f.world, f.actor)).toBe(false);
});

test("generic decay and passive room recovery do not fight or double-credit active rest", () => {
  const f = fixture("Bedroom");
  beginRest(f.world, f.actor);
  const ctx = context(f.world);
  needsDecaySystem(f.world, ctx);
  expect(Needs.energy[f.actor]).toBe(10);
  expect(Needs.hunger[f.actor]).toBeGreaterThan(20); // The rest state does not pause physiology.
  locationNeedSatisfactionSystem(f.world, ctx);
  expect(Needs.energy[f.actor]).toBe(10);
  updateRestState(f.world, 1000);
  expect(Needs.energy[f.actor]).toBe(12);
  needsBasedMovementSystem(f.world, ctx);
  expect([...query(f.world, [Goal])]).toEqual([]);
  endRest(f.world, f.actor);
  needsDecaySystem(f.world, ctx);
  expect(Needs.energy[f.actor]).toBeLessThan(12);
});

test("the registered builtin updates recovery each tick without a room-name recipe", () => {
  const f = fixture();
  const registry = createSystemRegistry(); registry.systems.set("RestRecovery", createRestRecoverySystem());
  beginRest(f.world, f.actor);
  for (let tick = 1; tick <= 4; tick++) runSystems(f.world, registry, tick, 250);
  expect(Needs.energy[f.actor]).toBe(12);
});

test("rest state survives remapped save/load but gains nothing from offline wall time", () => {
  const f = fixture(); beginRest(f.world, f.actor); updateRestState(f.world, 2000);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored rest"); initializePrefabs(restored);
  for (let i = 0; i < 8; i++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(actor).not.toBe(f.actor);
  expect(isResting(restored, actor)).toBe(true);
  expect(Needs.energy[actor]).toBe(14);
  updateRestState(restored, 1000);
  expect(Needs.energy[actor]).toBe(16);
});

test("fully recovered rest stays inhabited and its one recovery notice survives save/load", () => {
  const f = fixture(); beginRest(f.world, f.actor); updateRestState(f.world, 100_000); drainPendingStimuli();
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Rested save"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!;
  expect(isResting(restored, actor)).toBe(true);
  expect(RestState.recoveryNotified[actor]).toBe(true);
  needsDecaySystem(restored, context(restored)); updateRestState(restored, 1000);
  expect(Needs.energy[actor]).toBe(100);
  expect(drainPendingStimuli()).toEqual([]);
  Needs.energy[actor] = 99; updateRestState(restored, 1000);
  expect(drainPendingStimuli()).toEqual([]);
});

test("native execution admits rest without claiming recovered energy; accepted speech interrupts, quiet observation does not", () => {
  const f = fixture(), registry = createSystemRegistry();
  executeActions(f.world, [{ eid: f.actor, action: { type: "rest" } }], registry);
  expect(isResting(f.world, f.actor)).toBe(true);
  expect(Needs.energy[f.actor]).toBe(10);
  updateRestState(f.world, 1000);
  executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Common Room" } }], registry);
  expect(isResting(f.world, f.actor)).toBe(true);
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Missing lever", content: "pull" } }], registry);
  expect(isResting(f.world, f.actor)).toBe(true); // A failed intention did not start physical work.
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: "I'll help with the panel." } }], registry);
  expect(isResting(f.world, f.actor)).toBe(false);
  updateRestState(f.world, 1000);
  expect(Needs.energy[f.actor]).toBe(12);
});

test.each(["immediate", "pending"])("package-owned %s physical execution interrupts rest", mode => {
  const f = fixture(), registry = createSystemRegistry();
  let busy = false;
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "A valve beside the chair.", ready: () => !busy, busy: () => busy,
    execute: action => {
      if (action.type !== "interact") return false;
      if (mode === "pending") busy = true;
      else completeDeferredAction(f.world, f.actor, action, true, "The valve is now closed.");
      return true;
    },
  });
  try {
    executeActions(f.world, [{ eid: f.actor, action: { type: "rest" } }], registry);
    expect(isResting(f.world, f.actor)).toBe(true);
    executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Valve", content: "close" } }], registry);
    expect(isResting(f.world, f.actor)).toBe(false);
    updateRestState(f.world, 1000);
    expect(Needs.energy[f.actor]).toBe(10);
  } finally { unregister(); }
});
