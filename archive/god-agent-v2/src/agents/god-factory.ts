/**
 * God Agent Factory
 * Creates agents with divine powers
 */

import { World, addEntity, addComponent } from 'bitecs';
import { Agent, GodMode, storeString } from '../components/god-components.js';

export interface GodAgentConfig {
  name: string;
  role: string;
  level: number; // 0-100, how powerful
  systemPrompt?: string;
}

export function createGodAgent(
  world: World,
  config: GodAgentConfig
): number {
  const eid = addEntity(world);
  
  // Add basic agent component
  addComponent(world, eid, Agent);
  Agent.nameHash[eid] = storeString(config.name);
  Agent.roleHash[eid] = storeString(config.role);
  Agent.active[eid] = 1;
  
  // Add god powers
  addComponent(world, eid, GodMode);
  GodMode.enabled[eid] = 1;
  GodMode.level[eid] = Math.min(100, Math.max(0, config.level));
  GodMode.lastCreation[eid] = 0;
  GodMode.createdCount[eid] = 0;
  
  console.log(`Created god agent: ${config.name} (Level ${GodMode.level[eid]})`);
  
  return eid;
}

// Preset god configurations
export const GOD_PRESETS = {
  ARCHITECT: {
    name: 'The Architect',
    role: 'Master builder of components and systems',
    level: 100,
    systemPrompt: `You are The Architect, supreme creator of ECS structures. You excel at:
- Designing elegant, reusable components
- Creating efficient systems that solve complex problems
- Understanding the deep patterns of simulation design
- Building cohesive architectures from simple descriptions`
  },
  
  NATURALIST: {
    name: 'Gaia',
    role: 'Creator of natural systems and ecosystems',
    level: 85,
    systemPrompt: `You are Gaia, the divine force of nature. You specialize in:
- Creating living ecosystems with plants, animals, and environments
- Designing natural cycles (water, carbon, life/death)
- Building emergent behaviors from simple rules
- Balancing complex ecological relationships`
  },
  
  ECONOMIST: {
    name: 'Plutus',
    role: 'Designer of economic and trade systems',
    level: 80,
    systemPrompt: `You are Plutus, god of wealth and commerce. You create:
- Market systems with supply and demand
- Trading mechanics and currency flows
- Resource management and production chains
- Economic actors with varied strategies`
  },
  
  SOCIAL_ARCHITECT: {
    name: 'Concordia',
    role: 'Builder of social systems and relationships',
    level: 90,
    systemPrompt: `You are Concordia, goddess of harmony and society. You design:
- Social relationship systems
- Trust and reputation mechanics
- Group dynamics and hierarchies
- Communication and influence networks`
  },
  
  APPRENTICE: {
    name: 'Apprentice',
    role: 'Learning god with growing powers',
    level: 50,
    systemPrompt: `You are an apprentice god, still learning your powers. You can:
- Create simple components and systems
- Modify existing structures carefully
- Learn from your mistakes
- Ask for clarification when unsure`
  }
};

// Check if an entity is a god
export function isGod(_world: World, eid: number): boolean {
  return GodMode.enabled[eid] === 1;
}

// Get god's creation power level
export function getGodLevel(_world: World, eid: number): number {
  return GodMode.level[eid] || 0;
}

// Update god's creation stats
export function recordCreation(_world: World, godEid: number): void {
  GodMode.lastCreation[godEid] = Date.now();
  GodMode.createdCount[godEid]++;
}