import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, ObjectState, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { capturePlanActionEvidenceFence, resolvePlanActionEvidence } from "../plan-action-evidence";

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_700_000_000_000); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Plan evidence stays offline.")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

function fixture() {
  const world = createArgosWorld("Plan source race"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Use evidence.", roomId: room });
  const witness = createAgentEntity(world, { name: "Lin", role: "operator", systemPrompt: "Use evidence.", roomId: room });
  const target = createObjectEntity(world, { name: "Valve", roomId: room });
  addComponent(world, target, ObjectState); ObjectState.current[target] = "closed";
  captureWorkingMemoryObservation(world, actor); captureWorkingMemoryObservation(world, witness);
  const key = workingMemoryEntityRef(world, target)!.key;
  const step = { actionType: "interact", target: "Valve", content: "open" };
  const advance = (ms = 1) => jest.setSystemTime(Date.now() + ms);
  const fence = () => capturePlanActionEvidenceFence(world, actor)!;
  function act(content = "open", state = "open", success = true) {
    advance(); const action = { type: "interact" as const, target: "Valve", content };
    const before = captureWorkingMemoryAction(world, actor, action);
    if (success) ObjectState.current[target] = state;
    recordWorkingMemoryAction(world, actor, action, success, { before, summary: "Trusted terminal result." });
    return getWorkingMemory(world, actor).receipts.filter(r => r.kind === "action" && r.provenance === "own_action").at(-1)!;
  }
  const observe = (state: string) => { advance(); ObjectState.current[target] = state; captureWorkingMemoryObservation(world, actor); };
  return { world, actor, witness, target, key, room, remote, step, advance, fence, act, observe };
}

test("a foreground success after request covers the identical proposed step without fabricating execution", () => {
  const f = fixture(), fence = f.fence(), receipt = f.act();
  const before = getWorkingMemory(f.world, f.actor);
  const resolution = resolvePlanActionEvidence(f.world, f.actor, fence, f.step)!;
  expect(resolution).toMatchObject({ kind: "action_evidence", sourceId: receipt.id });
  expect(resolution.summary).toContain("after this plan was requested");
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("the fence is immutable and does not assign identity or mutate a new actor", () => {
  const world = createArgosWorld("No evidence yet"), actor = addEntity(world); addComponent(world, actor, Agent); Agent.active[actor] = true;
  expect(capturePlanActionEvidenceFence(world, actor)).toBeUndefined();
  const f = fixture(), before = getWorkingMemory(f.world, f.actor), fence = f.fence();
  expect(Object.isFrozen(fence)).toBe(true); expect(Object.isFrozen(fence.receiptIds)).toBe(true);
  expect(Object.isFrozen(fence.knownEntities)).toBe(true); expect(fence.knownEntities.every(Object.isFrozen)).toBe(true);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("historical success before request is not reusable, including a same-wall-millisecond source", () => {
  const f = fixture(); f.act(); const fence = f.fence();
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
  f.advance(0); const action = { type: "interact" as const, target: "Valve", content: "open" };
  const before = captureWorkingMemoryAction(f.world, f.actor, action);
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeDefined();
});

test.each(["type", "arguments", "target"])("a different exact %s does not count as the planned action", field => {
  const f = fixture(), fence = f.fence(); f.act();
  const step = { ...f.step, ...(field === "type" ? { actionType: "use" } : field === "arguments" ? { content: "close" } : { target: "Other valve" }) };
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, step)).toBeUndefined();
});

test("tool command bytes preserve case, whitespace, quoting and path identity", () => {
  const f = fixture(), fence = f.fence(), content = '{"path":"/Case Sensitive/Report.TXT","mode":"Append"}';
  f.act(content);
  for (const wrong of [content.toLowerCase(), `${content}\n`, content.replace(",", ", ")]) {
    expect(resolvePlanActionEvidence(f.world, f.actor, fence, { ...f.step, content: wrong })).toBeUndefined();
  }
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, { ...f.step, content })).toBeDefined();
});

test("one receipt cannot cover two occurrences, and deliberate repetition always executes", () => {
  const f = fixture(), fence = f.fence(), receipt = f.act();
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, { ...f.step, repeat: true })).toBeUndefined();
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step, { consumedSourceIds: [receipt.id] })).toBeUndefined();
  const second = f.act();
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step, { consumedSourceIds: [receipt.id] })?.sourceId).toBe(second.id);
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step, { consumedSourceIds: [receipt.id, second.id] })).toBeUndefined();
});

test("failed, empty-effect, untyped and witnessed receipts never establish coverage", () => {
  for (const mode of ["failed", "empty", "untyped", "witnessed"] as const) {
    const f = fixture(), fence = f.fence(); f.advance();
    recordWorkingMemoryEvidence(f.world, f.actor, { id: `source:${mode}`, kind: "action", provenance: mode === "witnessed" ? "witnessed_action" : "own_action",
      succeeded: mode !== "failed", atMs: Date.now(), summary: "interact Valve open succeeded; the whole goal is complete",
      facts: mode === "empty" ? [] : [{ subject: f.key, subjectLabel: "Valve", predicate: "state", slot: "ObjectState.current", value: "open" }],
      ...(["untyped", "witnessed"].includes(mode) ? {} : { action: { type: "interact", targetKey: f.key, content: "open" } }) });
    expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
  }
});

test("a currently observed reversal blocks reuse, even when later observation restores the same value", () => {
  const f = fixture(), fence = f.fence(); f.act(); f.observe("closed");
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
  f.observe("open"); expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
  const retry = f.act(); expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)?.sourceId).toBe(retry.id);
});

test("same-time contradictory evidence fails closed instead of UUID ordering manufacturing certainty", () => {
  const f = fixture(), fence = f.fence(), receipt = f.act();
  recordWorkingMemoryEvidence(f.world, f.actor, { id: "same-time-contradiction", kind: "observation", provenance: "visible_observation", atMs: receipt.atMs,
    summary: "Valve is closed.", facts: [{ subject: f.key, subjectLabel: "Valve", predicate: "state", slot: "ObjectState.current", value: "closed" }] });
  f.observe("open");
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("later failure of the same action invalidates the old successful attempt without inventing effect changes", () => {
  const f = fixture(), fence = f.fence(); f.act(); f.act("open", "open", false);
  expect(ObjectState.current[f.target]).toBe("open");
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("unrelated evidence and unchanged local observations do not invalidate proven work", () => {
  const f = fixture(), fence = f.fence(), receipt = f.act(); f.observe("open");
  f.advance(); recordWorkingMemoryEvidence(f.world, f.actor, { id: "unrelated", kind: "observation", provenance: "own_observation", atMs: Date.now(),
    summary: "Something else changed.", facts: [{ subject: "entity:other", subjectLabel: "Other device", predicate: "state", value: "off" }] });
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)?.sourceId).toBe(receipt.id);
});

test("missing effects in bounded current memory are unknown, not reconstructed from the old receipt", () => {
  const f = fixture(), fence = f.fence(); f.act();
  WorkingMemory.factsJson[f.actor] = JSON.stringify(getWorkingMemory(f.world, f.actor).facts.filter(fact => fact.subject !== f.key));
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("the request's stable identity prevents a same-named replacement from satisfying the old step", () => {
  const f = fixture(), fence = f.fence(); removeEntity(f.world, f.target);
  const replacement = createObjectEntity(f.world, { name: "Valve", roomId: f.room }); addComponent(f.world, replacement, ObjectState); ObjectState.current[replacement] = "open";
  const action = { type: "interact" as const, target: "Valve", content: "open" };
  f.advance(); const before = captureWorkingMemoryAction(f.world, f.actor, action); recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("unknown or ambiguous request-time names do not acquire identity from a later action", () => {
  const f = fixture();
  createObjectEntity(f.world, { name: "Valve", roomId: f.room }); f.advance(); captureWorkingMemoryObservation(f.world, f.actor);
  const fence = f.fence(); f.act();
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
  expect(resolvePlanActionEvidence(f.world, f.actor, { ...fence, knownEntities: [] }, f.step)).toBeUndefined();
});

test("actor ownership and malformed, future or missing fences fail closed", () => {
  const f = fixture(), fence = f.fence(); f.act();
  expect(resolvePlanActionEvidence(f.world, f.witness, fence, f.step)).toBeUndefined();
  for (const bad of [undefined, {} as any, { ...fence, capturedAt: Date.now() + 1 }, { ...fence, evidenceAfter: NaN }, { ...fence, receiptIds: [4] } as any]) {
    expect(resolvePlanActionEvidence(f.world, f.actor, bad, f.step)).toBeUndefined();
  }
  WorkingMemoryIdentity.id[f.actor] = "entity:replacement-actor";
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("typed action identity is copied privately and never attached to the witness's public receipt", () => {
  const f = fixture(); f.act("PRIVATE_PATH_CASE_SECRET");
  const own = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)!;
  expect(own.action).toEqual({ type: "interact", targetKey: f.key, content: "PRIVATE_PATH_CASE_SECRET" });
  const witness = getWorkingMemory(f.world, f.witness);
  expect(witness.receipts.some(r => r.kind === "action" && r.provenance === "witnessed_action")).toBe(true);
  expect(witness.receipts.every(r => r.action === undefined)).toBe(true);
  expect(JSON.stringify(witness)).not.toContain("PRIVATE_PATH_CASE_SECRET");
  own.action!.content = "mutated";
  expect(getWorkingMemory(f.world, f.actor).receipts.some(r => r.action?.content === "PRIVATE_PATH_CASE_SECRET")).toBe(true);
});

test("the evidence boundary rejects action metadata on observation or witness sources", () => {
  const f = fixture(); f.advance();
  for (const kind of ["observation", "action"] as const) expect(recordWorkingMemoryEvidence(f.world, f.actor, {
    id: `forged:${kind}`, atMs: Date.now(), kind, provenance: kind === "observation" ? "own_observation" : "witnessed_action",
    summary: "A heard command is not an own action.", facts: [], ...(kind === "action" ? { succeeded: true } : {}),
    action: { type: "interact", targetKey: f.key, content: "open" },
  })).toBe(false);
});

test("consumed or deleted targets at the actual execution boundary retain no reusable typed identity", () => {
  const f = fixture(), fence = f.fence();
  const action = { type: "interact" as const, target: "Valve", content: "open" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
  removeEntity(f.world, f.target); f.advance(); recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  const receipt = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)!;
  expect(receipt.action).toBeUndefined(); expect(receipt.facts).toEqual([]);
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, f.step)).toBeUndefined();
});

test("an exact read may reuse its own successful receipt, not an inferred result from the visible state alone", () => {
  const f = fixture(), fence = f.fence(); f.observe("projecting");
  const read = { ...f.step, content: "read" };
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, read)).toBeUndefined();
  const receipt = f.act("read", "projecting");
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, read)?.sourceId).toBe(receipt.id);
});

test("pickup reuse depends on the actual retained location effect; dropping it later invalidates it", () => {
  const f = fixture(), fence = f.fence();
  const action = { type: "pickup" as const, target: "Valve" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
  setLocatedIn(f.world, f.target, f.actor); f.advance(); recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  const step = { actionType: "pickup", target: "Valve" };
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, step)).toBeDefined();
  setLocatedIn(f.world, f.target, f.room); f.advance(); captureWorkingMemoryObservation(f.world, f.actor);
  expect(resolvePlanActionEvidence(f.world, f.actor, fence, step)).toBeUndefined();
});

test("multi-receipt effects do not grant multiple execution credits", () => {
  const f = fixture();
  const parts = Array.from({ length: 33 }, (_, i) => createObjectEntity(f.world, { name: `Part ${i}`, portable: true, roomId: f.room }));
  for (const part of parts) setLocatedIn(f.world, part, f.actor);
  const action = { type: "interact" as const, target: "Valve", content: "install" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
  for (const part of parts) setLocatedIn(f.world, part, f.target);
  f.advance(); recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  const receipts = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action");
  expect(receipts.length).toBeGreaterThan(1); expect(receipts.every(r => r.action === undefined)).toBe(true);
});
