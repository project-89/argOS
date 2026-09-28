/**
 * Simulation Chronicle — Structured Event Log for Eval
 *
 * Captures the meaningful events during a simulation run:
 *   - World creation: rooms, agents, objects, affordances, components
 *   - Spirit evolution: new systems, affordances, traits created on the fly
 *   - Agent learning: BT branches compiled, skills learned, trees growing
 *   - Problem solving: novel situations handled, failures recovered from
 *   - Social dynamics: conversations, impressions, relationship changes
 *   - World mutation: entities spawned/destroyed by agent actions
 *
 * NOT captured: individual LLM prompts, raw ECS state, tick-by-tick actions.
 * The chronicle is a SUMMARY of emergence, not a replay log.
 *
 * Usage:
 *   chronicle.record("bt_compiled", { agent: "Aldric", branch: "forge_weapon", treeSize: 15 })
 *   chronicle.snapshot()  // periodic state snapshot
 *   chronicle.save("./data/chronicles/run-001.json")
 */

import * as fs from "node:fs";
import { OperationalEvidenceTail, estimateEvidenceBytes, type EvidenceLimits, type EvidenceCoverage } from "../runtime/operational-evidence";

// =============================================================================
// TYPES
// =============================================================================

export type ChronicleEventType =
  | "foreground_attempt_started" // Numeric full-attempt boundary, not actor memory
  | "foreground_attempt_finished"
  | "foreground_provider_result" // Operator timing/counts only; not an admitted decision
  | "mental_update_discarded" // stale mental envelope omitted while its independent body command proceeds
  // World creation
  | "world_seed"
  | "room_created"
  | "agent_created"
  | "object_created"
  | "affordance_created"
  | "component_created"
  | "trait_created"
  | "relationship_created"
  // Spirit evolution
  | "system_baked"
  | "system_failed"
  | "spirit_proposal"
  | "narrative_nudge_lifecycle" // Private transport metadata only, not public evidence or causal attribution
  | "narrator_prose" // Narrator's story feed for viewers/recordings; never resident perception
  | "daemon_inner_voice" // A daemon whisper was delivered; transport metadata only, never the whisper text
  | "gap_detected"
  | "affordance_evolved"     // spirit created a new affordance
  // Agent learning
  | "bt_compiled"            // LLM decision → BT branch
  | "skill_learned"          // multi-step sequence → named skill
  | "memory_branch"          // memory → reactive branch
  | "affordance_discovered"  // new affordance → exploration branch
  | "tree_grew"              // periodic tree size snapshot
  | "policy_generated"       // LLM generated a behavior policy
  | "policy_evolved"         // Watcher triggered policy evolution
  | "goal_skill_compiled"    // goal completion → skill
  | "autonomous_goal"        // agent set own goal autonomously
  | "personal_review_result" // Structural outcome only; no private review text
  | "intention_review_requested" // Maintenance pause, not abandonment; structural owner/source evidence only
  | "goal_completed"        // objective proof or explicitly subjective social review
  // Agent behavior
  | "llm_decision"           // LLM made a decision (with reasoning)
  | "cognition_integrated"   // Historical interpretation/intent, not an execution
  | "motor_plan_admitted"    // Short chosen physical prefix, not completion
  | "heard_appraisal_selected" // Actor-selected, actually heard evidence
  | "activity_review" // Actor reviews completed contributions and its next intended effect
  | "plan_decision_review" // Private selection/defer/decline; never proof of execution
  | "plan_decision_detached" // Independent chosen goal; mismatched optional plan unchanged
  | "next_purpose_review" // Explicit future-purpose choice/take/cancel, never action execution
  | "goal_handoff_review" // Metadata-only queued review/coalesced relinquishment, never action or success proof
  | "continuation_waiting"   // Integrated purpose awaiting its speaking turn
  | "continuation_revised"   // Pending wording retired; purpose retained
  | "continuation_resumed"   // Exact pending proposal sent back to execution checks
  | "decision_superseded"    // stale reply reconsidered; not an executed action
  | "speech_deferred"        // conversational floor unavailable; no script queued
  | "decision_rejected"      // invalid/cancelled/failed model proposal; never an executed wait
  | "policy_decision"        // BT handled a decision (no LLM)
  | "contract_decision"      // A chosen goal supplied a deterministic primitive, not an execution
  | "action_success"         // affordance executed successfully
  | "action_pending"         // accepted asynchronous work, not completed evidence
  | "action_failure"         // affordance failed
  | "world_mutation"         // entity spawned/destroyed by agent action
  // Social
  | "conversation"           // agent spoke to another
  | "impression_changed"     // agent's impression of another changed
  | "memory_formed"          // important memory created
  // Simulation state
  | "phase_change"           // simulation phase changed
  | "snapshot"               // periodic state snapshot
  | "crisis_event"           // god/test injected a crisis
  | "stimulus_injected";     // perception injected into agents

export interface ChronicleEntry {
  /** Monotonic event index */
  id: number;
  /** Event type */
  type: ChronicleEventType;
  /** Simulation tick when this happened */
  tick: number;
  /** Wall clock time */
  timestamp: number;
  /** Brief human-readable description */
  summary: string;
  /** Structured data for analysis */
  data: Record<string, any>;
}

export interface ChronicleSnapshot {
  tick: number;
  timestamp: number;
  agents: Array<{
    name: string;
    role: string;
    room: string;
    treeSize: number;
    compiledBranches: number;
    llmCallsTotal: number;
    policyCallsTotal: number;
    skillCount: number;
    memoryBranchCount: number;
  }>;
  worldStats: {
    rooms: number;
    entities: number;
    affordances: number;
    components: number;
    systems: number;
    skills: number;
  };
}

// =============================================================================
// CHRONICLE
// =============================================================================

export type ChronicleListener = (entry: ChronicleEntry) => void;

export interface ChronicleRetentionOptions {
  entries?: EvidenceLimits;
  snapshots?: EvidenceLimits;
}
export interface ChronicleCoverage {
  /** Existing producers share this singleton. This is NOT per-world isolation. */
  scope: "process-global";
  epoch: number;
  events: EvidenceCoverage;
  snapshots: EvidenceCoverage;
  listenerFailures: number;
  archiveListenerFailures: number;
  /** Counts cover the epoch; detailed report curves/moments cover retained tails. */
  countsScope: "epoch-total";
  detailsScope: "retained-tail";
}
export type ChronicleArchiveRecord =
  | { kind: "entry"; epoch: number; entry: ChronicleEntry }
  | { kind: "snapshot"; epoch: number; snapshot: ChronicleSnapshot }
  | { kind: "reset"; epoch: number; previousCoverage: ChronicleCoverage };

/** Process-global eval evidence by default, not an authoritative event journal.
 * Durable journals should subscribe before recording; callbacks do not prove
 * persistence. Independent instances are useful for owned eval sessions/tests. */
export class SimulationChronicle {
  private entryTail: OperationalEvidenceTail<ChronicleEntry>;
  private snapshotTail: OperationalEvidenceTail<ChronicleSnapshot>;
  private get entries(): ChronicleEntry[] { return this.entryTail.values; }
  private get snapshots(): ChronicleSnapshot[] { return this.snapshotTail.values; }
  private nextId = 1;
  private currentTick = 0;
  private startTime = Date.now();
  private epoch = 0;
  private eventCounts: Partial<Record<ChronicleEventType, number>> = {};
  private listenerFailures = 0;
  private archiveListenerFailures = 0;
  private latestSnapshotRetained = false;
  private archiveListeners = new Set<(record: ChronicleArchiveRecord) => void>();

  constructor(private readonly retention: ChronicleRetentionOptions = {}) {
    this.entryTail = this.createEntryTail();
    this.snapshotTail = this.createSnapshotTail();
  }

  private createEntryTail(): OperationalEvidenceTail<ChronicleEntry> {
    return new OperationalEvidenceTail(this.retention.entries ?? { maxEntries: 4096, maxBytes: 8 * 1024 * 1024 });
  }

  private createSnapshotTail(): OperationalEvidenceTail<ChronicleSnapshot> {
    return new OperationalEvidenceTail(this.retention.snapshots ?? { maxEntries: 128, maxBytes: 4 * 1024 * 1024 });
  }

  // Per-agent counters
  private agentLLMCalls: Map<string, number> = new Map();
  private agentPolicyCalls: Map<string, number> = new Map();

  // Event listeners for real-time event processing
  private listeners: ChronicleListener[] = [];

  /** Set the current simulation tick */
  setTick(tick: number): void {
    this.currentTick = tick;
  }

  /** Record a chronicle event */
  record(type: ChronicleEventType, data: Record<string, any>, summary?: string): void {
    const entry: ChronicleEntry = {
      id: this.nextId++,
      type,
      tick: this.currentTick,
      timestamp: Date.now(),
      summary: summary || this.autoSummary(type, data),
      data,
    };
    this.eventCounts[type] = (this.eventCounts[type] ?? 0) + 1;
    this.notifyArchive({ kind: "entry", epoch: this.epoch, entry });
    this.entries.push(entry);

    // Notify listeners
    for (const listener of this.listeners) {
      try { listener(entry); } catch { this.listenerFailures++; }
    }

    // Track LLM vs policy calls
    if (type === "llm_decision" && data.agent) {
      this.agentLLMCalls.set(data.agent, (this.agentLLMCalls.get(data.agent) || 0) + 1);
    }
    if (type === "policy_decision" && data.agent) {
      this.agentPolicyCalls.set(data.agent, (this.agentPolicyCalls.get(data.agent) || 0) + 1);
    }
  }

  /** Take a periodic snapshot of simulation state */
  addSnapshot(snap: ChronicleSnapshot): void {
    this.notifyArchive({ kind: "snapshot", epoch: this.epoch, snapshot: snap });
    this.snapshots.push(snap);
    this.latestSnapshotRetained = this.snapshots[this.snapshots.length - 1] === snap;
  }

  /** Get all entries of a specific type */
  getByType(type: ChronicleEventType): ChronicleEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /** Get entries in a tick range */
  getByTickRange(from: number, to: number): ChronicleEntry[] {
    return this.entries.filter(e => e.tick >= from && e.tick <= to);
  }

  /** Get all entries for a specific tick */
  getEventsForTick(tick: number): ChronicleEntry[] {
    return this.entries.filter(e => e.tick === tick);
  }

  /** Get the retained hot tail. Consult getCoverage() before claiming completeness. */
  getAll(): ChronicleEntry[] {
    return [...this.entries];
  }

  /** Subscribe to chronicle events in real-time */
  subscribe(listener: ChronicleListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Receives complete new records before hot-tail eviction, plus reset epochs.
   * Install before the run. Existing subscribe() file journals stay independent. */
  subscribeArchive(listener: (record: ChronicleArchiveRecord) => void): () => void {
    this.archiveListeners.add(listener);
    return () => { this.archiveListeners.delete(listener); };
  }

  private notifyArchive(record: ChronicleArchiveRecord): void {
    for (const listener of this.archiveListeners) {
      try { listener(record); } catch { this.archiveListenerFailures++; }
    }
  }

  getCoverage(): ChronicleCoverage {
    return {
      scope: "process-global", epoch: this.epoch, events: this.entryTail.coverage(), snapshots: this.snapshotTail.coverage(),
      listenerFailures: this.listenerFailures, archiveListenerFailures: this.archiveListenerFailures,
      countsScope: "epoch-total", detailsScope: "retained-tail",
    };
  }

  /** Get LLM call count for an agent */
  getLLMCalls(agent: string): number {
    return this.agentLLMCalls.get(agent) || 0;
  }

  /** Get policy call count for an agent */
  getPolicyCalls(agent: string): number {
    return this.agentPolicyCalls.get(agent) || 0;
  }

  /** Generate the eval report */
  generateReport(): ChronicleReport {
    const totalTicks = this.currentTick;
    const runtime = Date.now() - this.startTime;

    // Count events by type
    const eventCounts: Record<string, number> = { ...this.eventCounts };

    // Agent growth curves (from snapshots)
    const agentGrowth: Record<string, { tick: number; treeSize: number; compiled: number }[]> = {};
    for (const snap of this.snapshots) {
      for (const agent of snap.agents) {
        if (!agentGrowth[agent.name]) agentGrowth[agent.name] = [];
        agentGrowth[agent.name].push({
          tick: snap.tick,
          treeSize: agent.treeSize,
          compiled: agent.compiledBranches,
        });
      }
    }

    // Key moments (most interesting events)
    const keyMoments = this.entries
      .filter(e => [
        "bt_compiled", "skill_learned", "goal_skill_compiled",
        "affordance_evolved", "system_baked", "world_mutation",
        "crisis_event", "policy_evolved", "memory_branch",
      ].includes(e.type))
      .map(e => ({ tick: e.tick, type: e.type, summary: e.summary }));

    // LLM reduction curve
    const llmReduction: { tick: number; llmRate: number }[] = [];
    for (const snap of this.snapshots) {
      let totalLLM = 0, totalPolicy = 0;
      for (const agent of snap.agents) {
        totalLLM += agent.llmCallsTotal;
        totalPolicy += agent.policyCallsTotal;
      }
      const total = totalLLM + totalPolicy;
      llmReduction.push({
        tick: snap.tick,
        llmRate: total > 0 ? totalLLM / total : 1,
      });
    }

    // Novel affordances created during simulation (not at genesis)
    const evolvedAffordances = this.entries
      .filter(e => e.type === "affordance_evolved" || (e.type === "affordance_created" && e.tick > 0))
      .map(e => ({ tick: e.tick, name: e.data.name, description: e.data.description }));

    // World mutations by agents
    const mutations = this.entries
      .filter(e => e.type === "world_mutation")
      .map(e => ({ tick: e.tick, agent: e.data.agent, action: e.data.action, result: e.data.result }));

    return {
      meta: {
        totalTicks,
        runtimeMs: runtime,
        totalEvents: this.entryTail.coverage().total,
        snapshotCount: this.snapshotTail.coverage().total,
      },
      coverage: this.getCoverage(),
      eventCounts,
      keyMoments,
      agentGrowth,
      llmReduction,
      evolvedAffordances,
      mutations,
      finalSnapshot: this.latestSnapshotRetained ? this.snapshots[this.snapshots.length - 1] ?? null : null,
    };
  }

  /** Save chronicle to disk */
  save(filepath: string): void {
    const dir = filepath.substring(0, filepath.lastIndexOf("/"));
    if (dir) fs.mkdirSync(dir, { recursive: true });

    const report = this.generateReport();
    fs.writeFileSync(filepath, JSON.stringify({
      chronicle: {
        entries: this.entries,
        snapshots: this.snapshots,
        coverage: this.getCoverage(),
      },
      report,
    }, null, 2));
  }

  /** Save just the report (compact) */
  saveReport(filepath: string): void {
    const dir = filepath.substring(0, filepath.lastIndexOf("/"));
    if (dir) fs.mkdirSync(dir, { recursive: true });

    const report = this.generateReport();

    // Build a human-readable summary
    const lines: string[] = [];
    lines.push(`# Simulation Chronicle Report`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Duration: ${report.meta.totalTicks} ticks, ${(report.meta.runtimeMs / 1000).toFixed(0)}s`);
    lines.push(`Events: ${report.meta.totalEvents}`);
    lines.push(`Evidence scope: process-global epoch ${report.coverage.epoch}; totals cover the epoch, details cover retained tails.`);
    lines.push(`Retained events: ${report.coverage.events.retained}/${report.coverage.events.total}; snapshots: ${report.coverage.snapshots.retained}/${report.coverage.snapshots.total}.`);
    lines.push(`Complete hot evidence: ${report.coverage.events.complete && report.coverage.snapshots.complete}; observer failures: ${report.coverage.listenerFailures + report.coverage.archiveListenerFailures}.`);
    lines.push("");

    lines.push("## Event Summary");
    for (const [type, count] of Object.entries(report.eventCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${type}: ${count}`);
    }
    lines.push("");

    lines.push("## Agent Growth");
    for (const [name, curve] of Object.entries(report.agentGrowth)) {
      if (curve.length >= 2) {
        const first = curve[0];
        const last = curve[curve.length - 1];
        lines.push(`  ${name}: ${first.treeSize} → ${last.treeSize} nodes (${last.compiled} compiled)`);
      }
    }
    lines.push("");

    lines.push("## LLM Reduction");
    for (const point of report.llmReduction) {
      lines.push(`  tick ${point.tick}: ${(point.llmRate * 100).toFixed(0)}% LLM`);
    }
    lines.push("");

    lines.push("## Key Moments");
    for (const moment of report.keyMoments) {
      lines.push(`  [tick ${moment.tick}] ${moment.type}: ${moment.summary}`);
    }
    lines.push("");

    if (report.evolvedAffordances.length > 0) {
      lines.push("## Evolved Affordances (created during simulation)");
      for (const aff of report.evolvedAffordances) {
        lines.push(`  [tick ${aff.tick}] ${aff.name}: ${aff.description || ""}`);
      }
      lines.push("");
    }

    if (report.mutations.length > 0) {
      lines.push("## World Mutations (by agents)");
      for (const mut of report.mutations) {
        lines.push(`  [tick ${mut.tick}] ${mut.agent}: ${mut.action} → ${mut.result}`);
      }
      lines.push("");
    }

    if (report.finalSnapshot) {
      lines.push("## Final World State");
      const s = report.finalSnapshot;
      lines.push(`  Rooms: ${s.worldStats.rooms}, Entities: ${s.worldStats.entities}`);
      lines.push(`  Affordances: ${s.worldStats.affordances}, Systems: ${s.worldStats.systems}`);
      lines.push(`  Skills learned: ${s.worldStats.skills}`);
      lines.push("");
      lines.push("  Agents:");
      for (const a of s.agents) {
        lines.push(`    ${a.name} (${a.role}) in ${a.room}`);
        lines.push(`      Tree: ${a.treeSize} nodes, ${a.compiledBranches} compiled`);
        lines.push(`      LLM: ${a.llmCallsTotal}, Policy: ${a.policyCallsTotal}`);
        lines.push(`      Skills: ${a.skillCount}, Memory branches: ${a.memoryBranchCount}`);
      }
    }

    // Save both human-readable and JSON
    fs.writeFileSync(filepath.replace(/\.json$/, ".md"), lines.join("\n"));
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  }

  /** Reset for a new run */
  reset(): void {
    const previousCoverage = this.getCoverage();
    this.entryTail = this.createEntryTail();
    this.snapshotTail = this.createSnapshotTail();
    this.eventCounts = {};
    this.epoch++;
    this.listenerFailures = 0;
    this.archiveListenerFailures = 0;
    this.latestSnapshotRetained = false;
    this.nextId = 1;
    this.currentTick = 0;
    this.startTime = Date.now();
    this.agentLLMCalls.clear();
    this.agentPolicyCalls.clear();
    this.notifyArchive({ kind: "reset", epoch: this.epoch, previousCoverage });
  }

  // =============================================================================
  // AUTO-SUMMARY
  // =============================================================================

  private autoSummary(type: ChronicleEventType, data: Record<string, any>): string {
    switch (type) {
      case "bt_compiled": return `${data.agent} learned: ${data.branch} (tree now ${data.treeSize} nodes)`;
      case "skill_learned": return `${data.agent} compiled skill: "${data.skillName}" (${data.steps} steps)`;
      case "goal_skill_compiled": return `${data.agent} achieved "${data.goal}" → compiled as skill`;
      case "memory_branch": return `${data.agent} grew memory branch for "${data.keyword}"`;
      case "affordance_discovered": return `${data.agent} discovered affordance: ${data.affordance}`;
      case "affordance_evolved": return `Spirit created affordance: ${data.name}`;
      case "system_baked": return `Spirit baked system: ${data.name}`;
      case "world_mutation": return `${data.agent} ${data.action}: ${data.result}`;
      case "llm_decision": return `${data.agent}: ${data.action}${data.reasoning ? ` ("${data.reasoning.slice(0, 60)}")` : ""}`;
      case "contract_decision": return `${data.agent}: selected goal proposes ${data.actionType}${data.target ? ` -> ${data.target}` : ""}`;
      case "decision_rejected": return `${data.agent}: decision rejected (${data.reason}); no action executed`;
      case "policy_decision": return `${data.agent}: ${data.action} (from BT)`;
      case "action_success": return `${data.agent} ${data.affordance} ${data.target}: success`;
      case "action_failure": return `${data.agent} ${data.affordance} ${data.target}: FAILED — ${data.reason}`;
      case "conversation": return `${data.speaker} to ${data.target}: "${(data.content || "").slice(0, 60)}"`;
      case "crisis_event": return `CRISIS: ${data.description}`;
      case "room_created": return `Room: ${data.name}`;
      case "agent_created": return `Agent: ${data.name} (${data.role})`;
      case "affordance_created": return `Affordance: ${data.name} (${data.effectCount || 0} effects)`;
      default: {
        const size = estimateEvidenceBytes(data, 512);
        if (size === undefined) return `${type}: [non-serializable evidence; consult archive]`;
        if (size > 512) return `${type}: [large evidence; consult data/archive]`;
        try { return `${type}: ${JSON.stringify(data).slice(0, 80)}`; }
        catch { return `${type}: [non-serializable evidence; consult archive]`; }
      }
    }
  }
}

// =============================================================================
// REPORT TYPE
// =============================================================================

export interface ChronicleReport {
  meta: {
    totalTicks: number;
    runtimeMs: number;
    totalEvents: number;
    snapshotCount: number;
  };
  coverage: ChronicleCoverage;
  eventCounts: Record<string, number>;
  keyMoments: Array<{ tick: number; type: string; summary: string }>;
  agentGrowth: Record<string, Array<{ tick: number; treeSize: number; compiled: number }>>;
  llmReduction: Array<{ tick: number; llmRate: number }>;
  evolvedAffordances: Array<{ tick: number; name: string; description: string }>;
  mutations: Array<{ tick: number; agent: string; action: string; result: string }>;
  finalSnapshot: ChronicleSnapshot | null;
}

// =============================================================================
// SINGLETON
// =============================================================================

export const chronicle = new SimulationChronicle();
