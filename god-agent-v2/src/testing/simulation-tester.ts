/**
 * Simulation Testing Utilities
 * Tools for God to test and validate simulation behavior
 */

import { World, query } from 'bitecs';
import { globalRegistry } from '../components/registry.js';

export interface SimulationSnapshot {
  entityCount: number;
  componentCounts: Record<string, number>;
  sampleData: Record<string, any>;
  timestamp: number;
}

export function captureSimulationState(world: World, whatToWatch?: string[]): SimulationSnapshot {
  const snapshot: SimulationSnapshot = {
    entityCount: 0,
    componentCounts: {},
    sampleData: {},
    timestamp: Date.now()
  };

  // Count entities for each component
  const components = globalRegistry.listComponents();
  for (const componentName of components) {
    const comp = globalRegistry.getComponent(componentName);
    if (comp) {
      try {
        const entities = query(world, [comp.component]);
        snapshot.componentCounts[componentName] = entities.length;
        snapshot.entityCount = Math.max(snapshot.entityCount, entities.length);

        // Sample data if watching this component
        if (whatToWatch?.includes(componentName) && entities.length > 0) {
          const sampleEntity = entities[0];
          const sampleData: any = {};
          
          if (comp.component && typeof comp.component === 'object') {
            for (const [key, array] of Object.entries(comp.component)) {
              if (Array.isArray(array) && array[sampleEntity] !== undefined) {
                sampleData[key] = array[sampleEntity];
              }
            }
          }
          
          snapshot.sampleData[componentName] = sampleData;
        }
      } catch (error) {
        // Skip components that can't be queried
      }
    }
  }

  return snapshot;
}

export function captureQuickSnapshot(world: World): Record<string, any> {
  const snapshot: Record<string, any> = {
    totalEntities: 0,
    components: {}
  };

  const components = globalRegistry.listComponents();
  for (const componentName of components) {
    const comp = globalRegistry.getComponent(componentName);
    if (comp) {
      try {
        const entities = query(world, [comp.component]);
        snapshot.components[componentName] = entities.length;
        snapshot.totalEntities = Math.max(snapshot.totalEntities, entities.length);
      } catch (error) {
        // Skip
      }
    }
  }

  return snapshot;
}

export function generateSimulationReport(
  results: Array<{ step: number; state: SimulationSnapshot }>,
  _whatToWatch?: string[]
): { summary: string; details: any } {
  if (results.length < 2) {
    return { 
      summary: 'Insufficient data for analysis', 
      details: {} 
    };
  }

  const initial = results[0].state;
  const final = results[results.length - 1].state;
  
  const entityChange = final.entityCount - initial.entityCount;
  const componentChanges: Record<string, number> = {};
  
  for (const [component, finalCount] of Object.entries(final.componentCounts)) {
    const initialCount = initial.componentCounts[component] || 0;
    componentChanges[component] = finalCount - initialCount;
  }

  // Generate summary
  let summary = `Simulation ran for ${final.timestamp - initial.timestamp}ms. `;
  
  if (entityChange !== 0) {
    summary += `Entity count changed by ${entityChange > 0 ? '+' : ''}${entityChange}. `;
  } else {
    summary += 'Entity count remained stable. ';
  }

  const significantChanges = Object.entries(componentChanges)
    .filter(([_, change]) => Math.abs(change) > 0)
    .slice(0, 3);

  if (significantChanges.length > 0) {
    const changeDesc = significantChanges
      .map(([comp, change]) => `${comp}: ${change > 0 ? '+' : ''}${change}`)
      .join(', ');
    summary += `Component changes: ${changeDesc}.`;
  }

  return {
    summary,
    details: {
      duration: final.timestamp - initial.timestamp,
      steps: results.length - 1,
      entityChange,
      componentChanges,
      sampleData: final.sampleData
    }
  };
}

export function analyzeBehaviorChange(
  initial: Record<string, any>,
  final: Record<string, any>,
  expectedBehavior: string
): boolean {
  // Simple heuristic analysis
  const behaviorLower = expectedBehavior.toLowerCase();
  
  if (behaviorLower.includes('increase') || behaviorLower.includes('grow')) {
    return final.totalEntities > initial.totalEntities;
  }
  
  if (behaviorLower.includes('decrease') || behaviorLower.includes('shrink')) {
    return final.totalEntities < initial.totalEntities;
  }
  
  if (behaviorLower.includes('stable') || behaviorLower.includes('constant')) {
    return final.totalEntities === initial.totalEntities;
  }
  
  if (behaviorLower.includes('move') || behaviorLower.includes('change')) {
    // Check if any component counts changed
    for (const [component, count] of Object.entries(final.components)) {
      if (initial.components[component] !== count) {
        return true;
      }
    }
    return false;
  }
  
  // Default: assume behavior occurred if anything changed
  return JSON.stringify(initial) !== JSON.stringify(final);
}