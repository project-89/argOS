import type { World } from "../ecs/world";
import { addComponent, getRelationTargets, hasComponent } from "bitecs";
import { Agent, BehaviorPolicy, Goal, Name, Needs, Perception, Traits } from "../ecs/components";
import { HasGoal, HasPerception } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getMovementTarget } from "../systems/builtin-systems";

export type PolicyAction = {
  type: "speak" | "observe" | "move" | "interact" | "think" | "wait";
  target?: string;
  content?: string;
};

export type BehaviorNode =
  | { type: "selector"; children: BehaviorNode[] }
  | { type: "sequence"; children: BehaviorNode[] }
  | { type: "condition"; op: ConditionOp }
  | { type: "action"; action: PolicyAction }
  | { type: "interact_with_trait"; trait: string; affordance: string; args?: string; scope?: "room" | "accessible" }
  | { type: "use_procedure"; signature: string; minSuccesses?: number }
  | { type: "llm_fallback" }
  | { type: "noop" };

export type ConditionOp =
  | { type: "always" }
  | { type: "chance"; p: number }
  | { type: "need_above"; need: "hunger" | "energy" | "social" | "comfort"; value: number }
  | { type: "need_below"; need: "hunger" | "energy" | "social" | "comfort"; value: number }
  | { type: "in_room"; roomName: string }
  | { type: "has_perception"; perceptionType: string; includes?: string }
  | { type: "has_goal"; includes: string }
  | { type: "has_active_movement_goal"; destinationIncludes?: string }
  | { type: "room_has_named"; name: string };

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
  for (const eid of candidates) {
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
    return eid;
  }

  return undefined;
}

export function validateBehaviorNode(
  node: unknown,
  opts?: { maxDepth?: number; maxNodes?: number; maxJsonBytes?: number }
): { ok: true } | { ok: false; error: string } {
  const maxDepth = opts?.maxDepth ?? 18;
  const maxNodes = opts?.maxNodes ?? 300;
  const maxJsonBytes = opts?.maxJsonBytes ?? 25_000;

  let seen = 0;

  const validateAction = (action: unknown): string | null => {
    if (!isPlainObject(action)) return "action must be an object";
    const type = String(action.type || "");
    const allowed = new Set(["speak", "observe", "move", "interact", "think", "wait"]);
    if (!allowed.has(type)) return `unsupported action.type: ${type}`;
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
      case "in_room": {
        const roomName = String((op as any).roomName || "").trim();
        if (!roomName) return "in_room.roomName required";
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
        return null;
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
    case "has_goal":
      return hasGoalContaining(world, agentEid, op.includes);
    case "has_active_movement_goal":
      return hasActiveMovementGoal(world, agentEid, op.destinationIncludes);
    case "room_has_named":
      return roomHasNamed(world, agentEid, op.name);
    case "has_perception": {
      const c = latestPerception(world, agentEid, op.perceptionType);
      if (!c) return false;
      if (op.includes && op.includes.trim()) return c.toLowerCase().includes(op.includes.toLowerCase());
      return true;
    }
  }
}

function evalNode(world: World, agentEid: number, node: BehaviorNode, trace: string[]): PolicyEvalResult {
  const evalChild = (child: BehaviorNode): PolicyEvalResult => evalNode(world, agentEid, child, trace);

  switch (node.type) {
    case "noop":
      trace.push("noop");
      return { kind: "none", trace };
    case "llm_fallback":
      trace.push("llm_fallback");
      return { kind: "llm_fallback", trace };
    case "action":
      trace.push(`action:${node.action.type}`);
      return { kind: "action", action: node.action, trace };
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

export function evaluateBehaviorPolicy(world: World, agentEid: number): PolicyEvalResult {
  const trace: string[] = [];
  if (!hasComponent(world as any, agentEid, Agent as any)) return { kind: "none", trace: ["not_agent"] };
  const tree = getBehaviorPolicyTree(world, agentEid);
  if (!tree) return { kind: "none", trace: ["no_policy"] };
  return evalNode(world, agentEid, tree, trace);
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
