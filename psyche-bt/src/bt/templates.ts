/**
 * Template Filler — Resolves template variables from the ECS person model.
 * Deterministic. No LLM. Just data lookups.
 */

import type { PersonModel } from "../ecs/types.js";
import {
  getActiveIntentions, searchMemory, getRecentMessages,
  getCurrentTopics, getEntity,
} from "../ecs/person-store.js";

/**
 * Fill a template string with values from the person model.
 * Variables in {curly_braces} are resolved against the model.
 * Unknown variables are left as empty strings.
 */
export function fillTemplate(template: string, variables: string[], model: PersonModel, userMessage?: string): string {
  let result = template;

  // Resolve each named variable
  for (const varName of variables) {
    const value = resolveVariable(varName, model, userMessage);
    // Replace all occurrences of {varName} in the template
    result = result.replace(new RegExp(`\\{${escapeRegex(varName)}\\}`, "g"), value);
  }

  // Also resolve any {inline_variables} not in the explicit list
  result = result.replace(/\{(\w+)\}/g, (match, name) => {
    const value = resolveVariable(name, model, userMessage);
    return value || match; // Leave unresolved if no value found
  });

  return result;
}

function resolveVariable(name: string, model: PersonModel, userMessage?: string): string {
  switch (name) {
    // Intention variables
    case "blocked_intention":
    case "blocked_intention_claim": {
      const blocked = model.intentions.find(i => i.status === "blocked");
      return blocked?.claim || "something I'm working on";
    }
    case "blocked_intention_question": {
      const blocked = model.intentions.find(i => i.status === "blocked");
      const blockedStep = blocked?.plan.find(s => s.status === "blocked");
      return blockedStep?.description || "Can you help me with something?";
    }
    case "active_intention":
    case "active_intention_claim": {
      const active = getActiveIntentions(model);
      return active[0]?.claim || "";
    }
    case "active_intention_status": {
      const active = getActiveIntentions(model);
      if (!active[0]) return "";
      const completed = active[0].plan.filter(s => s.status === "completed").length;
      const total = active[0].plan.length;
      return total > 0 ? `${completed}/${total} steps done` : "just getting started";
    }
    case "active_step":
    case "current_intention_step": {
      const active = getActiveIntentions(model);
      const current = active[0]?.plan.find(s => s.status === "pending" || s.status === "in_progress");
      return current?.description || "the next step";
    }

    // Entity variables
    case "mentioned_entity_context": {
      if (!userMessage) return "";
      const lower = userMessage.toLowerCase();
      const entity = model.entities.find(e => lower.includes(e.name.toLowerCase()));
      return entity?.context || "";
    }

    // Memory variables
    case "gallery_deadline":
    case "deadline_context": {
      const memories = searchMemory(model, "deadline", 1);
      return memories[0]?.content || "";
    }

    // Conversation variables
    case "active_project": {
      const topics = getCurrentTopics(model);
      return topics[0] || "your project";
    }

    // Style variables
    case "greeting": {
      return model.style.preferredGreeting || "Hey";
    }

    default: {
      // Try to resolve from memory
      const memories = searchMemory(model, name.replace(/_/g, " "), 1);
      if (memories.length > 0) return memories[0].content;

      // Try to resolve from entities
      const entity = getEntity(model, name.replace(/_/g, " "));
      if (entity) return entity.context;

      return "";
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
