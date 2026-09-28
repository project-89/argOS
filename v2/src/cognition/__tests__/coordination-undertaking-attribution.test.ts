import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { CoordinationMemory, Goal } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { setGoalContract } from "../goal-contract";
import { recordCommittedSpeech } from "../social-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { workingMemoryEntityRef } from "../working-memory";
import { applyCoordinationReviews, captureCoordinationAction, captureCoordinationGoal, captureCoordinationWork,
  formatCoordinationContext, getCoordinationMemory, hasCoordinationCommunicationGap, reconcileCoordinationGoals,
  recordCoordinationAction, type CoordinationActionCompletion } from "../coordination-memory";
import { coordinationDependency } from "../coordination-memory-dependencies";

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_700_000_000_000); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Undertaking tests stay offline.")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

function fixture() {
  const world = createArgosWorld("Undertaking attribution"); world.meta.aiEnabled = false; initializePrefabs(world);
  const workshop = createRoomEntity(world, { name: "Workshop" }), hall = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Use evidence.", roomId: workshop });
  const listener = createAgentEntity(world, { name: "Lin", role: "operator", systemPrompt: "Use evidence.", roomId: workshop });
  const valve = createObjectEntity(world, { name: "Valve", roomId: workshop });
  const latch = createObjectEntity(world, { name: "Latch", roomId: workshop });
  captureWorkingMemoryObservation(world, actor);
  const valveKey = workingMemoryEntityRef(world, valve)!.key, latchKey = workingMemoryEntityRef(world, latch)!.key;
  const goal = () => {
    const id = addEntity(world); addComponent(world, id, Goal); addComponent(world, actor, HasGoal(id));
    Goal.description[id] = "Reach the hall safely"; Goal.createdAt[id] = Date.now(); Goal.status[id] = "active";
    setGoalContract(world, id, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Hall" } });
    return id;
  };
  const parent = goal();
  const advance = () => jest.setSystemTime(Date.now() + 1);
  function undertake(task = "Open the valve", completion?: CoordinationActionCompletion) {
    advance(); const speech = recordCommittedSpeech(world, actor, `I will ${task}.`, "Lin")!;
    expect(applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: speech.id, task, goalId: parent,
      ...(completion ? { completion } : {}) }])).toBe(1);
    return speech.id;
  }
  const memory = (who = actor) => getCoordinationMemory(world, who);
  const work = (id: string) => captureCoordinationWork(world, actor, id)!;
  const issue = (id: string, type = "interact", target = "Valve", content?: string) => captureCoordinationAction(world, actor, work(id), { type, target, ...(content === undefined ? {} : { content }) })!;
  const completion: CoordinationActionCompletion = { type: "action", actionType: "interact", target: "Valve", content: "open" };
  return { world, actor, listener, workshop, hall, valve, latch, valveKey, latchKey, goal, parent, advance, undertake, memory, work, issue, completion };
}

test("a shared supporting goal cannot fan an action result out to sibling undertakings", () => {
  const f = fixture(), valve = f.undertake(), latch = f.undertake("Open the latch");
  const secondBefore = f.memory().items.find(i => i.id === latch);
  const issuance = f.issue(valve, "interact", "Valve", "open");
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true, targetKey: f.valveKey })).toBe(1);
  expect(f.memory().items.find(i => i.id === valve)!.localStatus).toBe("in_progress");
  expect(f.memory().items.find(i => i.id === latch)).toEqual(secondBefore);
  expect(captureCoordinationAction(f.world, f.actor, captureCoordinationGoal(f.world, f.actor, f.parent) as any, { type: "move", target: "Hall" })).toBeUndefined();
  expect(captureCoordinationAction(f.world, f.actor, f.parent as any, { type: "move", target: "Hall" })).toBeUndefined();
});

test("the exact promised action completes work, then an unrelated failure cannot contaminate it", () => {
  const f = fixture(), valve = f.undertake("Open the valve", f.completion), latch = f.undertake("Open the latch");
  const issuance = f.issue(valve, "interact", "Valve", "open");
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true, targetKey: f.valveKey })).toBe(1);
  const completed = f.memory().items.find(i => i.id === valve)!;
  expect(completed.localStatus).toBe("verified_done"); expect(hasCoordinationCommunicationGap(completed)).toBe(true);
  expect(Goal.status[f.parent]).toBe("active");
  recordCoordinationAction(f.world, f.actor, f.issue(latch, "interact", "Latch", "open"), { succeeded: false, summary: "Someone is using it." });
  expect(f.memory().items.find(i => i.id === valve)).toEqual(completed);
  expect(f.memory().items.find(i => i.id === latch)!.localStatus).toBe("blocked");
  expect(f.memory(f.listener).items.find(i => i.id === valve)!.lastReported.status).toBe("not_started");
  expect(captureCoordinationWork(f.world, f.actor, valve)).toBeUndefined();
});

test.each([undefined, "supports"])("%s relation never treats a broad completed goal as promise completion", relation => {
  const f = fixture(), id = f.undertake();
  if (relation === undefined) {
    const raw = f.memory().items; delete raw[0].goalRelation; delete raw[0].generation;
    CoordinationMemory.itemsJson[f.actor] = JSON.stringify(raw);
  }
  Goal.status[f.parent] = "completed"; setLocatedIn(f.world, f.actor, f.hall);
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory().items[0].pendingGoalProof).toBeUndefined();
  expect(formatCoordinationContext(f.world, f.actor)).toContain("finishing that broader goal does not establish");
  const issuance = f.issue(id, "interact", "Valve", "open");
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true })).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
});

test("explicit fulfills retains the native actor-known positive completion path", () => {
  const f = fixture(), id = f.undertake("Reach the hall");
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalRelation: "fulfills" }])).toBe(1);
  Goal.status[f.parent] = "completed"; setLocatedIn(f.world, f.actor, f.hall);
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("a known remote target may be declared before it becomes currently actionable", () => {
  const f = fixture(); setLocatedIn(f.world, f.actor, f.hall);
  const id = f.undertake("Open the valve", f.completion);
  expect(f.memory().items[0].completion).toEqual({ ...f.completion, targetKey: f.valveKey });
  expect(f.work(id)).toBeDefined();
});

test.each(["unknown", "ambiguous"])("%s target identity cannot ground a completion declaration", mode => {
  const f = fixture(), target = mode === "unknown" ? "Unseen machine" : "Valve";
  if (mode === "ambiguous") { createObjectEntity(f.world, { name: "Valve", roomId: f.workshop }); f.advance(); captureWorkingMemoryObservation(f.world, f.actor); }
  const source = recordCommittedSpeech(f.world, f.actor, "I will open it.", "Lin")!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Open it", completion: { ...f.completion, target } }])).toBe(0);
  expect(f.memory().items).toEqual([]);
});

test.each(["missing actual identity", "same-name replacement", "other action", "other arguments", "pending", "failure"])("%s cannot verify a declared terminal action", mode => {
  const f = fixture(), id = f.undertake("Open the valve", f.completion);
  const issuance = f.issue(id, mode === "other action" ? "examine" : "interact", "Valve", mode === "other arguments" ? "close" : "open");
  const outcome = { succeeded: mode !== "failure", pending: mode === "pending", ...(mode === "missing actual identity" ? {} : { targetKey: mode === "same-name replacement" ? "entity:replacement" : f.valveKey }) };
  expect(recordCoordinationAction(f.world, f.actor, issuance, outcome)).toBe(mode === "pending" ? 0 : 1);
  expect(f.memory().items[0].localStatus).not.toBe("verified_done");
});

test("tool arguments remain exact, including case, spacing and quoted paths", () => {
  const f = fixture(), content = '{"path":"/Case Sensitive/File.TXT","mode":"Append"}';
  const id = f.undertake("Configure the valve", { ...f.completion, content });
  for (const wrong of [content.toLowerCase(), content.replace(",", ", "), ` ${content}`, `${content}\n`]) {
    recordCoordinationAction(f.world, f.actor, f.issue(id, "interact", "Valve", wrong), { succeeded: true, targetKey: f.valveKey });
    expect(f.memory().items[0].localStatus).toBe("in_progress");
  }
  recordCoordinationAction(f.world, f.actor, f.issue(id, "interact", "Valve", content), { succeeded: true, targetKey: f.valveKey });
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("progress keeps its work generation; relink away and back cannot resurrect old issuance", () => {
  const f = fixture(), id = f.undertake(), ref = f.work(id), old = f.issue(id);
  recordCoordinationAction(f.world, f.actor, old, { succeeded: true });
  expect(f.work(id)).toEqual(ref);
  const deferred = f.issue(id), second = f.goal();
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: second }]);
  const middle = f.work(id); expect(middle.generation).not.toBe(ref.generation);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: f.parent }]);
  expect(f.work(id).generation).not.toBe(ref.generation); expect(f.work(id).generation).not.toBe(middle.generation);
  expect(captureCoordinationAction(f.world, f.actor, ref, { type: "interact" })).toBeUndefined();
  expect(recordCoordinationAction(f.world, f.actor, deferred, { succeeded: false })).toBe(0);
});

test("changed completion criteria invalidate old work and cannot retroactively claim an earlier success", () => {
  const f = fixture(), id = f.undertake(), old = f.issue(id, "interact", "Valve", "open");
  recordCoordinationAction(f.world, f.actor, old, { succeeded: true, targetKey: f.valveKey });
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, completion: f.completion }]);
  expect(recordCoordinationAction(f.world, f.actor, old, { succeeded: true, targetKey: f.valveKey })).toBe(0);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
  const before = f.memory();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, completion: f.completion }])).toBe(0);
  expect(f.memory()).toEqual(before);
  recordCoordinationAction(f.world, f.actor, f.issue(id, "interact", "Valve", "open"), { succeeded: true, targetKey: f.valveKey });
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("work identity is actor-owned and survives goal cleanup without being implicitly withdrawn", () => {
  const f = fixture(), id = f.undertake("Open the valve", f.completion), ref = f.work(id), issuance = f.issue(id, "interact", "Valve", "open");
  expect(captureCoordinationWork(f.world, f.listener, id)).toBeUndefined();
  expect(captureCoordinationAction(f.world, f.listener, ref, { type: "interact" })).toBeUndefined();
  expect(recordCoordinationAction(f.world, f.listener, issuance, { succeeded: true, targetKey: f.valveKey })).toBe(0);
  removeEntity(f.world, f.parent); reconcileCoordinationGoals(f.world, f.actor);
  expect(f.work(id)).toEqual(ref);
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true, targetKey: f.valveKey })).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("listeners receive no private completion declaration, generation or target identity", () => {
  const f = fixture(), id = f.undertake("Open the valve", { ...f.completion, content: "secret-setting" });
  const listener = f.memory(f.listener).items[0];
  expect(listener.id).toBe(id);
  for (const field of ["completion", "generation", "goalRelation", "goal", "localStatus"]) expect(listener).not.toHaveProperty(field);
  expect(JSON.stringify(listener)).not.toContain("secret-setting"); expect(JSON.stringify(listener)).not.toContain(f.valveKey);
});

test("explicit dependencies isolate supporting siblings and invalidate changed generations, not progress", () => {
  const f = fixture(), one = f.undertake(), two = f.undertake("Open the latch");
  const goalScope = { goalRefs: [captureCoordinationGoal(f.world, f.actor, f.parent)] };
  expect(coordinationDependency(f.memory(), goalScope)).toBe("[]");
  const scope = { workRefs: [f.work(one)] }, before = coordinationDependency(f.memory(), scope);
  recordCoordinationAction(f.world, f.actor, f.issue(one), { succeeded: true });
  expect(coordinationDependency(f.memory(), scope)).toBe(before);
  recordCoordinationAction(f.world, f.actor, f.issue(two, "interact", "Latch"), { succeeded: false });
  expect(coordinationDependency(f.memory(), scope)).toBe(before);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: one, completion: f.completion }]);
  expect(coordinationDependency(f.memory(), scope)).not.toBe(before);
});

test("work generation and replay ordering persist across save/remap", () => {
  const f = fixture(), id = f.undertake(), original = f.issue(id);
  recordCoordinationAction(f.world, f.actor, original, { succeeded: true });
  const save = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const world = createArgosWorld("Restored undertaking identity"); initializePrefabs(world);
  addEntity(world); // Force identity remapping rather than relying on old eids.
  const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), save);
  const actor = oldToNewId.get(f.actor)!;
  expect(captureCoordinationWork(world, actor, id)).toEqual(original.workRef);
  expect(recordCoordinationAction(world, actor, original, { succeeded: false })).toBe(0);
  const next = captureCoordinationAction(world, actor, original.workRef, { type: "interact", target: "Valve" })!;
  expect(next.sequence).toBeGreaterThan(original.sequence);
  expect(recordCoordinationAction(world, actor, next, { succeeded: false })).toBe(1);
});

test("legacy work gets one durable generation at explicit capture, not on pure reads", () => {
  const f = fixture(), id = f.undertake();
  const raw = f.memory().items; delete raw[0].generation; delete raw[0].goalRelation;
  CoordinationMemory.itemsJson[f.actor] = JSON.stringify(raw);
  const before = f.memory(); expect(f.memory()).toEqual(before); expect(before.items[0].generation).toBeUndefined();
  const ref = f.work(id); expect(ref.generation).toMatch(/^work:/);
  const after = f.memory(); expect(f.work(id)).toEqual(ref); expect(f.memory()).toEqual(after);
  expect(after.revision).toBe(before.revision + 1);
});

test("a stable known key can disambiguate duplicate labels without exposing an unseen entity", () => {
  const f = fixture();
  createObjectEntity(f.world, { name: "Valve", roomId: f.workshop }); f.advance(); captureWorkingMemoryObservation(f.world, f.actor);
  const id = f.undertake("Open the original valve", { ...f.completion, target: f.valveKey });
  const issuance = f.issue(id, "interact", f.valveKey, "open");
  recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true, targetKey: f.valveKey });
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("a two-entity give criterion fails closed until actual item and recipient identities are supported", () => {
  const f = fixture();
  const source = recordCommittedSpeech(f.world, f.actor, "I will give Lin the valve.", "Lin")!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Give Lin the valve",
    completion: { type: "action", actionType: "give", target: "Lin", content: "Valve" } }])).toBe(0);
  const id = f.undertake("Give Lin the valve");
  expect(recordCoordinationAction(f.world, f.actor, f.issue(id, "give", "Lin", "Valve"), { succeeded: true })).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
});
