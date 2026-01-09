/**
 * Persistence Module Index
 *
 * Exports for world and simulation persistence.
 */

// World Persistence (individual save/load)
export {
  serializeWorld,
  deserializeWorld,
  saveWorld,
  loadWorld,
  loadWorldData,
  getWorldSaves,
  autoSave,
  loadAutoSave,
  hasAutoSave,
  type SerializedEntity,
  type SerializedSystem,
  type SerializedWorld,
} from "./world-persistence";

// Simulation Manager (per-simulation folder organization)
export {
  // Instance class
  SimulationInstance,
  // Manager functions
  createSimulation,
  loadSimulation,
  listSimulations,
  deleteSimulation,
  loadSnapshot,
  // Current simulation tracking
  getCurrentSimulation,
  setCurrentSimulation,
  // Spirit serialization
  serializeSpiritRegistry,
  deserializeSpiritRegistry,
  // Types
  type SimulationConfig,
  type SimulationMetadata,
  type SimulationState,
  type SerializedSpiritState,
  type SerializedSpirit,
  type SerializedMessage,
  // Constants
  SIMULATIONS_DIR,
  SIMULATION_FILE,
  WORLD_FILE,
  SPIRITS_FILE,
  SYSTEMS_DIR,
  SNAPSHOTS_DIR,
  LOGS_DIR,
  NARRATIVE_FILE,
  EVENTS_FILE,
} from "./simulation-manager";
