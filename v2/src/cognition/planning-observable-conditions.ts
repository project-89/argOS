/** A schema is not a new observation. Prompt readers expose exact public field
 * contracts only after this actor has observed the field, using the ledger's
 * last-known value rather than the producer's newly queried value. */
import type { World } from "../ecs/world";
import { getWorkingMemory } from "./working-memory";
import { getObservedStateFields } from "./world-capabilities";
import { copyPlanWaitUntil } from "./plan-wait-schema";

export interface KnownObservableCondition {
  readonly subject: string;
  readonly subjectLabel: string;
  readonly slot: string;
  readonly type: "boolean" | "enum";
  readonly allowedValues: readonly string[];
  readonly lastKnownValue: string;
}

export function getKnownObservableConditions(world: World, eid: number): readonly KnownObservableCondition[] {
  const facts = getWorkingMemory(world, eid).facts;
  return getObservedStateFields(world, eid).flatMap(field => {
    const known = facts.filter(f => f.subject === field.subject && f.predicate === "state" && f.slot === field.slot);
    if (known.length !== 1 || !field.allowedValues.includes(known[0].value)) return [];
    return [{ subject: field.subject, subjectLabel: known[0].subjectLabel || field.subject,
      slot: field.slot, type: field.type, allowedValues: field.allowedValues, lastKnownValue: known[0].value }];
  });
}

export function formatObservableConditions(world: World, eid: number): string {
  const fields = getKnownObservableConditions(world, eid);
  if (!fields.length) return "";
  const examples = fields.flatMap(field => {
    const waitUntil = copyPlanWaitUntil({ kind: "physical_fact", subject: field.subject, predicate: "state", slot: field.slot, equals: field.allowedValues[0] });
    return waitUntil ? [`- ${JSON.stringify({ subject: field.subjectLabel, lastKnownValue: field.lastKnownValue, allowedEquals: field.allowedValues, waitUntil })}`] : [];
  });
  if (!examples.length) return "";
  return `OBSERVED PHYSICAL CONDITION CONTRACTS:\n${examples.join("\n")}\n` +
    "Copy only waitUntil and choose equals from allowedEquals (strings). Each example shows the input shape, not a recommended condition. lastKnownValue is memory, not fresh proof; waiting does not guarantee a future event.";
}
