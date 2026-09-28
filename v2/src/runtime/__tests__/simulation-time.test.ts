import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime, getSimulationTimeSnapshot, readSimulationTime } from "../../ecs/simulation-time";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { createMovementSystem, createRoomArrivalSystem, createTimeProgressionSystem, setMovementTarget, clearMovementTarget } from "../../systems/builtin-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { GridPosition, Needs } from "../../ecs/components";
import { createSimulation, pauseSimulation, registerFastSystem, resumeSimulation, startSimulation, stopSimulation, type SimulationState } from "../simulation-loop";
import { stopTaskQueue } from "../async-task-queue";
import { createSimulation as createLibrarySimulation } from "../../index";
import { beginTimedSpeech, advanceTimedSpeech, estimateSpeechDurationMs } from "../../cognition/timed-speech";
import { createTemplateSystem } from "../../god/system-baker";
import { advanceSimulationTimeline, subscribeSimulationBoundaries } from "../simulation-timeline";
import { getRoomForEntity } from "../../ecs/location";

describe("authoritative in-world time", () => {
  const runtimes: SimulationState[] = [];
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    runtimes.splice(0).forEach(stopSimulation);
    stopTaskQueue();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("variable steps accumulate; calendar follows physical elapsed, not tick count or wall time", () => {
    const world = createArgosWorld();
    world.time.simulationHour = 23.5;
    advanceSimulationTime(world, 1, 500);
    jest.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    advanceSimulationTime(world, 2, 1500);
    advanceSimulationTime(world, 3, 3_598_000);
    expect(readSimulationTime(world)).toBe(3_600_000);
    expect(world.time.simulationDay).toBe(2);
    expect(world.time.simulationHour).toBeCloseTo(0.5, 10);
    expect(world.time.timeOfDay).toBe("night");
    expect(world.time.delta).toBe(3_598_000);
  });

  test.each([-1, Number.NaN, Infinity, -Infinity])("invalid delta %s leaves the entire clock unchanged", delta => {
    const world = createArgosWorld();
    const before = getSimulationTimeSnapshot(world);
    expect(() => advanceSimulationTime(world, 1, delta)).toThrow(RangeError);
    expect(getSimulationTimeSnapshot(world)).toEqual(before);
  });

  test("duplicate and reversed ticks cannot double-advance time", () => {
    const world = createArgosWorld();
    advanceSimulationTime(world, 1, 125);
    for (const tick of [1, 0, -1, 1.5]) expect(() => advanceSimulationTime(world, tick, 125)).toThrow(RangeError);
    expect(readSimulationTime(world)).toBe(125);
  });

  test("managed dynamic systems use simulation cadence and accumulated deltas, while diagnostics keep wall timestamps", () => {
    const world = createArgosWorld();
    const registry = createSystemRegistry();
    const samples: Array<[number, number]> = [];
    registerSystem(registry, { name: "Integrator", description: "test", pseudocode: "", active: true, frequency: 400, lastRun: 0,
      compiledFn: (_w, ctx) => { samples.push([ctx.elapsed, ctx.delta]); ctx.emit("integration", {}); } });
    for (const [tick, delta] of [[1, 100], [2, 150], [3, 250], [4, 500]]) {
      advanceSimulationTime(world, tick, delta);
      runSystems(world, registry, tick, delta);
    }
    expect(samples).toEqual([[100, 100], [500, 400], [1000, 500]]);
    expect(registry.events.every(event => event.timestamp === Date.now())).toBe(true);
  });

  test("TimeProgression only projects calendar changes and never advances a second clock", () => {
    const world = createArgosWorld();
    const registry = createSystemRegistry();
    registerSystem(registry, createTimeProgressionSystem());
    advanceSimulationTime(world, 1, 4 * 3_600_000);
    runSystems(world, registry, 1, 4 * 3_600_000);
    runSystems(world, registry, 1, 0);
    expect(world.time.simulationHour).toBe(12);
    expect(registry.events.filter(event => event.type === "time_change")).toHaveLength(1);
  });

  test("library stepping scales once, accepts exact deltas, and gives God the same physical calendar", async () => {
    const sim = await createLibrarySimulation({ name: "Temporal library", enableAI: false, enableSpirits: false,
      dualLoop: false, preset: "minimal", ecsDeltaMs: 100, timeScale: 3 });
    try {
      await sim.step();
      expect(readSimulationTime(sim.world)).toBe(300);
      await sim.step(125);
      expect(readSimulationTime(sim.world)).toBe(425);
      expect(sim.world.time.tick).toBe(2);
      expect(sim.god.globalState.time.hour).toBe(sim.world.time.simulationHour);
      expect(sim.god.globalState.time.dayNumber).toBe(sim.world.time.simulationDay);
      await expect(sim.step(-1)).rejects.toThrow(RangeError);
      expect(sim.world.time.tick).toBe(2);
      expect(sim.god.tick).toBe(2);
    } finally { sim.stop(); }
  });

  function runtime(scale: number) {
    const world = createArgosWorld();
    const state = createSimulation(world, createSystemRegistry(), {} as any,
      { ecsTickRate: 10, timeScale: scale, logTickStats: false });
    runtimes.push(state);
    return state;
  }

  test("10x runtime and ordinary runtime produce the same in-world duration in different wall durations", async () => {
    const accelerated = runtime(10);
    startSimulation(accelerated);
    await jest.advanceTimersByTimeAsync(1000);
    stopSimulation(accelerated);
    const ordinary = runtime(1);
    startSimulation(ordinary);
    await jest.advanceTimersByTimeAsync(10_000);
    stopSimulation(ordinary);
    expect(readSimulationTime(accelerated.world)).toBe(10_000);
    expect(readSimulationTime(ordinary.world)).toBe(10_000);
    expect(accelerated.world.time.simulationHour).toBeCloseTo(ordinary.world.time.simulationHour, 10);
  });

  test("pause and wall-clock jumps cannot leak into resumed physical time", async () => {
    const state = runtime(1);
    const deltas: number[] = [];
    registerFastSystem(state, { name: "Trace", execute: (_w, delta) => deltas.push(delta) });
    startSimulation(state);
    await jest.advanceTimersByTimeAsync(100);
    pauseSimulation(state);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(readSimulationTime(state.world)).toBe(100);
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    resumeSimulation(state);
    await jest.advanceTimersByTimeAsync(100);
    expect(readSimulationTime(state.world)).toBe(200);
    expect(deltas).toEqual([100, 100]);
  });

  test.each([0, -1, NaN, Infinity])("rejects invalid acceleration %s before starting", scale => {
    expect(() => runtime(scale)).toThrow(RangeError);
  });

  test("native walking covers the same grid distance for fine and coarse physical steps", () => {
    function walk(deltas: number[]) {
      const world = createArgosWorld(); initializePrefabs(world);
      const room = createRoomEntity(world, { name: "Origin", x: 0, y: 0 });
      const target = createRoomEntity(world, { name: "Destination", x: 400, y: 0 });
      const actor = createAgentEntity(world, { name: "Walker", role: "tester", systemPrompt: "test", roomId: room, gridPosition: { x: 0, y: 0 } });
      const registry = createSystemRegistry(); registerSystem(registry, createMovementSystem());
      setMovementTarget(actor, target);
      try {
        deltas.forEach((delta, index) => {
          advanceSimulationTime(world, index + 1, delta);
          runSystems(world, registry, index + 1, delta);
        });
        return GridPosition.x[actor];
      } finally { clearMovementTarget(actor); }
    }
    expect(walk(Array(40).fill(50))).toBe(4);
    expect(walk([2000])).toBe(4);
    expect(walk([125, 375, 1500])).toBe(4);
  });

  test("a native movement target continues at physical speed while the independent voice speaks", () => {
    const world = createArgosWorld(); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Origin", x: 0, y: 0 });
    const target = createRoomEntity(world, { name: "Destination", x: 400, y: 0 });
    const actor = createAgentEntity(world, { name: "Walker", role: "tester", systemPrompt: "test", roomId: room, gridPosition: { x: 0, y: 0 } });
    const registry = createSystemRegistry(); registerSystem(registry, createMovementSystem());
    const step = (delta: number) => advanceSimulationTimeline(world, delta, {
      integrate: segment => runSystems(world, registry, world.time.tick, segment),
    });
    setMovementTarget(actor, target);
    try {
      step(500); expect(GridPosition.x[actor]).toBe(1);
      const words = "The red key is beside the window.";
      const finished = jest.fn();
      expect(beginTimedSpeech(world, actor, words, "voice-test", finished, () => {})).toBe(true);
      step(estimateSpeechDurationMs(words));
      const distance = Math.floor((500 + estimateSpeechDurationMs(words)) / 500);
      expect(GridPosition.x[actor]).toBe(distance);
      expect(finished).toHaveBeenCalledTimes(1);
      step(500); expect(GridPosition.x[actor]).toBe(distance + 1);
    } finally { clearMovementTarget(actor); }
  });

  test("library native grid deadlines commit a room crossing before its simultaneous spoken word in coarse and fine ticks", async () => {
    async function run(deltas: number[]) {
      const sim = await createLibrarySimulation({ name: "Native boundary test", enableAI: false, enableSpirits: false, enableServer: false, preset: "minimal", dualLoop: false });
      const world = sim.world; initializePrefabs(world);
      for (const system of sim.god.systemRegistry.systems.values()) system.active = false;
      registerSystem(sim.god.systemRegistry, createMovementSystem()); registerSystem(sim.god.systemRegistry, createRoomArrivalSystem());
      const origin = createRoomEntity(world, { name: "Origin", x: 0, y: 0 });
      const destination = createRoomEntity(world, { name: "Destination", x: 80, y: 0 }); // Room coordinates convert to four grid cells.
      const actor = createAgentEntity(world, { name: "Walker", role: "test", systemPrompt: "test", roomId: origin, gridPosition: { x: 0, y: 0 } });
      const originListener = createAgentEntity(world, { name: "Origin listener", role: "test", systemPrompt: "test", roomId: origin, gridPosition: { x: 0, y: 0 } });
      const destinationListener = createAgentEntity(world, { name: "Destination listener", role: "test", systemPrompt: "test", roomId: destination, gridPosition: { x: 4, y: 0 } });
      let arrivedAt: number | undefined; const heard: Array<{ text: string; at: number; origin: boolean; destination: boolean }> = [];
      const remove = subscribeSimulationBoundaries(world, boundary => { if (getRoomForEntity(world, actor) === destination && arrivedAt === undefined) arrivedAt = boundary.atSimMs; });
      setMovementTarget(actor, destination);
      beginTimedSpeech(world, actor, "one two three four five.", "native-crossing", () => {}, () => {}, { fragment: f => heard.push({ text: f.content, at: f.heardAtSimMs, origin: f.audience.has(originListener), destination: f.audience.has(destinationListener) }) });
      try {
        for (const delta of deltas) await sim.step(delta);
        return { arrivedAt, heard };
      } finally { remove(); clearMovementTarget(actor); sim.stop(); }
    }
    const coarse = await run([3000]), fine = await run(Array(30).fill(100));
    expect(coarse).toEqual(fine); expect(coarse.arrivedAt).toBe(1500);
    expect(coarse.heard[1]).toMatchObject({ text: "two ", origin: true, destination: false });
    expect(coarse.heard[2]).toMatchObject({ text: "three ", at: 1500, origin: false, destination: true });
  });

  test("the canonical needs template integrates equal in-world time equally at different step sizes", () => {
    function decay(deltas: number[]) {
      const world = createArgosWorld(); initializePrefabs(world);
      const room = createRoomEntity(world, { name: "Hall" });
      const actor = createAgentEntity(world, { name: "Ada", role: "tester", systemPrompt: "test", roomId: room });
      const registry = createSystemRegistry();
      const template = createTemplateSystem("needsDecay", world, registry);
      expect(template.success).toBe(true);
      registerSystem(registry, { ...template.system!, active: true });
      Needs.hunger[actor] = 0; Needs.energy[actor] = 100;
      deltas.forEach((delta, index) => { advanceSimulationTime(world, index + 1, delta); runSystems(world, registry, index + 1, delta); });
      return [Needs.hunger[actor], Needs.energy[actor]];
    }
    const fine = decay(Array(100).fill(100)), coarse = decay([10_000]);
    expect(fine[0]).toBeCloseTo(2, 10); expect(fine[1]).toBeCloseTo(99, 10);
    expect(coarse).toEqual([2, 99]);
  });
});
