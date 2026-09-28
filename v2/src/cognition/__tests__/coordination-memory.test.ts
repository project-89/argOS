import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, CoordinationMemory, Goal, Name, ObjectState, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { setGoalContract } from "../goal-contract";
import { recordCommittedSpeech } from "../social-memory";
import { recordWorkingMemoryEvidence, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { applyCoordinationReviews, captureCoordinationAction, captureCoordinationGoal, captureCoordinationWork, COORDINATION_LIMITS,
  formatCoordinationContext, getCoordinationGoalRef, getCoordinationMemory, getCoordinationRevision, hasCoordinationCommunicationGap,
  recordCoordinationAction, reconcileCoordinationGoals } from "../coordination-memory";

function fixture() {
  const world = createArgosWorld("Coordination ledger unit"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Warehouse" });
  const make = (name: string, roomId = room) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Act on evidence.", roomId });
  const actor = make("Mara"), listener = make("Ivo"), far = make("Sera", remote);
  const supplies = createObjectEntity(world, { name: "Supplies", portable: true, roomId: room });
  const lamp = createObjectEntity(world, { name: "Signal", roomId: remote });
  addComponent(world, lamp, ObjectState); ObjectState.current[lamp] = "off";
  function goal(description = "Fetch supplies") {
    const g = addEntity(world); addComponent(world, g, Goal); addComponent(world, actor, HasGoal(g));
    Goal.description[g] = description; Goal.createdAt[g] = Date.now(); Goal.status[g] = "active"; Goal.progress[g] = 0;
    setGoalContract(world, g, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: "Supplies" } });
    return g;
  }
  const advance = (ms = 1) => jest.setSystemTime(Date.now() + ms);
  const say = (content = "I will fetch the supplies.", who = actor) => recordCommittedSpeech(world, who, content, "Ivo")!;
  function undertake(g?: number, task = "Fetch supplies", goalRelation: "supports" | "fulfills" = "supports") {
    const source = say();
    expect(applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: source.id, task, ...(g === undefined ? {} : { goalId: g, goalRelation }) }])).toBe(1);
    return source.id;
  }
  function evidence(id: string, summary = "The storage surface is empty.", who = actor) {
    advance();
    expect(recordWorkingMemoryEvidence(world, who, { id, atMs: Date.now(), kind: "observation", provenance: "visible_observation", summary, facts: [] })).toBe(true);
    return id;
  }
  const memory = (who = actor) => getCoordinationMemory(world, who);
  const work = (id = memory().items[0].id) => captureCoordinationWork(world, actor, id)!;
  return { world, actor, listener, far, room, remote, supplies, lamp, goal, advance, say, undertake, evidence, memory, work };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test("reads are pure for a new actor; evidence reviews cannot admit a fabricated or heard undertaking", () => {
  const f = fixture();
  expect(f.memory()).toEqual({ items: [], revision: 0 });
  expect(formatCoordinationContext(f.world, f.actor)).toContain("None recorded");
  expect(hasComponent(f.world, f.actor, CoordinationMemory)).toBe(false);
  const heard = f.say("I will fetch the supplies.", f.listener);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: heard.id, task: "Fetch supplies" }])).toBe(0);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: "fabricated", task: "Fetch supplies" }])).toBe(0);
  expect(f.memory().items).toEqual([]);
});

test("one exact speech source yields one item; replay cannot rewrite its task", () => {
  const f = fixture(), id = f.undertake(); const before = f.memory();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: id, task: "Secret replacement" }])).toBe(0);
  expect(f.memory()).toEqual(before);
  expect(f.memory(f.listener).items[0]).toMatchObject({ id, own: false, lastReported: { status: "not_started" } });
  expect(f.memory(f.far).items).toEqual([]);
});

test("new-goal association requires the actual returned goal; another actor's goal is inadmissible", () => {
  const f = fixture(), source = f.say(), g = f.goal();
  const review = { kind: "undertake", speechId: source.id, task: "Fetch supplies", goalId: "new" };
  expect(applyCoordinationReviews(f.world, f.actor, [review])).toBe(0);
  expect(applyCoordinationReviews(f.world, f.actor, [review], { newGoalId: g })).toBe(1);
  const other = f.goal(); removeComponent(f.world, f.actor, HasGoal(other)); addComponent(f.world, f.listener, HasGoal(other));
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: source.id, goalId: other }])).toBe(0);
  expect(f.memory().items[0].goal).toEqual(getCoordinationGoalRef(f.world, f.actor, g));
});

test("goal identity is pure, durable and independent of Name or same-millisecond contract equality", () => {
  const f = fixture(), a = f.goal(), b = f.goal();
  expect(getCoordinationGoalRef(f.world, f.actor, a)).toBeUndefined();
  expect(hasComponent(f.world, a, WorkingMemoryIdentity)).toBe(false);
  const one = captureCoordinationGoal(f.world, f.actor, a)!, two = captureCoordinationGoal(f.world, f.actor, b)!;
  expect(hasComponent(f.world, a, Name)).toBe(false);
  expect(one.signature).toBe(two.signature); expect(one.createdAt).toBe(two.createdAt); expect(one.goalKey).not.toBe(two.goalKey);
  expect(getCoordinationGoalRef(f.world, f.actor, a)).toEqual(one);
});

test("private blocker interpretations require exact owned recent evidence and are idempotent", () => {
  const f = fixture(), id = f.undertake();
  const foreign = f.evidence("foreign-source", "A private far-away issue.", f.far);
  const r = { kind: "blocked", id, reason: "A prerequisite is missing.", evidenceIds: [foreign] };
  expect(applyCoordinationReviews(f.world, f.actor, [r])).toBe(0);
  const source = f.evidence("observation:complete-exact-identity"); r.evidenceIds = [source.slice(0, 20)];
  expect(applyCoordinationReviews(f.world, f.actor, [r])).toBe(0);
  r.evidenceIds = [source]; expect(applyCoordinationReviews(f.world, f.actor, [r])).toBe(1);
  const before = f.memory(); expect(applyCoordinationReviews(f.world, f.actor, [r])).toBe(0); expect(f.memory()).toEqual(before);
  expect(before.items[0].localStatus).toBe("blocked");
  expect(hasCoordinationCommunicationGap(before.items[0])).toBe(true);
  expect(JSON.stringify(f.memory(f.listener))).not.toContain("prerequisite");
  expect(formatCoordinationContext(f.world, f.actor)).toContain(source);
});

test("a public blocker report clears the communication gap without leaking private evidence", () => {
  const f = fixture(), id = f.undertake(), source = f.evidence("private-evidence", "A private technical observation.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "blocked", id, reason: "A prerequisite is missing.", evidenceIds: [source] }]);
  f.advance(); const report = f.say("I cannot finish this yet; can you help?");
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "blocked" }])).toBe(1);
  expect(hasCoordinationCommunicationGap(f.memory().items[0])).toBe(false);
  const heard = f.memory(f.listener).items[0]; expect(heard.lastReported.status).toBe("blocked");
  expect(heard).not.toHaveProperty("localEvidence"); expect(heard).not.toHaveProperty("localReason"); expect(heard).not.toHaveProperty("goal");
  expect(JSON.stringify(heard)).not.toContain("private technical");
});

test("listeners who miss a report keep their old account; late listeners never receive the private original promise", () => {
  const f = fixture(), id = f.undertake();
  setLocatedIn(f.world, f.listener, f.remote); setLocatedIn(f.world, f.far, f.room);
  f.advance(); const report = f.say("The work is complete.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "completed" }]);
  expect(f.memory(f.listener).items[0].lastReported.status).toBe("not_started");
  expect(f.memory(f.far).items).toEqual([]);
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("a listener's task label cannot disclose the speaker's private interpretation", () => {
  const f = fixture();
  const source = f.say("I will handle the errand.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Retrieve the hidden archive using the private code REDWREN." }]);
  expect(f.memory().items[0].task).toContain("REDWREN");
  expect(f.memory(f.listener).items[0].task).toBe(source.content);
  expect(JSON.stringify(f.memory(f.listener))).not.toContain("REDWREN");
});

test("same-time report replay cannot move the communicated account backward", () => {
  const f = fixture(), id = f.undertake();
  const first = f.say("I am working on it.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: first.id, status: "in_progress" }]);
  const second = f.say("It is blocked now.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: second.id, status: "blocked" }]);
  const before = f.memory();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: first.id, status: "completed" }])).toBe(0);
  expect(f.memory()).toEqual(before); expect(f.memory(f.listener).items[0].lastReported.status).toBe("blocked");
});

test("renaming a character does not erase the undertaking or stop later public reports", () => {
  const f = fixture(), id = f.undertake(); Name.value[f.actor] = "Renamed Mara";
  f.advance(); const report = f.say("The work is blocked.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "blocked" }]);
  expect(f.memory().items[0].lastReported.speech.speaker).toBe("Renamed Mara");
  expect(f.memory(f.listener).items[0].lastReported.status).toBe("blocked");
});

test("issuance membership rejects a same-time undertaking made after work was captured", () => {
  const f = fixture(), g = f.goal(); f.undertake(g);
  const issuance = captureCoordinationAction(f.world, f.actor, f.work(), { type: "pickup", target: "Supplies" })!;
  const laterId = f.undertake(g, "A later undertaking");
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true })).toBe(1);
  expect(f.memory().items.find(i => i.id === laterId)!.localStatus).toBe("not_started");
  expect(issuance.workRef.itemId).not.toBe(laterId); expect(Object.isFrozen(issuance.workRef)).toBe(true);
});

test("a pending or quiet action cannot produce work progress; an actual step is not completion", () => {
  const f = fixture(), g = f.goal(); f.undertake(g);
  expect(captureCoordinationAction(f.world, f.actor, f.work(), { type: "speak" })).toBeUndefined();
  const issuance = captureCoordinationAction(f.world, f.actor, f.work(), { type: "pickup", target: "Supplies" })!;
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true, pending: true })).toBe(0);
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true })).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
  expect(hasCoordinationCommunicationGap(f.memory().items[0])).toBe(false);
  expect(Goal.status[g]).toBe("active");
});

test("an explicit durable undertaking reference can bind a foreground action without a stored plan", () => {
  const f = fixture(), g = f.goal(), id = f.undertake(g);
  const ref = f.work();
  const issuance = captureCoordinationAction(f.world, f.actor, ref, { type: "pickup", target: "Supplies" })!;
  expect(issuance.workRef).toEqual(ref); expect(issuance.workRef.itemId).toBe(id);
  expect(recordCoordinationAction(f.world, f.actor, issuance, { succeeded: true })).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
  expect(Goal.status[g]).toBe("active");
});

test("explicit work references reject foreign ownership and relinking without depending on a broad goal's life", () => {
  const f = fixture(), g = f.goal(), id = f.undertake(g);
  const ref = f.work();
  expect(captureCoordinationAction(f.world, f.listener, ref, { type: "pickup" })).toBeUndefined();
  setGoalContract(f.world, g, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Workshop" } });
  expect(captureCoordinationAction(f.world, f.actor, ref, { type: "pickup" })).toBeDefined();
  removeEntity(f.world, g); const replacement = f.goal(); captureCoordinationGoal(f.world, f.actor, replacement);
  expect(captureCoordinationAction(f.world, f.actor, ref, { type: "pickup" })).toBeDefined();
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: replacement }]);
  expect(captureCoordinationAction(f.world, f.actor, ref, { type: "pickup" })).toBeUndefined();
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("old callback replay after a newer failed action cannot reactivate blocked work", () => {
  const f = fixture(), g = f.goal(); f.undertake(g);
  const first = captureCoordinationAction(f.world, f.actor, f.work(), { type: "pickup" })!;
  const second = captureCoordinationAction(f.world, f.actor, f.work(), { type: "give" })!;
  recordCoordinationAction(f.world, f.actor, first, { succeeded: true });
  recordCoordinationAction(f.world, f.actor, second, { succeeded: false, summary: "The recipient has left." });
  const before = f.memory(); f.advance(100);
  expect(recordCoordinationAction(f.world, f.actor, first, { succeeded: true })).toBe(0);
  expect(f.memory()).toEqual(before); expect(before.items[0].localStatus).toBe("blocked");
});

test("a failed step can recover through newly linked work without inventing execution", () => {
  const f = fixture(), g = f.goal(), id = f.undertake(g);
  const first = captureCoordinationAction(f.world, f.actor, f.work(), { type: "pickup" })!;
  recordCoordinationAction(f.world, f.actor, first, { succeeded: false });
  const replacement = f.goal("Try another approach");
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: replacement }])).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  const next = captureCoordinationAction(f.world, f.actor, f.work(), { type: "move" })!;
  recordCoordinationAction(f.world, f.actor, next, { succeeded: true });
  expect(f.memory().items[0].localStatus).toBe("in_progress");
});

test("goal completion needs an engine verdict and physical proof, not status, progress, plan or speech alone", () => {
  const f = fixture(), g = f.goal(); f.undertake(g, "Fetch supplies", "fulfills");
  Goal.progress[g] = 100; reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  Goal.status[g] = "completed"; reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  setLocatedIn(f.world, f.supplies, f.actor);
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
  expect(hasCoordinationCommunicationGap(f.memory().items[0])).toBe(true);
  const before = f.memory(); expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(0); expect(f.memory()).toEqual(before);
});

test("remote completion does not become private knowledge until personally observed", () => {
  const f = fixture(), g = f.goal();
  setGoalContract(f.world, g, { version: 1, kind: "custom", params: {}, success: { type: "entity_component_equals", entityName: "Signal", component: "ObjectState", field: "current", equals: "on" } });
  f.undertake(g, "Restore the signal", "fulfills"); Goal.status[g] = "completed"; ObjectState.current[f.lamp] = "on";
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  setLocatedIn(f.world, f.actor, f.remote); f.advance(); captureWorkingMemoryObservation(f.world, f.actor);
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
  expect(f.memory(f.listener).items[0].lastReported.status).toBe("not_started");
});

test("custom and social goal completion never prove physical undertaking success", () => {
  const f = fixture(), g = f.goal();
  setGoalContract(f.world, g, { version: 1, kind: "custom", params: {}, success: { type: "custom", description: "Just feel accomplished" } });
  f.undertake(g, "Fetch supplies", "fulfills"); Goal.status[g] = "completed";
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("missing original goals end tracking without withdrawing work or rebinding same-time replacements", () => {
  const f = fixture(), g = f.goal(); f.undertake(g);
  removeEntity(f.world, g); const replacement = f.goal(); setLocatedIn(f.world, f.supplies, f.actor); Goal.status[replacement] = "completed";
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory().items[0].goalTracking).toMatchObject({ status: "ended" });
  expect(hasCoordinationCommunicationGap(f.memory().items[0])).toBe(false);
  expect(formatCoordinationContext(f.world, f.actor)).toContain("does not establish success or your withdrawal");
});

test("returned snapshots are detached and stale actor-owned component storage fails closed", () => {
  const f = fixture(); f.undertake(); const before = f.memory(), returned = f.memory();
  returned.items[0].task = "Changed by consumer"; returned.items[0].undertaking.content = "Changed by consumer";
  expect(f.memory()).toEqual(before);
  const stranger = addEntity(f.world); addComponent(f.world, stranger, Agent); addComponent(f.world, stranger, Name); Name.value[stranger] = "Stranger";
  workingMemoryEntityRef(f.world, stranger); addComponent(f.world, stranger, CoordinationMemory);
  CoordinationMemory.ownerKey[stranger] = CoordinationMemory.ownerKey[f.actor]; CoordinationMemory.itemsJson[stranger] = CoordinationMemory.itemsJson[f.actor];
  expect(getCoordinationMemory(f.world, stranger)).toEqual({ items: [], revision: 0 });
});

test("revision probes are pure and constant-time with owner and malformed-number guards", () => {
  const f = fixture(); expect(getCoordinationRevision(f.world, f.actor)).toBe(0);
  expect(hasComponent(f.world, f.actor, CoordinationMemory)).toBe(false);
  f.undertake(); const expected = f.memory().revision;
  const parse = jest.spyOn(JSON, "parse");
  expect(getCoordinationRevision(f.world, f.actor)).toBe(expected); expect(parse).not.toHaveBeenCalled(); parse.mockRestore();
  for (const bad of [-1, NaN, 1.5, Infinity]) {
    CoordinationMemory.revision[f.actor] = bad; expect(getCoordinationRevision(f.world, f.actor)).toBe(0);
  }
  CoordinationMemory.revision[f.actor] = expected;
  CoordinationMemory.ownerKey[f.actor] = "another-actor";
  expect(getCoordinationRevision(f.world, f.actor)).toBe(0);
});

test("bounded retention rejects replay of evicted older promises; malformed reviews are inert", () => {
  const f = fixture(); let old = "";
  for (let index = 0; index < COORDINATION_LIMITS.items + 3; index++) {
    f.advance(); const id = f.undertake(undefined, `Task ${index}`); if (!index) old = id;
  }
  expect(f.memory().items).toHaveLength(COORDINATION_LIMITS.items);
  const before = f.memory();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: old, task: "Replayed" }])).toBe(0);
  expect(applyCoordinationReviews(f.world, f.actor, Array(4).fill({ kind: "release", id: before.items[0].id, reason: "Flood" }))).toBe(0);
  expect(f.memory()).toEqual(before);
});
