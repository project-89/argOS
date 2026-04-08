/**
 * Swarm Runner — Orchestrates N independent learning instances.
 *
 * Each instance gets a fresh PersonModel + bootstrap tree, processes its
 * conversation script, and compiles whatever the immune system approves.
 * After all instances complete, their models are collected for harvesting.
 *
 * IMPORTANT: The bt-compiler has module-level pendingCapture state.
 * Instances MUST run sequentially (or the capture state will clobber).
 * We call resolveDecisionFailure() between instances to clear leaked state.
 */

import type { SwarmConfig, SwarmResult, InstanceResult, ConversationScript } from "./types.js";
import type { PersonModel } from "../ecs/types.js";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { resolveDecisionFailure } from "../compiler/bt-compiler.js";
import { generateConversationScripts } from "./task-generator.js";

// =============================================================================
// RUNNER
// =============================================================================

/**
 * Run the full swarm: generate scripts, spawn instances, collect results.
 *
 * @param config Swarm configuration
 * @param onProgress Optional callback for progress reporting
 */
export async function runSwarm(
  config: SwarmConfig,
  onProgress?: (completed: number, total: number, current: string) => void,
): Promise<SwarmResult> {
  const swarmStart = Date.now();

  // 1. Generate conversation scripts
  const scripts = generateConversationScripts({
    count: config.instanceCount,
    turnsPerConversation: config.turnsPerInstance,
    categories: config.categories,
    seed: config.seed,
  });

  // 2. Run instances sequentially (pendingCapture is module-level)
  const instances: InstanceResult[] = [];

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    onProgress?.(i, scripts.length, script.description);

    const result = await runInstance(script, i);
    instances.push(result);

    // Clear any leaked pending capture between instances
    resolveDecisionFailure();
  }

  onProgress?.(scripts.length, scripts.length, "done");

  // 3. Aggregate
  const totalBranches = instances.reduce((s, r) => s + r.compiledCount, 0);
  const totalEscalations = instances.reduce((s, r) => s + r.escalations, 0);
  const totalTurns = instances.reduce((s, r) => s + r.turnsProcessed, 0);

  return {
    config,
    instances,
    totalBranches,
    totalEscalations,
    totalTurns,
    elapsedMs: Date.now() - swarmStart,
  };
}

/**
 * Run a single instance through its conversation script.
 */
async function runInstance(
  script: ConversationScript,
  index: number,
): Promise<InstanceResult> {
  const instanceId = `swarm_${index}_${script.category}`;
  const start = Date.now();

  // Fresh model with bootstrap tree
  const model = createPersonModel(instanceId);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  let escalations = 0;

  for (const message of script.messages) {
    try {
      const result = await processTurn(message, model);
      if (result.escalated) escalations++;
    } catch {
      // Non-fatal — continue with remaining messages
      escalations++;
    }
  }

  return {
    instanceId,
    model,
    turnsProcessed: script.messages.length,
    escalations,
    compiledCount: model.policy.compiledBranches,
    treeNodes: model.policy.totalNodes,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Set up mock handlers for swarm testing (no real LLM).
 * Each escalation produces a varied mock response that simulates
 * what a real LLM might return for different conversation types.
 */
export function setupSwarmMockHandlers(): void {
  setHandlers({
    escalation: async (msg, model) => {
      const lower = msg.toLowerCase();
      let response: string;
      let reasoning: string;

      // Use model's current topics for topic-aware responses
      const topics = model?.conversation?.currentTopics || [];
      const topicStr = topics[0] || "this";

      // Extract key words from user message to echo (mimics real LLM behavior)
      const userKeywords = msg.split(/\s+/)
        .filter(w => w.length > 4 && !/^(about|really|feeling|that's|things|their|there|these|where|which|would|could|should)$/i.test(w))
        .slice(0, 3)
        .map(w => w.replace(/[.,!?]/g, ""));
      const keywordStr = userKeywords.join(" and ");

      // Produce varied, topic-specific responses that echo user keywords (like a real LLM)
      const echo = keywordStr || topicStr;
      if (/stress|overwhelm|anxious|worried|pressure/i.test(lower)) {
        const specifics = [
          `That sounds tough — ${echo} is a lot to deal with. What's the most pressing part? Let me help you break it down.`,
          `I hear the stress about ${echo}. Which piece feels most urgent? Tackling one thing at a time usually helps.`,
          `The pressure around ${echo} can be overwhelming. What if we mapped out a timeline and prioritized?`,
          `I understand the stress with ${echo}. Let's figure out what you can control and start there.`,
        ];
        response = specifics[Math.floor(Math.random() * specifics.length)];
        reasoning = `User is stressed about ${echo} — acknowledge their feelings and offer concrete decomposition of the ${topicStr} problem.`;
      } else if (/excit|happy|great|thrilled|pumped|good news/i.test(lower)) {
        const specifics = [
          `That's fantastic news about ${echo}! What made it happen? I'd love to hear the details.`,
          `Amazing progress with ${echo}! What's the next step? Let's build on that momentum.`,
          `So great to hear about ${echo}! Tell me more — what does this open up for you?`,
        ];
        response = specifics[Math.floor(Math.random() * specifics.length)];
        reasoning = `User is excited about ${echo} — match their energy, celebrate, and explore what ${topicStr} means going forward.`;
      } else if (/help|checklist|draft|summarize|can you/i.test(lower)) {
        response = `Sure, I can help with ${echo}. Let me work on it — what specific details should I include?`;
        reasoning = `User is requesting concrete help with ${echo} in the ${topicStr} domain — acknowledge and ask for specifications.`;
      } else if (/frustrat|annoyed|fed up|angry/i.test(lower)) {
        response = `I can see why ${echo} is frustrating. Let's figure out what's actually going on and what we can do about it.`;
        reasoning = `User is frustrated about ${echo} — validate feelings about ${topicStr}, then problem-solve.`;
      } else if (/sad|down|low|bummed|disappoint/i.test(lower)) {
        response = `I'm sorry to hear about ${echo}. Want to talk about what happened, or should we focus on next steps?`;
        reasoning = `User is sad about ${echo} — offer presence and let them choose how to process the ${topicStr} situation.`;
      } else if (/worse|getting bad|more difficult|harder/i.test(lower)) {
        response = `It sounds like ${echo} is getting harder. Let's think about what's changed and what you can do right now.`;
        reasoning = `The ${echo} situation is worsening — acknowledge escalation, help identify what changed and next steps.`;
      } else if (/thank|helpful|good point|you're right|exactly/i.test(lower)) {
        response = `Glad that resonated about ${echo}! The key thing now is picking one concrete next step. What feels most doable?`;
        reasoning = `User confirmed helpfulness on ${echo} — build on positive momentum, guide to specific action on ${topicStr}.`;
      } else if (/plan|prioritize|focus|first|next step/i.test(lower)) {
        response = `Good thinking about ${echo}. I'd suggest starting with the highest-impact item. What would make the biggest difference?`;
        reasoning = `User wants to prioritize ${echo} — provide framework for ${topicStr} decision-making.`;
      } else if (/\?/.test(msg)) {
        response = `Good question about ${echo}. Based on what you've shared, I'd suggest focusing on what matters most. What feels right?`;
        reasoning = `User asked about ${echo} — provide a ${topicStr} thinking framework.`;
      } else if (/been a while|long time|catching up/i.test(lower)) {
        response = "Great to hear from you! A lot can change — what's been the biggest thing since we last talked?";
        reasoning = "Returning user — warm reconnect, acknowledge the gap, invite updates.";
      } else {
        response = `I hear you about ${echo}. ${msg.length > 20 ? "That's worth thinking through — what's the part that matters most?" : "Tell me more."}`;
        reasoning = `General message about ${echo} — show engagement and help focus on what matters most in ${topicStr}.`;
      }

      return {
        response,
        reasoning,
        action: { type: "respond" as const, content: response },
      };
    },

    runtime: async (template) => template.replace(/\{[^}]+\}/g, "..."),

    analysis: async (msg) => {
      const lower = msg.toLowerCase();
      const topics: string[] = [];

      // Topic detection
      if (/work|deadline|project|meeting|client|boss|office/i.test(lower)) topics.push("work");
      if (/art|gallery|music|creative|design|paint|exhibition/i.test(lower)) topics.push("creative");
      if (/health|doctor|sleep|exercise|therapy|pain/i.test(lower)) topics.push("health");
      if (/friend|family|partner|dinner|party|wedding/i.test(lower)) topics.push("social");
      if (/money|rent|invest|budget|tax|loan|salary/i.test(lower)) topics.push("money");
      if (/code|server|deploy|api|bug|database/i.test(lower)) topics.push("tech");

      // Emotion detection
      let emotionalState = "neutral";
      if (/stress|overwhelm|anxious|worried|pressure/i.test(lower)) emotionalState = "stressed";
      else if (/excit|happy|great|thrilled|pumped/i.test(lower)) emotionalState = "excited";
      else if (/frustrat|annoyed|fed up|angry/i.test(lower)) emotionalState = "frustrated";
      else if (/sad|down|low|bummed|disappoint/i.test(lower)) emotionalState = "sad";

      return { topics, entities: [], emotionalState };
    },
  });
}
