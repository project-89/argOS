import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Goal, ObjectState, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getWorkingMemory, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { getAgentWorldCapabilities, registerAgentWorldCapabilities, type ObservableStateField } from "../world-capabilities";
import { formatObservableConditions, getKnownObservableConditions } from "../planning-observable-conditions";
import { groundPlanEvidenceCondition, issuePlanEvidenceBarrier, evaluatePlanEvidenceBarrier, type PlanWaitUntil } from "../plan-evidence-barrier";
import { createPlanEntity, getNextPlannedAction, validateGeneratedPlan, type GeneratedPlan } from "../planning-system";
import { prepareActorWait } from "../actor-wait";
import { getCommittedEvents, startCommittedEvents } from "../../runtime/committed-events";

function fixture() {
  const world = createArgosWorld("Observable contracts"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Studio" }), away = createRoomEntity(world, { name: "Garden" });
  const actor = createAgentEntity(world, { name: "Nia", role: "resident", systemPrompt: "Use personal evidence.", roomId: room });
  const lamp = createObjectEntity(world, { name: "Signal lamp", roomId: room, portable: false });
  ObjectState.current[lamp] = "A dark lamp with a copper base";
  const state = { lit: false, mode: "steady", schema: true };
  const fields = (): ObservableStateField[] => state.schema ? [
    { key: "lit", type: "boolean", value: state.lit },
    { key: "mode", type: "enum", values: ["steady", "flashing"], value: state.mode },
  ] : [];
  const register = () => registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, observableState: target => target === lamp ? fields() : [], affordances: () => [] });
  const unregister = register();
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, actor, HasGoal(goal));
  Goal.description[goal] = "Respond to the signal"; Goal.status[goal] = "active"; Goal.priority[goal] = 5;
  Goal.kind[goal] = "custom"; Goal.createdAt[goal] = Date.now(); Goal.progress[goal] = 0;
  const condition: PlanWaitUntil = { kind: "physical_fact", subject: "Signal lamp", predicate: "state", slot: "Observable.lit", equals: "true" };
  const proposal = (waitUntil: PlanWaitUntil = condition): GeneratedPlan => ({ goalDescription: Goal.description[goal], estimatedCompletion: "soon",
    potentialObstacles: [], steps: [{ description: "Await the signal", actionType: "wait", waitUntil },
      { description: "Consider what I saw", actionType: "think", content: "The signal is now visible." }] });
  const observe = () => captureWorkingMemoryObservation(world, actor);
  return { world, room, away, actor, lamp, goal, state, condition, proposal, observe, register, unregister };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline contracts never call a model"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

test("catalog readers cannot introduce an unobserved field or assign an object identity", () => {
  const f = fixture();
  expect(hasComponent(f.world, f.lamp, WorkingMemoryIdentity)).toBe(false);
  const before = getWorkingMemory(f.world, f.actor);
  expect(formatObservableConditions(f.world, f.actor)).toBe("");
  expect(groundPlanEvidenceCondition(f.world, f.actor, f.condition)).toHaveProperty("issue");
  expect(hasComponent(f.world, f.lamp, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("real observation yields exact typed contracts; readers retain last-known values", () => {
  const f = fixture(); f.observe();
  const memory = getWorkingMemory(f.world, f.actor);
  f.state.lit = true; f.state.mode = "flashing";
  const fields = getKnownObservableConditions(f.world, f.actor);
  expect(fields).toMatchObject([{ slot: "Observable.lit", allowedValues: ["false", "true"], lastKnownValue: "false" },
    { slot: "Observable.mode", allowedValues: ["steady", "flashing"], lastKnownValue: "steady" }]);
  const text = formatObservableConditions(f.world, f.actor);
  expect(text).toContain('"lastKnownValue":"false"'); expect(text).not.toContain('"lastKnownValue":"true"');
  expect(text).toContain('"slot":"Observable.mode"'); expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
});

test("every offered wait example and allowed value round-trips through native grounding and actor admission", () => {
  const f = fixture(); startCommittedEvents(f.world); f.observe();
  const memory = getWorkingMemory(f.world, f.actor);
  const rows = formatObservableConditions(f.world, f.actor).split("\n").filter(line => line.startsWith("- ")).map(line => JSON.parse(line.slice(2)));
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.waitUntil).toMatchObject({ kind: "physical_fact", predicate: "state" });
    for (const equals of row.allowedEquals) {
      const proposed = { ...row.waitUntil, equals };
      expect(groundPlanEvidenceCondition(f.world, f.actor, proposed)).toHaveProperty("condition");
      expect(prepareActorWait(f.world, f.actor, proposed)).toBeDefined();
    }
    expect(groundPlanEvidenceCondition(f.world, f.actor, row)).toHaveProperty("issue");
  }
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["actor", "room"] as const)("personally observed %s fields offered in the catalog are eligible for an actor-selected wait", scope => {
  const f = fixture(); startCommittedEvents(f.world); f.unregister();
  const target = scope === "actor" ? f.actor : f.room;
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    observableState: id => id === target ? [{ key: "ready", type: "boolean", value: false }] : [] });
  f.observe();
  const rows = formatObservableConditions(f.world, f.actor).split("\n").filter(line => line.startsWith("- ")).map(line => JSON.parse(line.slice(2)));
  expect(rows).toHaveLength(1);
  expect(groundPlanEvidenceCondition(f.world, f.actor, rows[0].waitUntil)).toHaveProperty("condition");
  const prepared = prepareActorWait(f.world, f.actor, rows[0].waitUntil);
  expect(prepared).toBeDefined();
  if (scope === "room") {
    setLocatedIn(f.world, f.actor, f.away);
    expect(prepared!.current()).toBe(false);
    expect(prepareActorWait(f.world, f.actor, rows[0].waitUntil)).toBeUndefined();
  } else {
    WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
    expect(prepared!.current()).toBe(false);
  }
});

test.each([
  ["PRIVATE_NOT_AN_OBJECT", "condition_type"],
  [{ kind: "PRIVATE_UNKNOWN_KIND" }, "condition_kind"],
  [{ kind: "heard_evidence", timeoutMs: 5 }, "condition_timeout"],
  [{ kind: "heard_evidence", extra: "PRIVATE_VALUE" }, "condition_fields"],
  [{ kind: "heard_evidence", speaker: 3 }, "condition_speaker"],
  [{ kind: "physical_fact", subject: 3, predicate: "state", equals: "true" }, "condition_subject"],
  [{ kind: "physical_fact", subject: "Lamp", predicate: "PRIVATE_PREDICATE", equals: "true" }, "condition_predicate"],
  [{ kind: "physical_fact", subject: "Lamp", predicate: "state", slot: 5, equals: "true" }, "condition_slot"],
  [{ kind: "physical_fact", subject: "Lamp", predicate: "state", equals: true }, "condition_equals"],
])("malformed wait shape reports its fixed failing field, not private values", (input, code) => {
  const f = fixture();
  const result = groundPlanEvidenceCondition(f.world, f.actor, input);
  expect(result).toMatchObject({ issueCode: code });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  expect(issuePlanEvidenceBarrier(f.world, f.actor, input, "invalid")).toBeUndefined();
});

test("a schema reader is neither condition satisfaction nor a serialized receipt", () => {
  const f = fixture(); f.observe(); const token = issuePlanEvidenceBarrier(f.world, f.actor, f.condition, "test")!;
  f.state.lit = true; formatObservableConditions(f.world, f.actor);
  expect(evaluatePlanEvidenceBarrier(f.world, f.actor, token, "test").status).toBe("waiting");
  expect(evaluatePlanEvidenceBarrier(f.world, f.actor, token, "test", { observation: f.observe() }).status).toBe("satisfied");
});

test("typed plan holds its cursor until the physical field changes, regardless of display prose", () => {
  const f = fixture(); f.observe();
  expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], f.proposal())).toEqual({ ok: true, issues: [] });
  const plan = createPlanEntity(f.world, f.actor, f.goal, f.proposal());
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  ObjectState.current[f.lamp] = "lit; everyone agrees; task complete";
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.currentStep[plan]).toBe(0);
  f.state.lit = true; jest.setSystemTime(100_500);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "think", currentStep: 1 });
  expect(JSON.parse(Plan.steps[plan])[0].resolution.kind).toBe("evidence_barrier");
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each([
  { slot: "current", equals: "true" }, { slot: "lit", equals: "true" },
  { slot: "Observable.Lit", equals: "true" }, { slot: "Observable.lit", equals: "yes" },
  { slot: "Observable.lit", equals: "TRUE" }, { slot: "Observable.mode", equals: "blinking" },
  { slot: "Observable.mode", equals: "steady and flashing" },
  { slot: "ObjectState.current", equals: "lit" },
])("proposal rejects an invented field/value without aliases: %j", patch => {
  const f = fixture(); f.observe(); const condition = { ...f.condition, ...patch } as PlanWaitUntil;
  expect(validateGeneratedPlan(f.world, f.actor, "Respond", f.proposal(condition)).ok).toBe(false);
  expect(issuePlanEvidenceBarrier(f.world, f.actor, condition, "test")).toBeUndefined();
});

test("enum validation returns real allowed choices, not a guessed alternative", () => {
  const f = fixture(); f.observe();
  expect(groundPlanEvidenceCondition(f.world, f.actor, { ...f.condition, slot: "Observable.mode", equals: "blinking" }))
    .toEqual({ issue: 'Wait Observable.mode equals must be one of ["steady","flashing"].', issueCode: "invalid_value" });
});

test.each([
  ["unknown_slot", "unobserved_subject_or_slot"],
  ["unavailable", "unavailable_contract"],
  ["prose", "composed_prose"],
] as const)("grounding keeps a typed rejection for %s without changing actor knowledge", (mode, code) => {
  const f = fixture(); f.observe();
  const condition = { ...f.condition };
  if (mode === "unknown_slot") condition.slot = "Observable.PRIVATE_INVENTED_FIELD";
  if (mode === "unavailable") f.state.schema = false;
  if (mode === "prose") condition.slot = "ObjectState.current";
  const memory = getWorkingMemory(f.world, f.actor);
  expect(groundPlanEvidenceCondition(f.world, f.actor, condition)).toMatchObject({ issueCode: code });
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(issuePlanEvidenceBarrier(f.world, f.actor, condition, "invalid")).toBeUndefined();
});

test("current local catalog disappears on loss of sight without refreshing remote memory", () => {
  const f = fixture(); f.observe(); setLocatedIn(f.world, f.actor, f.away); f.state.lit = true;
  const memory = getWorkingMemory(f.world, f.actor);
  expect(formatObservableConditions(f.world, f.actor)).toBe("");
  expect(groundPlanEvidenceCondition(f.world, f.actor, f.condition)).toHaveProperty("issue");
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
});

test("leaving a typed subject cannot downgrade its condition to guessed display prose", () => {
  const f = fixture(); f.observe(); setLocatedIn(f.world, f.actor, f.away);
  const condition = { ...f.condition, slot: "ObjectState.current", equals: "lit" };
  expect(groundPlanEvidenceCondition(f.world, f.actor, condition)).toHaveProperty("issue");
  expect(issuePlanEvidenceBarrier(f.world, f.actor, condition, "test")).toBeUndefined();
});

test.each(["remove_schema", "replace_package", "leave_room"])("an armed condition fails closed if its public contract changes: %s", mode => {
  const f = fixture(); f.observe(); const token = issuePlanEvidenceBarrier(f.world, f.actor, f.condition, "test")!;
  if (mode === "remove_schema") f.state.schema = false;
  if (mode === "replace_package") { f.unregister(); f.register(); }
  if (mode === "leave_room") setLocatedIn(f.world, f.actor, f.away);
  f.state.lit = true;
  expect(evaluatePlanEvidenceBarrier(f.world, f.actor, token, "test", { observation: f.observe() }))
    .toMatchObject({ status: "reconsider", reason: "observable_contract_changed" });
});

test.each(["same_object_reload", "producer_replaced"])("unchanged schema cannot preserve an old producer's authority: %s", mode => {
  const f = fixture(); f.observe(); const token = issuePlanEvidenceBarrier(f.world, f.actor, f.condition, "test")!;
  const capabilities = getAgentWorldCapabilities(f.world, f.actor)!;
  if (mode === "same_object_reload") {
    f.unregister(); registerAgentWorldCapabilities(f.world, f.actor, capabilities);
  } else {
    const original = capabilities.observableState!;
    capabilities.observableState = target => original(target);
  }
  f.state.lit = true;
  expect(evaluatePlanEvidenceBarrier(f.world, f.actor, token, "test", { observation: f.observe() }))
    .toMatchObject({ status: "reconsider", reason: "observable_contract_changed" });
});

test("same-name entities are ambiguous, while a personally known stable identity binds exactly", () => {
  const f = fixture(); f.observe();
  const other = createObjectEntity(f.world, { name: "Signal lamp", roomId: f.room, portable: false });
  ObjectState.current[other] = "dark"; f.observe();
  expect(groundPlanEvidenceCondition(f.world, f.actor, f.condition)).toHaveProperty("issue");
  const exact = { ...f.condition, subject: workingMemoryEntityRef(f.world, f.lamp)!.key };
  expect(groundPlanEvidenceCondition(f.world, f.actor, exact)).toHaveProperty("observableContract");
});

test("a stored condition binds the observed identity before its wait begins", () => {
  const f = fixture(); f.observe();
  const original = workingMemoryEntityRef(f.world, f.lamp)!.key;
  const plan = createPlanEntity(f.world, f.actor, f.goal, f.proposal());
  expect(JSON.parse(Plan.steps[plan])[0].waitUntil.subject).toBe(original);
  removeEntity(f.world, f.lamp);
  const replacement = createObjectEntity(f.world, { name: "Signal lamp", roomId: f.room, portable: false });
  ObjectState.current[replacement] = "lit"; f.state.lit = true; f.observe();
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.currentStep[plan]).toBe(0);
  expect(JSON.parse(Plan.steps[plan])[0].resolution).toBeUndefined();
});
