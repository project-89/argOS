import { jest } from "@jest/globals";
import { addEntity, addComponent, query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { Name, LegacySystemTime } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import { run as fire } from "../generated/fire-system";
import type { SystemContext } from "../system-loader";

afterEach(() => jest.useRealTimers());
const ctx = (delta: number) => ({ tick: 99, delta } as SystemContext);

test("fractional credit integrates authored steps and polling/pause/wall jumps add no physics", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const world = createArgosWorld(), calls: number[] = [];
  const law = (_: unknown, c: SystemContext) => calls.push(c.tick);
  advanceSimulationTime(world, 1, 250); integrateLegacyRateSteps(world, ctx(250), "law", 1000, law);
  expect(calls).toEqual([]);
  jest.setSystemTime(Date.now() + 86_400_000);
  integrateLegacyRateSteps(world, ctx(250), "law", 1000, law);
  advanceSimulationTime(world, 2, 750); integrateLegacyRateSteps(world, ctx(750), "law", 1000, law);
  expect(calls).toEqual([1]);
  advanceSimulationTime(world, 3, 2500); integrateLegacyRateSteps(world, ctx(2500), "law", 1000, law);
  expect(calls).toEqual([1, 2, 3]);
  advanceSimulationTime(world, 4, 0); integrateLegacyRateSteps(world, ctx(0), "law", 1000, law);
  expect(calls).toHaveLength(3);
});

test("fractional credit and sequence survive save/restore and remain world scoped", () => {
  const world = createArgosWorld(), calls: number[] = [];
  advanceSimulationTime(world, 1, 750); integrateLegacyRateSteps(world, ctx(750), "law", 1000, () => {});
  const saved = serializeWorld(world, createSystemRegistry());
  const restored = createArgosWorld(); deserializeWorld(restored, createSystemRegistry(), saved);
  advanceSimulationTime(restored, 2, 250);
  integrateLegacyRateSteps(restored, ctx(250), "law", 1000, (_, c) => calls.push(c.tick));
  expect(calls).toEqual([1]);
  const other = createArgosWorld(); advanceSimulationTime(other, 1, 250);
  integrateLegacyRateSteps(other, ctx(250), "law", 1000, () => calls.push(-1));
  expect(calls).toEqual([1]);
});

test("nonlinear historical fire law reaches identical state and event count with coarse or fine deltas", () => {
  function run(deltas: number[]) {
    const world = createArgosWorld(), eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = "Campfire";
    const Fuel = { current: { [eid]: 2 } }, ObjectState = { state: { [eid]: "burning" } }, events: unknown[] = [];
    for (const delta of deltas) {
      advanceSimulationTime(world, world.time.tick + 1, delta);
      fire(world, { ...ctx(delta), components: { Name }, query, getDynamic: (name: string) => ({ Fuel, ObjectState }[name]),
        hasDynamic: (id: number) => id === eid, emit: (...args: unknown[]) => events.push(args) } as unknown as SystemContext);
    }
    return { fuel: Fuel.current[eid], state: ObjectState.state[eid], events };
  }
  expect(run([5000])).toEqual(run(Array(20).fill(250)));
  expect(run([5000])).toMatchObject({ fuel: 0, state: "out", events: [["narrative_event", { content: "Campfire has burned out." }]] });
});

test("failed substeps cannot replay completed physics on retry", () => {
  const world = createArgosWorld(), calls: number[] = [];
  advanceSimulationTime(world, 1, 3000);
  expect(() => integrateLegacyRateSteps(world, ctx(3000), "law", 1000, (_, c) => {
    calls.push(c.tick); if (c.tick === 2) throw new Error("law failed");
  })).toThrow("law failed");
  integrateLegacyRateSteps(world, ctx(0), "law", 1000, (_, c) => calls.push(c.tick));
  expect(calls).toEqual([1, 2, 3]);
});

test.each([-1, NaN, Infinity])("invalid delta %s fails without allocating metadata", delta => {
  const world = createArgosWorld();
  expect(() => integrateLegacyRateSteps(world, ctx(delta), "law", 1000, () => {})).toThrow();
  expect([...query(world, [LegacySystemTime])]).toHaveLength(0);
});

test("bounded catch-up rejects excessive steps without dropping time", () => {
  const world = createArgosWorld();
  expect(() => integrateLegacyRateSteps(world, ctx(10_001_000), "law", 1000, () => {})).toThrow("smaller simulation steps");
  expect([...query(world, [LegacySystemTime])]).toHaveLength(0);
});
