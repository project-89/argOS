/**
 * World Module - MUD-style world simulation layer
 *
 * Provides:
 * - WorldSchema: Prefab definitions, affordances, rules
 * - ObjectManager: Entity spawning and state management
 * - TextRenderer: MUD-style text generation for perception
 * - RulesEngine: Declarative behavior execution
 */

export {
  worldSchema,
  WorldSchema,
  ContainedIn,
  OnTopOf,
  OccupiedBy,
  OwnedBy,
  AdjacentTo,
  BASE_AFFORDANCES,
  BASE_OBJECT_TYPES,
  BASE_RULES,
  type AffordanceDefinition,
  type StateDefinition,
  type ObjectTypeDefinition,
  type RuleCondition,
  type RuleEffect,
  type RuleDefinition,
} from "./schema";

export {
  ObjectManager,
  type SpawnOptions,
  type ObjectInfo,
} from "./object-manager";

export {
  TextRenderer,
  type RenderOptions,
  type RenderedRoom,
  type RenderedObject,
  type RenderedNPC,
  type RenderedExit,
} from "./text-renderer";

export {
  RulesEngine,
  type RuleEvent,
  type RuleContext,
} from "./rules-engine";

export {
  createWorldTools,
  initializeWorldToolsState,
  type WorldToolsState,
} from "./world-tools";
