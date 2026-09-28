import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));

const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Description } = await import("../../ecs/components");
const { listDirectContents } = await import("../../ecs/location");
const { configureWorldConstructionBudget, getWorldConstructionStatus } = await import("../../runtime/world-construction-budget");
const {
  scanForUnpopulatedRooms,
  getPendingRoomRequests,
  resetStewardState,
  populateRoomViaSchema,
  generateRoomPopulation,
  requestRoomPopulation,
  requestRoomPopulationForRoom,
  runStewardCycle,
} = await import("../steward-spirit");

let now = Date.now();
beforeEach(() => {
  // Keep authored request timestamps distinct across fixtures.
  now += 60_000;
  jest.spyOn(Date, "now").mockReturnValue(now);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls"));
  generate.mockReset();
  resetStewardState();
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  resetStewardState();
  jest.restoreAllMocks();
});

test("an empty transit space is observed, not an automatic construction mandate", async () => {
  const world = createArgosWorld("Empty is not broken"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Street", description: "A pedestrian route with open sky." });
  configureWorldConstructionBudget(world, 3);
  generate.mockResolvedValue({ text: JSON.stringify({ entities: [{ type: "chair" }], ambientStimuli: [] }) });
  const result = await runStewardCycle(world, {} as any);
  expect(generate).not.toHaveBeenCalled();
  expect(getPendingRoomRequests()).toEqual([]);
  expect(listDirectContents(world, room)).toEqual([]);
  expect(result.entitiesGenerated).toBe(0);
  expect(getWorldConstructionStatus(world).remaining).toBe(2);
});

test("capacity exhaustion defers population before any paid inference and retains the request", async () => {
  const world = createArgosWorld("Capacity"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Street" });
  configureWorldConstructionBudget(world, 1);
  const request = requestRoomPopulation("general", "Street");
  generate.mockResolvedValue({ text: JSON.stringify({ entities: [] }) });
  expect(await populateRoomViaSchema(world, request, room)).toBeNull();
  expect(await populateRoomViaSchema(world, request, room)).toBeNull();
  expect(generate).not.toHaveBeenCalled();
  expect(getPendingRoomRequests()).toContain(request);
  expect(getWorldConstructionStatus(world).admitted).toBe(1);
});

test("capacity consumed during inference is rechecked before any partial plan materialization", async () => {
  const world = createArgosWorld("Concurrent authoring"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hallway" }); configureWorldConstructionBudget(world, 3);
  const request = requestRoomPopulation("general", "Hallway", {}, { maxItems: 2 });
  generate.mockImplementationOnce(async ({ prompt }) => {
    expect(prompt).toContain("at most 2 total ECS entities");
    createObjectEntity(world, { name: "Other author's object", roomId: room });
    return { text: JSON.stringify({ entities: [{ type: "chair" }], ambientStimuli: [{ type: "sound", template: "Footsteps." }] }) };
  });
  expect(await populateRoomViaSchema(world, request, room)).toBeNull();
  expect(listDirectContents(world, room)).toHaveLength(1);
  expect(getPendingRoomRequests()).toContain(request);
  expect(getWorldConstructionStatus(world).admitted).toBe(2);
});

test("explicit Hallway delegation carries the exact authored place without tavern hints", async () => {
  const world = createArgosWorld("Apartment");
  initializePrefabs(world);
  const description = "INTERIOR quiet apartment-building hallway with cream walls and a worn carpet. One doorway leads into Jerry's Living Room; the building exit leads to the Street.";
  const room = createRoomEntity(world, { name: "Hallway", description });

  expect(scanForUnpopulatedRooms(world)).toBe(1);
  expect(getPendingRoomRequests()).toEqual([]);
  const request = requestRoomPopulationForRoom(world, room);
  expect(request).toMatchObject({ roomName: "Hallway", roomType: "general", context: { primaryFunction: description } });
  generate.mockImplementationOnce(async ({ prompt }) => {
    expect(prompt).toContain(`Primary function: ${description}`);
    expect(prompt).toContain("room-type hint: general");
    expect(prompt).toContain("hints apply only where compatible with it");
    expect(prompt).not.toContain("TEMPLATE HINTS for tavern");
    expect(prompt).not.toContain("ale_barrel");
    return { text: JSON.stringify({ newTypes: [], entities: [], ambientStimuli: [] }) };
  });
  const result = await populateRoomViaSchema(world, request, room);
  expect(result).not.toBeNull();
  expect(result!.entityIds).toEqual([]); // No tavern-specific food fallback, either.
  expect(listDirectContents(world, room)).toEqual([]);
  expect(Description.value[room]).toBe(description);
  expect(getPendingRoomRequests()).toEqual([]);
});

test.each([
  ["Hallway", "general"],
  ["Shallow alcove", "general"],
  ["Unclassified room", "general"],
  ["Great Hall", "tavern"],
  ["Common room", "tavern"],
  ["Gathering room", "tavern"],
  ["The Anchor Tavern", "tavern"],
])("name hint for %s remains %s, with generic context only when no description exists", (name, roomType) => {
  const world = createArgosWorld("Name hints");
  initializePrefabs(world);
  const room = createRoomEntity(world, { name });
  Description.value[room] = " ";
  expect(scanForUnpopulatedRooms(world)).toBe(1);
  expect(getPendingRoomRequests()).toEqual([]);
  requestRoomPopulationForRoom(world, room);
  expect(getPendingRoomRequests()[0]).toMatchObject({ roomName: name, roomType, context: { primaryFunction: `A ${roomType}` } });
});

test("a recognized name never replaces authored primaryFunction in either generation prompt", async () => {
  const world = createArgosWorld("Authored hall");
  initializePrefabs(world);
  const description = "A spacious gathering hall with oak paneling, arched windows and long communal tables.";
  const room = createRoomEntity(world, { name: "Great Hall", description });
  expect(scanForUnpopulatedRooms(world)).toBe(1);
  expect(getPendingRoomRequests()).toEqual([]);
  const request = requestRoomPopulationForRoom(world, room);
  expect(request.roomType).toBe("tavern"); // Compatibility: this remains a name-only hint.
  expect(request.context.primaryFunction).toBe(description);
  generate.mockResolvedValue({ text: JSON.stringify({ newTypes: [], entities: [], ambientStimuli: [] }) });
  await populateRoomViaSchema(world, request, room);
  await generateRoomPopulation(request);
  expect(generate).toHaveBeenCalledTimes(2);
  for (const [input] of generate.mock.calls) {
    expect(input.prompt).toContain(`Primary function: ${description}`);
    expect(input.prompt).not.toContain("Primary function: A tavern");
    expect(input.prompt).not.toContain("\"Great Hall\" (a tavern)");
    expect(input.prompt).toContain("hints apply only where compatible with it");
  }
  expect(Description.value[room]).toBe(description);
});
