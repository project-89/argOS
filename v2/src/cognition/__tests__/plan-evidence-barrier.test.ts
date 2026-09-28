import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { Agent, Name, ObjectState, Room, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { copyPlanWaitUntil, discardPlanEvidenceBarrier, evaluatePlanEvidenceBarrier, getPlanEvidenceBarrierTiming, issuePlanEvidenceBarrier, groundPlanEvidenceCondition, isVerifiedWaitResult,
  PLAN_EVIDENCE_BARRIER_LIMITS, type PlanWaitUntil } from "../plan-evidence-barrier";
import { getSocialDialogue, recordCommittedSpeech } from "../social-memory";
import { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation, consumeWorkingMemoryObservation } from "../working-memory-observation";

let now = 100_000;
beforeEach(() => {
  now = 100_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline evidence tests must not call a model"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture(offset = 0) {
  const world = createArgosWorld("Evidence barrier");
  // Component arrays are process-global; avoid overlapping indexes when two
  // independent worlds are intentionally alive in one adversarial test.
  for (let i = 0; i < offset; i++) addEntity(world);
  const entity = (label: string, parent?: number) => {
    const eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = label;
    if (parent !== undefined) setLocatedIn(world, eid, parent);
    return eid;
  };
  const room = entity("Room"), remote = entity("Elsewhere");
  addComponent(world, room, Room); addComponent(world, remote, Room);
  const actor = (label: string, parent = room) => {
    const eid = entity(label, parent); addComponent(world, eid, Agent); Agent.active[eid] = true;
    workingMemoryEntityRef(world, eid); return eid;
  };
  const ada = actor("Ada"), bo = actor("Bo"), away = actor("Remote", remote);
  const relay = entity("Relay", room), item = entity("Package", room);
  addComponent(world, relay, ObjectState); ObjectState.current[relay] = "off";
  captureWorkingMemoryObservation(world, ada);
  const subject = workingMemoryEntityRef(world, relay)!.key;
  const condition: PlanWaitUntil = { kind: "physical_fact", subject: "Relay", predicate: "state", slot: "ObjectState.current", equals: "on" };
  let serial = 0;
  const evidence = (value: string, atMs = now, eid = ada, id = `fixture:${++serial}`) => {
    const fact = { subject, subjectLabel: "Relay", predicate: "state" as const, slot: "ObjectState.current", value };
    expect(recordWorkingMemoryEvidence(world, eid, { id, atMs, kind: "observation", provenance: "visible_observation",
      summary: "Observed relay state.", facts: [fact] })).toBe(true);
    return id;
  };
  const issue = (c: unknown = condition, scope = "plan:1:step:2") => issuePlanEvidenceBarrier(world, ada, c, scope, now);
  const evaluate = (token: unknown, observation?: ReturnType<typeof captureWorkingMemoryObservation>) =>
    evaluatePlanEvidenceBarrier(world, ada, token, "plan:1:step:2", { nowMs: now, observation });
  return { world, entity, actor, room, remote, ada, bo, away, relay, item, subject, condition, evidence, issue, evaluate };
}

describe("strict typed wait schema", () => {
  test.each([undefined, null, "wait until the work is done", [], {}, { kind: "free_text", condition: "done" },
    { kind: "heard_evidence", condition: "the code has been read" }, { kind: "heard_evidence", all: [] },
    { kind: "physical_fact", subject: "Relay", predicate: "state", equals: "on", and: "the code is known" },
    { kind: "physical_fact", subject: 12, predicate: "state", equals: "on" },
    { kind: "physical_fact", subject: "Relay", predicate: "state", equals: true },
    { kind: "physical_fact", subject: "Relay", predicate: "component", equals: "on" },
    { kind: "physical_fact", subject: "Relay", predicate: "state", slot: {}, equals: "on" },
    { kind: "heard_evidence", speaker: " " }, { kind: "heard_evidence", speaker: [] },
  ])("rejects an unsupported or lossy condition: %j", input => { expect(copyPlanWaitUntil(input)).toBeUndefined(); });

  test.each([0, 999, 60_001, Infinity, NaN, "15000", null])("rejects invalid timeout %j", timeoutMs => {
    expect(copyPlanWaitUntil({ kind: "heard_evidence", timeoutMs })).toBeUndefined();
  });
  test.each([1_000, 15_000, 60_000])("accepts a bounded timeout %s", timeoutMs => {
    expect(copyPlanWaitUntil({ kind: "heard_evidence", timeoutMs })).toEqual({ kind: "heard_evidence", timeoutMs });
  });
  test("copies only typed values and permits absent optional fields", () => {
    const input = { kind: "physical_fact", subject: " Relay ", predicate: "state", equals: "on", slot: undefined };
    const copied = copyPlanWaitUntil(input);
    expect(copied).toEqual({ kind: "physical_fact", subject: "Relay", predicate: "state", equals: "on" });
    input.equals = "off"; expect(copied).toHaveProperty("equals", "on");
  });
});

test("old matching memory is not current proof; a newly admitted same-value observation is", () => {
  const f = fixture(); now += 1; f.evidence("on");
  const token = f.issue()!; expect(token).toBeDefined();
  expect(f.evaluate(token)).toEqual({ status: "waiting", deadlineMs: now + 15_000 });
  now += 1; const source = f.evidence("on");
  expect(f.evaluate(token)).toEqual({ status: "satisfied", sourceIds: [source] });
  expect(f.evaluate(token)).toMatchObject({ status: "reconsider", reason: "invalid_barrier" });
});

test("wait proof cannot be copied, retargeted, or edited into authority", () => {
  const f = fixture(), token = f.issue(); now += 1000; f.evidence("on");
  const result = f.evaluate(token), grounded = groundPlanEvidenceCondition(f.world, f.ada, f.condition);
  expect(grounded).toHaveProperty("condition"); if ("issue" in grounded) throw new Error(grounded.issue);
  expect(isVerifiedWaitResult(f.world, f.ada, result, "plan:1:step:2", grounded.condition)).toBe(true);
  expect(isVerifiedWaitResult(f.world, f.ada, structuredClone(result), "plan:1:step:2", grounded.condition)).toBe(false);
  expect(isVerifiedWaitResult(f.world, f.bo, result, "plan:1:step:2", grounded.condition)).toBe(false);
  expect(isVerifiedWaitResult(f.world, f.ada, result, "another-wait", grounded.condition)).toBe(false);
  if (result.status === "satisfied") result.sourceIds.push("fabricated");
  expect(isVerifiedWaitResult(f.world, f.ada, result, "plan:1:step:2", grounded.condition)).toBe(false);
});

test("a distinct same-millisecond event is admissible but an issuance source is not", () => {
  const f = fixture(); now += 1; f.evidence("off", now, f.ada, "old");
  const token = f.issue()!;
  expect(f.evaluate(token).status).toBe("waiting");
  // Give the new event a different timestamp only on the slot's actual change;
  // issuance and completion still share exactly one wall-clock millisecond.
  f.evidence("on", now + 0.001, f.ada, "new");
  expect(f.evaluate(token)).toEqual({ status: "satisfied", sourceIds: ["new"] });
});

test("same-time same-value reconfirmation qualifies only under a genuinely new source identity", () => {
  const f = fixture(); now += 1; f.evidence("on", now, f.ada, "a-old");
  const token = f.issue();
  expect(f.evaluate(token).status).toBe("waiting");
  expect(recordWorkingMemoryEvidence(f.world, f.ada, { id: "a-old", atMs: now + 1, kind: "observation", provenance: "visible_observation",
    summary: "Attempted replay.", facts: [{ subject: f.subject, predicate: "state", slot: "ObjectState.current", value: "on" }] })).toBe(false);
  expect(f.evaluate(token).status).toBe("waiting");
  f.evidence("on", now, f.ada, "z-new");
  expect(f.evaluate(token)).toEqual({ status: "satisfied", sourceIds: ["z-new"] });
});

test("failed action proposals do not provide proof", () => {
  const f = fixture(), token = f.issue(); now += 1;
  expect(recordWorkingMemoryEvidence(f.world, f.ada, { id: "failed", atMs: now, kind: "action", provenance: "own_action",
    summary: "Requested power on, but action failed.", succeeded: false,
    facts: [{ subject: f.subject, predicate: "state", slot: "ObjectState.current", value: "on" }] })).toBe(true);
  expect(f.evaluate(token).status).toBe("waiting");
});

test("newest contradiction wins over an earlier successful observation", () => {
  const f = fixture(), token = f.issue(); now += 1; f.evidence("on"); now += 1; f.evidence("off");
  expect(f.evaluate(token).status).toBe("waiting");
});

test("contradictory equal-time evidence fails closed regardless of source-ID tie break", () => {
  const f = fixture(), token = f.issue(); now += 1;
  f.evidence("off", now, f.ada, "a-off"); f.evidence("on", now, f.ada, "z-on");
  expect(getWorkingMemory(f.world, f.ada).facts.find(fact => fact.subject === f.subject && fact.predicate === "state")?.value).toBe("on");
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "conflicting_evidence", sourceIds: ["z-on", "a-off"] });
});

test("private facts in another actor's memory and unseen world changes do not advance a wait", () => {
  const f = fixture(), token = f.issue(); now += 1;
  ObjectState.current[f.relay] = "on"; f.evidence("on", now, f.bo);
  expect(f.evaluate(token).status).toBe("waiting");
  setLocatedIn(f.world, f.ada, f.remote);
  expect(f.evaluate(token, captureWorkingMemoryObservation(f.world, f.ada)).status).toBe("waiting");
});

test("a genuine fresh local snapshot proves an already-true condition without ledger refresh", () => {
  const f = fixture(); now += 1; ObjectState.current[f.relay] = "on";
  captureWorkingMemoryObservation(f.world, f.ada);
  const before = getWorkingMemory(f.world, f.ada), token = f.issue();
  expect(f.evaluate(token).status).toBe("waiting");
  const observation = captureWorkingMemoryObservation(f.world, f.ada)!;
  expect(getWorkingMemory(f.world, f.ada)).toEqual(before);
  expect(f.evaluate(token, observation)).toEqual({ status: "satisfied", sourceIds: [observation.facts[0].sourceId] });
  expect(getWorkingMemory(f.world, f.ada)).toEqual(before);
});

test("a pre-issuance snapshot cannot bypass the fence through its synthetic future timestamp", () => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const old = captureWorkingMemoryObservation(f.world, f.ada)!;
  expect(old.observedAt).toBeGreaterThan(now);
  const token = f.issue();
  expect(f.evaluate(token, old).status).toBe("waiting");
  expect(f.evaluate(token, captureWorkingMemoryObservation(f.world, f.ada)).status).toBe("satisfied");
});

test.each(["clone", "other_actor", "other_world", "already_consumed", "superseded"])("unverified snapshot (%s) cannot refresh stale knowledge", mode => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const token = f.issue();
  let snapshot = captureWorkingMemoryObservation(f.world, f.ada)!;
  if (mode === "clone") snapshot = JSON.parse(JSON.stringify(snapshot));
  if (mode === "other_actor") snapshot = captureWorkingMemoryObservation(f.world, f.bo)!;
  if (mode === "other_world") { const other = fixture(100); snapshot = captureWorkingMemoryObservation(other.world, other.ada)!; }
  if (mode === "already_consumed") consumeWorkingMemoryObservation(f.world, f.ada, snapshot);
  if (mode === "superseded") captureWorkingMemoryObservation(f.world, f.ada);
  expect(f.evaluate(token, snapshot).status).toBe("waiting");
});

test("a snapshot cannot be retained past its synchronous sensing pass", async () => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const token = f.issue(), observation = captureWorkingMemoryObservation(f.world, f.ada);
  await Promise.resolve();
  expect(f.evaluate(token, observation).status).toBe("waiting");
});

test("a fresh snapshot cannot resurrect an older matching fact over a newer contradictory source", () => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const token = f.issue(), observation = captureWorkingMemoryObservation(f.world, f.ada);
  now += 1; f.evidence("off");
  expect(f.evaluate(token, observation).status).toBe("waiting");
});

test("equal-time snapshot and ledger disagreement causes reconsideration", () => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const token = f.issue(), observation = captureWorkingMemoryObservation(f.world, f.ada)!;
  f.evidence("off", observation.observedAt);
  expect(f.evaluate(token, observation)).toMatchObject({ status: "reconsider", reason: "conflicting_evidence" });
});

test("a newer contradictory receipt still blocks an older snapshot after its current fact is evicted", () => {
  const f = fixture(); ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.ada);
  const token = f.issue(), observation = captureWorkingMemoryObservation(f.world, f.ada)!;
  now += 1; f.evidence("off"); now += 1;
  for (let index = 0; index < 65; index++) expect(recordWorkingMemoryEvidence(f.world, f.ada, {
    id: `crowd:${index}`, atMs: now, kind: "observation", provenance: "visible_observation", summary: "An unrelated observed state.",
    facts: [{ subject: `entity:unrelated:${index}`, predicate: "state", slot: "status", value: "seen" }],
  })).toBe(true);
  const memory = getWorkingMemory(f.world, f.ada);
  expect(memory.facts.some(fact => fact.subject === f.subject)).toBe(false);
  expect(memory.receipts.some(receipt => receipt.facts.some(fact => fact.subject === f.subject && fact.value === "off"))).toBe(true);
  expect(f.evaluate(token, observation).status).toBe("waiting");
});

test("blind sensing does not refresh a last-seen remote object", () => {
  const f = fixture(); now += 1; f.evidence("on"); const token = f.issue();
  addComponent(f.world, f.ada, Traits); Traits.active[f.ada] = '["blind"]';
  expect(f.evaluate(token, captureWorkingMemoryObservation(f.world, f.ada)).status).toBe("waiting");
});

test("the exact deadline requests reconsideration, never success, even if proof arrives late", () => {
  const f = fixture(), token = f.issue({ ...f.condition, timeoutMs: 1_000 });
  now += 999; expect(f.evaluate(token).status).toBe("waiting");
  now += 1; f.evidence("on");
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "timeout", sourceIds: [] });
  expect(f.evaluate(token)).toMatchObject({ status: "reconsider", reason: "invalid_barrier" });
});

test.each([NaN, Infinity, -1, 99_999])("invalid or reversed clock %s cannot fulfill a wait", timestamp => {
  const f = fixture(), token = f.issue();
  expect(evaluatePlanEvidenceBarrier(f.world, f.ada, token, "plan:1:step:2", { nowMs: timestamp }))
    .toMatchObject({ status: "reconsider", reason: "clock_invalid" });
});

test("hearing 'done' wakes cognition but cannot certify a free-form condition or advance a plan", () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.bo, "Done already.");
  const token = f.issue({ kind: "heard_evidence", speaker: " bo " });
  expect(f.evaluate(token).status).toBe("waiting");
  const event = recordCommittedSpeech(f.world, f.bo, "The work is done. The code was read. Go ahead!")!;
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "new_heard_evidence", sourceIds: [event.id] });
});

test("new speech at a physical wait requests reconsideration without claiming the requested state", () => {
  const f = fixture(), token = f.issue();
  const event = recordCommittedSpeech(f.world, f.bo, "I turned the relay on.")!;
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "new_heard_evidence", sourceIds: [event.id] });
  expect(getWorkingMemory(f.world, f.ada).facts.find(fact => fact.subject === f.subject && fact.predicate === "state")?.value).toBe("off");
});

test("actual physical proof remains sufficient when it accompanies an independently heard claim", () => {
  const f = fixture(), token = f.issue(); now += 1;
  const source = f.evidence("on"); recordCommittedSpeech(f.world, f.bo, "I switched it on.");
  expect(f.evaluate(token)).toEqual({ status: "satisfied", sourceIds: [source] });
});

test("own speech, remote speech, an unrelated speaker, and deafness do not satisfy a heard wait", () => {
  const f = fixture(), token = f.issue({ kind: "heard_evidence", speaker: "Bo" });
  recordCommittedSpeech(f.world, f.ada, "Done."); recordCommittedSpeech(f.world, f.away, "Done.");
  const other = f.actor("Other"); recordCommittedSpeech(f.world, other, "Done.");
  expect(f.evaluate(token).status).toBe("waiting");
  addComponent(f.world, f.ada, Traits); Traits.active[f.ada] = '["deaf"]';
  recordCommittedSpeech(f.world, f.bo, "Done."); expect(f.evaluate(token).status).toBe("waiting");
});

test("issuance binds copied physical fields and never follows later input mutations", () => {
  const f = fixture(), condition = { ...f.condition }, token = f.issue(condition)!;
  Object.assign(condition, { equals: "off", subject: "Elsewhere", timeoutMs: 1_000 });
  expect(Object.isFrozen(token)).toBe(true);
  expect(f.evaluate(token).status).toBe("waiting");
  now += 1; f.evidence("on"); expect(f.evaluate(token).status).toBe("satisfied");
});

test("subject and slot ambiguity are rejected instead of taking the first matching label", () => {
  const f = fixture(), duplicate = f.entity("Relay", f.room);
  addComponent(f.world, duplicate, ObjectState); ObjectState.current[duplicate] = "off";
  captureWorkingMemoryObservation(f.world, f.ada);
  expect(f.issue()).toBeUndefined();
  expect(f.issue({ ...f.condition, subject: f.subject })).toBeDefined();
  now += 1;
  expect(recordWorkingMemoryEvidence(f.world, f.ada, { id: "second-slot", atMs: now, kind: "observation", provenance: "visible_observation",
    summary: "Observed indicator.", facts: [{ subject: f.subject, predicate: "state", slot: "indicator", value: "on" }] })).toBe(true);
  expect(f.issue({ ...f.condition, subject: f.subject, slot: undefined })).toBeUndefined();
});

test("unknown subjects, unknown slots, and semantic inspection text cannot acquire a barrier", () => {
  const f = fixture();
  expect(f.issue({ ...f.condition, subject: "A hidden device" })).toBeUndefined();
  expect(f.issue({ ...f.condition, slot: "Hidden.privateCode" })).toBeUndefined();
  now += 1;
  expect(recordWorkingMemoryEvidence(f.world, f.ada, { id: "inspection", atMs: now, kind: "observation", provenance: "own_observation",
    summary: "A written clue.", facts: [{ subject: f.subject, predicate: "state", slot: "Inspection.result", value: "The job is done." }] })).toBe(true);
  expect(f.issue({ ...f.condition, slot: "Inspection.result", equals: "The job is done." })).toBeUndefined();
});

test("location binds an actor-known stable destination and cannot confuse same-name holders", () => {
  const f = fixture(), adaRef = workingMemoryEntityRef(f.world, f.ada)!;
  const condition = { kind: "physical_fact", subject: "Package", predicate: "location", equals: "Ada" };
  const token = f.issue(condition); expect(token).toBeDefined();
  expect(f.issue({ ...condition, equals: "Hidden destination" })).toBeUndefined();
  const duplicate = f.actor("Ada"); captureWorkingMemoryObservation(f.world, f.ada);
  expect(f.issue(condition)).toBeUndefined();
  setLocatedIn(f.world, f.item, duplicate);
  expect(f.evaluate(token, captureWorkingMemoryObservation(f.world, f.ada)).status).toBe("waiting");
  setLocatedIn(f.world, f.item, f.ada);
  const observation = captureWorkingMemoryObservation(f.world, f.ada);
  expect(observation?.facts.find(fact => fact.subjectLabel === "Package" && fact.predicate === "location")?.value).toBe(adaRef.key);
  expect(f.evaluate(token, observation).status).toBe("satisfied");
});

test("world, actor, stable identity, and plan-step scope fences survive serializing a token", () => {
  const f = fixture(), token = JSON.parse(JSON.stringify(f.issue()));
  const other = fixture(100);
  expect(evaluatePlanEvidenceBarrier(other.world, other.ada, token, "plan:1:step:2").status).toBe("reconsider");
  expect(evaluatePlanEvidenceBarrier(f.world, f.bo, token, "plan:1:step:2").status).toBe("reconsider");
  expect(evaluatePlanEvidenceBarrier(f.world, f.ada, token, "plan:2:step:2").status).toBe("reconsider");
  expect(evaluatePlanEvidenceBarrier(f.world, f.ada, token, "plan:1:step:3").status).toBe("reconsider");
  // Invalid callers cannot consume the real owner's still-valid token.
  expect(f.evaluate(token).status).toBe("waiting");
  WorkingMemoryIdentity.id[f.ada] = "entity:replacement";
  expect(f.evaluate(token)).toMatchObject({ status: "reconsider", reason: "invalid_barrier" });
});

test.each(["removed", "inactive"])("a %s actor cannot evaluate a token", state => {
  const f = fixture(), token = f.issue();
  if (state === "removed") removeEntity(f.world, f.ada); else Agent.active[f.ada] = false;
  expect(f.evaluate(token)).toMatchObject({ status: "reconsider", reason: "invalid_barrier" });
});

test("explicit retirement is owner-scoped and replay-proof", () => {
  const f = fixture(), token = f.issue();
  expect(discardPlanEvidenceBarrier(f.world, f.bo, token, "plan:1:step:2")).toBe(false);
  expect(discardPlanEvidenceBarrier(f.world, f.ada, token, "wrong-step")).toBe(false);
  expect(discardPlanEvidenceBarrier(f.world, f.ada, token, "plan:1:step:2")).toBe(true);
  expect(discardPlanEvidenceBarrier(f.world, f.ada, token, "plan:1:step:2")).toBe(false);
  expect(f.evaluate(token).status).toBe("reconsider");
});

test("abandoned barriers are bounded per actor without evicting another actor's current wait", () => {
  const f = fixture(), first = f.issue({ kind: "heard_evidence" });
  const other = issuePlanEvidenceBarrier(f.world, f.bo, { kind: "heard_evidence" }, "other");
  let latest = first;
  for (let i = 0; i < PLAN_EVIDENCE_BARRIER_LIMITS.perActor; i++) latest = f.issue({ kind: "heard_evidence" });
  expect(f.evaluate(first).status).toBe("reconsider");
  expect(f.evaluate(latest).status).toBe("waiting");
  expect(evaluatePlanEvidenceBarrier(f.world, f.bo, other, "other").status).toBe("waiting");
});

test("new issuance preserves the owner's explicit timeout, without reviving an expired token", () => {
  const f = fixture(), expired = f.issue({ kind: "heard_evidence", timeoutMs: 1_000 });
  now += 1_000; const current = f.issue({ kind: "heard_evidence" });
  expect(f.evaluate(expired)).toMatchObject({ status: "reconsider", reason: "timeout" });
  expect(f.evaluate(expired)).toMatchObject({ status: "reconsider", reason: "invalid_barrier" });
  expect(f.evaluate(current).status).toBe("waiting");
});

test("another actor's issuance cannot sweep away an expired owner's timeout", () => {
  const f = fixture(), token = f.issue({ kind: "heard_evidence", timeoutMs: 1_000 }); now += 1_000;
  for (let i = 0; i < PLAN_EVIDENCE_BARRIER_LIMITS.perActor * 2; i++) {
    issuePlanEvidenceBarrier(f.world, f.bo, { kind: "heard_evidence" }, `bo:${i}`, now);
  }
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "timeout", sourceIds: [] });
  expect(f.evaluate(token)).toMatchObject({ reason: "invalid_barrier" });
});

test("expired retained tokens still count toward the bounded per-owner capacity", () => {
  const f = fixture(), first = f.issue({ kind: "heard_evidence", timeoutMs: 1_000 }); now += 1_000;
  for (let i = 0; i < PLAN_EVIDENCE_BARRIER_LIMITS.perActor; i++) f.issue({ kind: "heard_evidence", timeoutMs: 1_000 }, `other:${i}`);
  expect(f.evaluate(first)).toMatchObject({ reason: "invalid_barrier" });
});

test("default wait deadlines follow simulation elapsed time, not model latency or a paused wall clock", () => {
  const f = fixture();
  const token = issuePlanEvidenceBarrier(f.world, f.ada, { kind: "heard_evidence", timeoutMs: 1_000 }, "sim-wait");
  const evaluate = () => evaluatePlanEvidenceBarrier(f.world, f.ada, token, "sim-wait");
  expect(evaluate()).toEqual({ status: "waiting", deadlineMs: 1_000 });
  now += 60_000; expect(evaluate()).toEqual({ status: "waiting", deadlineMs: 1_000 });
  advanceSimulationTime(f.world, 1, 999); expect(evaluate().status).toBe("waiting");
  advanceSimulationTime(f.world, 2, 1);
  expect(evaluate()).toEqual({ status: "reconsider", reason: "timeout", sourceIds: [] });
});

test("simulation deadlines keep fresh evidence and heard speech in their separate wall-time domain", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 5_000);
  const physical = issuePlanEvidenceBarrier(f.world, f.ada, f.condition, "sim-physical");
  const heard = issuePlanEvidenceBarrier(f.world, f.ada, { kind: "heard_evidence", speaker: "Bo" }, "sim-heard");
  now += 3_000;
  const source = f.evidence("on"); const speech = recordCommittedSpeech(f.world, f.bo, "It is ready.")!;
  expect(evaluatePlanEvidenceBarrier(f.world, f.ada, physical, "sim-physical")).toEqual({ status: "satisfied", sourceIds: [source] });
  expect(evaluatePlanEvidenceBarrier(f.world, f.ada, heard, "sim-heard"))
    .toEqual({ status: "reconsider", reason: "new_heard_evidence", sourceIds: [speech.id] });
});

test("deadline readiness is a pure owner-scoped peek, including at the exact timeout", () => {
  const f = fixture(), token = f.issue({ kind: "heard_evidence", timeoutMs: 1_000 });
  const memory = getWorkingMemory(f.world, f.ada); now += 1_000;
  expect(getPlanEvidenceBarrierTiming(f.world, f.bo, token, "plan:1:step:2", { nowMs: now })).toBeUndefined();
  for (let i = 0; i < 10; i++) expect(getPlanEvidenceBarrierTiming(f.world, f.ada, token, "plan:1:step:2", { nowMs: now }))
    .toEqual({ deadlineMs: now, nowMs: now, clock: "explicit", clockInvalid: false });
  expect(getWorkingMemory(f.world, f.ada)).toEqual(memory);
  expect(f.evaluate(token)).toEqual({ status: "reconsider", reason: "timeout", sourceIds: [] });
});

test("helper evaluation is read-only for NPC memories and physical world state", () => {
  const f = fixture(), token = f.issue();
  const memory = getWorkingMemory(f.world, f.ada), dialogue = getSocialDialogue(f.world, f.ada);
  for (let i = 0; i < 10; i++) expect(f.evaluate(token).status).toBe("waiting");
  expect(getWorkingMemory(f.world, f.ada)).toEqual(memory); expect(getSocialDialogue(f.world, f.ada)).toEqual(dialogue);
  expect(ObjectState.current[f.relay]).toBe("off");
});
