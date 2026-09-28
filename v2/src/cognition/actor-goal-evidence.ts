/** Native goal predicates an actor can verify without inspecting hidden world
 * state. A retained predicate is a definition, not a fact or a success verdict. */
import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Needs, Traits } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import type { WorkingMemoryFact } from "./working-memory";

export type ActorGoalCondition =
  | { type: "all_of" | "any_of"; conditions: ActorGoalCondition[] }
  | { type: "in_room"; roomName: string }
  | { type: "in_inventory"; itemName: string }
  | { type: "has_trait"; trait: string }
  | { type: "need_at_most"; need: "hunger" | "energy" | "social" | "comfort"; atMost: number }
  | { type: "need_at_least"; need: "hunger" | "energy" | "social" | "comfort"; atLeast: number }
  | { type: "entity_in_room"; entityName: string; roomName: string; uncarried?: boolean }
  | { type: "entity_component_equals"; entityName: string; component: string; field: string; equals: string };

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 300;
const needs = new Set(["hunger", "energy", "social", "comfort"]);

/** Project only bounded, supported schema fields. In particular, an arbitrary
 * component boolean cannot be equated to a similarly named visual state. */
export function copyActorGoalCondition(input: unknown): ActorGoalCondition | undefined {
  let remaining = 64;
  function visit(node: any, depth: number): ActorGoalCondition | undefined {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth >= 8 || --remaining < 0) return;
    if (node.type === "all_of" || node.type === "any_of") {
      if (!Array.isArray(node.conditions) || !node.conditions.length || node.conditions.length > 12) return;
      const conditions = node.conditions.map((n: unknown) => visit(n, depth + 1));
      if (remaining < 0 || node.type === "all_of" && conditions.some((n: unknown) => !n)) return;
      // One personally verifiable alternative is sufficient for any_of. An
      // unknown required conjunct must never be silently dropped from all_of.
      const supported = conditions.filter((n: unknown) => !!n) as ActorGoalCondition[];
      if (!supported.length) return;
      return { type: node.type, conditions: supported };
    }
    if (node.type === "in_room" && text(node.roomName)) return { type: node.type, roomName: node.roomName };
    if (node.type === "in_inventory" && text(node.itemName)) return { type: node.type, itemName: node.itemName };
    if (node.type === "has_trait" && text(node.trait)) return { type: node.type, trait: node.trait };
    if (node.type === "need_at_most" && needs.has(node.need) && Number.isFinite(node.atMost)) return { type: node.type, need: node.need, atMost: node.atMost };
    if (node.type === "need_at_least" && needs.has(node.need) && Number.isFinite(node.atLeast)) return { type: node.type, need: node.need, atLeast: node.atLeast };
    if (node.type === "entity_in_room" && text(node.entityName) && text(node.roomName)
      && (node.uncarried === undefined || typeof node.uncarried === "boolean")) return { type: node.type, entityName: node.entityName,
        roomName: node.roomName, ...(node.uncarried === undefined ? {} : { uncarried: node.uncarried }) };
    if (node.type === "entity_component_equals" && text(node.entityName) && text(node.component) && text(node.field)
      && typeof node.equals === "string" && node.equals.length <= 300) return { type: node.type, entityName: node.entityName,
        component: node.component, field: node.field, equals: node.equals };
  }
  return visit(input, 0);
}

/** Remote proof uses admitted facts, never a scan of live entity/component
 * values. Old matching observations cannot certify a later outcome episode. */
export function actorKnowsGoalCondition(world: World, eid: number, node: ActorGoalCondition,
  since: number, facts: WorkingMemoryFact[]): boolean {
  if (node.type === "all_of") return node.conditions.every(n => actorKnowsGoalCondition(world, eid, n, since, facts));
  if (node.type === "any_of") return node.conditions.some(n => actorKnowsGoalCondition(world, eid, n, since, facts));
  if (node.type === "in_room") {
    const room = getRoomForEntity(world, eid); return room !== undefined && Name.value[room] === node.roomName;
  }
  if (node.type === "in_inventory") return listDirectContents(world, eid).filter(item => Name.value[item] === node.itemName).length === 1;
  if (node.type === "has_trait") {
    if (!hasComponent(world, eid, Traits)) return false;
    try { const traits = JSON.parse(Traits.active[eid] || "[]"); return Array.isArray(traits) && traits.includes(node.trait); } catch { return false; }
  }
  if (node.type === "need_at_most" || node.type === "need_at_least") {
    if (!hasComponent(world, eid, Needs)) return false;
    const actual = Needs[node.need][eid];
    return Number.isFinite(actual) && (node.type === "need_at_most" ? actual <= node.atMost : actual >= node.atLeast);
  }
  if (!("entityName" in node)) return false;
  const named = facts.filter(f => f.subjectLabel === node.entityName);
  if (new Set(named.map(f => f.subject)).size !== 1) return false;
  if (node.type === "entity_in_room") {
    // A destination label is not its type or identity: a person or container
    // can share a room's name. Only a personally admitted room identity can
    // discharge direct placement. Nested/carried containment stays unproven.
    const rooms = facts.filter(f => f.subjectLabel === node.roomName && f.predicate === "state"
      && f.slot === "Entity.kind" && f.value === "room");
    if (new Set(rooms.map(f => f.subject)).size !== 1) return false;
    return named.some(f => f.observedAt >= since && f.predicate === "location" && f.value === rooms[0].subject);
  }
  return named.some(f => f.observedAt >= since && f.predicate === "state" && f.slot === `${node.component}.${node.field}` && f.value === node.equals);
}
