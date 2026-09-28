import { jest } from "@jest/globals";
import { SpatialDemo } from "../spatial-demo";
import { Position } from "../../ecs/components";
import { getCommittedEvents } from "../../runtime/committed-events";
import { getSimulationBodyActivity, isSimulationResourceBusy, scheduleSimulationEvent } from "../../runtime/simulation-timeline";
import { withSimulationTask } from "../../runtime/task-scope";
import { beginTimedSpeech, isSpeaking } from "../../cognition/timed-speech";
import { readSimulationTime } from "../../ecs/simulation-time";

// Exercise real runtime shutdown with AI disabled, never a provider/live trial.
let demo: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Shutdown regression is offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  demo = await SpatialDemo.create({ live: false, automaticClock: false });
  await demo.start(); await demo.sim.start();
});
afterEach(async () => {
  try { demo.stop(); } finally { demo.sim.stop(); await demo.sim.drainPendingOperations(1000); }
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});
const stopped = () => {
  expect(demo.running).toBe(false); expect(demo.sim.running).toBe(false);
  expect(getCommittedEvents(demo.sim.world).stopped).toBe(true);
  expect(demo.sim.getRuntimeStatus()?.fastSystemHealth).toMatchObject({ lifecycle: "stopped", sourceCurrent: false });
};
const remainsStopped = async () => {
  await demo.sim.drainPendingOperations(1000);
  expect(demo.sim.getRuntimeStatus()?.pendingTasks).toBe(0);
  const tick = demo.sim.world.time.tick, runtimeTick = demo.sim.getRuntimeStatus()?.tick;
  await new Promise(resolve => setTimeout(resolve, 150));
  stopped(); expect(demo.sim.world.time.tick).toBe(tick);
  expect(demo.sim.getRuntimeStatus()?.tick).toBe(runtimeTick);
  expect(demo.sim.getRuntimeStatus()?.pendingTasks).toBe(0);
};
const failureMessages = (error: unknown): string[] => error instanceof AggregateError
  ? error.errors.flatMap(failureMessages) : [String(error)];

test("an aborted task can fully stop pending native movement and the real runtime", async () => {
  const actor = demo.snapshot().actors[0], room = demo.snapshot().rooms.find(r => r.id === demo.byId.get("street"))!;
  const controller = new AbortController(), before = { x: Position.x[actor.id], y: Position.y[actor.id] };
  await withSimulationTask(controller.signal, async () => {
    demo.dispatch(actor.key, "move", room.key);
    expect(demo.spatial.busy(actor.id)).toBe(true);
    controller.abort();
    expect(() => demo.stop()).not.toThrow();
  });
  stopped(); expect(demo.spatial.busy(actor.id)).toBe(false);
  expect(getSimulationBodyActivity(demo.sim.world, actor.id)).toBeUndefined();
  expect({ x: Position.x[actor.id], y: Position.y[actor.id] }).toEqual(before);
  expect(getCommittedEvents(demo.sim.world).events.some(e => e.action === "move" && e.status === "succeeded")).toBe(false);
  expect(() => demo.stop()).not.toThrow();
  await remainsStopped();
  expect({ x: Position.x[actor.id], y: Position.y[actor.id] }).toEqual(before);
});

test("a throwing disposal consumer cannot skip native stop or later listeners and remains reported", async () => {
  const [actor, other] = demo.actors, room = demo.byId.get("street")!, delivered = jest.fn(), listener = jest.fn();
  const first = jest.fn(() => { throw Error("Actual disposal consumer failure"); });
  expect(demo.spatial.requestMove(actor, room, first).ok).toBe(true);
  expect(demo.spatial.requestMove(other, room, delivered).ok).toBe(true);
  demo.onStop(() => { throw Error("Actual observer failure"); }); demo.onStop(listener);
  let failure: unknown; try { demo.stop(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  expect(String(failure)).toContain("cleanup");
  expect(failureMessages(failure)).toEqual(expect.arrayContaining([
    "Error: Actual disposal consumer failure", "Error: Actual observer failure",
  ]));
  stopped(); expect(demo.spatial.busy(actor)).toBe(false); expect(demo.spatial.busy(other)).toBe(false);
  expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", reportable: false }));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(() => demo.stop()).not.toThrow(); expect(first).toHaveBeenCalledTimes(1);
  await remainsStopped();
});

test("a throwing native timeline cancellation cannot strand runtime or skip later cancellations", async () => {
  const world = demo.sim.world, second = jest.fn(), run = jest.fn();
  scheduleSimulationEvent(world, { atSimMs: readSimulationTime(world) + 10_000, run,
    cancel: () => { throw Error("Actual native timeline cancellation failure"); } });
  scheduleSimulationEvent(world, { atSimMs: readSimulationTime(world) + 10_000, run, cancel: second });
  let failure: unknown; try { demo.stop(); } catch (error) { failure = error; }
  expect(failureMessages(failure)).toContain("Error: Actual native timeline cancellation failure");
  stopped(); expect(second).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
  await remainsStopped(); expect(() => demo.stop()).not.toThrow();
});

test("a throwing native voice abandonment cannot strand runtime or leave another voice alive", async () => {
  const world = demo.sim.world, [actor, other] = demo.actors, abandoned = jest.fn(), finished = jest.fn();
  expect(beginTimedSpeech(world, actor, "First pending voice", "shutdown-first", finished,
    () => { throw Error("Actual native voice abandonment failure"); })).toBe(true);
  expect(beginTimedSpeech(world, other, "Second pending voice", "shutdown-second", finished, abandoned)).toBe(true);
  let failure: unknown; try { demo.stop(); } catch (error) { failure = error; }
  expect(failureMessages(failure)).toContain("Error: Actual native voice abandonment failure");
  stopped(); expect(abandoned).toHaveBeenCalledTimes(1); expect(finished).not.toHaveBeenCalled();
  for (const eid of [actor, other]) {
    expect(isSpeaking(world, eid)).toBe(false);
    expect(isSimulationResourceBusy(world, eid, "voice")).toBe(false);
  }
  await remainsStopped(); expect(() => demo.stop()).not.toThrow();
});
