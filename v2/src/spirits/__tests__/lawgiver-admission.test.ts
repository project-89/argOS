import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { initializeRegistry, registryCreateComponent } = await import("../../ecs/component-registry");
const { addComponent } = await import("bitecs");
const { createSpiritRegistry } = await import("../spirit-registry");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { ObjectManager } = await import("../../world/object-manager");
const { RulesEngine } = await import("../../world/rules-engine");
const { worldSchema, WorldSchema } = await import("../../world/schema");
const { canExecuteRule } = await import("../../world/runtime-rule-scope");
const { requestRule, generateRuleProposal, approveRule, runLawgiverCycle, resetLawgiverState, getLawgiverState } = await import("../rules-spirit");

const name = "lawgiver_admission_fixture";
const spec = () => ({ name, description: "Mark a selected object", trigger: "tick", priority: 0,
  condition: { has: ["gate_selected"] }, effects: [{ action: "add_trait", target: "self", params: { trait: "gate_marked" } }] });
function fixture(start = true) {
  const world = createArgosWorld("Lawgiver boundary"); initializeRegistry(world); initializePrefabs(world);
  if (start) startCommittedEvents(world);
  const registry = createSpiritRegistry(world), objects = new ObjectManager(world), engine = new RulesEngine(world, objects);
  const object = objects.spawn("object", { name: "Gate object" })!; objects.addTrait(object, "gate_selected");
  const request = () => requestRule("Mark this world's selected objects", { desiredBehavior: "A real local effect" }, "test", world);
  return { world, registry, objects, engine, object, request };
}
async function proposal(f: ReturnType<typeof fixture>, value: unknown = spec()) {
  generate.mockResolvedValueOnce({ text: JSON.stringify(value) });
  const result = await generateRuleProposal(f.request()); expect(result).not.toBeNull(); return result!;
}
beforeEach(() => {
  resetLawgiverState(); worldSchema.removeRule(name); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline Lawgiver regression"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); worldSchema.removeRule(name); resetLawgiverState(); jest.restoreAllMocks();
});

test("unscoped requests fail clearly without inference or queue entries", () => {
  expect(() => requestRule("Unscoped", { desiredBehavior: "No implicit authority" })).toThrow("explicit World");
  expect(getLawgiverState().pendingRequests).toEqual([]); expect(generate).not.toHaveBeenCalled();
});

test("explicit setup request can establish an initial epoch before the first tick", async () => {
  const f = fixture(false); expect(approveRule((await proposal(f)).id)).toBe(true);
  f.engine.processTick(1); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(true);
  expect(worldSchema.getRule(name)!.priority).toBe(0);
});

test("another world's cycle cannot consume a request or execute the resulting rule", async () => {
  const a = fixture(), b = fixture(); a.request(); generate.mockResolvedValue({ text: JSON.stringify(spec()) });
  expect(await runLawgiverCycle(b.registry)).toEqual({ rulesProposed: 0, rulesApproved: 0 });
  expect(generate).not.toHaveBeenCalled(); expect(getLawgiverState().pendingRequests).toHaveLength(1);
  expect(await runLawgiverCycle(a.registry)).toEqual({ rulesProposed: 1, rulesApproved: 1 });
  b.engine.processTick(1); expect(b.objects.hasTrait(b.object, "gate_marked")).toBe(false);
  a.engine.processTick(1); expect(a.objects.hasTrait(a.object, "gate_marked")).toBe(true);
});

test.each(["stop", "restart", "rewind"])("%s revokes an accepted runtime rule before further effects", async change => {
  const f = fixture(); f.world.time.elapsed = 100;
  expect(approveRule((await proposal(f)).id)).toBe(true);
  if (change === "rewind") f.world.time.elapsed = 0;
  else { stopCommittedEvents(f.world); if (change === "restart") startCommittedEvents(f.world); }
  f.engine.processTick(1); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(false);
});

test("serialized/restored runtime marker is not an execution grant", async () => {
  const f = fixture(); expect(approveRule((await proposal(f)).id)).toBe(true);
  const original = worldSchema.getRule(name)!;
  const restored = WorldSchema.fromJSON(JSON.parse(JSON.stringify(worldSchema.toJSON()))).getRule(name)!;
  expect(restored.executionScope).toBe("lawgiver-runtime"); expect(restored).not.toBe(original);
  expect(canExecuteRule(f.world, restored)).toBe(false);
  worldSchema.defineRule(restored); f.engine.processTick(1);
  expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(false);
});

test("native trusted unscoped rules retain their existing execution behavior", () => {
  const f = fixture();
  worldSchema.defineRule({ name, description: "Trusted host rule", when: { event: "tick", condition: spec().condition }, then: spec().effects });
  f.engine.processTick(1); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(true);
});

test("approved rule definition and nested effects are immutable", async () => {
  const f = fixture(); expect(approveRule((await proposal(f)).id)).toBe(true);
  const rule = worldSchema.getRule(name)!;
  expect(Object.isSealed(rule)).toBe(true); expect(Object.isFrozen(rule.then[0].params)).toBe(true);
  expect(() => { rule.name = "changed"; }).toThrow();
});

test.each(["request", "proposal", "proposalId", "copy", "registryReset"])("changed %s cannot acquire approval", async change => {
  const f = fixture(); let p;
  if (change === "request") {
    const req = f.request();
    generate.mockImplementationOnce(async () => { req.context.desiredBehavior = "Different authority"; return { text: JSON.stringify(spec()) }; });
    p = await generateRuleProposal(req);
  } else p = await proposal(f);
  expect(p).not.toBeNull();
  if (change === "proposal") p!.effects[0].params!.trait = "changed";
  if (change === "proposalId") p!.id = "reused-reference";
  if (change === "copy") getLawgiverState().proposedRules[0] = structuredClone(p!);
  if (change === "registryReset") resetLawgiverState();
  expect(approveRule(p!.id)).toBe(false); expect(worldSchema.getRule(name)).toBeUndefined();
});

test("host enable/disable controls retain the existing scoped rule grant", async () => {
  const f = fixture(); expect(approveRule((await proposal(f)).id)).toBe(true);
  const rule = worldSchema.getRule(name)!; rule.enabled = false;
  f.engine.processTick(1); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(false);
  rule.enabled = true; f.engine.processTick(2); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(true);
});

test("withdrawal while authoring is pending retains rejected output without activation", async () => {
  const f = fixture(), req = f.request();
  generate.mockImplementationOnce(async () => {
    getLawgiverState().pendingRequests = [];
    return { text: JSON.stringify(spec()) };
  });
  const p = await generateRuleProposal(req);
  expect(p!.status).toBe("rejected"); expect(approveRule(p!.id)).toBe(false);
  expect(getLawgiverState().proposedRules).toContain(p);
});

test("cancellation during inference preserves rejected evidence without activation", async () => {
  const f = fixture(), controller = new AbortController();
  const result = await withSimulationTask(controller.signal, async () => {
    generate.mockImplementationOnce(async input => {
      expect(input.abortSignal).toBe(controller.signal); controller.abort(); return { text: JSON.stringify(spec()) };
    });
    return generateRuleProposal(f.request());
  });
  expect(result!.status).toBe("rejected"); expect(result!.rejectionReason).toContain("cancelled");
  expect(approveRule(result!.id)).toBe(false); expect(worldSchema.getRule(name)).toBeUndefined();
});

test("stopped sources cannot enqueue or start new author work", async () => {
  const f = fixture(), req = f.request(); stopCommittedEvents(f.world);
  expect(() => f.request()).toThrow("current committed world source");
  expect(await generateRuleProposal(req)).toBeNull(); expect(generate).not.toHaveBeenCalled();
});

test("overlapping generation for the same request has only one producer", async () => {
  const f = fixture(), req = f.request(); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = generateRuleProposal(req); expect(await generateRuleProposal(req)).toBeNull();
  release({ text: JSON.stringify(spec()) }); expect(await first).not.toBeNull(); expect(generate).toHaveBeenCalledTimes(1);
});

test.each([
  ["mixed effects", { effects: [...spec().effects, { action: "invent_truth" }] }],
  ["missing parameter", { effects: [{ action: "add_trait", params: {} }] }],
  ["invalid target", { effects: [{ ...spec().effects[0], target: 123 }] }],
  ["chance", { effects: [{ action: "destroy", params: { chance: 2 } }] }],
  ["null condition", { condition: null }],
  ["conflicting condition", { condition: { has: ["x"], not: ["x"] } }],
  ["unknown field", { conditionsOverride: [] }],
  ["ambiguous aliases", { then: spec().effects }],
  ["unsupported event", { effects: [{ action: "emit_event", params: {} }] }],
  ["private write", { effects: [{ action: "modify_value", params: { component: "mind", field: "arousal", delta: 1 } }] }],
  ["protected write", { effects: [{ action: "modify_value", params: { component: "GridPosition", field: "x", delta: 1 } }] }],
  ["private read", { condition: { expression: "Mind.arousal > 0" } }],
  ["invalid numeric field", { effects: [{ action: "modify_value", params: { component: "Fuel", field: "missing", delta: 1 } }] }],
  ["unknown spawn type", { effects: [{ action: "spawn", params: { typeId: "not_registered_gate_type" } }] }],
] as const)("%s rejects the entire rule and retains a reason", async (_label, change) => {
  const f = fixture(), p = await proposal(f, { ...spec(), ...change });
  expect(approveRule(p.id)).toBe(false); expect(p.status).toBe("rejected"); expect(p.rejectionReason).toBeTruthy();
  expect(getLawgiverState().proposedRules).toContain(p); expect(worldSchema.getRule(name)).toBeUndefined();
});

test("public numeric dynamic data remains writable through native rule execution", async () => {
  const f = fixture();
  const gauge = registryCreateComponent({ name: "GateGauge", description: "Public gauge", properties: { level: "number" } });
  addComponent(f.world, f.object, gauge); gauge.level[f.object] = 0;
  const p = await proposal(f, { ...spec(), effects: [{ action: "modify_value", params: { component: "GateGauge", field: "level", delta: 2 } }] });
  expect(approveRule(p.id)).toBe(true); f.engine.processTick(1); expect(gauge.level[f.object]).toBe(2);
});

test("a source stopped by the first effect cannot receive a second effect", async () => {
  const f = fixture();
  const p = await proposal(f, { ...spec(), effects: [...spec().effects,
    { action: "add_trait", params: { trait: "must_not_appear" } }] });
  expect(approveRule(p.id)).toBe(true);
  const add = f.objects.addTrait.bind(f.objects);
  jest.spyOn(f.objects, "addTrait").mockImplementation((eid, trait) => { add(eid, trait); stopCommittedEvents(f.world); });
  f.engine.processTick(1); expect(f.objects.hasTrait(f.object, "gate_marked")).toBe(true);
  expect(f.objects.hasTrait(f.object, "must_not_appear")).toBe(false);
});
