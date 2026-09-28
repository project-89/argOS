import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import * as autopilot from "../god/god-autopilot";
import type { GodAutopilotReview } from "../god/god-autopilot";
import { WorkingMemoryIdentity } from "../ecs/components";
import { advanceSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";

function fixture() {
  const world = createArgosWorld("Review observation");
  initializePrefabs(world);
  const god = createGodAgent(world, { name: "God", worldName: "Review observation", narrative: "" });
  autopilot.initializeGodAutopilot(god, { minRunIntervalMs: 0, minPriority: "normal" });
  advanceSimulationTime(world, 1, 1000);
  const sourceId = startCommittedEvents(world);
  const enqueue = (id = "review") => autopilot.enqueueSpiritMessages(god, [{
    id, timestamp: Date.now(), from: 123, to: god.eid, type: "report", domain: "guardian",
    priority: "normal", subject: "Observed outcome", content: "An observed meal was consumed.",
    data: { outcome: { consumed: true } }, requiresResponse: false,
  }], () => "Watcher");
  return { world, god, sourceId, enqueue };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("private native God review observations", () => {
  it("observes an attempted batch only after native settlement, with simulation times and selected receipts", async () => {
    const { world, god, sourceId, enqueue } = fixture();
    const events: GodAutopilotReview[] = [];
    const unsubscribe = autopilot.subscribeGodAutopilotReviews(god, event => { events.push(event); });
    enqueue();
    const execution = deferred<unknown>();
    const pending = autopilot.runGodAutopilotCycle(god, { executeCommand: () => execution.promise });
    expect(events).toEqual([]);
    const busy = await autopilot.runGodAutopilotCycle(god, { executeCommand: async () => { throw new Error("must not run"); } });
    expect(busy.reason).toBe("in_flight");
    expect(events).toEqual([]);
    advanceSimulationTime(world, 2, 1500);
    const output = [{ tool: "getSpiritProposals", result: { approved: false } }];
    execution.resolve(output);
    const result = await pending;
    expect(events).toEqual([{ sourceId, startedAtSimMs: 1000, completedAtSimMs: 2500,
      before: [expect.objectContaining({ id: "review", content: "An observed meal was consumed." })], result }]);
    expect(result.executed).toBe(true);
    expect(god.autopilot!.inbox).toEqual([]);
    expect(getCommittedEvents(world).events).toEqual([]);
    unsubscribe();
    enqueue("another");
    await autopilot.runGodAutopilotCycle(god, { executeCommand: async () => [] });
    expect(events).toHaveLength(1);
  });

  it("never emits for empty, disabled, throttled or ineligible opportunities", async () => {
    const { god, enqueue } = fixture();
    const events: GodAutopilotReview[] = [];
    autopilot.subscribeGodAutopilotReviews(god, event => { events.push(event); });
    const executeCommand = async () => { throw new Error("must not run"); };
    expect((await autopilot.runGodAutopilotCycle(god, { executeCommand })).reason).toBe("no_messages");
    enqueue();
    god.autopilot!.config.enabled = false;
    expect((await autopilot.runGodAutopilotCycle(god, { executeCommand })).reason).toBe("disabled");
    god.autopilot!.config.enabled = true;
    god.autopilot!.config.minPriority = "urgent";
    expect((await autopilot.runGodAutopilotCycle(god, { executeCommand })).reason).toBe("no_eligible_messages");
    god.autopilot!.config.minRunIntervalMs = 100;
    god.autopilot!.lastRunAt = 100;
    expect((await autopilot.runGodAutopilotCycle(god, { executeCommand, now: 100 })).reason).toBe("throttled");
    expect(events).toEqual([]);
  });

  it.each(["rejection", "source-restart", "actor-replaced", "cancelled"])(
    "publishes only a failed settled result for %s", async kind => {
      const { world, god, sourceId, enqueue } = fixture();
      const events: GodAutopilotReview[] = [];
      autopilot.subscribeGodAutopilotReviews(god, event => { events.push(event); });
      enqueue();
      const execution = deferred<unknown>();
      const abort = new AbortController();
      const pending = withSimulationTask(abort.signal, () => autopilot.runGodAutopilotCycle(god, {
        executeCommand: () => execution.promise,
      }));
      if (kind === "source-restart") { stopCommittedEvents(world); startCommittedEvents(world); }
      if (kind === "actor-replaced") WorkingMemoryIdentity.id[god.eid] = "replacement-god";
      if (kind === "cancelled") abort.abort(new Error("stopped"));
      expect(events).toEqual([]);
      if (kind === "rejection") execution.reject(new Error("native failed"));
      else execution.resolve([{ mustNotBePublishedAsSuccess: true }]);
      const result = await pending;
      expect(result.executed).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].sourceId).toBe(sourceId);
      expect(events[0].result).toEqual(result);
      expect(events[0].result.actions).toBeUndefined();
      expect(god.autopilot!.inbox).toHaveLength(1);
    }
  );

  it("isolates per-observer copies and exceptions from the inbox, returned result and other observers", async () => {
    const { god, enqueue } = fixture();
    enqueue();
    const admitted = god.autopilot!.inbox[0];
    const output = [{ result: { approved: true } }];
    const events: GodAutopilotReview[] = [];
    autopilot.subscribeGodAutopilotReviews(god, event => {
      event.before[0].data!.outcome.consumed = false;
      (event.result.actions![0] as any).result.approved = false;
      event.result.executed = false;
      throw new Error("broken observer");
    });
    autopilot.subscribeGodAutopilotReviews(god, async () => { throw new Error("async observer failed"); });
    autopilot.subscribeGodAutopilotReviews(god, event => { events.push(event); });
    const result = await autopilot.runGodAutopilotCycle(god, { executeCommand: async () => output });
    await Promise.resolve();
    expect(result.executed).toBe(true);
    expect(result.actions).toEqual([{ result: { approved: true } }]);
    expect(output).toEqual([{ result: { approved: true } }]);
    expect(admitted.data!.outcome.consumed).toBe(true);
    expect(events[0].before[0].data!.outcome.consumed).toBe(true);
    expect(events[0].result).toEqual(result);
    expect(autopilot.getGodAutopilotObserverFailures(god)).toBe(2);
    enqueue("second");
    await autopilot.runGodAutopilotCycle(god, { executeCommand: async () => output });
    await Promise.resolve();
    expect(autopilot.getGodAutopilotObserverFailures(god)).toBe(4);
  });

  it("does not create a source or publish another God's results", async () => {
    const { world, god, enqueue } = fixture();
    stopCommittedEvents(world);
    const events: GodAutopilotReview[] = [];
    autopilot.subscribeGodAutopilotReviews(god, event => { events.push(event); });
    expect(getCommittedEvents(world).stopped).toBe(true);
    expect(autopilot.getGodAutopilotObserverFailures(god)).toBe(0);
    const other = fixture();
    other.enqueue();
    await autopilot.runGodAutopilotCycle(other.god, { executeCommand: async () => [] });
    expect(events).toEqual([]);
  });
});
