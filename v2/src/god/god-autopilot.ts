import type { GodAgentState } from "./god-agent";
import type { DivineMessage, MessagePriority } from "../spirits/types";
import { godCommand } from "./god-agent";

export type AutopilotRunResult = {
  ran: boolean;
  reason?: string;
  messagesConsidered: number;
  messagesIncluded: number;
  executed: boolean;
  error?: string;
};

export type GodAutopilotConfig = {
  enabled: boolean;
  minRunIntervalMs: number;
  maxInboxSize: number;
  maxMessagesPerRun: number;
  minPriority: MessagePriority;
};

export type GodAutopilotMessage = {
  id: string;
  timestamp: number;
  fromEid: number;
  fromName: string;
  type: DivineMessage["type"];
  domain: DivineMessage["domain"];
  priority: MessagePriority;
  subject: string;
  content: string;
  data?: Record<string, any>;
  requiresResponse: boolean;
  deadline?: number;
};

export type GodAutopilotState = {
  config: GodAutopilotConfig;
  inbox: GodAutopilotMessage[];
  lastRunAt: number;
  consecutiveFailures: number;
  lastError?: string;
};

const DEFAULT_CONFIG: GodAutopilotConfig = {
  enabled: true,
  minRunIntervalMs: 30_000,
  maxInboxSize: 200,
  maxMessagesPerRun: 6,
  minPriority: "high",
};

function priorityRank(p: MessagePriority): number {
  switch (p) {
    case "urgent":
      return 3;
    case "high":
      return 2;
    case "normal":
      return 1;
    case "low":
      return 0;
  }
}

export function initializeGodAutopilot(
  god: GodAgentState,
  config: Partial<GodAutopilotConfig> = {}
): void {
  const existing = god.autopilot;
  const merged: GodAutopilotConfig = { ...DEFAULT_CONFIG, ...config };
  god.autopilot = existing
    ? { ...existing, config: merged }
    : { config: merged, inbox: [], lastRunAt: 0, consecutiveFailures: 0 };
}

export function isGodAutopilotEnabled(god: GodAgentState): boolean {
  return Boolean(god.autopilot?.config.enabled);
}

export function enqueueSpiritMessages(
  god: GodAgentState,
  messages: DivineMessage[],
  resolveFromName: (fromEid: number) => string
): void {
  if (!god.autopilot) initializeGodAutopilot(god);

  const inbox = god.autopilot!.inbox;
  for (const m of messages) {
    inbox.push({
      id: m.id,
      timestamp: m.timestamp,
      fromEid: m.from,
      fromName: resolveFromName(m.from),
      type: m.type,
      domain: m.domain,
      priority: m.priority,
      subject: m.subject,
      content: m.content,
      data: m.data,
      requiresResponse: m.requiresResponse,
      deadline: m.deadline,
    });
  }

  // Sort by priority desc, then recency desc.
  inbox.sort((a, b) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return b.timestamp - a.timestamp;
  });

  // Bound inbox size (drop oldest/lowest priority).
  const max = god.autopilot!.config.maxInboxSize;
  if (inbox.length > max) {
    inbox.length = max;
  }
}

export function getAutopilotInbox(god: GodAgentState): GodAutopilotMessage[] {
  return god.autopilot?.inbox ?? [];
}

function buildAutopilotCommand(messages: GodAutopilotMessage[]): string {
  const lines: string[] = [];

  lines.push("AUTOPILOT MODE:");
  lines.push("You are GodAI operating autonomously based on spirit/daemon reports.");
  lines.push("");
  lines.push("HARD RULES:");
  lines.push("- Use tool calls to act; do not write long prose.");
  lines.push("- Stay grounded: verify entities/rooms/systems with tools before referencing.");
  lines.push("- Prefer deterministic solutions (rules/systems/schema) over one-off narration.");
  lines.push("- After acting, verify outcomes with list/query tools and task status.");
  lines.push("");
  lines.push("TASK:");
  lines.push("1) Triage the inbox items below (highest priority first).");
  lines.push("2) Take the minimum necessary actions to address the most critical issues.");
  lines.push("3) If you cannot fully resolve an item, send a directive to the appropriate spirit with precise instructions.");
  lines.push("");
  lines.push("INBOX (batched):");

  for (const m of messages) {
    const ts = new Date(m.timestamp).toISOString();
    lines.push(
      `- [${m.priority.toUpperCase()}] ${m.fromName} (${m.domain}) @ ${ts}`
    );
    lines.push(`  subject: ${m.subject}`);
    lines.push(`  content: ${m.content}`);
    if (m.deadline) lines.push(`  deadline: ${new Date(m.deadline).toISOString()}`);
  }

  lines.push("");
  lines.push("When you are done, do a quick verification pass:");
  lines.push("- listSystems, listRules, listObjectTypes (as relevant)");
  lines.push("- getTaskQueueSummary / getTaskStatus (if you queued bakes)");

  return lines.join("\n");
}

export async function runGodAutopilotCycle(
  god: GodAgentState,
  options: {
    executeCommand?: (command: string) => Promise<unknown>;
    now?: number;
  } = {}
): Promise<AutopilotRunResult> {
  if (!god.autopilot) initializeGodAutopilot(god);
  const state = god.autopilot!;

  const now = options.now ?? Date.now();
  const inbox = state.inbox;

  const minInterval = state.config.minRunIntervalMs;
  if (now - state.lastRunAt < minInterval) {
    return {
      ran: false,
      reason: "throttled",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  if (!state.config.enabled) {
    return {
      ran: false,
      reason: "disabled",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  if (inbox.length === 0) {
    return {
      ran: false,
      reason: "no_messages",
      messagesConsidered: 0,
      messagesIncluded: 0,
      executed: false,
    };
  }

  // Filter by min priority
  const threshold = priorityRank(state.config.minPriority);
  const eligible = inbox.filter((m) => priorityRank(m.priority) >= threshold);
  if (eligible.length === 0) {
    return {
      ran: false,
      reason: "no_eligible_messages",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  const batch = eligible.slice(0, state.config.maxMessagesPerRun);
  const command = buildAutopilotCommand(batch);

  const executor = options.executeCommand || ((cmd: string) => godCommand(god, cmd));

  state.lastRunAt = now;
  try {
    await executor(command);

    // Remove included messages from inbox by id (only those we acted on).
    const acted = new Set(batch.map((m) => m.id));
    state.inbox = state.inbox.filter((m) => !acted.has(m.id));

    state.consecutiveFailures = 0;
    state.lastError = undefined;

    return {
      ran: true,
      messagesConsidered: inbox.length,
      messagesIncluded: batch.length,
      executed: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    state.consecutiveFailures++;
    state.lastError = msg;

    return {
      ran: true,
      messagesConsidered: inbox.length,
      messagesIncluded: batch.length,
      executed: false,
      error: msg,
    };
  }
}

