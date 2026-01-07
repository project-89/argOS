import { createEventId } from "../core/ids";
import { getAgent, ArgosWorld } from "../core/ecs";
import type { CognitiveEvent, CognitiveEventType, CognitiveMode, Stimulus } from "../core/types";

export function getCognitiveStream(world: ArgosWorld, eid: number): CognitiveEvent[] {
  const agent = getAgent(world, eid);
  return agent?.mind.stream ?? [];
}

export function getRecentStream(world: ArgosWorld, eid: number, count: number = 20): CognitiveEvent[] {
  const stream = getCognitiveStream(world, eid);
  return stream.slice(-count);
}

export function addCognitiveEvent(
  world: ArgosWorld,
  eid: number,
  config: {
    type: CognitiveEventType;
    content: string;
    causedBy?: string[];
    salience?: number;
    relevance?: number;
    confidence?: number;
    metadata?: Record<string, any>;
  }
): CognitiveEvent | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;

  const stream = agent.mind.stream;

  const event: CognitiveEvent = {
    id: createEventId(),
    type: config.type,
    content: config.content,
    timestamp: Date.now(),
    causedBy: config.causedBy ?? [],
    causes: [],
    salience: config.salience ?? 0.5,
    relevance: config.relevance ?? 0.5,
    confidence: config.confidence ?? 0.8,
    metadata: config.metadata ?? {},
  };

  for (const causeId of event.causedBy) {
    const causeEvent = stream.find((e) => e.id === causeId);
    if (causeEvent) {
      causeEvent.causes.push(event.id);
    }
  }

  stream.push(event);

  if (stream.length > 200) {
    agent.mind.stream = stream.slice(-150);
  }

  return event;
}

export function createPerceptionEvent(
  world: ArgosWorld,
  eid: number,
  stimulus: Stimulus,
  interpretation: string
): CognitiveEvent | null {
  return addCognitiveEvent(world, eid, {
    type: "perception",
    content: interpretation,
    causedBy: [],
    salience: stimulus.salience,
    relevance: stimulus.salience,
    confidence: 0.9,
    metadata: {
      stimulusId: stimulus.id,
      stimulusType: stimulus.type,
      stimulusSource: stimulus.source,
      rawContent: stimulus.content,
    },
  });
}

export function createThoughtEvent(
  world: ArgosWorld,
  eid: number,
  thought: string,
  causedBy: string[],
  confidence: number = 0.8
): CognitiveEvent | null {
  return addCognitiveEvent(world, eid, {
    type: "thought",
    content: thought,
    causedBy,
    salience: 0.6,
    relevance: 0.7,
    confidence,
    metadata: {},
  });
}

export function createDecisionEvent(
  world: ArgosWorld,
  eid: number,
  decision: string,
  reasoning: string,
  causedBy: string[],
  confidence: number = 0.8
): CognitiveEvent | null {
  return addCognitiveEvent(world, eid, {
    type: "decision",
    content: decision,
    causedBy,
    salience: 0.8,
    relevance: 0.9,
    confidence,
    metadata: { reasoning },
  });
}

export function createReflectionEvent(
  world: ArgosWorld,
  eid: number,
  reflection: string,
  causedBy: string[]
): CognitiveEvent | null {
  return addCognitiveEvent(world, eid, {
    type: "reflection",
    content: reflection,
    causedBy,
    salience: 0.7,
    relevance: 0.8,
    confidence: 0.9,
    metadata: {},
  });
}

export function getMode(world: ArgosWorld, eid: number): CognitiveMode {
  const agent = getAgent(world, eid);
  return agent?.mind.mode ?? "reactive";
}

export function setMode(world: ArgosWorld, eid: number, mode: CognitiveMode): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.mind.mode = mode;
  }
}

export function getArousal(world: ArgosWorld, eid: number): number {
  const agent = getAgent(world, eid);
  return agent?.mind.arousal ?? 0.5;
}

export function setArousal(world: ArgosWorld, eid: number, arousal: number): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.mind.arousal = Math.max(0, Math.min(1, arousal));
  }
}

export function adjustArousal(world: ArgosWorld, eid: number, delta: number): void {
  const current = getArousal(world, eid);
  setArousal(world, eid, current + delta);
}

export function getFocus(world: ArgosWorld, eid: number): string | null {
  const agent = getAgent(world, eid);
  return agent?.mind.attention.focus ?? null;
}

export function setFocus(world: ArgosWorld, eid: number, focus: string | null): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.mind.attention.focus = focus;
  }
}

export function getFilters(world: ArgosWorld, eid: number): string[] {
  const agent = getAgent(world, eid);
  return agent?.mind.attention.filters ?? [];
}

export function addFilter(world: ArgosWorld, eid: number, filter: string): void {
  const agent = getAgent(world, eid);
  if (agent && !agent.mind.attention.filters.includes(filter)) {
    agent.mind.attention.filters.push(filter);
  }
}

export function removeFilter(world: ArgosWorld, eid: number, filter: string): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.mind.attention.filters = agent.mind.attention.filters.filter((f) => f !== filter);
  }
}

export function getSaturation(world: ArgosWorld, eid: number): number {
  const agent = getAgent(world, eid);
  return agent?.mind.attention.saturation ?? 0;
}

export function setSaturation(world: ArgosWorld, eid: number, saturation: number): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.mind.attention.saturation = Math.max(0, Math.min(1, saturation));
  }
}

export function getCapacity(world: ArgosWorld, eid: number): number {
  const agent = getAgent(world, eid);
  return agent?.mind.attention.capacity ?? 7;
}

export function calculateNextLoopDelay(world: ArgosWorld, eid: number, stimuliCount: number): number {
  const baseDelay = 2000;

  const arousal = getArousal(world, eid);
  const arousalFactor = 1 - arousal * 0.7;

  const urgencyFactor = stimuliCount > 0 ? 0.5 : 1.0;

  const saturation = getSaturation(world, eid);
  const saturationFactor = 1 + saturation * 1.5;

  const mode = getMode(world, eid);
  const modeFactor = {
    reactive: 0.6,
    deliberative: 1.2,
    reflective: 1.8,
    creative: 1.0,
  }[mode];

  return Math.max(
    500,
    Math.min(10000, baseDelay * arousalFactor * urgencyFactor * saturationFactor * modeFactor)
  );
}

export function serializeStreamForLLM(world: ArgosWorld, eid: number, count: number = 15): string {
  const stream = getRecentStream(world, eid, count);
  const lines: string[] = ["COGNITIVE STREAM (recent → oldest):"];

  for (const event of stream.slice().reverse()) {
    const age = Math.round((Date.now() - event.timestamp) / 1000);
    const causedByStr = event.causedBy.length > 0 ? ` [caused by: ${event.causedBy.length} events]` : "";
    lines.push(`[${event.type}] (${age}s ago, conf: ${event.confidence.toFixed(2)})${causedByStr}`);
    lines.push(`  ${event.content}`);
  }

  return lines.join("\n");
}

export function serializeMindStateForLLM(world: ArgosWorld, eid: number): string {
  const mode = getMode(world, eid);
  const arousal = getArousal(world, eid);
  const focus = getFocus(world, eid);
  const filters = getFilters(world, eid);
  const saturation = getSaturation(world, eid);

  const lines = [
    "MIND STATE:",
    `  Mode: ${mode}`,
    `  Arousal: ${(arousal * 100).toFixed(0)}%`,
    `  Attention Focus: ${focus ?? "none"}`,
    `  Attention Filters: ${filters.length > 0 ? filters.join(", ") : "none"}`,
    `  Cognitive Load: ${(saturation * 100).toFixed(0)}%`,
  ];

  return lines.join("\n");
}

export function getMindContext(world: ArgosWorld, eid: number): {
  name: string;
  role: string;
  systemPrompt: string;
  mode: CognitiveMode;
  arousal: number;
  focus: string | null;
  saturation: number;
} {
  const agent = getAgent(world, eid);
  return {
    name: agent?.name ?? "Unknown",
    role: agent?.role ?? "Agent",
    systemPrompt: agent?.systemPrompt ?? "",
    mode: getMode(world, eid),
    arousal: getArousal(world, eid),
    focus: getFocus(world, eid),
    saturation: getSaturation(world, eid),
  };
}
