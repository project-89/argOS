/**
 * Condition Evaluator — Checks BT conditions against the ECS person model.
 * All operations are O(1) lookups — no LLM needed.
 */

import type { ConditionOp } from "./types.js";
import type { PersonModel } from "../ecs/types.js";
import {
  getHypothesisConfidence, hasHypothesisIncluding,
  hasTopic, getEmotionalState, lastNMessagesInclude,
  getConversationDepth, memoryContains, entityKnown,
  hasActiveIntention, hasBlockedIntention,
  getPendingPredictions, getDomainAccuracy,
  getRecentMessages,
} from "../ecs/person-store.js";

/**
 * Evaluate a condition against the person model. Pure, deterministic, fast.
 */
export function evalCondition(model: PersonModel, op: ConditionOp, userMessage?: string): boolean {
  switch (op.type) {
    // Hypothesis
    case "hypothesis_above":
      return getHypothesisConfidence(model, op.domain) >= op.confidence;
    case "hypothesis_below":
      return getHypothesisConfidence(model, op.domain) <= op.confidence;
    case "has_hypothesis":
      return hasHypothesisIncluding(model, op.includes);

    // Conversation state
    case "person_topic":
      return hasTopic(model, op.topic);
    case "person_state":
      return getEmotionalState(model).toLowerCase() === op.state.toLowerCase();
    case "message_is_question":
      return Boolean(userMessage && (userMessage.includes("?") || /^(who|what|where|when|why|how|can|do|does|is|are|will|would|could|should)\b/i.test(userMessage.trim())));
    case "message_includes":
      return Boolean(userMessage && userMessage.toLowerCase().includes(op.includes.toLowerCase()));
    case "last_n_messages_include":
      return lastNMessagesInclude(model, op.n, op.includes);
    case "conversation_depth_above":
      return getConversationDepth(model) > op.turns;

    // Memory
    case "memory_contains":
      return memoryContains(model, op.query);
    case "entity_known":
      return entityKnown(model, op.name);
    case "entity_mentioned": {
      if (!userMessage) return false;
      const lower = userMessage.toLowerCase();
      return model.entities.some(e => lower.includes(e.name.toLowerCase()));
    }

    // Intentions
    case "intention_active":
      return hasActiveIntention(model, op.domain);
    case "intention_blocked":
      return hasBlockedIntention(model);

    // Predictions
    case "prediction_pending":
      return getPendingPredictions(model, op.domain).length > 0;
    case "prediction_accuracy_above":
      return getDomainAccuracy(model, op.domain) >= op.threshold;

    // Style
    case "style_is": {
      const s = model.style;
      const check = op.style.toLowerCase();
      if (check === "formal") return s.formality > 0.7;
      if (check === "casual") return s.formality < 0.3;
      if (check === "humorous") return s.humor > 0.6;
      if (check === "serious") return s.humor < 0.3;
      if (check === "terse") return s.messageLength === "terse";
      if (check === "verbose") return s.messageLength === "verbose";
      return false;
    }

    // Temporal
    case "time_is": {
      const hour = new Date().getHours();
      const period = op.period.toLowerCase();
      if (period === "morning") return hour >= 5 && hour < 12;
      if (period === "afternoon") return hour >= 12 && hour < 17;
      if (period === "evening") return hour >= 17 && hour < 22;
      if (period === "night") return hour >= 22 || hour < 5;
      return false;
    }
    case "days_since_last_contact": {
      const daysSince = (Date.now() - model.lastInteraction) / (24 * 60 * 60 * 1000);
      return daysSince >= op.min;
    }
    case "session_length_above": {
      const minutes = (Date.now() - model.conversation.sessionStart) / (60 * 1000);
      return minutes > op.minutes;
    }

    // Meta
    case "always":
      return true;
    case "chance":
      return Math.random() < op.p;

    default:
      return false;
  }
}
