import type { World } from "../ecs/world";
import { addComponent, getRelationTargets, hasComponent, query } from "bitecs";
import { Agent, BehaviorPolicy, Belief, Goal, LastAction, Memory, Name, Needs, Perception, Room, Traits, Impression } from "../ecs/components";
import { HasGoal, HasPerception, HasImpression, HasMemory, HasBelief } from "../ecs/relations";
import { getRecentActions } from "./agent-action-history";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getMovementTarget } from "../systems/builtin-systems";
import { getSkillTree, recordSkillOutcome } from "./skill-registry";

export type PolicyAction = {
  type: "speak" | "observe" | "move" | "interact" | "think" | "wait" | "rest" | "reflect";
  target?: string;
  content?: string;
};

export type BehaviorNode =
  | { type: "selector"; children: BehaviorNode[] }
  | { type: "sequence"; children: BehaviorNode[] }
  | { type: "condition"; op: ConditionOp }
  | { type: "action"; action: PolicyAction }
  | { type: "interact_with_trait"; trait: string; affordance: string; args?: string; scope?: "room" | "accessible" }
  | { type: "interact_any_affordance"; scope?: "room" | "accessible"; exclude?: string[] }
  | { type: "weighted_random"; choices: Array<{ weight: number; child: BehaviorNode }> }
  | { type: "social_visit"; minImpression?: number }
  | { type: "use_procedure"; signature: string; minSuccesses?: number }
  | { type: "skill"; name: string }
  | { type: "llm_skill"; purpose: string; temperature?: number }
  | { type: "wander" }
  | { type: "llm_fallback" }
  | { type: "noop" };

export type ConditionOp =
  | { type: "always" }
  | { type: "chance"; p: number }
  | { type: "need_above"; need: "hunger" | "energy" | "social" | "comfort"; value: number }
  | { type: "need_below"; need: "hunger" | "energy" | "social" | "comfort"; value: number }
  | { type: "in_room"; roomName: string }
  | { type: "not_in_room"; roomName: string }
  | { type: "has_perception"; perceptionType: string; includes?: string }
  | { type: "has_goal"; includes: string }
  | { type: "has_active_movement_goal"; destinationIncludes?: string }
  | { type: "no_active_movement_goal" }
  | { type: "room_has_named"; name: string }
  | { type: "last_action_was"; actionType: string }
  | { type: "last_action_not"; actionType: string }
  | { type: "room_has_other_agents" }
  | { type: "room_is_empty" }
  | { type: "has_memory"; includes: string }
  | { type: "has_belief"; includes: string }
  | { type: "impression_above"; targetName: string; threshold: number }
  | { type: "impression_below"; targetName: string; threshold: number }
  | { type: "last_n_actions_include"; n: number; actionType: string }
  | { type: "last_n_actions_exclude"; n: number; actionType: string };

export type PolicyEvalResult =
  | { kind: "action"; action: PolicyAction; trace: string[] }
  | { kind: "start_procedure"; signature: string; minSuccesses: number; trace: string[] }
  | { kind: "llm_fallback"; trace: string[] }
  | { kind: "none"; trace: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseTraitsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasTrait(world: World, eid: number, trait: string): boolean {
  if (!hasComponent(world as any, eid, Traits as any)) return false;
  const traits = parseTraitsJson(Traits.active[eid]);
  const wanted = trait.trim().toLowerCase();
  return traits.some((t) => t.toLowerCase() === wanted);
}

function isDescendantContainedIn(world: World, containerEid: number, targetEid: number, maxNodes: number = 256): boolean {
  if (containerEid === targetEid) return true;

  const visited = new Set<number>();
  const stack: number[] = [containerEid];

  while (stack.length > 0 && visited.size < maxNodes) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const child of listDirectContents(world, current)) {
      if (child === targetEid) return true;
      stack.push(child);
    }
  }

  return false;
}

function findInteractTargetByTrait(
  world: World,
  agentEid: number,
  opts: { trait: string; affordance: string; scope: "room" | "accessible" }
): number | undefined {
  const trait = opts.trait.trim();
  const affordance = opts.affordance.trim().toLowerCase();
  if (!trait || !affordance) return undefined;

  const roomEid = getRoomForEntity(world, agentEid);
  const candidates: number[] = [];

  if (opts.scope === "room") {
    if (roomEid === undefined) return undefined;
    candidates.push(...listDirectContents(world, roomEid));
  } else {
    // "accessible": direct room contents + anything in the actor's containment tree (inventory/bags).
    if (roomEid !== undefined) candidates.push(...listDirectContents(world, roomEid));
    candidates.push(...listDirectContents(world, agentEid));
  }

  const seen = new Set<number>();
  let fallback: number | undefined;
  for (const eid of candidates) {
    if (eid === agentEid) continue; // Don't interact with self
    if (seen.has(eid)) continue;
    seen.add(eid);
    if (!hasTrait(world, eid, trait)) continue;

    // If scope=accessible and the item isn't in the room, ensure it's in the agent's containment tree.
    if (opts.scope === "accessible") {
      const inAgentTree = isDescendantContainedIn(world, agentEid, eid);
      const inRoom = roomEid !== undefined && isDescendantContainedIn(world, roomEid, eid);
      if (!inAgentTree && !inRoom) continue;
    }

    const affordances = getAvailableAffordances(world, agentEid, eid);
    if (!affordances.some((a) => a.name === affordance)) continue;

    // Prefer entities with meaningful names (skip generic type names like "npc", "object")
    const name = String(Name.value[eid] || "").trim();
    if (!name || name === "npc" || name === "object" || name === "room") {
      if (fallback === undefined) fallback = eid;
      continue;
    }
    return eid;
  }

  return fallback;
}

export function validateBehaviorNode(
  node: unknown,
  opts?: { maxDepth?: number; maxNodes?: number; maxJsonBytes?: number; allowedActionTypes?: Set<string> }
): { ok: true } | { ok: false; error: string } {
  const maxDepth = opts?.maxDepth ?? 18;
  const maxNodes = opts?.maxNodes ?? 300;
  const maxJsonBytes = opts?.maxJsonBytes ?? 25_000;

  let seen = 0;

  const validateAction = (action: unknown): string | null => {
    if (!isPlainObject(action)) return "action must be an object";
    const type = String(action.type || "");
    const builtinAllowed = new Set(["speak", "observe", "move", "interact", "think", "wait", "rest", "reflect"]);
    // Allow both builtin action types and any custom-registered action types
    const customAllowed = opts?.allowedActionTypes;
    if (!builtinAllowed.has(type) && (!customAllowed || !customAllowed.has(type))) {
      return `unsupported action.type: ${type}`;
    }
    if ("target" in action && action.target !== undefined && typeof action.target !== "string") return "action.target must be a string";
    if ("content" in action && action.content !== undefined && typeof action.content !== "string") return "action.content must be a string";
    return null;
  };

  const validateConditionOp = (op: unknown): string | null => {
    if (!isPlainObject(op)) return "condition.op must be an object";
    const type = String(op.type || "");
    switch (type) {
      case "always":
        return null;
      case "chance": {
        const p = Number((op as any).p);
        if (!Number.isFinite(p) || p < 0 || p > 1) return "chance.p must be a number between 0 and 1";
        return null;
      }
      case "need_above":
      case "need_below": {
        const need = String((op as any).need || "");
        const allowed = new Set(["hunger", "energy", "social", "comfort"]);
        if (!allowed.has(need)) return `unsupported need: ${need}`;
        const value = Number((op as any).value);
        if (!Number.isFinite(value)) return "need_* value must be a finite number";
        return null;
      }
      case "in_room":
      case "not_in_room": {
        const roomName = String((op as any).roomName || "").trim();
        if (!roomName) return `${type}.roomName required`;
        return null;
      }
      case "no_active_movement_goal":
      case "room_has_other_agents":
      case "room_is_empty":
        return null;
      case "last_action_was":
      case "last_action_not": {
        const actionType = String((op as any).actionType || "").trim();
        if (!actionType) return `${type}.actionType required`;
        return null;
      }
      case "has_goal": {
        const includes = String((op as any).includes || "").trim();
        if (!includes) return "has_goal.includes required";
        return null;
      }
      case "has_active_movement_goal": {
        if ("destinationIncludes" in op && (op as any).destinationIncludes !== undefined && typeof (op as any).destinationIncludes !== "string") {
          return "has_active_movement_goal.destinationIncludes must be a string";
        }
        return null;
      }
      case "room_has_named": {
        const name = String((op as any).name || "").trim();
        if (!name) return "room_has_named.name required";
        return null;
      }
      case "has_perception": {
        const perceptionType = String((op as any).perceptionType || "").trim();
        if (!perceptionType) return "has_perception.perceptionType required";
        if ("includes" in op && (op as any).includes !== undefined && typeof (op as any).includes !== "string") {
          return "has_perception.includes must be a string";
        }
        return null;
      }
      case "has_memory":
      case "has_belief": {
        const includes = String((op as any).includes || "").trim();
        if (!includes) return `${type}.includes required`;
        return null;
      }
      case "impression_above":
      case "impression_below": {
        const tName = String((op as any).targetName || "").trim();
        if (!tName) return `${type}.targetName required`;
        const thresh = Number((op as any).threshold);
        if (!Number.isFinite(thresh)) return `${type}.threshold must be a finite number`;
        return null;
      }
      case "last_n_actions_include":
      case "last_n_actions_exclude": {
        const nVal = Number((op as any).n);
        if (!Number.isFinite(nVal) || nVal < 1 || nVal > 100) return `${type}.n must be a number 1..100`;
        const aType = String((op as any).actionType || "").trim();
        if (!aType) return `${type}.actionType required`;
        return null;
      }
      default:
        return `unsupported condition op: ${type}`;
    }
  };

  const walk = (n: unknown, depth: number): string | null => {
    if (depth > maxDepth) return "policy tree too deep";
    if (!isPlainObject(n)) return "node must be an object";
    const type = String((n as any).type || "");
    if (!type) return "node.type required";
    seen += 1;
    if (seen > maxNodes) return "policy tree too large";

    switch (type) {
      case "selector":
      case "sequence": {
        const children = (n as any).children;
        if (!Array.isArray(children)) return `${type}.children must be an array`;
        if (children.length > 80) return `${type}.children too large`;
        for (const c of children) {
          const err = walk(c, depth + 1);
          if (err) return err;
        }
        return null;
      }
      case "condition":
        return validateConditionOp((n as any).op);
      case "action":
        return validateAction((n as any).action);
      case "llm_fallback":
      case "noop":
      case "wander":
      case "social_visit":
        return null;
      case "skill": {
        const skillName = String((n as any).name || "").trim();
        if (!skillName) return "skill.name required";
        return null;
      }
      case "llm_skill": {
        const purpose = String((n as any).purpose || "").trim();
        if (!purpose) return "llm_skill.purpose required";
        return null;
      }
      case "interact_any_affordance": {
        if ("scope" in n && (n as any).scope !== undefined) {
          const scope = String((n as any).scope || "");
          if (scope !== "room" && scope !== "accessible") return "interact_any_affordance.scope must be 'room' or 'accessible'";
        }
        if ("exclude" in n && (n as any).exclude !== undefined) {
          if (!Array.isArray((n as any).exclude)) return "interact_any_affordance.exclude must be an array";
        }
        return null;
      }
      case "weighted_random": {
        const choices = (n as any).choices;
        if (!Array.isArray(choices)) return "weighted_random.choices must be an array";
        if (choices.length > 30) return "weighted_random.choices too large";
        for (const c of choices) {
          if (!isPlainObject(c)) return "weighted_random choice must be an object";
          if (typeof (c as any).weight !== "number") return "weighted_random choice.weight must be a number";
          const err = walk((c as any).child, depth + 1);
          if (err) return err;
        }
        return null;
      }
      case "use_procedure": {
        const signature = String((n as any).signature || "").trim();
        if (!signature) return "use_procedure.signature required";
        if (signature.length > 200) return "use_procedure.signature too long";
        if ("minSuccesses" in n && (n as any).minSuccesses !== undefined) {
          const ms = Number((n as any).minSuccesses);
          if (!Number.isFinite(ms) || ms < 0 || ms > 100) return "use_procedure.minSuccesses must be a number 0..100";
        }
        return null;
      }
      case "interact_with_trait": {
        const trait = String((n as any).trait || "").trim();
        const affordance = String((n as any).affordance || "").trim();
        if (!trait) return "interact_with_trait.trait required";
        if (!affordance) return "interact_with_trait.affordance required";
        if ("args" in n && (n as any).args !== undefined && typeof (n as any).args !== "string") {
          return "interact_with_trait.args must be a string";
        }
        if ("scope" in n && (n as any).scope !== undefined) {
          const scope = String((n as any).scope || "");
          if (scope !== "room" && scope !== "accessible") return "interact_with_trait.scope must be 'room' or 'accessible'";
        }
        return null;
      }
      default:
        return `unsupported node type: ${type}`;
    }
  };

  try {
    const json = JSON.stringify(node);
    if (json.length > maxJsonBytes) return { ok: false, error: "policy JSON too large" };
  } catch {
    return { ok: false, error: "policy is not JSON-serializable" };
  }

  const err = walk(node, 0);
  return err ? { ok: false, error: err } : { ok: true };
}

function safeParseTree(json: string): BehaviorNode | null {
  const raw = String(json || "").trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.type !== "string") return null;
    const validated = validateBehaviorNode(obj);
    if (!validated.ok) return null;
    return obj as BehaviorNode;
  } catch {
    return null;
  }
}

function getNeedValue(world: World, agentEid: number, need: "hunger" | "energy" | "social" | "comfort"): number {
  if (!hasComponent(world as any, agentEid, Needs as any)) return 0;
  const v = (Needs as any)[need]?.[agentEid];
  return typeof v === "number" ? v : 0;
}

function latestPerception(world: World, agentEid: number, type: string): string | undefined {
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .filter((eid: number) => String(Perception.type[eid] || "") === type)
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 1);
  const peid = perceptionEids[0];
  if (typeof peid !== "number") return undefined;
  return String(Perception.content[peid] || "");
}

function hasGoalContaining(world: World, agentEid: number, needle: string): boolean {
  const goals = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active");
  const n = needle.toLowerCase();
  return goals.some((gid: number) => String(Goal.description[gid] || "").toLowerCase().includes(n));
}

function hasActiveMovementGoal(world: World, agentEid: number, destinationIncludes?: string): boolean {
  const needle = String(destinationIncludes || "").trim().toLowerCase();

  // Support the grid-based movement substrate as well as ECS Goal-based movement.
  // Some simulations (and recovery flows) move agents by setting a MovementTarget without creating a Goal entity.
  // Treat that as an "active movement goal" so policies can avoid spamming repeated "move" actions every tick.
  const moveTarget = getMovementTarget(agentEid);
  if (typeof moveTarget === "number") {
    const targetName = String(Name.value[moveTarget] || "").trim().toLowerCase();
    if (!needle || targetName.includes(needle)) return true;
  }

  const goals = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active");

  for (const gid of goals) {
    const desc = String(Goal.description[gid] || "").toLowerCase();
    if (!desc.includes("go to")) continue;
    if (needle && !desc.includes(needle)) continue;
    return true;
  }

  return false;
}

function inRoom(world: World, agentEid: number, roomName: string): boolean {
  const roomEid = getRoomForEntity(world, agentEid);
  if (roomEid === undefined) return false;
  return String(Name.value[roomEid] || "").trim().toLowerCase() === roomName.trim().toLowerCase();
}

function roomHasNamed(world: World, agentEid: number, wantedName: string): boolean {
  const roomEid = getRoomForEntity(world, agentEid);
  if (roomEid === undefined) return false;
  const wanted = wantedName.trim().toLowerCase();
  if (!wanted) return false;
  for (const eid of listDirectContents(world, roomEid)) {
    const n = String(Name.value[eid] || "").trim().toLowerCase();
    if (n === wanted) return true;
  }
  return false;
}

function hasMemoryContaining(world: World, agentEid: number, needle: string): boolean {
  const memEids = getRelationTargets(world as any, agentEid, HasMemory as any);
  const n = needle.toLowerCase();
  return memEids.some((eid: number) => {
    if (!hasComponent(world as any, eid, Memory as any)) return false;
    const content = String(Memory.content[eid] || "").toLowerCase();
    return content.includes(n);
  });
}

function hasBeliefContaining(world: World, agentEid: number, needle: string): boolean {
  const beliefEids = getRelationTargets(world as any, agentEid, HasBelief as any);
  const n = needle.toLowerCase();
  return beliefEids.some((eid: number) => {
    if (!hasComponent(world as any, eid, Belief as any)) return false;
    const combined = [
      String(Belief.subject[eid] || ""),
      String(Belief.predicate[eid] || ""),
      String(Belief.object[eid] || ""),
    ].join(" ").toLowerCase();
    return combined.includes(n);
  });
}

function getImpressionValence(world: World, agentEid: number, targetName: string): number | undefined {
  const impEids = getRelationTargets(world as any, agentEid, HasImpression as any);
  const wanted = targetName.trim().toLowerCase();
  for (const eid of impEids) {
    if (!hasComponent(world as any, eid, Impression as any)) continue;
    const name = String(Impression.targetName[eid] || "").trim().toLowerCase();
    if (name === wanted) {
      return Impression.valence[eid] ?? 0;
    }
  }
  return undefined;
}

function evalCondition(world: World, agentEid: number, op: ConditionOp): boolean {
  switch (op.type) {
    case "always":
      return true;
    case "chance":
      return Math.random() < op.p;
    case "need_above":
      return getNeedValue(world, agentEid, op.need) >= op.value;
    case "need_below":
      return getNeedValue(world, agentEid, op.need) <= op.value;
    case "in_room":
      return inRoom(world, agentEid, op.roomName);
    case "not_in_room":
      return !inRoom(world, agentEid, op.roomName);
    case "has_goal":
      return hasGoalContaining(world, agentEid, op.includes);
    case "has_active_movement_goal":
      return hasActiveMovementGoal(world, agentEid, op.destinationIncludes);
    case "no_active_movement_goal":
      return !hasActiveMovementGoal(world, agentEid);
    case "room_has_named":
      return roomHasNamed(world, agentEid, op.name);
    case "has_perception": {
      const c = latestPerception(world, agentEid, op.perceptionType);
      if (!c) return false;
      if (op.includes && op.includes.trim()) return c.toLowerCase().includes(op.includes.toLowerCase());
      return true;
    }
    case "last_action_was": {
      if (!hasComponent(world as any, agentEid, LastAction as any)) return false;
      return String(LastAction.type[agentEid] || "") === op.actionType;
    }
    case "last_action_not": {
      if (!hasComponent(world as any, agentEid, LastAction as any)) return true;
      return String(LastAction.type[agentEid] || "") !== op.actionType;
    }
    case "room_has_other_agents": {
      const roomEid = getRoomForEntity(world, agentEid);
      if (roomEid === undefined) return false;
      for (const eid of listDirectContents(world, roomEid)) {
        if (eid !== agentEid && hasComponent(world as any, eid, Agent as any)) return true;
      }
      return false;
    }
    case "room_is_empty": {
      const roomEid2 = getRoomForEntity(world, agentEid);
      if (roomEid2 === undefined) return true;
      for (const eid of listDirectContents(world, roomEid2)) {
        if (eid !== agentEid && hasComponent(world as any, eid, Agent as any)) return false;
      }
      return true;
    }
    case "has_memory":
      return hasMemoryContaining(world, agentEid, op.includes);
    case "has_belief":
      return hasBeliefContaining(world, agentEid, op.includes);
    case "impression_above": {
      const val = getImpressionValence(world, agentEid, op.targetName);
      if (val === undefined) return false;
      return val >= op.threshold;
    }
    case "impression_below": {
      const val2 = getImpressionValence(world, agentEid, op.targetName);
      if (val2 === undefined) return false;
      return val2 <= op.threshold;
    }
    case "last_n_actions_include": {
      const actions = getRecentActions(agentEid);
      const lastN = actions.slice(-op.n);
      return lastN.some(a => a === op.actionType);
    }
    case "last_n_actions_exclude": {
      const actions2 = getRecentActions(agentEid);
      const lastN2 = actions2.slice(-op.n);
      return !lastN2.some(a => a === op.actionType);
    }
  }
}

function evalNode(world: World, agentEid: number, node: BehaviorNode, trace: string[]): PolicyEvalResult {
  const evalChild = (child: BehaviorNode): PolicyEvalResult => evalNode(world, agentEid, child, trace);

  switch (node.type) {
    case "noop":
      trace.push("noop");
      return { kind: "none", trace };
    case "wander": {
      trace.push("wander");
      // Skip if already moving somewhere (grid movement or goal-based)
      if (getMovementTarget(agentEid) !== undefined) return { kind: "none", trace };
      if (hasActiveMovementGoal(world, agentEid)) return { kind: "none", trace };
      // Pick a random room that isn't the current room
      const currentRoomEid = getRoomForEntity(world, agentEid);
      const allRooms = Array.from(query(world as any, [Room as any, Name as any]));
      const candidates = allRooms.filter(rid => rid !== currentRoomEid);
      if (candidates.length === 0) return { kind: "none", trace };
      const targetRid = candidates[Math.floor(Math.random() * candidates.length)];
      const targetName = String(Name.value[targetRid] || "").trim();
      if (!targetName) return { kind: "none", trace };
      trace.push(`wander:${targetName}`);
      return { kind: "action", action: { type: "move", target: targetName }, trace };
    }
    case "llm_fallback":
      trace.push("llm_fallback");
      return { kind: "llm_fallback", trace };
    case "skill": {
      // Evaluate a named skill sub-tree — compositional BT
      const skillName = String((node as any).name || "").trim();
      trace.push(`skill:${skillName}`);
      const skillTree = getSkillTree(skillName);
      if (!skillTree) {
        trace.push(`skill-not-found:${skillName}`);
        return { kind: "none", trace };
      }
      const skillResult = evalNode(world, agentEid, skillTree, trace);
      if (skillResult.kind === "action") {
        recordSkillOutcome(skillName, true);
      }
      return skillResult;
    }
    case "llm_skill": {
      // LLM-backed skill — delegates to LLM with a focused purpose
      // Returns llm_fallback so the cognition chain invokes the LLM
      const purpose = String((node as any).purpose || "").trim();
      trace.push(`llm_skill:${purpose}`);
      return { kind: "llm_fallback", trace };
    }
    case "action": {
      trace.push(`action:${node.action.type}`);
      let action = node.action;
      // Resolve special target "room" to the actual room name
      if (action.target === "room") {
        const roomEid = getRoomForEntity(world, agentEid);
        if (roomEid !== undefined) {
          const roomName = String(Name.value[roomEid] || "").trim();
          if (roomName) {
            action = { ...action, target: roomName };
          }
        }
      }
      // Validate move targets
      if (action.type === "move" && action.target) {
        const allRooms = Array.from(query(world as any, [Room as any, Name as any]));
        const targetLower = action.target.trim().toLowerCase();
        const isRoom = allRooms.some(rid => String(Name.value[rid] || "").trim().toLowerCase() === targetLower);
        if (!isRoom) {
          trace.push(`move-target-invalid:${action.target}`);
          return { kind: "none", trace };
        }
        // Skip move if already in the target room
        const currentRoomEid = getRoomForEntity(world, agentEid);
        if (currentRoomEid !== undefined) {
          const currentRoomName = String(Name.value[currentRoomEid] || "").trim().toLowerCase();
          if (currentRoomName === targetLower) {
            trace.push(`move-already-there:${action.target}`);
            return { kind: "none", trace };
          }
        }
        // Skip move if already moving somewhere
        if (getMovementTarget(agentEid) !== undefined) {
          trace.push(`move-already-moving`);
          return { kind: "none", trace };
        }
      }
      return { kind: "action", action, trace };
    }
    case "use_procedure": {
      const signature = String(node.signature || "").trim();
      const minSuccesses = Number.isFinite(Number(node.minSuccesses)) ? Math.max(0, Math.min(100, Number(node.minSuccesses))) : 2;
      trace.push(`use_procedure:${signature}`);
      return { kind: "start_procedure", signature, minSuccesses, trace };
    }
    case "interact_with_trait": {
      const trait = String(node.trait || "").trim();
      const affordance = String(node.affordance || "").trim().toLowerCase();
      const args = typeof (node as any).args === "string" ? String((node as any).args) : "";
      const scope = node.scope === "accessible" ? "accessible" : "room";
      trace.push(`interact_with_trait:${trait}/${affordance}/${scope}`);
      const targetEid = findInteractTargetByTrait(world, agentEid, { trait, affordance, scope });
      if (targetEid === undefined) return { kind: "none", trace };
      const targetName = String(Name.value[targetEid] || "").trim();
      if (!targetName) return { kind: "none", trace };
      const content = args.trim() ? `${affordance} ${args}` : affordance;
      return { kind: "action", action: { type: "interact", target: targetName, content }, trace };
    }
    case "interact_any_affordance": {
      const scope = node.scope === "accessible" ? "accessible" : "room";
      const exclude = new Set((node.exclude || []).map(s => s.toLowerCase()));
      trace.push(`interact_any_affordance:${scope}`);
      const roomEid = getRoomForEntity(world, agentEid);
      const candidates: number[] = [];
      if (roomEid !== undefined) candidates.push(...listDirectContents(world, roomEid));
      if (scope === "accessible") candidates.push(...listDirectContents(world, agentEid));

      // Collect all (target, affordance) pairs
      const pairs: Array<{ eid: number; name: string; affordance: string }> = [];
      const seen = new Set<number>();
      for (const eid of candidates) {
        if (eid === agentEid || seen.has(eid)) continue;
        seen.add(eid);
        const eName = String(Name.value[eid] || "").trim();
        if (!eName || eName === "npc" || eName === "object") continue;
        const affordances = getAvailableAffordances(world, agentEid, eid);
        for (const aff of affordances) {
          if (!exclude.has(aff.name.toLowerCase())) {
            pairs.push({ eid, name: eName, affordance: aff.name });
          }
        }
      }
      if (pairs.length === 0) return { kind: "none", trace };
      const pick = pairs[Math.floor(Math.random() * pairs.length)];
      trace.push(`picked:${pick.name}/${pick.affordance}`);
      return { kind: "action", action: { type: "interact", target: pick.name, content: pick.affordance }, trace };
    }
    case "weighted_random": {
      trace.push("weighted_random");
      const choices = node.choices || [];
      if (choices.length === 0) return { kind: "none", trace };
      const totalWeight = choices.reduce((s, c) => s + Math.max(0, c.weight), 0);
      if (totalWeight <= 0) return { kind: "none", trace };

      // Weighted shuffle: try in random weighted order, return first that yields an action
      const indices = choices.map((_, i) => i);
      // Sort by random weighted priority (higher weight = more likely to be tried first)
      indices.sort(() => Math.random() - 0.5);
      // But respect weights: pick via cumulative probability first
      let roll = Math.random() * totalWeight;
      let firstPick = 0;
      for (let i = 0; i < choices.length; i++) {
        roll -= Math.max(0, choices[i].weight);
        if (roll <= 0) { firstPick = i; break; }
      }
      // Try the weighted pick first, then others as fallback
      const order = [firstPick, ...indices.filter(i => i !== firstPick)];
      for (const idx of order) {
        const r = evalChild(choices[idx].child);
        if (r.kind === "action" || r.kind === "llm_fallback") return r;
      }
      return { kind: "none", trace };
    }
    case "social_visit": {
      trace.push("social_visit");
      // Skip if already moving
      if (getMovementTarget(agentEid) !== undefined) return { kind: "none", trace };
      if (hasActiveMovementGoal(world, agentEid)) return { kind: "none", trace };

      const currentRoomEid = getRoomForEntity(world, agentEid);
      const minImpression = node.minImpression ?? 0;

      // Find agents we have positive impressions of
      const impressionEids = getRelationTargets(world as any, agentEid, HasImpression as any);
      const visitCandidates: Array<{ agentEid: number; roomEid: number; roomName: string }> = [];

      for (const impEid of impressionEids) {
        if (!hasComponent(world as any, impEid, Impression as any)) continue;
        const valence = Impression.valence[impEid] ?? 0;
        if (valence < minImpression) continue;
        const targetName = String(Impression.targetName[impEid] || "").trim();
        if (!targetName) continue;

        // Find the named agent
        const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
        for (const aeid of allAgents) {
          if (aeid === agentEid) continue;
          if (String(Name.value[aeid] || "").trim().toLowerCase() !== targetName.toLowerCase()) continue;
          const theirRoom = getRoomForEntity(world, aeid);
          if (theirRoom === undefined || theirRoom === currentRoomEid) continue;
          const roomName = String(Name.value[theirRoom] || "").trim();
          if (roomName) visitCandidates.push({ agentEid: aeid, roomEid: theirRoom, roomName });
        }
      }

      // Also consider visiting agents in other rooms even without impressions (curiosity)
      if (visitCandidates.length === 0) {
        const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
        for (const aeid of allAgents) {
          if (aeid === agentEid) continue;
          const theirRoom = getRoomForEntity(world, aeid);
          if (theirRoom === undefined || theirRoom === currentRoomEid) continue;
          const roomName = String(Name.value[theirRoom] || "").trim();
          if (roomName) visitCandidates.push({ agentEid: aeid, roomEid: theirRoom, roomName });
        }
      }

      if (visitCandidates.length === 0) return { kind: "none", trace };
      const pick = visitCandidates[Math.floor(Math.random() * visitCandidates.length)];
      trace.push(`visit:${pick.roomName}`);
      return { kind: "action", action: { type: "move", target: pick.roomName }, trace };
    }
    case "condition": {
      const ok = evalCondition(world, agentEid, node.op);
      trace.push(`condition:${node.op.type}=${ok}`);
      return ok ? { kind: "none", trace } : { kind: "none", trace };
    }
    case "sequence": {
      trace.push("sequence");
      for (const child of node.children || []) {
        if (child.type === "condition") {
          const ok = evalCondition(world, agentEid, child.op);
          trace.push(`seq_condition:${child.op.type}=${ok}`);
          if (!ok) return { kind: "none", trace };
          continue;
        }

        const r = evalChild(child);
        if (r.kind === "action" || r.kind === "llm_fallback") return r;
      }
      return { kind: "none", trace };
    }
    case "selector": {
      trace.push("selector");
      for (const child of node.children || []) {
        const r = evalChild(child);
        if (r.kind === "action" || r.kind === "llm_fallback") return r;
      }
      return { kind: "none", trace };
    }
  }
}

export function getBehaviorPolicyTree(world: World, agentEid: number): BehaviorNode | null {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return null;
  if (!BehaviorPolicy.enabled[agentEid]) return null;
  return safeParseTree(BehaviorPolicy.treeJson[agentEid] || "");
}

// Per-agent evaluator history: tracks recent actions to ensure diversity
const policyEvalHistory: Map<number, string[]> = new Map();
const EVAL_HISTORY_SIZE = 6;
const MAX_FREQUENCY_RATIO = 0.5; // suppress if action type is > 50% of recent history

// Fallback actions for when anti-repetition suppresses the primary choice.
// Evaluated in order; first one not recently used wins.
const FALLBACK_ACTIONS: PolicyAction[] = [
  { type: "observe" },
  { type: "think", content: "I consider what to do next..." },
  { type: "reflect" },
  { type: "observe" },
  { type: "think", content: "I take stock of my surroundings..." },
];

export function evaluateBehaviorPolicy(world: World, agentEid: number): PolicyEvalResult {
  const trace: string[] = [];
  if (!hasComponent(world as any, agentEid, Agent as any)) return { kind: "none", trace: ["not_agent"] };
  const tree = getBehaviorPolicyTree(world, agentEid);
  if (!tree) return { kind: "none", trace: ["no_policy"] };

  const result = evalNode(world, agentEid, tree, trace);

  if (result.kind === "action") {
    const history = policyEvalHistory.get(agentEid) || [];
    const actionType = result.action.type;

    // Count how often this action type appears in recent history
    const typeCount = history.filter(h => h.split(":")[0] === actionType).length;
    const frequency = history.length > 0 ? typeCount / history.length : 0;

    // Also check consecutive repeats (even at low frequency, 3+ in a row is bad)
    let consecutive = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].split(":")[0] === actionType) consecutive++;
      else break;
    }

    const shouldSuppress = (history.length >= 3 && frequency >= MAX_FREQUENCY_RATIO) || consecutive >= 2;

    if (shouldSuppress) {
      const actionSig = `${actionType}:${result.action.target || ""}`;
      trace.push(`anti-repeat:suppressed:${actionSig}(freq=${(frequency*100).toFixed(0)}%,consec=${consecutive})`);

      // Instead of returning "none", pick a fallback that differs from recent history.
      // First try static fallbacks, then dynamic ones (interact_any_affordance, wander).
      const recentTypes = new Set(history.map(h => h.split(":")[0]));
      let fallback = FALLBACK_ACTIONS.find(a => !recentTypes.has(a.type));

      if (!fallback) {
        // All static fallbacks exhausted — try dynamic actions
        if (!recentTypes.has("interact")) {
          // Try interact_any_affordance
          const dynamicResult = evalNode(world, agentEid,
            { type: "interact_any_affordance", scope: "room" }, [...trace]);
          if (dynamicResult.kind === "action") {
            const dynSig = `${dynamicResult.action.type}:${dynamicResult.action.target || ""}`;
            history.push(dynSig);
            if (history.length > EVAL_HISTORY_SIZE) history.shift();
            policyEvalHistory.set(agentEid, history);
            trace.push("anti-repeat:dynamic:interact_any");
            return dynamicResult;
          }
        }
        if (!recentTypes.has("move")) {
          // Try wander
          const wanderResult = evalNode(world, agentEid, { type: "wander" }, [...trace]);
          if (wanderResult.kind === "action") {
            const wandSig = `move:${wanderResult.action.target || ""}`;
            history.push(wandSig);
            if (history.length > EVAL_HISTORY_SIZE) history.shift();
            policyEvalHistory.set(agentEid, history);
            trace.push("anti-repeat:dynamic:wander");
            return wanderResult;
          }
        }
        // Last resort: random static fallback
        fallback = FALLBACK_ACTIONS[Math.floor(Math.random() * FALLBACK_ACTIONS.length)];
      }

      const fallbackSig = `${fallback.type}:${fallback.target || ""}`;
      history.push(fallbackSig);
      if (history.length > EVAL_HISTORY_SIZE) history.shift();
      policyEvalHistory.set(agentEid, history);
      trace.push(`anti-repeat:fallback:${fallback.type}`);
      return { kind: "action", action: fallback, trace };
    }

    const successSig = `${actionType}:${result.action.target || ""}`;
    history.push(successSig);
    if (history.length > EVAL_HISTORY_SIZE) history.shift();
    policyEvalHistory.set(agentEid, history);
  }

  return result;
}

/** Clear evaluator anti-repetition history for an agent (e.g., after policy change). */
export function clearPolicyEvalHistory(agentEid: number): void {
  policyEvalHistory.delete(agentEid);
}

export function formatBehaviorPolicyForContext(world: World, agentEid: number): string {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return "";
  if (!BehaviorPolicy.enabled[agentEid]) return "";
  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return "";
  const maxLen = 800;
  const clipped = raw.length > maxLen ? raw.slice(0, maxLen) + "\n…(truncated)" : raw;
  const v = BehaviorPolicy.version[agentEid] || 0;
  return `BEHAVIOR POLICY (v${v}):\n${clipped}`;
}

export function setAgentBehaviorPolicy(world: World, agentEid: number, tree: BehaviorNode, enable: boolean = true): void {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) {
    addComponent(world as any, agentEid, BehaviorPolicy as any);
  }
  BehaviorPolicy.enabled[agentEid] = enable;
  BehaviorPolicy.treeJson[agentEid] = JSON.stringify(tree);
  BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
  BehaviorPolicy.lastUpdatedAt[agentEid] = Date.now();
}
