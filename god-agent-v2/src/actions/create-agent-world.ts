/**
 * Agent World Creation Action
 * Creates nested ECS worlds for agent knowledge/perception
 */

import { z } from 'zod';
import { World, addEntity, addComponent, createWorld } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  AgentWorld,
  KnowledgeNode,
  AwareOf,
  GodMode, 
  storeString,
  getString 
} from '../components/god-components.js';
import { recordCreation } from '../agents/god-factory.js';

export const createAgentWorldSchema = z.object({
  agentName: z.string(),
  purpose: z.string().optional(),
  initialKnowledge: z.array(z.string()).optional(),
});

export type CreateAgentWorldParams = z.infer<typeof createAgentWorldSchema>;

export interface AgentWorldResult {
  success: boolean;
  agentEid?: number;
  worldId?: number;
  world?: World;
  error?: string;
}

// Global storage for agent worlds
const agentWorlds: Map<number, World> = new Map();
const worldToAgent: Map<World, number> = new Map();
let nextWorldId = 1;

export async function createAgentWorld(
  godWorld: World,
  params: CreateAgentWorldParams,
  godEid: number
): Promise<AgentWorldResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 25) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 25 to create agent worlds.',
    };
  }

  try {
    // Create the agent entity in the god world
    const agentEid = addEntity(godWorld);
    
    // Create the agent's personal world
    const agentWorld = createWorld();
    const worldId = nextWorldId++;
    
    // Store the world mapping
    agentWorlds.set(worldId, agentWorld);
    worldToAgent.set(agentWorld, agentEid);
    
    // Add AgentWorld component to the agent
    addComponent(godWorld, agentEid, AgentWorld);
    AgentWorld.worldId[agentEid] = worldId;
    AgentWorld.entityCount[agentEid] = 0;
    AgentWorld.lastActivity[agentEid] = Date.now();
    AgentWorld.owner[agentEid] = agentEid;

    // Add initial knowledge if provided
    if (params.initialKnowledge) {
      for (const knowledge of params.initialKnowledge) {
        addKnowledgeToAgent(agentWorld, agentEid, {
          type: 'fact',
          content: knowledge,
          confidence: 80,
          source: godEid
        });
      }
    }

    // Update god's creation stats
    recordCreation(godWorld, godEid);

    console.log(`✨ Created agent world for ${params.agentName} (World ID: ${worldId})`);
    if (params.initialKnowledge) {
      console.log(`   Added ${params.initialKnowledge.length} initial knowledge items`);
    }

    return {
      success: true,
      agentEid,
      worldId,
      world: agentWorld,
    };

  } catch (error) {
    console.error('Agent world creation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to get an agent's world
export function getAgentWorld(worldId: number): World | undefined {
  return agentWorlds.get(worldId);
}

// Helper to get agent from world
export function getWorldOwner(world: World): number | undefined {
  return worldToAgent.get(world);
}

// Helper to add knowledge to an agent's world
export function addKnowledgeToAgent(
  agentWorld: World,
  _sourceAgent: number,
  knowledge: {
    type: string;
    content: string;
    confidence: number;
    source: number;
  }
): number {
  const knowledgeEid = addEntity(agentWorld);
  
  addComponent(agentWorld, knowledgeEid, KnowledgeNode);
  KnowledgeNode.typeHash[knowledgeEid] = storeString(knowledge.type);
  KnowledgeNode.contentHash[knowledgeEid] = storeString(knowledge.content);
  KnowledgeNode.confidence[knowledgeEid] = knowledge.confidence;
  KnowledgeNode.source[knowledgeEid] = knowledge.source;
  KnowledgeNode.lastAccessed[knowledgeEid] = Date.now();

  return knowledgeEid;
}

// Helper to make an agent aware of another entity
export function addAwareness(
  godWorld: World,
  observerEid: number,
  targetEid: number,
  strength: number = 100,
  context?: string
): void {
  addComponent(godWorld, observerEid, AwareOf);
  
  // Find an available slot in the AwareOf arrays
  let slot = 0;
  while (AwareOf.target[slot] !== undefined) {
    slot++;
  }
  
  AwareOf.target[slot] = targetEid;
  AwareOf.strength[slot] = strength;
  AwareOf.lastUpdate[slot] = Date.now();
  
  if (context) {
    AwareOf.context[slot] = storeString(context);
  }
}

// Helper to query what an agent is aware of
export function getAgentAwareness(_agentEid: number): Array<{
  target: number;
  strength: number;
  lastUpdate: number;
  context?: string;
}> {
  const awareness: Array<{
    target: number;
    strength: number;
    lastUpdate: number;
    context?: string;
  }> = [];

  for (let i = 0; i < AwareOf.target.length; i++) {
    const target = AwareOf.target[i];
    if (target === undefined) continue;
    
    const strength = AwareOf.strength[i];
    const lastUpdate = AwareOf.lastUpdate[i];
    const contextHash = AwareOf.context[i];
    
    awareness.push({
      target,
      strength,
      lastUpdate,
      context: contextHash ? getString(contextHash) : undefined
    });
  }

  return awareness;
}

// Helper to transfer knowledge between agents
export function shareKnowledge(
  godWorld: World,
  fromAgentEid: number,
  toAgentEid: number,
  knowledgeContent: string,
  confidence: number = 70
): boolean {
  // Get the target agent's world
  const toWorldId = AgentWorld.worldId[toAgentEid];
  const toAgentWorld = getAgentWorld(toWorldId);
  
  if (!toAgentWorld) {
    console.error(`No world found for agent ${toAgentEid}`);
    return false;
  }

  // Add the knowledge to the target agent's world
  addKnowledgeToAgent(toAgentWorld, toAgentEid, {
    type: 'shared_knowledge',
    content: knowledgeContent,
    confidence,
    source: fromAgentEid
  });

  // Make the target agent aware of the source agent
  addAwareness(godWorld, toAgentEid, fromAgentEid, 80, 'shared knowledge');

  return true;
}

// Helper to create a knowledge relationship between entities in an agent's world
export function createKnowledgeRelation(
  _agentWorld: World,
  subjectEid: number,
  relationshipName: string,
  targetEid: number,
  properties?: Record<string, any>
): boolean {
  const relationshipDef = globalRegistry.getRelationship(relationshipName);
  if (!relationshipDef) {
    console.error(`Relationship ${relationshipName} not found`);
    return false;
  }

  const relationship = relationshipDef.relationship;
  
  // Find next available index
  let index = 0;
  while (relationship.subject[index] !== undefined) {
    index++;
  }

  // Set the relationship
  relationship.subject[index] = subjectEid;
  relationship.target[index] = targetEid;

  // Set custom properties if provided
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (key in relationship) {
        if (typeof value === 'string' && `${key}Store` in relationship) {
          const hash = storeString(value);
          relationship[key][index] = hash;
          relationship[`${key}Store`][hash] = value;
        } else if (typeof value === 'boolean') {
          relationship[key][index] = value ? 1 : 0;
        } else if (typeof value === 'number') {
          relationship[key][index] = value;
        }
      }
    }
  }

  return true;
}