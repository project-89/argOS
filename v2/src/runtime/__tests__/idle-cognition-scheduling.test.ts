import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { ObjectState } from "../../ecs/components";
import { getForegroundCognitionReadiness, isForegroundCognitionReady, recordCognitionOutcome } from "../../cognition/idle-cognition";
import { createSimulation, registerAIOperation, registerFastSystem, startSimulation, stopSimulation, type SimulationState } from "../simulation-loop";
import { initializeTaskQueue, startTaskQueue, stopTaskQueue } from "../async-task-queue";

describe("idle foreground leaves physics and subconscious scheduling alive", () => {
  let runtime: SimulationState;
  beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    jest.spyOn(console, "log").mockImplementation(() => {});
    initializeTaskQueue({ processInterval: 10, maxConcurrent: 3, foregroundMaxConcurrent: 2, subconsciousMaxConcurrent: 2 });
    startTaskQueue();
  });
  afterEach(async () => {
    if (runtime) stopSimulation(runtime);
    await jest.advanceTimersByTimeAsync(20); stopTaskQueue(); jest.useRealTimers(); jest.restoreAllMocks();
  });
  function setup() {
    const world = createArgosWorld("Paced foreground"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Common Room" });
    const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Act from perception.", roomId: room });
    const lamp = createObjectEntity(world, { name: "Lamp", roomId: room, portable: false });
    runtime = createSimulation(world, {} as any, {} as any, { ecsTickRate: 100, logTickStats: false });
    return { world, actor, lamp };
  }

  test("quiet model admissions stop while deterministic systems and background work continue", async () => {
    const f = setup(); let physicsTicks = 0; let subconsciousCalls = 0; let decisions = 0;
    registerFastSystem(runtime, { name: "Physics", execute: () => { physicsTicks++; } });
    registerAIOperation(runtime, { name: "Background planning", lane: "subconscious", interval: 1,
      execute: async () => { subconsciousCalls++; } });
    registerAIOperation(runtime, { name: "Mara foreground", lane: "foreground", interval: 1,
      ready: () => isForegroundCognitionReady(f.world, f.actor),
      execute: async () => { decisions++; recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false }); } });
    startSimulation(runtime); await jest.advanceTimersByTimeAsync(500);
    expect(decisions).toBe(1);
    expect(physicsTicks).toBeGreaterThanOrEqual(45);
    expect(subconsciousCalls).toBeGreaterThan(10);
    expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("quiet");
    ObjectState.current[f.lamp] = "broken";
    await jest.advanceTimersByTimeAsync(30);
    expect(decisions).toBe(2); // current local evidence, not the 2s idle deadline
  });

  test("a real input wakes within scheduling latency and survives an occupied physical actor", async () => {
    const f = setup(); let decisions = 0; let busy = false; let pendingInputs = 0; let receivedInputs = 0;
    registerAIOperation(runtime, { name: "Mara foreground", lane: "foreground", interval: 1,
      ready: () => !busy && isForegroundCognitionReady(f.world, f.actor, { hasPendingStimuli: pendingInputs > 0 }),
      execute: async () => {
        decisions++; receivedInputs += pendingInputs; pendingInputs = 0;
        recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false });
      } });
    startSimulation(runtime); await jest.advanceTimersByTimeAsync(50);
    expect(decisions).toBe(1);
    busy = true; pendingInputs = 1;
    await jest.advanceTimersByTimeAsync(200);
    expect(pendingInputs).toBe(1); expect(decisions).toBe(1);
    busy = false; await jest.advanceTimersByTimeAsync(30);
    expect(decisions).toBe(2); expect(receivedInputs).toBe(1); expect(pendingInputs).toBe(0);
    await jest.advanceTimersByTimeAsync(100);
    expect(receivedInputs).toBe(1); // never consumes readiness probes as events
  });

  test("an in-flight model does not rebuild its sensory readiness snapshot every physics tick", async () => {
    setup(); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = jest.fn(() => true);
    registerAIOperation(runtime, { name: "Held foreground", interval: 1, lane: "foreground", ready, execute: () => held });
    startSimulation(runtime);
    try {
      await jest.advanceTimersByTimeAsync(500);
      expect(runtime.tick).toBeGreaterThanOrEqual(45);
      expect(ready).toHaveBeenCalledTimes(2); // enrollment + actual dispatch only
    } finally { stopSimulation(runtime); release(); }
  });
});
