import { addEntity, addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name } from "../../ecs/components";
import { consumeSinglePortion, hasFinitePortions, isPortionVessel, transferSinglePortion } from "../finite-portions";
import { transferSinglePortion as libraryTransfer } from "../../index";

test("the library entry point exposes the same mechanic used by native executors", () => {
  expect(libraryTransfer).toBe(transferSinglePortion);
});

function seed(sourceName: string, vesselName: string) {
  const world = createArgosWorld(sourceName), source = addEntity(world), target = addEntity(world);
  const supplyComponent = { stock: [] as number[] }, vesselComponent = { full: [] as boolean[], uses: [] as number[] };
  addComponent(world, source, supplyComponent); addComponent(world, target, vesselComponent);
  addComponent(world, source, Name); Name.value[source] = sourceName;
  addComponent(world, target, Name); Name.value[target] = vesselName;
  const supply = { component: supplyComponent, quantities: supplyComponent.stock };
  const vessel = { component: vesselComponent, filled: vesselComponent.full, consumed: vesselComponent.uses };
  supply.quantities[source] = 3; vessel.filled[target] = false; vessel.consumed[target] = 0;
  return { world, source, target, supply, vessel };
}

test.each([["Coffee pot", "Blue mug"], ["Oil reservoir", "Lantern chamber"]])("%s -> %s uses the same finite-unit law", (sourceName, vesselName) => {
  const f = seed(sourceName, vesselName);
  for (let n = 0; n < 3; n++) {
    expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, 3 - n)).toBe(true);
    expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, 3 - n)).toBe(false);
    expect(f.supply.quantities[f.source] + Number(f.vessel.filled[f.target]) + f.vessel.consumed[f.target]).toBe(3);
    expect(consumeSinglePortion(f.world, f.vessel, f.target, n)).toBe(true);
    expect(consumeSinglePortion(f.world, f.vessel, f.target, n)).toBe(false);
  }
  expect(hasFinitePortions(f.world, f.supply, f.source)).toBe(false);
  expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, 0)).toBe(false);
  expect(f.vessel.consumed[f.target]).toBe(3);
});

test.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("invalid supply %p cannot create a portion", amount => {
  const f = seed("Reservoir", "Chamber"); f.supply.quantities[f.source] = amount;
  expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, amount)).toBe(false);
  expect(f.vessel.filled[f.target]).toBe(false); expect(f.supply.quantities[f.source]).toBe(amount);
});

test("changed supply, wrong component and removed vessel fail without a partial debit", () => {
  const f = seed("Reservoir", "Chamber"); f.supply.quantities[f.source] = 2;
  expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, 3)).toBe(false);
  expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.source, 2)).toBe(false);
  removeEntity(f.world, f.target);
  expect(transferSinglePortion(f.world, f.supply, f.vessel, f.source, f.target, 2)).toBe(false);
  expect(f.supply.quantities[f.source]).toBe(2);
});

test("consumption counters cannot overflow or accept a stale expected value", () => {
  const f = seed("Reservoir", "Chamber"); f.vessel.filled[f.target] = true; f.vessel.consumed[f.target] = Number.MAX_SAFE_INTEGER;
  expect(isPortionVessel(f.world, f.vessel, f.target, true)).toBe(false);
  expect(consumeSinglePortion(f.world, f.vessel, f.target, Number.MAX_SAFE_INTEGER)).toBe(false);
  f.vessel.consumed[f.target] = 1;
  expect(consumeSinglePortion(f.world, f.vessel, f.target, 0)).toBe(false);
  expect(f.vessel.filled[f.target]).toBe(true);
});
