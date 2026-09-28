import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializeRegistry } = await import("../../ecs/component-registry");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Goal, Name, WorkingMemoryIdentity } = await import("../../ecs/components");
const { query } = await import("bitecs");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { integrateActorContinuation } = await import("../../cognition/actor-continuation");
const { registerAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, resetFactoryState, approveProposal } = await import("../spirit-factory");
const { runArchitectCognition, executeAllApprovedProposals } = await import("../architect-spirit");
const { getArchitectDiagnostics } = await import("../architect-diagnostics");
const { registerWorldMaterializationAdapter } = await import("../../engineering/world-materialization-adapter");
const { withSimulationTask } = await import("../../runtime/task-scope");

const description = "Offer one indoor chair for leisure";
function fixture() {
  resetFactoryState(); const world = createArgosWorld("Household"); initializeRegistry(world); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Sitting Room" });
  const actor = createAgentEntity(world, { name: "Tess", role: "resident", systemPrompt: "Choose freely", roomId: room });
  const durable = createIntentGoal(world, actor, "Spend leisure time indoors", 5);
  const brief = createIntentGoal(world, actor, "Finish PRIVATE_CHORE before relaxing", 6);
  const systems = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const architect = createDynamicSpirit(spirits, { name: "Weaver", type: "architect", rank: "archangel", domain: "narrative",
    architectConfig: { canProposeSystems: false, canProposeComponents: false, canProposeEntities: true,
      canProposeRules: false, canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 3,
      // These fixtures exercise the demand-bound recovery path used by mechanics/places.
      bindFurnishingMotivation: true } })!;
  return { world, room, actor, durable, brief, systems, spirits, architect };
}
const records = (prompt: string): any[] => JSON.parse(prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
const need = (refs: string[], desc = description) => ({ type: "entity", description: desc, priority: "medium",
  rationale: "Current indoor leisure needs a seat", evidence: refs, expectedChange: "An indoor chair offers native sit" });
const design = (room: number) => ({ text: JSON.stringify({ name: "Indoor chair", description: "A usable chair", type: "object",
  roomEid: room, components: [{ name: "ObjectType", values: { typeId: "chair" } }] }) });

beforeEach(() => { generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline handoff tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); resetFactoryState(); });

test.each(["retired goal", "changed step"])("one fresh authoring replaces a rejected need, not stale authority: %s", async boundary => {
  const f = fixture(); let attempts = 0, invalidatedRef = "", durableRef = "";
  const select = (purpose: string) => integrateActorContinuation(f.world, f.actor, { purpose, actionType: "wait",
    goalId: f.durable, goalKey: WorkingMemoryIdentity.id[f.durable], observedAtSimMs: 0 });
  select("Rest while a friend finds food");
  generate.mockImplementation(async input => {
    if (!input.prompt.includes("identify 0-3")) return design(f.room);
    const rows = records(input.prompt), goal = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable] && r.kind === "goal");
    attempts++;
    if (attempts === 1) {
      durableRef = goal.ref;
      invalidatedRef = rows.find(r => boundary === "retired goal" ? r.goalKey === WorkingMemoryIdentity.id[f.brief] : r.kind === "selected_purpose").ref;
      if (boundary === "retired goal") Goal.status[f.brief] = "retired"; else select("Listen to a friend briefly");
      return { text: JSON.stringify([need([goal.ref, invalidatedRef, `entity:${f.room}`])]) };
    }
    expect(input.prompt).toContain("NEED_HANDOFF_REOBSERVATION");
    expect(input.prompt).toContain("minimum sufficient");
    expect(goal.ref).not.toBe(durableRef);
    expect(rows.some(r => r.ref === invalidatedRef)).toBe(false);
    return { text: JSON.stringify([need([goal.ref, `entity:${f.room}`])]) };
  });
  const proposals = await runArchitectCognition(f.world, f.systems, f.spirits, f.architect);
  expect(attempts).toBe(2); expect(generate).toHaveBeenCalledTimes(3); expect(proposals).toHaveLength(1);
  expect(proposals[0].status).toBe("pending"); expect(proposals[0].observationScopeId).toBeTruthy();
  const entries = getArchitectDiagnostics(f.world).entries;
  expect(entries).toContainEqual(expect.objectContaining({ stage: "design", outcome: "rejected", reason: "stale_observation",
    dependency: "actor_intention", invalidatedReferences: [invalidatedRef] }));
  expect(entries.filter(e => e.stage === "reobserve" && e.outcome === "started")).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain("PRIVATE_CHORE");
  expect([...query(f.world, [Name])].some(id => Name.value[id] === "Indoor chair")).toBe(false);
  expect(Goal.progress[f.durable]).toBe(0);
  // A fresh proposal is not construction authority after its real purpose ends.
  Goal.status[f.durable] = "paused"; approveProposal(proposals[0].id);
  await executeAllApprovedProposals(f.world, f.systems);
  expect(proposals[0].status).toBe("failed");
});

test.each(["stale again", "empty", "old references", "different need", "source stopped", "source replaced", "policy revoked", "actor replaced", "capability revoked", "task cancelled"])(
  "fresh authoring is bounded and cannot revive invalid evidence: %s", async boundary => {
    const f = fixture(), cancellation = new AbortController(); let attempts = 0, oldRef = "";
    const revoke = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "Native room actions",
      ready: () => true, busy: () => false, execute: () => false });
    generate.mockImplementation(async input => {
      expect(input.prompt).toContain("identify 0-3");
      const rows = records(input.prompt), goal = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable]); attempts++;
      if (attempts === 1) {
        oldRef = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]).ref;
        Goal.status[f.brief] = "retired";
        return { text: JSON.stringify([need([goal.ref, oldRef])]) };
      }
      if (boundary === "empty") return { text: "[]" };
      if (boundary === "stale again") Goal.status[f.durable] = "paused";
      if (boundary === "source stopped" || boundary === "source replaced") { stopCommittedEvents(f.world); if (boundary === "source replaced") startCommittedEvents(f.world); }
      if (boundary === "policy revoked") f.architect.architectConfig!.canProposeEntities = false;
      if (boundary === "actor replaced") WorkingMemoryIdentity.id[f.actor] = "replacement";
      if (boundary === "capability revoked") revoke();
      if (boundary === "task cancelled") cancellation.abort();
      return { text: JSON.stringify([need([boundary === "old references" ? oldRef : goal.ref], boundary === "different need" ? "Build a tower instead" : description)]) };
    });
    expect(await withSimulationTask(cancellation.signal, () => runArchitectCognition(f.world, f.systems, f.spirits, f.architect))).toEqual([]);
    expect(attempts).toBe(2); expect(generate).toHaveBeenCalledTimes(2);
    expect(getArchitectDiagnostics(f.world).entries.filter(e => e.stage === "reobserve" && e.outcome === "started")).toHaveLength(1);
  });

test.each(["different actor", "entity only", "different goal", "changed goal meaning", "extra unrelated actor", "capability replaced before recapture"])(
  "same-description recovery cannot replace its original causal demand: %s", async boundary => {
    const f = fixture(); let attempts = 0;
    const other = createAgentEntity(f.world, { name: "Ivo", role: "resident", systemPrompt: "Choose freely", roomId: f.room });
    const otherGoal = createIntentGoal(f.world, other, "Sit down to catalogue my tools", 5);
    const capabilities = () => ({ context: () => "Native room actions", ready: () => true, busy: () => false, execute: () => false });
    const revoke = boundary === "capability replaced before recapture" ? registerAgentWorldCapabilities(f.world, f.actor, capabilities()) : undefined;
    generate.mockImplementation(async input => {
      if (!input.prompt.includes("identify 0-3")) return design(f.room);
      const rows = records(input.prompt); attempts++;
      if (attempts === 1) {
        const original = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable]);
        if (boundary === "capability replaced before recapture") { revoke!(); registerAgentWorldCapabilities(f.world, f.actor, capabilities()); }
        else if (boundary === "changed goal meaning") Goal.description[f.durable] = "Stack boxes on a chair to reach a shelf";
        else Goal.status[f.durable] = "retired";
        return { text: JSON.stringify([need([original.ref, `entity:${f.room}`,
          ...(boundary === "extra unrelated actor" ? [rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]).ref] : [])])]) };
      }
      const replacement = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[
        boundary === "different goal" ? f.brief : ["changed goal meaning", "capability replaced before recapture"].includes(boundary) ? f.durable : otherGoal]);
      const refs = boundary === "entity only" ? [`entity:${f.room}`] : [replacement.ref];
      // The union cannot launder another actor's demand even if one original
      // cause remains: set up that case with the still-current chore below.
      if (boundary === "extra unrelated actor") refs.push(rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]).ref);
      return { text: JSON.stringify([need(refs)]) };
    });
    expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toEqual([]);
    expect(attempts).toBe(2); expect(generate).toHaveBeenCalledTimes(2);
  });

test("a stale selected step may re-observe its same original durable goal", async () => {
  const f = fixture(); let attempts = 0;
  const select = (purpose: string) => integrateActorContinuation(f.world, f.actor, { purpose, actionType: "wait",
    goalId: f.durable, goalKey: WorkingMemoryIdentity.id[f.durable], observedAtSimMs: 0 });
  select("Rest near the window");
  generate.mockImplementation(async input => {
    if (!input.prompt.includes("identify 0-3")) return design(f.room);
    const rows = records(input.prompt); attempts++;
    if (attempts === 1) {
      const original = rows.find(r => r.kind === "selected_purpose"); select("Rest near the doorway");
      return { text: JSON.stringify([need([original.ref])]) };
    }
    return { text: JSON.stringify([need([rows.find(r => r.kind === "goal" && r.goalKey === WorkingMemoryIdentity.id[f.durable]).ref])]) };
  });
  expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toHaveLength(1);
  expect(attempts).toBe(2); expect(generate).toHaveBeenCalledTimes(3);
});

test("contracted place needs retain their rejection rather than rewriting or weakening requirements", async () => {
  const f = fixture();
  generate.mockImplementation(async input => {
    const ref = records(input.prompt).find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]).ref;
    Goal.status[f.brief] = "retired";
    return { text: JSON.stringify([{ ...need([ref]), supportRequirements: [{ id: "seat", kind: "entity",
      entityType: "object", objectType: "chair", description: "A native sittable chair" }] }]) };
  });
  expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(getArchitectDiagnostics(f.world).entries).toContainEqual(expect.objectContaining({ stage: "design", reason: "stale_observation" }));
  expect(getArchitectDiagnostics(f.world).entries.some(e => e.stage === "reobserve")).toBe(false);
});

test("one recovery total per cycle, not one for every stale need", async () => {
  const f = fixture(); let attempts = 0;
  generate.mockImplementation(async input => {
    expect(input.prompt).toContain("identify 0-3"); attempts++;
    if (attempts > 1) return { text: "[]" };
    const ref = records(input.prompt).find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]).ref;
    Goal.status[f.brief] = "paused";
    return { text: JSON.stringify([need([ref]), need([ref], "Offer another useful object")]) };
  });
  expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(getArchitectDiagnostics(f.world).entries.filter(e => e.stage === "design" && e.outcome === "rejected")).toHaveLength(2);
});

test("a design that becomes stale after model inference is not automatically retried", async () => {
  const f = fixture();
  generate.mockImplementation(async input => {
    if (input.prompt.includes("identify 0-3")) return { text: JSON.stringify([need([records(input.prompt).find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable]).ref])]) };
    Goal.status[f.durable] = "paused"; return design(f.room);
  });
  expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(getArchitectDiagnostics(f.world).entries.some(e => e.stage === "reobserve")).toBe(false);
});

test("re-observed proposal still passes the host's construction/site authority", async () => {
  const f = fixture(); let attempts = 0;
  const materialize = jest.fn(() => { throw Error("The one chair site is no longer available"); });
  registerWorldMaterializationAdapter(f.world, { describe: () => "Only one authorized chair site", materialize });
  generate.mockImplementation(async input => {
    if (!input.prompt.includes("identify 0-3")) return design(f.room);
    expect(input.prompt).toContain("Only one authorized chair site"); attempts++;
    const rows = records(input.prompt), durable = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable]);
    if (attempts === 1) { const old = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]); Goal.status[f.brief] = "retired"; return { text: JSON.stringify([need([durable.ref, old.ref])]) }; }
    return { text: JSON.stringify([need([durable.ref])]) };
  });
  const proposals = await runArchitectCognition(f.world, f.systems, f.spirits, f.architect);
  expect(proposals).toHaveLength(1); approveProposal(proposals[0].id);
  await executeAllApprovedProposals(f.world, f.systems);
  expect(materialize).toHaveBeenCalledTimes(1); expect(proposals[0].status).toBe("failed");
  expect([...query(f.world, [Name])].some(id => Name.value[id] === "Indoor chair")).toBe(false);
});

describe("default: a furnishing is not bound to the motivation that suggested it", () => {
  const unbound = () => { const f = fixture(); f.architect.architectConfig!.bindFurnishingMotivation = false; return f; };

  test("a resident changing their mind during design still yields a buildable proposal", async () => {
    const f = unbound(); let needCalls = 0;
    generate.mockImplementation(async input => {
      if (!input.prompt.includes("identify 0-3")) return design(f.room);
      needCalls++;
      const rows = records(input.prompt), goal = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable] && r.kind === "goal");
      const brief = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.brief]);
      Goal.status[f.brief] = "retired"; // the cited intention ends while the Weaver works
      return { text: JSON.stringify([need([goal.ref, brief.ref, `entity:${f.room}`])]) };
    });
    const proposals = await runArchitectCognition(f.world, f.systems, f.spirits, f.architect);
    expect(needCalls).toBe(1); expect(proposals).toHaveLength(1);
    expect(getArchitectDiagnostics(f.world).entries.filter(e => e.reason === "stale_observation")).toEqual([]);
    Goal.status[f.durable] = "paused"; // and the other cited purpose pauses before construction
    approveProposal(proposals[0].id);
    await executeAllApprovedProposals(f.world, f.systems);
    expect(proposals[0].status).toBe("executed");
    expect([...query(f.world, [Name])].some(id => Name.value[id] === "Indoor chair")).toBe(true);
  });

  test("authority still binds: a stopped source rejects the design", async () => {
    const f = unbound();
    generate.mockImplementation(async input => {
      if (!input.prompt.includes("identify 0-3")) { stopCommittedEvents(f.world); return design(f.room); }
      const rows = records(input.prompt), goal = rows.find(r => r.goalKey === WorkingMemoryIdentity.id[f.durable] && r.kind === "goal");
      return { text: JSON.stringify([need([goal.ref, `entity:${f.room}`])]) };
    });
    expect(await runArchitectCognition(f.world, f.systems, f.spirits, f.architect)).toEqual([]);
  });
});
