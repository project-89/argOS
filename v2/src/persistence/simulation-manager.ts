/**
 * Simulation Manager
 *
 * Manages per-simulation folder structure for complete state persistence.
 * Each simulation run gets its own folder with:
 *
 * simulations/
 *   {simulation-id}/
 *     simulation.json      - Core metadata, config, and narrative
 *     world.json           - Full ECS world state
 *     spirits.json         - Spirit system state
 *     systems/             - Generated system files
 *       *.ts
 *     snapshots/           - Periodic full state snapshots
 *       snapshot-{tick}.json
 *     logs/                - Detailed logs
 *       narrative.txt      - Running narrative
 *       events.jsonl       - Event stream (JSON lines)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import {
  serializeWorld,
  deserializeWorld,
  type SerializedWorld,
} from "./world-persistence";

// ============================================================================
// Types
// ============================================================================

export interface SimulationConfig {
  /** Human-readable name for the simulation */
  name: string;
  /** Description of what this simulation is about */
  description?: string;
  /** Story template being used (if any) */
  storyTemplate?: string;
  /** Autosave interval in ticks (0 = disabled) */
  autosaveInterval?: number;
  /** Snapshot interval in ticks (0 = disabled) */
  snapshotInterval?: number;
  /** Maximum snapshots to keep (oldest deleted when exceeded) */
  maxSnapshots?: number;
  /** Custom metadata */
  metadata?: Record<string, any>;
}

export interface SimulationMetadata {
  id: string;
  name: string;
  description?: string;
  storyTemplate?: string;
  createdAt: number;
  lastSavedAt: number;
  currentTick: number;
  autosaveInterval: number;
  snapshotInterval: number;
  maxSnapshots: number;
  metadata?: Record<string, any>;
}

export interface SimulationState {
  meta: SimulationMetadata;
  world: SerializedWorld;
  spirits: SerializedSpiritState;
  narrative: string;
}

export interface SerializedSpiritState {
  spirits: SerializedSpirit[];
  messages: SerializedMessage[];
  godAgentId?: number;
}

export interface SerializedSpirit {
  id: number;
  name: string;
  domain: string;
  rank: string;
  superiorId?: number;
  subordinateIds: number[];
  active: boolean;
  lastObservation: number;
  observationCount: number;
  memory: string[];
  observations: any[];
}

export interface SerializedMessage {
  id: string;
  from: number;
  to?: number;
  type: string;
  priority: string;
  content: string;
  timestamp: number;
  processed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const SIMULATIONS_DIR = "./simulations";
const SIMULATION_FILE = "simulation.json";
const WORLD_FILE = "world.json";
const SPIRITS_FILE = "spirits.json";
const SYSTEMS_DIR = "systems";
const SNAPSHOTS_DIR = "snapshots";
const LOGS_DIR = "logs";
const NARRATIVE_FILE = "narrative.txt";
const EVENTS_FILE = "events.jsonl";

// ============================================================================
// Current Simulation Tracking
// ============================================================================

let currentSimulation: SimulationInstance | null = null;

export function getCurrentSimulation(): SimulationInstance | null {
  return currentSimulation;
}

export function setCurrentSimulation(sim: SimulationInstance | null): void {
  currentSimulation = sim;
}

// ============================================================================
// SimulationInstance Class
// ============================================================================

export class SimulationInstance {
  readonly id: string;
  readonly basePath: string;
  private meta: SimulationMetadata;
  private narrative: string[] = [];
  private eventBuffer: any[] = [];
  private lastAutosave: number = 0;
  private lastSnapshot: number = 0;

  constructor(id: string, meta: SimulationMetadata) {
    this.id = id;
    this.meta = meta;
    this.basePath = path.join(SIMULATIONS_DIR, id);
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  get name(): string {
    return this.meta.name;
  }

  get currentTick(): number {
    return this.meta.currentTick;
  }

  get createdAt(): number {
    return this.meta.createdAt;
  }

  get lastSavedAt(): number {
    return this.meta.lastSavedAt;
  }

  getMetadata(): SimulationMetadata {
    return { ...this.meta };
  }

  // --------------------------------------------------------------------------
  // Path Helpers
  // --------------------------------------------------------------------------

  getPath(...parts: string[]): string {
    return path.join(this.basePath, ...parts);
  }

  getSimulationFilePath(): string {
    return this.getPath(SIMULATION_FILE);
  }

  getWorldFilePath(): string {
    return this.getPath(WORLD_FILE);
  }

  getSpiritsFilePath(): string {
    return this.getPath(SPIRITS_FILE);
  }

  getSystemsDir(): string {
    return this.getPath(SYSTEMS_DIR);
  }

  getSnapshotsDir(): string {
    return this.getPath(SNAPSHOTS_DIR);
  }

  getLogsDir(): string {
    return this.getPath(LOGS_DIR);
  }

  getNarrativeFilePath(): string {
    return this.getPath(LOGS_DIR, NARRATIVE_FILE);
  }

  getEventsFilePath(): string {
    return this.getPath(LOGS_DIR, EVENTS_FILE);
  }

  getSnapshotPath(tick: number): string {
    return this.getPath(SNAPSHOTS_DIR, `snapshot-${tick}.json`);
  }

  getSystemPath(systemName: string): string {
    const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    return this.getPath(SYSTEMS_DIR, `${kebabName}.ts`);
  }

  // --------------------------------------------------------------------------
  // Directory Management
  // --------------------------------------------------------------------------

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.mkdir(this.getSystemsDir(), { recursive: true });
    await fs.mkdir(this.getSnapshotsDir(), { recursive: true });
    await fs.mkdir(this.getLogsDir(), { recursive: true });
  }

  // --------------------------------------------------------------------------
  // Narrative & Events
  // --------------------------------------------------------------------------

  appendNarrative(text: string): void {
    this.narrative.push(`[Tick ${this.meta.currentTick}] ${text}`);
  }

  logEvent(type: string, data: any): void {
    this.eventBuffer.push({
      tick: this.meta.currentTick,
      timestamp: Date.now(),
      type,
      data,
    });
  }

  async flushLogs(): Promise<void> {
    // Append narrative
    if (this.narrative.length > 0) {
      const narrativeText = this.narrative.join("\n") + "\n";
      await fs.appendFile(this.getNarrativeFilePath(), narrativeText);
      this.narrative = [];
    }

    // Append events (JSON lines format)
    if (this.eventBuffer.length > 0) {
      const eventsText = this.eventBuffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(this.getEventsFilePath(), eventsText);
      this.eventBuffer = [];
    }
  }

  // --------------------------------------------------------------------------
  // Tick Tracking
  // --------------------------------------------------------------------------

  updateTick(tick: number): void {
    this.meta.currentTick = tick;
  }

  // --------------------------------------------------------------------------
  // Save Operations
  // --------------------------------------------------------------------------

  async saveMetadata(): Promise<void> {
    this.meta.lastSavedAt = Date.now();
    await fs.writeFile(
      this.getSimulationFilePath(),
      JSON.stringify(this.meta, null, 2)
    );
  }

  async saveWorld(world: World, registry: SystemRegistry): Promise<void> {
    const serialized = serializeWorld(world, registry);
    await fs.writeFile(this.getWorldFilePath(), JSON.stringify(serialized, null, 2));
  }

  async saveSpirits(spiritRegistry: SpiritRegistry): Promise<void> {
    const serialized = serializeSpiritRegistry(spiritRegistry);
    await fs.writeFile(this.getSpiritsFilePath(), JSON.stringify(serialized, null, 2));
  }

  async saveSystem(systemName: string, systemCode: string): Promise<void> {
    await fs.writeFile(this.getSystemPath(systemName), systemCode);
  }

  async saveAll(
    world: World,
    systemRegistry: SystemRegistry,
    spiritRegistry?: SpiritRegistry
  ): Promise<void> {
    await this.ensureDirectories();
    await this.flushLogs();
    await this.saveMetadata();
    await this.saveWorld(world, systemRegistry);
    if (spiritRegistry) {
      await this.saveSpirits(spiritRegistry);
    }
    console.log(`[SimulationManager] Saved simulation "${this.meta.name}" at tick ${this.meta.currentTick}`);
  }

  async saveSnapshot(
    world: World,
    systemRegistry: SystemRegistry,
    spiritRegistry?: SpiritRegistry
  ): Promise<void> {
    const snapshot: SimulationState = {
      meta: { ...this.meta, lastSavedAt: Date.now() },
      world: serializeWorld(world, systemRegistry),
      spirits: spiritRegistry ? serializeSpiritRegistry(spiritRegistry) : { spirits: [], messages: [] },
      narrative: (await this.readNarrativeLog()) || "",
    };

    await fs.writeFile(
      this.getSnapshotPath(this.meta.currentTick),
      JSON.stringify(snapshot, null, 2)
    );

    // Cleanup old snapshots
    await this.cleanupOldSnapshots();

    console.log(`[SimulationManager] Created snapshot at tick ${this.meta.currentTick}`);
  }

  private async cleanupOldSnapshots(): Promise<void> {
    if (this.meta.maxSnapshots <= 0) return;

    const snapshotsDir = this.getSnapshotsDir();
    const files = await fs.readdir(snapshotsDir);
    const snapshots = files
      .filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"))
      .map((f) => ({
        name: f,
        tick: parseInt(f.replace("snapshot-", "").replace(".json", ""), 10),
      }))
      .sort((a, b) => a.tick - b.tick);

    while (snapshots.length > this.meta.maxSnapshots) {
      const oldest = snapshots.shift()!;
      await fs.unlink(path.join(snapshotsDir, oldest.name));
      console.log(`[SimulationManager] Deleted old snapshot: ${oldest.name}`);
    }
  }

  // --------------------------------------------------------------------------
  // Auto-save / Snapshot Logic
  // --------------------------------------------------------------------------

  shouldAutosave(currentTick: number): boolean {
    if (this.meta.autosaveInterval <= 0) return false;
    return currentTick - this.lastAutosave >= this.meta.autosaveInterval;
  }

  shouldSnapshot(currentTick: number): boolean {
    if (this.meta.snapshotInterval <= 0) return false;
    return currentTick - this.lastSnapshot >= this.meta.snapshotInterval;
  }

  async tickSave(
    currentTick: number,
    world: World,
    systemRegistry: SystemRegistry,
    spiritRegistry?: SpiritRegistry
  ): Promise<void> {
    this.updateTick(currentTick);

    if (this.shouldSnapshot(currentTick)) {
      await this.saveSnapshot(world, systemRegistry, spiritRegistry);
      this.lastSnapshot = currentTick;
    } else if (this.shouldAutosave(currentTick)) {
      await this.saveAll(world, systemRegistry, spiritRegistry);
      this.lastAutosave = currentTick;
    }
  }

  // --------------------------------------------------------------------------
  // Load Operations
  // --------------------------------------------------------------------------

  async loadWorld(world: World, systemRegistry: SystemRegistry): Promise<void> {
    const worldPath = this.getWorldFilePath();
    if (!existsSync(worldPath)) {
      throw new Error(`World file not found: ${worldPath}`);
    }
    const content = await fs.readFile(worldPath, "utf-8");
    const data: SerializedWorld = JSON.parse(content);
    deserializeWorld(world, systemRegistry, data);
  }

  async loadSpirits(): Promise<SerializedSpiritState | null> {
    const spiritsPath = this.getSpiritsFilePath();
    if (!existsSync(spiritsPath)) {
      return null;
    }
    const content = await fs.readFile(spiritsPath, "utf-8");
    return JSON.parse(content);
  }

  async readNarrativeLog(): Promise<string | null> {
    const narrativePath = this.getNarrativeFilePath();
    if (!existsSync(narrativePath)) {
      return null;
    }
    return fs.readFile(narrativePath, "utf-8");
  }

  async loadSystems(): Promise<string[]> {
    const systemsDir = this.getSystemsDir();
    if (!existsSync(systemsDir)) {
      return [];
    }
    const files = await fs.readdir(systemsDir);
    return files.filter((f) => f.endsWith(".ts"));
  }

  async listSnapshots(): Promise<{ tick: number; path: string; savedAt: Date }[]> {
    const snapshotsDir = this.getSnapshotsDir();
    if (!existsSync(snapshotsDir)) {
      return [];
    }

    const files = await fs.readdir(snapshotsDir);
    const snapshots: { tick: number; path: string; savedAt: Date }[] = [];

    for (const file of files) {
      if (!file.startsWith("snapshot-") || !file.endsWith(".json")) continue;
      const tick = parseInt(file.replace("snapshot-", "").replace(".json", ""), 10);
      const filePath = path.join(snapshotsDir, file);
      const stat = await fs.stat(filePath);
      snapshots.push({ tick, path: filePath, savedAt: stat.mtime });
    }

    return snapshots.sort((a, b) => b.tick - a.tick);
  }
}

// ============================================================================
// Simulation Manager Functions
// ============================================================================

/**
 * Create a new simulation with its folder structure
 */
export async function createSimulation(config: SimulationConfig): Promise<SimulationInstance> {
  // Generate unique ID (timestamp + random)
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const meta: SimulationMetadata = {
    id,
    name: config.name,
    description: config.description,
    storyTemplate: config.storyTemplate,
    createdAt: Date.now(),
    lastSavedAt: Date.now(),
    currentTick: 0,
    autosaveInterval: config.autosaveInterval ?? 50, // Default: every 50 ticks
    snapshotInterval: config.snapshotInterval ?? 200, // Default: every 200 ticks
    maxSnapshots: config.maxSnapshots ?? 10, // Default: keep 10 snapshots
    metadata: config.metadata,
  };

  const simulation = new SimulationInstance(id, meta);
  await simulation.ensureDirectories();
  await simulation.saveMetadata();

  // Initialize empty log files
  await fs.writeFile(simulation.getNarrativeFilePath(), "");
  await fs.writeFile(simulation.getEventsFilePath(), "");

  console.log(`[SimulationManager] Created new simulation: ${config.name} (${id})`);
  return simulation;
}

/**
 * Load an existing simulation by ID
 */
export async function loadSimulation(id: string): Promise<SimulationInstance> {
  const simPath = path.join(SIMULATIONS_DIR, id, SIMULATION_FILE);
  if (!existsSync(simPath)) {
    throw new Error(`Simulation not found: ${id}`);
  }

  const content = await fs.readFile(simPath, "utf-8");
  const meta: SimulationMetadata = JSON.parse(content);

  const simulation = new SimulationInstance(id, meta);
  console.log(`[SimulationManager] Loaded simulation: ${meta.name} (${id}) at tick ${meta.currentTick}`);
  return simulation;
}

/**
 * List all available simulations
 */
export async function listSimulations(): Promise<SimulationMetadata[]> {
  if (!existsSync(SIMULATIONS_DIR)) {
    return [];
  }

  const entries = await fs.readdir(SIMULATIONS_DIR, { withFileTypes: true });
  const simulations: SimulationMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const simPath = path.join(SIMULATIONS_DIR, entry.name, SIMULATION_FILE);
    if (!existsSync(simPath)) continue;

    try {
      const content = await fs.readFile(simPath, "utf-8");
      simulations.push(JSON.parse(content));
    } catch {
      // Skip invalid simulation folders
    }
  }

  return simulations.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
}

/**
 * Delete a simulation and all its data
 */
export async function deleteSimulation(id: string): Promise<void> {
  const simPath = path.join(SIMULATIONS_DIR, id);
  if (!existsSync(simPath)) {
    throw new Error(`Simulation not found: ${id}`);
  }

  await fs.rm(simPath, { recursive: true, force: true });
  console.log(`[SimulationManager] Deleted simulation: ${id}`);
}

/**
 * Load a specific snapshot from a simulation
 */
export async function loadSnapshot(
  simulationId: string,
  tick: number
): Promise<SimulationState> {
  const snapshotPath = path.join(
    SIMULATIONS_DIR,
    simulationId,
    SNAPSHOTS_DIR,
    `snapshot-${tick}.json`
  );

  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: tick ${tick} in simulation ${simulationId}`);
  }

  const content = await fs.readFile(snapshotPath, "utf-8");
  return JSON.parse(content);
}

// ============================================================================
// Spirit Registry Serialization
// ============================================================================

export function serializeSpiritRegistry(registry: SpiritRegistry): SerializedSpiritState {
  const spirits: SerializedSpirit[] = [];

  // Iterate over spirits Map
  for (const [eid, state] of Array.from(registry.spirits.entries())) {
    const def = state.definition;

    spirits.push({
      id: eid,
      name: def.name,
      domain: def.domain,
      rank: def.rank,
      superiorId: state.superiorEid,
      subordinateIds: Array.from(state.subordinateEids),
      active: true, // Spirits in registry are active
      lastObservation: state.lastObservationTime,
      observationCount: state.observations.length,
      memory: [], // Memory stored elsewhere
      observations: state.observations.slice(-10), // Keep last 10 observations
    });
  }

  // Serialize message queue
  const messages: SerializedMessage[] = registry.messageQueue.map((msg, idx) => ({
    id: msg.id || `msg-${idx}`,
    from: msg.from,
    to: msg.to,
    type: msg.type,
    priority: msg.priority,
    content: msg.content,
    timestamp: msg.timestamp,
    processed: false, // Queue only has unprocessed messages
  }));

  return {
    spirits,
    messages,
    godAgentId: registry.godAgentEid,
  };
}

export function deserializeSpiritRegistry(
  registry: SpiritRegistry,
  data: SerializedSpiritState
): void {
  // Clear existing state
  registry.spirits.clear();
  registry.byName.clear();
  registry.byDomain.clear();
  registry.messageQueue = [];

  // Restore god agent ID
  if (data.godAgentId !== undefined) {
    registry.godAgentEid = data.godAgentId;
  }

  // Note: Full spirit restoration requires recreating entities via createSpirit()
  // This is metadata only - actual spirit entities must be recreated through the registry
  console.log(`[SimulationManager] Spirit registry has ${data.spirits.length} spirits to restore`);
  console.log(`[SimulationManager] Message queue has ${data.messages.length} messages (not restored - messages are transient)`);

  // Message queue is not fully restored since DivineMessage has many required fields
  // that weren't serialized. Fresh messages will be generated on next tick.
}

// ============================================================================
// Exports
// ============================================================================

export {
  SIMULATIONS_DIR,
  SIMULATION_FILE,
  WORLD_FILE,
  SPIRITS_FILE,
  SYSTEMS_DIR,
  SNAPSHOTS_DIR,
  LOGS_DIR,
  NARRATIVE_FILE,
  EVENTS_FILE,
};
