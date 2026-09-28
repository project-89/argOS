import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Agent, Name, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { setLocatedIn } from "../../ecs/location";
import { formatWorkingMemoryContext, getWorkingMemory, getWorkingMemoryRevision, recordWorkingMemoryEvidence,
  workingMemoryEntityRef, WORKING_MEMORY_LIMITS, type WorkingMemoryEvidence, type WorkingMemoryFactInput } from "../working-memory";

function fixture() {
  const world = createArgosWorld("Physical working memory");
  const make = (label: string, isActor = false) => {
    const eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = label;
    if (isActor) addComponent(world, eid, Agent);
    return eid;
  };
  const ivo = make("Ivo", true), mara = make("Mara", true), sera = make("Sera", true);
  const fuse = make("Fuse"), relay = make("Relay"), room = make("Common Room"), remote = make("Locked Store");
  const fuseRef = workingMemoryEntityRef(world, fuse)!;
  const location = (holder: number): WorkingMemoryFactInput => {
    const ref = workingMemoryEntityRef(world, holder)!;
    return { subject: fuseRef.key, subjectLabel: fuseRef.label, predicate: "location", value: ref.key, valueLabel: ref.label };
  };
  const evidence = (id: string, atMs: number, holder: number, overrides: Partial<WorkingMemoryEvidence> = {}): WorkingMemoryEvidence => ({
    id, atMs, kind: "action", provenance: "own_action", summary: `Moved the fuse to ${Name.value[holder]}.`, succeeded: true,
    facts: [location(holder)], ...overrides,
  });
  return { world, make, ivo, mara, sera, fuse, relay, room, remote, fuseRef, location, evidence };
}

test("a confirmed handoff replaces older possession without querying a later hidden move", () => {
  const f = fixture(); setLocatedIn(f.world, f.ivo, f.room); setLocatedIn(f.world, f.mara, f.room);
  setLocatedIn(f.world, f.fuse, f.ivo);
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  setLocatedIn(f.world, f.fuse, f.mara);
  const give = f.evidence("give", 2000, f.mara);
  recordWorkingMemoryEvidence(f.world, f.ivo, give);
  recordWorkingMemoryEvidence(f.world, f.mara, { ...give, provenance: "witnessed_action" });
  for (let n = 0; n < 30; n++) recordWorkingMemoryEvidence(f.world, f.ivo, {
    id: `ambient:${n}`, atMs: 3000 + n, kind: "observation", provenance: "visible_observation", summary: "The room is quiet.", facts: [],
  });
  setLocatedIn(f.world, f.fuse, f.remote);
  expect(getWorkingMemory(f.world, f.ivo).facts).toMatchObject([{ valueLabel: "Mara", sourceId: "give", observedAt: 2000 }]);
  expect(getWorkingMemory(f.world, f.mara).facts).toMatchObject([{ valueLabel: "Mara" }]);
  expect(getWorkingMemory(f.world, f.sera).facts).toEqual([]);
  expect(formatWorkingMemoryContext(f.world, f.ivo, 10_000)).not.toContain("Locked Store");
  expect(formatWorkingMemoryContext(f.world, f.ivo, 10_000)).toContain("things may have changed where you can't see");
  expect(formatWorkingMemoryContext(f.world, f.ivo, 10_000)).toContain("8s ago");
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("actually-saw-it", 11_000, f.remote, {
    kind: "observation", provenance: "visible_observation", succeeded: undefined,
  }));
  expect(getWorkingMemory(f.world, f.ivo).facts[0]).toMatchObject({ valueLabel: "Locked Store", sourceId: "actually-saw-it" });
});

test("absence from one's own inventory says unknown whereabouts, not a guessed receiver", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  const absent = { ...f.location(f.ivo), value: "unknown", valueLabel: "No longer in your possession; whereabouts unknown" };
  recordWorkingMemoryEvidence(f.world, f.ivo, { id: "own-inventory", atMs: 2000, kind: "observation", provenance: "own_observation",
    summary: "The fuse is no longer in your inventory.", facts: [absent] });
  expect(getWorkingMemory(f.world, f.ivo).facts).toMatchObject([{ value: "unknown" }]);
  expect(formatWorkingMemoryContext(f.world, f.ivo)).not.toContain('location: "Mara"');
});

test("late older evidence cannot overwrite a newer fact regardless of arrival order", () => {
  const f = fixture();
  for (const observer of [f.ivo, f.mara]) {
    const events = [f.evidence("pickup", 1000, f.ivo), f.evidence("give", 2000, f.mara)];
    for (const event of observer === f.ivo ? events : events.reverse()) recordWorkingMemoryEvidence(f.world, observer, event);
  }
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual(getWorkingMemory(f.world, f.mara).facts);
  expect(getWorkingMemory(f.world, f.mara).facts[0].valueLabel).toBe("Mara");
  expect(getWorkingMemory(f.world, f.mara).receipts.map(r => r.id)).toEqual(["pickup", "give"]);
});

test("same-time evidence conflicts have a deterministic source-ID tie break", () => {
  const f = fixture();
  const a = f.evidence("event:a", 1000, f.ivo), b = f.evidence("event:b", 1000, f.mara);
  [a, b].forEach(e => recordWorkingMemoryEvidence(f.world, f.ivo, e));
  [b, a].forEach(e => recordWorkingMemoryEvidence(f.world, f.mara, e));
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual(getWorkingMemory(f.world, f.mara).facts);
});

test("replayed source IDs cannot become independent corroboration or replace their own receipt", () => {
  const f = fixture(), original = f.evidence("source", 1000, f.ivo);
  recordWorkingMemoryEvidence(f.world, f.ivo, original);
  const before = getWorkingMemory(f.world, f.ivo);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, original)).toBe(false);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("source", 3000, f.mara))).toBe(false);
  expect(getWorkingMemory(f.world, f.ivo)).toEqual(before);
  expect(getWorkingMemory(f.world, f.ivo).facts[0]).not.toHaveProperty("confidence");
});

test("failed and unconfirmed actions cannot install proposed physical effects", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("failed-give", 2000, f.mara, { succeeded: false }))).toBe(true);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("unconfirmed", 3000, f.mara, { succeeded: undefined }))).toBe(false);
  expect(getWorkingMemory(f.world, f.ivo).facts[0]).toMatchObject({ valueLabel: "Ivo", sourceId: "pickup" });
  expect(getWorkingMemory(f.world, f.ivo).receipts[1]).toMatchObject({ succeeded: false, facts: [] });
  expect(formatWorkingMemoryContext(f.world, f.ivo)).toContain("failed]");
});

test("attributed speech, intentions and mismatched modalities are not physical proof", () => {
  const f = fixture();
  for (const override of [{ kind: "speech" }, { kind: "intention" }, { kind: "action", provenance: "visible_observation" },
    { kind: "observation", provenance: "own_action", succeeded: undefined }]) {
    expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("bad-source", 1000, f.mara, override as any))).toBe(false);
  }
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([]);
  expect(hasComponent(f.world, f.ivo, WorkingMemory)).toBe(false);
});

test("repeated confirmation refreshes age but does not manufacture a changed belief", () => {
  const f = fixture();
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  const revision = getWorkingMemoryRevision(f.world, f.ivo);
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("saw-again", 2000, f.ivo, { kind: "observation", provenance: "own_observation", succeeded: undefined }));
  expect(getWorkingMemoryRevision(f.world, f.ivo)).toBe(revision);
  expect(getWorkingMemory(f.world, f.ivo).facts[0].observedAt).toBe(2000);
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("give", 3000, f.mara));
  expect(getWorkingMemoryRevision(f.world, f.ivo)).toBe(revision + 1);
});

test("compact context prioritizes a known handoff over forty newer ambient fixtures", () => {
  const f = fixture(), source = "action:89d327b2-1269-432f-801f-1d2e5e7b10bf:0";
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence(source, 1000, f.mara));
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("refreshed-location", 2000, f.mara, {
    kind: "observation", provenance: "visible_observation", succeeded: undefined,
  }));
  for (let n = 0; n < 40; n++) recordWorkingMemoryEvidence(f.world, f.ivo, {
    id: `ambient:${n}`, atMs: 3000 + n, kind: "observation", provenance: "visible_observation", summary: "Static furniture.",
    facts: [{ subject: `fixture:${n}`, subjectLabel: `Fixture ${n}`, predicate: "location", value: "room", valueLabel: "Common Room" }],
  });
  const context = formatWorkingMemoryContext(f.world, f.ivo, 5000);
  expect(context).toContain('"Fuse" location: "Mara"');
  expect(context).toContain("action:89d327b2"); expect(context).not.toContain(source);
  expect(getWorkingMemory(f.world, f.ivo).receipts[0].id).toBe(source);
});

test("independent state slots and identical display names do not conflate physical subjects", () => {
  const f = fixture(), twin = f.make("Fuse"), twinRef = workingMemoryEntityRef(f.world, twin)!;
  expect(twinRef.key).not.toBe(f.fuseRef.key);
  recordWorkingMemoryEvidence(f.world, f.ivo, { id: "inspection", atMs: 1000, kind: "observation", provenance: "visible_observation", summary: "Inspected objects.", facts: [
    f.location(f.ivo), { ...f.location(f.mara), subject: twinRef.key },
    { subject: "relay", predicate: "state", slot: "power", value: "isolated" },
    { subject: "relay", predicate: "state", slot: "panel", value: "open" },
  ] });
  expect(getWorkingMemory(f.world, f.ivo).facts).toHaveLength(4);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, { id: "ambiguous", atMs: 2000, kind: "observation", provenance: "visible_observation",
    summary: "Conflicting duplicate slots.", facts: [f.location(f.ivo), f.location(f.mara)] })).toBe(false);
});

test("fact and receipt bounds retain a retirement watermark that blocks forgotten old sources", () => {
  const f = fixture();
  for (let n = 1; n <= 160; n++) recordWorkingMemoryEvidence(f.world, f.ivo, {
    id: `event:${n}`, atMs: n, kind: "observation", provenance: "visible_observation", summary: `Object ${n}.`,
    facts: [{ subject: `object:${n}`, predicate: "state", value: "visible" }],
  });
  const memory = getWorkingMemory(f.world, f.ivo);
  expect(memory.facts).toHaveLength(WORKING_MEMORY_LIMITS.facts);
  expect(memory.receipts).toHaveLength(WORKING_MEMORY_LIMITS.receipts);
  expect(memory.evidenceFloorMs).toBe(160 - WORKING_MEMORY_LIMITS.receipts);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("event:1", 1, f.mara))).toBe(false);
  expect(getWorkingMemory(f.world, f.ivo)).toEqual(memory);
});

test("first time-zero evidence is valid, but evicted time-zero replay is rejected", () => {
  const f = fixture();
  for (let n = 0; n <= WORKING_MEMORY_LIMITS.receipts; n++) expect(recordWorkingMemoryEvidence(f.world, f.ivo, {
    id: `event:${String(n).padStart(3, "0")}`, atMs: 0, kind: "observation", provenance: "visible_observation", summary: "Initial scene.", facts: [],
  })).toBe(true);
  expect(getWorkingMemory(f.world, f.ivo).evidenceFloorMs).toBe(0);
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("event:000", 0, f.mara))).toBe(false);
});

test("reads never attach components, resolve identity or mutate caller-visible storage", () => {
  const f = fixture();
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([]); formatWorkingMemoryContext(f.world, f.ivo);
  expect(hasComponent(f.world, f.ivo, WorkingMemory)).toBe(false);
  expect(hasComponent(f.world, f.ivo, WorkingMemoryIdentity)).toBe(false);
  recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  const before = WorkingMemory.factsJson[f.ivo];
  const detached = getWorkingMemory(f.world, f.ivo); detached.facts[0].valueLabel = "Mara"; detached.receipts[0].facts[0].value = "remote";
  formatWorkingMemoryContext(f.world, f.ivo); getWorkingMemoryRevision(f.world, f.ivo);
  expect(WorkingMemory.factsJson[f.ivo]).toBe(before);
  expect(getWorkingMemory(f.world, f.ivo).facts[0].valueLabel).toBe("Ivo");
});

test("malformed legacy storage is ignored read-only, and non-actors cannot own a ledger", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("initialize-owner", 1000, f.ivo));
  WorkingMemory.factsJson[f.ivo] = '{"bad":"shape"}'; WorkingMemory.receiptsJson[f.ivo] = '[{"id":"not evidence"}]';
  WorkingMemory.revision[f.ivo] = Number.NaN; WorkingMemory.evidenceFloorMs[f.ivo] = Number.NaN;
  expect(getWorkingMemory(f.world, f.ivo)).toEqual({ facts: [], receipts: [], revision: 0, evidenceFloorMs: -1 });
  expect(WorkingMemory.factsJson[f.ivo]).toBe('{"bad":"shape"}');
  expect(recordWorkingMemoryEvidence(f.world, f.fuse, f.evidence("bad-owner", 1000, f.ivo))).toBe(false);
});

test("an attached numeric-only or recycled component cannot expose another actor's sparse-array residue", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("old-private-source", 1000, f.ivo));
  const stale = { facts: WorkingMemory.factsJson[f.ivo], receipts: WorkingMemory.receiptsJson[f.ivo], owner: WorkingMemory.ownerKey[f.ivo] };
  removeEntity(f.world, f.ivo);
  const replacement = f.make("New resident", true); addComponent(f.world, replacement, WorkingMemory);
  // An attached prefab can leave SoA values behind even when entity IDs are
  // reused. Seed the residue explicitly rather than relying on allocator order.
  WorkingMemory.factsJson[replacement] = stale.facts; WorkingMemory.receiptsJson[replacement] = stale.receipts;
  WorkingMemory.ownerKey[replacement] = stale.owner; WorkingMemory.revision[replacement] = 12;
  WorkingMemory.capacity[replacement] = 7; WorkingMemory.currentLoad[replacement] = 2; WorkingMemory.decayRate[replacement] = 0.1;
  expect(getWorkingMemory(f.world, replacement).facts).toEqual([]);
  expect(getWorkingMemoryRevision(f.world, replacement)).toBe(0);
  expect(formatWorkingMemoryContext(f.world, replacement)).not.toContain("old-private-source");
  recordWorkingMemoryEvidence(f.world, replacement, f.evidence("new-observation", 2000, f.mara, {
    kind: "observation", provenance: "visible_observation", succeeded: undefined,
  }));
  expect(getWorkingMemory(f.world, replacement).receipts.map(r => r.id)).toEqual(["new-observation"]);
  expect(WorkingMemory.ownerKey[replacement]).not.toBe(stale.owner);
  expect(WorkingMemory.capacity[replacement]).toBe(7); expect(WorkingMemory.currentLoad[replacement]).toBe(2);
  expect(WorkingMemory.decayRate[replacement]).toBe(0.1);
});

test("actor-owned records cannot be read through another world's ID or another actor", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  expect(getWorkingMemory(f.world, f.mara).facts).toEqual([]);
  expect(getWorkingMemory(createArgosWorld("Different world"), f.ivo).facts).toEqual([]);
});

test("durable identity survives rename, while historical observed labels remain unchanged", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("pickup", 1000, f.ivo));
  Name.value[f.fuse] = "Marked fuse";
  expect(workingMemoryEntityRef(f.world, f.fuse)).toEqual({ key: f.fuseRef.key, label: "Marked fuse" });
  expect(getWorkingMemory(f.world, f.ivo).facts[0].subjectLabel).toBe("Fuse");
  expect(formatWorkingMemoryContext(f.world, f.ivo)).not.toContain("Marked fuse");
});

test("removed entities have no resolvable reference and replacement identity is fresh", () => {
  const f = fixture(); removeEntity(f.world, f.fuse);
  expect(workingMemoryEntityRef(f.world, f.fuse)).toBeUndefined();
  const replacement = f.make("Fuse");
  expect(workingMemoryEntityRef(f.world, replacement)?.key).not.toBe(f.fuseRef.key);
});

test.each([NaN, Infinity, -1])("non-finite or negative evidence times (%s) are rejected", atMs => {
  const f = fixture(); expect(recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("invalid", atMs, f.mara))).toBe(false);
});

test("confirmed terminal lifetime evidence supersedes availability, including late older observations", () => {
  const f = fixture(); const original = f.evidence("put-down", 1000, f.room);
  recordWorkingMemoryEvidence(f.world, f.ivo, original);
  const removal: WorkingMemoryEvidence = { id: "native-removal", atMs: 2000, kind: "action", succeeded: true,
    provenance: "witnessed_action", summary: "The fuse was removed; no longer available.",
    facts: [{ subject: f.fuseRef.key, subjectLabel: "Fuse", predicate: "state", slot: "Entity.lifecycle", value: "removed" }] };
  recordWorkingMemoryEvidence(f.world, f.ivo, removal);
  recordWorkingMemoryEvidence(f.world, f.ivo, { ...original, id: "late-observation", atMs: 1500,
    kind: "observation", provenance: "visible_observation", succeeded: undefined });
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" })]);
  expect(getWorkingMemory(f.world, f.ivo).receipts.map(x => x.id)).toEqual(["put-down", "late-observation", "native-removal"]);
  expect(formatWorkingMemoryContext(f.world, f.ivo)).not.toContain('"Fuse" location:');
  // The fact window is smaller than the receipt window. Its eviction must not
  // let a delayed old observation revive known-consumed stock.
  for (let n = 0; n < 3; n++) recordWorkingMemoryEvidence(f.world, f.ivo, {
    id: `many-facts:${n}`, atMs: 3000 + n, kind: "observation", provenance: "visible_observation", summary: "Other things in view.",
    facts: Array.from({ length: 32 }, (_, i) => ({ subject: `prop:${n}:${i}`, predicate: "location" as const, value: "room" })),
  });
  recordWorkingMemoryEvidence(f.world, f.ivo, { ...original, id: "even-later", atMs: 1600 });
  expect(getWorkingMemory(f.world, f.ivo).facts.some(x => x.subject === f.fuseRef.key && x.predicate === "location")).toBe(false);
});

test("a missing visual observation or failed action cannot assert terminal removal", () => {
  const f = fixture(); recordWorkingMemoryEvidence(f.world, f.ivo, f.evidence("known", 1000, f.room));
  const facts: WorkingMemoryFactInput[] = [{ subject: f.fuseRef.key, predicate: "state", slot: "Entity.lifecycle", value: "removed" }];
  expect(recordWorkingMemoryEvidence(f.world, f.ivo, { id: "missing", atMs: 2000, kind: "observation", provenance: "visible_observation",
    summary: "I cannot see the fuse.", facts })).toBe(false);
  recordWorkingMemoryEvidence(f.world, f.ivo, { id: "failed", atMs: 3000, kind: "action", provenance: "own_action", succeeded: false,
    summary: "I tried to remove the fuse.", facts });
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([expect.objectContaining({ predicate: "location" })]);
});
