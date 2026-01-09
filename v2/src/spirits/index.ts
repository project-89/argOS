/**
 * Spirit System - Module Index
 *
 * The celestial hierarchy of AI agents that observe and steer the simulation.
 */

// Types
export type {
  SpiritDomain,
  SpiritRank,
  SpiritDefinition,
  SpiritState,
  WatchConfig,
  ComponentQueryConfig,
  Observation,
  ObservationType,
  SignificantEvent,
  DivineMessage,
  MessageType,
  MessagePriority,
  Directive,
  DirectiveType,
  DirectiveAction,
  NarrativeState,
  NarrativePhase,
  PlotThread,
  CharacterArc,
  SceneState,
  StoryBeat,
  SocialState,
  RelationshipEdge,
  Faction,
  FactionRelation,
  SocialConflict,
  Intervention,
  InterventionType,
  InterventionTarget,
  SpiritCognitionInput,
  SpiritCognitionOutput,
  DirectiveResponse,
  EcsSnapshot,
  AgentSnapshot,
  RoomSnapshot,
  ActionSnapshot,
} from "./types";

// Registry
export {
  createSpiritRegistry,
  createSpirit,
  setGodAgent,
  getSpirit,
  getSpiritByName,
  getSpiritsInDomain,
  getActiveSpirits,
  getSpiritsNeedingObservation,
  sendMessage,
  reportToSuperior,
  sendDirective,
  broadcastToDomain,
  getMessagesForGodAI,
  getHierarchyTree,
  printHierarchy,
  activateSpirit,
  deactivateSpirit,
  removeSpirit,
  getSpiritSummary as getRegistrySummary,
  type SpiritRegistry,
} from "./spirit-registry";

// Cognition
export {
  collectEcsSnapshot,
  runSpiritCognition,
  getSpiritSummary,
} from "./spirit-cognition";

// Spirit System (main orchestrator)
export {
  initializeSpiritSystem,
  getSpiritSystemState,
  startSpiritSystem,
  stopSpiritSystem,
  setGodAgentCallback,
  recordAction,
  recordActionEvent,
  tickSpiritSystem,
  createNewSpirit,
  getAllSpirits,
  getRegistrySummary as getSystemSummary,
  getSpiritDetails,
  createStandardHierarchy,
  getSpiritSystemDebugInfo,
  type SpiritSystemState,
} from "./spirit-system";

// Spirit Definitions
export { NarratorDefinition } from "./narrator-spirit";
export {
  calculateNarrativeUrgency,
  identifyPotentialPlotThreads,
  detectStagnation,
  assessNarrativePhase,
  suggestInterventions,
  // Template-aware functions
  setActiveTemplate,
  getActiveTemplate,
  getAvailableTemplates,
  markBeatCompleted,
  getNextBeat,
  getTemplateInterventions,
  checkTemplateAlignment,
  getRoleSuggestions,
  suggestEnhancedInterventions,
  generateNarrativeReport,
} from "./narrator-spirit";

// Story Templates
export {
  StoryTemplates,
  ClassicThreeActTemplate,
  MysteryTemplate,
  SliceOfLifeTemplate,
  ConflictTemplate,
  EpisodicTemplate,
  suggestTemplate,
  getNextExpectedBeat,
  getInterventionSuggestions,
  calculateTemplateAlignment,
  suggestRoleAssignments,
  // Episodic management
  startNewEpisode,
  getCurrentEpisode,
  getEpisodeHistory,
  addPlotThread,
  resolvePlotThread,
  makePlotThreadDormant,
  shouldEndEpisode,
  // Comic/Visual output
  narrativeEventToPanel,
  organizePanelsIntoPages,
  registerNarrativeHook,
  emitToNarrativeHooks,
  // Types
  type StoryTemplate,
  type StoryGenre,
  type ActTemplate,
  type CharacterRole,
  type TensionPoint,
  type PacingGuideline,
  type BeatTemplate,
  type InterventionSuggestion,
  type EpisodeState,
  type ComicPanel,
  type ComicPage,
  type ComicOutput,
  type NarrativeHook,
} from "./story-templates";
