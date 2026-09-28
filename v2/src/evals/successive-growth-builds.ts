/** Bounded, read-only evaluation evidence. This observes native proposal and
 * construction records; it never approves, executes, validates an admission,
 * or mints identity. Absence/ambiguity is unscored, not inferred success. */
import { entityExists, hasComponent, query, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { Agent, GodAgent, Name, ObjectType, PhysicalObject, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { getPlaceBuildStatus } from "../engineering/place-materialization";
import type { MaterializedEntitySpec } from "../engineering/entity-materialization";
import { getObservedProposalDiagnostics } from "../spirits/architect-spirit";
import { getFactoryState, type SpiritProposal } from "../spirits/spirit-factory";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { ObjectManager } from "../world/object-manager";
import type { SuccessiveGrowthBuild } from "./successive-growth-evidence";

const LIMIT = 128;
type Physical = { eid: number; name: string; typeId?: string; key?: string; firstSeenAtSimMs: number;
  initial: boolean; present: boolean; ambiguous: boolean };
type Proposal = { native: SpiritProposal; specification: string; scopeId: string | undefined; firstSeenAtSimMs: number;
  approvedAt?: number; executedAt?: number; invalid?: string };

export function createSuccessiveBuildObserver(world: World, registry: SystemRegistry, godEid: number,
  weaverEid: number, initialKeys: ReadonlySet<string>) {
  const sourceId = getCommittedEvents(world).sourceId, factory = getFactoryState();
  const weaver = factory.createdSpirits.get(weaverEid), managed = getSpiritSystemState(world);
  const identity = (eid: number) => entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
    ? WorkingMemoryIdentity.id[eid] || undefined : undefined;
  const godKey = identity(godEid), godName = Name.value[godEid];
  const initialProposals = new Set(factory.pendingProposals.map(p => p.id));
  const initialReceipts = new Set(getPlaceBuildStatus(world, registry).map(r => r.id));
  const initial = new Set(initialKeys), physical = new Map<number, Physical>(), proposals = new Map<string, Proposal>();
  const builds = new Map<string, SuccessiveGrowthBuild>(), diagnostics = new Set<string>();
  const objects = new ObjectManager(world);
  let closed: string | undefined, scans = 0, lastAt = readSimulationTime(world);
  const note = (reason: string) => { if (diagnostics.size < LIMIT) diagnostics.add(reason); };
  const close = (reason: string) => { closed ??= reason; note(reason); };
  const result = () => [...builds.values()].map(build => ({ ...build }));
  const capturePhysical = (now: number, creating = false) => {
    const present = new Set<number>();
    // Include unkeyed and Removed physical entities: later native identity
    // assignment or removing Removed must not make an old prop look newly built.
    for (const eid of query(world, [Name])) {
      if (hasComponent(world, eid, Prefab) || ![Room, PhysicalObject, Agent].some(c => hasComponent(world, eid, c))) continue;
      present.add(eid);
      const key = identity(eid), name = Name.value[eid], typeId = hasComponent(world, eid, ObjectType) ? ObjectType.typeId[eid] : undefined;
      let row = physical.get(eid);
      if (!row) {
        if (physical.size >= LIMIT) { close("physical_observation_limit"); return; }
        row = { eid, key, name, typeId, firstSeenAtSimMs: now, initial: creating || !!key && initial.has(key), present: true, ambiguous: false };
        physical.set(eid, row);
      } else {
        // We cannot certify a reused slot, even if its new occupant is useful.
        if (!row.present || row.name !== name || row.typeId !== typeId || row.key && row.key !== key) row.ambiguous = true;
        row.key ??= key; row.present = true;
      }
    }
    for (const row of physical.values()) if (!present.has(row.eid)) row.present = false;
  };
  capturePhysical(lastAt, true);

  function scan(): SuccessiveGrowthBuild[] {
    scans++;
    if (closed) return result();
    const source = getCommittedEvents(world), now = readSimulationTime(world);
    if (!sourceId || source.stopped || source.sourceId !== sourceId || !Number.isFinite(now) || now < lastAt) {
      close("source_or_time_changed"); return result();
    }
    lastAt = now;
    if (!godKey || identity(godEid) !== godKey || !hasComponent(world, godEid, GodAgent)
      || Name.value[godEid] !== godName || hasComponent(world, godEid, Removed)
      || getFactoryState() !== factory || !weaver || weaver.spiritType !== "architect"
      || factory.createdSpirits.get(weaverEid) !== weaver || !entityExists(world, weaverEid)
      || hasComponent(world, weaverEid, Removed)
      || managed && (getSpiritSystemState(world) !== managed || managed.registry.world !== world
        || managed.registry.spirits.get(weaverEid) !== weaver || managed.registry.godAgentEid !== godEid)) {
      close("owner_unavailable_or_replaced"); return result();
    }
    capturePhysical(now); if (closed) return result();
    // This diagnostics getter deliberately does NOT reevaluate native guards:
    // getCurrentObservedProposals can revoke admission and is not an observer.
    const admitted = new Map(getObservedProposalDiagnostics(world).map(row => [row.id, row]));
    for (const p of factory.pendingProposals) {
      if (initialProposals.has(p.id) || p.type !== "entity" || p.fromSpiritEid !== weaverEid || !admitted.has(p.id)) continue;
      const diagnostic = admitted.get(p.id)!;
      let row = proposals.get(p.id);
      if (!row) {
        if (proposals.size >= LIMIT) { close("proposal_observation_limit"); return result(); }
        row = { native: p, specification: JSON.stringify(p.specification), scopeId: p.observationScopeId, firstSeenAtSimMs: now };
        proposals.set(p.id, row);
      }
      if (row.native !== p || row.specification !== JSON.stringify(p.specification) || !p.observationScopeId || row.scopeId !== p.observationScopeId
        || diagnostic.issuedAtSimMs > now) row.invalid = "proposal_identity_or_specification_changed";
      if (row.invalid) { note(`${p.id}:${row.invalid}`); continue; }
      if (["approved", "building", "executed"].includes(p.status) && p.approvedBy === godEid) row.approvedAt ??= now;
      if (p.status === "executed" && p.approvedBy === godEid && row.approvedAt !== undefined) row.executedAt ??= now;
    }
    const receipts = getPlaceBuildStatus(world, registry);
    const add = (p: SpiritProposal, row: Proposal, eid: number, spec: MaterializedEntitySpec, receiptKey?: string) => {
      const target = physical.get(eid), key = identity(eid);
      if (!target || target.initial || target.ambiguous || !target.present || !key || key !== target.key
        || initial.has(key) || receiptKey !== undefined && key !== receiptKey || hasComponent(world, eid, Removed)
        || !hasComponent(world, eid, PhysicalObject) || !hasComponent(world, eid, ObjectType)
        || target.firstSeenAtSimMs < row.firstSeenAtSimMs || target.firstSeenAtSimMs < row.approvedAt!) {
        note(`${p.id}:target_identity_or_birth_unverified`); return;
      }
      const typeId = spec.components?.find(c => c.name === "ObjectType")?.values?.typeId;
      if (spec.type !== "object" || spec.name !== Name.value[eid] || typeof typeId !== "string" || typeId !== ObjectType.typeId[eid]) {
        note(`${p.id}:object_type_unverified`); return;
      }
      let food: boolean, seat: boolean;
      try { food = objects.hasTrait(eid, "edible"); seat = objects.hasTrait(eid, "sittable"); }
      catch { note(`${p.id}:malformed_traits`); return; }
      if (food === seat) { note(`${p.id}:useful_kind_unverified`); return; }
      // Earliest actual physical observation remains decisive if identity only
      // arrives on a later action. Executed-status polling cannot redate a seat.
      const executedAt = Math.min(row.executedAt!, target.firstSeenAtSimMs);
      const prior = [...builds.values()].find(b => b.targetKey === key && b.proposalId !== p.id);
      if (prior) { note(`${p.id}:target_claimed_by_another_proposal`); return; }
      if (builds.size >= LIMIT && !builds.has(key)) { close("build_observation_limit"); return; }
      builds.set(key, { proposalId: p.id, sourceId: sourceId!, targetKey: key, kind: food ? "meal" : "seat",
        observedApprovedAtSimMs: row.approvedAt!, observedExecutedAtSimMs: executedAt, approvedByGod: true });
    };
    for (const [id, row] of proposals) {
      const p = row.native;
      if (row.invalid || row.executedAt === undefined || p.status !== "executed" || p.approvedBy !== godEid) continue;
      if (!factory.pendingProposals.includes(p) || p.fromSpiritEid !== weaverEid || p.observationScopeId !== row.scopeId
        || JSON.stringify(p.specification) !== row.specification) { row.invalid = "proposal_identity_or_specification_changed"; note(`${id}:${row.invalid}`); continue; }
      const spec = p.specification;
      const collisions = factory.pendingProposals.filter(other => other.type === "entity" && other.specification?.name === spec?.name);
      if (collisions.length !== 1 || collisions[0] !== p) { note(`${id}:ambiguous_proposal_name`); continue; }
      if (spec?.type === "room" && Array.isArray(spec.contents)) {
        const matches = receipts.filter(r => r.sourceId === sourceId && r.name === spec.name);
        if (matches.length !== 1 || initialReceipts.has(matches[0].id) || matches[0].phase !== "constructed") {
          note(`${id}:native_place_receipt_unverified`); continue;
        }
        const receipt = matches[0];
        if (!receipt.members.some(m => m.id === "room" && m.type === "room" && m.current)
          || receipt.members.length !== spec.contents.length + 1) { note(`${id}:native_place_members_unverified`); continue; }
        for (const item of spec.contents) {
          if (item.entity?.type !== "object") continue;
          const members = receipt.members.filter(m => m.id === item.id && m.name === item.entity.name && m.type === "object");
          if (members.length !== 1 || !members[0].current) { note(`${id}:native_member_unavailable`); continue; }
          add(p, row, members[0].eid, item.entity, members[0].key);
        }
      } else if (spec?.type === "object") {
        const matches = [...physical.values()].filter(target => target.present && target.name === spec.name);
        if (matches.length !== 1) { note(`${id}:bare_object_name_unverified`); continue; }
        add(p, row, matches[0].eid, spec);
      } else note(`${id}:unscored_entity_kind`);
    }
    return result();
  }
  return { scan, snapshot: () => ({ sourceId, scans, closed, builds: result(), diagnostics: [...diagnostics],
    physical: [...physical.values()].map(row => ({ ...row })), proposals: [...proposals].map(([id, row]) => ({ id,
      firstSeenAtSimMs: row.firstSeenAtSimMs, observedApprovedAtSimMs: row.approvedAt,
      observedExecutedAtSimMs: row.executedAt, invalid: row.invalid, status: row.native.status })) }) };
}
