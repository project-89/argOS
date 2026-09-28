import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent } from "../god/god-agent";
import {
  enqueueSpiritMessages,
  initializeGodAutopilot,
  runGodAutopilotCycle,
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
});
