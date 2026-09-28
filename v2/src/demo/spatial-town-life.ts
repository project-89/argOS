/** Host grants for the existing spirit hierarchy, not another world controller.
 * Cognition proposes, God reviews, native construction/weather commit effects. */
import type { ArgosSimulation } from "../index";
import type { EvolutionCoordinatorConfig } from "../runtime/evolution-coordinator";
import { getSpiritSystemState, setGlobalContext } from "../spirits/spirit-system";
import { deactivateSpirit } from "../spirits/spirit-registry";
import { getFactoryState, type DynamicSpiritState } from "../spirits/spirit-factory";
import { getObservedProposalDiagnostics } from "../spirits/architect-spirit";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { readSimulationTime } from "../ecs/simulation-time";
import { createSpatialTownGrowth } from "./spatial-town-growth";
import { createSpatialWeather } from "./spatial-weather";
import type { SpatialTownLifeView, SpatialWeatherView } from "./spatial-contract";
import { STORY_TOWN_STYLE, STORY_TOWN_NARRATOR_PROMPT } from "./spatial-town-story";
import { LOVECRAFT_TOWN_STYLE, LOVECRAFT_TOWN_NARRATOR_PROMPT } from "./spatial-lovecraft-town";
import { HOUSEHOLD_STORY_STYLE } from "./spatial-household";
import { HOUSEHOLD_CHALLENGE_STORY_STYLE } from "./spatial-household-challenge";
import type { createSpatialStoryEvents, SpatialStoryReceipt } from "./spatial-story-events";
import { getSpiritPublicEventReviewStatus, recordSpiritPublicEnvironmentReceipt } from "../spirits/spirit-public-event-review";
import type { SpatialWeatherMechanicReceipt } from "./spatial-weather-mechanic";
import { SPATIAL_DEVELOPMENT_BUILDER_CONTEXT } from "./spatial-development-policy";
import { createArtificerConfig } from "../spirits/artificer-spirit";

export const TOWN_EVOLUTION_CONFIG: Partial<EvolutionCoordinatorConfig> = {
  enabledStages: ["architect", "proposals"], stageRunLimits: { architect: 4 },
  architectNames: ["The Weaver"], architectInterval: 600, proposalInterval: 50,
  autoApproveProposals: false, maxProposalExecutions: 1,
  requireObservedProposals: true, allowedProposalTypes: ["entity"],
};
export const DEVELOPMENT_EVOLUTION_CONFIG: Partial<EvolutionCoordinatorConfig> = {
  enabledStages: ["architect", "proposals", "artificer"],
  stageRunLimits: { architect: 60, artificer: 30 },
  architectNames: ["The Weaver"], architectInterval: 300, artificerInterval: 600, proposalInterval: 50,
  autoApproveProposals: false, maxProposalExecutions: 1,
  requireObservedProposals: true, allowedProposalTypes: ["entity", "system"],
};

export function createSpatialTownLife(options: {
  sim: ArgosSimulation; live: boolean; running: () => boolean;
  outdoorRooms: Array<{ id: number; key: string }>;
  growth: ReturnType<typeof createSpatialTownGrowth>;
  story?: "community-drama" | "household" | "coastal-mystery"; storyEvents?: ReturnType<typeof createSpatialStoryEvents>;
  householdChallenge?: boolean;
  growthSiteCount?: number;
  reviewMechanics?: boolean;
  development?: boolean;
  mechanicStatus?(): NonNullable<SpatialTownLifeView["mechanic"]>;
}) {
  const { sim, growth } = options, world = sim.world;
  const style = options.story === "household" ? options.householdChallenge ? HOUSEHOLD_CHALLENGE_STORY_STYLE : HOUSEHOLD_STORY_STYLE
    : options.story === "coastal-mystery" ? LOVECRAFT_TOWN_STYLE : STORY_TOWN_STYLE;
  const changes: SpatialTownLifeView["changes"] = [], seen = new Set<string>();
  let closed = false;
  const record = (id: string, atSimMs: number, spirit: string, status: SpatialTownLifeView["changes"][number]["status"], summary: string) => {
    if (seen.has(id)) return;
    seen.add(id); if (seen.size > 512) seen.delete(seen.values().next().value!);
    changes.push({ id, atSimMs, spirit, status, summary: summary.slice(0, 600) });
    if (changes.length > 64) changes.shift();
  };
  const weather = createSpatialWeather({ world, outdoorRooms: options.outdoorRooms, running: options.running,
    ...(options.development ? { limits: { maxChanges: 24, cooldownMs: 30_000 } } : {}),
    ...(options.story === "coastal-mystery" ? { initialCondition: "cloudy" as const } : {}),
    record: r => {
      const id = `weather:${r.roomId}:${r.revision}`;
      record(id, r.atSimMs, r.origin === "operator" ? "God · operator request" : "The Narrator", "applied", r.detail);
      recordSpiritPublicEnvironmentReceipt(world, { id, atSimMs: r.atSimMs, roomId: r.roomId, detail: r.detail });
    } });
  const state = getSpiritSystemState(world), active = new Set(["The Watcher", "The Narrator", "The Arbiter", "The Weaver"]);
  if (options.development) active.add("The Tinker");
  if (state) {
    for (const spirit of state.registry.spirits.values()) {
      // Definitions may originate in shared templates. Never mutate another world.
      spirit.definition = structuredClone(spirit.definition);
      if (!active.has(spirit.definition.name)) { deactivateSpirit(state.registry, spirit.eid); continue; }
      spirit.definition.canCreateEntities = false; spirit.definition.canBakeSystems = false;
      spirit.definition.canModifyMood = false;
      if (options.development && spirit.definition.name === "The Tinker") {
        // Maintenance has one owner too. Existing native systems cannot be
        // modified or disabled by development requests.
        spirit.definition.observationInterval = Number.MAX_SAFE_INTEGER;
        (spirit as DynamicSpiritState).artificerConfig = createArtificerConfig({
          ignoreSystems: [...sim.god.systemRegistry.systems.values()].filter(system => !system.managedRelease).map(system => system.name) });
        continue;
      }
      if (spirit.definition.name === "The Weaver") {
        // One design owner: EvolutionCoordinator. The generic spirit loop must not duplicate it.
        spirit.definition.observationInterval = Number.MAX_SAFE_INTEGER;
        (spirit as DynamicSpiritState).architectConfig = { canProposeSystems: options.reviewMechanics === true, canProposeComponents: false,
          canProposeEntities: true, canProposeRules: false, canExecuteDirectly: false,
          proposalApproval: "godai", maxProposalsPerCycle: 1 };
      } else {
        spirit.definition.observationInterval = spirit.definition.name === "The Watcher" ? 10_000
          : spirit.definition.name === "The Narrator" ? options.story ? 25_000 : 45_000 : 90_000;
        if (spirit.definition.name === "The Narrator") {
          if (options.story) spirit.definition.systemPrompt = options.story === "coastal-mystery" ? LOVECRAFT_TOWN_NARRATOR_PROMPT : STORY_TOWN_NARRATOR_PROMPT;
          weather.registerNarrator(state.registry, spirit, options.storyEvents);
        }
      }
    }
    const context = options.story ? `${style.narratorContext}\n${style.premise}\nThis is a physically embodied world. Public committed outcomes, not narrative interpretations, establish what happened. The Narrator may introduce prospective complications only through its native grants; residents independently decide what to do. The Weaver proposes catalog furnishings for evidenced needs and God reviews them. Do not replenish consumed food or undo operator changes. Private recollections do not become other residents' knowledge.${options.storyEvents ? " Native branch damage stays within the existing tree footprint; it does not block routes." : ""}`
      : "This is a physically embodied town, not a scripted episode. Watch actual public activity and consequences. Quiet periods and useful repetition are legitimate. Offer grounded opportunities or optional suggestions, not completed actions or compulsory emotions. Weather changes require the granted native world_effect. Buildings, inventory and characters cannot be created by narrative prose. The Weaver proposes catalog furnishings for a current evidenced need; God reviews them. Do not replenish consumed food or undo an operator's changes. No quota of drama or construction is required.";
    setGlobalContext(context + (options.development ? ` The host has enabled broader world development: the Weaver can design grounded deterministic mechanics, God can approve them, and the coding daemons build/test/load them. The Tinker reviews and repairs managed systems. ${SPATIAL_DEVELOPMENT_BUILDER_CONTEXT}` : options.reviewMechanics ? " The operator has separately authorized one bounded wetting/drying build on existing residents and furniture. Its confirmed physical outcomes may inform the Weaver's grounded mechanic proposals, but additional systems remain review-only in this session. A proposed mechanism is not an installed mechanism." : ""), world);
  }
  const narrator = state && [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator");
  function collect() {
    const review = narrator && getSpiritPublicEventReviewStatus(world, narrator);
    if (review) record(`narrator-review:${review.atSimMs}:${review.observedThroughSequence}`, review.atSimMs, "The Narrator", review.accepted ? "observed" : "failed",
      `${review.accepted ? "Reviewed" : "Review did not complete:"} ${review.receiptIdsObserved.length} public receipts; ${review.interventionsRequested} interventions requested${review.interventionResults.length ? ` (${review.interventionResults.join(", ")})` : ""}.${review.phase ? ` Story interpretation: ${review.phase}.` : ""}${review.droppedBeforeWindow || review.omittedRecords ? " Some older events were omitted from the bounded review." : ""}`);
    for (const entry of getArchitectDiagnostics(world).entries) {
      if (entry.stage === "needs" && entry.outcome === "completed") record(`review:${entry.sequence}`, entry.atSimMs, "The Weaver", "observed",
        `Reviewed current needs: ${entry.candidates ?? 0} suggestions, ${entry.admitted ?? 0} admitted for design. This is not construction.`);
      else if (entry.outcome === "failed" || entry.outcome === "rejected") record(`review:${entry.sequence}`, entry.atSimMs, "The Weaver",
        entry.outcome === "failed" ? "failed" : "rejected", `${entry.stage}: ${entry.detail ?? entry.reason ?? "review did not complete"}`);
    }
    for (const diagnostic of getObservedProposalDiagnostics(world)) {
      const proposal = getFactoryState().pendingProposals.find(p => p.id === diagnostic.id);
      if (!proposal) continue;
      const status = diagnostic.status === "pending" ? "proposed" : diagnostic.status === "approved" ? "approved"
        : diagnostic.status === "rejected" ? "rejected" : diagnostic.status === "failed" ? "failed" : undefined;
      if (status) record(`proposal:${proposal.id}:${status}`, readSimulationTime(world), proposal.fromSpiritName, status,
        `${proposal.name}: ${proposal.description}${proposal.rejectionReason ? ` · ${proposal.rejectionReason}` : ""}`);
    }
    const inspection = growth.inspect();
    for (const build of inspection.builds) {
      if (build.status === "built" || build.status === "failed") record(`build:${build.siteId}:${build.status}`, build.atSimMs,
        "The Weaver", build.status === "built" ? "applied" : "failed", `${build.name}${build.error ? ` · ${build.error}` : " · Native object, collision and interaction points registered."}`);
      // Approaching or inspecting a prop is not evidence its purpose was served.
      // In this first catalog, only a native occupied chair has an unambiguous
      // consummatory effect; retain other outcomes without claiming usefulness.
      for (const use of build.feedback) record(`use:${use.eventId}`, use.atSimMs, "Residents", use.seated && use.action === "interact" ? "used" : "observed",
        `${build.name} · committed ${use.action}${use.seated && use.action === "interact" ? "; native seated state confirmed" : "; approach or inspection, not demonstrated use"}.`);
    }
    return inspection;
  }
  function weatherView(): SpatialWeatherView {
    const view = weather.view(), conditions = view.rooms.map(r => r.condition);
    return { condition: conditions.includes("rain") ? "rain" : conditions.includes("cloudy") ? "cloudy" : "clear",
      revision: view.rooms.reduce((sum, room) => sum + room.revision, 0),
      changedAtSimMs: Math.max(0, ...view.rooms.map(r => weather.component.changedAtSimMs[r.id])),
      rooms: view.rooms.map(r => ({ roomId: r.id, condition: r.condition })) };
  }
  function view(): SpatialTownLifeView {
    const inspection = collect(), evolution = sim.getEvolutionStatus(), enabled = options.live && !!state;
    const review = narrator && getSpiritPublicEventReviewStatus(world, narrator);
    return { enabled, summary: closed ? "Session ended · outcomes retained" : enabled
      ? "Spirits observe · God reviews · native changes · residents choose" : "Manual verification · autonomous spirits disabled",
      weather: weatherView(), spirits: [
        { name: "The Watcher", status: enabled ? "Observes public activity and needs" : "Offline" },
        { name: "The Arbiter", status: enabled ? "Checks consistency; cannot replace missing props" : "Offline" },
        { name: "The Narrator", status: enabled ? `${options.story ? style.name : "Optional suggestions"} · ${weather.view().remainingChanges} weather changes left${options.storyEvents ? ` · ${options.storyEvents.view().remainingEvents} branch events left` : ""}` : "Offline" },
        { name: "The Weaver", status: enabled ? `${Math.max(0, (options.development ? 60 : options.story ? 10 : 4) - evolution.stageRuns.architect)} design reviews left · ${options.development ? "mechanics and furnishings" : "furnishings"} · God approval required` : "Offline" },
        ...(options.development ? [{ name: "The Tinker", status: enabled ? "Managed-system inspection and tested repairs" : "Offline" }] : []),
      ].map(row => closed ? { ...row, status: "Stopped" } : row), changes: structuredClone(changes),
      ...(options.story ? { story: { style: style.name, premise: style.premise,
        remainingEvents: options.storyEvents?.view().remainingEvents ?? 0,
        ...(review ? { lastReviewAtSimMs: review.atSimMs, observedEvents: review.receiptIdsObserved.length,
          interventions: review.interventionsRequested, phase: review.phase, tension: review.tension } : {}) } } : {}),
      ...(options.mechanicStatus ? { mechanic: options.mechanicStatus() } : {}),
      growth: { remaining: Math.max(0, Math.min(4, options.growthSiteCount ?? 4) - inspection.attempts), summary: options.development
        ? "God/operator-directed development · eight shared code jobs including repairs · new scalar mechanics may execute. Four validated furnishing sites. New rooms, models and actions still need native adapters."
        : options.story === "household"
        ? options.reviewMechanics
          ? "One indoor chair site · needs evidence and God approval. One approved wetting/drying build; further mechanics review-only. No additional food, rooms or residents."
          : "One indoor chair site · needs evidence and God approval. No additional food, rooms, residents or systems."
        : options.reviewMechanics
        ? "Four furnishing attempts. Further mechanics may be proposed for review; only the operator-approved wetness build may execute."
        : "Four furnishing attempts · chairs, tables, plants, lamps. Houses, food production and new systems remain gated." } };
  }
  // Read-only operator evidence, not another mutation or NPC knowledge path.
  return { weather, view, weatherView, inspectGrowth: () => growth.inspect(),
    recordMechanicReceipt(receipt: SpatialWeatherMechanicReceipt) {
      record(receipt.id, receipt.atSimMs, "Generated weather system", "applied", receipt.detail);
      recordSpiritPublicEnvironmentReceipt(world, { id: receipt.id, atSimMs: receipt.atSimMs, roomId: receipt.roomId, detail: receipt.detail });
    },
    recordStoryReceipt(receipt: SpatialStoryReceipt) {
      const id = `story:${receipt.treeId}:${receipt.revision}:${receipt.operation}`;
      const detail = receipt.operation === "tree_cleared" ? receipt.detail.replace(/^You cleared/, "A resident cleared") : receipt.detail;
      record(id, receipt.atSimMs,
        receipt.operation === "tree_damage" ? receipt.origin === "operator" ? "God · operator test" : "The Narrator" : "Residents",
        receipt.status === "applied" ? "applied" : "rejected", detail);
      if (receipt.status === "applied") recordSpiritPublicEnvironmentReceipt(world, { id, atSimMs: receipt.atSimMs, roomId: receipt.roomId, detail });
    },
    close() { if (closed) return; collect(); closed = true; options.storyEvents?.close(); weather.close(); growth.dispose(); } };
}
