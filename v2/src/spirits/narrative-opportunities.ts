/** Operator suggestion -> narrator assessment -> architect proposal.
 * This is author evidence, not NPC knowledge, a tool command, or construction.
 * Authority is in-process, world/receipt-bound and expires with its source. */
import type { World } from "../ecs/world";
import type { SpiritRegistry } from "./spirit-registry";
import type { DivineMessage, SpiritState } from "./types";
import type { SpiritProposal } from "./spirit-factory";
import { captureSpiritSourceScope } from "./spirit-cycle-scope";
import { isCurrentSpiritMessage } from "./spirit-message-delivery";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "../runtime/task-scope";

type Row = {
  id: string;
  ref: string;
  request: DivineMessage;
  narrator: SpiritState;
  current(): boolean;
  suggestion: string;
  assessment?: string;
  reviewed: boolean;
  proposal?: SpiritProposal;
};
const rows = new WeakMap<World, Map<string, Row>>();

export function registerNarrativeOpportunity(registry: SpiritRegistry, narrator: SpiritState, request: DivineMessage, suggestion: string) {
  assertSimulationTaskActive();
  if (registry.spirits.get(narrator.eid) !== narrator || narrator.definition.domain !== "narrative"
    || request.from !== registry.godAgentEid || request.to !== narrator.eid || request.type !== "request"
    || !narrator.inbox.includes(request) || !isCurrentSpiritMessage(registry, request, narrator.eid)) {
    throw new Error("Native operator request required");
  }
  let list = rows.get(registry.world);
  if (!list) { list = new Map(); rows.set(registry.world, list); }
  if (list.size >= 8 || list.has(request.id)) throw new Error("Narrative opportunity budget exhausted");
  const at = readSimulationTime(registry.world), content = request.content, subject = request.subject, id = request.id;
  const source = captureSpiritSourceScope(registry.world, narrator, registry);
  const row: Row = {
    id, ref: `opportunity:${id}`, request, narrator, suggestion: suggestion.slice(0, 500), reviewed: false,
    current: () => source() && request.id === id && request.content === content && request.subject === subject
      && isCurrentSpiritMessage(registry, request, narrator.eid) && readSimulationTime(registry.world) - at <= 300_000,
  };
  list.set(id, row);
}
/** Bind the response to exactly the native requests actually seen in this cycle.
 * Multiple simultaneous requests are deliberately not guessed/cross-attributed. */
export function reviewNarrativeOpportunity(world: World, narrator: SpiritState, observed: readonly DivineMessage[], reports: readonly {subject: string; content: string}[]) {
  assertSimulationTaskActive();
  const eligible = [...rows.get(world)?.values() ?? []].filter(r => r.narrator === narrator && !r.reviewed && r.current() && observed.includes(r.request));
  if (eligible.length !== 1) return;
  const row = eligible[0];
  row.reviewed = true;
  if (reports.length) row.assessment = reports.slice(0, 3).map(r => `${r.subject}: ${r.content}`).join("\n").slice(0, 3000);
}
export function captureNarrativeOpportunities(world: World) {
  const captured = [...rows.get(world)?.values() ?? []].filter(r => r.current() && r.reviewed && r.assessment && !r.proposal);
  // A competing architect cannot reuse this evidence after another proposal
  // claims it. Our own proposal retains its admission through approval/build.
  const attached = new Map<Row, SpiritProposal>();
  const records = Object.freeze(captured.map(r => Object.freeze({
    ref: r.ref, requestId: r.id, suggestion: r.suggestion, assessment: r.assessment!,
    provenance: "operator_suggestion_reviewed_by_narrator" as const,
  })));
  return {
    records,
    bind(refs: readonly string[]) {
      const selected = refs.filter(ref => ref.startsWith("opportunity:"));
      const linked = captured.filter(r => selected.includes(r.ref));
      const unclaimed = linked.every(r => !r.proposal);
      return () => unclaimed && linked.length === new Set(selected).size && linked.every(r => r.current() && r.proposal === attached.get(r));
    },
    attach(refs: readonly string[], proposal: SpiritProposal) {
      const selected = captured.filter(r => refs.includes(r.ref));
      if (selected.some(r => !r.current() || r.proposal)) throw new Error("Narrative opportunity superseded");
      for (const row of selected) { attached.set(row, proposal); row.proposal = proposal; }
    },
  };
}
export function narrativeOpportunityStatuses(world: World) {
  return [...rows.get(world)?.values() ?? []].map(r => ({
    id: r.id,
    status: r.proposal?.status === "executed" ? "constructed" : !r.current() ? "expired"
      : r.proposal?.status ?? (r.reviewed ? r.assessment ? "reviewed" : "reviewed_without_proposal" : "queued"),
    ...(r.proposal ? {proposalId: r.proposal.id, proposalName: r.proposal.name,
      proposedBy: r.proposal.fromSpiritEid, approvedBy: r.proposal.approvedBy ?? null} : {}),
    ...(r.assessment ? {assessment: r.assessment} : {}),
  }));
}
