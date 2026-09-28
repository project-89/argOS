/**
 * World Evolution Coordinator
 *
 * Owns the specialist half of the spirit hierarchy. Generic spirit cognition
 * observes and communicates; this coordinator turns those observations into
 * entities, components, systems, repairs, and deterministic rules.
 *
 * It is deliberately tick-driven and single-flight. The fast ECS loop may
 * continue while this runs, but two evolution transactions never overlap.
 */
import type { World } from "../ecs/world";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import type { GodAgentState } from "../god/god-agent";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import type { DynamicSpiritState, SpiritProposal } from "../spirits/spirit-factory";
import { runWorldCrafterCycle } from "../spirits/world-crafter-spirit";
import { runStewardCycle } from "../spirits/steward-spirit";
import { runArchitectCognition, executeAllApprovedProposals, getCurrentObservedProposals } from "../spirits/architect-spirit";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { runLawgiverCycle } from "../spirits/rules-spirit";
import {
  approveProposal,
  getApprovedProposals,
  getPendingProposals,
  getSpiritsByType,
} from "../spirits/spirit-factory";
import { fixAllQueuedSystems, getSystemsNeedingFix } from "../systems/system-loader";
import { assertSimulationTaskActive } from "./task-scope";

export interface EvolutionCoordinatorConfig {
  enabled: boolean;
  /** Cadences are logical ECS ticks, not wall-clock milliseconds. */
  crafterInterval: number;
  stewardInterval: number;
  architectInterval: number;
  artificerInterval: number;
  lawgiverInterval: number;
  proposalInterval: number;
  fileRepairInterval: number;
  maxProposalExecutions: number;
  autoApproveProposals: boolean;
  /** A host may grant only specific existing specialist stages. Omitted preserves legacy behavior. */
  enabledStages?: EvolutionStage[];
  /** Lifetime attempts, including failed attempts; not a retry budget that resets each tick. */
  stageRunLimits?: Partial<Record<EvolutionStage, number>>;
  /** Explicit names must also belong to this world's registry, never the global factory alone. */
  architectNames?: string[];
  /** Restricts the executor too, not merely what this profile asks designers to propose. */
  allowedProposalTypes?: SpiritProposal["type"][];
  requireObservedProposals?: boolean;
}

export interface EvolutionCoordinatorStatus {
  enabled: boolean;
  running: boolean;
  cycles: number;
  lastCycleTick: number;
  lastRunTick: Record<EvolutionStage, number>;
  stageRuns: Record<EvolutionStage, number>;
  totals: {
    entitiesCreated: number;
    roomsPopulated: number;
    proposalsCreated: number;
    proposalsApproved: number;
    proposalsExecuted: number;
    proposalFailures: number;
    componentsCreated: number;
    systemsCreated: number;
    systemsRepaired: number;
    rulesProposed: number;
    rulesApproved: number;
  };
  recentErrors: Array<{ tick: number; stage: EvolutionStage; error: string }>;
}

export type EvolutionStage =
  | "crafter"
  | "steward"
  | "architect"
  | "proposals"
  | "artificer"
  | "lawgiver"
  | "file-repair";

export interface EvolutionCoordinatorContext {
  world: World;
  god: GodAgentState;
  spirits: SpiritRegistry;
}

interface EvolutionDependencies {
  runCrafter: typeof runWorldCrafterCycle;
  runSteward: typeof runStewardCycle;
  runArchitect: typeof runArchitectCognition;
  runArtificer: typeof runArtificerWithTools;
  runLawgiver: typeof runLawgiverCycle;
  executeProposals: typeof executeAllApprovedProposals;
  getPendingProposals: typeof getPendingProposals;
  getApprovedProposals: typeof getApprovedProposals;
  getCurrentObservedProposals: typeof getCurrentObservedProposals;
  approveProposal: typeof approveProposal;
  getSpiritsByType: typeof getSpiritsByType;
  getSystemsNeedingFix: typeof getSystemsNeedingFix;
  fixAllQueuedSystems: typeof fixAllQueuedSystems;
}

const DEFAULT_CONFIG: EvolutionCoordinatorConfig = {
  enabled: true,
  crafterInterval: 2,
  stewardInterval: 5,
  architectInterval: 30,
  artificerInterval: 30,
  lawgiverInterval: 30,
  proposalInterval: 5,
  fileRepairInterval: 10,
  maxProposalExecutions: 3,
  autoApproveProposals: true,
};

const DEFAULT_DEPENDENCIES: EvolutionDependencies = {
  runCrafter: runWorldCrafterCycle,
  runSteward: runStewardCycle,
  runArchitect: runArchitectCognition,
  runArtificer: runArtificerWithTools,
  runLawgiver: runLawgiverCycle,
  executeProposals: executeAllApprovedProposals,
  getPendingProposals,
  getApprovedProposals,
  getCurrentObservedProposals,
  approveProposal,
  getSpiritsByType,
  getSystemsNeedingFix,
  fixAllQueuedSystems,
};

const STAGES: EvolutionStage[] = [
  "crafter",
  "steward",
  "architect",
  "proposals",
  "artificer",
  "lawgiver",
  "file-repair",
];

function initialLastRunTick(): Record<EvolutionStage, number> {
  return Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<EvolutionStage, number>;
}

export class EvolutionCoordinator {
  readonly config: EvolutionCoordinatorConfig;
  private readonly deps: EvolutionDependencies;
  private readonly state: EvolutionCoordinatorStatus;

  constructor(
    config: Partial<EvolutionCoordinatorConfig> = {},
    dependencies: Partial<EvolutionDependencies> = {},
  ) {
    this.config = structuredClone({ ...DEFAULT_CONFIG, ...config });
    for (const [stage, limit] of Object.entries(this.config.stageRunLimits ?? {})) {
      if (!STAGES.includes(stage as EvolutionStage) || !Number.isSafeInteger(limit) || limit < 0) throw Error("Invalid evolution stage budget");
    }
    if (this.config.enabledStages?.some(stage => !STAGES.includes(stage))) throw Error("Unknown evolution stage");
    this.deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    this.state = {
      enabled: this.config.enabled,
      running: false,
      cycles: 0,
      lastCycleTick: 0,
      lastRunTick: initialLastRunTick(),
      stageRuns: initialLastRunTick(),
      totals: {
        entitiesCreated: 0,
        roomsPopulated: 0,
        proposalsCreated: 0,
        proposalsApproved: 0,
        proposalsExecuted: 0,
        proposalFailures: 0,
        componentsCreated: 0,
        systemsCreated: 0,
        systemsRepaired: 0,
        rulesProposed: 0,
        rulesApproved: 0,
      },
      recentErrors: [],
    };
  }

  getStatus(): EvolutionCoordinatorStatus {
    return structuredClone(this.state);
  }

  async run(tick: number, context: EvolutionCoordinatorContext): Promise<EvolutionCoordinatorStatus> {
    if (!this.config.enabled || this.state.running) return this.getStatus();
    assertSimulationTaskActive();

    this.state.running = true;
    this.state.lastCycleTick = tick;
    this.state.cycles++;

    try {
      await this.runStage("crafter", tick, this.config.crafterInterval, async () => {
        const result = await this.deps.runCrafter(context.world, context.spirits, context.god);
        assertSimulationTaskActive();
        this.state.totals.entitiesCreated += result.entitiesCreated;
      });

      await this.runStage("steward", tick, this.config.stewardInterval, async () => {
        const result = await this.deps.runSteward(context.world, context.spirits);
        assertSimulationTaskActive();
        this.state.totals.roomsPopulated += result.roomsPopulated;
        this.state.totals.entitiesCreated += result.entitiesGenerated;
      });

      await this.runStage("architect", tick, this.config.architectInterval, async () => {
        // The Crafter retains its historical type but now owns failure
        // observations, not automatic provisioning. Active architects read
        // that shared channel; a second design loop would duplicate their work.
        const architects = this.deps.getSpiritsByType("architect")
          // A host may name the Crafter explicitly to give it a design lens.
          .filter((spirit) => spirit.definition.name !== "The Crafter" || this.config.architectNames?.includes("The Crafter") === true)
          .filter(spirit => !this.config.architectNames || this.config.architectNames.includes(spirit.definition.name)
            && context.spirits.spirits.get(spirit.eid) === spirit
            // A host-deactivated spirit does not design, even when named.
            && getDynamicComponentValues("Spirit", spirit.eid)?.active !== 0);
        for (const architect of architects) {
          // The coordinator's explicit God-review policy must also govern
          // submission. Legacy architects otherwise auto-approve and execute
          // inside runArchitect, before our proposals stage can inspect them.
          if (!this.config.autoApproveProposals && architect.architectConfig) {
            architect.architectConfig.proposalApproval = "godai";
            architect.architectConfig.canExecuteDirectly = false;
          }
          const proposals = await this.deps.runArchitect(
            context.world,
            context.god.systemRegistry,
            context.spirits,
            architect,
          );
          assertSimulationTaskActive();
          this.state.totals.proposalsCreated += proposals.length;
        }
      });

      await this.runStage("proposals", tick, this.config.proposalInterval, async () => {
        const observed = this.config.requireObservedProposals ? new Set(this.deps.getCurrentObservedProposals(context.world)) : undefined;
        const allowed = (proposal: SpiritProposal) => (!observed || observed.has(proposal))
          && (!this.config.allowedProposalTypes || this.config.allowedProposalTypes.includes(proposal.type));
        if (this.config.autoApproveProposals) {
          const safeTypes = new Set<SpiritProposal["type"]>(["system", "component", "entity"]);
          for (const proposal of this.deps.getPendingProposals()) {
            if (!safeTypes.has(proposal.type) || !allowed(proposal)) continue;
            if (this.deps.approveProposal(proposal.id, context.god.eid)) {
              this.state.totals.proposalsApproved++;
            }
          }
        }

        const approved = this.deps.getApprovedProposals().filter(allowed).slice(0, this.config.maxProposalExecutions);
        if (approved.length === 0) return;
        const result = await this.deps.executeProposals(context.world, context.god.systemRegistry, {
          maxProposals: this.config.maxProposalExecutions,
          ...(this.config.requireObservedProposals ? { requireObserved: true } : {}),
          ...(this.config.allowedProposalTypes ? { allowedTypes: this.config.allowedProposalTypes } : {}),
        });
        assertSimulationTaskActive();
        this.state.totals.proposalsExecuted += result.executed.length;
        this.state.totals.proposalFailures += result.failed.length;

        // Keep generation visible without coupling the monitor to registry
        // implementation details. Execution reports names; the approved batch
        // supplies their concrete world-shaping types.
        const executedNames = new Set(result.executed);
        for (const proposal of approved) {
          if (!executedNames.has(proposal.name)) continue;
          if (proposal.type === "system") this.state.totals.systemsCreated++;
          if (proposal.type === "component") this.state.totals.componentsCreated++;
          if (proposal.type === "entity") this.state.totals.entitiesCreated++;
        }
      });

      await this.runStage("artificer", tick, this.config.artificerInterval, async () => {
        const artificers = this.deps.getSpiritsByType("artificer");
        for (const artificer of artificers) {
          // Factory discovery is global. Only this registry's exact active
          // instance may review its world, rechecked after each awaited review.
          if (context.spirits.spirits.get(artificer.eid) !== artificer
            || getDynamicComponentValues("Spirit", artificer.eid)?.active !== 1) continue;
          const report = await this.deps.runArtificer(
            context.world,
            context.god.systemRegistry,
            context.spirits,
            artificer,
          );
          assertSimulationTaskActive();
          this.state.totals.systemsRepaired += report.repairsAttempted.filter((repair) => repair.success).length;
        }
      });

      await this.runStage("lawgiver", tick, this.config.lawgiverInterval, async () => {
        const result = await this.deps.runLawgiver(context.spirits);
        assertSimulationTaskActive();
        this.state.totals.rulesProposed += result.rulesProposed;
        this.state.totals.rulesApproved += result.rulesApproved;
      });

      await this.runStage("file-repair", tick, this.config.fileRepairInterval, async () => {
        if (this.deps.getSystemsNeedingFix(context.world).length === 0) return;
        const result = await this.deps.fixAllQueuedSystems(context.god.fileSystems,{world:context.world});
        assertSimulationTaskActive();
        this.state.totals.systemsRepaired += result.fixed.length;
        this.state.totals.proposalFailures += result.failed.length;
      });
    } finally {
      this.state.running = false;
    }

    return this.getStatus();
  }

  private async runStage(
    stage: EvolutionStage,
    tick: number,
    interval: number,
    execute: () => Promise<void>,
  ): Promise<void> {
    if (this.config.enabledStages && !this.config.enabledStages.includes(stage)) return;
    const limit = this.config.stageRunLimits?.[stage];
    if (limit !== undefined && this.state.stageRuns[stage] >= limit) return;
    if (tick - this.state.lastRunTick[stage] < Math.max(1, interval)) return;
    assertSimulationTaskActive();
    this.state.lastRunTick[stage] = tick;
    this.state.stageRuns[stage]++;

    try {
      await execute();
      assertSimulationTaskActive();
    } catch (error) {
      // A task timeout/stop is a lifecycle boundary, not a recoverable stage
      // failure. Propagate it so no later world-mutating stages run after stop;
      // run()'s finally still releases the coordinator's single-flight guard.
      assertSimulationTaskActive();
      const message = error instanceof Error ? error.message : String(error);
      this.state.recentErrors.push({ tick, stage, error: message });
      if (this.state.recentErrors.length > 20) this.state.recentErrors.shift();
      console.error(`[Evolution] ${stage} failed at tick ${tick}:`, error);
    }
  }
}

export function createEvolutionCoordinator(
  config: Partial<EvolutionCoordinatorConfig> = {},
  dependencies: Partial<EvolutionDependencies> = {},
): EvolutionCoordinator {
  return new EvolutionCoordinator(config, dependencies);
}
