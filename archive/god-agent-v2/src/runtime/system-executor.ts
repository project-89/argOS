/**
 * System Executor
 * Safely executes dynamically generated systems
 */

import { 
  World, 
  query, 
  addEntity, 
  removeEntity,
  addComponent,
  removeComponent,
  hasComponent,
  entityExists,
  And,
  Or,
  Not,
  All,
  Any,
  None
} from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { logSystemExecution, logSystemError, logEntityThought, logEntityAction } from './execution-logger.js';
import * as readline from 'readline';
import chalk from 'chalk';

// Create a sandbox context for system execution
async function createSystemContext(world: World, requiredComponents: string[], isAsync: boolean = false): Promise<any> {
  const context: any = {
    world,
    // BitECS core functions
    query,
    addEntity,
    removeEntity,
    addComponent,
    removeComponent,
    hasComponent,
    entityExists,
    // Query operators
    And,
    Or,
    Not,
    All,
    Any,
    None,
    // Wildcard for relations
    Wildcard: '*' as const,
    // Console for debugging
    console: {
      log: (...args: any[]) => console.log('[System]', ...args),
      error: (...args: any[]) => console.error('[System Error]', ...args),
      warn: (...args: any[]) => console.warn('[System Warning]', ...args),
      info: (...args: any[]) => console.info('[System Info]', ...args),
      debug: (...args: any[]) => console.debug('[System Debug]', ...args),
    },
    Math,
    Date,
    // CLI tools for I/O systems
    readline,
    chalk,
  };

  // Add component references to context
  for (const compName of requiredComponents) {
    const compDef = globalRegistry.getComponent(compName);
    if (compDef && compDef.component) {
      context[compName] = compDef.component;
    }
  }

  // Add LLM tools for async systems
  if (isAsync) {
    // Dynamic import to avoid circular dependencies
    context.miniLLM = async (llmPrompt: string) => {
      // Ensure we have a string
      if (typeof llmPrompt !== 'string') {
        console.error('[miniLLM] Invalid prompt type:', typeof llmPrompt);
        console.error('[miniLLM] Prompt value:', llmPrompt);
        return JSON.stringify({ error: 'Invalid prompt type' });
      }
      
      const { callMiniLLM } = await import('../llm/interface.js');
      const response = await callMiniLLM(llmPrompt);
      
      // Emit visualization events for AI thought
      try {
        // Web visualization
        const { getVisualizationServer } = await import('../visualization/visualization-server.js');
        const vizServer = getVisualizationServer();
        
        // Terminal visualization  
        const { addThoughtToTerminalViz } = await import('../visualization/terminal-visualizer.js');
        
        // Try to extract entity ID from context (simplified)
        const entityMatch = llmPrompt.match(/Entity (\d+)/);
        const entityId = entityMatch ? parseInt(entityMatch[1]) : 0;
        
        if (vizServer) {
          vizServer.emitThought({
            entityId,
            thought: response.substring(0, 200),
            timestamp: Date.now()
          });
        }
        
        // Add to terminal visualization
        addThoughtToTerminalViz(entityId, response.substring(0, 100));
        
        // Log the thought
        logEntityThought(entityId, response.substring(0, 200));
        
      } catch (error) {
        // Visualization not available, continue silently
      }
      
      return response;
    };
    
    // Add entity logging functions
    context.logAction = (eid: number, action: string) => {
      logEntityAction(eid, action);
    };
    
    context.logThought = (eid: number, thought: string) => {
      logEntityThought(eid, thought);
    };
    
    // Import string utilities from god-components
    const { getString: realGetString, storeString } = await import('../components/god-components.js');
    
    // Helper functions for LLM systems with proper string handling
    context.getString = (componentProp: any, eid: number): string => {
      if (!componentProp || !componentProp[eid]) return '';
      const hash = componentProp[eid];
      return realGetString(hash);
    };
    
    context.setString = (componentProp: any, eid: number, value: string): void => {
      if (!componentProp) {
        console.error('[setString] Component property is undefined. Usage: setString(Component.property, entityId, "value")');
        return;
      }
      
      // Check if componentProp is actually a component property array
      if (!Array.isArray(componentProp)) {
        console.error('[setString] First argument must be a component property array (e.g., Message.content), not a value');
        console.error('[setString] Got:', typeof componentProp, componentProp);
        console.error('[setString] Usage: setString(Component.property, entityId, "value")');
        return;
      }
      
      // Validate entity ID
      if (typeof eid !== 'number' || isNaN(eid)) {
        console.error('[setString] Entity ID must be a valid number. Got:', eid);
        return;
      }
      
      // Ensure value is a string and handle null/undefined
      const stringValue = value === null || value === undefined ? '' : String(value);
      const hash = storeString(stringValue);
      componentProp[eid] = hash;
    };
    
    context.findNearby = (world: World, eid: number, _radius: number): number[] => {
      // Simplified - would use spatial indexing in real implementation
      const entities = query(world, []);
      return entities.filter(e => e !== eid).slice(0, 5); // Return up to 5 nearby entities
    };
    
    context.describeEntities = (entities: number[]): string => {
      return `${entities.length} entities nearby`;
    };

    // Add async utilities
    context.Promise = Promise;
    context.JSON = JSON;
    
    // Add safe JSON parsing helper
    context.parseJSON = (text: string, fallback: any = null) => {
      try {
        return JSON.parse(text);
      } catch (e) {
        console.log('[parseJSON] Failed to parse, returning fallback:', fallback);
        return fallback;
      }
    };
    
    // Add JSON extraction helper
    context.extractJSON = (text: string) => {
      // Try to find JSON object in the text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          return null;
        }
      }
      return null;
    };
  }

  return context;
}

// Parse and prepare system function
function prepareSystemFunction(code: string, context: any, _isAsync: boolean = false): Function | null {
  try {
    // Extract function body - handle both async and regular functions
    const functionMatch = code.match(/(async\s+)?function\s+\w+\s*\([^)]*\)\s*{([\s\S]*?)^}/m);
    if (!functionMatch) {
      console.error('Could not extract function body from code');
      return null;
    }

    const isAsyncFunction = !!functionMatch[1];
    const functionBody = functionMatch[2];
    
    // Create function with bound context
    const contextKeys = Object.keys(context);
    const contextValues = Object.values(context);
    
    // Build the function - handle async if needed
    const AsyncFunction = (async function() {}).constructor as any;
    const FunctionConstructor = isAsyncFunction ? AsyncFunction : Function;
    const systemFunction = new FunctionConstructor(...contextKeys, functionBody);
    
    // Return a bound version - handle async execution
    if (isAsyncFunction) {
      return async function(world: World) {
        try {
          // Update world in context
          context.world = world;
          return await systemFunction.apply(null, contextValues);
        } catch (error) {
          console.error('Async system execution error:', error);
          throw error; // Re-throw so executeSystem can catch and store it
        }
      };
    } else {
      return function(world: World) {
        try {
          // Update world in context
          context.world = world;
          return systemFunction.apply(null, contextValues);
        } catch (error) {
          console.error('System execution error:', error);
          throw error; // Re-throw so executeSystem can catch and store it
        }
      };
    }
  } catch (error) {
    console.error('Failed to prepare system function:', error);
    return null;
  }
}

// Execute a system by name
export async function executeSystem(world: World, systemName: string): Promise<boolean> {
  const systemDef = globalRegistry.getSystem(systemName);
  if (!systemDef || !systemDef.code) {
    console.error(`System ${systemName} not found or has no code`);
    return false;
  }
  
  // Log system execution start
  logSystemExecution(systemName, 'Starting execution');

  // Check if we have a cached executable function
  if (systemDef.systemFn && typeof systemDef.systemFn === 'function') {
    try {
      // Handle both async and sync functions
      const result = systemDef.systemFn(world);
      if (result && typeof result === 'object' && 'then' in result) {
        await result;
      }
      logSystemExecution(systemName, 'Completed successfully');
      return true;
    } catch (error: any) {
      console.error(`Error executing cached system ${systemName}:`, error);
      logSystemError(systemName, error);
      
      // Store error for God to fix
      systemDef.lastError = {
        message: error.message || String(error),
        stack: error.stack,
        timestamp: Date.now()
      };
      globalRegistry.registerSystem(systemName, systemDef);
      
      return false;
    }
  }

  // Create execution context
  const isAsync = systemDef.isAsync || false;
  const context = await createSystemContext(world, systemDef.requiredComponents, isAsync);
  
  // Prepare the function
  const systemFn = prepareSystemFunction(systemDef.code, context, isAsync);
  if (!systemFn) {
    console.error(`Failed to prepare system ${systemName}`);
    return false;
  }

  // Cache the prepared function
  systemDef.systemFn = systemFn as (world: World) => void | Promise<void>;

  // Execute the system
  try {
    const result = systemFn(world);
    if (result && typeof result === 'object' && 'then' in result) {
      await result;
    }
    return true;
  } catch (error: any) {
    console.error(`Error executing system ${systemName}:`, error);
    
    // Store error for God to fix
    const systemDef = globalRegistry.getSystem(systemName);
    if (systemDef) {
      systemDef.lastError = {
        message: error.message || String(error),
        stack: error.stack,
        timestamp: Date.now()
      };
      globalRegistry.registerSystem(systemName, systemDef);
    }
    
    return false;
  }
}

// Execute all registered systems
export async function executeAllSystems(world: World): Promise<void> {
  const systems = globalRegistry.listSystems();
  
  for (const systemName of systems) {
    const systemDef = globalRegistry.getSystem(systemName);
    if (systemDef) {
      console.log(`Executing system: ${systemName}`);
      await executeSystem(world, systemName);
    }
  }
}

// Create a simple runtime for continuous execution
export class SystemRuntime {
  private running: boolean = false;
  private systems: string[] = [];
  private tickRate: number = 60; // 60 ticks per second
  private lastTick: number = 0;

  constructor(private world: World) {}

  addSystem(systemName: string): void {
    if (!this.systems.includes(systemName)) {
      this.systems.push(systemName);
    }
  }

  removeSystem(systemName: string): void {
    this.systems = this.systems.filter(s => s !== systemName);
  }

  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.lastTick = Date.now();
    this.tick();
  }

  stop(): void {
    this.running = false;
  }

  private tick(): void {
    if (!this.running) return;

    const now = Date.now();
    const deltaTime = (now - this.lastTick) / 1000; // Convert to seconds
    this.lastTick = now;

    // Add delta time to world context
    (this.world as any).dt = deltaTime;

    // Execute all systems
    for (const systemName of this.systems) {
      executeSystem(this.world, systemName);
    }

    // Schedule next tick
    setTimeout(() => this.tick(), 1000 / this.tickRate);
  }

  setTickRate(rate: number): void {
    this.tickRate = Math.max(1, Math.min(120, rate));
  }
}

// Create bounded execution environment for specific components
export async function createBoundedExecutor(
  world: World,
  systemCode: string,
  requiredComponents: string[]
): Promise<((world: World) => void) | null> {
  // Create safe context with all BitECS functions
  const context = await createSystemContext(world, requiredComponents, false);
  
  // Parse function name from code
  const nameMatch = systemCode.match(/function\s+(\w+)/);
  const functionName = nameMatch ? nameMatch[1] : 'DynamicSystem';
  
  try {
    // Prepare the function with full context
    const systemFn = prepareSystemFunction(systemCode, context, false);
    if (!systemFn) {
      console.error('Failed to prepare system function');
      return null;
    }
    
    // Return executor that properly handles errors
    return (world: World) => {
      try {
        systemFn(world);
      } catch (error) {
        console.error(`Error executing ${functionName}:`, error);
        throw error; // Re-throw to be caught by caller
      }
    };
  } catch (error) {
    console.error('Failed to create bounded executor:', error);
    return null;
  }
}