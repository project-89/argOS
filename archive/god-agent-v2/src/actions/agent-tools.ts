/**
 * Agent Conversation and Interaction Tools
 * Inspired by npcSimulation.ts - gives agents ability to interact
 */

import { z } from 'zod';
import { World, addEntity, addComponent, query, hasComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  Agent,
  storeString,
  getString 
} from '../components/god-components.js';
import { 
  addAwareness
} from './create-agent-world.js';

// Component for tracking what an agent is saying
export const Talking = {
  saying: [] as number[],      // Hash of what's being said
  sayingStore: {} as Record<number, string>,
  timer: [] as number[],       // How long the message displays
  target: [] as number[],      // Who they're talking to (optional)
};

// Component for tracking agent targets
export const Targeting = {
  target: [] as number[],      // Entity being targeted
  action: [] as number[],      // What action to take (approach, interact, etc)
  distance: [] as number[],    // Distance to target
};

// Component for agent thoughts
export const Thinking = {
  thoughtHash: [] as number[], // Current thought
  thoughtStore: {} as Record<number, string>,
  confidence: [] as number[],  // How confident in this thought
  timestamp: [] as number[],   // When thought occurred
};

// Register these as core components
globalRegistry.registerComponent('Talking', {
  name: 'Talking',
  schema: {
    description: 'Tracks what an agent is currently saying',
    properties: [
      { name: 'saying', type: 'string', description: 'What is being said' },
      { name: 'timer', type: 'number', description: 'Display duration' },
      { name: 'target', type: 'eid', description: 'Who they are talking to' }
    ]
  },
  component: Talking,
  timestamp: Date.now()
});

globalRegistry.registerComponent('Targeting', {
  name: 'Targeting',
  schema: {
    description: 'Tracks what an agent is targeting',
    properties: [
      { name: 'target', type: 'eid', description: 'Entity being targeted' },
      { name: 'action', type: 'number', description: 'Action type' },
      { name: 'distance', type: 'number', description: 'Distance to target' }
    ]
  },
  component: Targeting,
  timestamp: Date.now()
});

globalRegistry.registerComponent('Thinking', {
  name: 'Thinking',
  schema: {
    description: 'Tracks agent thoughts',
    properties: [
      { name: 'thought', type: 'string', description: 'Current thought' },
      { name: 'confidence', type: 'number', description: 'Thought confidence' },
      { name: 'timestamp', type: 'number', description: 'When thought occurred' }
    ]
  },
  component: Thinking,
  timestamp: Date.now()
});

// Tool schemas
export const talkSchema = z.object({
  agentId: z.number(),
  message: z.string(),
  targetId: z.number().optional(),
});

export const approachSchema = z.object({
  agentId: z.number(),
  targetId: z.number(),
  reason: z.string().optional(),
});

export const lookAroundSchema = z.object({
  agentId: z.number(),
  radius: z.number().optional().default(100),
});

export const thinkSchema = z.object({
  agentId: z.number(),
  thought: z.string(),
  confidence: z.number().min(0).max(100).optional().default(80),
});

// Talk action
export function talk(
  world: World,
  params: z.infer<typeof talkSchema>
): { success: boolean; heard?: number[] } {
  const { agentId, message, targetId } = params;
  
  // Add talking component
  addComponent(world, agentId, Talking);
  const hash = storeString(message);
  Talking.saying[agentId] = hash;
  Talking.sayingStore[hash] = message;
  Talking.timer[agentId] = Date.now();
  if (targetId !== undefined) {
    Talking.target[agentId] = targetId;
  }
  
  // Make nearby agents aware of the speech
  const heard: number[] = [];
  const agents = query(world, [Agent]);
  
  for (const otherAgent of agents) {
    if (otherAgent === agentId) continue;
    
    // Simple awareness - in real implementation would check distance
    addAwareness(world, otherAgent, agentId, 70, `heard saying: "${message}"`);
    heard.push(otherAgent);
    
    // If talking to specific target, increase their awareness
    if (targetId === otherAgent) {
      addAwareness(world, otherAgent, agentId, 90, `directly addressed`);
    }
  }
  
  console.log(`🗣️ Agent ${agentId} says: "${message}"`);
  if (targetId !== undefined) {
    console.log(`   (to Agent ${targetId})`);
  }
  
  return { success: true, heard };
}

// Approach action
export function approach(
  world: World,
  params: z.infer<typeof approachSchema>
): { success: boolean } {
  const { agentId, targetId, reason } = params;
  
  // Set targeting
  addComponent(world, agentId, Targeting);
  Targeting.target[agentId] = targetId;
  Targeting.action[agentId] = 1; // 1 = approach
  Targeting.distance[agentId] = 100; // Start at some distance
  
  // Make both aware of each other
  addAwareness(world, agentId, targetId, 80, reason || 'approaching');
  addAwareness(world, targetId, agentId, 60, 'being approached');
  
  console.log(`🚶 Agent ${agentId} approaches Agent ${targetId}`);
  if (reason) {
    console.log(`   Reason: ${reason}`);
  }
  
  return { success: true };
}

// Look around action
export function lookAround(
  world: World,
  params: z.infer<typeof lookAroundSchema>
): { entities: number[]; descriptions: string[] } {
  const { agentId } = params;
  
  // Get all entities (in real implementation would check distance)
  const allEntities = query(world, []);
  const nearbyEntities: number[] = [];
  const descriptions: string[] = [];
  
  for (const eid of allEntities) {
    if (eid === agentId) continue;
    
    // Check if it's an agent
    if (hasComponent(world, eid, Agent)) {
      const nameHash = Agent.nameHash[eid];
      const name = nameHash ? getString(nameHash) : `Agent ${eid}`;
      nearbyEntities.push(eid);
      descriptions.push(name);
      
      // Make agent aware
      addAwareness(world, agentId, eid, 50, 'noticed while looking around');
    }
  }
  
  console.log(`👀 Agent ${agentId} looks around and sees:`);
  descriptions.forEach(desc => console.log(`   - ${desc}`));
  
  return { entities: nearbyEntities, descriptions };
}

// Think action
export function think(
  world: World,
  params: z.infer<typeof thinkSchema>
): { success: boolean } {
  const { agentId, thought, confidence } = params;
  
  // Add thinking component
  addComponent(world, agentId, Thinking);
  const hash = storeString(thought);
  Thinking.thoughtHash[agentId] = hash;
  Thinking.thoughtStore[hash] = thought;
  Thinking.confidence[agentId] = confidence;
  Thinking.timestamp[agentId] = Date.now();
  
  // Also add to agent's knowledge world if available
  // Note: We need to check if agent has an AgentWorld component
  if (hasComponent(world, agentId, Agent)) {
    // In a real implementation, we would track agent worlds differently
    // For now, just log the thought
    console.log(`   (stored in agent's knowledge)`);
  }
  
  console.log(`💭 Agent ${agentId} thinks: "${thought}" (confidence: ${confidence}%)`);
  
  return { success: true };
}

// Create task action (for planning)
export function createTask(
  world: World,
  taskName: string,
  description: string,
  assignedTo?: number
): number {
  const taskEid = addEntity(world);
  
  // In production, would have a Task component
  console.log(`📋 Created task: ${taskName}`);
  console.log(`   Description: ${description}`);
  if (assignedTo !== undefined) {
    console.log(`   Assigned to: Agent ${assignedTo}`);
  }
  
  return taskEid;
}

// System to process talking (remove old messages)
export function TalkingSystem(world: World): void {
  const talking = query(world, [Talking]);
  const now = Date.now();
  
  for (const eid of talking) {
    const elapsed = now - Talking.timer[eid];
    
    // Remove talking after 5 seconds
    if (elapsed > 5000) {
      const hash = Talking.saying[eid];
      delete Talking.sayingStore[hash];
      delete Talking.saying[eid];
      delete Talking.timer[eid];
      delete Talking.target[eid];
    }
  }
}

// System to process targeting (move towards targets)
export function TargetingSystem(world: World): void {
  const targeting = query(world, [Targeting]);
  
  for (const eid of targeting) {
    const target = Targeting.target[eid];
    const action = Targeting.action[eid];
    let distance = Targeting.distance[eid];
    
    if (action === 1 && distance > 0) { // Approach
      // Simulate moving closer
      distance = Math.max(0, distance - 10);
      Targeting.distance[eid] = distance;
      
      if (distance === 0) {
        console.log(`✅ Agent ${eid} reached target ${target}`);
        // Could trigger interaction here
      }
    }
  }
}

// Register these systems
globalRegistry.registerSystem('TalkingSystem', {
  name: 'TalkingSystem',
  description: 'Manages agent speech and removes old messages',
  requiredComponents: ['Talking'],
  systemFn: TalkingSystem,
  timestamp: Date.now()
});

globalRegistry.registerSystem('TargetingSystem', {
  name: 'TargetingSystem',
  description: 'Manages agent targeting and movement',
  requiredComponents: ['Targeting'],
  systemFn: TargetingSystem,
  timestamp: Date.now()
});