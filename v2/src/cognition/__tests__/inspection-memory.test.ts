import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Agent, Container, Description, Name, ObjectState, ObjectType, PhysicalObject, Room, Surface, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { getCurrentInspection, recordInspectionResult, refreshKnownInspectionEvidence } from "../inspection-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { formatWorkingMemoryContext, getWorkingMemory, getWorkingMemoryRevision, workingMemoryEntityRef } from "../working-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld("Inspection boundaries");
  const entity = (label: string, parent?: number) => {
    const eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = label;
    addComponent(world, eid, PhysicalObject); PhysicalObject.portable[eid] = true;
    if (parent !== undefined) setLocatedIn(world, eid, parent);
    return eid;
  };
  const room = entity("Store Room"), away = entity("Common Room");
  addComponent(world, room, Room); addComponent(world, away, Room);
  const sera = entity("Sera", room), ivo = entity("Ivo", room);
  for (const actor of [sera, ivo]) { addComponent(world, actor, Agent); Agent.active[actor] = true; }
  const cupboard = entity("Supply cupboard", room);
  addComponent(world, cupboard, Container); Container.capacity[cupboard] = 10;
  addComponent(world, cupboard, ObjectState); ObjectState.current[cupboard] = "open";
  const inspect = (question?: string) => recordInspectionResult(world, sera, cupboard, { question });
  const current = (question?: string) => getCurrentInspection(world, sera, "Supply cupboard", question);
  return { world, entity, room, away, sera, ivo, cupboard, inspect, current };
}
afterEach(() => jest.restoreAllMocks());

test("an actual inspection establishes an empty open cupboard, not just its static description", () => {
  const f = fixture(); const result = f.inspect();
  expect(result).toMatchObject({ outcome: "empty", subjectLabel: "Supply cupboard", question: "general inspection" });
  expect(result?.summary).toMatch(/visibly empty/i);
  expect(f.current()).toEqual(result);
  expect(formatWorkingMemoryContext(f.world, f.sera)).toMatch(/visibly empty/i);
  expect(formatWorkingMemoryContext(f.world, f.sera)).not.toMatch(/Inspection\.(basis|question)|[a-f0-9]{64}/);
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([]);
});

test("a newly observed semantic change invalidates the old inspection even if its visible state word is unchanged", () => {
  const f = fixture(), target = f.entity("North surface", f.room);
  addComponent(f.world, target, ObjectType); ObjectType.typeId[target] = "object";
  addComponent(f.world, target, ObjectState); ObjectState.current[target] = "normal";
  const previous = recordInspectionResult(f.world, f.sera, target)!;
  expect(getCurrentInspection(f.world, f.sera, previous.subject)).toEqual(previous);
  addComponent(f.world, target, Traits); Traits.active[target] = '["structural_geometry","examinable"]';
  // A memory read does not look through walls or silently acquire new meaning.
  expect(getCurrentInspection(f.world, f.sera, previous.subject)).toEqual(previous);
  refreshKnownInspectionEvidence(f.world, f.sera);
  expect(getCurrentInspection(f.world, f.sera, previous.subject)).toBeUndefined();
  const next = recordInspectionResult(f.world, f.sera, target)!;
  expect(next.evidenceBasis).not.toBe(previous.evidenceBasis);
  expect(next.summary).toContain("structural geometry; not a container");
  expect(getCurrentInspection(f.world, f.sera, next.subject)).toEqual(next);
});

test("a full typed container keeps bounded native contents evidence and is not classified from its name", () => {
  const f = fixture(); Name.value[f.cupboard] = "Structural wall supply cupboard";
  addComponent(f.world, f.cupboard, ObjectType); ObjectType.typeId[f.cupboard] = "object";
  for (let i = 0; i < 30; i++) f.entity(`Visible item ${i}`, f.cupboard);
  const inspection = f.inspect()!;
  expect(inspection.outcome).toBe("contents");
  const receipt = getWorkingMemory(f.world, f.sera).receipts.find(r => r.id === inspection.sourceId)!;
  expect(receipt.facts).toHaveLength(32);
  expect(receipt.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ subject: inspection.subject, slot: "Entity.kind", value: "container" }),
    expect.objectContaining({ subject: inspection.subject, slot: "Container.present", value: "true" }),
  ]));
  expect(receipt.facts.some(fact => fact.value === "structural_geometry")).toBe(false);
});

test("inspecting a person establishes public activity, never private generic Agent state", () => {
  const f = fixture(); addComponent(f.world, f.ivo, ObjectState); ObjectState.current[f.ivo] = "PRIVATE_INTENTION_SENTINEL";
  let active = true;
  registerAgentWorldCapabilities(f.world, f.ivo, { context: () => "", ready: () => true, busy: () => active, execute: () => false,
    publicActivity: () => active ? { kind: "holding", targetEid: f.cupboard } : undefined });
  const result = recordInspectionResult(f.world, f.sera, f.ivo);
  expect(result?.summary).toContain("holding Supply cupboard");
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("PRIVATE_INTENTION");
  expect(getCurrentInspection(f.world, f.sera, "Ivo")).toEqual(result);
  active = false; refreshKnownInspectionEvidence(f.world, f.sera);
  expect(getCurrentInspection(f.world, f.sera, "Ivo")).toBeUndefined();
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("PRIVATE_INTENTION");
});

test("closed means not observable, never evidence of emptiness or hidden items", () => {
  const f = fixture(); const secret = f.entity("Hidden family papers", f.cupboard);
  ObjectState.current[f.cupboard] = "locked";
  expect(f.inspect()).toMatchObject({ outcome: "not_observable" });
  const memory = JSON.stringify(getWorkingMemory(f.world, f.sera));
  expect(memory).toContain("contents are not observable");
  expect(memory).not.toContain("Hidden family papers");
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
});

test("closed-container inspection answers exterior questions without revealing hidden contents", () => {
  const f = fixture(); ObjectState.current[f.cupboard] = "closed";
  addComponent(f.world, f.cupboard, Description);
  Description.value[f.cupboard] = "Three hooked cuts cross the outer lid; pale paint is caught in the middle cut.";
  const secret = f.entity("Hidden family papers", f.cupboard);
  addComponent(f.world, secret, Description); Description.value[secret] = "The private answer to the mystery.";
  const result = f.inspect("What marks can I see on the lid?")!;
  expect(result.summary).toContain(Description.value[f.cupboard]);
  expect(result.outcome).toBe("not_observable"); // Only the contents remain unknown.
  const memory = getWorkingMemory(f.world, f.sera);
  expect(memory.facts).toContainEqual(expect.objectContaining({ subject: result.subject,
    slot: "Inspection.exterior", valueLabel: Description.value[f.cupboard], provenance: "own_action", sourceId: result.sourceId }));
  expect(formatWorkingMemoryContext(f.world, f.sera)).toContain("pale paint");
  expect(JSON.stringify(memory)).not.toMatch(/Hidden family papers|private answer/);
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.ivo).facts).toEqual([]);
});

test("a changed visible exterior invalidates the prior inspection only after local observation", () => {
  const f = fixture(); addComponent(f.world, f.cupboard, Description);
  Description.value[f.cupboard] = "Two straight cuts cross the outer lid.";
  const first = f.inspect();
  expect(f.current()).toEqual(first);
  setLocatedIn(f.world, f.sera, f.away);
  Description.value[f.cupboard] = "Three hooked cuts cross the outer lid.";
  refreshKnownInspectionEvidence(f.world, f.sera); expect(f.current()).toEqual(first);
  setLocatedIn(f.world, f.sera, f.room); refreshKnownInspectionEvidence(f.world, f.sera);
  expect(f.current()).toBeUndefined();
  const next = f.inspect()!;
  expect(next.summary).toContain("Three hooked cuts"); expect(next.evidenceBasis).not.toBe(first?.evidenceBasis);
  refreshKnownInspectionEvidence(f.world, f.sera); expect(f.current()).toEqual(next);
});

test("person inspection does not surface a generic description that may include private identity", () => {
  const f = fixture(); addComponent(f.world, f.ivo, Description);
  Description.value[f.ivo] = "PRIVATE_BACKSTORY_SENTINEL";
  expect(recordInspectionResult(f.world, f.sera, f.ivo)).toBeDefined();
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("PRIVATE_BACKSTORY_SENTINEL");
});

test("an explicit closed state overrides a stale open trait", () => {
  const f = fixture(); addComponent(f.world, f.cupboard, Traits); Traits.active[f.cupboard] = '["open"]';
  ObjectState.current[f.cupboard] = "closed";
  expect(f.inspect()?.outcome).toBe("not_observable");
});

test("inspection remembers direct physical contents, without scanning nested closed boxes", () => {
  const f = fixture(); const box = f.entity("Small box", f.cupboard);
  addComponent(f.world, box, Container); addComponent(f.world, box, ObjectState); ObjectState.current[box] = "locked";
  const secret = f.entity("Private diary", box);
  const result = f.inspect();
  expect(result?.outcome).toBe("contents"); expect(result?.summary).toContain("Small box");
  expect(getWorkingMemory(f.world, f.sera).facts).toContainEqual(expect.objectContaining({ subjectLabel: "Small box", predicate: "location", valueLabel: "Supply cupboard" }));
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("Private diary");
  expect(hasComponent(f.world, secret, WorkingMemoryIdentity)).toBe(false);
});

test("hidden contents and nonphysical message entities do not become inspection evidence", () => {
  const f = fixture(); const secret = f.entity("Concealed spare key", f.cupboard);
  addComponent(f.world, secret, Traits); Traits.active[secret] = '["hidden"]';
  const message = addEntity(f.world); addComponent(f.world, message, Name); Name.value[message] = "Unread private message";
  setLocatedIn(f.world, message, f.cupboard);
  expect(f.inspect()?.summary).toMatch(/no items are visible/i);
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toMatch(/Concealed spare key|Unread private message/);
  for (const eid of [secret, message]) expect(hasComponent(f.world, eid, WorkingMemoryIdentity)).toBe(false);
});

test("an actor's visible exterior is not access to their carried inventory", () => {
  const f = fixture(); addComponent(f.world, f.ivo, Container);
  addComponent(f.world, f.ivo, ObjectState); ObjectState.current[f.ivo] = "open";
  const phone = f.entity("Ivo's private phone", f.ivo);
  expect(recordInspectionResult(f.world, f.sera, f.ivo)?.outcome).toBe("observed");
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("Ivo's private phone");
  expect(hasComponent(f.world, phone, WorkingMemoryIdentity)).toBe(false);
});

test("neither a remote actor nor a blind actor can mint a visual inspection receipt", () => {
  const f = fixture(); setLocatedIn(f.world, f.sera, f.away);
  expect(f.inspect()).toBeUndefined(); expect(getWorkingMemory(f.world, f.sera).receipts).toEqual([]);
  setLocatedIn(f.world, f.sera, f.room); addComponent(f.world, f.sera, Traits); Traits.active[f.sera] = '["blind"]';
  expect(f.inspect()).toBeUndefined(); expect(getWorkingMemory(f.world, f.sera).facts).toEqual([]);
});

test("ordinary ambient perception never claims a deliberate inspection took place", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.sera);
  expect(f.current()).toBeUndefined();
  expect(getWorkingMemory(f.world, f.sera).receipts.some(r => r.id.startsWith("inspection:"))).toBe(false);
});

test("a completed inspection survives sensory churn without repeating its action receipt", () => {
  jest.spyOn(Date, "now").mockReturnValue(100_000);
  const f = fixture(); const result = f.inspect();
  for (let i = 0; i < 150; i++) captureWorkingMemoryObservation(f.world, f.sera);
  expect(f.current()).toEqual(result);
  expect(getWorkingMemory(f.world, f.sera).receipts.filter(r => r.id.startsWith("inspection:"))).toHaveLength(1);
  const revision = getWorkingMemoryRevision(f.world, f.sera);
  refreshKnownInspectionEvidence(f.world, f.sera);
  expect(getWorkingMemoryRevision(f.world, f.sera)).toBe(revision);
});

test("memory reads do not see an unseen relocation or refresh observation timestamps", () => {
  const f = fixture(); const result = f.inspect(); setLocatedIn(f.world, f.sera, f.away);
  const memory = getWorkingMemory(f.world, f.sera); const replacement = f.entity("Replacement fuse", f.cupboard);
  for (let i = 0; i < 10; i++) { expect(f.current()).toEqual(result); formatWorkingMemoryContext(f.world, f.sera); }
  expect(getWorkingMemory(f.world, f.sera)).toEqual(memory);
  refreshKnownInspectionEvidence(f.world, f.sera);
  expect(f.current()).toEqual(result);
  expect(hasComponent(f.world, replacement, WorkingMemoryIdentity)).toBe(false);
});

test("a genuinely observed local change reopens inspection without a time-based or global ban", () => {
  const f = fixture(); const old = f.inspect(); setLocatedIn(f.world, f.sera, f.away);
  f.entity("Replacement fuse", f.cupboard);
  expect(f.current()).toEqual(old);
  setLocatedIn(f.world, f.sera, f.room); captureWorkingMemoryObservation(f.world, f.sera);
  expect(f.current()).toBeUndefined();
  expect(formatWorkingMemoryContext(f.world, f.sera)).toContain("Previous inspection is outdated after an observed local change");
  const next = f.inspect(); expect(next?.outcome).toBe("contents"); expect(next?.summary).toContain("Replacement fuse");
  expect(next?.sourceId).not.toBe(old?.sourceId); expect(f.current()).toEqual(next);
});

test("unrelated local changes and repeated same-state confirmation do not invalidate inspection", () => {
  const f = fixture(); const result = f.inspect(); const lamp = f.entity("Lamp", f.room);
  addComponent(f.world, lamp, ObjectState); ObjectState.current[lamp] = "on";
  captureWorkingMemoryObservation(f.world, f.sera); expect(f.current()).toEqual(result);
  ObjectState.current[lamp] = "off";
  captureWorkingMemoryObservation(f.world, f.sera); expect(f.current()).toEqual(result);
});

test("a different inspection question remains a new action, while harmless whitespace is normalized", () => {
  const f = fixture(); f.inspect();
  expect(f.current("look for water damage")).toBeUndefined();
  const next = f.inspect(" Look for   water damage ");
  expect(f.current("look for water damage")).toEqual(next);
  expect(f.current()).toBeUndefined();
  expect(f.current("look for hidden compartments")).toBeUndefined();
});

test.each(["observe", "examine", "inspect", "  EXAMINE  "])("plain %s is an inspection alias, not a new question", question => {
  const f = fixture(); const original = f.inspect();
  expect(f.current(question)).toEqual(original);
  const repeated = f.inspect(question);
  expect(f.current()).toEqual(repeated);
  expect(f.current("examine the hidden compartment")).toBeUndefined();
  expect(f.current("inspect process:42")).toBeUndefined();
});

test("duplicate display names do not merge inspection history, and stable identity disambiguates", () => {
  const f = fixture(); const first = f.inspect()!;
  const second = f.entity("Supply cupboard", f.room); addComponent(f.world, second, Container);
  addComponent(f.world, second, ObjectState); ObjectState.current[second] = "open";
  recordInspectionResult(f.world, f.sera, second);
  expect(f.current()).toBeUndefined();
  expect(getCurrentInspection(f.world, f.sera, first.subject)).toEqual(first);
});

test("a same-named replacement object does not update the removed object's inspection", () => {
  const f = fixture(); const original = f.inspect()!; removeEntity(f.world, f.cupboard);
  const replacement = f.entity("Supply cupboard", f.room); addComponent(f.world, replacement, Container);
  addComponent(f.world, replacement, ObjectState); ObjectState.current[replacement] = "locked";
  captureWorkingMemoryObservation(f.world, f.sera);
  expect(workingMemoryEntityRef(f.world, replacement)?.key).not.toBe(original.subject);
  expect(getCurrentInspection(f.world, f.sera, original.subject)).toEqual(original);
  expect(f.current()).toBeUndefined();
});

test("an exposed surface may be inspected, but a merely open non-container reveals no fabricated contents", () => {
  const f = fixture(); const table = f.entity("Table", f.room); addComponent(f.world, table, Surface);
  f.entity("Cup", table);
  expect(recordInspectionResult(f.world, f.sera, table)?.summary).toContain("Cup");
  const door = f.entity("Door", f.room); addComponent(f.world, door, ObjectState); ObjectState.current[door] = "open";
  expect(recordInspectionResult(f.world, f.sera, door)?.outcome).toBe("observed");
  expect(getWorkingMemory(f.world, f.sera).facts.filter(f => f.subjectLabel === "Door").some(f => f.slot === "Container.visibleContents")).toBe(false);
});

test("a surface tag cannot expose the contents of a closed container", () => {
  const f = fixture(); addComponent(f.world, f.cupboard, Surface); ObjectState.current[f.cupboard] = "locked";
  f.entity("Private object", f.cupboard);
  expect(f.inspect()?.outcome).toBe("not_observable");
  expect(JSON.stringify(getWorkingMemory(f.world, f.sera))).not.toContain("Private object");
});

test("a hidden target cannot disclose its state or mint an inspection identity", () => {
  const f = fixture(); addComponent(f.world, f.cupboard, Traits); Traits.active[f.cupboard] = '["concealed"]';
  expect(f.inspect()).toBeUndefined();
  expect(getWorkingMemory(f.world, f.sera).facts).toEqual([]);
  expect(hasComponent(f.world, f.cupboard, WorkingMemoryIdentity)).toBe(false);
});

test("room inspection establishes local visible entities without other people's possessions", () => {
  const f = fixture(); const phone = f.entity("Private phone", f.ivo);
  const inspected = recordInspectionResult(f.world, f.sera, f.room)!;
  expect(inspected.summary).toContain("Ivo"); expect(inspected.summary).toContain("Supply cupboard");
  expect(inspected.summary).not.toContain("Private phone");
  expect(hasComponent(f.world, phone, WorkingMemoryIdentity)).toBe(false);
  expect(getCurrentInspection(f.world, f.sera, "Store Room")).toEqual(inspected);
  f.entity("New parcel", f.room); captureWorkingMemoryObservation(f.world, f.sera);
  expect(getCurrentInspection(f.world, f.sera, "Store Room")).toBeUndefined();
  expect(recordInspectionResult(f.world, f.sera, f.room)?.summary).toContain("New parcel");
});
