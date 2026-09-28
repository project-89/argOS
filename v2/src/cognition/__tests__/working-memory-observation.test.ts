import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Agent, Name, ObjectState, Room, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import type { AgentAction } from "../agent-mind";
import { formatWorkingMemoryContext, getWorkingMemory, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { captureWorkingMemoryRemoval } from "../working-memory-removal";
import { captureCognitiveLocalView, formatCognitiveLocalView } from "../cognitive-local-view";
import { buildAgentContext } from "../agent-mind";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { executeEffect, executeEffects } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { currentWorkingMemoryDependency } from "../working-memory-dependencies";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";

function fixture() {
  const world = createArgosWorld("Witness boundaries");
  const entity = (label: string, parent?: number) => {
    const eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = label;
    if (parent !== undefined) setLocatedIn(world, eid, parent);
    return eid;
  };
  const room = entity("Common Room"), remote = entity("Remote Room");
  addComponent(world, room, Room); addComponent(world, remote, Room);
  const actor = (label: string, parent = room, blind = false) => {
    const eid = entity(label, parent); addComponent(world, eid, Agent); Agent.active[eid] = true;
    if (blind) { addComponent(world, eid, Traits); Traits.active[eid] = '["blind"]'; }
    return eid;
  };
  const ivo = actor("Ivo"), mara = actor("Mara"), sera = actor("Sera"), blind = actor("Blind witness", room, true), away = actor("Remote witness", remote);
  const fuse = entity("Fuse", ivo), phone = entity("Private phone", mara), relay = entity("Relay", room);
  addComponent(world, phone, ObjectState); ObjectState.current[phone] = "PRIVATE_PHONE_STATE";
  addComponent(world, relay, ObjectState); ObjectState.current[relay] = "off";
  const give = (from: number, to: number) => {
    const action: AgentAction = { type: "give", target: Name.value[to], content: "Fuse" };
    const before = captureWorkingMemoryAction(world, from, action);
    setLocatedIn(world, fuse, to); recordWorkingMemoryAction(world, from, action, true, { before });
  };
  const remembered = (observer: number) => getWorkingMemory(world, observer).facts.find(f => f.subjectLabel === "Fuse" && f.predicate === "location");
  return { world, entity, actor, room, remote, ivo, mara, sera, blind, away, fuse, phone, relay, give, remembered };
}
afterEach(() => { jest.restoreAllMocks(); });

test("only actual participants and sighted local witnesses learn a committed transfer", () => {
  const f = fixture(); f.give(f.ivo, f.mara);
  for (const observer of [f.ivo, f.mara, f.sera]) expect(f.remembered(observer)).toMatchObject({ valueLabel: "Mara" });
  expect(getWorkingMemory(f.world, f.blind).receipts).toEqual([]);
  expect(getWorkingMemory(f.world, f.away).receipts).toEqual([]);
});

test("a blind recipient learns the item actually placed into their hands without gaining sight", () => {
  const f = fixture(); f.give(f.ivo, f.blind);
  expect(f.remembered(f.blind)).toMatchObject({ valueLabel: "Blind witness", provenance: "witnessed_action" });
  captureWorkingMemoryObservation(f.world, f.blind);
  expect(f.remembered(f.blind)).toMatchObject({ valueLabel: "Blind witness" });
  expect(getWorkingMemory(f.world, f.blind).facts.some(fact => fact.subjectLabel === "Relay")).toBe(false);
});

test("a blind giver remembers their actual tactile handoff and the recipient receives its receipt", () => {
  const f = fixture(); setLocatedIn(f.world, f.fuse, f.blind);
  captureWorkingMemoryObservation(f.world, f.blind); f.give(f.blind, f.mara);
  expect(f.remembered(f.blind)).toMatchObject({ valueLabel: "Mara", provenance: "own_action" });
  expect(f.remembered(f.mara)).toMatchObject({ valueLabel: "Mara", provenance: "witnessed_action" });
  expect(f.remembered(f.sera)).toMatchObject({ valueLabel: "Mara" });
  expect(getWorkingMemory(f.world, f.blind).facts.some(fact => fact.subjectLabel === "Relay")).toBe(false);
});

test("sensing and pre-action snapshots never scan another character's hidden inventory", () => {
  const f = fixture();
  captureWorkingMemoryObservation(f.world, f.ivo);
  const before = captureWorkingMemoryAction(f.world, f.ivo, { type: "observe" });
  expect(before?.entities.some(item => item.eid === f.phone)).toBe(false);
  expect(hasComponent(f.world, f.phone, WorkingMemoryIdentity)).toBe(false);
  expect(formatWorkingMemoryContext(f.world, f.ivo)).not.toContain("Private phone");
  expect(formatWorkingMemoryContext(f.world, f.ivo)).not.toContain("PRIVATE_PHONE_STATE");
});

test("request sensing never promotes a visible person's generic mental state into working memory or context", () => {
  const f = fixture(); addComponent(f.world, f.mara, ObjectState);
  ObjectState.current[f.mara] = "PRIVATE_PEER_INTENTION_SENTINEL";
  const snapshot = captureWorkingMemoryObservation(f.world, f.ivo);
  const view = captureCognitiveLocalView(f.world, f.ivo);
  for (const text of [JSON.stringify(snapshot), JSON.stringify(getWorkingMemory(f.world, f.ivo)),
    formatCognitiveLocalView(view), buildAgentContext(f.world, f.ivo)]) {
    expect(text).not.toContain("PRIVATE_PEER_INTENTION_SENTINEL");
  }
  expect(getWorkingMemory(f.world, f.ivo).facts).toContainEqual(expect.objectContaining({ subjectLabel: "Mara", predicate: "location" }));
  expect(getWorkingMemory(f.world, f.ivo).facts).toContainEqual(expect.objectContaining({ subjectLabel: "Relay", predicate: "state", value: "off" }));
});

test("a person's explicitly public instrument field remains observable without their private generic state", () => {
  const f = fixture(); addComponent(f.world, f.mara, ObjectState);
  ObjectState.current[f.mara] = "PRIVATE_PEER_THOUGHT";
  registerAgentWorldCapabilities(f.world, f.ivo, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    observableState: target => target === f.mara ? [{ key: "lampOn", type: "boolean", value: true }] : [] });
  captureCognitiveLocalView(f.world, f.ivo);
  const memory = getWorkingMemory(f.world, f.ivo);
  expect(memory.facts).toContainEqual(expect.objectContaining({ subjectLabel: "Mara", predicate: "state", slot: "Observable.lampOn", value: "true" }));
  expect(formatWorkingMemoryContext(f.world, f.ivo)).toContain("Observable.lampOn");
  expect(JSON.stringify(memory)).not.toContain("PRIVATE_PEER_THOUGHT");
});

test("private carried-target state is not broadcast just because its owner is visible", () => {
  const f = fixture();
  const action: AgentAction = { type: "interact", target: "Private phone", content: "PRIVATE_MESSAGE_8421" };
  const before = captureWorkingMemoryAction(f.world, f.mara, action);
  ObjectState.current[f.phone] = "PRIVATE_REPLY_9125";
  recordWorkingMemoryAction(f.world, f.mara, action, true, { before });
  expect(formatWorkingMemoryContext(f.world, f.mara)).toContain("PRIVATE_REPLY_9125");
  for (const observer of [f.ivo, f.sera, f.blind, f.away]) {
    expect(getWorkingMemory(f.world, observer).receipts).toEqual([]);
    expect(formatWorkingMemoryContext(f.world, observer)).not.toContain("PRIVATE_");
  }
});

test("a visible interaction exposes its public effect, not the actor's private action arguments", () => {
  const f = fixture();
  const action: AgentAction = { type: "interact", target: "Relay", content: "PRIVATE_INSTRUCTION_8421" };
  const before = captureWorkingMemoryAction(f.world, f.ivo, action); ObjectState.current[f.relay] = "on";
  recordWorkingMemoryAction(f.world, f.ivo, action, true, { before, summary: "Entered PRIVATE_SECRET_9125 to turn the relay on." });
  const witnessed = getWorkingMemory(f.world, f.sera);
  expect(witnessed.facts).toContainEqual(expect.objectContaining({ subjectLabel: "Relay", predicate: "state", value: "on" }));
  expect(JSON.stringify(witnessed)).not.toContain("PRIVATE_");
  expect(getWorkingMemory(f.world, f.blind).facts).toEqual([]);
});

test("installing something into a private carried target does not disclose its concealed location", () => {
  const f = fixture(); setLocatedIn(f.world, f.phone, f.ivo);
  const action: AgentAction = { type: "use", target: "Private phone", content: "install" };
  const before = captureWorkingMemoryAction(f.world, f.ivo, action); setLocatedIn(f.world, f.fuse, f.phone);
  recordWorkingMemoryAction(f.world, f.ivo, action, true, { before });
  expect(f.remembered(f.ivo)).toMatchObject({ valueLabel: "Private phone" });
  expect(f.remembered(f.sera)).toBeUndefined(); expect(getWorkingMemory(f.world, f.sera).receipts).toEqual([]);
});

test("observing an item removed onto the visible floor supersedes inventory with its actual visible location", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.ivo);
  expect(f.remembered(f.ivo)).toMatchObject({ valueLabel: "Ivo" });
  setLocatedIn(f.world, f.fuse, f.room); captureWorkingMemoryObservation(f.world, f.ivo);
  expect(f.remembered(f.ivo)).toMatchObject({ valueLabel: "Common Room", provenance: "visible_observation" });
  expect(getWorkingMemory(f.world, f.ivo).receipts.at(-1)?.facts.some(fact => fact.subjectLabel === "Fuse" && fact.value === "unknown")).toBe(false);
});

test("unseen relocation becomes unknown only to the former holder; old witnesses gain no remote information", () => {
  const f = fixture(); f.give(f.ivo, f.mara); setLocatedIn(f.world, f.fuse, f.remote);
  captureWorkingMemoryObservation(f.world, f.mara); captureWorkingMemoryObservation(f.world, f.ivo);
  expect(f.remembered(f.mara)).toMatchObject({ value: "unknown" });
  expect(f.remembered(f.ivo)).toMatchObject({ valueLabel: "Mara" });
  expect(formatWorkingMemoryContext(f.world, f.mara)).not.toContain("Remote Room");
});

test("pending snapshots and failed actions never install anticipated physical effects", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.ivo);
  const action: AgentAction = { type: "give", target: "Mara", content: "Fuse" };
  const memory = getWorkingMemory(f.world, f.ivo);
  const before = captureWorkingMemoryAction(f.world, f.ivo, action);
  expect(getWorkingMemory(f.world, f.ivo)).toEqual(memory); // Accepted work remains pending.
  recordWorkingMemoryAction(f.world, f.ivo, action, false, { before });
  expect(f.remembered(f.ivo)).toEqual(memory.facts.find(f => f.subjectLabel === "Fuse"));
  expect(getWorkingMemory(f.world, f.ivo).receipts.at(-1)).toMatchObject({ succeeded: false, facts: [] });
  expect(getWorkingMemory(f.world, f.mara).facts).toEqual([]);
});

test("multiple handoffs in one wall-clock millisecond retain actual commit order for everyone", () => {
  jest.spyOn(Date, "now").mockReturnValue(100_000);
  const f = fixture(); f.give(f.ivo, f.mara); const first = f.remembered(f.ivo)!.observedAt;
  f.give(f.mara, f.sera); const second = f.remembered(f.ivo)!.observedAt;
  f.give(f.sera, f.ivo); const third = f.remembered(f.ivo)!.observedAt;
  expect(second).toBeGreaterThan(first); expect(third).toBeGreaterThan(second);
  for (const observer of [f.ivo, f.mara, f.sera]) expect(f.remembered(observer)).toMatchObject({ valueLabel: "Ivo" });
});

test("a removed and replaced same-named object cannot masquerade as the snapshotted transfer", () => {
  const f = fixture(); const old = workingMemoryEntityRef(f.world, f.fuse)!;
  const action: AgentAction = { type: "give", target: "Mara", content: "Fuse" };
  const before = captureWorkingMemoryAction(f.world, f.ivo, action);
  removeEntity(f.world, f.fuse); const replacement = f.entity("Fuse", f.mara);
  expect(workingMemoryEntityRef(f.world, replacement)!.key).not.toBe(old.key);
  recordWorkingMemoryAction(f.world, f.ivo, action, true, { before });
  expect(getWorkingMemory(f.world, f.mara).facts).toEqual([]);
  expect(getWorkingMemory(f.world, f.sera).facts).toEqual([]);
  expect(getWorkingMemory(f.world, f.ivo).receipts.filter(r => r.kind === "action").at(-1)?.facts).toEqual([]);
});

test("internal work and routine observations do not crowd out physical handoff receipts", () => {
  const f = fixture(); f.give(f.ivo, f.mara);
  for (let n = 0; n < 120; n++) for (const type of ["observe", "remember", "plan", "think", "message"]) {
    recordWorkingMemoryAction(f.world, f.ivo, { type, content: "I pretend I still hold the fuse." } as AgentAction, true);
  }
  const receipts = getWorkingMemory(f.world, f.ivo).receipts.filter(r => r.kind === "action");
  expect(receipts).toHaveLength(1); expect(receipts[0].summary).toBe("Ivo gave Fuse to Mara.");
  expect(f.remembered(f.ivo)).toMatchObject({ valueLabel: "Mara" });
});

function destroy(f: ReturnType<typeof fixture>, target = f.relay, actor = f.ivo) {
  return executeEffect({ type: "destroy", target: "target" }, { world: f.world, actorEid: actor,
    targetEid: target, worldSchema, registry: { byName: new Map(), byId: new Map() }, affordanceArgs: "PRIVATE_COMMAND" });
}

test("native removal durably replaces a witness's old availability, without sharing private command text", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.sera);
  const ref = workingMemoryEntityRef(f.world, f.relay)!;
  const revision = getWorkingMemory(f.world, f.sera).revision;
  const dependency = currentWorkingMemoryDependency(f.world, f.sera, ["Relay"]);
  expect(destroy(f).success).toBe(true);
  // Later sensory frames cannot bring the old availability back or erase the event.
  for (let n = 0; n < 20; n++) captureWorkingMemoryObservation(f.world, f.sera);
  const memory = getWorkingMemory(f.world, f.sera);
  expect(memory.facts.filter(x => x.subject === ref.key)).toEqual([
    expect.objectContaining({ predicate: "state", slot: "Entity.lifecycle", value: "removed", provenance: "witnessed_action" }),
  ]);
  expect(memory.revision).toBeGreaterThan(revision);
  expect(currentWorkingMemoryDependency(f.world, f.sera, ["Relay"])).not.toBe(dependency);
  expect(memory.receipts).toContainEqual(expect.objectContaining({ succeeded: true, provenance: "witnessed_action",
    summary: expect.stringContaining("no longer available") }));
  expect(formatWorkingMemoryContext(f.world, f.sera)).toContain('"Relay" state.Entity.lifecycle: "removed"');
  expect(formatWorkingMemoryContext(f.world, f.sera)).not.toContain('"Relay" location:');
  expect(buildAgentContext(f.world, f.sera)).toContain("no longer available");
  expect(JSON.stringify(memory)).not.toContain("PRIVATE_COMMAND");
  for (const observer of [f.blind, f.away]) expect(getWorkingMemory(f.world, observer).receipts).toEqual([]);
  expect(getWorkingMemory(createArgosWorld("Other world"), f.sera).receipts).toEqual([]);
});

test("a hidden carried object's removal is known to its acting owner, not a visible owner's bystanders", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.mara);
  const ref = workingMemoryEntityRef(f.world, f.phone)!;
  destroy(f, f.phone, f.mara);
  expect(getWorkingMemory(f.world, f.mara).facts.filter(x => x.subject === ref.key)).toEqual([
    expect.objectContaining({ slot: "Entity.lifecycle", value: "removed", provenance: "own_action" }),
  ]);
  for (const observer of [f.ivo, f.sera, f.blind, f.away]) {
    expect(getWorkingMemory(f.world, observer).receipts).toEqual([]);
    expect(formatWorkingMemoryContext(f.world, observer)).not.toContain("Private phone");
  }
});

test("a removal is not inferred from an unrelated deletion, a pending action, or a skipped native effect", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.sera);
  const before = getWorkingMemory(f.world, f.sera);
  const action = { type: "interact" as const, target: "Relay", content: "destroy" };
  const snapshot = captureWorkingMemoryAction(f.world, f.ivo, action);
  expect(getWorkingMemory(f.world, f.sera)).toEqual(before);
  const ctx = { world: f.world, actorEid: f.ivo, targetEid: f.relay, worldSchema,
    registry: { byName: new Map<string, number>(), byId: new Map<number, string>() } };
  executeEffect({ type: "destroy", target: "target", condition: { check: "ObjectState.current", value: "not-off", operator: "==" } }, ctx);
  expect(getWorkingMemory(f.world, f.sera)).toEqual(before);
  removeEntity(f.world, f.relay);
  recordWorkingMemoryAction(f.world, f.ivo, action, false, { before: snapshot });
  captureWorkingMemoryObservation(f.world, f.sera);
  expect(getWorkingMemory(f.world, f.sera).facts.some(x => x.slot === "Entity.lifecycle")).toBe(false);
});

test("a same-name replacement has its own lifetime, while a later arrival learns no historical removal", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.sera);
  const old = workingMemoryEntityRef(f.world, f.relay)!; destroy(f);
  const replacement = f.entity("Relay", f.room); addComponent(f.world, replacement, ObjectState); ObjectState.current[replacement] = "on";
  const next = workingMemoryEntityRef(f.world, replacement)!;
  captureWorkingMemoryObservation(f.world, f.sera);
  expect(next.key).not.toBe(old.key);
  expect(getWorkingMemory(f.world, f.sera).facts).toContainEqual(expect.objectContaining({ subject: old.key, value: "removed" }));
  expect(getWorkingMemory(f.world, f.sera).facts).toContainEqual(expect.objectContaining({ subject: next.key, value: "on" }));
  setLocatedIn(f.world, f.away, f.room); captureWorkingMemoryObservation(f.world, f.away);
  expect(getWorkingMemory(f.world, f.away).facts.some(x => x.subject === old.key)).toBe(false);
});

test.each(["not_removed", "identity_changed", "left", "time_changed", "source_changed", "expired"])("removal observation cannot be reused across %s", async mode => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.sera);
  const commit = captureWorkingMemoryRemoval(f.world, f.relay, f.ivo);
  if (!["not_removed", "identity_changed"].includes(mode)) removeEntity(f.world, f.relay);
  if (mode === "identity_changed") WorkingMemoryIdentity.id[f.relay] = "entity:replacement-identity";
  if (mode === "left") setLocatedIn(f.world, f.sera, f.remote);
  if (mode === "time_changed") advanceSimulationTime(f.world, 1, 500);
  if (mode === "source_changed") startCommittedEvents(f.world);
  if (mode === "expired") await Promise.resolve();
  commit();
  expect(getWorkingMemory(f.world, f.sera).facts.some(x => x.slot === "Entity.lifecycle")).toBe(false);
});

test("a native removal observation is one-shot and canceled work cannot publish it", async () => {
  const f = fixture(); const commit = captureWorkingMemoryRemoval(f.world, f.relay, f.ivo);
  removeEntity(f.world, f.relay); commit(); const once = getWorkingMemory(f.world, f.sera); commit();
  expect(getWorkingMemory(f.world, f.sera)).toEqual(once);
  const other = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    const canceled = captureWorkingMemoryRemoval(other.world, other.relay, other.ivo);
    removeEntity(other.world, other.relay); controller.abort();
    expect(() => canceled()).toThrow();
    expect(getWorkingMemory(other.world, other.sera).receipts).toEqual([]);
  });
});

test("actual removal survives a later effect failure without claiming whole-action or goal success", () => {
  const f = fixture();
  const result = executeEffects([{ type: "destroy", target: "target" }, { type: "set_state", target: "target" }],
    { world: f.world, actorEid: f.ivo, targetEid: f.relay, worldSchema, registry: { byName: new Map(), byId: new Map() } });
  expect(result.success).toBe(false);
  const receipt = getWorkingMemory(f.world, f.sera).receipts.at(-1)!;
  expect(receipt.facts).toContainEqual(expect.objectContaining({ value: "removed" }));
  expect(receipt.action).toBeUndefined(); expect(receipt.executionContext).toBeUndefined();
});

test("a blind actor learns their own consumed possession, without revealing other private objects", () => {
  const f = fixture(); setLocatedIn(f.world, f.fuse, f.blind);
  destroy(f, f.fuse, f.blind);
  expect(getWorkingMemory(f.world, f.blind).facts).toContainEqual(expect.objectContaining({ subjectLabel: "Fuse", value: "removed", provenance: "own_action" }));
  expect(formatWorkingMemoryContext(f.world, f.blind)).not.toContain("Private phone");
  expect(getWorkingMemory(f.world, f.sera).receipts).toEqual([]);
});

test("removal memory survives native save/reload with the old object lifetime absent", () => {
  const f = fixture(); initializeRegistry(f.world); captureWorkingMemoryObservation(f.world, f.sera);
  Agent.role[f.sera] = "observer"; Agent.systemPrompt[f.sera] = "Remember what I witness.";
  const ref = workingMemoryEntityRef(f.world, f.relay)!; destroy(f);
  const snapshot = serializeWorld(f.world, createSystemRegistry());
  const restored = createArgosWorld("Restored removal"); initializeRegistry(restored);
  const loaded = deserializeWorld(restored, createSystemRegistry(), snapshot);
  const observer = loaded.oldToNewId.get(f.sera)!;
  expect(getWorkingMemory(restored, observer).facts.filter(x => x.subject === ref.key)).toEqual([
    expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" }),
  ]);
  expect(formatWorkingMemoryContext(restored, observer)).toContain("no longer available");
});
