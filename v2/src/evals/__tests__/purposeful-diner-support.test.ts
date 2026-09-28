import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createIterativeDinerFixture } = await import("../iterative-diner-fixture");
const { createDinerProposalDispatch, observeNewDinerFood, observeDinerIdentity, stopDinerDiagnostic } = await import("../purposeful-diner-support");
const { dinerContinuityFailures } = await import("../iterative-diner-evidence");
const { createSpiritRegistry, setGodAgent, getMessagesForGodAI } = await import("../../spirits/spirit-registry");
const { createDynamicSpirit, approveProposal, rejectProposal, resetFactoryState } = await import("../../spirits/spirit-factory");
const { runArchitectCognition } = await import("../../spirits/architect-spirit");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { getWorldConstructionStatus } = await import("../../runtime/world-construction-budget");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { executeActions } = await import("../../cognition/cognition-system");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { ObjectManager } = await import("../../world/object-manager");
const { Name, Needs, PhysicalObject, Removed, WorkingMemoryIdentity } = await import("../../ecs/components");
const { query, hasComponent, removeComponent } = await import("bitecs");

beforeEach(() => {
  resetFactoryState(); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline only"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

async function setup() {
  const f = await createIterativeDinerFixture(false, "purposeful-v2"), world = f.sim.world;
  startCommittedEvents(world); world.meta.timedActions = true;
  for (const id of [f.actor, f.room, f.table, f.chair, f.removed]) workingMemoryEntityRef(world, id);
  const spirits = createSpiritRegistry(world); setGodAgent(spirits, f.sim.god.eid);
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeEntities: true, canProposeComponents: false, canProposeRules: false, canProposeSystems: false,
      canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 } })!;
  const admitted = getWorldConstructionStatus(world).admitted;
  const dispatch = createDinerProposalDispatch({ world, god: f.sim.god, spirits }, f.room,
    () => getWorldConstructionStatus(world).admitted - admitted);
  const observe = () => observeNewDinerFood(world, f.actor,
    new Set([f.actor, f.room, f.table, f.chair, f.removed].map(e => WorkingMemoryIdentity.id[e])), () => {});
  const cycle = () => runArchitectCognition(world, f.sim.god.systemRegistry, spirits, weaver);
  const act = (target: string, content: string) => {
    executeActions(world, [{ eid: f.actor, action: { type: "interact", target, content } }], f.sim.god.systemRegistry);
    advanceSimulationTimeline(world, 10000, { integrate: () => {} });
  };
  return { ...f, world, spirits, cycle, dispatch, observe, act };
}
function propose(room: number) {
  generate.mockResolvedValueOnce({ text: JSON.stringify([{ type: "entity", description: "A simple serving of lunch", priority: "normal",
    rationale: "Food provision has not yet been installed in this diner", expectedChange: "A diner visitor can eat a meal",
    evidence: [`entity:${room}`] }]) }).mockResolvedValueOnce({ text: JSON.stringify({ name: "Vegetable sandwich", type: "object",
    description: "One fresh vegetable sandwich", roomEid: room, components: [{ name: "ObjectType", values: { typeId: "food_item" } }] }) });
}

test("an absent identity component cannot turn a stale slot into two constructed objects", async () => {
  const f = await setup();
  try {
    const food = new ObjectManager(f.world).spawn("food_item", { name: "Diner lunch plate", containedIn: f.room })!;
    const old = workingMemoryEntityRef(f.world, food)!.key;
    removeComponent(f.world, food, WorkingMemoryIdentity); // Reproduce retained data in a reused storage slot.
    expect(WorkingMemoryIdentity.id[food]).toBe(old);
    const initial = [f.actor, f.room, f.table, f.chair, f.removed].map(e => observeDinerIdentity(f.world, e));
    const before = observeDinerIdentity(f.world, food);
    expect(before.key).toBe(`unidentified:${food}`);
    expect(hasComponent(f.world, food, WorkingMemoryIdentity)).toBe(false);
    const actual = workingMemoryEntityRef(f.world, food)!.key;
    expect(actual).not.toBe(old);
    const after = observeDinerIdentity(f.world, food);
    expect(after.key).toBe(actual);
    expect(dinerContinuityFailures(initial, [...initial, after], [after])).toEqual([]);
    expect(dinerContinuityFailures(initial, [...initial, after], [after, after])).toContain("repeated_construction:Diner lunch plate");
  } finally { f.sim.stop(); stopCommittedEvents(f.world); }
});

test("observer cancellation stops an actual pending native interval before aborting its scope", async () => {
  const f = await setup(), controller = new AbortController();
  try {
    await withSimulationTask(controller.signal, async () => {
      executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Diner table" } }], f.sim.god.systemRegistry);
      expect(stopDinerDiagnostic(controller, Error("observer_failed"), () => f.sim.stop())).toBeUndefined();
    });
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason.message).toBe("observer_failed");
    const broken = new AbortController(), failure = Error("shutdown failed");
    expect(stopDinerDiagnostic(broken, Error("observer_failed"), () => { throw failure; })).toBe(failure);
    expect(broken.signal.aborted).toBe(true);
  } finally { f.sim.stop(); stopCommittedEvents(f.world); }
});

test.each(["later_approval", "rejected", "source_replaced", "cancelled"])("earlier-cycle proposal dispatch: %s", async boundary => {
  const f = await setup(); const observed = f.observe();
  try {
    propose(f.room); const proposals = await f.cycle(); expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("pending"); expect((await f.dispatch()).executed).toEqual([]);
    generate.mockResolvedValueOnce({ text: "[]" }); expect(await f.cycle()).toEqual([]);
    if (boundary === "rejected") rejectProposal(proposals[0].id, "Do not construct");
    else approveProposal(proposals[0].id, f.sim.god.eid); // Offline approval boundary, never a live host shortcut.
    if (boundary === "source_replaced") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (boundary === "cancelled") {
      const controller = new AbortController(); controller.abort(Error("Cancelled test"));
      await expect(withSimulationTask(controller.signal, f.dispatch)).rejects.toThrow("Cancelled test");
    } else {
      const result = await f.dispatch();
      expect(result.executed).toEqual(boundary === "later_approval" ? [proposals[0].id] : []);
    }
    if (boundary === "later_approval") {
      // Construction and use can both finish before a host's post-cycle scan.
      f.act("Vegetable sandwich", "eat"); observed.scan();
      expect(observed.evidence.meals).toHaveLength(1);
      expect(observed.evidence.meals[0]).toMatchObject({ hungerBefore: 65, hungerAfter: 35 });
      expect((await f.dispatch()).executed).toEqual([]); expect(observed.evidence.meals).toHaveLength(1);
      expect(observed.errors).toEqual([]);
    }
    expect([...query(f.world, [Name])].filter(e => Name.value[e] === "Vegetable sandwich")).toEqual([]);
  } finally { observed.stop(); f.sim.stop(); stopCommittedEvents(f.world); }
});

test("discovery is read-only and consumption before a post-build scan is still witnessed", async () => {
  const f = await setup(), observed = f.observe();
  try {
    const food = new ObjectManager(f.world).spawn("food_item", { name: "Fresh roll", containedIn: f.room })!;
    expect(hasComponent(f.world, food, WorkingMemoryIdentity)).toBe(false);
    observed.scan(); expect(hasComponent(f.world, food, WorkingMemoryIdentity)).toBe(false);
    f.act("Fresh roll", "eat");
    expect(observed.evidence.meals).toHaveLength(1); expect(Needs.hunger[f.actor]).toBe(35);
    expect(observed.errors).toEqual([]);
    expect([...query(f.world, [PhysicalObject])].filter(e => Name.value[e] === "Fresh roll")).toEqual([]);
  } finally { observed.stop(); f.sim.stop(); stopCommittedEvents(f.world); }
});

test("removed controls and ordinary chair success cannot count as food or urgent reports", async () => {
  const f = await setup(), observed = f.observe();
  try {
    f.act("Diner chair", "sit"); f.act("Removed brass key", "eat");
    expect(hasComponent(f.world, f.removed, Removed)).toBe(true);
    expect(observed.evidence.meals).toEqual([]);
    generate.mockResolvedValue({ text: "[]" }); await f.cycle();
    const reports = getMessagesForGodAI(f.spirits).filter(m => m.subject === "World activity reviewed");
    expect(reports).toHaveLength(1); expect(reports[0].priority).toBe("normal");
  } finally { observed.stop(); f.sim.stop(); stopCommittedEvents(f.world); }
});
