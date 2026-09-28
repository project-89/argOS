import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, hasComponent, query, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createGodAgentEntity } = await import("../../ecs/prefabs");
const { Name, PhysicalObject, Removed, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { createGeneratedIntention } = await import("../../cognition/goal-lifecycle");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry, setGodAgent } = await import("../../spirits/spirit-registry");
const { createDynamicSpirit, approveProposal, resetFactoryState, submitProposal } = await import("../../spirits/spirit-factory");
const { runArchitectCognition, executeAllApprovedProposals, getObservedProposalDiagnostics } = await import("../../spirits/architect-spirit");
const { getPlaceBuildStatus } = await import("../../engineering/place-materialization");
const { ObjectManager } = await import("../../world/object-manager");
const { createSuccessiveBuildObserver } = await import("../successive-growth-builds");

beforeEach(() => {
  resetFactoryState(); generate.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Build observation tests must stay offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function setup() {
  const world = createArgosWorld("Observed growth"); initializePrefabs(world); startCommittedEvents(world);
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Courtyard" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", roomId: room, systemPrompt: "You are Ada, a visitor on a lunch break." });
  const god = createGodAgentEntity(world, { name: "God", worldName: "Observed growth" });
  for (const eid of [room, actor, god]) workingMemoryEntityRef(world, eid);
  createGeneratedIntention(world, actor, { description: "Eat lunch and take a seated break", priority: 7 }, "foreground");
  const spirits = createSpiritRegistry(world); setGodAgent(spirits, god);
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology", superiorEid: god,
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 } })!;
  const initial = new Set([room, actor].map(eid => WorkingMemoryIdentity.id[eid]));
  const objects = new ObjectManager(world), observer = createSuccessiveBuildObserver(world, registry, god, weaver.eid, initial);
  const object = (name: string, typeId: string) => ({ name, type: "object", description: `One ${name}`,
    components: [{ name: "ObjectType", values: { typeId } }] });
  async function propose(name = "Lunch", typeId = "food_item", place = false) {
    const specification = place ? { name: `${name} Room`, type: "room", description: `A place with ${name}`, components: [],
      contents: [{ id: "useful", entity: object(name, typeId) }] }
      : { ...object(name, typeId), roomEid: room };
    generate.mockImplementation(async request => {
      if (request.prompt.includes("identify 0-3")) return { text: JSON.stringify([{ type: "entity", description: `Provide ${name}`,
        priority: "high", rationale: "Support an actual visitor", evidence: [`entity:${room}`], expectedChange: `Visitor can use ${name}`,
        ...(place ? { supportRequirements: [{ id: "useful", kind: "entity", entityType: "object", objectType: typeId, description: "One usable object" }] } : {}) }]) };
      return { text: JSON.stringify(specification) };
    });
    const rows = await runArchitectCognition(world, registry, spirits, weaver);
    expect(rows).toHaveLength(1); observer.scan(); return rows[0];
  }
  async function execute(p: Awaited<ReturnType<typeof propose>>, time = 1000, approver = god) {
    world.time.elapsed = time; expect(approveProposal(p.id, approver)).toBe(true); observer.scan();
    const result = await executeAllApprovedProposals(world, registry);
    expect(result.failed).toEqual([]); expect(result.executed).toEqual([p.name]);
    return [...query(world, [Name, PhysicalObject])].find(eid => Name.value[eid] === (p.specification.contents?.[0].entity.name ?? p.specification.name))!;
  }
  return { world, registry, room, god, actor, weaver, initial, objects, observer, propose, execute };
}

test("actual observed God-approved Weaver place receipt binds a new native edible identity", async () => {
  const f = setup();
  try {
    const proposal = await f.propose("Lunch", "food_item", true), eid = await f.execute(proposal);
    const before = JSON.stringify(getObservedProposalDiagnostics(f.world));
    expect(f.observer.scan()).toEqual([{ proposalId: proposal.id, sourceId: getCommittedEvents(f.world).sourceId,
      targetKey: WorkingMemoryIdentity.id[eid], kind: "meal", observedApprovedAtSimMs: 1000, observedExecutedAtSimMs: 1000, approvedByGod: true }]);
    expect(getPlaceBuildStatus(f.world, f.registry)[0].members.some(member => member.eid === eid && member.current)).toBe(true);
    expect(JSON.stringify(getObservedProposalDiagnostics(f.world))).toBe(before);
    const copy = f.observer.scan(); copy[0].targetKey = "not-the-live-key";
    expect(f.observer.scan()[0].targetKey).toBe(WorkingMemoryIdentity.id[eid]);
    removeEntity(f.world, eid); f.world.time.elapsed = 1500;
    expect(f.observer.scan()).toHaveLength(1); // Historical construction survives finite consumption.
  } finally { stopCommittedEvents(f.world); }
});

test("bare-object observation never mints identity and delayed identity does not redate the build", async () => {
  const f = setup();
  try {
    const proposal = await f.propose("Dry chair", "chair"), eid = await f.execute(proposal);
    expect(hasComponent(f.world, eid, WorkingMemoryIdentity)).toBe(false);
    const before = getCommittedEvents(f.world);
    expect(f.observer.scan()).toEqual([]);
    expect(hasComponent(f.world, eid, WorkingMemoryIdentity)).toBe(false);
    expect(getCommittedEvents(f.world)).toEqual(before);
    f.world.time.elapsed = 9000; const key = workingMemoryEntityRef(f.world, eid)!.key;
    expect(f.observer.scan()).toEqual([{ proposalId: proposal.id, sourceId: before.sourceId, targetKey: key, kind: "seat",
      observedApprovedAtSimMs: 1000, observedExecutedAtSimMs: 1000, approvedByGod: true }]);
  } finally { stopCommittedEvents(f.world); }
});

test("physical creation first seen before executed-status polling remains earlier than the late status", async () => {
  const f = setup();
  try {
    const p = await f.propose("Dry chair", "chair");
    const eid = await f.execute(p); p.status = "approved"; f.observer.scan(); // Delayed status publication fixture.
    f.world.time.elapsed = 7000; p.status = "executed"; workingMemoryEntityRef(f.world, eid);
    expect(f.observer.scan()[0]).toMatchObject({ observedApprovedAtSimMs: 1000, observedExecutedAtSimMs: 1000 });
  } finally { stopCommittedEvents(f.world); }
});

test.each(["initial", "duplicate", "changed-key", "missing-key", "removed", "wrong-type", "malformed-traits"])("does not score %s target identity/kind", async variant => {
  const f = setup();
  try {
    const p = await f.propose(), eid = await f.execute(p);
    if (variant === "initial") {
      // Existing identity explicitly included at observer creation, even if its
      // physical slot was not present yet. No name-only initial exemption.
      addComponent(f.world, eid, WorkingMemoryIdentity); WorkingMemoryIdentity.id[eid] = [...f.initial][0];
    } else if (variant === "duplicate") f.objects.spawn("food_item", { name: "Lunch", containedIn: f.room });
    else if (variant === "changed-key") {
      workingMemoryEntityRef(f.world, eid); p.status = "approved"; f.observer.scan();
      WorkingMemoryIdentity.id[eid] = "entity:replacement-lifetime"; p.status = "executed";
    } else if (variant === "missing-key") { /* Observer must not manufacture the missing key. */ }
    else if (variant === "removed") { workingMemoryEntityRef(f.world, eid); addComponent(f.world, eid, Removed); }
    else if (variant === "wrong-type") { workingMemoryEntityRef(f.world, eid); p.specification.components[0].values.typeId = "chair"; }
    else { workingMemoryEntityRef(f.world, eid); Traits.active[eid] = "not-json"; }
    expect(f.observer.scan()).toEqual([]);
    expect(f.observer.snapshot().diagnostics.length).toBeGreaterThan(0);
  } finally { stopCommittedEvents(f.world); }
});

test.each(["wrong-god", "god-replaced", "factory-reset", "source-restarted"])("does not score after %s ownership mismatch", async variant => {
  const f = setup();
  try {
    const p = await f.propose(), eid = await f.execute(p, 1000, variant === "wrong-god" ? f.actor : f.god);
    workingMemoryEntityRef(f.world, eid);
    if (variant === "god-replaced") WorkingMemoryIdentity.id[f.god] = "entity:new-god";
    if (variant === "factory-reset") resetFactoryState();
    if (variant === "source-restarted") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    expect(f.observer.scan()).toEqual([]);
    if (variant !== "wrong-god") expect(f.observer.snapshot().closed).toBeTruthy();
  } finally { stopCommittedEvents(f.world); }
});

test("host-only unobserved proposal cannot supply native observation provenance", async () => {
  const f = setup();
  try {
    const p = submitProposal(f.weaver.eid, "entity", "Lunch", "One lunch", { name: "Lunch", type: "object", description: "One lunch",
      roomEid: f.room, components: [{ name: "ObjectType", values: { typeId: "food_item" } }] }, "Fixture host write")!;
    const eid = await f.execute(p); workingMemoryEntityRef(f.world, eid);
    expect(f.observer.scan()).toEqual([]);
    expect(f.observer.snapshot().proposals).toEqual([]);
  } finally { stopCommittedEvents(f.world); }
});

test("observer refuses an already existing executed proposal/receipt rather than relabeling it new", async () => {
  const f = setup();
  try {
    const p = await f.propose("Lunch", "food_item", true); await f.execute(p);
    const late = createSuccessiveBuildObserver(f.world, f.registry, f.god, f.weaver.eid, f.initial);
    f.world.time.elapsed = 7000;
    expect(late.scan()).toEqual([]);
  } finally { stopCommittedEvents(f.world); }
});

test("bounded observer closes rather than evicting old physical history", () => {
  const f = setup();
  try {
    for (let i = 0; i < 129; i++) f.objects.spawn("object", { name: `Prop ${i}`, containedIn: f.room });
    expect(f.observer.scan()).toEqual([]);
    expect(f.observer.snapshot().closed).toBe("physical_observation_limit");
    expect(f.observer.snapshot().physical.length).toBe(128);
  } finally { stopCommittedEvents(f.world); }
});
