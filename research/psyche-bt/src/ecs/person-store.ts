/**
 * Person Store — CRUD operations on the ECS person model.
 * All BT conditions resolve against this store.
 * Persistence handled separately (see persistence/).
 */

import type {
  PersonModel, Hypothesis, MemoryEntry, KnownEntity,
  Intention, Prediction, DomainCalibration, Message,
  CommunicationStyle, Skill,
} from "./types.js";

// =============================================================================
// FACTORY
// =============================================================================

export function createPersonModel(personId: string): PersonModel {
  return {
    personId,
    createdAt: Date.now(),
    lastInteraction: Date.now(),
    hypotheses: [],
    memory: [],
    entities: [],
    intentions: [],
    predictions: [],
    calibration: [],
    style: {
      formality: 0.5,
      humor: 0.3,
      messageLength: "moderate",
      emojiFrequency: "rare",
      topicTransitionStyle: "gradual",
    },
    conversation: {
      recentMessages: [],
      currentTopics: [],
      emotionalState: "neutral",
      sessionStart: Date.now(),
      turnsThisSession: 0,
    },
    skills: [],
    policy: {
      tree: null,
      version: 0,
      totalNodes: 0,
      compiledBranches: 0,
      lastCompiled: 0,
      escalationCount: 0,
      handledCount: 0,
    },
    totalConversations: 0,
    totalMessages: 0,
    totalEscalations: 0,
    totalBTHandled: 0,
  };
}

// =============================================================================
// HYPOTHESIS OPERATIONS
// =============================================================================

export function getHypothesis(model: PersonModel, domain: string): Hypothesis | undefined {
  return model.hypotheses.find(h => h.domain === domain);
}

export function getHypothesisConfidence(model: PersonModel, domain: string): number {
  return getHypothesis(model, domain)?.confidence ?? 0;
}

export function hasHypothesisIncluding(model: PersonModel, includes: string): boolean {
  const lower = includes.toLowerCase();
  return model.hypotheses.some(h =>
    h.content.toLowerCase().includes(lower) || h.domain.toLowerCase().includes(lower));
}

export function addHypothesis(model: PersonModel, h: Omit<Hypothesis, "id">): Hypothesis {
  const hypothesis: Hypothesis = { ...h, id: `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
  // Replace existing in same domain
  const idx = model.hypotheses.findIndex(existing => existing.domain === h.domain);
  if (idx >= 0) model.hypotheses[idx] = hypothesis;
  else model.hypotheses.push(hypothesis);
  // Cap at 20
  if (model.hypotheses.length > 20) {
    model.hypotheses.sort((a, b) => b.confidence - a.confidence);
    model.hypotheses.length = 20;
  }
  return hypothesis;
}

// =============================================================================
// MEMORY OPERATIONS
// =============================================================================

export function searchMemory(model: PersonModel, query: string, limit = 5): MemoryEntry[] {
  const lower = query.toLowerCase();
  const scored = model.memory.map(m => {
    let score = 0;
    if (m.content.toLowerCase().includes(lower)) score += 0.5;
    for (const topic of m.topics) {
      if (topic.toLowerCase().includes(lower)) score += 0.3;
    }
    score += m.importance * 0.2;
    return { entry: m, score };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

export function addMemory(model: PersonModel, entry: Omit<MemoryEntry, "id">): MemoryEntry {
  const memory: MemoryEntry = { ...entry, id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
  model.memory.push(memory);
  // Cap at 200, prune by importance
  if (model.memory.length > 200) {
    model.memory.sort((a, b) => b.importance - a.importance);
    model.memory.length = 200;
  }
  return memory;
}

export function memoryContains(model: PersonModel, query: string): boolean {
  return searchMemory(model, query, 1).length > 0;
}

// =============================================================================
// ENTITY OPERATIONS
// =============================================================================

export function getEntity(model: PersonModel, name: string): KnownEntity | undefined {
  return model.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
}

export function entityKnown(model: PersonModel, name: string): boolean {
  return getEntity(model, name) !== undefined;
}

export function addEntity(model: PersonModel, entity: KnownEntity): void {
  const existing = model.entities.find(e => e.name.toLowerCase() === entity.name.toLowerCase());
  if (existing) {
    existing.mentionCount += 1;
    existing.lastMentioned = Date.now();
    if (entity.context) existing.context = entity.context;
  } else {
    model.entities.push(entity);
  }
}

// =============================================================================
// INTENTION OPERATIONS
// =============================================================================

export function getActiveIntentions(model: PersonModel): Intention[] {
  return model.intentions.filter(i => i.status === "active" || i.status === "forming");
}

export function hasActiveIntention(model: PersonModel, domain: string): boolean {
  const lower = domain.toLowerCase();
  return model.intentions.some(i =>
    (i.status === "active" || i.status === "forming") &&
    i.claim.toLowerCase().includes(lower));
}

export function hasBlockedIntention(model: PersonModel): boolean {
  return model.intentions.some(i => i.status === "blocked");
}

// =============================================================================
// PREDICTION OPERATIONS
// =============================================================================

export function getPendingPredictions(model: PersonModel, domain?: string): Prediction[] {
  return model.predictions.filter(p =>
    !p.outcome && (!domain || p.domain === domain));
}

export function getDomainAccuracy(model: PersonModel, domain: string): number {
  const cal = model.calibration.find(c => c.domain === domain);
  return cal?.accuracy ?? 0.5;
}

// =============================================================================
// STYLE OPERATIONS
// =============================================================================

/** Direct property access preferred: model.style */
function getStyle(model: PersonModel): CommunicationStyle {
  return model.style;
}

// =============================================================================
// CONVERSATION OPERATIONS
// =============================================================================

export function addMessage(model: PersonModel, msg: Omit<Message, "timestamp">): void {
  model.conversation.recentMessages.push({ ...msg, timestamp: Date.now() });
  model.conversation.turnsThisSession++;
  model.totalMessages++;
  model.lastInteraction = Date.now();
  // Keep last 100
  if (model.conversation.recentMessages.length > 100) {
    model.conversation.recentMessages = model.conversation.recentMessages.slice(-100);
  }
}

export function getRecentMessages(model: PersonModel, n: number): Message[] {
  return model.conversation.recentMessages.slice(-n);
}

export function lastNMessagesInclude(model: PersonModel, n: number, includes: string): boolean {
  const recent = getRecentMessages(model, n);
  const lower = includes.toLowerCase();
  return recent.some(m => m.content.toLowerCase().includes(lower));
}

export function getConversationDepth(model: PersonModel): number {
  return model.conversation.turnsThisSession;
}

export function getEmotionalState(model: PersonModel): string {
  return model.conversation.emotionalState;
}

export function setEmotionalState(model: PersonModel, state: string): void {
  model.conversation.emotionalState = state;
}

export function setCurrentTopics(model: PersonModel, topics: string[]): void {
  model.conversation.currentTopics = topics;
}

export function getCurrentTopics(model: PersonModel): string[] {
  return model.conversation.currentTopics;
}

export function hasTopic(model: PersonModel, topic: string): boolean {
  const lower = topic.toLowerCase();
  return model.conversation.currentTopics.some(t => t.toLowerCase().includes(lower)) ||
    model.conversation.recentMessages.slice(-3).some(m => m.content.toLowerCase().includes(lower));
}

// =============================================================================
// SKILL OPERATIONS
// =============================================================================

export function getSkill(model: PersonModel, name: string): Skill | undefined {
  return model.skills.find(s => s.name === name);
}

export function addSkill(model: PersonModel, skill: Skill): void {
  const idx = model.skills.findIndex(s => s.name === skill.name);
  if (idx >= 0) model.skills[idx] = skill;
  else model.skills.push(skill);
}

// =============================================================================
// STATS
// =============================================================================

export function getEscalationRate(model: PersonModel): number {
  const total = model.totalEscalations + model.totalBTHandled;
  if (total === 0) return 1.0;
  return model.totalEscalations / total;
}
