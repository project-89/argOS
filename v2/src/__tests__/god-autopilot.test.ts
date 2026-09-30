import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import {
  enqueueSpiritMessages,
  initializeGodAutopilot,
  runGodAutopilotCycle,
  setGodTriage,
  subscribeGodAutopilotReviews,
} from "../god/god-autopilot";
import type { DivineMessage } from "../spirits/types";

function msg(partial: Partial<DivineMessage> & { id: string; priority: DivineMessage["priority"] }): DivineMessage {
  return {
    id: partial.id,
    timestamp: partial.timestamp ?? Date.now(),
    from: partial.from ?? 123,
    to: partial.to ?? 1,
    type: partial.type ?? "report",
    domain: partial.domain ?? "guardian",
    priority: partial.priority,
    subject: partial.subject ?? "Subject",
    content: partial.content ?? "Content",
    data: partial.data,
    requiresResponse: partial.requiresResponse ?? false,
    responseTo: partial.responseTo,
    deadline: partial.deadline,
  };
}

describe("GodAI autopilot", () => {
  it("reviews eligible receipts independently and retains each until its own review", async () => {
    const world = createArgosWorld("TestWorld");
    initializePrefabs(world);
    const god = createGodAgent(world, { name: "God", worldName: "TestWorld", narrative: "" });

    initializeGodAutopilot(god, {
      enabled: true,
      minRunIntervalMs: 0,
      minPriority: "high",
      maxMessagesPerRun: 2,
      maxInboxSize: 50,
    });

    const messages: DivineMessage[] = [
      msg({ id: "m_low", priority: "normal", subject: "low", content: "low content", from: 2 }),
      msg({ id: "m_high", priority: "high", subject: "high", content: "high content", from: 3 }),
      msg({ id: "m_urgent", priority: "urgent", subject: "urgent", content: "urgent content", from: 4 }),
    ];

    messages.forEach(message=>message.to=god.eid);
    enqueueSpiritMessages(god, messages, (eid) => `Spirit#${eid}`);

    const seen: string[] = [];
    const res = await runGodAutopilotCycle(god, {
      now: Date.now(),
      executeCommand: async (command) => {
        seen.push(command);
      },
    });

    expect(res.ran).toBe(true);
    expect(res.executed).toBe(true);
    expect(res.messagesIncluded).toBe(1);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("urgent content");
    expect(seen[0]).not.toContain("high content");
    expect(seen[0]).not.toContain("low content");

    expect(god.autopilot?.inbox.map((m) => m.id)).toEqual(["m_high", "m_low"]);
    const next = await runGodAutopilotCycle(god, { executeCommand: async command => { seen.push(command); } });
    expect(next).toMatchObject({ ran: true, executed: true, messagesIncluded: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("high content");
    expect(seen[1]).not.toContain("urgent content");
    expect(seen[1]).not.toContain("low content");
    // Only the non-eligible message remains after both independent reviews.
    expect(god.autopilot?.inbox.map((m) => m.id)).toEqual(["m_low"]);
  });

  it("a fast triage in front of God: passed-over reports leave without inference, taken ones and urgent ones reach the review, silence falls through", async () => {
    const world = createArgosWorld("TriageWorld");
    initializePrefabs(world);
    const god = createGodAgent(world, { name: "God", worldName: "TriageWorld", narrative: "" });
    initializeGodAutopilot(god, { enabled: true, minRunIntervalMs: 0, minPriority: "normal", maxMessagesPerRun: 1, maxInboxSize: 50 });
    const judged: string[] = [];
    setGodTriage(god, async m => { judged.push(m.id); return m.subject === "routine" ? { act: false, why: "routine" } : m.subject === "silent" ? undefined : { act: true }; });
    const reviews: string[] = [];
    subscribeGodAutopilotReviews(god, r => { reviews.push(`${r.before[0].id}:${r.result.reason ?? (r.result.executed ? "executed" : "failed")}`); });
    const messages = [msg({ id: "a", priority: "normal", subject: "routine", timestamp: Date.now() - 3 }), msg({ id: "b", priority: "high", subject: "a storm is coming", timestamp: Date.now() - 2 }),
      msg({ id: "c", priority: "urgent", subject: "routine", timestamp: Date.now() - 1 }), msg({ id: "d", priority: "normal", subject: "silent" })];
    messages.forEach(m => m.to = god.eid);
    enqueueSpiritMessages(god, messages, eid => `Spirit#${eid}`);
    const sent: string[] = [];
    const run = () => runGodAutopilotCycle(god, { executeCommand: async command => { sent.push(command); } });
    expect(await run()).toMatchObject({ executed: true });   // c: urgent, never triaged
    expect(await run()).toMatchObject({ executed: true });   // b: taken
    expect(await run()).toMatchObject({ executed: true });   // d: no answer, falls through
    expect(await run()).toMatchObject({ ran: true, reason: "triaged", executed: false }); // a: passed over
    expect(sent).toHaveLength(3);
    expect(judged).toEqual(["b", "d", "a"]);
    expect(god.autopilot!.inbox).toHaveLength(0);
    expect(reviews).toEqual(["c:executed", "b:executed", "d:executed", "a:triaged"]);
  });
});
