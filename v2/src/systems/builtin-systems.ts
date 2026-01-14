import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, entityExists, addComponent, removeComponent, hasComponent } from "bitecs";
import { Name, Agent, Mind, Room, StimulusSource, GridPosition } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { ActionRegistry } from "../cognition/action-registry";

// =============================================================================
// REGISTER BUILTIN SYSTEM ACTIONS
// =============================================================================

// These are the core actions provided by the builtin systems
ActionRegistry.registerSystemActions("BuiltinSystems", [
  {
    name: "move",
    description: "Move to a different room/location",
    category: "movement",
    requiresTarget: true,
    requiresContent: false,
  },
  {
    name: "speak",
    description: "Say something out loud that others can hear",
    category: "social",
    requiresTarget: false,
    requiresContent: true,
  },
  {
    name: "observe",
    description: "Pay attention to someone or something",
    category: "social",
    requiresTarget: true,
    requiresContent: false,
  },
  {
    name: "interact",
    description: "Physically interact with an object or person",
    category: "interaction",
    requiresTarget: true,
    requiresContent: true,
  },
]);

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
  return {
    name: "TimeProgression",
    description: "Advances world time and triggers time-based events",
    pseudocode: "Increment time, update time of day, broadcast changes",
    frequency: 30000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      // Read current simulation time from world context (not closure!)
      const worldContext = world as any;
      let hour = worldContext.time?.simulationHour ?? 8;
      let day = worldContext.time?.simulationDay ?? 1;
      const previousTimeOfDay = worldContext.time?.timeOfDay ?? "morning";

      // Advance by 1 hour
      hour += 1;
      if (hour >= 24) {
        hour = 0;
        day += 1;
      }

      // Calculate time of day
      let newTimeOfDay = previousTimeOfDay;
      if (hour >= 5 && hour < 8) newTimeOfDay = "dawn";
      else if (hour >= 8 && hour < 12) newTimeOfDay = "morning";
      else if (hour >= 12 && hour < 14) newTimeOfDay = "midday";
      else if (hour >= 14 && hour < 18) newTimeOfDay = "afternoon";
      else if (hour >= 18 && hour < 21) newTimeOfDay = "evening";
      else if (hour >= 21 || hour < 5) newTimeOfDay = "night";

      // CRITICAL: Write back to world context so other systems can read it
      if (worldContext.time) {
        worldContext.time.simulationHour = hour;
        worldContext.time.simulationDay = day;
        worldContext.time.timeOfDay = newTimeOfDay;
      }

      // Emit time change event and update room ambience when time of day changes
      if (newTimeOfDay !== previousTimeOfDay) {
        ctx.emit("time_change", {
          hour,
          timeOfDay: newTimeOfDay,
          day,
        });
        ctx.log(`Time changed to ${newTimeOfDay} (hour ${hour}, day ${day})`);

        const rooms = Array.from(ctx.query(world, [Room]));
        for (const roomEid of rooms) {
          let ambience = Room.ambience[roomEid] || "";

          switch (newTimeOfDay) {
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

/**
 * StuckAgentRecovery - Detects and nudges agents who haven't changed state
 * This helps prevent "frozen" agents who get stuck in logic loops
 */
export function createStuckAgentRecoverySystem(): SystemDefinition {
  // Track last known state for each agent
  const agentLastState = new Map<number, { focus: string; x: number; y: number; ticks: number }>();

  return {
    name: "StuckAgentRecovery",
    description: "Detects agents who haven't moved or changed focus for too long and gives them a nudge",
    pseudocode: `
FOR EACH agent WITH Agent, Mind:
  IF agent.position AND agent.focus unchanged for 5+ ticks:
    Emit stimulus to agent: "Something catches your attention..."
    Reset stuck counter
`,
    frequency: 20000, // Every 20 seconds
    active: true,  // Enabled by default to prevent frozen agents
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, Mind])).filter(eid => entityExists(world, eid));

      for (const eid of agents) {
        const currentFocus = Mind.focus[eid] || "";
        const currentX = GridPosition?.x?.[eid] ?? 0;
        const currentY = GridPosition?.y?.[eid] ?? 0;

        const last = agentLastState.get(eid);

        if (last) {
          const sameState = last.focus === currentFocus && last.x === currentX && last.y === currentY;

          if (sameState) {
            last.ticks++;

            // After 5 unchanged observations, nudge the agent
            if (last.ticks >= 5) {
              const agentName = Name.value[eid] || `Agent_${eid}`;

              // Emit a stimulus to break them out of their loop
              ctx.emit("agent_nudge", {
                agent: agentName,
                reason: "stuck",
                stuckTicks: last.ticks
              });

              // Slightly increase arousal to encourage action
              const currentArousal = Mind.arousal[eid] || 0.5;
              Mind.arousal[eid] = Math.min(1.0, currentArousal + 0.1);

              // Add a random element to their focus to shake things up
              const nudges = [
                "something nearby",
                "a distant sound",
                "a passing thought",
                "restlessness",
                "curiosity"
              ];
              Mind.focus[eid] = nudges[Math.floor(Math.random() * nudges.length)];

              ctx.log(`[StuckRecovery] Nudged ${agentName} after ${last.ticks} stuck ticks`);

              // Reset counter
              last.ticks = 0;
            }
          } else {
            // State changed, reset counter
            last.focus = currentFocus;
            last.x = currentX;
            last.y = currentY;
            last.ticks = 0;
          }
        } else {
          // First observation
          agentLastState.set(eid, { focus: currentFocus, x: currentX, y: currentY, ticks: 0 });
        }
      }
    },
  };
}

/**
 * RoomArrival - Updates OccupiesRoom relation based on GridPosition proximity
 * This is the critical bridge between grid-based movement and room occupancy
 */
export function createRoomArrivalSystem(): SystemDefinition {
  // Threshold distance for considering an agent "in" a room
  const ARRIVAL_THRESHOLD = 3;

  return {
    name: "RoomArrival",
    description: "Updates room occupancy based on grid position proximity to rooms",
    pseudocode: `
FOR EACH agent WITH Agent, GridPosition:
  Find closest room within ARRIVAL_THRESHOLD
  IF agent is close to a new room:
    Remove old OccupiesRoom relation
    Add new OccupiesRoom relation
    Emit room_entered event
  ELSE IF agent left all rooms:
    Remove OccupiesRoom relation
    Emit room_left event
`,
    frequency: 1000, // Check every second
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, GridPosition])).filter(eid => entityExists(world, eid));
      const rooms = Array.from(ctx.query(world, [Room, GridPosition])).filter(eid => entityExists(world, eid));

      for (const agentEid of agents) {
        if (!entityExists(world, agentEid)) continue;

        const agentX = GridPosition.x[agentEid];
        const agentY = GridPosition.y[agentEid];

        if (agentX === undefined || agentY === undefined) continue;

        // Find the closest room within threshold
        let closestRoom: number | null = null;
        let closestDistance = Infinity;

        for (const roomEid of rooms) {
          if (!entityExists(world, roomEid)) continue;

          const roomX = GridPosition.x[roomEid];
          const roomY = GridPosition.y[roomEid];

          if (roomX === undefined || roomY === undefined) continue;

          const dx = roomX - agentX;
          const dy = roomY - agentY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < ARRIVAL_THRESHOLD && distance < closestDistance) {
            closestRoom = roomEid;
            closestDistance = distance;
          }
        }

        // Get current room occupancy
        const currentRooms = safeGetRelationTargets(world, agentEid, OccupiesRoom);
        const currentRoom = currentRooms.length > 0 ? currentRooms[0] : null;

        const agentName = Name.value[agentEid];

        // Handle room changes
        if (closestRoom !== null && closestRoom !== currentRoom) {
          // Agent entered a new room
          const newRoomName = Name.value[closestRoom];

          // Remove old room relation if any
          if (currentRoom !== null && entityExists(world, currentRoom)) {
            removeComponent(world, agentEid, OccupiesRoom(currentRoom));
            const oldRoomName = Name.value[currentRoom];
            ctx.emit("room_left", {
              agent: agentName,
              room: oldRoomName,
            });
          }

          // Add new room relation
          addComponent(world, agentEid, OccupiesRoom(closestRoom));

          ctx.emit("room_entered", {
            agent: agentName,
            room: newRoomName,
            position: { x: agentX, y: agentY },
          });

          ctx.log(`${agentName} entered ${newRoomName}`);
        } else if (closestRoom === null && currentRoom !== null) {
          // Agent left all rooms (in the wilderness)
          if (entityExists(world, currentRoom)) {
            const oldRoomName = Name.value[currentRoom];
            removeComponent(world, agentEid, OccupiesRoom(currentRoom));
            ctx.emit("room_left", {
              agent: agentName,
              room: oldRoomName,
            });
            ctx.log(`${agentName} left ${oldRoomName}`);
          }
        }
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
  RoomArrival: createRoomArrivalSystem,
  StuckAgentRecovery: createStuckAgentRecoverySystem,
};

/**
 * Register all built-in systems to a system registry.
 * This is the recommended way to set up a simulation with all core systems.
 *
 * Systems registered:
 * - TimeProgression: Advances world time in 24-hour cycles
 * - SocialDynamics: Updates agent arousal based on social proximity
 * - NarrativeEvents: Injects atmospheric narrative stimuli
 * - RelationshipEvolution: Strengthens familiarity between co-located agents
 * - Movement: Grid-based agent movement toward targets
 * - RoomArrival: Updates OccupiesRoom when agents reach rooms via GridPosition
 * - StuckAgentRecovery: Detects and nudges frozen agents
 */
export function registerAllBuiltinSystems(systemRegistry: { systems: Map<string, SystemDefinition> }): void {
  for (const [name, creator] of Object.entries(BUILTIN_SYSTEMS)) {
    systemRegistry.systems.set(name, creator());
  }
}

/**
 * Get an array of all builtin system names for debugging/display
 */
export function getBuiltinSystemNames(): string[] {
  return Object.keys(BUILTIN_SYSTEMS);
}
