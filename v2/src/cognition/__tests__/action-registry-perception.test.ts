import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Description, Name, StimulusSource, Traits } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { buildAvailableActionsContext, formatActionsForPrompt, getValidActionTypes } from "../action-registry";
import { registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld("Action menu boundaries"); world.meta.aiEnabled = false; initializePrefabs(world);
  const common = createRoomEntity(world, { name: "Common Room" }), utility = createRoomEntity(world, { name: "Utility Room" }), store = createRoomEntity(world, { name: "Store Room" });
  Description.value[utility] = "UNSEEN_REMOTE_FUSE"; Description.value[store] = "UNSEEN_REMOTE_SECRET";
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Private", roomId: common });
  createAgentEntity(world, { name: "UNPERCEIVED_PERSON", role: "Hidden role", systemPrompt: "Private", roomId: common });
  return { world, common, utility, store, actor };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid action menu calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("package movement targets replace global destinations and validate current Room entities", () => {
  const f = fixture(), object = addEntity(f.world), removed = createRoomEntity(f.world, { name: "Removed" });
  addComponent(f.world, object, Name); Name.value[object] = "NOT_A_ROOM"; removeEntity(f.world, removed);
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: () => false,
    movementTargets: () => [f.common, f.utility, f.utility, object, removed, 900_000, NaN] });
  try {
    expect(buildAvailableActionsContext(f.world, f.actor).availableLocations).toEqual([{ name: "Utility Room", description: "" }]);
    expect(formatActionsForPrompt(f.world, f.actor)).not.toMatch(/Store Room|NOT_A_ROOM|Removed|UNSEEN_REMOTE/);
  } finally { unregister(); }
});

test("an explicit empty movement target list does not fall back to all world rooms", () => {
  const f = fixture();
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: () => false, movementTargets: () => [] });
  try {
    expect(buildAvailableActionsContext(f.world, f.actor).availableLocations).toEqual([]);
    expect(getValidActionTypes(f.world, f.actor)).not.toContain("move");
    expect(formatActionsForPrompt(f.world, f.actor)).not.toContain("PLACES YOU CAN GO");
  } finally { unregister(); }
});

test("legacy worlds retain authored room names but do not gain current remote room descriptions", () => {
  const f = fixture();
  expect(buildAvailableActionsContext(f.world, f.actor).availableLocations).toEqual([
    { name: "Utility Room", description: "" }, { name: "Store Room", description: "" },
  ]);
  expect(formatActionsForPrompt(f.world, f.actor)).not.toContain("UNSEEN_REMOTE");
});

test("a blind action menu hides silent co-located people and unavailable visual actions", () => {
  const f = fixture(); addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = JSON.stringify(["blind"]);
  const held = addEntity(f.world); addComponent(f.world, held, Name); Name.value[held] = "KNOWN_BELL";
  addComponent(f.world, held, StimulusSource); StimulusSource.stimulusType[held] = "sound"; setLocatedIn(f.world, held, f.actor);
  const context = buildAvailableActionsContext(f.world, f.actor), prompt = formatActionsForPrompt(f.world, f.actor);
  expect(context.socialAffordances).toEqual([]);
  expect(prompt).not.toMatch(/UNPERCEIVED_PERSON|UNSEEN_REMOTE|observe:|examine:|can observe/);
  expect(prompt).toContain("KNOWN_BELL"); expect(getValidActionTypes(f.world, f.actor)).toContain("speak");
  expect(context.objectAffordances.some(a => a.action === "observe")).toBe(false);
});

test("sighted actors still get actual local social targets", () => {
  const f = fixture();
  expect(buildAvailableActionsContext(f.world, f.actor).socialAffordances).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "speak", target: "UNPERCEIVED_PERSON" }),
  ]));
});
