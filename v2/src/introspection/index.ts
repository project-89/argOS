/**
 * Introspection Module
 *
 * Provides dynamic introspection capabilities for ArgOS:
 * - Action registry and validation
 * - Component metadata
 * - System summaries
 * - Rolling event buffer for pattern detection
 * - Entity snapshots
 */

export {
  // Action introspection
  ACTION_REGISTRY,
  getAvailableActions,
  getActionDefinition,
  isValidAction,
  getActionsByCategory,
  getActionsRequiringSystem,
  type ActionDefinition,

  // Component introspection
  COMPONENT_REGISTRY,
  getAvailableComponents,
  getComponentDefinition,
  getComponentsByCategory,
  type ComponentDefinition,

  // System introspection
  getSystemSummaries,
  getSystemByName,
  type SystemSummary,

  // Rolling event buffer
  createRollingEventBuffer,
  addToBuffer,
  getEventsInWindow,
  getEventsByType,
  getEventFrequencies,
  detectPatterns,
  type RollingEventBuffer,
  type BufferedEvent,

  // Entity introspection
  getEntitySnapshots,
  getEntityDetails,
  type EntitySnapshot,

  // Full introspection context
  getIntrospectionContext,
  type IntrospectionContext,
} from "./introspection";
