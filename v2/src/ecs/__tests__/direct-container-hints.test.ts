import { addComponent, addEntity, getRelationTargets, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../world";
import { createRoomEntity, initializePrefabs } from "../prefabs";
import { LocatedIn } from "../relations";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../location";

// getDirectContainer remembers the last container it resolved. Every read must
// still agree with bitecs's own relation scan, however the relation changed.
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world);
  const a = createRoomEntity(world, { name: "A" }), b = createRoomEntity(world, { name: "B" });
  const thing = addEntity(world);
  return { world, a, b, thing, truth: (eid: number) => getRelationTargets(world, eid, LocatedIn)[0] };
}

test("a remembered container follows helper moves and raw relation writes", () => {
  const f = fixture();
  expect(getDirectContainer(f.world, f.thing)).toBeUndefined();
  setLocatedIn(f.world, f.thing, f.a);
  expect(getDirectContainer(f.world, f.thing)).toBe(f.a);
  setLocatedIn(f.world, f.thing, f.b);
  expect(getDirectContainer(f.world, f.thing)).toBe(f.b);
  addComponent(f.world, f.thing, LocatedIn(f.a)); // raw write, bypassing the helper
  expect(getDirectContainer(f.world, f.thing)).toBe(f.truth(f.thing));
  expect(getDirectContainer(f.world, f.thing)).toBe(f.a);
  removeComponent(f.world, f.thing, LocatedIn(f.a));
  expect(getDirectContainer(f.world, f.thing)).toBe(f.truth(f.thing));
  expect(getRoomForEntity(f.world, f.thing)).toBe(f.truth(f.thing));
});

test("a remembered empty container notices a later placement", () => {
  const f = fixture();
  expect(getDirectContainer(f.world, f.thing)).toBeUndefined();
  addComponent(f.world, f.thing, LocatedIn(f.b));
  expect(getDirectContainer(f.world, f.thing)).toBe(f.b);
});

test("removed and recycled entity ids never inherit an old container", () => {
  const f = fixture();
  setLocatedIn(f.world, f.thing, f.a);
  expect(getDirectContainer(f.world, f.thing)).toBe(f.a);
  removeEntity(f.world, f.thing);
  expect(getDirectContainer(f.world, f.thing)).toBeUndefined();
  for (let i = 0; i < 4; i++) {
    const fresh = addEntity(f.world);
    expect(getDirectContainer(f.world, fresh)).toBe(f.truth(fresh));
  }
});

test("worlds do not share remembered containers", () => {
  const one = fixture(), two = fixture();
  setLocatedIn(one.world, one.thing, one.a);
  expect(getDirectContainer(one.world, one.thing)).toBe(one.a);
  expect(getDirectContainer(two.world, two.thing)).toBe(two.truth(two.thing));
});
