import { createStimulusId } from "../core/ids";
import { getAgent, ArgosWorld } from "../core/ecs";
import type { Stimulus, StimulusType } from "../core/types";

export function createStimulus(config: {
  type: StimulusType;
  source: string;
  content: string;
  salience?: number;
  urgency?: number;
  novelty?: number;
  duration?: number;
  decay?: number;
  metadata?: Record<string, any>;
}): Stimulus {
  return {
    id: createStimulusId(),
    type: config.type,
    source: config.source,
    content: config.content,
    timestamp: Date.now(),
    duration: config.duration ?? 10000,
    decay: config.decay ?? 0.1,
    salience: config.salience ?? 0.5,
    urgency: config.urgency ?? 0.3,
    novelty: config.novelty ?? 0.5,
    processed: false,
    metadata: config.metadata,
  };
}

export function deliverStimulus(world: ArgosWorld, eid: number, stimulus: Stimulus): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  agent.stimuli.pending.push(stimulus);
}

export function deliverStimulusToAll(
  world: ArgosWorld,
  eids: number[],
  stimulus: Stimulus,
  excludeSource?: number
): void {
  for (const eid of eids) {
    if (eid !== excludeSource) {
      deliverStimulus(world, eid, { ...stimulus, id: createStimulusId() });
    }
  }
}

export function getActiveStimuli(world: ArgosWorld, eid: number): Stimulus[] {
  const agent = getAgent(world, eid);
  if (!agent) return [];
  
  const now = Date.now();
  return agent.stimuli.pending.filter((s) => {
    if (s.suppressedUntil && now < s.suppressedUntil) return false;
    const age = now - s.timestamp;
    if (age > s.duration) return false;
    return true;
  });
}

export function decayStimuli(world: ArgosWorld, eid: number): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const now = Date.now();
  const stillActive: Stimulus[] = [];

  for (const stimulus of agent.stimuli.pending) {
    const age = now - stimulus.timestamp;
    if (age > stimulus.duration) continue;

    const decayedSalience = stimulus.salience * Math.pow(1 - stimulus.decay, age / 1000);
    if (decayedSalience < 0.05) continue;

    stillActive.push({
      ...stimulus,
      salience: decayedSalience,
    });
  }

  agent.stimuli.pending = stillActive;
}

export function markStimulusProcessed(world: ArgosWorld, eid: number, stimulusId: string): void {
  const agent = getAgent(world, eid);
  if (!agent) return;

  const idx = agent.stimuli.pending.findIndex((s) => s.id === stimulusId);
  if (idx !== -1) {
    const [stimulus] = agent.stimuli.pending.splice(idx, 1);
    agent.stimuli.processed.push({ ...stimulus, processed: true });
    agent.stimuli.processed = agent.stimuli.processed.slice(-50);
  }
}

export function suppressStimulus(world: ArgosWorld, eid: number, stimulusId: string, duration: number): void {
  const agent = getAgent(world, eid);
  if (!agent) return;
  
  const stimulus = agent.stimuli.pending.find((s) => s.id === stimulusId);
  if (stimulus) {
    stimulus.suppressedUntil = Date.now() + duration;
  }
}

export function calculateEffectiveSalience(stimulus: Stimulus, focus: string | null): number {
  let salience = stimulus.salience;

  salience += stimulus.urgency * 0.3;
  salience += stimulus.novelty * 0.2;

  if (focus && stimulus.content.toLowerCase().includes(focus.toLowerCase())) {
    salience += 0.3;
  }

  if (stimulus.type === "social" || stimulus.type === "auditory") {
    salience += 0.1;
  }

  return Math.min(salience, 1);
}

export function filterByAttention(
  stimuli: Stimulus[],
  focus: string | null,
  filters: string[],
  capacity: number
): Stimulus[] {
  const scored = stimuli.map((s) => ({
    stimulus: s,
    effectiveSalience: calculateEffectiveSalience(s, focus),
  }));

  let filtered = scored;
  if (filters.length > 0) {
    filtered = scored.filter(({ stimulus }) =>
      filters.some(
        (f) =>
          stimulus.type.includes(f) ||
          stimulus.source.includes(f) ||
          stimulus.content.toLowerCase().includes(f.toLowerCase())
      )
    );
  }

  filtered.sort((a, b) => b.effectiveSalience - a.effectiveSalience);

  return filtered.slice(0, capacity).map(({ stimulus }) => stimulus);
}
