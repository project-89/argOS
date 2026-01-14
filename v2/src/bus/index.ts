/**
 * SimulationBus Module
 *
 * Provides a bidirectional event system for observing and injecting
 * events into ArgOS simulations.
 *
 * Usage:
 * ```typescript
 * import { createSimulationBus, createWebSocketTransport } from './bus';
 *
 * const bus = createSimulationBus();
 *
 * // Observe events
 * bus.subscribe('agents', (event) => {
 *   console.log('Agent event:', event);
 * });
 *
 * // Inject commands
 * await bus.inject({
 *   type: 'inject:god_command',
 *   command: 'Create a village'
 * });
 * ```
 */

export * from "./simulation-bus";
export * from "./websocket-transport";
