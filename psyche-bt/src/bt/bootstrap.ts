/**
 * Bootstrap Tree — Default behavior for new users.
 *
 * Handles the first 5-10 conversations before enough patterns are compiled.
 * Generic but warm. Gets refined, not replaced.
 */

import type { BehaviorNode } from "./types.js";

/**
 * Create the bootstrap behavior tree for a new user.
 * This is the "species-level" default — works for anyone.
 */
export function createBootstrapTree(): BehaviorNode {
  return {
    type: "selector",
    children: [
      // HIGH PRIORITY: Agent has a blocked intention that needs user input
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "intention_blocked" } },
          { type: "template_response",
            template: "By the way — I had a question about {blocked_intention}. {question}",
            variables: ["blocked_intention_claim", "blocked_intention_question"] },
        ],
      },

      // Direct question → acknowledge and try to answer
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "message_is_question" } },
          { type: "condition", op: { type: "entity_mentioned" } },
          { type: "template_response",
            template: "Let me look into that — {entity_context}",
            variables: ["mentioned_entity_context"] },
        ],
      },

      // Stressed → empathize + offer concrete help
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "person_state", state: "stressed" } },
          { type: "weighted_random",
            choices: [
              { weight: 3, child: { type: "template_response",
                template: "That sounds like a lot. What's the most pressing thing right now?",
                variables: [] } },
              { weight: 2, child: { type: "template_response",
                template: "I hear you. Want to talk through it, or should I just help knock something off your plate?",
                variables: [] } },
            ] },
        ],
      },

      // Excited → match energy
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "person_state", state: "excited" } },
          { type: "template_response",
            template: "That's great! Tell me more about it.",
            variables: [] },
        ],
      },

      // Returning after a break → warm reconnect
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "days_since_last_contact", min: 1 } },
          { type: "template_response",
            template: "Hey, good to hear from you. What's been happening?",
            variables: [] },
        ],
      },

      // Long session → check in
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "session_length_above", minutes: 30 } },
          { type: "condition", op: { type: "chance", p: 0.3 } },
          { type: "template_response",
            template: "We've been going for a bit — anything else on your mind, or are you good?",
            variables: [] },
        ],
      },

      // Active intention → proactively update
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "conversation_depth_above", turns: 3 } },
          { type: "condition", op: { type: "chance", p: 0.2 } },
          { type: "condition", op: { type: "intention_active", domain: "" } }, // Any active intention
          { type: "template_response",
            template: "Also — just so you know, I'm still working on {active_intention}. {intention_status}",
            variables: ["active_intention_claim", "active_intention_status"] },
        ],
      },

      // DEFAULT FALLBACK: Escalate to larger model
      // This catches everything the bootstrap tree can't handle.
      // Each time it fires, the compiler captures the result for future BT growth.
      { type: "llm_escalate" },
    ],
  };
}
