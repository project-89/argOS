/**
 * Speech Impact System — Making Conversations Matter
 *
 * When someone speaks to an NPC, this system ensures the conversation
 * has lasting effects on the NPC's behavior:
 *
 *   1. High-importance memories — player speech stored at importance 90+
 *   2. Impression updates — helpful speech improves valence, hostile worsens
 *   3. Immediate goal influence — urgent info triggers goal generation now
 *   4. Gossip propagation — NPCs share what they learned with others
 *
 * All effects use existing ECS APIs. No new components needed.
 */

import { query, hasComponent } from "bitecs";
import { generateText } from "ai";
import { speechAnalysisModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { Agent, Name } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { addMemory, updateImpression } from "../cognition/knowledge-graph";
import { addPerception } from "../cognition/agent-mind";
import { createIntentGoal, getActiveGoals } from "../cognition/cognition-system";
import { chronicle } from "../cognition/simulation-chronicle";

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Process the impact of speech on an NPC.
 * Call after the NPC has responded to the player.
 *
 * Analyzes the conversation for:
 *   - Emotional tone → impression update
 *   - Information content → high-importance memory
 *   - Urgency → immediate goal generation
 *   - Shareability → gossip propagation
 */
export async function processSpeechImpact(
  world: World,
  npcEid: number,
  speakerName: string,
  speechContent: string,
  npcResponseContent: string,
): Promise<void> {
  const npcName = Name.value[npcEid] || "someone";

  // 1. Store the conversation as a high-importance memory
  addMemory(world, npcEid, {
    type: "episodic",
    content: `${speakerName} said to me: "${speechContent.slice(0, 150)}"${npcResponseContent ? ` I responded about ${summarize(npcResponseContent)}` : ""}`,
    importance: 90, // High — player conversations matter
    emotionalValence: 0, // Updated below by tone analysis
    timestamp: Date.now(),
  });

  // 2. Analyze tone and content via LLM (fast, low-temp)
  try {
    const analysis = await analyzeSpeech(speakerName, speechContent, npcName);

    // Update impression based on tone
    if (analysis.tone !== "neutral") {
      const valence = analysis.tone === "friendly" ? 0.3 :
                      analysis.tone === "helpful" ? 0.5 :
                      analysis.tone === "flattering" ? 0.2 :
                      analysis.tone === "threatening" ? -0.5 :
                      analysis.tone === "rude" ? -0.3 :
                      analysis.tone === "deceptive" ? -0.4 : 0;

      updateImpression(world, npcEid, speakerName,
        analysis.tone, // Use tone as trait
        valence,
        0.6,
        `From conversation: "${speechContent.slice(0, 50)}..."`
      );

      if (Math.abs(valence) > 0.2) {
        console.log(`[SpeechImpact] ${npcName}'s impression of ${speakerName}: ${analysis.tone} (${valence > 0 ? "+" : ""}${valence.toFixed(1)})`);
      }
    }

    // 3. If urgent information, trigger immediate goal
    if (analysis.urgency === "high" && analysis.actionableInfo) {
      const activeGoals = getActiveGoals(world, npcEid);
      const alreadyHas = activeGoals.some(g =>
        g.description.toLowerCase().includes(analysis.actionableInfo!.toLowerCase().slice(0, 15)));

      if (!alreadyHas && activeGoals.length < 3) {
        createIntentGoal(world, npcEid, analysis.actionableInfo, 8);
        console.log(`[SpeechImpact] ${npcName} sets urgent goal: "${analysis.actionableInfo}"`);
      }
    }

    // 4. Gossip propagation — if this is interesting, NPC may share it
    if (analysis.gossipWorthy && analysis.gossipSummary) {
      scheduleGossip(world, npcEid, npcName, speakerName, analysis.gossipSummary);
    }

  } catch {
    // Analysis failed — the memory was already stored, which is the most important part
  }
}

// =============================================================================
// SPEECH ANALYSIS
// =============================================================================

interface SpeechAnalysis {
  tone: "friendly" | "helpful" | "flattering" | "neutral" | "threatening" | "rude" | "deceptive";
  urgency: "low" | "medium" | "high";
  actionableInfo?: string;    // If the speech contains info that should create a goal
  gossipWorthy: boolean;
  gossipSummary?: string;     // One-line summary to share with others
}

async function analyzeSpeech(
  speaker: string,
  content: string,
  listener: string,
): Promise<SpeechAnalysis> {
  const result = await generateText({
    model: speechAnalysisModel,
    temperature: 0.1, // Very deterministic
    messages: [
      { role: "system", content: "Analyze speech for its social impact. Respond with JSON only." },
      { role: "user", content: `${speaker} says to ${listener}: "${content}"

Analyze:
{
  "tone": "friendly|helpful|flattering|neutral|threatening|rude|deceptive",
  "urgency": "low|medium|high",
  "actionableInfo": "if this contains urgent info the listener should act on, describe the action (or null)",
  "gossipWorthy": true/false,
  "gossipSummary": "one-line summary others would find interesting (or null)"
}` },
    ],
  });

  const raw = extractJSON(result.text);
  if (!raw) return { tone: "neutral", urgency: "low", gossipWorthy: false };
  const json = typeof raw === "string" ? JSON.parse(raw) : raw;

  return {
    tone: json.tone || "neutral",
    urgency: json.urgency || "low",
    actionableInfo: json.actionableInfo || undefined,
    gossipWorthy: Boolean(json.gossipWorthy),
    gossipSummary: json.gossipSummary || undefined,
  };
}

// =============================================================================
// GOSSIP PROPAGATION
// =============================================================================

/** Pending gossip items — shared when NPCs are in the same room */
const gossipQueue: Array<{
  npcEid: number;
  npcName: string;
  source: string;
  content: string;
  timestamp: number;
}> = [];

function scheduleGossip(
  world: World,
  npcEid: number,
  npcName: string,
  source: string,
  content: string,
): void {
  gossipQueue.push({
    npcEid,
    npcName,
    source,
    content,
    timestamp: Date.now(),
  });
  console.log(`[SpeechImpact] ${npcName} will gossip about: "${content.slice(0, 50)}..."`);
}

/**
 * Spread pending gossip to NPCs sharing a room with the gossiper.
 * Call periodically from the simulation loop.
 */
export function propagateGossip(world: World): number {
  let spread = 0;

  const toRemove: number[] = [];

  for (let i = 0; i < gossipQueue.length; i++) {
    const gossip = gossipQueue[i];

    // Expire old gossip (older than 2 minutes)
    if (Date.now() - gossip.timestamp > 2 * 60 * 1000) {
      toRemove.push(i);
      continue;
    }

    // Find NPCs in the same room as the gossiper
    const room = getRoomForEntity(world, gossip.npcEid);
    if (room === undefined) continue;

    const roomContents = listDirectContents(world, room);
    for (const eid of roomContents) {
      if (eid === gossip.npcEid) continue;
      if (!hasComponent(world as any, eid, Agent as any)) continue;

      const listenerName = Name.value[eid] || "";
      if (!listenerName) continue;

      // Don't gossip to the original source
      if (listenerName.toLowerCase() === gossip.source.toLowerCase()) continue;

      // Share the gossip as a perception
      addPerception(world, eid, {
        type: "speech",
        content: `${gossip.npcName} mentions: "${gossip.content}"`,
        source: gossip.npcName,
        intensity: 0.6,
      });

      // Store as a memory in the listener
      addMemory(world, eid, {
        type: "episodic",
        content: `${gossip.npcName} told me that ${gossip.content}`,
        importance: 65,
        emotionalValence: 0,
        timestamp: Date.now(),
      });

      spread++;
      console.log(`[Gossip] ${gossip.npcName} → ${listenerName}: "${gossip.content.slice(0, 40)}..."`);
    }

    toRemove.push(i); // Gossip delivered, remove from queue
  }

  // Clean up delivered gossip
  for (let i = toRemove.length - 1; i >= 0; i--) {
    gossipQueue.splice(toRemove[i], 1);
  }

  return spread;
}

// =============================================================================
// HELPERS
// =============================================================================

function summarize(text: string): string {
  if (text.length <= 30) return text;
  return text.slice(0, 30) + "...";
}
