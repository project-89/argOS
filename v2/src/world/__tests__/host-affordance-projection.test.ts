import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { setLocatedIn } from "../../ecs/location";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getAvailableAffordances, getKnownAffordances } from "../affordance-availability";

const cleanup: Array<() => void> = [];
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline host catalogue checks")));
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Native capability ownership"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Outside" });
  const actor = createAgentEntity(world, { name: "Ada", roomId: room, role: "resident", systemPrompt: "Use local evidence." });
  const target = createObjectEntity(world, { name: "Phone", roomId: room, traits: ["communication", "usable", "callable", "examinable"] });
  const base = { context: () => "", ready: () => true, busy: () => false, execute: () => false };
  const names = () => getAvailableAffordances(world, actor, target).map(a => a.name);
  return { world, room, remote, actor, target, base, names };
}

test("hosts can restrict native schema operations while preserving their own conditional catalogue", () => {
  const f = fixture();
  const supportsNativeAffordance = jest.fn((_target: number, name: string) => name === "examine");
  const caps = { ...f.base, supportsNativeAffordance,
    affordances: () => [{ name: "inspect_device", requires: [] }],
    knownAffordances: () => [{ name: "reply", requires: [], requiresFreshDecision: true }],
  };
  cleanup.push(registerAgentWorldCapabilities(f.world, f.actor, caps));
  expect(f.names()).toEqual(expect.arrayContaining(["examine", "inspect_device"]));
  expect(f.names()).not.toContain("use_phone"); expect(f.names()).not.toContain("make_call");
  expect(f.names()).not.toContain("reply");
  expect(getKnownAffordances(f.world, f.actor, f.target)).toContainEqual(expect.objectContaining({ name: "reply", requiresFreshDecision: true }));
  expect(supportsNativeAffordance).toHaveBeenCalledWith(f.target, "make_call");
});

test("restriction follows exact package lifetime; default and replacement packages retain native behavior", () => {
  const f = fixture(); expect(f.names()).toEqual(expect.arrayContaining(["use_phone", "make_call"]));
  const restricted = { ...f.base, supportsNativeAffordance: () => false };
  const release = registerAgentWorldCapabilities(f.world, f.actor, restricted); cleanup.push(release);
  expect(f.names()).toEqual([]);
  release(); expect(f.names()).toEqual(expect.arrayContaining(["use_phone", "make_call"]));
  const replacement = registerAgentWorldCapabilities(f.world, f.actor, f.base); cleanup.push(replacement);
  release(); // An older cleanup cannot remove or restrict the replacement.
  expect(f.names()).toEqual(expect.arrayContaining(["use_phone", "make_call"]));
  replacement();
  cleanup.push(registerAgentWorldCapabilities(f.world, f.actor, restricted));
  expect(f.names()).toEqual([]);
});

test("native projection cannot grant access or expose a remote target to the host hook", () => {
  const f = fixture(), supportsNativeAffordance = jest.fn(() => true);
  const caps = { ...f.base, supportsNativeAffordance };
  cleanup.push(registerAgentWorldCapabilities(f.world, f.actor, caps));
  setLocatedIn(f.world, f.target, f.remote);
  expect(f.names()).toEqual([]);
  expect(getKnownAffordances(f.world, f.actor, f.target)).toEqual([]);
  expect(supportsNativeAffordance).not.toHaveBeenCalled();
});
