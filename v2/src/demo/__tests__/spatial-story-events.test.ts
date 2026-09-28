import { jest } from "@jest/globals";
import { addComponent, addEntity, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Description, Mind, ObjectState, PhysicalObject, Position, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { drainPendingStimuli, peekPendingStimuli } from "../../cognition/stimulus-queue";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { ObjectManager } from "../../world/object-manager";
import { createSpatialStoryEvents, type SpatialStoryOperation, type SpatialStoryReceipt } from "../spatial-story-events";

function fixture(offset = 0) {
  const world = createArgosWorld("Story boundary");
  // Native component arrays are process-scoped; production worlds use workers.
  // Reserve disjoint rows when exercising two source capabilities in one test.
  for (let i = 0; i < offset; i++) addEntity(world);
  initializePrefabs(world); startCommittedEvents(world);
  const park = createRoomEntity(world, { name: "Park" }), home = createRoomEntity(world, { name: "Home" });
  const object = new ObjectManager(world);
  const treeIds = ["Old tree", "Oak tree", "Small tree"].map((name, i) => {
    const id = object.spawn("object", { name, description: "A standing ornamental tree.", containedIn: park, state: "normal" })!;
    PhysicalObject.portable[id] = false; addComponent(world, id, Position); Position.x[id] = i * 3; Position.y[id] = 0;
    return id;
  });
  const actor = (name: string, roomId = park) => {
    const id = createAgentEntity(world, { name, roomId, role: "resident", systemPrompt: "I choose my own actions." });
    addComponent(world, id, Position); Position.x[id] = 1; Position.y[id] = 0; return id;
  };
  const ada = actor("Ada"), blind = actor("Blind resident"), deaf = actor("Deaf resident"), indoors = actor("Indoor resident", home);
  addComponent(world, blind, Traits); Traits.active[blind] = JSON.stringify(["blind"]);
  addComponent(world, deaf, Traits); Traits.active[deaf] = JSON.stringify(["deaf"]);
  const parkKey = workingMemoryEntityRef(world, park)!.key;
  const trees = treeIds.map(id => ({ id, key: workingMemoryEntityRef(world, id)!.key, roomId: park, roomKey: parkKey }));
  const receipts: SpatialStoryReceipt[] = []; let running = true;
  const events = createSpatialStoryEvents({ world, trees, running: () => running, record: r => receipts.push(r) });
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  const prepare = (actorId = ada) => {
    const result = events.prepare(actorId, treeIds[0], "clear_branches");
    if (!result.ok) throw Error(result.reason); return result;
  };
  return { world, park, home, treeIds, trees, ada, blind, deaf, indoors, receipts, events, advance, prepare, pause: () => { running = false; } };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Story event tests have no network")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("initial event catalogue changes no state, memories, actions or geometry", () => {
  const f = fixture(); expect(f.events.view()).toMatchObject({ events: 0, remainingEvents: 2 });
  expect(f.treeIds.map(id => ObjectState.current[id])).toEqual(["normal", "normal", "normal"]);
  expect(f.events.verbs(f.treeIds[0])).toEqual([]); expect(f.events.localContext(f.ada)).toBeUndefined();
  expect(peekPendingStimuli(undefined, f.world)).toEqual([]); expect(f.receipts).toEqual([]); f.events.close();
});
test("native branch damage offers work with local sense-filtered evidence, no imposed emotion or action", () => {
  const f = fixture(), arousal = Mind.arousal[f.ada], x = Position.x[f.treeIds[0]], y = Position.y[f.treeIds[0]];
  expect(f.events.damage("Old tree", f.park)).toMatchObject({ status: "applied", revision: 1 });
  expect(ObjectState.current[f.treeIds[0]]).toBe("branch_damage"); expect(Description.value[f.treeIds[0]]).toContain("path beside it remains open");
  expect(f.events.verbs(f.treeIds[0])).toEqual(["clear_branches"]);
  expect(peekPendingStimuli(f.ada, f.world).map(r => r.modality)).toEqual(["visual", "auditory"]);
  expect(peekPendingStimuli(f.blind, f.world).map(r => r.modality)).toEqual(["auditory"]);
  expect(peekPendingStimuli(f.blind, f.world)[0].content).not.toContain("Old tree");
  expect(peekPendingStimuli(f.deaf, f.world).map(r => r.modality)).toEqual(["visual"]);
  expect(peekPendingStimuli(f.indoors, f.world)).toEqual([]); expect(Mind.arousal[f.ada]).toBe(arousal);
  expect(Position.x[f.treeIds[0]]).toBe(x); expect(Position.y[f.treeIds[0]]).toBe(y); expect(f.receipts).toHaveLength(1); f.events.close();
});
test("two events, ninety simulation seconds apart; damage and completed repair cannot be replayed", () => {
  const f = fixture(); expect(f.events.damage("Old tree", f.park).status).toBe("applied");
  expect(f.events.damage("Old tree", f.park).status).toBe("unchanged");
  f.advance(89_999); expect(f.events.damage("Oak tree", f.park).status).toBe("rejected");
  f.advance(1); expect(f.events.damage("Oak tree", f.park).status).toBe("applied");
  f.advance(90_000); expect(f.events.damage("Small tree", f.park).status).toBe("rejected");
  expect(f.events.view()).toMatchObject({ events: 2, remainingEvents: 0 }); f.events.close();
});
test("operator damage retains its origin while a native Narrator lease remains narrator-owned", () => {
  const f = fixture();
  expect(f.events.damage("Old tree", f.park, undefined, "operator")).toMatchObject({ status: "applied", origin: "operator" });
  expect(f.receipts[0]).toMatchObject({ operation: "tree_damage", origin: "operator" });
  expect(f.events.damage("Oak tree", f.park, undefined, "operator")).toMatchObject({ status: "rejected", origin: "operator" });
  f.advance(90_000);
  expect(f.events.capture().execute({ operation: "tree_damage", tree: "Oak tree" }, f.park)).toMatchObject({ status: "applied", origin: "narrator" });
  expect(f.receipts[1]).toMatchObject({ operation: "tree_damage", origin: "narrator" }); f.events.close();
});
test("a frozen lease cannot enact stale decisions; commands must match the exact target room and tree", () => {
  const f = fixture(), lease = f.events.capture();
  expect(lease.execute({ operation: "tree_damage", tree: "Old tree" }, f.home).status).toBe("rejected");
  expect(lease.execute({ operation: "tree_damage", tree: "Invented tree" }, f.park).status).toBe("rejected");
  expect(lease.execute({ operation: "tree_damage", tree: "Old tree", arbitrary: true } as any, f.park).status).toBe("rejected");
  expect(lease.execute({ operation: "tree_damage", tree: "Old tree" }, f.park).status).toBe("applied");
  expect(lease.current()).toBe(false); f.advance(90_000);
  expect(lease.execute({ operation: "tree_damage", tree: "Oak tree" }, f.park).status).toBe("rejected"); f.events.close();
});
test("an abandoned spirit task cannot reuse its event lease outside the cancelled task", async () => {
  const f = fixture(), abort = new AbortController();
  const lease = await withSimulationTask(abort.signal, async () => f.events.capture()); abort.abort();
  expect(lease.current()).toBe(false);
  expect(lease.execute({ operation: "tree_damage", tree: "Old tree" }, f.park).status).toBe("rejected");
  expect(f.events.view().events).toBe(0); f.events.close();
});
test("a genuine resident action takes time, clears once, and leaves a pruned tree rather than magically restoring it", () => {
  const f = fixture(); f.events.damage("Old tree", f.park);
  const a = f.prepare(), competing = f.prepare(f.deaf); expect(a.durationMs).toBe(6000);
  f.advance(6000); expect(f.events.commit(a.operation).success).toBe(true);
  expect(ObjectState.current[f.treeIds[0]]).toBe("pruned"); expect(Description.value[f.treeIds[0]]).toContain("visibly shortened");
  expect(f.events.component.eventCount[f.treeIds[0]]).toBe(1); expect(f.events.verbs(f.treeIds[0])).toEqual([]);
  expect(f.events.commit(a.operation).success).toBe(false); expect(f.events.commit(competing.operation).success).toBe(false);
  expect(f.events.damage("Old tree", f.park).status).toBe("unchanged");
  expect(f.receipts.map(r => r.operation)).toEqual(["tree_damage", "tree_cleared"]);
  expect(f.receipts[1].actorKey).toBe(WorkingMemoryIdentity.id[f.ada]); f.events.close();
});
test.each(["early", "distance", "room", "actor", "forged", "task-aborted"])("%s cannot complete native branch work", async reason => {
  const f = fixture(); f.events.damage("Old tree", f.park); const abort = new AbortController();
  const admission = await withSimulationTask(abort.signal, async () => f.prepare()); let operation = admission.operation;
  if (reason !== "early") f.advance(6000);
  if (reason === "distance") Position.x[f.ada] = 10;
  if (reason === "room") setLocatedIn(f.world, f.ada, f.home);
  if (reason === "actor") WorkingMemoryIdentity.id[f.ada] = "replacement";
  if (reason === "forged") operation = { ...operation } as SpatialStoryOperation;
  if (reason === "task-aborted") abort.abort();
  expect(f.events.commit(operation).success).toBe(false); expect(ObjectState.current[f.treeIds[0]]).toBe("branch_damage");
  expect(f.receipts).toHaveLength(1); f.events.close();
});
test.each(["close", "source-stop", "source-restart", "pause", "owner", "room-owner", "removed", "component", "moved", "description", "state", "rewind"])("%s revokes late effects and queued local evidence", reason => {
  const f = fixture(); f.advance(1000); f.events.damage("Old tree", f.park); const operation = f.prepare().operation;
  if (reason === "close") f.events.close();
  if (reason === "source-stop") stopCommittedEvents(f.world);
  if (reason === "source-restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (reason === "pause") f.pause();
  if (reason === "owner") WorkingMemoryIdentity.id[f.treeIds[0]] = "replacement";
  if (reason === "room-owner") WorkingMemoryIdentity.id[f.park] = "replacement";
  if (reason === "removed") removeEntity(f.world, f.treeIds[0]);
  if (reason === "component") removeComponent(f.world, f.treeIds[0], f.events.component);
  if (reason === "moved") Position.x[f.treeIds[0]] = 50;
  if (reason === "description") Description.value[f.treeIds[0]] = "Someone changed this tree";
  if (reason === "state") ObjectState.current[f.treeIds[0]] = "normal";
  if (reason === "rewind") f.world.time.elapsed = 0;
  expect(f.events.damage("Oak tree", f.park).status).toBe("rejected"); expect(f.events.commit(operation).success).toBe(false);
  expect(f.events.localContext(f.ada)).toBeUndefined(); expect(peekPendingStimuli(undefined, f.world)).toEqual([]); f.events.close();
});
test("later arrival sees present damage without acquiring an invented historical observation", () => {
  const f = fixture(); f.events.damage("Old tree", f.park); drainPendingStimuli();
  expect(f.events.localContext(f.blind)).toBeUndefined(); expect(f.events.localContext(f.indoors)).toBeUndefined();
  setLocatedIn(f.world, f.indoors, f.park); expect(f.events.localContext(f.indoors)).toContain("Old tree");
  expect(peekPendingStimuli(undefined, f.world)).toEqual([]); f.events.close();
});
test("independent worlds never share effects or resident action authority", () => {
  const a = fixture(), b = fixture(64); a.events.damage("Old tree", a.park); const operation = a.prepare().operation;
  a.advance(6000); b.advance(6000); expect(b.events.commit(operation).success).toBe(false);
  expect(b.events.component.phase[b.treeIds[0]]).toBe("normal"); expect(b.receipts).toEqual([]);
  expect(a.events.commit(operation).success).toBe(true); a.events.close(); b.events.close();
});
test("receipt sink failure reports an already committed consequence without retry or rollback", () => {
  const f = fixture(); f.events.close();
  const events = createSpatialStoryEvents({ world: f.world, trees: f.trees, running: () => true, record: () => { throw Error("sink"); } });
  expect(events.damage("Old tree", f.park)).toMatchObject({ status: "applied", detail: expect.stringContaining("recording failed") });
  expect(events.damage("Old tree", f.park).status).toBe("unchanged"); expect(events.view().events).toBe(1); events.close();
});
test("save/remapped restore retains native damage, pruning, consumed budget and cooldown", () => {
  const f = fixture(); f.events.damage("Old tree", f.park); const operation = f.prepare().operation;
  f.advance(6000); f.events.commit(operation);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry()))); f.events.close();
  const world = createArgosWorld("Restored story"); initializePrefabs(world); for (let i = 0; i < 12; i++) addEntity(world);
  const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), saved); startCommittedEvents(world);
  const trees = f.trees.map(t => ({ ...t, id: oldToNewId.get(t.id)!, roomId: oldToNewId.get(t.roomId)! }));
  const restored = createSpatialStoryEvents({ world, trees, running: () => true, record: () => {} });
  expect(restored.view()).toMatchObject({ events: 1, remainingEvents: 1, nextEventAtSimMs: 90_000 });
  expect(restored.view().trees[0].phase).toBe("pruned");
  expect(restored.damage("Old tree", trees[0].roomId).status).toBe("unchanged");
  expect(restored.damage("Oak tree", trees[1].roomId).status).toBe("rejected");
  advanceSimulationTime(world, world.time.tick + 1, 84_000); expect(restored.damage("Oak tree", trees[1].roomId).status).toBe("applied"); restored.close();
});
test("corrupt persisted state and duplicate owners cannot reset budgets", () => {
  const f = fixture();
  expect(() => createSpatialStoryEvents({ world: f.world, trees: f.trees, running: () => true, record: () => {} })).toThrow(/owner/);
  f.events.damage("Old tree", f.park); f.events.close(); f.events.component.eventCount[f.treeIds[0]] = 0;
  expect(() => createSpatialStoryEvents({ world: f.world, trees: f.trees, running: () => true, record: () => {} })).toThrow(/invalid/);
});
