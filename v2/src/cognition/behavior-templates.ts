/**
 * Behavior Policy Templates
 *
 * Pre-built behavior trees that can be assigned to agents for deterministic
 * decision-making without LLM calls. These cover common behavioral patterns
 * and can be composed together.
 *
 * Agents with behavior policies will:
 * 1. Try the policy first (deterministic, instant, free)
 * 2. Fall back to LLM only when the policy yields no action
 *
 * Policy evaluation order in agent-mind.ts:
 *   procedural reflex → failure recovery → speech reply → plan execution →
 *   BEHAVIOR POLICY → contract actions → LLM fallback
 */

import type { BehaviorNode } from "./behavior-policy";

// =============================================================================
// PRIMITIVE BEHAVIORS
// =============================================================================

/** Wait and do nothing */
export const WAIT: BehaviorNode = { type: "action", action: { type: "wait" } };

/** Observe the current room */
export const OBSERVE_ROOM: BehaviorNode = {
  type: "action",
  action: { type: "observe", target: "room" },
};

/** Think about what to do */
export const THINK_IDLE: BehaviorNode = {
  type: "action",
  action: { type: "think", content: "What should I do next?" },
};

/** Fall back to LLM for creative decision-making */
export const LLM_FALLBACK: BehaviorNode = { type: "llm_fallback" };

// =============================================================================
// CONDITION HELPERS
// =============================================================================

function needBelow(need: "hunger" | "energy" | "social" | "comfort", value: number): BehaviorNode {
  return { type: "condition", op: { type: "need_below", need, value } };
}

function needAbove(need: "hunger" | "energy" | "social" | "comfort", value: number): BehaviorNode {
  return { type: "condition", op: { type: "need_above", need, value } };
}

function inRoom(roomName: string): BehaviorNode {
  return { type: "condition", op: { type: "in_room", roomName } };
}

function hasGoal(includes: string): BehaviorNode {
  return { type: "condition", op: { type: "has_goal", includes } };
}

function hasMovementGoal(dest?: string): BehaviorNode {
  return { type: "condition", op: { type: "has_active_movement_goal", destinationIncludes: dest } };
}

function roomHasNamed(name: string): BehaviorNode {
  return { type: "condition", op: { type: "room_has_named", name } };
}

function chance(p: number): BehaviorNode {
  return { type: "condition", op: { type: "chance", p } };
}

// =============================================================================
// COMPOSITE BEHAVIORS
// =============================================================================

/**
 * Sequence: all conditions must pass, then execute the action
 */
function guardedAction(conditions: BehaviorNode[], action: BehaviorNode): BehaviorNode {
  return { type: "sequence", children: [...conditions, action] };
}

/**
 * Selector: try each child in order, return first success
 */
function firstOf(...children: BehaviorNode[]): BehaviorNode {
  return { type: "selector", children };
}

/**
 * Eat food if hungry (energy < threshold)
 */
export function eatWhenHungry(threshold: number = 40): BehaviorNode {
  return guardedAction(
    [needBelow("energy", threshold)],
    { type: "interact_with_trait", trait: "food", affordance: "eat", scope: "accessible" }
  );
}

/**
 * Drink if thirsty (comfort < threshold, proxy for thirst)
 */
export function drinkWhenThirsty(threshold: number = 40): BehaviorNode {
  return guardedAction(
    [needBelow("comfort", threshold)],
    { type: "interact_with_trait", trait: "drinkable", affordance: "drink", scope: "accessible" }
  );
}

/**
 * Talk to someone if lonely (social < threshold)
 */
export function socializeWhenLonely(threshold: number = 30): BehaviorNode {
  return guardedAction(
    [needBelow("social", threshold)],
    { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
  );
}

/**
 * Rest/sleep if exhausted (energy < threshold)
 */
export function restWhenExhausted(threshold: number = 20): BehaviorNode {
  return guardedAction(
    [needBelow("energy", threshold)],
    { type: "interact_with_trait", trait: "sleepable", affordance: "sleep", scope: "room" }
  );
}

/**
 * Move to a specific room
 */
export function goTo(roomName: string): BehaviorNode {
  return { type: "action", action: { type: "move", target: roomName } };
}

/**
 * Move to room if not already there
 */
export function goToIfNotThere(roomName: string): BehaviorNode {
  return firstOf(
    guardedAction([inRoom(roomName)], { type: "noop" }), // already there, skip
    guardedAction([hasMovementGoal(roomName)], { type: "noop" }), // already moving, skip
    goTo(roomName),
  );
}

/**
 * Talk to a specific person if they're in the room
 */
export function talkTo(personName: string, content?: string): BehaviorNode {
  return guardedAction(
    [roomHasNamed(personName)],
    { type: "action", action: { type: "speak", target: personName, content: content || `Hey ${personName}` } }
  );
}

// =============================================================================
// ROLE-BASED POLICY TEMPLATES
// =============================================================================

/**
 * Basic survival policy: eat, drink, rest, then socialize
 * Good for any living agent.
 */
export function survivalPolicy(): BehaviorNode {
  return firstOf(
    restWhenExhausted(15),
    eatWhenHungry(30),
    drinkWhenThirsty(30),
    socializeWhenLonely(20),
    LLM_FALLBACK,
  );
}

/**
 * Innkeeper/bartender: serve food, maintain tavern, chat with guests
 */
export function innkeeperPolicy(innName: string = "Main Hall"): BehaviorNode {
  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(25),
    // Stay at the inn
    goToIfNotThere(innName),
    // If someone's here, talk to them (50% chance per tick to avoid spam)
    guardedAction(
      [chance(0.5)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Otherwise observe the room
    guardedAction([chance(0.3)], OBSERVE_ROOM),
    LLM_FALLBACK,
  );
}

/**
 * Guard/bounty hunter: patrol between locations, observe, be alert
 */
export function guardPolicy(patrolRooms: string[]): BehaviorNode {
  const patrolChildren: BehaviorNode[] = patrolRooms.map(room =>
    guardedAction(
      [chance(1 / patrolRooms.length)],
      goTo(room)
    )
  );

  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(20),
    // Always observe first
    guardedAction([chance(0.4)], OBSERVE_ROOM),
    // Patrol to a random room
    firstOf(...patrolChildren),
    LLM_FALLBACK,
  );
}

/**
 * Scholar/mystic: examine things, think, share knowledge
 */
export function scholarPolicy(): BehaviorNode {
  return firstOf(
    restWhenExhausted(15),
    eatWhenHungry(30),
    // Examine interesting objects
    guardedAction(
      [chance(0.3)],
      { type: "interact_with_trait", trait: "examinable", affordance: "examine", scope: "room" }
    ),
    // Think and reflect
    guardedAction(
      [chance(0.3)],
      { type: "action", action: { type: "think", content: "I contemplate what I've observed..." } }
    ),
    // Socialize to share knowledge
    socializeWhenLonely(40),
    LLM_FALLBACK,
  );
}

/**
 * Merchant: trade, manage inventory, greet customers
 */
export function merchantPolicy(shopRoom: string = "Shop"): BehaviorNode {
  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(20),
    goToIfNotThere(shopRoom),
    // Greet visitors
    guardedAction(
      [chance(0.4)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Check inventory
    guardedAction(
      [chance(0.2)],
      { type: "interact_with_trait", trait: "examinable", affordance: "examine", scope: "room" }
    ),
    LLM_FALLBACK,
  );
}

/**
 * Worker: go to workplace, interact with work objects, take breaks
 */
export function workerPolicy(workplace: string, workTrait: string = "workable"): BehaviorNode {
  return firstOf(
    restWhenExhausted(15),
    eatWhenHungry(25),
    drinkWhenThirsty(25),
    goToIfNotThere(workplace),
    // Do work
    guardedAction(
      [inRoom(workplace)],
      { type: "interact_with_trait", trait: workTrait, affordance: "use", scope: "room" }
    ),
    // Socialize on break
    guardedAction(
      [needBelow("social", 30), chance(0.3)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    LLM_FALLBACK,
  );
}

// =============================================================================
// TEMPLATE REGISTRY
// =============================================================================

export type PolicyTemplateName =
  | "survival"
  | "innkeeper"
  | "guard"
  | "scholar"
  | "merchant"
  | "worker"
  | "idle";

/**
 * Get a behavior policy template by name.
 * Returns null if template not found.
 */
export function getPolicyTemplate(
  name: PolicyTemplateName,
  params?: Record<string, any>
): BehaviorNode | null {
  switch (name) {
    case "survival":
      return survivalPolicy();
    case "innkeeper":
      return innkeeperPolicy(params?.room || "Main Hall");
    case "guard":
      return guardPolicy(params?.rooms || ["Main Hall", "Courtyard"]);
    case "scholar":
      return scholarPolicy();
    case "merchant":
      return merchantPolicy(params?.room || "Shop");
    case "worker":
      return workerPolicy(params?.workplace || "Workshop", params?.workTrait || "workable");
    case "idle":
      return firstOf(
        survivalPolicy(),
        guardedAction([chance(0.3)], OBSERVE_ROOM),
        WAIT,
      );
    default:
      return null;
  }
}

/**
 * Get all available template names
 */
export function getAvailableTemplates(): PolicyTemplateName[] {
  return ["survival", "innkeeper", "guard", "scholar", "merchant", "worker", "idle"];
}

/**
 * Infer a suitable policy template from an agent's role description
 */
export function inferPolicyFromRole(role: string): { template: PolicyTemplateName; params?: Record<string, any> } {
  const r = role.toLowerCase();

  if (r.includes("innkeeper") || r.includes("bartender") || r.includes("tavern")) {
    return { template: "innkeeper" };
  }
  if (r.includes("guard") || r.includes("bounty") || r.includes("patrol") || r.includes("soldier") || r.includes("knight")) {
    return { template: "guard", params: { rooms: ["Main Hall", "Courtyard", "Gate"] } };
  }
  if (r.includes("scholar") || r.includes("mystic") || r.includes("sage") || r.includes("fortune") || r.includes("wizard") || r.includes("mage")) {
    return { template: "scholar" };
  }
  if (r.includes("merchant") || r.includes("trader") || r.includes("shopkeeper") || r.includes("vendor")) {
    return { template: "merchant" };
  }
  if (r.includes("baker") || r.includes("blacksmith") || r.includes("smith") || r.includes("farmer") || r.includes("craftsman") || r.includes("worker")) {
    return { template: "worker", params: { workplace: "Workshop" } };
  }

  return { template: "survival" };
}
