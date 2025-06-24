/**
 * Terminal ASCII Visualization for God Agent Simulations
 * Generic visualization that works for any ECS structure
 */

import { World, query } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import chalk from 'chalk';

export interface TerminalVisualizationOptions {
  refreshRate?: number; // milliseconds
  maxEntities?: number;
  showThoughts?: boolean;
  showSystems?: boolean;
  compact?: boolean;
}

export class TerminalVisualizer {
  private world: World | null = null;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private lastThoughts: Array<{ entityId: number, thought: string, timestamp: number }> = [];

  constructor(private options: TerminalVisualizationOptions = {}) {
    this.options = {
      refreshRate: 1000,
      maxEntities: 20,
      showThoughts: true,
      showSystems: true,
      compact: false,
      ...options
    };
  }

  public setWorld(world: World) {
    this.world = world;
  }

  public start() {
    if (this.running) return;
    this.running = true;
    
    console.clear();
    this.renderHeader();
    
    this.intervalId = setInterval(() => {
      this.render();
    }, this.options.refreshRate);
  }

  public stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public addThought(entityId: number, thought: string) {
    this.lastThoughts.unshift({ entityId, thought, timestamp: Date.now() });
    if (this.lastThoughts.length > 10) {
      this.lastThoughts.pop();
    }
  }

  private renderHeader() {
    console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('                         GOD AGENT SIMULATION VIEWER                          ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════════════════════╝'));
    console.log();
  }

  private render() {
    if (!this.world) return;

    // Move cursor to top and clear screen
    process.stdout.write('\\x1b[2J\\x1b[0f');
    this.renderHeader();

    // Get world state
    const entities = this.captureEntities();
    const systems = this.captureSystems();
    
    // Render in sections
    this.renderWorldStats(entities, systems);
    this.renderEntities(entities);
    
    if (this.options.showSystems) {
      this.renderSystems(systems);
    }
    
    if (this.options.showThoughts) {
      this.renderThoughts();
    }
    
    this.renderFooter();
  }

  private captureEntities() {
    if (!this.world) return [];

    const entities: any[] = [];
    
    // First get all components from registry
    const registeredComponents = new Map<string, any>();
    for (const compName of globalRegistry.listComponents()) {
      const compDef = globalRegistry.getComponent(compName);
      if (compDef?.component) {
        registeredComponents.set(compName, compDef.component);
      }
    }
    
    // If no registered components, we can't detect entities properly
    if (registeredComponents.size === 0) {
      // Fallback: just show raw entity IDs
      const allEntities = query(this.world, []);
      for (const eid of allEntities.slice(0, this.options.maxEntities)) {
        entities.push({
          id: eid,
          components: ['[No registered components]'],
          data: {},
          type: 'unknown'
        });
      }
      return entities;
    }
    
    // For each registered component, query entities that have it
    const seenEntities = new Set<number>();
    
    for (const [compName, comp] of registeredComponents) {
      try {
        // Query entities with this specific component
        const entitiesWithComp = query(this.world, [comp]);
        
        for (const eid of entitiesWithComp) {
          if (!seenEntities.has(eid) && seenEntities.size < (this.options.maxEntities || 20)) {
            seenEntities.add(eid);
            
            const entity: any = {
              id: eid,
              components: [],
              data: {},
              type: 'unknown'
            };
            
            // Check all components for this entity
            for (const [checkCompName, checkComp] of registeredComponents) {
              let hasComponent = false;
              const componentData: any = {};
              
              // Check if entity has data in this component
              for (const prop in checkComp) {
                if (checkComp[prop] && Array.isArray(checkComp[prop])) {
                  const value = checkComp[prop][eid];
                  if (value !== undefined && value !== 0) {
                    hasComponent = true;
                    componentData[prop] = value;
                  }
                }
              }
              
              if (hasComponent) {
                entity.components.push(checkCompName);
                entity.data[checkCompName] = componentData;
                
                // Determine entity type
                if (checkCompName.toLowerCase().includes('npc') || checkCompName.toLowerCase().includes('mind')) {
                  entity.type = 'npc';
                } else if (checkCompName.toLowerCase().includes('animal')) {
                  entity.type = 'animal';
                } else if (checkCompName.toLowerCase().includes('god')) {
                  entity.type = 'god';
                }
              }
            }
            
            if (entity.components.length > 0) {
              entities.push(entity);
            }
          }
        }
      } catch (error) {
        // Skip this component
        console.error(`Error querying component ${compName}:`, error);
      }
    }
    
    // Sort entities by ID for consistent display
    entities.sort((a, b) => a.id - b.id);
    
    return entities;
  }

  private captureSystems() {
    const systems: any[] = [];
    
    for (const systemName of globalRegistry.listSystems()) {
      const systemDef = globalRegistry.getSystem(systemName);
      if (systemDef) {
        systems.push({
          name: systemName,
          usesLLM: systemDef.usesLLM || false,
          components: systemDef.requiredComponents || [],
          isAsync: systemDef.isAsync || false
        });
      }
    }
    
    return systems;
  }

  private renderWorldStats(entities: any[], systems: any[]) {
    const timestamp = new Date().toLocaleTimeString();
    const llmSystems = systems.filter(s => s.usesLLM).length;
    
    console.log(chalk.yellow(`⏰ ${timestamp}`) + 
                chalk.gray(' │ ') +
                chalk.green(`🌍 ${entities.length} entities`) + 
                chalk.gray(' │ ') +
                chalk.cyan(`⚙️  ${systems.length} systems`) +
                chalk.gray(' │ ') +
                chalk.magenta(`🤖 ${llmSystems} AI-powered`));
    console.log();
  }

  private renderEntities(entities: any[]) {
    if (entities.length === 0) {
      console.log(chalk.gray('  No entities in simulation'));
      console.log();
      return;
    }

    console.log(chalk.bold.white('ENTITIES:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    for (const entity of entities) {
      const typeIcon = this.getEntityIcon(entity.type);
      const typeColor = this.getEntityColor(entity.type);
      
      // Entity header
      console.log(typeColor(`${typeIcon} Entity ${entity.id} (${entity.type})`));
      
      // Components and data
      if (!this.options.compact) {
        for (const compName of entity.components) {
          const data = entity.data[compName];
          const dataStr = this.formatComponentData(data);
          console.log(chalk.gray(`  └─ ${compName}: `) + chalk.white(dataStr));
        }
      } else {
        console.log(chalk.gray(`  Components: ${entity.components.join(', ')}`));
      }
      
      console.log();
    }
  }

  private renderSystems(systems: any[]) {
    console.log(chalk.bold.white('SYSTEMS:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    for (const system of systems) {
      const icon = system.usesLLM ? '🤖' : '⚙️';
      const color = system.usesLLM ? chalk.magenta : chalk.cyan;
      const asyncLabel = system.isAsync ? chalk.yellow(' [ASYNC]') : '';
      
      console.log(color(`${icon} ${system.name}${asyncLabel}`));
      if (!this.options.compact) {
        console.log(chalk.gray(`  └─ Uses: ${system.components.join(', ') || 'no specific components'}`));
      }
    }
    console.log();
  }

  private renderThoughts() {
    if (this.lastThoughts.length === 0) {
      return;
    }

    console.log(chalk.bold.white('RECENT AI THOUGHTS:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    for (const thought of this.lastThoughts.slice(0, 5)) {
      const timeAgo = Math.floor((Date.now() - thought.timestamp) / 1000);
      console.log(chalk.green(`💭 Entity ${thought.entityId}`) + 
                  chalk.gray(` (${timeAgo}s ago): `) +
                  chalk.white(thought.thought.substring(0, 60) + '...'));
    }
    console.log();
  }

  private renderFooter() {
    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.gray('Press Ctrl+C to stop visualization'));
  }

  private getEntityIcon(type: string): string {
    switch (type) {
      case 'npc': return '👤';
      case 'animal': return '🐾';
      case 'god': return '👑';
      case 'object': return '📦';
      default: return '●';
    }
  }

  private getEntityColor(type: string) {
    switch (type) {
      case 'npc': return chalk.green;
      case 'animal': return chalk.yellow;
      case 'god': return chalk.magenta;
      case 'object': return chalk.gray;
      default: return chalk.white;
    }
  }

  private formatComponentData(data: any): string {
    if (!data || Object.keys(data).length === 0) return 'empty';
    
    const parts: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number') {
        parts.push(`${key}=${value}`);
      } else if (typeof value === 'string') {
        parts.push(`${key}="${value.substring(0, 20)}${value.length > 20 ? '...' : ''}"`);
      } else {
        parts.push(`${key}=${JSON.stringify(value).substring(0, 20)}`);
      }
    }
    return parts.join(', ');
  }
}

// Global instance for easy access
let terminalVisualizer: TerminalVisualizer | null = null;

export function startTerminalVisualization(
  world: World, 
  options?: TerminalVisualizationOptions
): TerminalVisualizer {
  if (!terminalVisualizer) {
    terminalVisualizer = new TerminalVisualizer(options);
  }
  terminalVisualizer.setWorld(world);
  terminalVisualizer.start();
  return terminalVisualizer;
}

export function getTerminalVisualizer(): TerminalVisualizer | null {
  return terminalVisualizer;
}

export function addThoughtToTerminalViz(entityId: number, thought: string) {
  if (terminalVisualizer) {
    terminalVisualizer.addThought(entityId, thought);
  }
}