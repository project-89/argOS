import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, entityExists } from "bitecs";
import { Name, Agent, Mind, Room, StimulusSource, GridPosition } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

// Track movement targets for agents (agentEid -> targetEid)
const movementTargets = new Map<number, number>();

// Set a movement target for an agent
export function setMovementTarget(agentEid: number, targetEid: number): void {
  movementTargets.set(agentEid, targetEid);
}

// Clear a movement target
export function clearMovementTarget(agentEid: number): void {
  movementTargets.delete(agentEid);
}

// Get movement target
export function getMovementTarget(agentEid: number): number | undefined {
  return movementTargets.get(agentEid);
}

export function createTimeProgressionSystem(): SystemDefinition {
  let worldTime = 0;
  let timeOfDay = "evening";
  
  return {
    name: "TimeProgression",
    description: "Advances world time and triggers time-based events",
    pseudocode: "Increment time, update time of day, broadcast changes",
    frequency: 30000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      worldTime += 1;
      
      const hour = worldTime % 24;
      let newTimeOfDay = timeOfDay;
      
      if (hour >= 5 && hour < 8) newTimeOfDay = "dawn";
      else if (hour >= 8 && hour < 12) newTimeOfDay = "morning";
      else if (hour >= 12 && hour < 14) newTimeOfDay = "midday";
      else if (hour >= 14 && hour < 18) newTimeOfDay = "afternoon";
      else if (hour >= 18 && hour < 21) newTimeOfDay = "evening";
      else if (hour >= 21 || hour < 5) newTimeOfDay = "night";
      
      if (newTimeOfDay !== timeOfDay) {
        timeOfDay = newTimeOfDay;
        ctx.emit("time_change", { 
          hour, 
          timeOfDay,
          worldTime 
        });
        ctx.log(`Time changed to ${timeOfDay} (hour ${hour})`);
        
        const rooms = Array.from(ctx.query(world, [Room]));
        for (const roomEid of rooms) {
          const baseName = Name.value[roomEid];
          let ambience = Room.ambience[roomEid] || "";
          
          switch (timeOfDay) {
            case "dawn":
              ambience = "Soft light filters through windows as the world awakens.";
              break;
            case "morning":
              ambience = "Bright morning light fills the space with warmth.";
              break;
            case "midday":
              ambience = "The sun is at its peak, casting sharp shadows.";
              break;
            case "afternoon":
              ambience = "Golden afternoon light creates a lazy atmosphere.";
              break;
            case "evening":
              ambience = "Lanterns are lit as dusk settles in.";
              break;
            case "night":
              ambience = "Darkness reigns outside, punctuated by candlelight within.";
              break;
          }
          
          Room.ambience[roomEid] = ambience;
        }
      }
    },
  };
}

export function createSocialDynamicsSystem(): SystemDefinition {
  return {
    name: "SocialDynamics",
    description: "Updates agent arousal based on social context",
    pseudocode: "For each agent, adjust arousal based on others present",
    frequency: 15000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, Mind])).filter(eid => entityExists(world, eid));

      for (const eid of agents) {
        if (!entityExists(world, eid)) continue;

        const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
        if (rooms.length === 0) continue;

        const roomEid = rooms[0];
        if (!entityExists(world, roomEid)) continue;

        let othersCount = 0;

        for (const otherEid of agents) {
          if (otherEid === eid) continue;
          if (!entityExists(world, otherEid)) continue;

          const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
          if (otherRooms.includes(roomEid)) {
            othersCount++;
          }
        }

        const currentArousal = Mind.arousal[eid];
        if (othersCount > 0 && currentArousal < 0.6) {
          Mind.arousal[eid] = Math.min(1, currentArousal + 0.05 * othersCount);
        } else if (othersCount === 0 && currentArousal > 0.4) {
          Mind.arousal[eid] = Math.max(0, currentArousal - 0.02);
        }
      }
    },
  };
}

export function createNarrativeEventSystem(): SystemDefinition {
  const events = [
    "A distant church bell tolls.",
    "Thunder rumbles in the distance.",
    "The wind picks up outside, rattling the windows.",
    "Someone in the street outside shouts an unintelligible warning.",
    "A dog barks somewhere nearby.",
    "The fire crackles and pops, sending up a shower of sparks.",
    "A serving wench hurries past with a tray of drinks.",
    "The door creaks as if someone is about to enter... but no one does.",
    "A cold draft sweeps through the room.",
    "The candles flicker mysteriously.",
  ];
  
  let lastEventIndex = -1;
  
  return {
    name: "NarrativeEvents",
    description: "Periodically injects atmospheric narrative events",
    pseudocode: "Randomly emit environmental stimuli to create atmosphere",
    frequency: 45000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      if (Math.random() > 0.6) return;
      
      let eventIndex = Math.floor(Math.random() * events.length);
      while (eventIndex === lastEventIndex && events.length > 1) {
        eventIndex = Math.floor(Math.random() * events.length);
      }
      lastEventIndex = eventIndex;
      
      const event = events[eventIndex];
      
      ctx.emit("narrative_event", {
        type: "environmental",
        content: event,
        timestamp: ctx.elapsed,
      });
      
      ctx.log(`Narrative: "${event}"`);
    },
  };
}

export function createRelationshipEvolutionSystem(): SystemDefinition {
  return {
    name: "RelationshipEvolution",
    description: "Evolves relationships between agents over time based on proximity",
    pseudocode: "For agents in same room, strengthen familiarity",
    frequency: 60000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent])).filter(eid => entityExists(world, eid));

      const agentsByRoom = new Map<number, number[]>();
      for (const eid of agents) {
        if (!entityExists(world, eid)) continue;

        const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
        if (rooms.length > 0) {
          const roomEid = rooms[0];
          if (!entityExists(world, roomEid)) continue;

          if (!agentsByRoom.has(roomEid)) {
            agentsByRoom.set(roomEid, []);
          }
          agentsByRoom.get(roomEid)!.push(eid);
        }
      }

      for (const [roomEid, roomAgents] of agentsByRoom) {
        if (!entityExists(world, roomEid)) continue;
        if (roomAgents.length < 2) continue;

        for (let i = 0; i < roomAgents.length; i++) {
          if (!entityExists(world, roomAgents[i])) continue;
          for (let j = i + 1; j < roomAgents.length; j++) {
            if (!entityExists(world, roomAgents[j])) continue;

            const name1 = Name.value[roomAgents[i]];
            const name2 = Name.value[roomAgents[j]];

            ctx.emit("relationship_update", {
              agent1: name1,
              agent2: name2,
              type: "proximity",
              change: 0.01,
            });
          }
        }
      }
    },
  };
}

export function createMovementSystem(): SystemDefinition {
  return {
    name: "Movement",
    description: "Moves agents towards their targets on the grid",
    pseudocode: "For each agent with a target, move one step closer",
    frequency: 500, // Move every 500ms for smoother movement
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, GridPosition])).filter(eid => entityExists(world, eid));

      for (const agentEid of agents) {
        if (!entityExists(world, agentEid)) continue;

        const targetEid = movementTargets.get(agentEid);
        if (!targetEid || !entityExists(world, targetEid)) continue;

        // Get current and target positions
        const currentX = GridPosition.x[agentEid];
        const currentY = GridPosition.y[agentEid];
        const targetX = GridPosition.x[targetEid];
        const targetY = GridPosition.y[targetEid];

        if (currentX === undefined || currentY === undefined ||
            targetX === undefined || targetY === undefined) continue;

        // Calculate distance
        const dx = targetX - currentX;
        const dy = targetY - currentY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If close enough, stop moving
        if (distance < 2) {
          movementTargets.delete(agentEid);
          ctx.emit("movement_complete", {
            agent: Name.value[agentEid],
            target: Name.value[targetEid],
            position: { x: currentX, y: currentY }
          });
          continue;
        }

        // Move one step towards target
        const stepSize = 1;
        let newX = currentX;
        let newY = currentY;

        if (Math.abs(dx) > Math.abs(dy)) {
          newX = currentX + (dx > 0 ? stepSize : -stepSize);
        } else if (dy !== 0) {
          newY = currentY + (dy > 0 ? stepSize : -stepSize);
        }

        // Update position
        GridPosition.x[agentEid] = newX;
        GridPosition.y[agentEid] = newY;

        const agentName = Name.value[agentEid];
        const targetName = Name.value[targetEid];

        ctx.emit("agent_moved", {
          agent: agentName,
          from: { x: currentX, y: currentY },
          to: { x: newX, y: newY },
          target: targetName,
          distance: Math.round(distance)
        });
      }
    },
  };
}

export const BUILTIN_SYSTEMS = {
  TimeProgression: createTimeProgressionSystem,
  SocialDynamics: createSocialDynamicsSystem,
  NarrativeEvents: createNarrativeEventSystem,
  RelationshipEvolution: createRelationshipEvolutionSystem,
  Movement: createMovementSystem,
};
