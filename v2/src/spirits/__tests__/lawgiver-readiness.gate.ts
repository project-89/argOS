/** Scripted author, real rule admission and native execution. No model-quality credit. */
import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createSpiritRegistry } = await import("../spirit-registry");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { ObjectManager } = await import("../../world/object-manager");
const { RulesEngine } = await import("../../world/rules-engine");
const { worldSchema } = await import("../../world/schema");
const { requestRule, generateRuleProposal, approveRule, runLawgiverCycle, resetLawgiverState, getLawgiverState } = await import("../rules-spirit");

const ruleName = "spirit_gate_mark_selected";
let requestWorld: ReturnType<typeof createArgosWorld>;
const base = () => ({ name: ruleName, description: "Mark only gate-selected objects", trigger: "tick",
  condition: { has: ["spirit_gate_selected"] }, effects: [{ action: "add_trait", target: "self", params: { trait: "spirit_gate_marked" } }],
  reason: "A bounded diagnostic mechanic" });
function fixture() {
  const world = createArgosWorld("Lawgiver readiness"); initializePrefabs(world); startCommittedEvents(world);
  requestWorld = world;
  return { world, registry: createSpiritRegistry(world) };
}
function request() { return requestRule("Mark selected objects", { desiredBehavior: "Only selected objects get the mark" }, "gate", requestWorld); }
async function propose(value: unknown) {
  generate.mockResolvedValueOnce({ text: JSON.stringify(value) });
  const proposal = await generateRuleProposal(request()); expect(proposal).not.toBeNull(); return proposal!;
}
beforeEach(() => {
  resetLawgiverState(); generate.mockReset(); worldSchema.removeRule(ruleName);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline gate"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  worldSchema.removeRule(ruleName); resetLawgiverState(); jest.restoreAllMocks();
});

test("L1: approved rule has native effects only on matching objects", async () => {
  const f = fixture(), objects = new ObjectManager(f.world), engine = new RulesEngine(f.world, objects);
  const selected = objects.spawn("object", { name: "Selected fixture" })!;
  const control = objects.spawn("object", { name: "Control fixture" })!;
  expect(selected).not.toBeNull(); expect(control).not.toBeNull(); objects.addTrait(selected, "spirit_gate_selected");
  expect(approveRule((await propose(base())).id)).toBe(true);
  expect(objects.hasTrait(selected, "spirit_gate_marked")).toBe(false);
  engine.processTick(1);
  expect(objects.hasTrait(selected, "spirit_gate_marked")).toBe(true);
  expect(objects.hasTrait(control, "spirit_gate_marked")).toBe(false);
  expect(generate).toHaveBeenCalledTimes(1);
});

test("L2: no requests means no inference and no new rule", async () => {
  const f = fixture(), before = worldSchema.getActiveRules();
  expect(await runLawgiverCycle(f.registry)).toEqual({ rulesProposed: 0, rulesApproved: 0 });
  expect(worldSchema.getActiveRules()).toEqual(before); expect(generate).not.toHaveBeenCalled();
});

test("L3: malformed response stays unactivated and retains the request", async () => {
  const f = fixture(); request(); generate.mockResolvedValueOnce({ text: "not JSON" });
  expect(await runLawgiverCycle(f.registry)).toEqual({ rulesProposed: 0, rulesApproved: 0 });
  expect(worldSchema.getRule(ruleName)).toBeUndefined(); expect(getLawgiverState().pendingRequests).toHaveLength(1);
});

test("L4: unsupported effect is rejected and its proposal evidence remains", async () => {
  fixture(); const proposal = await propose({ ...base(), effects: [{ action: "invent_world_truth" }] });
  expect(approveRule(proposal.id)).toBe(false);
  expect(getLawgiverState().proposedRules).toContain(proposal); expect(proposal.status).toBe("rejected");
  expect(worldSchema.getRule(ruleName)).toBeUndefined();
});

test("L5: mixed valid and invalid effects reject atomically, not as a silently changed mechanic", async () => {
  fixture(); const proposal = await propose({ ...base(), effects: [...base().effects, { action: "invent_world_truth" }] });
  expect(approveRule(proposal.id)).toBe(false); expect(worldSchema.getRule(ruleName)).toBeUndefined();
});

test("L6: an unrelated existing rule cannot be overwritten by a generated name collision", async () => {
  fixture();
  const existing = { name: ruleName, description: "An existing authored rule", enabled: true,
    when: { event: "tick" as const, condition: { has: ["never_matches"] } }, then: base().effects as any };
  worldSchema.defineRule(existing);
  const proposal = await propose(base());
  expect(approveRule(proposal.id)).toBe(false); expect(worldSchema.getRule(ruleName)).toEqual(existing);
});

test("L7: rule admission rejects a declaration to write private cognition", async () => {
  fixture(); const proposal = await propose({ ...base(), effects: [{ action: "modify_value", target: "self",
    params: { component: "Mind", field: "arousal", delta: 1 } }] });
  // This tests admission, not a claim that this field was successfully written.
  expect(approveRule(proposal.id)).toBe(false); expect(worldSchema.getRule(ruleName)).toBeUndefined();
});

test("L8: stopping the source during author inference prevents late rule activation", async () => {
  const f = fixture(); request();
  let finish!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = runLawgiverCycle(f.registry);
  expect(generate).toHaveBeenCalledTimes(1); stopCommittedEvents(f.world);
  finish({ text: JSON.stringify(base()) });
  expect((await pending).rulesApproved).toBe(0); expect(worldSchema.getRule(ruleName)).toBeUndefined();
});
