/**
 * Architect Spirit
 *
 * A spirit type that can DESIGN and CREATE new simulation elements.
 * Architects are creative spirits that propose and (when approved) execute:
 * - New SYSTEMS (behavioral patterns for the world)
 * - New COMPONENTS (data types for entities)
 * - New ENTITIES (objects, NPCs, places)
 * - New RULES (automatic consequences)
 *
 * This is the key to a self-growing simulation - architects observe needs
 * and propose solutions that expand the world's capabilities.
 *
 * Examples:
 * - QuestArchitect: Creates quest systems and quest entities
 * - WeatherArchitect: Proposes weather systems when environmental detail needed
 * - CraftingArchitect: Creates crafting systems and recipes
 */

import { generateText } from "ai";
import { getWorldAuthoringContext } from "../world/world-specification";
import { randomUUID } from "node:crypto";
import { captureActorIntentionEvidence, type ActorIntentionEvidence } from "./actor-intention-evidence";
import { captureSpiritCycleScope } from "./spirit-cycle-scope";
import { captureWatcherObservations } from "./watcher-spirit";
import { captureNarrativeOpportunities } from "./narrative-opportunities";
import { getCommittedEvents } from "../runtime/committed-events";
import { captureSpiritPublicEventReview, getRecentSpiritEnvironmentOutcomes, type SpiritPublicEventInput } from "./spirit-public-event-review";
import { readSimulationTime } from "../ecs/simulation-time";
import { beginArchitectDiagnostics, type ArchitectDiagnosticInput } from "./architect-diagnostics";
import { getArchitectDesignFeedback, recordArchitectDesignFeedback, type ArchitectDesignFeedback } from "./architect-feedback";
import { getCodingDaemon, type BuildAdmission } from "../engineering/coding-daemon";
import { materializeApprovedEntity, materializationRoomDependencies } from "../engineering/entity-materialization";
import { describeWorldMaterialization } from "../engineering/world-materialization-adapter";
import { getEntityAuthoringCatalog } from "../engineering/entity-authoring-catalog";
import { getExternalParticipants } from "../runtime/participant-identities";
import { hasPlaceBlueprint, validateAuthoredEntityBlueprint, materializePlaceBlueprint, getPlaceBuildStatus, type EntityBlueprint, type PlaceConstructionCurrent, type PlaceActorReference } from "../engineering/place-materialization";
import { captureEntityMaterializationScope } from "../engineering/entity-materialization-scope";
import { PLACE_SUPPORT_AUTHORING_INSTRUCTIONS, PLACE_SUPPORT_SCHEMA_INSTRUCTIONS, placeSupportRequirementsSchema, readPlaceDesignResponse, validatePlaceSupportDesign, type PlaceSupportRequirements } from "../engineering/place-support";
import { canonicalBuildJson } from "../engineering/build-work-identity";
import { getWorldConstructionStatus } from "../runtime/world-construction-budget";
import { observeRoomInventories } from "./room-inventory-observation";
import { getRoomPopulationStatus } from "./steward-spirit";
import { getEvolutionWorkStatus } from "./world-crafter-spirit";
import { captureInteractionObservations, getInteractionObservations } from "./interaction-observations";
import { isRoomRouteTopologyCurrent, captureRoomRouteEvidence, type RoomRouteObservation } from "../runtime/room-routes";
import { MANAGED_SYSTEM_CAPABILITIES, MANAGED_CAPABILITY_DESCRIPTION, PROTECTED_MANAGED_COMPONENTS, PRIVATE_MANAGED_COMPONENTS, testSchema, type AcceptanceTest, type BuildJob } from "../engineering/contracts";
import { listDefinitions, getRegistryEntry } from "../ecs/component-registry";
import { builtinComponentSchema } from "../ecs/builtin-component-schema";
import { query, hasComponent, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Mind, GodAgent, Removed, Room, ObjectState } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { spiritModel, codeModel as designModel31 } from "../llm/config";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { registerSystem } from "../ecs/dynamic-systems";
import { createDynamicComponent } from "../ecs/dynamic-components";
import type { SpiritRegistry } from "./spirit-registry";
import { reportToSuperior } from "./spirit-registry";
import { bindSpiritMessageDelivery } from "./spirit-message-delivery";
import {
  type DynamicSpiritState,
  type ArchitectConfig,
  type SpiritProposal,
  submitProposal,
  getApprovedProposals,
  markProposalExecuted,
  markProposalFailed,
  logSpiritExecution,
  getFactoryState,
} from "./spirit-factory";
import { recordEvent, getFullIntrospectionForSpirit } from "./consistency-spirit";
import { formatWorldRuntimeHealth } from "../runtime/fast-system-health";
import { formatNativeRuntimeServices } from "../runtime/native-services";
import { getActiveGoals } from "../cognition/cognition-system";
import {
  registerAffordance,
  type AffordanceDefinition,
} from "../world/schema";
import {
  registerTrait,
  isTraitRegistered,
  type TraitDefinition,
  type TraitCategory,
} from "../world/trait-registry";
import {
  registerRelationshipType,
  hasRelationshipType,
  type RelationshipTypeDefinition,
} from "../ecs/relationship-registry";

// =============================================================================
// PROPOSAL SPECIFICATIONS
// =============================================================================

export interface SystemProposalSpec {
  name: string;
  description: string;
  frequency: number;
  targetComponents: string[];
  logic: string;  // Natural language description of what it does
  triggers?: string[];  // What triggers the system
  effects?: string[];   // What effects it has
  requiredCapabilities?: string[];
  writes?: string[];
  acceptance?: AcceptanceTest[];
}

export interface ComponentProposalSpec {
  name: string;
  description: string;
  fields: { name: string; type: string; description: string }[];
  category: string;
}

export type EntityProposalSpec = EntityBlueprint;

export interface RuleProposalSpec {
  name: string;
  description: string;
  trigger: string;   // When to fire
  condition: string; // What must be true
  effect: string;    // What happens
}

/**
 * Robustly extract JSON from LLM output that may contain markdown fences,
 * trailing commas, comments, or other noise.
 */
function extractJSON(text: string): any {
  let s = text.trim();

  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  // Try direct parse first
  try { return JSON.parse(s); } catch {}

  // Find first [ or { and last ] or }
  const firstBracket = s.search(/[\[{]/);
  const lastBracket = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    let candidate = s.slice(firstBracket, lastBracket + 1);

    // Strip single-line comments
    candidate = candidate.replace(/\/\/[^\n]*/g, "");
    // Strip trailing commas before } or ]
    candidate = candidate.replace(/,\s*([}\]])/g, "$1");

    try { return JSON.parse(candidate); } catch {}

    // Last resort: try to fix unterminated strings by closing them
    const fixed = candidate.replace(/:\s*"([^"]*?)(\n|$)/g, ': "$1"$2');
    try { return JSON.parse(fixed); } catch {}
  }

  throw new SyntaxError(`Could not extract valid JSON from LLM output (${s.length} chars)`);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const DEFAULT_BAKE_TIMEOUT_MS = readPositiveIntEnv("SPIRIT_BAKE_TIMEOUT_MS", 120000);
const DEFAULT_BAKE_MAX_RETRIES = readPositiveIntEnv("SPIRIT_BAKE_MAX_RETRIES", 3);
const DEFAULT_MAX_APPROVED_PER_PASS = readPositiveIntEnv("SPIRIT_MAX_APPROVED_PER_PASS", 3);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toPascalCase(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "Adaptive";
  return cleaned
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join("");
}

// =============================================================================
// ARCHITECT COGNITION
// =============================================================================


/**
 * Run architect cognition cycle - observe, design, propose
 */
export async function runArchitectCognition(
  world: World,
  systemRegistry: SystemRegistry,
  spiritRegistry: SpiritRegistry,
  architect: DynamicSpiritState
): Promise<SpiritProposal[]> {
  const diagnostic = beginArchitectDiagnostics(world, architect.eid), began = performance.now();
  diagnostic({ stage: "cycle", outcome: "started" });
  try {
    const result = await runArchitectCycle(world, systemRegistry, spiritRegistry, architect, diagnostic);
    diagnostic({ stage: "cycle", outcome: "completed", admitted: result.length, durationMs: performance.now() - began });
    return result;
  } catch (error) {
    diagnostic({ stage: "cycle", outcome: "failed", durationMs: performance.now() - began });
    throw error;
  }
}

async function runArchitectCycle(world: World, systemRegistry: SystemRegistry, spiritRegistry: SpiritRegistry,
  architect: DynamicSpiritState, diagnostic: (input: ArchitectDiagnosticInput) => void): Promise<SpiritProposal[]> {
  if (!architect.architectConfig) {
    diagnostic({ stage: "cycle", outcome: "rejected", reason: "no_config" });
    console.error(`[Architect] Spirit ${architect.definition.name} has no architect config`);
    return [];
  }

  const capturedScope = captureSpiritCycleScope(world, architect, spiritRegistry);
  const watcherInput = captureWatcherObservations(world, spiritRegistry, architect);
  const policy = JSON.stringify(architect.architectConfig);
  const scope = { ...capturedScope,
    // Historical advice fences inference, not the lifetime of accepted work.
    // Accepted proposals retain their own native evidence and source guards.
    sourceCurrent: () => capturedScope.sourceCurrent() && JSON.stringify(architect.architectConfig) === policy,
    isCurrent: () => capturedScope.isCurrent() && watcherInput.current() && JSON.stringify(architect.architectConfig) === policy };
  // Slow authors must still see outcomes between reviews. Reuse the same
  // source-bound, per-spirit history as the Narrator, separately from the fresh
  // event:<index> evidence that may ground construction. History grants no tools.
  const publicReview = captureSpiritPublicEventReview(world, architect, spiritRegistry, scope.isCurrent);
  // 1. OBSERVE: Gather context about the simulation state
  const context = await gatherArchitectContext(world, systemRegistry);
  context.publicActivityHistory = publicReview.input;
  const opportunities=captureNarrativeOpportunities(world);
  narrativeObservations.set(context,opportunities);
  context.narrativeOpportunities=opportunities.records;
  context.recentDesignFailures = getArchitectDesignFeedback(world, architect);
  contextScopes.set(context, scope);
  if (!scope.isCurrent()) { diagnostic({ stage: "cycle", outcome: "rejected", reason: "stale_observation" }); return []; }

  // Advice helps inspection; it is not an additional construction citation.
  context.watcherObservations = watcherInput.observations;

  // 2. ANALYZE: Identify needs and opportunities (LLM-based + Watcher-provided)
  let observed = false;
  const llmNeeds = await identifyNeeds(architect, context, input => {
    if (input.stage === "needs" && input.outcome === "completed") observed = true;
    diagnostic(input);
  });
  if (!scope.isCurrent()) { diagnostic({ stage: "needs", outcome: "rejected", reason: "stale_observation" }); return []; }
  // Valid [] means the author reviewed the input and found no supported need.
  // Provider/parse failures retain the history for another cycle. A later design
  // failure does not undo a completed observation or claim a successful build.
  const publicHistoryAccepted = publicReview.finish({ accepted: observed, interventions: [] }) && observed;
  if (observed) watcherInput.acknowledge();
  // Watcher messages remain observations, not automatic permission to invent a
  // system. Only designs grounded in the current evidence enter this lane.
  const allNeeds = [...llmNeeds];

  // Prioritize system proposals first (they're the highest-value evolution),
  // then by priority level, keeping relative order stable within tiers
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const typeOrder: Record<string, number> = { system: 0, component: 1, rule: 2, entity: 3 };
  const needs = allNeeds.sort((a, b) => {
    const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });

  // 3. DESIGN: Create proposals for addressing needs
  const proposals: SpiritProposal[] = [];
  let reobservationUsed = false;

  for (const need of needs.slice(0, architect.architectConfig.maxProposalsPerCycle || 3)) {
    const staleHandoff: { refs?: readonly string[] } = {};
    let proposal = await designProposal(architect, need, context, spiritRegistry, diagnostic,
      refs => { staleHandoff.refs = refs; });
    // One recovery for the whole cycle, only before design inference. A stale
    // contracted place/revision waits for the next ordinary review: this path
    // must not rewrite its previously declared support contract. Re-observation
    // inherits the original cycle/source/task cancellation, not new authority.
    if (!proposal && staleHandoff.refs?.length && !reobservationUsed && !need.revisionOf
      && !need.supportRequirements && scope.isCurrent()) {
      reobservationUsed = true;
      diagnostic({ stage: "reobserve", outcome: "started", dependency: "actor_intention",
        invalidatedReferences: staleHandoff.refs });
      const freshWatcher = captureWatcherObservations(world, spiritRegistry, architect);
      const freshScope = { ...scope, isCurrent: () => scope.isCurrent() && freshWatcher.current() };
      const freshReview = captureSpiritPublicEventReview(world, architect, spiritRegistry, freshScope.isCurrent);
      const fresh = await gatherArchitectContext(world, systemRegistry);
      const freshOpportunities = captureNarrativeOpportunities(world);
      fresh.publicActivityHistory = freshReview.input;
      fresh.watcherObservations = freshWatcher.observations;
      fresh.narrativeOpportunities = freshOpportunities.records;
      fresh.recentDesignFailures = getArchitectDesignFeedback(world, architect);
      fresh.needHandoffReobservation = { type: need.type, description: need.description,
        invalidatedReferences: staleHandoff.refs };
      // A repeated description is not the same demand. Keep the original
      // native owner/goal lineage outside model-controlled context and require
      // fresh citations from that scope, never a room or another actor instead.
      const originalIntentions = intentionObservations.get(context)?.evidence;
      const originalDemand = new Set((need.evidence ?? []).flatMap(ref => originalIntentions?.getDemandKeys(ref) ?? []));
      reobservationDemands.set(fresh, originalDemand);
      fresh.needHandoffReobservation.eligibleDemandReferences = (fresh.actorIntentions ?? [])
        .filter(record => intentionObservations.get(fresh)?.evidence.getDemandKeys(record.ref).some(key => originalDemand.has(key)))
        .map(record => record.ref);
      narrativeObservations.set(fresh, freshOpportunities);
      contextScopes.set(fresh, freshScope);
      if (!freshScope.isCurrent()) {
        diagnostic({ stage: "reobserve", outcome: "rejected", reason: "stale_observation", dependency: "producer_scope" });
      } else {
        let reviewed = false;
        const refreshedNeeds = await identifyNeeds(architect, fresh, input => {
          if (input.stage === "needs" && input.outcome === "completed") reviewed = true;
          diagnostic(input);
        });
        if (!freshScope.isCurrent()) {
          diagnostic({ stage: "reobserve", outcome: "rejected", reason: "stale_observation", dependency: "producer_scope" });
        } else {
          freshReview.finish({ accepted: reviewed, interventions: [] });
          if (reviewed) freshWatcher.acknowledge();
          diagnostic({ stage: "reobserve", outcome: reviewed ? "completed" : "failed", admitted: refreshedNeeds.length });
          // No callback: if the newly authored need also stales, preserve that
          // rejection and stop. Never prune stale citations from an old need.
          if (refreshedNeeds[0]) proposal = await designProposal(architect, refreshedNeeds[0], fresh, spiritRegistry, diagnostic);
        }
      }
    }
    if (proposal) {
      proposals.push(proposal);
    }
  }

  // 4. EXECUTE: Process any approved proposals
  await executeApprovedProposals(world, systemRegistry, architect);

  // Close the observational loop even when no new construction is needed.
  // This is the captured public evidence actually considered by this cycle,
  // not a fabricated outcome of the proposal it may just have designed.
  const feedbackCurrent=()=>scope.sourceCurrent() && watcherInput.current() && readSimulationTime(world)-(context.observedAtSimMs ?? readSimulationTime(world))<=30000;
  const history = context.publicActivityHistory;
  const hasHistory = history && (history.throughSequence > history.afterSequence
    || history.environment.throughSequence > history.environment.afterSequence);
  if(publicHistoryAccepted && feedbackCurrent() && (context.recentEvents.length || hasHistory)) {
    const report=reportToSuperior(spiritRegistry,architect.eid,"World activity reviewed",
      `Reviewed ${context.recentEvents.length} fresh native event receipts and ${history?.records.length ?? 0} bounded historical records; identified ${needs.length} grounded needs and ${proposals.length} proposals. Historical records are not current construction authority. Construction is not proof of use.`,
      "normal", // Ordinary successful activity (e.g. sitting) is not an urgent repair.
      {observedAtSimMs:context.observedAtSimMs,sourceId:getCommittedEvents(world).sourceId,
        recentEvents:context.recentEvents,publicActivityHistory:history,placeBuilds:context.placeBuilds,needsIdentified:needs.length,proposalIds:proposals.map(p=>p.id)});
    if(report)bindSpiritMessageDelivery(spiritRegistry,report,feedbackCurrent,
      { expiresAtSimMs: (context.observedAtSimMs ?? readSimulationTime(world)) + 30000 });
  }

  // Record cognition event
  recordEvent("architect_cognition", {
    architect: architect.definition.name,
    needsIdentified: needs.length,
    proposalsCreated: proposals.length,
  }, architect.definition.name);

  logSpiritExecution(
    architect.eid,
    "design",
    `${proposals.length} proposals`,
    "success",
    `Needs: ${needs.length}`
  );

  return proposals;
}

export interface ArchitectContext {
  /** Immutable setting guidance, never current evidence or execution authority. */
  worldAuthoringContext?: string;
  /** Caller-installed engineering contract, not a need citation, a fact about
   * installed mechanics, or permission to bypass native release admission. */
  hostEngineeringContext?: string;
  /** Per-author committed history with explicit receipt IDs, gaps and omissions.
   * Read-only context, never indexed by observedNeedEvidence as a build citation. */
  publicActivityHistory?: SpiritPublicEventInput;
  environmentalOutcomes?: ReturnType<typeof getRecentSpiritEnvironmentOutcomes>;
  narrativeOpportunities?: ReturnType<typeof captureNarrativeOpportunities>["records"];
  observedAtSimMs?: number;
  entityAuthoringCatalog?: ReturnType<typeof getEntityAuthoringCatalog>;
  externalParticipants?: ReturnType<typeof getExternalParticipants>;
  interactionFailures?: ReturnType<typeof getInteractionObservations>;
  legacyEvolution?: ReturnType<typeof getEvolutionWorkStatus>;
  placeBuilds?: ReturnType<typeof getPlaceBuildStatus>;
  constructionBudget?: ReturnType<typeof getWorldConstructionStatus>;
  existingSystems: string[];
  nativeServices?: string;
  hostConstruction?: string;
  runtimeHealth?: string;
  existingComponents: string[];
  managedComponents?: { name: string; builtIn: boolean; writable: boolean; fields: Record<string, string> }[];
  entityCounts: Record<string, number>;
  recentEvents: any[];
  watcherObservations?: ReturnType<typeof captureWatcherObservations>["observations"];
  detectedPatterns: any[];
  agentStates: { name: string; arousal: number; goalCount: number }[];
  actorIntentions?: readonly ActorIntentionEvidence[];
  recentDesignFailures?: readonly ArchitectDesignFeedback[];
  /** Author-only recovery context. Old references are diagnostic, not citations. */
  needHandoffReobservation?: { type: IdentifiedNeed["type"]; description: string; invalidatedReferences: readonly string[];
    eligibleDemandReferences?: readonly string[] };
  omittedIntentions?: number;
  roomRoutesEnabled?: boolean;
  setting: { name: string; omittedEntities?: number; entities: { eid: number; name: string; isRoom?: boolean; room?: string; description?: string; state?: string; routeExits?: RoomRouteObservation }[];
    unavailableEntities?: { eid: number; name: string; reason: "removed" }[]; omittedUnavailableEntities?: number };
  proposalHistory: { id?: string; name: string; type: string; status: string; description: string; rejectionReason?: string; revisionOf?: string }[];
  engineeringJobs: { id: string; status: string; instruction: string; error?: string; work?: BuildJob["work"] }[];
  roomInventory?: ReturnType<typeof observeRoomInventories>;
  roomPopulation?: ReturnType<typeof getRoomPopulationStatus>;
}

const intentionObservations = new WeakMap<ArchitectContext, { world: World; evidence: ReturnType<typeof captureActorIntentionEvidence> }>();
const reobservationDemands = new WeakMap<ArchitectContext, ReadonlySet<string>>();
const narrativeObservations=new WeakMap<ArchitectContext,ReturnType<typeof captureNarrativeOpportunities>>();
const interactionObservations = new WeakMap<ArchitectContext, ReturnType<typeof captureInteractionObservations>>();
const contextScopes = new WeakMap<ArchitectContext, ReturnType<typeof captureSpiritCycleScope>>();
const materializationScopes = new WeakMap<ArchitectContext, ReturnType<typeof captureEntityMaterializationScope>>();
const routeObservations = new WeakMap<ArchitectContext, ReturnType<typeof captureRoomRouteEvidence>>();
type ProposalDiagnostic = { issuedAtSimMs: number; changedAtSimMs: number; evidence: readonly string[]; reason?: string };
const proposalAdmissions = new WeakMap<SpiritProposal, { world: World; admission: BuildAdmission; nativeCurrent?:PlaceConstructionCurrent; supportRequirements?:PlaceSupportRequirements; actorReferences:ReadonlyMap<string,PlaceActorReference>;
  diagnostic: ProposalDiagnostic }>();
function proposalAdmission(world: World, proposal: SpiritProposal): BuildAdmission | undefined {
  if (!proposal.observationScopeId && !proposalAdmissions.has(proposal)) return;
  const scoped = proposalAdmissions.get(proposal);
  if (scoped?.world === world && scoped.admission.key !== proposal.observationScopeId)
    observeProposalCheck(world, scoped.diagnostic, "scope_key_changed");
  if (!scoped || scoped.world !== world || scoped.admission.key !== proposal.observationScopeId || !scoped.admission.current())
    throw new Error("Proposal observation is stale or unavailable; observe the current world again");
  return scoped.admission;
}
function proposalBelongsToWorld(world: World, proposal: SpiritProposal): boolean {
  const scoped = proposalAdmissions.get(proposal);
  return !scoped || scoped.world === world;
}

/** Autonomous review admits only real, still-current observations. Legacy host
 * proposals remain available to explicit operators, not this capability. */
export function getCurrentObservedProposals(world: World): SpiritProposal[] {
  return getFactoryState().pendingProposals.filter(proposal=>{
    if(!proposalAdmissions.has(proposal)) return false;
    try { return !!proposalAdmission(world,proposal); } catch { return false; }
  });
}

/** Operator-only dependency inspection. Never returned through God/spirit tools
 * and never grants, refreshes or restores proposal execution authority. */
export function getObservedProposalDiagnostics(world: World) {
  return getFactoryState().pendingProposals.filter(p => proposalAdmissions.get(p)?.world === world).slice(-30).map(p => {
    const scoped = proposalAdmissions.get(p)!;
    // Do not reevaluate guards here: some native guards permanently revoke on
    // their first stale observation. Diagnostics must never cause that revocation.
    return { id: p.id, status: p.status, ...scoped.diagnostic,
      evidence: scoped.diagnostic.evidence.slice(0, 64), lastObservedAdmissible: scoped.diagnostic.reason === undefined };
  });
}
function observeProposalCheck(world: World, diagnostic: ProposalDiagnostic | undefined, reason?: string) {
  if (!diagnostic || diagnostic.reason === reason) return;
  try { diagnostic.changedAtSimMs = readSimulationTime(world); diagnostic.reason = reason; }
  catch { /* Diagnostic bookkeeping cannot alter proposal admission. */ }
}

export async function gatherArchitectContext(
  world: World,
  systemRegistry: SystemRegistry
): Promise<ArchitectContext> {
  const introspection = getFullIntrospectionForSpirit(world, systemRegistry);
  const source = getCommittedEvents(world), now = readSimulationTime(world);

  // Get agent entities from the entities list
  const agents = introspection.entities.filter(e => e.isAgent);
  const namedEntities = [...query(world, [Name])].filter(eid => !hasComponent(world, eid, GodAgent) && !hasComponent(world, eid, Prefab) && !hasComponent(world, eid, Removed));
  const removedEntities = [...query(world, [Name, Removed])].filter(eid => !hasComponent(world, eid, GodAgent) && !hasComponent(world, eid, Prefab));

  // Build entity counts by type
  const entityCounts: Record<string, number> = {
    agents: introspection.agentCount,
    rooms: introspection.roomCount,
    total: namedEntities.length,
  };

  const intentions = captureActorIntentionEvidence(world), failures=captureInteractionObservations(world);
  const routes = captureRoomRouteEvidence(world, namedEntities.slice(0, 60).filter(eid => hasComponent(world, eid, Room)));
  const context: ArchitectContext = {
    worldAuthoringContext: getWorldAuthoringContext(world),
    hostEngineeringContext: getCodingDaemon(world)?.getHostAuthoringContext() ?? "",
    observedAtSimMs:now,
    environmentalOutcomes: getRecentSpiritEnvironmentOutcomes(world),
    entityAuthoringCatalog: getEntityAuthoringCatalog(),
    externalParticipants:getExternalParticipants(world),
    interactionFailures:{records:failures.records,omitted:failures.omitted},
    legacyEvolution: getEvolutionWorkStatus(world),
    placeBuilds: getPlaceBuildStatus(world,systemRegistry),
    roomInventory: observeRoomInventories(world),
    roomPopulation: getRoomPopulationStatus(world),
    constructionBudget: getWorldConstructionStatus(world),
    existingSystems: introspection.systems.map(s => s.name),
    nativeServices: [formatNativeRuntimeServices(world), describeWorldMaterialization(world)].filter(Boolean).join("\n\nHOST CONSTRUCTION BOUNDARY (required):\n"),
    hostConstruction: describeWorldMaterialization(world),
    runtimeHealth: formatWorldRuntimeHealth(world),
    existingComponents: listDefinitions().map(c => c.name),
    managedComponents: listDefinitions().filter(c => !PRIVATE_MANAGED_COMPONENTS.has(c.name)).map(c => ({
      name: c.name, builtIn: getRegistryEntry(c.name)?.isStatic === true,
      writable: !PROTECTED_MANAGED_COMPONENTS.has(c.name), fields: { ...c.properties },
    })),
    entityCounts,
    actorIntentions: intentions.records, omittedIntentions: intentions.omitted,
    roomRoutesEnabled: isRoomRouteTopologyCurrent(world),
    recentEvents: source.stopped ? [] : source.events.filter(event => event.atSimMs <= now && now - event.atSimMs <= 30000).slice(-50)
      .map(event => ({ id: event.id, executionId: event.executionId, action: event.action, operation: event.operation,
        actorKey: event.actorKey, actorName: event.actorName, targetKey: event.targetKey, targetName: event.targetName,
        roomKey: event.roomKey, roomName: event.roomName, status: event.status, atSimMs: event.atSimMs,
        startedAtSimMs: event.startedAtSimMs, completedAtSimMs: event.completedAtSimMs,
        ...(event.text ? { words: event.text } : {}) })),
    detectedPatterns: [],
    agentStates: agents.map(a => ({
      name: a.name,
      arousal: Mind.arousal[a.eid] ?? 0.5,
      goalCount: getActiveGoals(world, a.eid).length,
    })),
    setting: { name: world.meta.name, omittedEntities: Math.max(0, namedEntities.length - 60),
      unavailableEntities: removedEntities.slice(0, 60).map(eid => ({ eid, name: Name.value[eid], reason: "removed" })),
      omittedUnavailableEntities: Math.max(0, removedEntities.length - 60), entities: namedEntities.slice(0, 60).map(eid => {
      const room = getRoomForEntity(world, eid);
      const isRoom = hasComponent(world, eid, Room);
      return { eid, name: Name.value[eid], isRoom, room: room === undefined ? undefined : Name.value[room], description: Description.value[eid]?.slice(0, 300),
        ...(hasComponent(world, eid, ObjectState) ? { state: ObjectState.current[eid]?.slice(0, 300) } : {}),
        ...(isRoom ? { routeExits: routes.observations.get(eid) } : {}) };
    }) },
    proposalHistory: getFactoryState().pendingProposals.filter(p => proposalBelongsToWorld(world,p)).slice(-30).map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status, description: p.description, rejectionReason: p.rejectionReason, revisionOf: p.revisionOf })),
    engineeringJobs: (getCodingDaemon(world)?.getStatus().jobs ?? []).slice(-12).map(j => ({ id: j.id, status: j.status, instruction: j.request.instruction.slice(0, 500), error: j.error, work: j.work })),
  };
  intentionObservations.set(context, { world, evidence: intentions });
  interactionObservations.set(context,failures);
  routeObservations.set(context,routes);
  materializationScopes.set(context, captureEntityMaterializationScope(world, context.setting.entities.map(entity => entity.eid)));
  return context;
}

interface IdentifiedNeed {
  revisionOf?: string;
  type: "system" | "component" | "entity" | "rule" | "affordance" | "trait" | "relationship_type";
  description: string;
  priority: "low" | "medium" | "high";
  rationale: string;
  evidence?: string[];
  expectedChange?: string;
  supportRequirements?:PlaceSupportRequirements;
}

function isNeedType(value: unknown): value is IdentifiedNeed["type"] {
  return value === "system" || value === "component" || value === "entity" || value === "rule"
    || value === "affordance" || value === "trait" || value === "relationship_type";
}

function isPriority(value: unknown): value is IdentifiedNeed["priority"] {
  return value === "low" || value === "medium" || value === "high";
}

function normalizeNeed(raw: any): IdentifiedNeed | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNeedType(raw.type)) return null;
  if (raw.revisionOf !== undefined && (typeof raw.revisionOf !== "string" || !raw.revisionOf.trim())) return null;

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return null;
  const support=raw.supportRequirements===undefined ? undefined : placeSupportRequirementsSchema.safeParse(raw.supportRequirements);
  if(support && (!support.success||raw.type!=="entity")) return null;

  const priority: IdentifiedNeed["priority"] = isPriority(raw.priority) ? raw.priority : "medium";
  const rationale = typeof raw.rationale === "string" && raw.rationale.trim().length > 0
    ? raw.rationale.trim()
    : "Improves simulation robustness and behavioral depth.";

  return {
    type: raw.type,
    revisionOf: raw.revisionOf,
    description,
    priority,
    rationale,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((value: unknown) => typeof value === "string").slice(0, 8) : [],
    expectedChange: typeof raw.expectedChange === "string" ? raw.expectedChange.trim().slice(0, 1000) : "",
    ...(support?.success ? {supportRequirements:support.data} : {}),
  };
}


export async function identifyNeeds(
  architect: DynamicSpiritState,
  context: ArchitectContext,
  diagnostic: (input: ArchitectDiagnosticInput) => void = () => {}
): Promise<IdentifiedNeed[]> {
  const began = performance.now();
  diagnostic({ stage: "needs", outcome: "started" });
  try {
    const result = await generateText({
      model: spiritModel,
      prompt: `You are ${architect.definition.name}, an architect spirit in the ${architect.definition.domain} domain.

${context.worldAuthoringContext ?? ""}

${context.hostEngineeringContext ? `HOST ENGINEERING CONTRACT (authoring limits, not evidence of a missing need or an already built mechanic):\n${context.hostEngineeringContext}\n` : ""}
Your role is to identify what the simulation NEEDS to grow and improve.
${context.needHandoffReobservation ? `
NEED_HANDOFF_REOBSERVATION: ${JSON.stringify(context.needHandoffReobservation)}
The preceding need was rejected before design because cited actor intentions changed. Reassess only this same need against the fresh evidence below; return [] if it no longer has sufficient support. Otherwise return exactly one need with the same type and description, newly authored rationale/expectedChange and fresh evidence references. Cite at least one eligibleDemandReferences intention; these preserve the original actor and causal purpose. Other current entity references can supplement this demand but cannot replace it. Do not cite another actor or unrelated purpose. Old references above are diagnostic only. Select the minimum sufficient citations: prefer a relevant durable goal or undertaking when it fully supports the proposed opportunity. Cite a transient purpose or planned step only when its additional details are necessary; those dependencies must still be current. Do not simply remove failed citations from the old answer or substitute unrelated demand. This is the single re-observation allowance, not approval or a new construction budget.
` : ""}

ACTOR DEMAND (author-only; never publish these private intentions as NPC knowledge):
- Actor intentions (author-only evidence, not other NPCs' knowledge): ${JSON.stringify(context.actorIntentions ?? [])}
- Omitted intention records: ${context.omittedIntentions ?? 0}
- Proposal permissions: ${JSON.stringify({ systems: architect.architectConfig?.canProposeSystems, components: architect.architectConfig?.canProposeComponents, entities: architect.architectConfig?.canProposeEntities, rules: false })}
NARRATIVE OPPORTUNITIES: ${JSON.stringify(context.narrativeOpportunities ?? [])}
These are operator suggestions assessed by the narrator, not accomplished events, NPC knowledge, or arbitrary tool authority. You may propose one useful new entity/inhabitant when consistent with the actual setting. Cite its exact opportunity: reference AND a current entity: room reference; use existing physical routes and give new inhabitants their own intentions. Never relocate an existing actor, invent their consent, recreate removed props, or assert arrival from a suggestion. If nothing is appropriate, propose nothing. Construction still requires God approval.
Assess whether these intentions can be pursued using the actual world. A healthy runtime can still lack a destination, service, tool, transport or inhabitant needed by an actor. Compare ongoing goals and undertakings, upcoming plan targets and selected movements with the setting, connections, capabilities and pending construction below. You need not wait for a failed action. Infer a minimal useful opportunity when the evidence supports one; do not turn every thought or passing remark into a construction request.
An undertaking is the actor's interpreted ongoing commitment, not the raw conversation or anyone else's consent. It may survive a supporting coordination goal. planned_step records are upcoming targets, not executed actions; selected_purpose is a transient approach, possibly blocked. Prefer a relevant enduring goal or undertaking for growth that must survive ordinary travel. Cite any more specific plan/step record you rely on too; changing that plan can invalidate the proposal.
next_purpose is an explicitly chosen later purpose tied to an active owned goal, not a passing thought or executed action. It survives a temporary wait but ends when taken up or cancelled. Prefer its matching goal record when that goal fully grounds the need; cite next_purpose too only when relying on its additional details, which then require fresh observation after the choice is taken up or cancelled.

CURRENT STATE:
${context.nativeServices ?? ""}
${context.runtimeHealth ?? ""}
- Systems: ${context.existingSystems.join(", ") || "none"}
- Components: ${context.existingComponents.join(", ")}
- Support vocabulary (registered IDs and schema interactions, not current availability): ${JSON.stringify({objectTypes:context.entityAuthoringCatalog?.objectTypes.map(t=>({typeId:t.typeId,description:t.description,traits:t.traits})),omittedObjectTypes:context.entityAuthoringCatalog?.omittedObjectTypes,affordances:context.entityAuthoringCatalog?.affordances,omittedAffordances:context.entityAuthoringCatalog?.omittedAffordances,nativeCapabilities:context.entityAuthoringCatalog?.nativeCapabilities})}
- Entity counts: ${JSON.stringify(context.entityCounts)}
- Room inventory (observed counts, not missing-capability diagnoses or construction requests): ${JSON.stringify(context.roomInventory ?? null)}
- Delegated room population (pending/blocked/stale are not completed work): ${JSON.stringify(context.roomPopulation ?? [])}
- Place builds (native assembly and current unmet requirements; not NPC success or a request to replace departed residents): ${JSON.stringify(context.placeBuilds ?? [])}
- Legacy evolution work (constructed actors do not prove stock; failed descriptive mechanics need validated authoring): ${JSON.stringify(context.legacyEvolution ?? null)}
- Unresolved local interactions (author-only attempted targets, not proof of global absence or creation orders; matches are current named entities): ${JSON.stringify(context.interactionFailures ?? null)}
- Agent states: ${context.agentStates.map(a => `${a.name}(arousal:${a.arousal.toFixed(2)}, goals:${a.goalCount})`).join(", ")}
- Outside participants (not physical residents; do not duplicate them as NPCs, even when an actor intends to meet them): ${JSON.stringify(context.externalParticipants ?? [])}
- Detected patterns: ${JSON.stringify(context.detectedPatterns)}
- Watcher observations (historical advice to inspect; not construction authority or citable facts): ${JSON.stringify(context.watcherObservations ?? [])}
- Environmental outcomes (native public history, not present-state guarantees or independent build authority): ${JSON.stringify(context.environmentalOutcomes ?? null)}
Consider whether actual weather and its committed consequences expose a useful missing detail or mechanic. A changing description alone is not a functioning system. Ground any proposal in the current cited place or actor purpose, preserve existing mechanics, and respect the proposal permissions above.
- Setting and entities (entity:<eid> evidence): ${JSON.stringify(context.setting)}
- Recent observed events: ${JSON.stringify(context.recentEvents.map((event, i) => ({ ref: `event:${i}`, event })))}
PUBLIC_ACTIVITY_HISTORY (historical, read-only, not construction evidence):
${JSON.stringify(context.publicActivityHistory ?? null)}
These are bounded native outcomes since this author's last accepted review, not present-state guarantees. Receipt IDs and sequence ranges identify historical evidence, not event:<index> citations. Gaps, omitted records and omitted receipt IDs mean the account is incomplete, never that nothing happened. Use this history to inspect consequences; any new proposal still requires the current citable state, intention or fresh event evidence above. Do not publish private intentions as residents' knowledge.
- Pending, completed and failed proposals: ${JSON.stringify(context.proposalHistory)}
- Engineering jobs (job:<id> evidence): ${JSON.stringify(context.engineeringJobs)}
- This author's recent design rejections (historical advice, NOT citable world evidence): ${JSON.stringify(context.recentDesignFailures ?? [])}
- World construction admissions (includes seed construction; deletion does not refund): ${JSON.stringify(context.constructionBudget ?? null)}
${MANAGED_CAPABILITY_DESCRIPTION}

Based on your domain expertise (${architect.definition.domain}), identify 0-3 evidence-backed NEEDS:
- Missing systems that would enhance simulation
- Components that would enable new behaviors
- Entities that would add richness
- Do not propose rules: their executor is unsupported.
Return [] when current purposes already have adequate support, an intended obstacle explains the gap, relevant work is pending, or there is insufficient evidence. No change is a successful observation. Do not manufacture novelty or duplicate an existing native service. A failed build is not a missing mechanic; report its actual failure before proposing another implementation. Every need must cite existing event:<index>, entity:<eid>, job:<id>, or exact intention/interaction references and name an observable expectedChange. A failed search may reflect depletion, deliberate removal, or a target elsewhere; investigate current state rather than automatically replacing it. Unavailable/removed identities and consumed states are not vacant slots to refill. Omitted entities mean the visible catalog is incomplete, not that a target is absent. Cite the current actor intention when growth serves that intention.
An actor's purpose may reveal missing reachable places, transport, inhabitants or capabilities before any action fails. Cite the relevant intention when proposing growth for it. Construction creates possibilities, not compulsory choices or accomplished goals; a place requires usable connections, and a described prop is not a working capability.
Ground ongoing construction in the actor's concrete goal when it supplies the needed details. A selected_purpose is only the current step: citing it makes the proposal depend on that step still being current, even during an ordinary interruption. Do not infer an enduring commitment from a transient step alone.
Reassess unmet purposes on later cycles against actual inventories, place support, failed interactions and system health. A constructed place is not proof its purpose is supported or used. Improve an existing place with the missing entity, component or mechanic instead of duplicating the room. Rejected designs are feedback to correct, not automatic retries or construction evidence. Reuse native capabilities; missing mechanics need an approved managed system with acceptance tests. Quiet activity, deliberate absence and finite consumption are not defects to repair.

${PLACE_SUPPORT_AUTHORING_INSTRUCTIONS}

To redesign a failed proposal, cite proposal:<id> and set revisionOf to that ID.
Read its rejectionReason and propose a correction, not an automatic retry. Keep
the same need description and system name. At most two revisions per chain are
admitted; pending, executed, and explicitly rejected proposals are not retryable.

Respond with a JSON array of needs:
[
  {
    "type": "system|component|entity|rule",
    "description": "What is needed",
    "priority": "low|medium|high",
    "rationale": "Why this would improve the simulation",
    "evidence": ["event:0"],
    "expectedChange": "The observable state change that would prove the gap closed"
  }
]`,
    });

    const parsed = extractJSON(result.text);
    if (!Array.isArray(parsed)) {
      diagnostic({ stage: "needs", outcome: "rejected", reason: "non_array", durationMs: performance.now() - began });
      return [];
    }
    const permitted = validateObservedNeeds(parsed, context).filter(need => need.type === "entity" ? architect.architectConfig?.canProposeEntities !== false
      : need.type === "system" ? architect.architectConfig?.canProposeSystems !== false
      : need.type === "component" ? architect.architectConfig?.canProposeComponents !== false : true);
    const retry = context.needHandoffReobservation;
    const admitted = retry ? permitted.filter(need => {
      if (need.type !== retry.type || need.description !== retry.description || need.revisionOf || need.supportRequirements) return false;
      const scope = reobservationDemands.get(context), evidence = intentionObservations.get(context)?.evidence;
      const references = (need.evidence ?? []).filter(ref => ref.startsWith("intention:"));
      return !!scope?.size && !!evidence && references.length > 0
        && references.every(ref => evidence.getDemandKeys(ref).some(key => scope.has(key)));
    }).slice(0, 1) : permitted;
    diagnostic({ stage: "needs", outcome: "completed", candidates: Array.isArray(parsed) ? parsed.length : 0,
      admitted: admitted.length, durationMs: performance.now() - began });
    return admitted;
  } catch (error) {
    diagnostic({ stage: "needs", outcome: "failed", reason: "provider_or_parse", durationMs: performance.now() - began });
    console.error(`[Architect] Failed to identify needs:`, error);
    return [];
  }
}

/** References prove that a proposal is connected to observed input, not that its
 * interpretation is correct. Behavioral acceptance remains a separate gate. */
function observedNeedEvidence(context: ArchitectContext): Map<string, unknown> {
  // One captured observation index serves validation and the designer handoff.
  // Resolving a citation must not re-read a later world, nor attach an unrelated
  // private goal. These are author facts/attributed intentions, not NPC stimuli
  // or proof that the preceding model's interpretation was correct.
  const records = new Map<string, unknown>();
  context.recentEvents.forEach((event, i) => records.set(`event:${i}`, event));
  context.setting.entities.forEach(entity => records.set(`entity:${entity.eid}`, entity));
  context.engineeringJobs.forEach(job => records.set(`job:${job.id}`, job));
  context.actorIntentions?.forEach(intention => records.set(intention.ref, intention));
  context.narrativeOpportunities?.forEach(opportunity=>records.set(opportunity.ref,opportunity));
  context.interactionFailures?.records.forEach(failure => records.set(failure.ref, failure));
  context.proposalHistory.filter(p => p.id && p.status === "failed" && p.rejectionReason)
    .forEach(proposal => records.set(`proposal:${proposal.id}`, proposal));
  return records;
}

export function validateObservedNeeds(raw: unknown, context: ArchitectContext): IdentifiedNeed[] {
  if (!Array.isArray(raw)) return [];
  const refs = observedNeedEvidence(context);
  const seen = new Set<string>();
  const normalized = raw.map(normalizeNeed).filter(Boolean) as IdentifiedNeed[];
  return normalized.filter(need => {
    if (need.type === "rule" || !need.expectedChange || !need.evidence?.length || need.evidence.some(ref => !refs.has(ref))) return false;
    if(need.evidence.some(ref=>ref.startsWith("opportunity:")) && (need.type!=="entity" || !context.setting.entities.some(entity=>entity.isRoom && need.evidence!.includes(`entity:${entity.eid}`))))return false;
    const key = `${need.type}:${need.description.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (seen.has(key)) return false; seen.add(key);
    if (need.revisionOf) return !!admitProposalRevision(need, context.proposalHistory);
    return !context.proposalHistory.some(proposal => proposal.type === need.type &&
      proposal.description.toLowerCase().replace(/[^a-z0-9]/g, "") === need.description.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }).slice(0, 3);
}

const MAX_PROPOSAL_REVISIONS = 2;
function admitProposalRevision(need: IdentifiedNeed, history: ArchitectContext["proposalHistory"]) {
  const parent = history.find(p => p.id === need.revisionOf);
  if (!parent || parent.status !== "failed" || !parent.rejectionReason || parent.type !== need.type
    || parent.description !== need.description || !need.evidence?.includes(`proposal:${parent.id}`)
    || history.some(p => p.revisionOf === parent.id)) return undefined;
  const seen = new Set<string>();
  let cursor: typeof parent | undefined = parent;
  while (cursor) {
    if (!cursor.id || seen.has(cursor.id) || cursor.status !== "failed" || seen.size >= MAX_PROPOSAL_REVISIONS) return undefined;
    seen.add(cursor.id);
    if (!cursor.revisionOf) {
      const normalizedName = parent.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (history.some(p => p.type === parent.type && !seen.has(p.id ?? "")
        && (p.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedName || p.description === parent.description))) return undefined;
      return parent;
    }
    cursor = history.find(p => p.id === cursor!.revisionOf);
  }
  return undefined; // Incomplete history is not authority to reset the budget.
}

export function validateManagedProposal(spec: SystemProposalSpec, requireContract = false): void {
  const capabilities = spec.requiredCapabilities ?? [];
  for (const capability of capabilities) if (!(MANAGED_SYSTEM_CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`Unsupported managed capability ${capability}`);
  for (const coordinate of spec.writes ?? []) {
    const [component, field] = coordinate.split(".");
    if (PROTECTED_MANAGED_COMPONENTS.has(component)) throw new Error(`Protected component ${component}`);
    validateBuiltinFixtureField(component, field);
  }
  for (const component of spec.targetComponents ?? []) if (PRIVATE_MANAGED_COMPONENTS.has(component)) throw new Error(`Private component read denied: ${component}`);
  if (requireContract && (!capabilities.length || !spec.writes?.length || !spec.acceptance?.length)) throw new Error("A system design needs declared capabilities, writes, and independent designer acceptance tests");
  if (spec.acceptance) for (const fixture of spec.acceptance) {
    testSchema.parse(fixture);
    if (fixture.system !== spec.name) throw new Error("Acceptance test must target the proposed system");
    for (const entity of fixture.entities) for (const [component, fields] of Object.entries(entity.components)) {
      if (PRIVATE_MANAGED_COMPONENTS.has(component)) throw new Error(`Private component read denied: ${component}`);
      for (const [field, value] of Object.entries(fields)) validateBuiltinFixtureField(component, field, value);
    }
    for (const assertion of fixture.expect) {
      if (PRIVATE_MANAGED_COMPONENTS.has(assertion.component)) throw new Error(`Private component read denied: ${assertion.component}`);
      validateBuiltinFixtureField(assertion.component, assertion.field, assertion.equals);
    }
  }
}

/** Catch impossible designer contracts before spending a build on them. Dynamic
 * schema additions remain the release validator's responsibility. */
function validateBuiltinFixtureField(component: string, field: string, value?: unknown): void {
  if (!Object.hasOwn(builtinComponentSchema, component)) return;
  const fields: Record<string, string> = builtinComponentSchema[component as keyof typeof builtinComponentSchema];
  if (!Object.hasOwn(fields, field)) throw new Error(`Unknown built-in field ${component}.${field}`);
  if (value !== undefined && typeof value !== fields[field]) throw new Error(`Invalid built-in field type ${component}.${field}: expected ${fields[field]}`);
}

async function designProposal(
  architect: DynamicSpiritState,
  need: IdentifiedNeed,
  context: ArchitectContext,
  spiritRegistry?: SpiritRegistry,
  diagnostic: (input: ArchitectDiagnosticInput) => void = () => {},
  onStaleNeed?: (invalidatedReferences: readonly string[]) => void
): Promise<SpiritProposal | null> {
  const began = performance.now();
  diagnostic({ stage: "design", outcome: "started" });
  let lastDependency: string | undefined;
  const reject = (reason: ArchitectDiagnosticInput["reason"], detail?: string) => {
    diagnostic({ stage: "design", outcome: "rejected", reason, detail, durationMs: performance.now() - began,
      ...(reason === "stale_observation" ? { dependency: lastDependency,
        invalidatedReferences: demandCurrent?.invalidatedReferences() } : {}) });
    if (observation && scope) recordArchitectDesignFeedback(observation.world, architect, {
      type: need.type, description: need.description, reason: reason ?? "submission",
      // Validation messages, never raw provider output or command arguments.
      problem: reason === "contract" ? detail : undefined,
      requirementIds: (supportRequirements ?? []).map(requirement => requirement.id),
    }, scope.sourceCurrent);
    return null;
  };
  const observation = intentionObservations.get(context), scope = contextScopes.get(context);
  const opportunityRefs=(need.evidence??[]).filter(ref=>ref.startsWith("opportunity:"));
  const opportunities=narrativeObservations.get(context);
  const opportunityCurrent=opportunities?.bind(opportunityRefs);
  let supportRequirements = need.supportRequirements;
  const demandCurrent = observation?.evidence.bind(need.evidence ?? []);
  // A cited, still-current owned goal can outlive walking away from the failed
  // interaction. Failure-only requests retain their local context requirement.
  const durableActors=observation?.evidence.records.filter(record=>["goal", "undertaking"].includes(record.kind) && need.evidence?.includes(record.ref)).map(record=>record.actorKey) ?? [];
  const failures=interactionObservations.get(context), failureBinding=failures?.bind(need.evidence ?? [],durableActors);
  const routes=routeObservations.get(context);
  const citedRooms=context.setting.entities.filter(entity=>entity.isRoom && need.evidence?.includes(`entity:${entity.eid}`)).map(entity=>entity.eid);
  let routeCurrent=routes?.bind(citedRooms);
  let addedRouteSources: readonly number[]=[];
  let physicalCurrent: (() => boolean) | undefined;
  let proposalDiagnostic: ProposalDiagnostic | undefined;
  // Same short-circuit predicates and ordering as admission; the first failing
  // dependency now has a name instead of an opaque false. No new acceptance path.
  const currentFailure = (beforeConstruction=true, constructedRoom?: Parameters<PlaceConstructionCurrent>[0]): string | undefined => {
    if (scope && !scope.sourceCurrent()) return "producer_source";
    if (opportunityRefs.length && !opportunityCurrent?.()) return "narrative_opportunity";
    if (observation && !demandCurrent?.()) return "actor_intention";
    if (physicalCurrent && !physicalCurrent()) return "materialization_or_removed_identity";
    if (routeCurrent && !routeCurrent(constructedRoom ? addedRouteSources.map(from=>({from,to:constructedRoom.eid,key:constructedRoom.key})) : [])) return "room_routes";
    if ((need.evidence ?? []).some(ref=>ref.startsWith("interaction:"))
      && !(beforeConstruction ? failureBinding?.current() : failureBinding?.duringConstruction())) return "interaction_evidence";
  };
  const current = (beforeConstruction=true, constructedRoom?: Parameters<PlaceConstructionCurrent>[0]) => {
    try {
      const reason = currentFailure(beforeConstruction, constructedRoom);
      lastDependency = reason;
      if (observation) observeProposalCheck(observation.world, proposalDiagnostic, reason);
      return reason === undefined;
    } catch (error) {
      if (observation) observeProposalCheck(observation.world, proposalDiagnostic, "dependency_check_error");
      throw error;
    }
  };
  if (!current() || scope && !scope.isCurrent()) {
    const rejected = reject("stale_observation");
    const invalidated = demandCurrent?.invalidatedReferences() ?? [];
    if (lastDependency === "actor_intention" && invalidated.length && scope?.isCurrent()) onStaleNeed?.(invalidated);
    return rejected;
  }
  let specification: any = null;
  let rawOutput = "";
  const observations = observedNeedEvidence(context);
  if (need.evidence?.some(ref => !observations.has(ref))) return reject("stale_observation");
  const actorReferences=new Map<string,PlaceActorReference>();
  const bindActors = (): { reason: "contract" | "stale_observation"; detail: string } | undefined => {
    actorReferences.clear();
    for(const requirement of supportRequirements ?? []) if(requirement.kind==="existing_actor") {
      if(!need.evidence?.includes(requirement.intentionRef)) return { reason: "contract", detail: "Existing actors must cite their captured intention in this need's evidence" };
      const actor=observation?.evidence.resolveActor(requirement.intentionRef);
      if(!actor) return { reason: "stale_observation", detail: "Existing actor intention is unavailable" };
      if(actorReferences.has(requirement.intentionRef) || [...actorReferences.values()].some(a=>a.eid===actor.eid))
        return { reason: "contract", detail: "An existing person must have one local ID" };
      actorReferences.set(requirement.intentionRef,actor);
    }
  };
  const actorError = bindActors();
  if (actorError) return reject(actorError.reason, actorError.detail);

  try {
    const specPrompt = getArchitectSpecificationPrompt(need.type, need.description, context);

    const result = await generateText({
      model: designModel31,  // Gemini 3.1 Pro - better structured output
      prompt: `You are ${architect.definition.name}, designing a solution for: ${need.description}

${context.worldAuthoringContext ?? ""}

${context.hostEngineeringContext ? `HOST ENGINEERING CONTRACT (required; registered schema vocabulary does not broaden this grant):\n${context.hostEngineeringContext}\n` : ""}
Observed evidence: ${JSON.stringify((need.evidence ?? []).map(ref => ({ ref, observation: observations.get(ref) })))}
Need rationale (author interpretation, not established world state): ${JSON.stringify(need.rationale)}
Revision of failed proposal: ${need.revisionOf ?? "none"}
Expected change: ${need.expectedChange ?? "Watcher observation requires validation"}
Predeclared place support requirements (do not omit or weaken): ${JSON.stringify(need.supportRequirements ?? null)}
Design review: The preceding need may be incomplete. Design the smallest WORKING version of the place's function, not just a stage for the visitor's next action. The original requirements are a minimum, not the whole purpose. Check the FULL cited purpose against offered capabilities. A place for a meal needs finite edible food and a native way to obtain/eat it; a place to rest may need only a seat. A work destination needs usable tools, data and effects, not a profession in a persona. These are examples of purpose coverage, not templates to spawn. Do not invent future users' decisions or embody outside contacts.
For a room, you may add additionalSupportRequirements: [...] using the existing support requirement schema. They are appended to the original contract, never replacements; use new IDs and discharge every addition in the blueprint. State unresolvedSupport: ["the missing capability"] if this design still cannot offer its purpose; a nonempty list defers construction for revision. An empty list is your assessment, not proof of native success. Ensure described inhabitants, props and sounds are represented by entities; omit unbuilt activity from descriptions. Do not describe patrons chatting when only furniture is present.
Recent author rejections (advice only): ${JSON.stringify(context.recentDesignFailures ?? [])}
${specPrompt}

Actual setting: ${JSON.stringify(context.setting)}
Recent failures and pending work: ${JSON.stringify(context.proposalHistory)}
Respond with valid JSON only, no markdown fences, no comments.`,
    });

    rawOutput = result.text;
    specification = extractJSON(result.text);
  } catch (error) {
    console.error(`[Architect] Failed to design ${need.type} proposal for "${need.description}":`, error);
    if (rawOutput) console.error(`[Architect] Raw LLM output (first 300 chars): ${rawOutput.slice(0, 300)}`);
    return reject("provider_or_parse");
  }

  if (!specification || typeof specification !== "object") {
    return reject("non_object");
  }

  if (!specification.name || typeof specification.name !== "string") {
    specification.name = toPascalCase(need.description) + (need.type === "system" ? "System" : "");
  }
  if (!specification.description || typeof specification.description !== "string") {
    specification.description = need.description;
  }
  const sameName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === specification.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!current() || scope && !scope.isCurrent()) return reject("stale_observation");
  const currentHistory = getFactoryState().pendingProposals.filter(p => !observation || proposalBelongsToWorld(observation.world,p));
  const revision = need.revisionOf ? admitProposalRevision(need, currentHistory) : undefined;
  if (need.revisionOf && (!revision || !sameName(revision.name))) return reject("revision");
  if ((!revision && currentHistory.some(p => p.type === need.type && sameName(p.name))) ||
      need.type === "component" && getRegistryEntry(specification.name) ||
      need.type === "system" && context.existingSystems.some(sameName) ||
      need.type === "entity" && context.setting.entities.some(entity => sameName(entity.name))) return reject("duplicate");
  try { if (need.type === "system") validateManagedProposal(specification, true); }
  catch (error) { recordEvent("proposal_rejected", { name: specification.name, reason: String(error) }, architect.definition.name); return reject("contract", String(error)); }
  if (need.type === "entity") {
    try {
      const response = readPlaceDesignResponse(specification, supportRequirements);
      specification = response.blueprint; supportRequirements = response.requirements;
      specification = validateAuthoredEntityBlueprint(specification);
      const authoredNames = [specification.name, ...(hasPlaceBlueprint(specification) ? specification.contents.map((row: { entity: { name: string } }) => row.entity.name) : [])];
      if (authoredNames.some(name => context.setting.unavailableEntities?.some(entity => entity.name.trim().toLowerCase() === name.trim().toLowerCase())))
        throw new Error("Removed identities are not empty construction slots; do not recreate them under the same name");
      if(hasPlaceBlueprint(specification)) validatePlaceSupportDesign(specification,supportRequirements);
      else if(supportRequirements) throw new Error("A place support contract requires a room blueprint, not a substitute prop");
      const actorError = bindActors();
      if (actorError) return reject(actorError.reason, actorError.detail);
      const placementCurrent = materializationScopes.get(context)?.bind(specification);
      physicalCurrent = () => (!placementCurrent || placementCurrent()) && (!observation
        || ![...query(observation.world, [Name, Removed])].some(id => authoredNames.some(name =>
          Name.value[id]?.trim().toLowerCase() === name.trim().toLowerCase())));
      routeCurrent = routes?.bind([...citedRooms, ...materializationRoomDependencies(specification)]);
      addedRouteSources = [...(specification.connectToRoomEids ?? [])];
    }
    catch (error) { return reject("contract", String(error)); }
    if (!current()) return reject("stale_observation");
  }

  // Advice must still be current when the authored result is admitted. After
  // admission, only its cited native dependencies determine continued validity.
  if (!current() || scope && !scope.isCurrent()) return reject("stale_observation");
  const proposal = submitProposal(
    architect.eid,
    need.type,
    specification.name,
    specification.description,
    specification,
    need.rationale
  );

  if (proposal) {
    if(opportunityRefs.length)opportunities!.attach(opportunityRefs,proposal);
    if (observation) {
      const proposedSpecification = proposal.specification, serializedSpecification = JSON.stringify(proposedSpecification);
      const causalKeys = Object.freeze([...new Set([...observation.evidence.records,...(failures?.records ?? [])]
        .filter(record => need.evidence?.includes(record.ref)).map(record => record.causalKey))].sort());
      proposalDiagnostic = { issuedAtSimMs: readSimulationTime(observation.world), changedAtSimMs: readSimulationTime(observation.world),
        evidence: Object.freeze([...(need.evidence ?? [])]) };
      const proposalCurrent=()=>{
        const reason = !getFactoryState().pendingProposals.includes(proposal) ? "proposal_removed"
          : proposal.specification !== proposedSpecification || JSON.stringify(proposedSpecification) !== serializedSpecification ? "specification_changed" : undefined;
        if (reason) observeProposalCheck(observation.world, proposalDiagnostic, reason);
        return reason === undefined;
      };
      const admission = Object.freeze({ key: `architect-observation:${randomUUID()}`,
        ...(causalKeys.length ? { causalKeys } : {}), current: () => proposalCurrent() && current() });
      proposal.observationScopeId = admission.key;
      proposalAdmissions.set(proposal, { world: observation.world, admission, nativeCurrent:room=>proposalCurrent() && current(false,room),
        diagnostic: proposalDiagnostic,
        supportRequirements:supportRequirements ? structuredClone(supportRequirements) : undefined,actorReferences });
    }
    if (revision) proposal.revisionOf = revision.id;
    console.log(`[Architect] ${architect.definition.name} proposed ${need.type}: ${specification.name}`);

    // Report proposal to superior (only if registry is available)
    if (spiritRegistry) {
      reportToSuperior(
        spiritRegistry,
        architect.eid,
        `New Proposal: ${specification.name}`,
        `**Type:** ${need.type}\n**Description:** ${specification.description}\n**Rationale:** ${need.rationale}`,
        need.priority === "medium" ? "normal" : need.priority,
        { proposal }
      );
    }
  }

  if (proposal) diagnostic({ stage: "design", outcome: "admitted", admitted: 1, durationMs: performance.now() - began });
  else return reject("submission");
  return proposal;
}

/** Pure authoring text for the captured host context. This does not validate,
 * execute, approve or refresh the evidence of any proposal. */
export function getArchitectSpecificationPrompt(
  type: IdentifiedNeed["type"],
  description: string,
  context: ArchitectContext
): string {
  switch (type) {
    case "system": {
      if (context.hostEngineeringContext) return `Design a SYSTEM for: ${description}

Return one complete JSON object with name, description, frequency, targetComponents, logic, requiredCapabilities, writes, and acceptance. The captured host engineering contract above controls names, reads, writes, initialization and cadence. Existing schemas are vocabulary, not broader permission. Introduce any necessary additive component schemas as part of this system's implementation contract; a standalone component proposal does not implement a mechanic.
Specify exact Component.field coordinates for writes and the type/default of every new field in logic. Select only host-admitted targets from the supplied public inputs. Explain initialization without resetting existing state, the physical update and its bounds. Managed frequency is logical ECS ticks; integrate rates with ctx.deltaMs/1000, the accumulated elapsed simulation time. Describe only the host-supported output/perception bridge. A computed scalar does not implicitly change native object state, descriptions, affordances, geometry or anyone's choices.
Acceptance must contain independently authored positive and boundary/excluded-target fixtures. Each fixture has {name, system, entities:[{id, components:{ComponentName:{field:value}}}], ticks, deltaMs, expect:[{entity, component, field, equals}]}. Use the exact proposed system name, real host input fields and complete required output fields. Tests state physical scalar outcomes, not narrated success. Do not weaken or omit the host contract to fit a convenient example.
${MANAGED_CAPABILITY_DESCRIPTION}

Existing systems (avoid duplicates): ${context.existingSystems.join(", ")}
${context.nativeServices ?? ""}
Registered managed-component schemas (the host contract may further restrict them): ${JSON.stringify(context.managedComponents ?? [])}`;
      const example: SystemProposalSpec = {
        name: "ExampleGaugeSystem",
        description: "Integrate a bounded physical quantity and its visible gauge",
        frequency: 1,
        targetComponents: ["ObjectState", "Description", "ExampleQuantity"],
        logic: "Select the relevant visible gauges using existing public identity/state. Attach new dynamic ExampleQuantity with amount default 0 if absent. While ObjectState.current is active, increase amount by ctx.deltaMs/1000, capped at 10. Update Description.value to 'The gauge reads N units.' using the resulting amount. Inactive gauges remain unchanged. Do not redefine built-in components.",
        requiredCapabilities: ["read_scalar_components", "write_unprotected_scalars", "attach_dynamic_components"],
        writes: ["ExampleQuantity.amount", "Description.value"],
        acceptance: [
          { name: "active half-second integration and appearance", system: "ExampleGaugeSystem",
            entities: [{ id: 1, components: { ObjectState: { current: "active" }, Description: { value: "The gauge reads 0 units." } } }],
            ticks: 2, deltaMs: 500, expect: [
              { entity: 1, component: "ExampleQuantity", field: "amount", equals: 1 },
              { entity: 1, component: "Description", field: "value", equals: "The gauge reads 1 units." },
            ] },
          { name: "inactive gauge stays unchanged", system: "ExampleGaugeSystem",
            entities: [{ id: 1, components: { ObjectState: { current: "inactive" }, Description: { value: "The gauge reads 0 units." }, ExampleQuantity: { amount: 0 } } }],
            ticks: 2, deltaMs: 1000, expect: [{ entity: 1, component: "ExampleQuantity", field: "amount", equals: 0 }] },
        ],
      };
      return `Design a SYSTEM for: ${description}

Return one complete JSON object. Adapt this example to the actual need and setting; do not copy its mechanic or names:
<managed-design-example>
${JSON.stringify(example, null, 2)}
</managed-design-example>

requiredCapabilities, writes, and acceptance are mandatory. Declare supported capability identifiers and exact Component.field coordinates. Acceptance fixtures must demonstrate the physical change and a negative/boundary case; they are authored by you before the worker and immutable to it.
Built-in field names and types are fixed. Store new quantities in a new dynamic component, not invented built-in fields. Do not assume new components or links already exist on live entities: specify selection and initialization from existing public state. frequency is a count of ECS ticks, not milliseconds. Integrate rates using ctx.deltaMs/1000, the elapsed in-world time. When a change is visible, derive Description.value or ObjectState.current from the physical data so local perception can observe it; narration alone is not an implemented effect.
${MANAGED_CAPABILITY_DESCRIPTION}

Existing systems (avoid duplicates): ${context.existingSystems.join(", ")}
${context.nativeServices ?? ""}
Registered managed-component schemas (writable=false means read-only; builtIn=true forbids redefinition): ${JSON.stringify(context.managedComponents ?? [])}`;
    }

    case "component":
      return `Design a COMPONENT for: ${description}

Required JSON format:
{
  "name": "ComponentName",
  "description": "What data this component stores",
  "fields": [
    { "name": "fieldName", "type": "string|number|boolean", "description": "What this field stores" }
  ],
  "category": "identity|cognition|stats|spatial|social|equipment"
}

Existing components (avoid duplicates): ${context.existingComponents.join(", ")}`;

    case "entity":
      return `Design an ENTITY for: ${description}

Schema for additionalSupportRequirements (add only missing capabilities; these are author metadata, not blueprint components):
${PLACE_SUPPORT_SCHEMA_INSTRUCTIONS}

For a NEW ROOM, return this shape, adapting its name, contents and requirements to the observed need:
{
  "name": "PlaceName",
  "description": "What this place is",
  "type": "room",
  "components": [],
  "connectToRoomEids": [],
  "contents": []
}
The contents array is mandatory. An explicitly empty array means a deliberately empty place; descriptions do not materialize furnishings or inhabitants.
The room name and every child entity.name must be distinct after trimming and ignoring case: native actions address exact names. Label multiple units separately (for example, "Bread roll 1", "Bread roll 2") while preserving their local IDs and registered ObjectType; identical units can otherwise share a description.
Each content is {id, entity}. For initial stock carried by a NEW resident, add carriedBy: "resident-local-id" to the NEW object's content row and explicitly set PhysicalObject.portable=true. Custody must fit the resident's inventory. Existing actors and possessions cannot be assigned this way. This authors initial inventory, not a performed handoff or future NPC decision.
Discharge every predeclared support requirement: entity requirement IDs must be contents IDs with the requested type/role/objectType; connection requirements must appear in connectToRoomEids, system names in requiredSystems, and interactions in requiredInteractions with the same IDs and affordance. Each initial_custody requirement must set the item's carriedBy to the required new holder. You may add detail, but cannot remove, rename or weaken the author's requirements. Do not return a non-room substitute for a place contract.
Data requirements must be explicit component fields on their designated physical entity, not in its Description or a resident's systemPrompt. Author meaningful values using the registered schema and native capability compositions. Generated data is new world content; do not assign another actor's private intention or unexperienced encounters to a resident's knowledge.
For each existing_actor support requirement, include existingActors: [{"id":"visitor","intentionRef":"the exact cited intention reference"}] (max 8). These bind actual existing NPCs, never created contents or substitutes. Their location, inventory, cognition and goals stay unchanged. Interaction actor/target IDs can use these bindings; use the participant whose opportunity is intended. Do not invent EIDs or bind outside contacts.

For a SINGLE NON-ROOM ENTITY, return this shape (roomEid must identify an existing room):
{
  "name": "EntityName",
  "description": "What this entity is",
  "type": "agent|object|stimulus_source",
  "components": [
    { "name": "ComponentName", "values": { "field": "value" } }
  ],
  "roomEid": 123
}

Non-room entities require an existing roomEid (isRoom=true) from this setting: ${JSON.stringify(context.setting)}. Agents receive the normal cognition, inventory, interaction and movement baseline; specify their role/systemPrompt and any explicit component overrides. Rooms receive the normal spatial baseline but no automatic connectivity.
New agents may include private past: {background:"life before this scene",drives:["an enduring motivation"],memories:[{recollection:"a formative moment",period:"age or life period",emotionalTone:"warmth",importance:0.8,selfBelief:"what I came to believe about myself",meaning:"why it matters",cues:["relevant cue"],provenance:"authored-history"}]}. Use 1–6 drives and memories, consistent with the setting; ordinary kindness can be formative too. Keep this out of public descriptions. It does not create remembered people, witnessed events or completed goals, and cannot modify existing residents.
Explicit room-route authoring is ${context.roomRoutesEnabled ? "enabled: a new room may include connectToRoomEids, at most eight distinct existing room IDs, to create two-way local routes. Use actual observed rooms; do not invent IDs." : "not enabled: do not claim a room is reachable merely because it was created."}
For a place that needs inhabitants or props, declare them in the room's contents array (maximum 12): [{"id":"keeper","entity":{"name":"Nora","description":"The workshop keeper.","type":"agent","components":[{"name":"Agent","values":{"role":"keeper","systemPrompt":"You are Nora. You care about your workshop and visitors."}}]}}]. Adapt to the setting; this example is not an instruction to create a workshop. Each child has a distinct local id and type agent, object or stimulus_source, with no roomEid or routes: it is placed in the newly built room. Described people, props and recurring sounds need actual entities; empty transit spaces need not be populated. Do not turn an outside phone contact into a physical person merely because they claim to be present.
A room with contents may declare requiredSystems (exact system names, max 6) and requiredInteractions [{"actor":"keeper","target":"bench","affordance":"examine"}] (max 12, using content/existing actor IDs or target "room"). These are availability requirements, not automatically implemented mechanics. Unknown components must be built first; missing systems follow the existing managed system proposal/acceptance path. Native assembly can finish while requirements remain unmet. Awaiting presence means the bound visitor is elsewhere, not missing or to be replaced; availability is checked when they arrive. Consult place builds before duplicating construction: ${JSON.stringify(context.placeBuilds ?? [])}
Outside participant identities (not constructible residents; an invitation or an actor goal does not authorize their embodiment): ${JSON.stringify(context.externalParticipants ?? [])}
Every proposed component and field must exist with the correct scalar type. Unknown components are rejected atomically. A descriptive prop is not an implemented mechanic; a named vehicle is not working transport, and construction is not an actor's arrival or goal completion.
Every object, including each room content object, requires {"name":"ObjectType","values":{"typeId":"registered_type"}} in components. Choose from the catalog; use typeId "object" only for a deliberately generic prop. Native type construction supplies its states, traits and declared components. ObjectState.current may select one of that type's states. Explicit PhysicalObject or other component overrides must use actual fields; a display name never chooses a type or implements behavior.
Entity authoring catalog (schema metadata for NEW entities, not access to existing private cognition; omission counts mean this is a partial view): ${JSON.stringify(context.entityAuthoringCatalog ?? {objectTypes:[],componentSchemas:[]})}
${context.hostConstruction ? `HOST CONSTRUCTION BOUNDARY (required; narrows the generic examples above):\n${context.hostConstruction}` : ""}`;

    case "rule":
      return `Design a RULE for: ${description}

Required JSON format:
{
  "name": "RuleName",
  "description": "What this rule does",
  "trigger": "What event triggers this rule",
  "condition": "What must be true for rule to fire",
  "effect": "What happens when rule fires"
}`;

    case "affordance":
      return `Design an AFFORDANCE (action that can be performed on objects) for: ${description}

Effects MUST actually change the world. Available effect types:
- modify_component: Change values (e.g., reduce hunger, increase health)
- spawn: Create new entities (e.g., forge creates a sword)
- destroy: Remove entities (e.g., eating destroys food)
- set_state: Change object state (e.g., door: closed → open)
- add_trait/remove_trait: Change available actions
- emit_stimulus: Notify nearby agents (ALWAYS include this)
- transfer: Move items between containers

Required JSON format:
{
  "name": "affordanceName",
  "description": "What this action does",
  "requires": ["trait1"],
  "effects": [
    { "type": "modify_component", "target": "actor", "modifications": [{ "component": "Needs", "property": "hunger", "operation": "subtract", "value": 20 }] },
    { "type": "emit_stimulus", "target": "nearby", "stimulusType": "observation", "stimulusContent": "{actor} does something to {target}!" }
  ]
}`;

    case "trait":
      return `Design a TRAIT (tag for entities enabling affordances) for: ${description}

Required JSON format:
{
  "name": "traitName",
  "description": "What this trait means for an entity",
  "category": "physical|interactive|social|sensory|state|custom",
  "enablesAffordances": ["affordance1"],
  "incompatibleWith": []
}`;

    case "relationship_type":
      return `Design a RELATIONSHIP TYPE (dynamic link between entities) for: ${description}

Required JSON format:
{
  "name": "RelationName",
  "description": "What this relationship represents",
  "dataFields": { "strength": "number", "since": "string" },
  "isExclusive": false,
  "autoRemoveSubject": false
}`;

    default:
      return `Design a solution for: ${description}`;
  }
}

// =============================================================================
// PROPOSAL EXECUTION
// =============================================================================

/** All approved managed-system dispatch paths submit the same exact contract.
 * A second caller may observe that job, but cannot refresh its original authority. */
export function enqueueManagedSystemProposal(world: World, proposal: SpiritProposal,
  onComplete?: (job: BuildJob) => void): BuildJob {
  if (proposal.type !== "system" || !["approved", "building"].includes(proposal.status))
    throw new Error("Managed dispatch requires an approved system proposal");
  const admission = proposalAdmission(world, proposal), daemon = getCodingDaemon(world);
  if (!daemon) throw new Error("Approved managed proposals require the coding daemon");
  const spec = proposal.specification as SystemProposalSpec; validateManagedProposal(spec);
  const job = daemon.enqueue({ source: proposal.fromSpiritName,
    instruction: `Implement the approved system using existing schemas and the managed API. Include additive component files and behavioral tests. Specification: ${canonicalBuildJson(spec)}\nRationale: ${proposal.rationale}`,
    acceptance: spec.acceptance }, result => {
      // Shared job completion is physical evidence, not renewed proposal authority.
      let current = false;
      try { current = !admission || admission.current(); } catch { /* Stale observation. */ }
      if (!getFactoryState().pendingProposals.includes(proposal)) {
        // A reused textual ID cannot receive the old observer's completion.
        proposal.status = "failed"; proposal.rejectionReason = "Proposal registry identity changed before completion";
      } else if (result.status === "active" && current) markProposalExecuted(proposal.id);
      else markProposalFailed(proposal.id, !current ? "Proposal observation expired while shared work was pending" : result.error ?? result.status);
      onComplete?.(result);
    }, admission);
  proposal.status = "building";
  return job;
}

async function executeApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  architect: DynamicSpiritState
): Promise<void> {
  if (!architect.architectConfig?.canExecuteDirectly) {
    return;  // This architect can't execute directly
  }

  const approved = getApprovedProposals().filter(
    p => p.fromSpiritEid === architect.eid && proposalBelongsToWorld(world,p)
  );

  for (const proposal of approved) {
    try {
      await executeProposal(world, systemRegistry, proposal);
      if(proposal.status === "building") continue;
      markProposalExecuted(proposal.id);

      logSpiritExecution(
        architect.eid,
        `execute_${proposal.type}`,
        proposal.name,
        "success"
      );

      console.log(`[Architect] Executed proposal: ${proposal.name}`);
    } catch (error) {
      markProposalFailed(proposal.id, error instanceof Error ? error.message : String(error));
      logSpiritExecution(
        architect.eid,
        `execute_${proposal.type}`,
        proposal.name,
        "failure",
        String(error)
      );
      console.error(`[Architect] Failed to execute proposal ${proposal.name}:`, error);
    }
  }
}

async function executeProposal(
  world: World,
  systemRegistry: SystemRegistry,
  proposal: SpiritProposal
): Promise<void> {
  const admission = proposalAdmission(world, proposal);
  switch (proposal.type) {
    case "system":
      if(getCodingDaemon(world)) {
        enqueueManagedSystemProposal(world, proposal);
        break;
      }
      if(admission) throw new Error("Observed system proposals require the managed coding daemon for activation validation");
      await executeSystemProposal(world, systemRegistry, proposal.specification as SystemProposalSpec);
      break;
    case "component":
      executeComponentProposal(world, proposal.specification as ComponentProposalSpec);
      break;
    case "entity":
      executeEntityProposal(world, proposal.specification as EntityProposalSpec, proposalAdmissions.get(proposal)?.nativeCurrent ?? admission?.current, proposalAdmissions.get(proposal)?.supportRequirements, proposalAdmissions.get(proposal)?.actorReferences);
      break;
    case "rule":
      throw new Error(`Rule execution is unsupported: ${proposal.name}; propose a validated managed system instead`);
    case "affordance":
      executeAffordanceProposal(proposal.specification);
      break;
    case "trait":
      executeTraitProposal(proposal.specification);
      break;
    case "relationship_type":
      executeRelationshipTypeProposal(proposal.specification);
      break;
  }
}


// =============================================================================
// VOCABULARY PROPOSAL EXECUTION
// =============================================================================

interface AffordanceProposalSpec {
  name: string;
  description: string;
  requires: string[];
  effects?: any[];
}

interface TraitProposalSpec {
  name: string;
  description: string;
  category: string;
  enablesAffordances?: string[];
  incompatibleWith?: string[];
}

interface RelationshipTypeProposalSpec {
  name: string;
  description: string;
  dataFields?: Record<string, "number" | "string">;
  isExclusive?: boolean;
  autoRemoveSubject?: boolean;
}

function executeAffordanceProposal(spec: AffordanceProposalSpec): void {
  // Auto-register required traits that don't exist
  for (const traitName of spec.requires || []) {
    if (!isTraitRegistered(traitName)) {
      registerTrait({
        name: traitName,
        description: `Enables ${spec.name} interaction`,
        category: "custom" as TraitCategory,
        enablesAffordances: [spec.name],
        incompatibleWith: [],
      });
      console.log(`[Architect] Auto-registered trait: ${traitName}`);
    }
  }

  const def: AffordanceDefinition = {
    name: spec.name,
    description: spec.description,
    requires: spec.requires || [],
    effects: spec.effects as any,
    descriptionTemplate: `{actor.name} ${spec.name}s {target.name}.`,
  };
  registerAffordance(def);
  console.log(`[Architect] Created affordance: ${spec.name}`);

  recordEvent("affordance_created", {
    name: spec.name,
    requires: spec.requires,
    createdBy: "architect",
  }, "Architect");
}

function executeTraitProposal(spec: TraitProposalSpec): void {
  const def: TraitDefinition = {
    name: spec.name,
    description: spec.description,
    category: (spec.category || "custom") as TraitCategory,
    enablesAffordances: spec.enablesAffordances || [],
    incompatibleWith: spec.incompatibleWith || [],
  };
  registerTrait(def);
  console.log(`[Architect] Created trait: ${spec.name} (${spec.category})`);

  recordEvent("trait_created", {
    name: spec.name,
    category: spec.category,
    createdBy: "architect",
  }, "Architect");
}

function executeRelationshipTypeProposal(spec: RelationshipTypeProposalSpec): void {
  if (hasRelationshipType(spec.name)) {
    console.log(`[Architect] Relationship type already exists: ${spec.name}`);
    return;
  }

  const def: RelationshipTypeDefinition = {
    name: spec.name,
    description: spec.description,
    dataFields: spec.dataFields || {},
    isExclusive: spec.isExclusive || false,
    autoRemoveSubject: spec.autoRemoveSubject || false,
    category: "custom",
  };
  registerRelationshipType(def);
  console.log(`[Architect] Created relationship type: ${spec.name}`);

  recordEvent("relationship_type_created", {
    name: spec.name,
    createdBy: "architect",
  }, "Architect");
}

async function executeSystemProposal(
  world: World,
  systemRegistry: SystemRegistry,
  spec: SystemProposalSpec
): Promise<void> {
  // Build a detailed description for the system baker
  const bakerDescription = `
System Name: ${spec.name}
Purpose: ${spec.description}
Frequency: ${spec.frequency}ms
Target Components: ${spec.targetComponents.join(", ")}

Logic Description:
${spec.logic}

${spec.triggers?.length ? `Triggers: ${spec.triggers.join(", ")}` : ""}
${spec.effects?.length ? `Effects: ${spec.effects.join(", ")}` : ""}
`.trim();

  try {
    if (process.env.SPIRIT_FORCE_PLACEHOLDER_SYSTEMS === "1") {
      throw new Error("Placeholder systems cannot satisfy a live engineering proposal");
    }

    // Actually bake the system using the system baker
    const { bakeSystem } = await import("../god/system-baker");
    const result = await withTimeout(
      bakeSystem(bakerDescription, world, systemRegistry, DEFAULT_BAKE_MAX_RETRIES),
      DEFAULT_BAKE_TIMEOUT_MS,
      `Baking ${spec.name}`
    );

    if (result.success && result.system) {
      // Override the frequency with the architect's specification
      result.system.frequency = spec.frequency;
      result.system.active = true;  // Enable the system so runSystems will execute it

      // REGISTER THE BAKED SYSTEM!
      registerSystem(systemRegistry, result.system);

      recordEvent("system_baked", {
        name: spec.name,
        description: spec.description,
        createdBy: "architect",
        bakedSuccessfully: true,
      }, "Architect");

      console.log(`[Architect] ✓ Baked and registered system: ${spec.name}`);
    } else {
      console.log(`[Architect] Baking failed for ${spec.name}: ${result.error}`);
      throw new Error(result.error || "System bake failed");
    }
  } catch (error) {
    console.error(`[Architect] Error baking system ${spec.name}:`, error);
    throw error;
  }
}

function executeComponentProposal(
  world: World,
  spec: ComponentProposalSpec
): void {
  // Validate spec has required fields
  if (!spec || !spec.name) {
    throw new Error("Invalid component proposal: missing name");
  }

  // Create dynamic component with proper ComponentDefinition structure
  const properties: Record<string, "string" | "number" | "boolean"> = {};
  if (spec.fields && Array.isArray(spec.fields)) {
    for (const field of spec.fields) {
      if (
        field.name &&
        (field.type === "string" || field.type === "number" || field.type === "boolean")
      ) {
        if (Object.hasOwn(properties, field.name)) throw new Error(`Duplicate component field ${field.name}`);
        properties[field.name] = field.type;
      } else throw new Error(`Invalid component field ${field.name}`);
    }
  }
  if (!Object.keys(properties).length) throw new Error("A dynamic component requires declared scalar fields");

  createDynamicComponent({
    name: spec.name,
    properties,
    description: spec.description || `Dynamic component: ${spec.name}`,
  });

  recordEvent("component_created", {
    name: spec.name,
    fields: spec.fields?.map(f => f.name) || [],
    createdBy: "architect",
  }, "Architect");

  console.log(`[Architect] Created component: ${spec.name}`);
}

export function executeEntityProposal(world: World, spec: EntityProposalSpec, demandCurrent?: PlaceConstructionCurrent, supportRequirements?:PlaceSupportRequirements, actorReferences?:ReadonlyMap<string,PlaceActorReference>): number {
  if(supportRequirements!==undefined&&!hasPlaceBlueprint(spec)) throw new Error("Place support requires a room blueprint");
  const eid = hasPlaceBlueprint(spec) ? materializePlaceBlueprint(world,spec,demandCurrent,supportRequirements,actorReferences).roomEid : materializeApprovedEntity(world, spec);
  recordEvent("entity_created", { name: spec.name, type: spec.type, eid, componentCount: spec.components.length, createdBy: "architect" }, "Architect");
  console.log(`[Architect] Created entity: ${spec.name} (eid: ${eid}, type: ${spec.type})`);
  return eid;
}

/**
 * Execute all approved proposals (can be called independently of architect cognition)
 */
export async function executeAllApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  options: { maxProposals?: number; requireObserved?: boolean; allowedTypes?: SpiritProposal["type"][] } = {}
): Promise<{ executed: string[]; failed: string[]; queued: string[] }> {
  const maxProposals = Math.max(1, options.maxProposals ?? DEFAULT_MAX_APPROVED_PER_PASS);
  const observed = options.requireObserved ? new Set(getCurrentObservedProposals(world)) : undefined;
  const approved = getApprovedProposals().filter(p => proposalBelongsToWorld(world,p)
    && (!observed || observed.has(p)) && (!options.allowedTypes || options.allowedTypes.includes(p.type)));
  const batch = approved.slice(0, maxProposals);
  const executed: string[] = [];
  const failed: string[] = [];
  const queued: string[] = [];

  if (approved.length > batch.length) {
    console.log(
      `[Architect] Limiting execution to ${batch.length}/${approved.length} approved proposals this pass`
    );
  }

  for (const proposal of batch) {
    try {
      const admission = proposalAdmission(world, proposal);
      console.log(`[Architect] Executing approved proposal: ${proposal.name}`);
      const daemon=getCodingDaemon(world);
      if(daemon && proposal.type === "system") {
        enqueueManagedSystemProposal(world, proposal);
        queued.push(proposal.name);
        continue;
      }
      await executeProposal(world, systemRegistry, proposal);
      markProposalExecuted(proposal.id);
      executed.push(proposal.name);
      console.log(`[Architect] ✓ Executed: ${proposal.name}`);
    } catch (error) {
      failed.push(proposal.name);
      markProposalFailed(proposal.id, error instanceof Error ? error.message : String(error));
      console.error(`[Architect] ✗ Failed to execute ${proposal.name}:`, error);
    }
  }

  return { executed, failed, queued };
}

// =============================================================================
// ARCHITECT CREATION HELPER
// =============================================================================

/**
 * Create an architect configuration
 */
export function createArchitectConfig(options: {
  canProposeSystems?: boolean;
  canProposeComponents?: boolean;
  canProposeEntities?: boolean;
  canProposeRules?: boolean;
  canExecuteDirectly?: boolean;
  approvalRequired?: "auto" | "superior" | "godai";
  maxProposals?: number;
}): ArchitectConfig {
  return {
    canProposeSystems: options.canProposeSystems ?? true,
    canProposeComponents: options.canProposeComponents ?? true,
    canProposeEntities: options.canProposeEntities ?? true,
    canProposeRules: options.canProposeRules ?? false,
    canExecuteDirectly: options.canExecuteDirectly ?? false,
    proposalApproval: options.approvalRequired ?? "godai",
    maxProposalsPerCycle: options.maxProposals ?? 3,
  };
}

// =============================================================================
// NON-BLOCKING / ASYNC EXECUTION
// =============================================================================

/**
 * Queue system baking as a background task (non-blocking)
 * Returns immediately, baking happens in background
 */
export function queueSystemBaking(
  world: World,
  systemRegistry: SystemRegistry,
  spec: SystemProposalSpec,
  onComplete?: (success: boolean, systemName: string) => void
): string {
  const daemon = getCodingDaemon(world);
  if (daemon) {
    validateManagedProposal(spec);
    return daemon.enqueue({ source: "Architect", instruction: `Implement approved system: ${JSON.stringify(spec)}`, acceptance: spec.acceptance },
      job => onComplete?.(job.status === "active", spec.name)).id;
  }
  // Dynamic import to avoid circular deps
  const taskId = `bake_${spec.name}_${Date.now()}`;

  // We'll need to import the task queue
  import("../runtime/async-task-queue").then(({ queueTask }) => {
    queueTask(
      `Bake: ${spec.name}`,
      async () => {
        const { bakeSystem } = await import("../god/system-baker");

        const bakerDescription = `
System Name: ${spec.name}
Purpose: ${spec.description}
Frequency: ${spec.frequency}ms
Target Components: ${spec.targetComponents.join(", ")}

Logic Description:
${spec.logic}

${spec.triggers?.length ? `Triggers: ${spec.triggers.join(", ")}` : ""}
${spec.effects?.length ? `Effects: ${spec.effects.join(", ")}` : ""}
`.trim();

        const result = await bakeSystem(bakerDescription, world, systemRegistry, 2);

        if (result.success && result.system) {
          result.system.frequency = spec.frequency;
          result.system.active = true;  // Enable the system so runSystems will execute it
          // REGISTER THE BAKED SYSTEM!
          registerSystem(systemRegistry, result.system);
          console.log(`[Architect] ✓ Background bake succeeded and registered: ${spec.name}`);
          return { success: true, system: result.system };
        } else {
          console.log(`[Architect] ✗ Background bake failed: ${spec.name} - ${result.error}`);
          return { success: false, error: result.error };
        }
      },
      {
        priority: "normal",
        onComplete: (result) => {
          if (onComplete) {
            onComplete(result.success, spec.name);
          }
        },
        onError: (error) => {
          console.error(`[Architect] Bake task error for ${spec.name}:`, error);
          if (onComplete) {
            onComplete(false, spec.name);
          }
        },
      }
    );
  });

  return taskId;
}

/**
 * Execute all approved proposals as background tasks (non-blocking)
 * Returns immediately, execution happens in background
 */
export function queueAllApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  onProgress?: (completed: number, total: number, name: string) => void
): void {
  const approved = getApprovedProposals().filter(p => proposalBelongsToWorld(world,p));

  if (approved.length === 0) {
    console.log("[Architect] No approved proposals to execute");
    return;
  }

  console.log(`[Architect] Queueing ${approved.length} proposals for background execution`);

  let completed = 0;
  const total = approved.length;

  for (const proposal of approved) {
    let admission: BuildAdmission | undefined;
    try { admission = proposalAdmission(world, proposal); }
    catch(error) { markProposalFailed(proposal.id,String(error)); completed++; onProgress?.(completed,total,proposal.name); continue; }
    if (proposal.type === "system") {
      if(admission) {
        try {
          enqueueManagedSystemProposal(world,proposal,()=>{
            completed++; onProgress?.(completed,total,proposal.name);
          });
        } catch(error) { markProposalFailed(proposal.id,String(error)); completed++; onProgress?.(completed,total,proposal.name); }
        continue;
      }
      proposal.status = "building";
      try {
      queueSystemBaking(
        world,
        systemRegistry,
        proposal.specification as SystemProposalSpec,
        (success, name) => {
          completed++;
          if (success) markProposalExecuted(proposal.id);
          else markProposalFailed(proposal.id, "Background system build failed; no activation receipt");
          if (onProgress) {
            onProgress(completed, total, name);
          }
        }
      );
      } catch (error) { markProposalFailed(proposal.id, String(error)); completed++; onProgress?.(completed, total, proposal.name); }
    } else {
      // Non-system proposals can be executed synchronously (they're fast)
      try {
        if (proposal.type === "component") {
          executeComponentProposal(world, proposal.specification as ComponentProposalSpec);
        } else if (proposal.type === "entity") {
          executeEntityProposal(world, proposal.specification as EntityProposalSpec, proposalAdmissions.get(proposal)?.nativeCurrent ?? admission?.current, proposalAdmissions.get(proposal)?.supportRequirements, proposalAdmissions.get(proposal)?.actorReferences);
        } else throw new Error(`Unsupported background proposal type ${proposal.type}`);
        markProposalExecuted(proposal.id);
        completed++;
        if (onProgress) {
          onProgress(completed, total, proposal.name);
        }
      } catch (error) {
        markProposalFailed(proposal.id, String(error));
        console.error(`[Architect] Failed to execute ${proposal.name}:`, error);
      }
    }
  }
}

// =============================================================================
// SPECIFIC ARCHITECT TYPES
// =============================================================================

/**
 * Pre-defined architect configurations for common use cases
 */
export const ARCHITECT_PRESETS = {
  questArchitect: {
    name: "The Questmaster",
    domain: "narrative" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeEntities: true,
      canProposeRules: true,
      approvalRequired: "superior",
    }),
    customPrompt: `You specialize in creating QUESTS - objectives that give agents purpose.
Consider: quest givers, quest objectives, rewards, story hooks.`,
  },

  weatherArchitect: {
    name: "Zephyros",
    domain: "ecology" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in WEATHER and ENVIRONMENT systems.
Consider: temperature, precipitation, seasons, natural disasters.`,
  },

  economyArchitect: {
    name: "The Merchant Prince",
    domain: "economy" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeEntities: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in ECONOMY and TRADE systems.
Consider: currency, markets, supply/demand, crafting, professions.`,
  },

  combatArchitect: {
    name: "The Warlord",
    domain: "social" as const,  // Combat is social conflict
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeRules: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in COMBAT and CONFLICT systems.
Consider: weapons, armor, damage types, combat maneuvers, victory conditions.`,
  },
};
