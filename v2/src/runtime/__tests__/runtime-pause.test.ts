import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createSimulation, pauseSimulation, registerAIOperation, resumeSimulation, startSimulation, stopSimulation } from "../simulation-loop";
import { initializeTaskQueue, startTaskQueue, stopTaskQueue } from "../async-task-queue";

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  jest.spyOn(console, "log").mockImplementation(() => {}); jest.spyOn(console, "error").mockImplementation(() => {});
  initializeTaskQueue({ processInterval: 10, maxConcurrent: 3, foregroundMaxConcurrent: 1, subconsciousMaxConcurrent: 1 });
  startTaskQueue();
});
afterEach(async () => { await jest.advanceTimersByTimeAsync(20); stopTaskQueue(); jest.useRealTimers(); jest.restoreAllMocks(); });

test("an operator pause holds already-queued AI operations at dispatch and freezes the clock; resume releases them", async () => {
  const state = createSimulation(createArgosWorld("Pause"), {} as any, {} as any, { ecsTickRate: 100, logTickStats: false });
  let release!: () => void; const started: string[] = [];
  registerAIOperation(state, { name: "holder", interval: 1, lane: "foreground", execute: async () => {
    started.push("holder"); if (started.length === 1) await new Promise<void>(resolve => { release = resolve; }); } });
  registerAIOperation(state, { name: "waiting", interval: 1, lane: "foreground", execute: async () => { started.push("waiting"); } });
  startSimulation(state); await jest.advanceTimersByTimeAsync(40);
  // The single foreground slot is held, so "waiting" is enrolled but not started.
  expect(started).toEqual(["holder"]);
  pauseSimulation(state);
  const elapsed = state.world.time.elapsed;
  release(); await jest.advanceTimersByTimeAsync(200);
  expect(started).toEqual(["holder"]); // the freed slot is not used while paused
  expect(state.world.time.elapsed).toBe(elapsed);
  resumeSimulation(state); await jest.advanceTimersByTimeAsync(60);
  expect(started).toContain("waiting");
  expect(state.world.time.elapsed).toBeGreaterThan(elapsed);
  stopSimulation(state);
});
