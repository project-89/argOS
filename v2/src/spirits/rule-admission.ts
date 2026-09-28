import { z } from "zod";
import { identifier, PRIVATE_MANAGED_COMPONENTS, PROTECTED_MANAGED_COMPONENTS } from "../engineering/contracts";
import { getRegistryEntry, listDefinitions } from "../ecs/component-registry";
import { worldSchema, type RuleCondition, type RuleDefinition } from "../world/schema";

const names = z.array(identifier).max(64);
const condition = z.object({ has: names.optional(), not: names.optional(), inState: identifier.optional(),
  minStateAgeMs: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  expression: z.string().min(1).max(200).optional() }).strict();
const chance = z.number().finite().min(0).max(1).optional();
const effectBase = { target: z.enum(["self", "source", "nearby"]).optional(),
  query: z.object({ radius: z.number().finite().positive().max(100).optional(), has: names.optional(), not: names.optional() }).strict().optional() };
const effect = z.discriminatedUnion("action", [
  z.object({ ...effectBase, action: z.literal("add_trait"), params: z.object({ trait: identifier, chance }).strict() }).strict(),
  z.object({ ...effectBase, action: z.literal("remove_trait"), params: z.object({ trait: identifier, chance }).strict() }).strict(),
  z.object({ ...effectBase, action: z.literal("transition_state"), params: z.object({ state: identifier, chance }).strict() }).strict(),
  z.object({ ...effectBase, action: z.literal("modify_value"), params: z.object({ component: identifier, field: identifier,
    delta: z.number().finite(), chance }).strict() }).strict(),
  z.object({ ...effectBase, action: z.literal("emit_event"), params: z.object({ event: identifier.optional(), type: identifier.optional(),
    content: z.string().max(2000).optional(), source: z.string().max(128).optional(), includeEntity: z.boolean().optional(), chance }).strict() }).strict(),
  z.object({ ...effectBase, action: z.literal("destroy"), params: z.object({ chance }).strict().optional() }).strict(),
  z.object({ ...effectBase, action: z.literal("spawn"), params: z.object({ typeId: identifier, chance }).strict() }).strict(),
]);
const candidate = z.object({ name: identifier, description: z.string().min(1).max(2000),
  trigger: z.enum(["tick", "event", "state_change"]), conditions: z.array(condition).max(16),
  effects: z.array(effect).min(1).max(16), priority: z.number().finite().min(0).max(10000).optional() }).strict();

function numericCoordinate(component: string, field: string, write: boolean): void {
  const denied = write ? PROTECTED_MANAGED_COMPONENTS : PRIVATE_MANAGED_COMPONENTS;
  if ([...denied].some(name => name.toLowerCase() === component.toLowerCase())) throw new Error("Private/protected rule coordinate denied");
  const canonical = listDefinitions().find(def => def.name === component || def.name.toLowerCase() === component.toLowerCase());
  const entry = canonical && getRegistryEntry(canonical.name);
  if (!entry || canonical!.properties[field] !== "number") throw new Error("Unknown or nonnumeric rule coordinate");
  // RulesEngine supports exact dynamic names, or these two native numeric components.
  if (entry.isStatic ? !["Fuel", "Durability"].includes(canonical!.name) : canonical!.name !== component)
    throw new Error("Rule coordinate has no native executor");
}

/** Complete validation before any registry write. Never salvage a partial rule. */
export function validateRuleCandidate(input: unknown): RuleDefinition {
  const parsed = candidate.parse(input);
  const merged: RuleCondition = {};
  for (const part of parsed.conditions) {
    if (part.has) merged.has = [...(merged.has ?? []), ...part.has];
    if (part.not) merged.not = [...(merged.not ?? []), ...part.not];
    for (const key of ["inState", "expression"] as const) if (part[key] !== undefined) {
      if (merged[key] !== undefined && merged[key] !== part[key]) throw new Error("Conflicting rule conditions");
      merged[key] = part[key];
    }
    if (part.minStateAgeMs !== undefined) {
      if (merged.minStateAgeMs !== undefined && merged.minStateAgeMs !== part.minStateAgeMs) throw new Error("Conflicting rule ages");
      merged.minStateAgeMs = part.minStateAgeMs;
    }
  }
  if (merged.minStateAgeMs !== undefined && !merged.inState) throw new Error("State age requires inState");
  if (merged.has?.some(trait => merged.not?.includes(trait))) throw new Error("Contradictory rule traits");
  if (merged.expression) {
    const match = merged.expression.match(/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\s*(?:<=|>=|<|>|==|!=)\s*\d+(?:\.\d+)?$/);
    if (!match) throw new Error("Unsupported rule expression");
    identifier.parse(match[1]); identifier.parse(match[2]); numericCoordinate(match[1], match[2], false);
  }
  for (const item of parsed.effects) {
    if (item.query && item.target !== "nearby") throw new Error("Query requires nearby target");
    if (item.action === "modify_value") numericCoordinate(item.params.component, item.params.field, true);
    if (item.action === "spawn" && !worldSchema.getObjectType(item.params.typeId)) throw new Error("Unknown spawn type");
    if (item.action === "emit_event" && (!item.params.event && !item.params.type
      || item.params.event && item.params.type && item.params.event !== item.params.type)) throw new Error("Invalid event name");
  }
  return { name: parsed.name, description: parsed.description, priority: parsed.priority ?? 50, enabled: true,
    executionScope: "lawgiver-runtime", when: { event: parsed.trigger, condition: Object.keys(merged).length ? merged : undefined }, then: parsed.effects };
}
