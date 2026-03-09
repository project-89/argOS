/**
 * Enhanced Memory System
 *
 * A comprehensive memory architecture with:
 * - Working Memory (scratchpad for active reasoning)
 * - Episodic Memory (events, experiences with temporal context)
 * - Semantic Memory (facts, knowledge, learned patterns)
 * - Procedural Memory (how-to knowledge, skills)
 * - Autobiographical Memory (self-narrative, identity-forming experiences)
 *
 * Each memory type has different:
 * - Decay rates
 * - Consolidation rules
 * - Retrieval mechanisms
 * - Capacity limits
 */

import type { World } from "../ecs/world";

// =============================================================================
// MEMORY TYPES
// =============================================================================

/**
 * Working Memory - Active scratchpad for current reasoning
 * High capacity, no decay, cleared when task completes
 */
export interface WorkingMemoryItem {
  id: string;
  taskId: string; // Links to active task/goal
  type: "note" | "finding" | "question" | "hypothesis" | "conclusion";
  content: string;
  timestamp: number;
  references?: string[]; // Links to other memories or sources
}

/**
 * Episodic Memory - Autobiographical events
 * "What happened to me" - rich temporal and emotional context
 */
export interface EpisodicMemory {
  id: string;
  timestamp: number;
  location: string;
  participants: string[];
  event: string; // What happened
  myRole: string; // What I did
  emotionalImpact: number; // -1 to 1
  importance: number; // 0 to 1
  sensoryDetails?: string; // Rich sensory context
  outcome?: string; // How it resolved
  // Retrieval metadata
  lastRecalled: number;
  recallCount: number;
  strength: number; // Consolidated strength (0-1)
}

/**
 * Semantic Memory - Factual knowledge
 * "What I know" - decontextualized facts and relationships
 */
export interface SemanticMemory {
  id: string;
  category: "fact" | "concept" | "relationship" | "rule" | "definition";
  subject: string;
  predicate?: string;
  object?: string;
  content: string; // Natural language representation
  confidence: number; // 0 to 1
  sources: string[]; // Which episodic memories this came from
  contradictions?: string[]; // IDs of conflicting memories
  timestamp: number;
  lastValidated: number;
  validationCount: number;
}

/**
 * Procedural Memory - Skills and how-to knowledge
 * "How to do things" - action sequences and conditional behaviors
 */
export interface ProceduralMemory {
  id: string;
  skill: string; // Name of the skill/procedure
  context: string; // When to use this
  steps: string[]; // Sequence of actions
  conditions: string[]; // Prerequisites
  successRate: number; // Historical success rate
  lastUsed: number;
  useCount: number;
  refinements: string[]; // Learned optimizations
}

/**
 * Autobiographical Memory - Identity-forming narrative
 * "Who I am" - core experiences that define self
 */
export interface AutobiographicalMemory {
  id: string;
  theme: "origin" | "turning_point" | "relationship" | "achievement" | "failure" | "belief";
  narrative: string; // Story form
  significance: string; // Why this matters to identity
  emotionalCore: string; // Core emotion
  linkedMemories: string[]; // Related episodic memories
  timestamp: number;
  permanence: number; // 0-1, higher = more resistant to change
}

// =============================================================================
// MEMORY STORE (ECS-Compatible)
// =============================================================================

/**
 * Complete memory store for an agent
 * Stored as component data (JSON serializable)
 */
export interface AgentMemoryStore {
  // Working memory - active task context
  workingMemory: WorkingMemoryItem[];
  workingMemoryCapacity: number; // Default 50 items

  // Episodic memory - events and experiences
  episodicMemories: EpisodicMemory[];
  episodicCapacity: number; // Default 500

  // Semantic memory - facts and knowledge
  semanticMemories: SemanticMemory[];
  semanticCapacity: number; // Default 1000

  // Procedural memory - skills
  proceduralMemories: ProceduralMemory[];
  proceduralCapacity: number; // Default 100

  // Autobiographical memory - identity
  autobiographicalMemories: AutobiographicalMemory[];
  autobiographicalCapacity: number; // Default 20

  // Indexing for fast retrieval
  indices: {
    byTopic: Map<string, string[]>; // topic -> memory IDs
    byPerson: Map<string, string[]>; // person -> memory IDs
    byLocation: Map<string, string[]>; // location -> memory IDs
    byEmotion: Map<string, string[]>; // emotion -> memory IDs
    byTime: Map<string, string[]>; // time period -> memory IDs
  };

  // Statistics
  stats: {
    totalMemoriesFormed: number;
    totalMemoriesForgotten: number;
    lastConsolidation: number;
    consolidationCycles: number;
  };
}

// =============================================================================
// MEMORY OPERATIONS
// =============================================================================

let memoryIdCounter = 0;
function generateMemoryId(type: string): string {
  return `${type}_${++memoryIdCounter}_${Date.now()}`;
}

/**
 * Create a new memory store with defaults
 */
export function createMemoryStore(): AgentMemoryStore {
  return {
    workingMemory: [],
    workingMemoryCapacity: 50,
    episodicMemories: [],
    episodicCapacity: 500,
    semanticMemories: [],
    semanticCapacity: 1000,
    proceduralMemories: [],
    proceduralCapacity: 100,
    autobiographicalMemories: [],
    autobiographicalCapacity: 20,
    indices: {
      byTopic: new Map(),
      byPerson: new Map(),
      byLocation: new Map(),
      byEmotion: new Map(),
      byTime: new Map(),
    },
    stats: {
      totalMemoriesFormed: 0,
      totalMemoriesForgotten: 0,
      lastConsolidation: Date.now(),
      consolidationCycles: 0,
    },
  };
}

// =============================================================================
// WORKING MEMORY OPERATIONS
// =============================================================================

/**
 * Add item to working memory (scratchpad)
 */
export function addToWorkingMemory(
  store: AgentMemoryStore,
  taskId: string,
  type: WorkingMemoryItem["type"],
  content: string,
  references?: string[]
): WorkingMemoryItem {
  const item: WorkingMemoryItem = {
    id: generateMemoryId("wm"),
    taskId,
    type,
    content,
    timestamp: Date.now(),
    references,
  };

  store.workingMemory.push(item);

  // Enforce capacity (FIFO for same task)
  if (store.workingMemory.length > store.workingMemoryCapacity) {
    store.workingMemory.shift();
  }

  return item;
}

/**
 * Get working memory for a specific task
 */
export function getWorkingMemoryForTask(
  store: AgentMemoryStore,
  taskId: string
): WorkingMemoryItem[] {
  return store.workingMemory.filter(item => item.taskId === taskId);
}

/**
 * Clear working memory for completed task
 * Optionally consolidate important items to long-term memory
 */
export function clearWorkingMemory(
  store: AgentMemoryStore,
  taskId: string,
  consolidate: boolean = true
): { cleared: number; consolidated: number } {
  const taskItems = store.workingMemory.filter(item => item.taskId === taskId);
  let consolidated = 0;

  if (consolidate) {
    // Consolidate conclusions and important findings to semantic memory
    for (const item of taskItems) {
      if (item.type === "conclusion" || item.type === "finding") {
        addSemanticMemory(store, {
          category: "fact",
          subject: taskId,
          content: item.content,
          confidence: item.type === "conclusion" ? 0.8 : 0.6,
          sources: item.references || [],
        });
        consolidated++;
      }
    }
  }

  store.workingMemory = store.workingMemory.filter(item => item.taskId !== taskId);

  return { cleared: taskItems.length, consolidated };
}

/**
 * Format working memory for inclusion in prompt
 */
export function formatWorkingMemoryForPrompt(
  store: AgentMemoryStore,
  taskId: string
): string {
  const items = getWorkingMemoryForTask(store, taskId);
  if (items.length === 0) return "";

  const grouped = {
    notes: items.filter(i => i.type === "note"),
    findings: items.filter(i => i.type === "finding"),
    questions: items.filter(i => i.type === "question"),
    hypotheses: items.filter(i => i.type === "hypothesis"),
    conclusions: items.filter(i => i.type === "conclusion"),
  };

  const lines: string[] = ["## Working Memory (Scratchpad)"];

  if (grouped.conclusions.length > 0) {
    lines.push("\n### Conclusions:");
    grouped.conclusions.forEach(c => lines.push(`- ${c.content}`));
  }

  if (grouped.findings.length > 0) {
    lines.push("\n### Findings:");
    grouped.findings.forEach(f => lines.push(`- ${f.content}`));
  }

  if (grouped.hypotheses.length > 0) {
    lines.push("\n### Working Hypotheses:");
    grouped.hypotheses.forEach(h => lines.push(`- ${h.content}`));
  }

  if (grouped.questions.length > 0) {
    lines.push("\n### Open Questions:");
    grouped.questions.forEach(q => lines.push(`- ${q.content}`));
  }

  if (grouped.notes.length > 0) {
    lines.push("\n### Notes:");
    grouped.notes.slice(-10).forEach(n => lines.push(`- ${n.content}`));
  }

  return lines.join("\n");
}

// =============================================================================
// EPISODIC MEMORY OPERATIONS
// =============================================================================

/**
 * Add an episodic memory (experience)
 */
export function addEpisodicMemory(
  store: AgentMemoryStore,
  memory: Omit<EpisodicMemory, "id" | "lastRecalled" | "recallCount" | "strength">
): EpisodicMemory {
  const episodic: EpisodicMemory = {
    ...memory,
    id: generateMemoryId("ep"),
    lastRecalled: Date.now(),
    recallCount: 0,
    strength: memory.importance * 0.5 + Math.abs(memory.emotionalImpact) * 0.5,
  };

  store.episodicMemories.push(episodic);
  store.stats.totalMemoriesFormed++;

  // Index by participants
  for (const person of memory.participants) {
    const existing = store.indices.byPerson.get(person) || [];
    existing.push(episodic.id);
    store.indices.byPerson.set(person, existing);
  }

  // Index by location
  const locMemories = store.indices.byLocation.get(memory.location) || [];
  locMemories.push(episodic.id);
  store.indices.byLocation.set(memory.location, locMemories);

  // Enforce capacity (remove weakest memories)
  if (store.episodicMemories.length > store.episodicCapacity) {
    const sorted = [...store.episodicMemories].sort((a, b) => a.strength - b.strength);
    const toRemove = sorted[0];
    store.episodicMemories = store.episodicMemories.filter(m => m.id !== toRemove.id);
    store.stats.totalMemoriesForgotten++;
  }

  return episodic;
}

/**
 * Recall episodic memories by cue
 */
export function recallEpisodicMemories(
  store: AgentMemoryStore,
  cue: {
    person?: string;
    location?: string;
    timeRange?: { start: number; end: number };
    emotion?: "positive" | "negative" | "neutral";
    keywords?: string[];
  },
  limit: number = 10
): EpisodicMemory[] {
  let candidates = store.episodicMemories;

  // Filter by person
  if (cue.person) {
    const personMemoryIds = store.indices.byPerson.get(cue.person) || [];
    candidates = candidates.filter(m => personMemoryIds.includes(m.id));
  }

  // Filter by location
  if (cue.location) {
    candidates = candidates.filter(m => m.location === cue.location);
  }

  // Filter by time range
  if (cue.timeRange) {
    candidates = candidates.filter(
      m => m.timestamp >= cue.timeRange!.start && m.timestamp <= cue.timeRange!.end
    );
  }

  // Filter by emotion
  if (cue.emotion) {
    candidates = candidates.filter(m => {
      if (cue.emotion === "positive") return m.emotionalImpact > 0.3;
      if (cue.emotion === "negative") return m.emotionalImpact < -0.3;
      return Math.abs(m.emotionalImpact) <= 0.3;
    });
  }

  // Filter by keywords (simple substring match)
  if (cue.keywords && cue.keywords.length > 0) {
    candidates = candidates.filter(m =>
      cue.keywords!.some(kw =>
        m.event.toLowerCase().includes(kw.toLowerCase()) ||
        m.myRole.toLowerCase().includes(kw.toLowerCase())
      )
    );
  }

  // Sort by relevance (strength + recency)
  const now = Date.now();
  candidates.sort((a, b) => {
    const aRecency = 1 / (1 + (now - a.lastRecalled) / (1000 * 60 * 60 * 24)); // 24h half-life
    const bRecency = 1 / (1 + (now - b.lastRecalled) / (1000 * 60 * 60 * 24));
    const aScore = a.strength * 0.6 + aRecency * 0.4;
    const bScore = b.strength * 0.6 + bRecency * 0.4;
    return bScore - aScore;
  });

  // Update recall metadata for retrieved memories
  const results = candidates.slice(0, limit);
  for (const memory of results) {
    memory.lastRecalled = now;
    memory.recallCount++;
    // Strengthen memory through recall
    memory.strength = Math.min(1, memory.strength + 0.05);
  }

  return results;
}

// =============================================================================
// SEMANTIC MEMORY OPERATIONS
// =============================================================================

/**
 * Add a semantic memory (fact/knowledge)
 */
export function addSemanticMemory(
  store: AgentMemoryStore,
  memory: Omit<SemanticMemory, "id" | "timestamp" | "lastValidated" | "validationCount">
): SemanticMemory {
  // Check for existing similar fact (may update instead of add)
  const existing = store.semanticMemories.find(
    m => m.subject === memory.subject &&
         m.predicate === memory.predicate &&
         m.object === memory.object
  );

  if (existing) {
    // Update confidence based on new evidence
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastValidated = Date.now();
    existing.validationCount++;
    existing.sources = [...new Set([...existing.sources, ...memory.sources])];
    return existing;
  }

  const semantic: SemanticMemory = {
    ...memory,
    id: generateMemoryId("sem"),
    timestamp: Date.now(),
    lastValidated: Date.now(),
    validationCount: 1,
  };

  store.semanticMemories.push(semantic);
  store.stats.totalMemoriesFormed++;

  // Index by subject (topic)
  const topicMemories = store.indices.byTopic.get(memory.subject) || [];
  topicMemories.push(semantic.id);
  store.indices.byTopic.set(memory.subject, topicMemories);

  // Enforce capacity
  if (store.semanticMemories.length > store.semanticCapacity) {
    // Remove lowest confidence
    const sorted = [...store.semanticMemories].sort((a, b) => a.confidence - b.confidence);
    const toRemove = sorted[0];
    store.semanticMemories = store.semanticMemories.filter(m => m.id !== toRemove.id);
    store.stats.totalMemoriesForgotten++;
  }

  return semantic;
}

/**
 * Query semantic memory
 */
export function querySemanticMemory(
  store: AgentMemoryStore,
  query: {
    subject?: string;
    category?: SemanticMemory["category"];
    minConfidence?: number;
    keywords?: string[];
  },
  limit: number = 20
): SemanticMemory[] {
  let results = store.semanticMemories;

  if (query.subject) {
    results = results.filter(m =>
      m.subject.toLowerCase().includes(query.subject!.toLowerCase()) ||
      m.content.toLowerCase().includes(query.subject!.toLowerCase())
    );
  }

  if (query.category) {
    results = results.filter(m => m.category === query.category);
  }

  if (query.minConfidence !== undefined) {
    results = results.filter(m => m.confidence >= query.minConfidence!);
  }

  if (query.keywords && query.keywords.length > 0) {
    results = results.filter(m =>
      query.keywords!.some(kw => m.content.toLowerCase().includes(kw.toLowerCase()))
    );
  }

  // Sort by confidence
  results.sort((a, b) => b.confidence - a.confidence);

  return results.slice(0, limit);
}

// =============================================================================
// PROCEDURAL MEMORY OPERATIONS
// =============================================================================

/**
 * Add or update a procedural memory (skill)
 */
export function addProceduralMemory(
  store: AgentMemoryStore,
  memory: Omit<ProceduralMemory, "id" | "lastUsed" | "useCount" | "refinements">
): ProceduralMemory {
  // Check for existing skill
  const existing = store.proceduralMemories.find(m => m.skill === memory.skill);

  if (existing) {
    // Merge steps if different
    if (JSON.stringify(existing.steps) !== JSON.stringify(memory.steps)) {
      existing.refinements.push(`Alternative: ${memory.steps.join(" → ")}`);
    }
    existing.lastUsed = Date.now();
    existing.useCount++;
    return existing;
  }

  const procedural: ProceduralMemory = {
    ...memory,
    id: generateMemoryId("proc"),
    lastUsed: Date.now(),
    useCount: 1,
    refinements: [],
  };

  store.proceduralMemories.push(procedural);
  store.stats.totalMemoriesFormed++;

  return procedural;
}

/**
 * Record skill usage outcome (updates success rate)
 */
export function recordSkillOutcome(
  store: AgentMemoryStore,
  skillId: string,
  success: boolean,
  refinement?: string
): void {
  const skill = store.proceduralMemories.find(m => m.id === skillId);
  if (!skill) return;

  // Update success rate (exponential moving average)
  const alpha = 0.2; // Learning rate
  skill.successRate = skill.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
  skill.lastUsed = Date.now();
  skill.useCount++;

  if (refinement) {
    skill.refinements.push(refinement);
    // Keep only last 5 refinements
    if (skill.refinements.length > 5) {
      skill.refinements = skill.refinements.slice(-5);
    }
  }
}

/**
 * Find relevant skill for a situation
 */
export function findRelevantSkill(
  store: AgentMemoryStore,
  context: string
): ProceduralMemory | null {
  const contextLower = context.toLowerCase();

  // Simple keyword matching (could be enhanced with embeddings)
  const matches = store.proceduralMemories.filter(m =>
    m.context.toLowerCase().split(/\s+/).some(word =>
      contextLower.includes(word)
    ) ||
    m.skill.toLowerCase().split(/\s+/).some(word =>
      contextLower.includes(word)
    )
  );

  if (matches.length === 0) return null;

  // Return highest success rate
  matches.sort((a, b) => b.successRate - a.successRate);
  return matches[0];
}

// =============================================================================
// AUTOBIOGRAPHICAL MEMORY OPERATIONS
// =============================================================================

/**
 * Add an autobiographical memory (identity-forming)
 */
export function addAutobiographicalMemory(
  store: AgentMemoryStore,
  memory: Omit<AutobiographicalMemory, "id" | "timestamp" | "permanence">
): AutobiographicalMemory {
  const auto: AutobiographicalMemory = {
    ...memory,
    id: generateMemoryId("auto"),
    timestamp: Date.now(),
    permanence: 0.5, // Starts at medium permanence
  };

  store.autobiographicalMemories.push(auto);
  store.stats.totalMemoriesFormed++;

  // Autobiographical memories rarely exceed capacity (they're identity-core)
  // But if they do, remove lowest permanence
  if (store.autobiographicalMemories.length > store.autobiographicalCapacity) {
    const sorted = [...store.autobiographicalMemories].sort((a, b) => a.permanence - b.permanence);
    store.autobiographicalMemories = store.autobiographicalMemories.filter(
      m => m.id !== sorted[0].id
    );
  }

  return auto;
}

/**
 * Get autobiographical memories by theme
 */
export function getAutobiographicalMemories(
  store: AgentMemoryStore,
  theme?: AutobiographicalMemory["theme"]
): AutobiographicalMemory[] {
  if (theme) {
    return store.autobiographicalMemories.filter(m => m.theme === theme);
  }
  return store.autobiographicalMemories;
}

// =============================================================================
// MEMORY CONSOLIDATION (Run periodically)
// =============================================================================

/**
 * Consolidate memories - decay, strengthen, extract patterns
 */
export function consolidateMemories(store: AgentMemoryStore): {
  decayed: number;
  strengthened: number;
  patternsFound: number;
} {
  const now = Date.now();
  let decayed = 0;
  let strengthened = 0;
  let patternsFound = 0;

  // Episodic memory decay
  for (const memory of store.episodicMemories) {
    const hoursSinceRecall = (now - memory.lastRecalled) / (1000 * 60 * 60);
    const decayRate = 0.01 * (1 - memory.importance); // Important memories decay slower

    memory.strength = Math.max(0, memory.strength - decayRate * hoursSinceRecall);

    if (memory.strength < 0.1) {
      decayed++;
    }
  }

  // Remove very weak episodic memories
  const beforeCount = store.episodicMemories.length;
  store.episodicMemories = store.episodicMemories.filter(m => m.strength >= 0.1);
  store.stats.totalMemoriesForgotten += beforeCount - store.episodicMemories.length;

  // Semantic memory confidence decay for unvalidated facts
  for (const memory of store.semanticMemories) {
    const daysSinceValidation = (now - memory.lastValidated) / (1000 * 60 * 60 * 24);
    if (daysSinceValidation > 7) {
      memory.confidence = Math.max(0.1, memory.confidence - 0.01 * daysSinceValidation);
    }
  }

  // Remove very low confidence semantic memories
  store.semanticMemories = store.semanticMemories.filter(m => m.confidence >= 0.1);

  // Pattern extraction: Find repeated episodic patterns → create semantic facts
  // (This would ideally use LLM, simplified here)
  const locationCounts = new Map<string, number>();
  for (const memory of store.episodicMemories) {
    const count = locationCounts.get(memory.location) || 0;
    locationCounts.set(memory.location, count + 1);
  }

  for (const [location, count] of Array.from(locationCounts.entries())) {
    if (count >= 5) {
      // Extract pattern: "I frequently visit [location]"
      const existingPattern = store.semanticMemories.find(
        m => m.subject === location && m.category === "fact"
      );
      if (!existingPattern) {
        addSemanticMemory(store, {
          category: "fact",
          subject: location,
          content: `I frequently visit ${location}`,
          confidence: 0.7,
          sources: [`pattern_extraction_${now}`],
        });
        patternsFound++;
      }
    }
  }

  // Strengthen frequently recalled memories
  for (const memory of store.episodicMemories) {
    if (memory.recallCount > 5) {
      memory.strength = Math.min(1, memory.strength + 0.02);
      strengthened++;
    }
  }

  // Strengthen autobiographical memories over time
  for (const memory of store.autobiographicalMemories) {
    memory.permanence = Math.min(1, memory.permanence + 0.01);
  }

  store.stats.lastConsolidation = now;
  store.stats.consolidationCycles++;

  return { decayed, strengthened, patternsFound };
}

// =============================================================================
// CONTEXT GENERATION FOR PROMPTS
// =============================================================================

/**
 * Generate comprehensive memory context for agent prompt
 */
export function generateMemoryContext(
  store: AgentMemoryStore,
  cues: {
    currentLocation?: string;
    currentTask?: string;
    peoplePresent?: string[];
    topic?: string;
  },
  maxTokens: number = 2000 // Approximate token budget
): string {
  const sections: string[] = [];

  // 1. Working Memory (highest priority if task is active)
  if (cues.currentTask) {
    const workingMem = formatWorkingMemoryForPrompt(store, cues.currentTask);
    if (workingMem) {
      sections.push(workingMem);
    }
  }

  // 2. Relevant Episodic Memories
  const episodicCues: Parameters<typeof recallEpisodicMemories>[1] = {};
  if (cues.currentLocation) episodicCues.location = cues.currentLocation;
  if (cues.peoplePresent && cues.peoplePresent.length > 0) {
    episodicCues.person = cues.peoplePresent[0];
  }
  if (cues.topic) episodicCues.keywords = [cues.topic];

  const relevantEpisodes = recallEpisodicMemories(store, episodicCues, 5);
  if (relevantEpisodes.length > 0) {
    sections.push("\n## Relevant Memories:");
    for (const ep of relevantEpisodes) {
      sections.push(`- [${new Date(ep.timestamp).toLocaleDateString()}] ${ep.event} (${ep.myRole})`);
    }
  }

  // 3. Relevant Knowledge
  if (cues.topic) {
    const facts = querySemanticMemory(store, { subject: cues.topic, minConfidence: 0.5 }, 10);
    if (facts.length > 0) {
      sections.push("\n## What I Know:");
      for (const fact of facts) {
        sections.push(`- ${fact.content} (confidence: ${(fact.confidence * 100).toFixed(0)}%)`);
      }
    }
  }

  // 4. Relevant Skills
  if (cues.topic) {
    const skill = findRelevantSkill(store, cues.topic);
    if (skill) {
      sections.push(`\n## Relevant Skill: ${skill.skill}`);
      sections.push(`Steps: ${skill.steps.join(" → ")}`);
      sections.push(`Success rate: ${(skill.successRate * 100).toFixed(0)}%`);
    }
  }

  // 5. Core Identity (always include summary)
  const identityMemories = getAutobiographicalMemories(store).slice(0, 3);
  if (identityMemories.length > 0) {
    sections.push("\n## Core to Who I Am:");
    for (const auto of identityMemories) {
      sections.push(`- ${auto.narrative}`);
    }
  }

  // 6. Knowledge about present people
  if (cues.peoplePresent) {
    for (const person of cues.peoplePresent) {
      const personFacts = querySemanticMemory(store, { subject: person }, 3);
      if (personFacts.length > 0) {
        sections.push(`\n## What I Know About ${person}:`);
        for (const fact of personFacts) {
          sections.push(`- ${fact.content}`);
        }
      }
    }
  }

  return sections.join("\n");
}

// =============================================================================
// SUMMARY
// =============================================================================

export function getMemoryStoreSummary(store: AgentMemoryStore): string {
  return `Memory Store Summary:
- Working Memory: ${store.workingMemory.length}/${store.workingMemoryCapacity} items
- Episodic Memories: ${store.episodicMemories.length}/${store.episodicCapacity}
- Semantic Memories: ${store.semanticMemories.length}/${store.semanticCapacity}
- Procedural Memories: ${store.proceduralMemories.length}/${store.proceduralCapacity}
- Autobiographical: ${store.autobiographicalMemories.length}/${store.autobiographicalCapacity}
- Total Formed: ${store.stats.totalMemoriesFormed}
- Total Forgotten: ${store.stats.totalMemoriesForgotten}
- Consolidation Cycles: ${store.stats.consolidationCycles}`;
}
