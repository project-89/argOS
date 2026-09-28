import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import { advanceSimulationTime, readSimulationTime } from "../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { createSpiritRegistry, setGodAgent } from "../spirits/spirit-registry";
import { bindSpiritMessageDelivery, captureGodMessageDelivery } from "../spirits/spirit-message-delivery";
import type { DivineMessage } from "../spirits/types";
import { enqueueSpiritMessages, getAutopilotInbox, initializeGodAutopilot, runGodAutopilotCycle,
  subscribeGodAutopilotReviews, type GodAutopilotReview } from "../god/god-autopilot";

function fixture() {
  const world = createArgosWorld("Independent report lifetimes");
  initializePrefabs(world); startCommittedEvents(world);
  const god = createGodAgent(world, { name: "God", worldName: "Independent report lifetimes", narrative: "" });
  const registry = createSpiritRegistry(world); setGodAgent(registry, god.eid);
  initializeGodAutopilot(god, { minRunIntervalMs: 0, minPriority: "normal" });
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  const send = (name: string, options: { expires?: number; priority?: DivineMessage["priority"]; data?: any;
    deadline?: number; timestamp?: number; current?: () => boolean } = {}) => {
    const message: DivineMessage = { id: name, timestamp: options.timestamp ?? Date.now(), from: 123,
      to: god.eid, type: "report", domain: "guardian", priority: options.priority ?? "normal",
      subject: name, content: `${name}_CONTENT`, data: options.data, requiresResponse: false, deadline: options.deadline };
    bindSpiritMessageDelivery(registry, message, options.current ?? (() => true),
      options.expires === undefined ? undefined : { expiresAtSimMs: options.expires });
    enqueueSpiritMessages(god, [message], () => "Watcher");
    return message;
  };
  return { world, god, registry, advance, send };
}

describe("God report timing admission", () => {
  it("isolates the fresh 86.5s report from the expiring 71.5s report at 101.5s", async () => {
    const f = fixture(), reviews: GodAutopilotReview[] = [];
    subscribeGodAutopilotReviews(f.god, review => { reviews.push(review); });
    f.advance(71500);
    f.send("OLDER", { expires: 101500, timestamp: Date.now() - 30000 });
    f.advance(15000);
    f.send("FRESH", { expires: 116500, timestamp: Date.now() - 15000 });
    f.advance(15000);
    const result = await runGodAutopilotCycle(f.god, { executeCommand: async command => {
      expect(command).toContain("FRESH_CONTENT"); expect(command).not.toContain("OLDER_CONTENT");
      f.advance(7000); return [];
    } });
    expect(result).toMatchObject({ ran: true, executed: true, messagesConsidered: 2, messagesIncluded: 1,
      messagesDeferred: 1, deferredReason: "insufficient_review_window" });
    expect(reviews).toHaveLength(1); expect(reviews[0].before.map(m => m.subject)).toEqual(["FRESH"]);
    // The old report was neither acknowledged nor removed as successful work.
    expect(f.god.autopilot!.inbox.map(m => m.subject)).toEqual(["OLDER"]);
    expect(getAutopilotInbox(f.god)).toEqual([]); // ordinary expiry now retires it
  });

  it("keeps independently guarded reports separate even when both have ample known lifetime", async () => {
    const f = fixture(); let olderCurrent = true;
    f.send("OLDER", { expires: 30000, timestamp: Date.now() - 1000, current: () => olderCurrent });
    f.send("NEWER", { expires: 30000 });
    const result = await runGodAutopilotCycle(f.god, { executeCommand: async command => {
      expect(command).toContain("NEWER_CONTENT"); expect(command).not.toContain("OLDER_CONTENT");
      olderCurrent = false; return [];
    } });
    expect(result).toMatchObject({ executed: true, messagesIncluded: 1 });
    expect(f.god.autopilot!.inbox.map(m => m.subject)).toEqual(["OLDER"]);
  });

  it("does not dispatch, throttle, acknowledge or publish a too-late singleton", async () => {
    const f = fixture(), reviews: GodAutopilotReview[] = [];
    subscribeGodAutopilotReviews(f.god, review => { reviews.push(review); });
    f.send("LATE", { expires: 9999 });
    const result = await runGodAutopilotCycle(f.god, { executeCommand: async () => { throw Error("must not dispatch"); } });
    expect(result).toMatchObject({ ran: false, executed: false, reason: "insufficient_review_window", messagesIncluded: 0,
      messagesDeferred: 1, deferredReason: "insufficient_review_window" });
    expect(f.god.autopilot!.lastRunAt).toBe(0); expect(f.god.autopilot!.consecutiveFailures).toBe(0);
    expect(getAutopilotInbox(f.god)).toHaveLength(1); expect(reviews).toEqual([]);
  });

  it("cannot use forged message data to extend or invent a native expiry", async () => {
    const f = fixture();
    f.send("TOO_LATE", { expires: 5000, data: { expiresAtSimMs: 999999999, observedAtSimMs: 999999999 } });
    expect(await runGodAutopilotCycle(f.god, { executeCommand: async () => { throw Error("must not dispatch"); } }))
      .toMatchObject({ ran: false, reason: "insufficient_review_window" });
    // Conversely, arbitrary historical data cannot invent a scheduling deadline.
    f.send("UNKNOWN_NATIVE_EXPIRY", { priority: "high", data: { expiresAtSimMs: 1, observedAtSimMs: -999999999 } });
    expect((await runGodAutopilotCycle(f.god, { executeCommand: async () => [] })).executed).toBe(true);
  });

  it("captures optional native expiry by value and enforces it without replacing a stricter guard", () => {
    const f = fixture(); let current = true;
    const message = f.send("BOUND", { expires: 20000, current: () => current });
    const binding = captureGodMessageDelivery(f.world, f.god.eid, message)!;
    expect(binding.expiresAtSimMs).toBe(20000);
    (binding as any).expiresAtSimMs = 999999;
    expect(captureGodMessageDelivery(f.world, f.god.eid, message)!.expiresAtSimMs).toBe(20000);
    current = false; expect(binding.current()).toBe(false);
    current = true; f.advance(20001); expect(binding.current()).toBe(false);
  });

  it("cannot extend an already admitted lifetime by rebinding the same message", () => {
    const f = fixture(), message = f.send("BOUND", { expires: 15000 });
    const binding = captureGodMessageDelivery(f.world, f.god.eid, message)!;
    bindSpiritMessageDelivery(f.registry, message, () => true, { expiresAtSimMs: 999999 });
    expect(binding.current()).toBe(false);
    expect(getAutopilotInbox(f.god)).toEqual([]);
  });

  it.each([NaN, Infinity, -1])("invalid native expiry %p fails closed", expires => {
    const f = fixture(); f.send("INVALID", { expires });
    expect(getAutopilotInbox(f.god)).toEqual([]);
  });

  it("checks simulation headroom even when wall deadlines are far away", async () => {
    const f = fixture(); f.send("SIM_LATE", { expires: 5000, deadline: Date.now() + 100000 });
    expect((await runGodAutopilotCycle(f.god, { executeCommand: async () => [] })).reason).toBe("insufficient_review_window");
  });

  it("checks wall headroom separately when simulation time is not advancing", async () => {
    const f = fixture(); f.send("WALL_LATE", { expires: 100000, deadline: Date.now() + 5000 });
    expect((await runGodAutopilotCycle(f.god, { executeCommand: async () => [] })).reason).toBe("insufficient_review_window");
    expect(readSimulationTime(f.world)).toBe(0);
  });

  it("honors configurable headroom without changing the default review throttle", async () => {
    const f = fixture();
    initializeGodAutopilot(f.god, { minPriority: "normal", minReviewWindowMs: 2000 });
    expect(f.god.autopilot!.config.minRunIntervalMs).toBe(30000);
    f.send("SHORT_BUT_ELIGIBLE", { expires: 5000 });
    expect((await runGodAutopilotCycle(f.god, { executeCommand: async () => [] })).executed).toBe(true);
  });

  it.each([NaN, Infinity, -1])("rejects invalid configured review headroom %p", minReviewWindowMs => {
    const f = fixture(); expect(() => initializeGodAutopilot(f.god, { minReviewWindowMs })).toThrow("review window");
  });

  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid batch ceiling %p rather than silently dispatching one", maxMessagesPerRun => {
    const f = fixture(); expect(() => initializeGodAutopilot(f.god, { maxMessagesPerRun })).toThrow("maxMessagesPerRun");
  });

  it("does not override a zero ceiling in directly edited or restored configuration", async () => {
    const f = fixture(); f.send("CURRENT", { expires: 30000 });
    f.god.autopilot!.config.maxMessagesPerRun = 0;
    expect(await runGodAutopilotCycle(f.god, { executeCommand: async () => { throw Error("must not dispatch"); } }))
      .toMatchObject({ ran: false, executed: false, reason: "invalid_batch_limit" });
    expect(getAutopilotInbox(f.god)).toHaveLength(1);
  });

  it.each([-1, NaN, Infinity])("rejects directly edited or restored review headroom %p at dispatch", async minReviewWindowMs => {
    const f = fixture(); f.send("CURRENT", { expires: 30000 });
    f.god.autopilot!.config.minReviewWindowMs = minReviewWindowMs;
    expect(await runGodAutopilotCycle(f.god, { executeCommand: async () => { throw Error("must not dispatch"); } }))
      .toMatchObject({ ran: false, executed: false, reason: "invalid_review_window" });
    expect(f.god.autopilot!.lastRunAt).toBe(0);
    expect(getAutopilotInbox(f.god)).toHaveLength(1);
  });

  it("still rejects an eligible singleton that expires during a long native review", async () => {
    const f = fixture(), reviews: GodAutopilotReview[] = [];
    f.send("LONG", { expires: 15000 });
    subscribeGodAutopilotReviews(f.god, review => { reviews.push(review); });
    const result = await runGodAutopilotCycle(f.god, { executeCommand: async () => { f.advance(15001); return []; } });
    expect(result).toMatchObject({ ran: true, executed: false }); expect(result.error).toContain("expired during inference");
    expect(reviews[0].result.executed).toBe(false); expect(f.god.autopilot!.inbox).toHaveLength(1);
  });

  it.each(["restart", "cancel"])("preserves %s invalidation for eligible report execution", async kind => {
    const f = fixture(), abort = new AbortController(); f.send("CURRENT", { expires: 30000 });
    const result = await withSimulationTask(abort.signal, () => runGodAutopilotCycle(f.god, { executeCommand: async () => {
      if (kind === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
      else abort.abort();
      return [];
    } }));
    expect(result).toMatchObject({ ran: true, executed: false });
  });

  it("preserves proposal fairness and urgent precedence among window-eligible receipts", async () => {
    const f = fixture();
    f.send("PROPOSAL", { expires: 120000, timestamp: Date.now() - 1000, data: { proposal: { id: "proposal-1" } } });
    f.send("HIGH", { priority: "high", expires: 30000 });
    const subjects: string[] = [];
    const executeCommand = async (command: string) => { subjects.push(command); return []; };
    await runGodAutopilotCycle(f.god, { executeCommand });
    expect(subjects.at(-1)).toContain("HIGH_CONTENT");
    f.send("URGENT", { priority: "urgent", expires: 30000 });
    await runGodAutopilotCycle(f.god, { executeCommand });
    expect(subjects.at(-1)).toContain("URGENT_CONTENT"); expect(subjects.at(-1)).not.toContain("PROPOSAL_CONTENT");
    f.send("TOO_LATE_URGENT", { priority: "urgent", expires: 1 });
    f.send("NEW_HIGH", { priority: "high", expires: 30000 });
    const final = await runGodAutopilotCycle(f.god, { executeCommand });
    expect(subjects.at(-1)).toContain("PROPOSAL_CONTENT"); expect(subjects.at(-1)).not.toContain("TOO_LATE_URGENT_CONTENT");
    expect(final).toMatchObject({ executed: true, messagesDeferred: 1 });
    expect(getAutopilotInbox(f.god).map(m => m.subject)).toEqual(["TOO_LATE_URGENT", "NEW_HIGH"]);
  });
});
