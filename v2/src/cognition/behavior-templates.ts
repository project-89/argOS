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

/** Wander to a random different room */
export const WANDER: BehaviorNode = { type: "wander" };

/** Visit another agent in a different room */
export const SOCIAL_VISIT: BehaviorNode = { type: "social_visit" };

/** Interact with anything available (discovers affordances dynamically) */
export const INTERACT_ANY: BehaviorNode = {
  type: "interact_any_affordance", scope: "room",
};

/**
 * Rich fallback: replaces WAIT as terminal node in all templates.
 * Weighted random selection ensures agents always do SOMETHING.
 * Wait is ~8% instead of the old 50%.
 */
export const RICH_FALLBACK: BehaviorNode = {
  type: "weighted_random",
  choices: [
    { weight: 4, child: OBSERVE_ROOM },
    { weight: 3, child: { type: "interact_any_affordance", scope: "room" } },
    { weight: 3, child: { type: "action", action: { type: "think", content: "I take stock of my situation..." } } },
    { weight: 3, child: WANDER },
    { weight: 2, child: SOCIAL_VISIT },
    { weight: 2, child: { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" } },
    { weight: 1, child: WAIT },
  ],
};

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

function noMovementGoal(): BehaviorNode {
  return { type: "condition", op: { type: "no_active_movement_goal" } };
}

function notInRoom(roomName: string): BehaviorNode {
  return { type: "condition", op: { type: "not_in_room", roomName } };
}

function roomHasNamed(name: string): BehaviorNode {
  return { type: "condition", op: { type: "room_has_named", name } };
}

function chance(p: number): BehaviorNode {
  return { type: "condition", op: { type: "chance", p } };
}

function lastActionNot(actionType: string): BehaviorNode {
  return { type: "condition", op: { type: "last_action_not", actionType } };
}

function roomHasOtherAgents(): BehaviorNode {
  return { type: "condition", op: { type: "room_has_other_agents" } };
}

function roomIsEmpty(): BehaviorNode {
  return { type: "condition", op: { type: "room_is_empty" } };
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
    { type: "interact_with_trait", trait: "edible", affordance: "eat", scope: "accessible" }
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
export function socializeWhenLonely(threshold: number = 60): BehaviorNode {
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
 * Move to room if not already there.
 * Returns action only when agent needs to start moving.
 * Returns "none" (noop) when already in room or already moving — lets selector continue.
 */
export function goToIfNotThere(roomName: string): BehaviorNode {
  return guardedAction(
    [notInRoom(roomName), noMovementGoal()],
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
    socializeWhenLonely(30),
    // Go socialize if alone and not too recently moved
    guardedAction([roomIsEmpty(), chance(0.3), lastActionNot("move")], SOCIAL_VISIT),
    // Wander to explore
    guardedAction([chance(0.2), lastActionNot("move")], WANDER),
    // Interact with anything available (discovers verbs dynamically)
    guardedAction([chance(0.3), lastActionNot("interact")], INTERACT_ANY),
    // Observe surroundings (but not twice in a row)
    guardedAction([chance(0.3), lastActionNot("observe")], OBSERVE_ROOM),
    // Talk to anyone nearby
    guardedAction(
      [roomHasOtherAgents(), chance(0.3)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Think about situation
    guardedAction([chance(0.2), lastActionNot("think")], { type: "action", action: { type: "think", content: "I consider what to do next..." } }),
    RICH_FALLBACK,
  );
}

/**
 * Innkeeper/bartender: serve food, maintain tavern, chat with guests
 */
export function innkeeperPolicy(innName: string = "Main Hall"): BehaviorNode {
  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(25),
    // Return to inn if away — but only with 60% chance so we don't snap back instantly
    guardedAction([notInRoom(innName), noMovementGoal(), chance(0.6)], goTo(innName)),
    // When guests are present: chat, serve, interact
    guardedAction(
      [roomHasOtherAgents(), chance(0.4)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Interact with tavern items (serve drinks, tend bar, etc.)
    guardedAction([chance(0.3), lastActionNot("interact")], INTERACT_ANY),
    // Occasionally step out to check on the town
    guardedAction([chance(0.12), lastActionNot("move")], WANDER),
    // Observe the room
    guardedAction([chance(0.25), lastActionNot("observe")], OBSERVE_ROOM),
    // Think about innkeeping
    guardedAction([chance(0.2), lastActionNot("think")], { type: "action", action: { type: "think", content: "I wonder what my guests need today..." } }),
    socializeWhenLonely(70),
    RICH_FALLBACK,
  );
}

/**
 * Guard/bounty hunter: patrol between locations, observe, be alert
 */
export function guardPolicy(patrolRooms: string[]): BehaviorNode {
  const patrolChildren: BehaviorNode[] = patrolRooms.map(room =>
    guardedAction(
      [chance(1 / patrolRooms.length), lastActionNot("move")],
      goToIfNotThere(room)
    )
  );

  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(20),
    // Observe surroundings frequently — guards are alert
    guardedAction([chance(0.3), lastActionNot("observe")], OBSERVE_ROOM),
    // Question people in the area
    guardedAction(
      [roomHasOtherAgents(), chance(0.25)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Examine items
    guardedAction([chance(0.2), lastActionNot("interact")], INTERACT_ANY),
    // Patrol to a random room
    firstOf(...patrolChildren),
    // Wander if no patrol rooms available
    guardedAction([chance(0.25), lastActionNot("move")], WANDER),
    RICH_FALLBACK,
  );
}

/**
 * Scholar/mystic: examine things, think, share knowledge
 */
export function scholarPolicy(studyRoom?: string): BehaviorNode {
  const base: BehaviorNode[] = [
    restWhenExhausted(15),
    eatWhenHungry(30),
  ];
  if (studyRoom) {
    base.push(guardedAction([notInRoom(studyRoom), noMovementGoal(), chance(0.6)], goTo(studyRoom)));
  }
  return firstOf(
    ...base,
    // Read books and tomes — primary scholarly activity
    guardedAction(
      [chance(0.3), lastActionNot("interact")],
      { type: "interact_with_trait", trait: "readable", affordance: "read", scope: "accessible" }
    ),
    // Interact with anything scholarly
    guardedAction([chance(0.25), lastActionNot("interact")], INTERACT_ANY),
    // Think and reflect
    guardedAction(
      [chance(0.25), lastActionNot("think")],
      { type: "action", action: { type: "think", content: "I contemplate what I've observed..." } }
    ),
    // Observe the environment
    guardedAction([chance(0.2), lastActionNot("observe")], OBSERVE_ROOM),
    // Discuss findings with others
    guardedAction(
      [roomHasOtherAgents(), chance(0.25)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Visit other locations for research
    guardedAction([chance(0.15), lastActionNot("move")], WANDER),
    // Social visits
    guardedAction([roomIsEmpty(), chance(0.2)], SOCIAL_VISIT),
    socializeWhenLonely(40),
    RICH_FALLBACK,
  );
}

/**
 * Merchant: trade, manage inventory, greet customers
 */
export function merchantPolicy(shopRoom: string = "Shop"): BehaviorNode {
  return firstOf(
    restWhenExhausted(10),
    eatWhenHungry(20),
    // Return to shop — but allow time away
    guardedAction([notInRoom(shopRoom), noMovementGoal(), chance(0.6)], goTo(shopRoom)),
    // Greet visitors when present
    guardedAction(
      [roomHasOtherAgents(), chance(0.35)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Interact with wares (trade, examine, arrange)
    guardedAction([chance(0.3), lastActionNot("interact")], INTERACT_ANY),
    // Go source supplies or visit other shops
    guardedAction([chance(0.15), lastActionNot("move")], WANDER),
    // Observe the shop
    guardedAction([chance(0.2), lastActionNot("observe")], OBSERVE_ROOM),
    // Think about business
    guardedAction([chance(0.15), lastActionNot("think")], { type: "action", action: { type: "think", content: "I consider my trade prospects..." } }),
    RICH_FALLBACK,
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
    // Return to workplace — but allow breaks
    guardedAction([notInRoom(workplace), noMovementGoal(), chance(0.6)], goTo(workplace)),
    // Do work — primary activity (use workable items)
    guardedAction(
      [inRoom(workplace), chance(0.35), lastActionNot("interact")],
      { type: "interact_with_trait", trait: workTrait, affordance: "use", scope: "room" }
    ),
    // Interact with work materials (discover affordances)
    guardedAction([inRoom(workplace), chance(0.25), lastActionNot("interact")], INTERACT_ANY),
    // Take a break — visit tavern or socialize
    guardedAction([chance(0.12), lastActionNot("move")], SOCIAL_VISIT),
    guardedAction([chance(0.1), lastActionNot("move")], WANDER),
    // Observe surroundings
    guardedAction([chance(0.2), lastActionNot("observe")], OBSERVE_ROOM),
    // Socialize on break
    guardedAction(
      [roomHasOtherAgents(), chance(0.25)],
      { type: "interact_with_trait", trait: "talkable", affordance: "talk", scope: "room" }
    ),
    // Think about work
    guardedAction([chance(0.15), lastActionNot("think")], { type: "action", action: { type: "think", content: "I focus on the quality of my craft..." } }),
    RICH_FALLBACK,
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
      return scholarPolicy(params?.room);
    case "merchant":
      return merchantPolicy(params?.room || "Shop");
    case "worker":
      return workerPolicy(params?.workplace || params?.room || "Workshop", params?.workTrait || "workable");
    case "idle":
      return firstOf(
        survivalPolicy(),
        RICH_FALLBACK,
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

  if (r.includes("innkeeper") || r.includes("bartender") || r.includes("tavern") || r.includes("barkeep") || r.includes("host")) {
    return { template: "innkeeper" };
  }
  if (r.includes("guard") || r.includes("bounty") || r.includes("patrol") || r.includes("soldier") || r.includes("knight") || r.includes("detective") || r.includes("commander") || r.includes("officer")) {
    return { template: "guard", params: { rooms: ["Main Hall", "Courtyard", "Gate"] } };
  }
  if (r.includes("scholar") || r.includes("mystic") || r.includes("sage") || r.includes("fortune") || r.includes("wizard") || r.includes("mage") || r.includes("monk") || r.includes("priest") || r.includes("doctor") || r.includes("scientist") || r.includes("medical") || r.includes("elder")) {
    return { template: "scholar" };
  }
  if (r.includes("merchant") || r.includes("trader") || r.includes("shopkeeper") || r.includes("vendor") || r.includes("noble") || r.includes("drifter")) {
    return { template: "merchant" };
  }
  if (r.includes("baker") || r.includes("blacksmith") || r.includes("smith") || r.includes("farmer") || r.includes("craftsman") || r.includes("worker") || r.includes("engineer") || r.includes("butler") || r.includes("cook") || r.includes("chef")) {
    return { template: "worker", params: { workplace: "Workshop" } };
  }

  return { template: "survival" };
}
