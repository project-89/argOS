/** Dependency fingerprints for background drafts. These use only the actor's
 * stored evidence, never hidden/current ECS facts. Source age is not a change. */
import type { World } from "../ecs/world";
import { getWorkingMemory, type ActorWorkingMemory } from "./working-memory";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function mentioned(reference: string, label: string): boolean {
  const normalized = normalize(label);
  return !!normalized && ` ${reference} `.includes(` ${normalized} `);
}

/** Exact observed labels are intentional: an engine guard cannot safely infer
 * that arbitrary prose/pronouns refer to an item. The model still reconciles
 * the full working-memory context when choosing a new action. */
export function workingMemoryDependency(
  memory: ActorWorkingMemory,
  references: readonly string[],
  options: { includeOwnAction?: boolean } = {},
): string {
  const reference = normalize(references.join(" "));
  // Values are not subjects: "Utility Room" must not pull every item located
  // there into a movement dependency, nor "off" every inactive appliance.
  const relevant = (fact: ActorWorkingMemory["facts"][number] | ActorWorkingMemory["receipts"][number]["facts"][number]) =>
    mentioned(reference, fact.subjectLabel || fact.subject) || mentioned(reference, fact.subject);
  const facts = memory.facts.filter(relevant).map(fact => [fact.subject, fact.subjectLabel || "", fact.predicate,
    fact.slot || "", fact.value, fact.valueLabel || ""]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // A completed own action can supersede a draft even when its resulting state
  // was already known. Ambient refreshes and other actors' private actions do not.
  const lastOwnAction = options.includeOwnAction === false ? undefined : [...memory.receipts].reverse().find(receipt => receipt.kind === "action" && receipt.provenance === "own_action"
    && receipt.facts.some(relevant));
  return JSON.stringify({ facts, action: lastOwnAction?.id || "" });
}

export function currentWorkingMemoryDependency(world: World, eid: number, references: readonly string[], options: { includeOwnAction?: boolean } = {}): string {
  return workingMemoryDependency(getWorkingMemory(world, eid), references, options);
}
