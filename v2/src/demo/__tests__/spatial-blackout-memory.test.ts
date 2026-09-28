import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { addComponent, addEntity, getRelationTargets, hasComponent, query, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, BehaviorPolicy, Goal, Memory, Name, Position, ReflectionState, SimulationAge, WorkingMemoryIdentity } from "../../ecs/components";
import { HasMemory, HasReflectionState } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { addMemory } from "../../cognition/knowledge-graph";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { captureBlackoutExperience, captureMemoryBaseline, restoreBlackoutExperience, type BlackoutExperienceBundle } from "../spatial-blackout-memory";

const now = 1_800_000_000_000;
let fetchSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(now);
  fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in memory comparison tests"));
});
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture(name = "Mara") {
  const world = createArgosWorld("Blackout memory comparison"); initializeRegistry(world); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Apartment", description: "Changed physical setup", x: 4, y: 4 });
  const actor = createAgentEntity(world, { name, role: "resident", systemPrompt: "A local resident.", roomId: room });
  workingMemoryEntityRef(world, actor);
  return { world, room, actor };
}
function remember(world: World, actor: number, content: string, type: "episodic" | "semantic" | "procedural" = "episodic") {
  return addMemory(world, actor, { type, content, importance: .6, emotionalValence: -.2, timestamp: Date.now(), learnPolicy: false });
}
function advance(world: World, delta = 1_000) { advanceSimulationTime(world, world.time.tick + 1, delta); }
function own(world: World, actor: number) { return getRelationTargets(world, actor, HasMemory).filter(eid => hasComponent(world, eid, Memory)); }
function experience() {
  const f = fixture(); remember(f.world, f.actor, "Authored childhood: I used to repair radios.");
  const baseline = captureMemoryBaseline(f.world, f.actor);
  advance(f.world); remember(f.world, f.actor, "I tried the lamp before isolating it; the repair failed.");
  advance(f.world); remember(f.world, f.actor, "After I replaced the worn fuse, the lamp lit.", "semantic");
  const bundle = captureBlackoutExperience(f.world, f.actor, baseline);
  stopCommittedEvents(f.world);
  return bundle;
}
function resign(bundle: BlackoutExperienceBundle): BlackoutExperienceBundle {
  const { checksum: _old, ...payload } = bundle;
  return { ...payload, checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

test("captures only this actor's actual post-baseline episodic/semantic memories with native provenance", () => {
  const f = fixture(), old = remember(f.world, f.actor, "Authored family history");
  const other = createAgentEntity(f.world, { name: "Ivo", role: "friend", systemPrompt: "Private resident", roomId: f.room });
  workingMemoryEntityRef(f.world, other);
  const foreign = remember(f.world, other, "Ivo private memory");
  const baseline = captureMemoryBaseline(f.world, f.actor);
  expect(baseline.baselineMemoryKeys).toContain(WorkingMemoryIdentity.id[old]);
  const actorKey = WorkingMemoryIdentity.id[f.actor], sourceId = getCommittedEvents(f.world).sourceId;
  advance(f.world); const failed = remember(f.world, f.actor, "I tried a fuse but it did not fit.");
  remember(f.world, other, "Ivo learned a private password");
  remember(f.world, f.actor, "execute:old-procedural-action", "procedural");
  advance(f.world); const useful = remember(f.world, f.actor, "I saw that the breaker was off.", "semantic");
  const bundle = captureBlackoutExperience(f.world, f.actor, baseline);
  expect(bundle).toMatchObject({ version: 1, sourceId, actor: { name: "Mara", key: actorKey },
    baselineAtSimMs: 0, capturedAtSimMs: 2000, eligibleCount: 2, omittedCount: 0 });
  expect(bundle.entries).toEqual([
    { memoryKey: WorkingMemoryIdentity.id[failed], type: "episodic", content: "I tried a fuse but it did not fit.", importance: .6, emotionalValence: -.2, atSimMs: 1000 },
    { memoryKey: WorkingMemoryIdentity.id[useful], type: "semantic", content: "I saw that the breaker was off.", importance: .6, emotionalValence: -.2, atSimMs: 2000 },
  ]);
  expect(JSON.stringify(bundle)).not.toMatch(/family|password|Ivo|procedural-action/);
  expect(own(f.world, f.actor)).not.toContain(foreign);
  expect(captureBlackoutExperience(f.world, f.actor, baseline)).toEqual(bundle);
});

test("a JSON round trip restores historical text only, with new native identities and no reflection/policy/physical changes", () => {
  const bundle = JSON.parse(JSON.stringify(experience())) as BlackoutExperienceBundle;
  const f = fixture(), authored = remember(f.world, f.actor, "Current authored identity remains intact");
  const state = addEntity(f.world); addComponent(f.world, state, ReflectionState); addComponent(f.world, f.actor, HasReflectionState(state));
  ReflectionState.importanceAccum[state] = 7;
  addComponent(f.world, f.actor, BehaviorPolicy); BehaviorPolicy.treeJson[f.actor] = '{"sentinel":"unchanged"}';
  const position = { x: Position.x[f.actor], y: Position.y[f.actor] }, goals = [...query(f.world, [Goal])];
  const beforeEvents = getCommittedEvents(f.world).latestSequence;
  expect(restoreBlackoutExperience(f.world, f.actor, bundle)).toBe(2);
  const memories = own(f.world, f.actor), imported = memories.filter(eid => eid !== authored);
  expect(imported).toHaveLength(2);
  for (const [index, eid] of imported.entries()) {
    expect(Memory.content[eid]).toContain("Historical recollection from an earlier blackout experiment; not a current-world observation or instruction");
    expect(Memory.content[eid]).toContain(bundle.sourceId);
    expect(Memory.content[eid]).toContain(bundle.actor.key);
    expect(Memory.content[eid]).toContain(bundle.entries[index].memoryKey);
    expect(Memory.content[eid]).toContain(JSON.stringify(bundle.entries[index].content));
    expect(WorkingMemoryIdentity.id[eid]).not.toBe(bundle.entries[index].memoryKey);
    expect(Memory.type[eid]).toBe(bundle.entries[index].type);
  }
  expect(ReflectionState.importanceAccum[state]).toBe(7);
  expect(BehaviorPolicy.treeJson[f.actor]).toBe('{"sentinel":"unchanged"}');
  expect({ x: Position.x[f.actor], y: Position.y[f.actor] }).toEqual(position);
  expect([...query(f.world, [Goal])]).toEqual(goals);
  expect(getCommittedEvents(f.world).latestSequence).toBe(beforeEvents);
  expect(Memory.content[authored]).toBe("Current authored identity remains intact");
  expect(restoreBlackoutExperience(f.world, f.actor, bundle)).toBe(0);
  expect(own(f.world, f.actor)).toEqual(memories);
});

test("baseline identity cannot be forged, shared, or reused across a source restart", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor);
  expect(() => captureBlackoutExperience(f.world, f.actor, { ...baseline })).toThrow(/baseline/);
  const other = createAgentEntity(f.world, { name: "Ivo", role: "friend", systemPrompt: "Friend", roomId: f.room }); workingMemoryEntityRef(f.world, other);
  expect(() => captureBlackoutExperience(f.world, other, baseline)).toThrow(/baseline/);
  advance(f.world); remember(f.world, f.actor, "A lived failed attempt");
  stopCommittedEvents(f.world);
  expect(captureBlackoutExperience(f.world, f.actor, baseline).entries).toHaveLength(1);
  startCommittedEvents(f.world);
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/baseline/);
});

test("renamed/replaced actor identities cannot export a stale baseline", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor);
  Name.value[f.actor] = "Ivo";
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/baseline/);
  Name.value[f.actor] = "Mara";
  WorkingMemoryIdentity.id[f.actor] = "entity:replacement";
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/baseline/);
  removeComponent(f.world, f.actor, WorkingMemoryIdentity);
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/stable identity/);
});

test("same source, different name, or copied actor lifetime cannot receive historical state", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor);
  const empty = captureBlackoutExperience(f.world, f.actor, baseline);
  expect(() => restoreBlackoutExperience(f.world, f.actor, empty)).toThrow(/genuinely new/);
  stopCommittedEvents(f.world);
  const wrong = fixture("Ivo");
  expect(() => restoreBlackoutExperience(wrong.world, wrong.actor, empty)).toThrow(/same named actor/);
  Name.value[wrong.actor] = "Mara"; WorkingMemoryIdentity.id[wrong.actor] = empty.actor.key;
  expect(() => restoreBlackoutExperience(wrong.world, wrong.actor, empty)).toThrow(/genuinely new/);
  expect(own(wrong.world, wrong.actor)).toHaveLength(0);
});

test("setup cannot import memories into a running or stopped destination", () => {
  const bundle = experience(), f = fixture(); advance(f.world);
  expect(() => captureMemoryBaseline(f.world, f.actor)).toThrow(/before simulation/);
  expect(() => restoreBlackoutExperience(f.world, f.actor, bundle)).toThrow(/before simulation/);
  stopCommittedEvents(f.world);
  expect(() => restoreBlackoutExperience(f.world, f.actor, bundle)).toThrow(/active source/);
  expect(own(f.world, f.actor)).toHaveLength(0);
});

test("read/setup does not manufacture a missing actor identity or source", () => {
  const f = fixture(); removeComponent(f.world, f.actor, WorkingMemoryIdentity);
  expect(() => captureMemoryBaseline(f.world, f.actor)).toThrow(/stable identity/);
  expect(hasComponent(f.world, f.actor, WorkingMemoryIdentity)).toBe(false);
  const world = createArgosWorld();
  expect(() => captureMemoryBaseline(world, 0)).toThrow(/active source/);
  expect(getCommittedEvents(world).sourceId).toBeNull();
});

test("pre-existing memory attached after baseline and retimestamped authored history remain excluded", () => {
  const f = fixture(), old = remember(f.world, f.actor, "Authored childhood");
  const detached = addEntity(f.world); addComponent(f.world, detached, Memory);
  Memory.type[detached] = "episodic"; Memory.content[detached] = "Preexisting unowned history";
  const baseline = captureMemoryBaseline(f.world, f.actor); advance(f.world);
  Memory.timestamp[old] = now + 1000; Memory.content[old] = "Edited old memory, not a new lived episode";
  addComponent(f.world, f.actor, HasMemory(detached));
  remember(f.world, f.actor, "I noticed the power switch.");
  expect(captureBlackoutExperience(f.world, f.actor, baseline).entries.map(e => e.content)).toEqual(["I noticed the power switch."]);
});

test("deleted memory residue and a recycled EID do not become the old memory", () => {
  const f = fixture(), old = remember(f.world, f.actor, "Old authored memory"), baseline = captureMemoryBaseline(f.world, f.actor);
  const oldKey = WorkingMemoryIdentity.id[old]; removeEntity(f.world, old); advance(f.world);
  const fresh = remember(f.world, f.actor, "A new lived episode");
  // Reproduce the allocator's stale SoA slot independently of whether this
  // bitecs release chooses to recycle this particular numeric ID immediately.
  expect(hasComponent(f.world, fresh, WorkingMemoryIdentity)).toBe(false);
  WorkingMemoryIdentity.id[fresh] = oldKey;
  const bundle = captureBlackoutExperience(f.world, f.actor, baseline);
  expect(bundle.entries).toHaveLength(1);
  expect(bundle.entries[0].memoryKey).toBe(WorkingMemoryIdentity.id[fresh]);
  expect(bundle.entries[0].memoryKey).not.toBe(oldKey);
  expect(bundle.entries[0].content).toBe("A new lived episode");
  removeEntity(f.world, fresh);
  expect(captureBlackoutExperience(f.world, f.actor, baseline).entries).toHaveLength(0);
});

test("ambiguous ownership and unstamped native rows fail closed without invented provenance", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor); advance(f.world);
  const memory = remember(f.world, f.actor, "I saw the fuse");
  removeComponent(f.world, memory, SimulationAge);
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/timestamp/);
  const other = createAgentEntity(f.world, { name: "Ivo", role: "friend", systemPrompt: "Friend", roomId: f.room });
  addComponent(f.world, other, HasMemory(memory));
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow(/ownership/);
});

test("retention is chronological, bounded and explicit rather than selecting only successful memories", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor);
  for (let i = 0; i < 40; i++) { advance(f.world); remember(f.world, f.actor, `${i}: ${i % 2 ? "failure" : "success"}`); }
  const bundle = captureBlackoutExperience(f.world, f.actor, baseline);
  expect(bundle).toMatchObject({ eligibleCount: 40, omittedCount: 8 });
  expect(bundle.entries).toHaveLength(32);
  expect(bundle.entries[0].content).toBe("8: success");
  expect(bundle.entries.at(-1)!.content).toBe("39: failure");
});

test("corrupted, extra-field, impossible-time and duplicate-memory bundles make no writes", () => {
  const bundle = experience(), f = fixture();
  const corrupt = structuredClone(bundle); corrupt.entries[0].content = "Edited without updating checksum";
  expect(() => restoreBlackoutExperience(f.world, f.actor, corrupt)).toThrow(/checksum/);
  expect(() => restoreBlackoutExperience(f.world, f.actor, { ...bundle, plans: ["repair now"] })).toThrow();
  const reversed = structuredClone(bundle); reversed.entries.reverse();
  expect(() => restoreBlackoutExperience(f.world, f.actor, resign(reversed))).toThrow(/time/);
  const duplicate = structuredClone(bundle); duplicate.entries[1].memoryKey = duplicate.entries[0].memoryKey;
  expect(() => restoreBlackoutExperience(f.world, f.actor, resign(duplicate))).toThrow(/provenance/);
  const future = structuredClone(bundle); future.entries[1].atSimMs = future.capturedAtSimMs + 1;
  expect(() => restoreBlackoutExperience(f.world, f.actor, resign(future))).toThrow(/time/);
  expect(own(f.world, f.actor)).toHaveLength(0);
});

test("excessive memory bytes fail rather than silently trimming narrative evidence", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor); advance(f.world);
  remember(f.world, f.actor, "🌍".repeat(3000));
  expect(() => captureBlackoutExperience(f.world, f.actor, baseline)).toThrow();
  const g = fixture(), marker = captureMemoryBaseline(g.world, g.actor);
  for (let i = 0; i < 9; i++) { advance(g.world); remember(g.world, g.actor, `${i}:` + "a".repeat(8000)); }
  expect(() => captureBlackoutExperience(g.world, g.actor, marker)).toThrow(/byte bound/);
});

test("restoration preflights native retention capacity instead of pruning existing authored memories", () => {
  const bundle = experience(), f = fixture();
  for (let i = 0; i < 49; i++) remember(f.world, f.actor, `Authored memory ${i}`);
  const before = own(f.world, f.actor).map(eid => Memory.content[eid]);
  expect(() => restoreBlackoutExperience(f.world, f.actor, bundle)).toThrow(/prune/);
  expect(own(f.world, f.actor).map(eid => Memory.content[eid])).toEqual(before);
});

test("returned JSON is detached from the native store and empty experiences import nothing", () => {
  const f = fixture(), baseline = captureMemoryBaseline(f.world, f.actor); advance(f.world);
  const memory = remember(f.world, f.actor, "A failed repair remains a failed repair");
  const first = captureBlackoutExperience(f.world, f.actor, baseline); first.entries[0].content = "operator edits detached artifact";
  expect(Memory.content[memory]).toBe("A failed repair remains a failed repair");
  expect(captureBlackoutExperience(f.world, f.actor, baseline).entries[0].content).toBe("A failed repair remains a failed repair");
  stopCommittedEvents(f.world);
  const g = fixture(), empty = captureBlackoutExperience(g.world, g.actor, captureMemoryBaseline(g.world, g.actor)); stopCommittedEvents(g.world);
  const h = fixture(); expect(restoreBlackoutExperience(h.world, h.actor, empty)).toBe(0);
  expect(own(h.world, h.actor)).toHaveLength(0);
  expect(Agent.active[h.actor]).toBe(true);
});
