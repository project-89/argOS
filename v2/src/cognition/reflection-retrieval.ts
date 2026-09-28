/** Bounded, source-aware reflection retrieval. Selection does not rewrite,
 * consolidate or delete history, and memory labels never become physical proof. */
import type { WorkingMemoryReceipt } from "./working-memory";
import type { NarrativeRecord } from "./narrative-memory";

export const REFLECTION_CONTEXT_LIMIT = 20;
export interface ReflectionMemorySource {
  id: number; content: string; type: string; timestamp: number; importance: number;
}
export type ReflectionContextSource =
  | { kind: "memory"; memory: ReflectionMemorySource }
  | { kind: "narrative"; entry: NarrativeRecord }
  | { kind: "physical_receipt"; receipt: WorkingMemoryReceipt };

/** References identify the actual selected record, not a semantic paraphrase.
 * The reflection issuer separately binds their exact immutable contents. */
export function reflectionSourceId(source: ReflectionContextSource): string {
  return source.kind === "memory" ? `memory:${source.memory.id}` : source.kind === "narrative" ? source.entry.id : `receipt:${source.receipt.id}`;
}

/** Source diversity, not semantic phrase matching: reserve recent physical
 * receipts and recent episodic recollections alongside significant memories.
 * Repeated identical failure messages share one representative in each source
 * class. Different outcomes/provenance/facts remain different evidence. */
export function selectReflectionSources(memories: readonly ReflectionMemorySource[],
  receipts: readonly WorkingMemoryReceipt[], requestedLimit = REFLECTION_CONTEXT_LIMIT): ReflectionContextSource[] {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(REFLECTION_CONTEXT_LIMIT, Math.floor(requestedLimit))) : REFLECTION_CONTEXT_LIMIT;
  if (!limit) return [];
  const recentMemories = memories.filter(m => Number.isSafeInteger(m.id) && typeof m.content === "string" && m.content.trim()
    && typeof m.type === "string" && Number.isFinite(m.timestamp) && Number.isFinite(m.importance))
    .map(m => ({ ...m })).sort((a, b) => b.timestamp - a.timestamp || a.id - b.id);
  const seenMemories = new Set<string>();
  const uniqueMemories = recentMemories.filter(m => {
    const key = JSON.stringify([m.type, m.content]); if (seenMemories.has(key)) return false;
    seenMemories.add(key); return true;
  });
  const seenReceipts = new Set<string>();
  const uniqueReceipts = [...receipts].sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id)).filter(r => {
    const key = JSON.stringify([r.kind, r.provenance, r.succeeded, r.summary, r.facts]);
    if (seenReceipts.has(key)) return false; seenReceipts.add(key); return true;
  });
  const selected: ReflectionContextSource[] = [], sourceIds = new Set<string>();
  const add = (items: ReflectionContextSource[], count: number) => {
    let added = 0;
    for (const item of items) {
      if (selected.length >= limit || added >= count) break;
      const key = reflectionSourceId(item);
      if (sourceIds.has(key)) continue;
      sourceIds.add(key); selected.push(item); added++;
    }
  };
  const memoryItems = (items: ReflectionMemorySource[]): ReflectionContextSource[] => items.map(memory => ({ kind: "memory", memory }));
  const receiptItems: ReflectionContextSource[] = uniqueReceipts.map(receipt => ({ kind: "physical_receipt", receipt: structuredClone(receipt) }));
  // At the usual twenty-item budget: eight receipts, six recent episodes, and
  // six significant memories. Unused slots are reclaimed, never padded.
  const receiptBudget = Math.floor(limit * .4);
  // A crowd moving nearby must not bury the actor's own completed work. Failed
  // attempts and witnessed acts still have space, and ambient sensing is a
  // separate source class rather than the sole meaning of "recent evidence".
  add(receiptItems.filter(s => s.kind === "physical_receipt" && s.receipt.kind === "action"
    && s.receipt.provenance === "own_action" && s.receipt.succeeded), Math.ceil(receiptBudget / 2));
  add(receiptItems.filter(s => s.kind === "physical_receipt" && s.receipt.kind === "action"
    && (s.receipt.provenance !== "own_action" || !s.receipt.succeeded)), Math.floor(receiptBudget / 4));
  add(receiptItems.filter(s => s.kind === "physical_receipt" && s.receipt.kind === "observation"), Math.min(Math.floor(receiptBudget / 4), receiptBudget - selected.length));
  add(receiptItems, receiptBudget - selected.length);
  add(memoryItems(uniqueMemories.filter(m => m.type === "episodic")), Math.floor(limit * .3));
  add(memoryItems([...uniqueMemories].sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp || a.id - b.id)), limit - selected.length);
  add(receiptItems, limit - selected.length);
  add(memoryItems(uniqueMemories), limit - selected.length);
  return selected;
}

export function formatReflectionSources(sources: readonly ReflectionContextSource[]): string {
  return sources.map((source, index) => {
    if (source.kind === "narrative") return `${index + 1}. [my past ${source.entry.kind}; private interpretation, not verified world fact; atSimMs=${source.entry.sourceAtSimMs}; sourceId=${JSON.stringify(source.entry.id)}] ${JSON.stringify(source.entry.monologue)}`
      + (source.entry.identity ? `\nIdentity meaning: ${JSON.stringify({ anchorId: source.entry.identity.anchorId, selfBelief: source.entry.identity.selfBelief, meaning: source.entry.identity.meaning })}` : "");
    if (source.kind === "physical_receipt") {
      const receipt = source.receipt;
      // Keep the inspected subject's native meaning with the exact receipt,
      // rather than inviting a semantic guess from an opaque instance label.
      // Only three public identity slots are projected; no machine signatures
      // or private component scans are introduced by this memory read.
      const identity = receipt.facts.filter(f => f.predicate === "state"
        && ["Entity.kind", "ObjectType.typeId", "Container.present"].includes(f.slot || ""))
        .map(f => ({ subject: f.subject, subjectLabel: f.subjectLabel, slot: f.slot, value: f.value }));
      return `${index + 1}. [physical receipt ${JSON.stringify(receipt.id)}; ${receipt.provenance}; ${receipt.kind}${receipt.kind === "action" ? receipt.succeeded ? " succeeded" : " failed" : ""}; atMs=${receipt.atMs}; sourceId=${JSON.stringify(reflectionSourceId(source))}] ${JSON.stringify(receipt.summary)}`
        + (identity.length ? `\nObserved identity (same receipt): ${JSON.stringify(identity)}` : "");
    }
    const memory = source.memory;
    return `${index + 1}. [memory ${memory.id}; ${memory.type}; remembered, not independently verified; importance=${memory.importance}; atMs=${memory.timestamp}; sourceId=${JSON.stringify(reflectionSourceId(source))}] ${JSON.stringify(memory.content)}`;
  }).join("\n");
}
