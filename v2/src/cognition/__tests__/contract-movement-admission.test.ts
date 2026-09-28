import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Goal, ObjectState, LastAction } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { createIntentGoal, executeActions } = await import("../cognition-system");
const { setGoalContract } = await import("../goal-contract");
const { agentThink } = await import("../agent-mind");
const { selectContractDrivenAction } = await import("../contract-driven-actions");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { drainPendingStimuli } = await import("../stimulus-queue");

type Branch = "room_predicate" | "destination_hint" | "key_room" | "item_room";
const branches: Branch[] = ["room_predicate", "destination_hint", "key_room", "item_room"];
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Contract movement tests stay offline"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

function fixture(branch: Branch = "room_predicate") {
  const world = createArgosWorld("Contract movement admission"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Entry hall" }), destination = createRoomEntity(world, { name: "Garden" });
  const detour = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Use evidence and choose your next step.", roomId: room });
  const item = createObjectEntity(world, { name: "Supply pack", portable: true, roomId: destination });
  const key = createObjectEntity(world, { name: "Small key", portable: true, roomId: destination });
  const cupboard = createObjectEntity(world, { name: "Supply cupboard", roomId: room });
  addComponent(world, cupboard, ObjectState); ObjectState.current[cupboard] = "locked";
  const goal = createIntentGoal(world, actor, "Reach the final objective", 10);
  if (branch === "room_predicate") setGoalContract(world, goal, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Garden" } });
  else if (branch === "destination_hint") setGoalContract(world, goal, { version: 1, kind: "custom", params: { destination: "Garden" }, success: { type: "in_inventory", itemName: "Supply pack" } });
  else {
    if (branch === "key_room") setLocatedIn(world, item, cupboard);
    setGoalContract(world, goal, { version: 1, kind: "custom", params: branch === "key_room" ? { container: "Supply cupboard", key: "Small key" } : {}, success: { type: "in_inventory", itemName: "Supply pack" } });
  }
  let targets: any = [detour];
  const attach = (options: { ownsMovement?: boolean; noTargets?: boolean } = {}) => registerAgentWorldCapabilities(world, actor, {
    ownsMovement: options.ownsMovement ?? true, context: () => "The destination is locked. The workshop has useful clues.", ready: () => true, busy: () => false,
    ...(options.noTargets ? {} : { movementTargets: () => targets }), execute: () => false,
  });
  return { world, actor, room, destination, detour, item, key, goal, attach, setTargets: (value: any) => { targets = value; }, select: () => selectContractDrivenAction(world, actor) };
}

test.each(branches)("%s yields to cognition for a blocked package route instead of injecting a move", branch => {
  const f = fixture(branch), remove = f.attach();
  try {
    for (let i = 0; i < 5; i++) expect(f.select()).toBeNull();
    expect(Goal.status[f.goal]).toBe("active"); expect(LastAction.type[f.actor]).not.toBe("move");
  } finally { remove(); }
});

test.each(branches)("%s admits the same shortcut once its exact destination becomes traversable", branch => {
  const f = fixture(branch), remove = f.attach();
  try {
    f.setTargets([f.destination]); expect(f.select()).toEqual({ type: "move", target: "Garden" });
    f.setTargets([f.detour]); expect(f.select()).toBeNull();
    f.setTargets([f.destination]); expect(f.select()).toEqual({ type: "move", target: "Garden" });
  } finally { remove(); }
});

test.each([[], undefined, null, "Garden", ["Garden"], [-1], [NaN]].map(targets => ({ targets })))("an empty or malformed route list is authoritative: $targets", ({ targets }) => {
  const f = fixture(), remove = f.attach();
  try { f.setTargets(targets); expect(f.select()).toBeNull(); } finally { remove(); }
});

test("package-owned movement without a published route list cannot fall back to global rooms", () => {
  const f = fixture(), remove = f.attach({ noTargets: true });
  try { expect(f.select()).toBeNull(); } finally { remove(); }
});

test("legacy native rooms retain deterministic movement without package topology", () => {
  const f = fixture(); expect(f.select()).toEqual({ type: "move", target: "Garden" });
  const remove = f.attach({ ownsMovement: false, noTargets: true });
  try { expect(f.select()).toEqual({ type: "move", target: "Garden" }); } finally { remove(); }
});

test.each(["room", "object", "actor"])("an ambiguous %s name cannot redirect a route-authorized identity", kind => {
  const f = fixture(), remove = f.attach(); f.setTargets([f.destination]);
  try {
    const duplicate = kind === "room" ? createRoomEntity(f.world, { name: "Garden" })
      : kind === "object" ? createObjectEntity(f.world, { name: "Garden", roomId: f.room })
      : createAgentEntity(f.world, { name: "Garden", role: "visitor", systemPrompt: "test", roomId: f.room });
    expect(f.select()).toBeNull(); removeEntity(f.world, duplicate);
    expect(f.select()).toEqual({ type: "move", target: "Garden" });
  } finally { remove(); }
});

test("deleted destinations and partial labels never become executable contract moves", () => {
  const f = fixture(), remove = f.attach(); f.setTargets([f.destination]);
  try {
    setGoalContract(f.world, f.goal, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Gard" } });
    expect(f.select()).toBeNull();
    setGoalContract(f.world, f.goal, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Garden" } });
    removeEntity(f.world, f.destination); expect(f.select()).toBeNull();
  } finally { remove(); }
});

test("blocked contract fallback allows repeated real cognition choices without manufacturing failed actions", async () => {
  const f = fixture(), remove = f.attach();
  const registry = createSystemRegistry();
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "The direct route is closed. I can inspect the clues here.", action: { type: "observe", target: "Entry hall" } }) });
  try {
    for (let i = 0; i < 2; i++) {
      const action = await agentThink(f.world, f.actor);
      expect(action).toMatchObject({ type: "observe", target: "Entry hall" });
      executeActions(f.world, [{ eid: f.actor, action }], registry);
      expect(LastAction.type[f.actor]).toBe("observe");
    }
    expect(generate).toHaveBeenCalledTimes(2); expect(Goal.status[f.goal]).toBe("active");
    f.setTargets([f.destination]);
    expect(await agentThink(f.world, f.actor)).toEqual({ type: "move", target: "Garden" });
    expect(generate).toHaveBeenCalledTimes(2);
  } finally { remove(); }
});

test("admission constrains only the deterministic shortcut, not a character's own attempted move", async () => {
  const f = fixture(), remove = f.attach();
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I want to test the door myself.", action: { type: "move", target: "Garden" } }) });
  try {
    expect(f.select()).toBeNull();
    expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Garden" });
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { remove(); }
});
