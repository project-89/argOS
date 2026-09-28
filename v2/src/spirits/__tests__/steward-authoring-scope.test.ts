import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addEntity, addComponent, removeEntity, getAllEntities } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createObjectEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { Name, Description, Room } = await import("../../ecs/components");
const { setLocatedIn, listDirectContents } = await import("../../ecs/location");
const { createGodAgent, godThink } = await import("../../god/god-agent");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { gatherArchitectContext } = await import("../architect-spirit");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { configureWorldConstructionBudget, getWorldConstructionStatus } = await import("../../runtime/world-construction-budget");
const { requestRoomPopulationForRoom, runStewardCycle, populateRoomViaSchema, getPendingRoomRequests,
  getRoomPopulationStatus, resetStewardState } = await import("../steward-spirit");
const { observeRoomInventories } = await import("../room-inventory-observation");

function fixture() {
  const world = createArgosWorld("Delegation"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Workshop", description: "A workspace for repairing things." });
  return { world, room, spirits: createSpiritRegistry(world) };
}
const plan = { entities: [{ type: "chair" }], ambientStimuli: [] };
beforeEach(() => { resetStewardState(); generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); resetStewardState(); jest.restoreAllMocks(); });

test("God receives inventory observations and can delegate actual bounded furnishing, without a duplicate room", async () => {
  const f = fixture(), god = createGodAgent(f.world, { name: "Author", worldName: "Delegation", narrative: "A workshop needs a place to sit." });
  configureWorldConstructionBudget(f.world, 2);
  const requestIds: string[] = [];
  generate.mockImplementationOnce(async input => {
    expect(input.system).toContain("Room inventory (observations, not construction requests");
    expect(input.system).toContain('"objectCount":0');
    for (let i = 0; i < 2; i++) {
      const result = await input.tools.populateRoom.execute({ roomEid: f.room, roomType: "general", constraints: { maxItems: 1 } }, {});
      expect(result).toMatchObject({ success: true, result: { status: "queued" } });
      requestIds.push(result.result.populationRequestId);
    }
    return { text: "The furnishing request is queued.", steps: [] };
  });
  await godThink(god, "Delegate a seat for the workshop.");
  expect(requestIds[0]).toBe(requestIds[1]);
  expect(getPendingRoomRequests()).toHaveLength(1);
  expect(getWorldConstructionStatus(f.world).admitted).toBe(1);
  generate.mockResolvedValueOnce({ text: JSON.stringify(plan) });
  const result = await runStewardCycle(f.world, f.spirits);
  expect(result.roomsPopulated).toBe(1); expect(result.entitiesGenerated).toBe(1);
  expect(listDirectContents(f.world, f.room)).toHaveLength(1);
  expect(observeRoomInventories(f.world).rooms).toHaveLength(1);
  expect(getRoomPopulationStatus(f.world)).toEqual([]);
});

test("inventory is per-world, current ECS evidence and never counts private named data as furniture", async () => {
  const f = fixture();
  const actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose freely.", roomId: f.room });
  const privateData = addEntity(f.world); addComponent(f.world, privateData, Name); Name.value[privateData] = "Private note"; setLocatedIn(f.world, privateData, f.room);
  const before = [...getAllEntities(f.world)];
  expect(observeRoomInventories(f.world).rooms[0]).toMatchObject({ objectCount: 0, occupantCount: 1 });
  expect([...getAllEntities(f.world)]).toEqual(before);
  const prop = createObjectEntity(f.world, { name: "Tool", roomId: f.room });
  const context = await gatherArchitectContext(f.world, createSystemRegistry());
  expect(context.roomInventory?.rooms[0]).toMatchObject({ objectCount: 1, occupantCount: 1 });
  expect(JSON.stringify(context.roomInventory)).not.toContain("Private note");
  removeEntity(f.world, prop); removeEntity(f.world, actor);
  expect(observeRoomInventories(f.world).rooms[0]).toMatchObject({ objectCount: 0, occupantCount: 0 });
  const other = fixture();
  expect(observeRoomInventories(other.world).rooms[0]).toMatchObject({ objectCount: 0, occupantCount: 0 });
  expect(observeRoomInventories(f.world).rooms[0]).toMatchObject({ objectCount: 0, occupantCount: 0 });
});

test.each(["source", "removed", "description", "mutated request", "copy", "foreign world", "cancelled"])("delayed delegation rejects %s before materialization", async boundary => {
  const f = fixture(), abort = new AbortController();
  const request = await withSimulationTask(abort.signal, () => requestRoomPopulationForRoom(f.world, f.room, { roomType: "general", constraints: { maxItems: 1 } }));
  const initial = listDirectContents(f.world, f.room);
  if (boundary === "copy") {
    expect(await populateRoomViaSchema(f.world, { ...request }, f.room)).toBeNull();
    expect(generate).not.toHaveBeenCalled(); return;
  }
  if (boundary === "foreign world") {
    const other = fixture();
    expect(await populateRoomViaSchema(other.world, request, other.room)).toBeNull();
    await runStewardCycle(other.world, other.spirits);
    expect(generate).not.toHaveBeenCalled(); return;
  }
  generate.mockImplementationOnce(async () => {
    if (boundary === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (boundary === "removed") { removeEntity(f.world, f.room); createRoomEntity(f.world, { name: "Workshop" }); }
    if (boundary === "description") Description.value[f.room] = "A different place.";
    if (boundary === "mutated request") request.constraints!.maxItems = 2;
    if (boundary === "cancelled") abort.abort();
    return { text: JSON.stringify(plan) };
  });
  expect(await populateRoomViaSchema(f.world, request, f.room)).toBeNull();
  expect(getRoomPopulationStatus(f.world)[0].status).toBe("stale");
  if (boundary !== "removed") expect(listDirectContents(f.world, f.room)).toEqual(initial);
});

test("source changes before dispatch reject without inference, while unrelated world changes preserve authority", async () => {
  const f = fixture();
  const request = requestRoomPopulationForRoom(f.world, f.room, { roomType: "general", constraints: { maxItems: 1 } });
  createRoomEntity(f.world, { name: "Elsewhere" });
  generate.mockResolvedValueOnce({ text: JSON.stringify(plan) });
  expect(await populateRoomViaSchema(f.world, request, f.room)).not.toBeNull();
  const later = requestRoomPopulationForRoom(f.world, f.room, { roomType: "general", constraints: { maxItems: 1 } });
  stopCommittedEvents(f.world); startCommittedEvents(f.world); generate.mockClear();
  expect(await populateRoomViaSchema(f.world, later, f.room)).toBeNull();
  expect(generate).not.toHaveBeenCalled();
});

test("a delegation made during world setup survives first start, but never a later restart", async () => {
  const world = createArgosWorld("Before first start"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workspace" });
  const request = requestRoomPopulationForRoom(world, room, { roomType: "general", constraints: { maxItems: 1 } });
  startCommittedEvents(world);
  expect(getRoomPopulationStatus(world)[0].status).toBe("pending");
  generate.mockResolvedValueOnce({ text: JSON.stringify(plan) });
  expect(await populateRoomViaSchema(world, request, room)).not.toBeNull();
  const later = requestRoomPopulationForRoom(world, room, { roomType: "general", constraints: { maxItems: 1 } });
  stopCommittedEvents(world); startCommittedEvents(world);
  expect(getRoomPopulationStatus(world)[0].status).toBe("stale");
  expect(await populateRoomViaSchema(world, later, room)).toBeNull();
});
