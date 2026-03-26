import { generateText } from "ai";
import { flashModel } from "../llm/config";
import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Memory, Belief, Impression } from "../ecs/components";
import { HasMemory, HasBelief, HasImpression } from "../ecs/relations";

const model = flashModel;

function hasGoogleApiKey(): boolean {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export interface MemoryData {
  type: "episodic" | "semantic" | "procedural";
  content: string;
  emotionalValence: number;
  importance: number;
  timestamp: number;
}

export interface BeliefData {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  timestamp: number;
}

export interface ImpressionData {
  trait: string;
  valence: number;
  confidence: number;
  basis: string;
}

export function getAgentMemories(world: World, agentEid: number): number[] {
  const memoryEids = getRelationTargets(world, agentEid, HasMemory);
  return memoryEids.filter(eid => hasComponent(world, eid, Memory));
}

export function getAgentBeliefs(world: World, agentEid: number): number[] {
  const beliefEids = getRelationTargets(world, agentEid, HasBelief);
  return beliefEids.filter(eid => hasComponent(world, eid, Belief));
}

export function getAgentImpressions(world: World, agentEid: number): number[] {
  const impressionEids = getRelationTargets(world, agentEid, HasImpression);
  return impressionEids.filter(eid => hasComponent(world, eid, Impression));
}

export function addMemory(
  world: World,
  agentEid: number,
  data: MemoryData
): number {
  const memoryEid = addEntity(world);
  addComponent(world, memoryEid, Memory);
  addComponent(world, agentEid, HasMemory(memoryEid));

  Memory.type[memoryEid] = data.type;
  Memory.content[memoryEid] = data.content;
  Memory.emotionalValence[memoryEid] = data.emotionalValence;
  Memory.importance[memoryEid] = data.importance;
  Memory.timestamp[memoryEid] = data.timestamp;
  Memory.lastRecalled[memoryEid] = data.timestamp;
  Memory.recallCount[memoryEid] = 0;

  pruneMemoriesIfNeeded(world, agentEid, 50);

  // If the memory is important enough, grow a behavior tree branch for it
  if (data.importance >= 50) {
    try {
      const { growMemoryBranch } = require("./policy-learning");
      // Extract a keyword from the memory content for the has_memory condition
      const keyword = extractMemoryKeyword(data.content);
      if (keyword) {
        // Choose a response action based on emotional valence
        const responseAction = data.emotionalValence < -0.3
          ? { type: "move" as const, target: undefined, content: undefined } // flee/avoid for negative memories
          : data.emotionalValence > 0.3
            ? { type: "observe" as const, target: undefined, content: undefined } // pay attention for positive memories
            : { type: "think" as const, content: `I remember: ${keyword}` }; // reflect for neutral
        growMemoryBranch(world, agentEid, keyword, responseAction);
      }
    } catch { /* policy-learning not available */ }
  }

  return memoryEid;
}

/** Extract a salient keyword from memory content for has_memory conditions */
function extractMemoryKeyword(content: string): string | null {
  const text = String(content || "").trim().toLowerCase();
  if (text.length < 5) return null;
  // Look for emotionally significant words
  const significantPatterns = [
    /\b(attack|fight|threat|danger|kill|death|murder|stole|theft|rob|betray)\b/,
    /\b(friend|ally|trust|help|save|gift|kind|love|marry)\b/,
    /\b(quest|mission|task|order|promise|oath|debt|owe)\b/,
    /\b(secret|discover|found|reveal|hidden|treasure|map)\b/,
    /\b(fire|flood|storm|earthquake|plague|curse|monster)\b/,
  ];
  for (const pattern of significantPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  // Fallback: use the first 2-3 significant words
  const words = text.split(/\s+/).filter(w => w.length > 4);
  return words.slice(0, 2).join(" ") || null;
}

export function pruneMemoriesIfNeeded(world: World, agentEid: number, maxMemories: number): void {
  const memoryEids = getAgentMemories(world, agentEid);
  if (memoryEids.length <= maxMemories) return;

  const scored = memoryEids.map(eid => {
    const importance = Memory.importance[eid] || 0;
    const recallCount = Memory.recallCount[eid] || 0;
    const emotionalValence = Memory.emotionalValence[eid] || 0;
    const score = importance * 0.5 + (recallCount * 0.3) + (Math.abs(emotionalValence) > 0 ? 0.2 : 0);
    return { eid, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const toRemove = scored.slice(maxMemories);
  for (const { eid } of toRemove) {
    removeEntity(world, eid);
  }
}

export function addBelief(
  world: World,
  agentEid: number,
  data: BeliefData
): number {
  const existingBeliefs = getAgentBeliefs(world, agentEid);
  for (const beliefEid of existingBeliefs) {
    if (
      Belief.subject[beliefEid] === data.subject &&
      Belief.predicate[beliefEid] === data.predicate
    ) {
      Belief.object[beliefEid] = data.object;
      Belief.confidence[beliefEid] = data.confidence;
      Belief.source[beliefEid] = data.source;
      Belief.timestamp[beliefEid] = data.timestamp;
      return beliefEid;
    }
  }

  const beliefEid = addEntity(world);
  addComponent(world, beliefEid, Belief);
  addComponent(world, agentEid, HasBelief(beliefEid));

  Belief.subject[beliefEid] = data.subject;
  Belief.predicate[beliefEid] = data.predicate;
  Belief.object[beliefEid] = data.object;
  Belief.confidence[beliefEid] = data.confidence;
  Belief.source[beliefEid] = data.source;
  Belief.timestamp[beliefEid] = data.timestamp;

  return beliefEid;
}

export function updateImpression(
  world: World,
  agentEid: number,
  targetName: string,
  trait: string,
  valence: number,
  confidence: number,
  basis: string
): number {
  const existingImpressions = getAgentImpressions(world, agentEid);
  for (const impEid of existingImpressions) {
    if (Impression.targetName[impEid] === targetName && Impression.trait[impEid] === trait) {
      Impression.valence[impEid] = (Impression.valence[impEid] + valence) / 2;
      Impression.confidence[impEid] = Math.max(Impression.confidence[impEid], confidence);
      Impression.basis[impEid] = basis;
      
      const relation = HasImpression(impEid);
      relation.lastUpdated[agentEid] = Date.now();
      relation.sentiment[agentEid] = valence;
      return impEid;
    }
  }

  const impEid = addEntity(world);
  addComponent(world, impEid, Impression);
  addComponent(world, agentEid, HasImpression(impEid));

  Impression.targetName[impEid] = targetName;
  Impression.trait[impEid] = trait;
  Impression.valence[impEid] = valence;
  Impression.confidence[impEid] = confidence;
  Impression.basis[impEid] = basis;

  const relation = HasImpression(impEid);
  relation.lastUpdated[agentEid] = Date.now();
  relation.sentiment[agentEid] = valence;

  return impEid;
}

export function getRelevantMemories(
  world: World,
  agentEid: number,
  context: string,
  limit: number = 5
): number[] {
  const memoryEids = getAgentMemories(world, agentEid);
  const contextLower = context.toLowerCase();
  const contextWords = contextLower.split(/\s+/).filter(w => w.length > 3);

  const scored = memoryEids.map(eid => {
    let relevance = 0;
    const content = (Memory.content[eid] || "").toLowerCase();

    for (const word of contextWords) {
      if (content.includes(word)) {
        relevance += 0.2;
      }
    }

    relevance += (Memory.importance[eid] || 0) * 0.3;
    relevance += Math.abs(Memory.emotionalValence[eid] || 0) * 0.2;

    const age = Date.now() - (Memory.timestamp[eid] || 0);
    const recencyBonus = Math.max(0, 1 - age / (24 * 60 * 60 * 1000));
    relevance += recencyBonus * 0.3;

    return { eid, relevance };
  });

  scored.sort((a, b) => b.relevance - a.relevance);

  const results = scored.slice(0, limit).map(s => s.eid);

  for (const eid of results) {
    Memory.lastRecalled[eid] = Date.now();
    Memory.recallCount[eid] = (Memory.recallCount[eid] || 0) + 1;
  }

  return results;
}

export function getImpressionOf(
  world: World,
  agentEid: number,
  targetName: string
): { traits: Array<{ trait: string; valence: number; confidence: number; basis: string }>; overallSentiment: number } | undefined {
  const impressionEids = getAgentImpressions(world, agentEid);
  const matching = impressionEids.filter(eid => Impression.targetName[eid] === targetName);

  if (matching.length === 0) return undefined;

  const traits = matching.map(eid => ({
    trait: Impression.trait[eid],
    valence: Impression.valence[eid],
    confidence: Impression.confidence[eid],
    basis: Impression.basis[eid],
  }));

  const overallSentiment = traits.reduce((sum, t) => sum + t.valence, 0) / traits.length;

  return { traits, overallSentiment };
}

export function getBeliefsAbout(world: World, agentEid: number, subject: string): number[] {
  const beliefEids = getAgentBeliefs(world, agentEid);
  const subjectLower = subject.toLowerCase();

  return beliefEids.filter(eid => {
    const beliefSubject = (Belief.subject[eid] || "").toLowerCase();
    const beliefObject = (Belief.object[eid] || "").toLowerCase();
    return beliefSubject.includes(subjectLower) || beliefObject.includes(subjectLower);
  });
}

export async function extractKnowledgeFromInteraction(
  world: World,
  agentEid: number,
  interaction: {
    type: string;
    content: string;
    otherParty?: string;
    context: string;
  }
): Promise<void> {
  // Unit tests should be deterministic and must not trigger network-backed extraction.
  // Allow explicit override for ad-hoc LLM experiments.
  if (process.env.NODE_ENV === "test" && process.env.ARGOS_ENABLE_LLM_IN_TESTS !== "1") return;
  if (process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION === "1") return;

  // In deterministic/unit-test runs (or misconfigured env), skip LLM-backed extraction rather than error-spam.
  if (!hasGoogleApiKey()) return;

  const agentName = Name.value[agentEid] || "Agent";

  try {
    const { text } = await generateText({
      model,
      system: `You extract knowledge from interactions for an agent named ${agentName}.
      
Analyze the interaction and extract:
1. Memories worth keeping (important events, statements, observations)
2. Beliefs that can be formed (subject-predicate-object facts)
3. Impressions of other people (personality traits observed)

Respond with JSON:
{
  "memories": [
    {"type": "episodic|semantic", "content": "what happened", "importance": 0-1, "emotionalValence": -1 to 1}
  ],
  "beliefs": [
    {"subject": "who/what", "predicate": "is/has/does", "object": "what", "confidence": 0-1}
  ],
  "impressions": [
    {"target": "person name", "trait": "trait observed", "valence": -1 to 1, "confidence": 0-1}
  ]
}

Be selective - only extract truly noteworthy information.`,
      prompt: `Interaction type: ${interaction.type}
Other party: ${interaction.otherParty || "none"}
Context: ${interaction.context}
Content: ${interaction.content}`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const extracted = JSON.parse(jsonMatch[0]);
    const now = Date.now();

    for (const mem of extracted.memories || []) {
      addMemory(world, agentEid, {
        type: mem.type || "episodic",
        content: mem.content,
        emotionalValence: mem.emotionalValence || 0,
        importance: mem.importance || 0.5,
        timestamp: now,
      });
    }

    for (const bel of extracted.beliefs || []) {
      addBelief(world, agentEid, {
        subject: bel.subject,
        predicate: bel.predicate,
        object: bel.object,
        confidence: bel.confidence || 0.5,
        source: interaction.otherParty || "observation",
        timestamp: now,
      });
    }

    for (const imp of extracted.impressions || []) {
      if (imp.target) {
        updateImpression(
          world,
          agentEid,
          imp.target,
          imp.trait,
          imp.valence || 0,
          imp.confidence || 0.5,
          interaction.content.slice(0, 100)
        );
      }
    }

    console.log(`[${agentName}] extracted: ${extracted.memories?.length || 0} memories, ${extracted.beliefs?.length || 0} beliefs, ${extracted.impressions?.length || 0} impressions`);
  } catch (error) {
    console.error(`Knowledge extraction error for ${agentName}:`, error);
  }
}

export function getKnowledgeSummary(world: World, agentEid: number): string {
  const lines: string[] = [];

  const memoryEids = getAgentMemories(world, agentEid);
  if (memoryEids.length > 0) {
    lines.push("MEMORIES:");
    const recentMemories = memoryEids
      .filter((eid) => {
        const type = String(Memory.type[eid] || "");
        if (type === "procedural") return false; // Procedural skills are rendered separately
        const content = String(Memory.content[eid] || "").trim();
        if (content.startsWith("[ProcedureV1]")) return false;
        return true;
      })
      .sort((a, b) => (Memory.timestamp[b] || 0) - (Memory.timestamp[a] || 0))
      .slice(0, 5);
    for (const eid of recentMemories) {
      const valence = Memory.emotionalValence[eid] > 0 ? "+" : Memory.emotionalValence[eid] < 0 ? "-" : "~";
      const content = Memory.content[eid] || "";
      lines.push(`  [${valence}] ${content.slice(0, 80)}`);
    }
  }

  const beliefEids = getAgentBeliefs(world, agentEid);
  if (beliefEids.length > 0) {
    lines.push("BELIEFS:");
    const recentBeliefs = beliefEids
      .sort((a, b) => (Belief.timestamp[b] || 0) - (Belief.timestamp[a] || 0))
      .slice(0, 5);
    for (const eid of recentBeliefs) {
      const subject = Belief.subject[eid] || "";
      const predicate = Belief.predicate[eid] || "";
      const object = Belief.object[eid] || "";
      const confidence = Belief.confidence[eid] || 0;
      lines.push(`  ${subject} ${predicate} ${object} (${(confidence * 100).toFixed(0)}%)`);
    }
  }

  const impressionEids = getAgentImpressions(world, agentEid);
  if (impressionEids.length > 0) {
    lines.push("IMPRESSIONS:");
    const byTarget = new Map<string, number[]>();
    for (const eid of impressionEids) {
      const target = Impression.targetName[eid] || "";
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target)!.push(eid);
    }
    for (const [target, eids] of byTarget) {
      const avgSentiment = eids.reduce((sum, eid) => sum + (Impression.valence[eid] || 0), 0) / eids.length;
      const sentiment = avgSentiment > 0.2 ? "positive" : avgSentiment < -0.2 ? "negative" : "neutral";
      const traits = eids.map(eid => Impression.trait[eid]).join(", ");
      lines.push(`  ${target}: ${sentiment} (${traits})`);
    }
  }

  return lines.join("\n");
}

export function getAgentKnowledge(world: World, eid: number): {
  memories: number[];
  beliefs: number[];
  impressions: Map<string, number[]>;
} {
  const impressionEids = getAgentImpressions(world, eid);
  const impressionsByTarget = new Map<string, number[]>();
  for (const impEid of impressionEids) {
    const target = Impression.targetName[impEid] || "";
    if (!impressionsByTarget.has(target)) impressionsByTarget.set(target, []);
    impressionsByTarget.get(target)!.push(impEid);
  }

  return {
    memories: getAgentMemories(world, eid),
    beliefs: getAgentBeliefs(world, eid),
    impressions: impressionsByTarget,
  };
}
