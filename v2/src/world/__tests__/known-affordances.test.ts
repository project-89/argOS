import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { ObjectState, Traits } from "../../ecs/components";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getAvailableAffordances, getKnownAffordances } from "../affordance-availability";
import type { AffordanceDefinition } from "../schema";

const cleanup: Array<() => void> = [];
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Catalogue tests are offline")));
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Known is not executable"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Elsewhere" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use local evidence.", roomId: room });
  const target = createObjectEntity(world, { name: "Spindle", roomId: room, portable: false });
  const box = createObjectEntity(world, { name: "Opaque box", roomId: room, portable: false });
  let known: AffordanceDefinition[] = [{ name: "wind", requires: [], description: "Wind after fitting a bobbin." }];
  let available: AffordanceDefinition[] = [];
  const hook = jest.fn((_target: number) => known);
  cleanup.push(registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, knownAffordances: hook, affordances: () => available }));
  return { world, room, remote, actor, target, box, hook,
    setKnown: (value: AffordanceDefinition[]) => { known = value; }, setAvailable: (value: AffordanceDefinition[]) => { available = value; } };
}

test("a public operation can be known before executable without changing ECS possession or state", () => {
  const f = fixture(); ObjectState.current[f.target] = "unprepared";
  expect(getKnownAffordances(f.world, f.actor, f.target).map(a => a.name)).toContain("wind");
  expect(getAvailableAffordances(f.world, f.actor, f.target).map(a => a.name)).not.toContain("wind");
  expect(ObjectState.current[f.target]).toBe("unprepared"); expect(getDirectContainer(f.world, f.target)).toBe(f.room);
  f.setAvailable([{ name: "wind", requires: [] }]);
  expect(getAvailableAffordances(f.world, f.actor, f.target).map(a => a.name)).toContain("wind");
});

test.each(["remote", "closed", "hidden", "blind", "removed"])("%s target never invokes a catalogue callback to discover commands", change => {
  const f = fixture();
  if (change === "remote") setLocatedIn(f.world, f.target, f.remote);
  if (change === "closed") { setLocatedIn(f.world, f.target, f.box); ObjectState.current[f.box] = "closed"; }
  if (change === "hidden") { addComponent(f.world, f.target, Traits); Traits.active[f.target] = '["hidden"]'; }
  if (change === "blind") { addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]'; }
  if (change === "removed") removeEntity(f.world, f.target);
  expect(getKnownAffordances(f.world, f.actor, f.target)).toEqual([]); expect(f.hook).not.toHaveBeenCalled();
});

test("known names cannot authorize an ungranted host tool or an unimplemented backend", () => {
  const f = fixture();
  f.setKnown([{ name: "host_shell", requires: [], effects: [{ type: "run_tool", toolId: "terminal.run" }] },
    { name: "not_implemented", requires: [], unavailableReason: "No real backend" }]);
  const names = getKnownAffordances(f.world, f.actor, f.target).map(a => a.name);
  expect(names).not.toContain("host_shell"); expect(names).not.toContain("not_implemented");
});

test.each(["catalogue", "available"])("%s fresh-decision constraint survives merging the same command", source => {
  const f = fixture();
  f.setKnown([{ name: "respond", requires: [], requiresFreshDecision: source === "catalogue" }]);
  f.setAvailable([{ name: "respond", requires: [], requiresFreshDecision: source === "available" }]);
  expect(getKnownAffordances(f.world, f.actor, f.target).filter(a => a.name === "respond"))
    .toMatchObject([{ requiresFreshDecision: true }]);
});
