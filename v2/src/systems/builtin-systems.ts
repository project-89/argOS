import { stampGoalTiming } from "../ecs/temporal-age";
import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext } from "../ecs/dynamic-systems";
import { query, entityExists, addComponent, removeComponent, hasComponent, getRelationTargets, addEntity } from "bitecs";
import { Name, Agent, Mind, Room, StimulusSource, GridPosition, Needs, ObjectState, Goal, PhysicalObject, Container, BehaviorPolicy } from "../ecs/components";
import { LocatedIn, SleepingOn, HasGoal, HasPlan } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../ecs/location";
import { getDynamicComponentValue } from "../ecs/dynamic-components";
import { ActionRegistry } from "../cognition/action-registry";
import { setGoalContract } from "../cognition/goal-contract";
import { retireGoalPlans } from "../cognition/plan-state";
import { goalEvaluationSystem } from "./goal-evaluation-system";
import { goalCleanupSystem, goalPursuitSystem, needsBasedMovementSystem, scheduleExecutionSystem } from "./deterministic-behavior-systems";
import { getAgentWorldCapabilities } from "../cognition/world-capabilities";
import { ensureSchedulesForCurrentDay, runScheduleSystem } from "../cognition/schedule-system";
import { createScheduleAdaptationSystem } from "../cognition/schedule-adaptation";
import { createDayPlanActivationSystem, createDayPlanPreplannerSystem, createScheduledActivityGoalSystem, createScheduledActivityTemplatePlannerSystem } from "./scheduled-activity-systems";
import { createOfficeToolJobSystem } from "./office-tool-job-system";
import { createRepoIntegratorSystem } from "./repo-integrator-system";
import { isResting, updateRestState } from "../cognition/rest-state";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { readSimulationTime } from "../ecs/simulation-time";

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
  const observedPhases = new WeakMap<World, string>();
  return {
    name: "TimeProgression",
    description: "Projects the authoritative simulation calendar into ambience and time-change events",
    pseudocode: "Observe simulation calendar and broadcast phase changes",
    frequency: 0,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      // Physics, calendar and action intervals share one clock. This system is
      // a projection, not a second clock that adds an hour every wall 30 seconds.
      const { simulationHour: hour, simulationDay: day, timeOfDay: newTimeOfDay } = world.time;
      const previousTimeOfDay = observedPhases.get(world) ?? "morning";
      observedPhases.set(world, newTimeOfDay);

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

/**
 * DailySchedulePlanner - Ensures every active agent has a daily schedule for the current sim day.
 *
 * - Deterministic by default (installs baseline rhythms, carries existing daily routines forward).
 * - If `world.meta.generateSchedules` is true and LLM is enabled, regenerates schedules daily via LLM.
 */
export function createDailySchedulePlannerSystem(): SystemDefinition {
  return {
    name: "DailySchedulePlanner",
    description: "Installs baseline routines or carries existing schedules forward; replans only when enabled",
    pseudocode: `
FOR EACH active agent:
  IF no Schedule OR Schedule.plannedDay != world.time.simulationDay:
    create a baseline if missing; otherwise carry it forward (LLM replan only if enabled)
`,
    frequency: 2000,
    active: true,
    lastRun: 0,
    async: true,
    compiledFn: async (world: World, ctx: SystemContext) => {
      const meta = (world as any).meta || {};
      const aiEnabled = meta.aiEnabled === true;
      const generateSchedules = meta.generateSchedules === true;
      const hasKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
      const useLLM = aiEnabled && generateSchedules && hasKey;

      const maxAgents = useLLM ? 1 : 50;
      const result = await ensureSchedulesForCurrentDay(world as any, { useLLM, maxAgents });
      if (result.created > 0 || result.regenerated > 0 || result.carriedForward > 0) {
        ctx.log(`[SchedulePlanner] created=${result.created} regenerated=${result.regenerated} carriedForward=${result.carriedForward} (useLLM=${useLLM})`);
      }
    },
  };
}

/**
 * ScheduleSystem - Tracks each agent's current scheduled activity.
 */
export function createScheduleSystem(): SystemDefinition {
  return {
    name: "ScheduleSystem",
    description: "Updates agents' current scheduled activities based on world time",
    pseudocode: `
FOR EACH agent WITH Schedule:
  Determine current activity from world.time.simulationHour
  Update Schedule.currentActivity when it changes
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World) => {
      runScheduleSystem(world as any);
    },
  };
}

/**
 * ScheduleExecutionSystem - Creates movement goals so agents follow their schedules.
 */
export function createScheduleExecutionSystem(): SystemDefinition {
  return {
    name: "ScheduleExecutionSystem",
    description: "Creates movement goals to satisfy scheduled activities with preferred locations",
    pseudocode: `
FOR EACH agent WITH Schedule:
  If current activity has a location and agent isn't there:
    create Goal: move_to_room(location)
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      scheduleExecutionSystem(world, ctx);
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

        const roomEid = getRoomForEntity(world, eid);
        if (roomEid === undefined || !entityExists(world, roomEid)) continue;

        let othersCount = 0;

        for (const otherEid of agents) {
          if (otherEid === eid) continue;
          if (!entityExists(world, otherEid)) continue;

          const otherRoomEid = getRoomForEntity(world, otherEid);
          if (otherRoomEid === roomEid) {
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

        const roomEid = getRoomForEntity(world, eid);
        if (roomEid !== undefined) {
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
  const budgets = new WeakMap<World, Map<number, { target: number; ms: number }>>();
  return {
    name: "Movement",
    description: "Moves agents towards their targets on the grid",
    pseudocode: "Integrate one grid step per 500 in-world milliseconds toward each native target",
    frequency: 0,
    active: true,
    lastRun: 0,
    nextDeadline: world => {
      const worldBudgets = budgets.get(world), now = readSimulationTime(world);
      let next: number | undefined;
      for (const eid of query(world, [Agent, GridPosition])) {
        const target = movementTargets.get(eid);
        if (!Agent.active[eid] || target === undefined || !entityExists(world, target)
          || isSimulationResourceBusy(world, eid, "body") || getAgentWorldCapabilities(world, eid)?.ownsMovement
          || getAgentWorldCapabilities(world, eid)?.busy()) continue;
        const coords = [GridPosition.x[eid], GridPosition.y[eid], GridPosition.x[target], GridPosition.y[target]];
        if (!coords.every(Number.isFinite) || Math.hypot(coords[2] - coords[0], coords[3] - coords[1]) < 2) continue;
        const budget = worldBudgets?.get(eid), due = now + 500 - (budget?.target === target ? budget.ms : 0);
        next = next === undefined ? due : Math.min(next, due);
      }
      return next;
    },
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, GridPosition])).filter(eid => entityExists(world, eid));
      let worldBudgets = budgets.get(world);
      if (!worldBudgets) budgets.set(world, worldBudgets = new Map());
      for (const eid of worldBudgets.keys()) if (!entityExists(world, eid)) worldBudgets.delete(eid);

      for (const agentEid of agents) {
        if (!entityExists(world, agentEid)) continue;

        const targetEid = movementTargets.get(agentEid);
        if (isSimulationResourceBusy(world, agentEid, "body") || getAgentWorldCapabilities(world, agentEid)?.ownsMovement || getAgentWorldCapabilities(world, agentEid)?.busy()
          || targetEid === undefined || !entityExists(world, targetEid)) {
          worldBudgets.delete(agentEid);
          continue;
        }

        // Get current and target positions
        const currentX = GridPosition.x[agentEid];
        const currentY = GridPosition.y[agentEid];
        const targetX = GridPosition.x[targetEid];
        const targetY = GridPosition.y[targetEid];

        if (![currentX, currentY, targetX, targetY].every(Number.isFinite)) {
          worldBudgets.delete(agentEid);
          continue;
        }

        // Calculate distance
        const dx = targetX - currentX;
        const dy = targetY - currentY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If close enough, stop moving
        if (distance < 2) {
          movementTargets.delete(agentEid);
          worldBudgets.delete(agentEid);
          ctx.emit("movement_complete", {
            agent: Name.value[agentEid],
            target: Name.value[targetEid],
            position: { x: currentX, y: currentY }
          });
          continue;
        }

        const previousBudget = worldBudgets.get(agentEid);
        const availableMs = (previousBudget?.target === targetEid ? previousBudget.ms : 0) + ctx.delta;
        const availableSteps = Math.floor(availableMs / 500);
        worldBudgets.set(agentEid, { target: targetEid, ms: availableMs % 500 });
        if (availableSteps <= 0) continue;

        // Keep the existing axis-aligned grid route, but consume its physical
        // step budget rather than taking one step per arbitrary executor call.
        let newX = currentX;
        let newY = currentY;
        for (let step = 0; step < availableSteps; step++) {
          const remainingX = targetX - newX;
          const remainingY = targetY - newY;
          if (Math.hypot(remainingX, remainingY) < 2) break;
          if (Math.abs(remainingX) > Math.abs(remainingY)) newX += Math.sign(remainingX);
          else if (remainingY !== 0) newY += Math.sign(remainingY);
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
        if (Math.hypot(targetX - newX, targetY - newY) < 2) {
          movementTargets.delete(agentEid);
          worldBudgets.delete(agentEid);
          ctx.emit("movement_complete", {
            agent: agentName, target: targetName, position: { x: newX, y: newY },
          });
        }
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
 * RoomArrival - Updates LocatedIn(room) based on GridPosition proximity
 * This is the critical bridge between grid-based movement and room occupancy
 */
export function createRoomArrivalSystem(): SystemDefinition {
  // Threshold distance for considering an agent "in" a room when we lack zone geometry.
  const ARRIVAL_THRESHOLD = 3;

  function pointInPoly(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInRoomZone(agentX: number, agentY: number, roomEid: number): boolean {
    const kind = String(getDynamicComponentValue("RoomZone", roomEid, "kind") || "");
    if (!kind) return false;
    if (kind === "world") return true;

    if (kind === "rect") {
      const x = Number(getDynamicComponentValue("RoomZone", roomEid, "x") ?? 0);
      const y = Number(getDynamicComponentValue("RoomZone", roomEid, "y") ?? 0);
      const w = Number(getDynamicComponentValue("RoomZone", roomEid, "w") ?? 0);
      const h = Number(getDynamicComponentValue("RoomZone", roomEid, "h") ?? 0);
      return agentX >= x && agentY >= y && agentX < x + w && agentY < y + h;
    }

    if (kind === "poly") {
      const raw = String(getDynamicComponentValue("RoomZone", roomEid, "pointsJson") || "");
      if (!raw.trim()) return false;
      try {
        const pts = JSON.parse(raw);
        if (!Array.isArray(pts) || pts.length < 3) return false;
        return pointInPoly(agentX, agentY, pts);
      } catch {
        return false;
      }
    }

    return false;
  }

  return {
    name: "RoomArrival",
    description: "Updates room occupancy based on grid position and zone geometry",
    pseudocode: `
FOR EACH agent WITH Agent, GridPosition:
  IF map zones exist:
    Assign LocatedIn(room) based on zone containment
  ELSE:
    Find closest room within ARRIVAL_THRESHOLD
`,
    // Containment is a consequence of each physical boundary, not a separate
    // 500ms sampling clock that could lag a spoken word at a room crossing.
    frequency: 0,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, GridPosition])).filter(eid => entityExists(world, eid));
      const rooms = Array.from(ctx.query(world, [Room, GridPosition])).filter(eid => entityExists(world, eid));

      const worldRoom =
        rooms.find((rid) => String(getDynamicComponentValue("RoomZone", rid, "kind") || "") === "world") ??
        rooms.find((rid) => String(Name.value[rid] || "") === "World") ??
        null;

      const zoneRooms = rooms.filter((rid) => {
        const k = String(getDynamicComponentValue("RoomZone", rid, "kind") || "");
        return k === "rect" || k === "poly";
      });

      for (const agentEid of agents) {
        if (!entityExists(world, agentEid)) continue;

        const agentX = GridPosition.x[agentEid];
        if (getAgentWorldCapabilities(world, agentEid)?.ownsMovement || getAgentWorldCapabilities(world, agentEid)?.busy()) continue;
        const agentY = GridPosition.y[agentEid];

        if (agentX === undefined || agentY === undefined) continue;

        // Determine authoritative room from zone containment, if zone geometry exists.
        let desiredRoom: number | null = null;
        if (zoneRooms.length > 0) {
          for (const roomEid of zoneRooms) {
            if (pointInRoomZone(agentX, agentY, roomEid)) {
              desiredRoom = roomEid;
              break;
            }
          }
          if (desiredRoom === null && worldRoom !== null) desiredRoom = worldRoom;
        }

        // Get current direct container (should be a room for most agents)
        const currentContainer = getDirectContainer(world, agentEid);
        const currentRoom = currentContainer !== undefined ? currentContainer : null;

        const agentName = Name.value[agentEid];

        if (desiredRoom !== null) {
          if (desiredRoom !== currentRoom) {
            const newRoomName = Name.value[desiredRoom];
            if (currentRoom !== null && entityExists(world, currentRoom) && hasComponent(world, currentRoom, Room)) {
              const oldRoomName = Name.value[currentRoom];
              ctx.emit("room_left", { agent: agentName, room: oldRoomName });
            }
            setLocatedIn(world, agentEid, desiredRoom);
            ctx.emit("room_entered", {
              agent: agentName,
              room: newRoomName,
              position: { x: agentX, y: agentY },
            });
            ctx.log(`${agentName} entered ${newRoomName}`);
          }
          continue;
        }

        // Fallback: Find the closest room within threshold (center-proximity heuristic).
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

        if (closestRoom !== null && closestRoom !== currentRoom) {
          const newRoomName = Name.value[closestRoom];
          if (currentRoom !== null && entityExists(world, currentRoom) && hasComponent(world, currentRoom, Room)) {
            const oldRoomName = Name.value[currentRoom];
            ctx.emit("room_left", { agent: agentName, room: oldRoomName });
          }
          setLocatedIn(world, agentEid, closestRoom);
          ctx.emit("room_entered", {
            agent: agentName,
            room: newRoomName,
            position: { x: agentX, y: agentY },
          });
          ctx.log(`${agentName} entered ${newRoomName}`);
        } else if (closestRoom === null && currentRoom !== null) {
          // Keep valid room containment (avoid 'no current room' thrash).
          if (entityExists(world, currentRoom) && hasComponent(world, currentRoom, Room)) {
            continue;
          }
          if (entityExists(world, currentRoom)) {
            const oldRoomName = Name.value[currentRoom];
            setLocatedIn(world, agentEid, undefined);
            ctx.emit("room_left", { agent: agentName, room: oldRoomName });
            ctx.log(`${agentName} left ${oldRoomName}`);
          }
        }
      }
    },
  };
}


/**
 * LocationIntegritySystem - Enforces the single-parent containment invariant.
 *
 * Canonical location model: every entity should have exactly one direct parent via `LocatedIn`.
 * This system collapses multiple parents and grounds parentless entities into the nearest room
 * when a GridPosition exists.
 */
export function createLocationIntegritySystem(): SystemDefinition {
  const MAX_ASSIGN_DISTANCE = 30;

  return {
    name: "LocationIntegrity",
    description: "Enforces single-parent containment and grounds orphaned entities into rooms",
    pseudocode: `
FOR EACH entity:
  parents = LocatedIn targets
  IF parents > 1: keep best parent
  IF parents == 0 AND has GridPosition: assign nearest room
`,
    frequency: 2000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const rooms = Array.from(ctx.query(world, [Room, GridPosition])).filter((eid) => entityExists(world, eid));
      if (rooms.length === 0) return;

      const candidates = new Set<number>();
      for (const eid of ctx.query(world, [GridPosition])) candidates.add(eid);
      for (const eid of ctx.query(world, [Agent])) candidates.add(eid);
      for (const eid of ctx.query(world, [Container])) candidates.add(eid);

      for (const eid of candidates) {
        if (!entityExists(world, eid)) continue;
        if (hasComponent(world, eid, Room)) continue;

        const parents = getRelationTargets(world, eid, LocatedIn).filter((t) => entityExists(world, t));

        if (parents.length > 1) {
          const best =
            parents.find((t) => hasComponent(world, t, Agent)) ??
            parents.find((t) => hasComponent(world, t, Container)) ??
            parents.find((t) => hasComponent(world, t, Room)) ??
            parents[0];
          setLocatedIn(world, eid, best);
          const n = Name.value[eid] || `entity:${eid}`;
          const kept = best !== undefined ? (Name.value[best] || `entity:${best}`) : "nowhere";
          ctx.log(`[LocationIntegrity] Collapsed multiple parents for ${n} -> ${kept}`);
          continue;
        }

        if (parents.length === 1) continue;

        const x = GridPosition.x[eid];
        const y = GridPosition.y[eid];
        if (x === undefined || y === undefined) continue;

        let nearestRoom: number | undefined = undefined;
        let nearestDist = Infinity;
        for (const roomEid of rooms) {
          const rx = GridPosition.x[roomEid];
          const ry = GridPosition.y[roomEid];
          if (rx === undefined || ry === undefined) continue;
          const dx = rx - x;
          const dy = ry - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestRoom = roomEid;
          }
        }

        if (nearestRoom !== undefined && nearestDist <= MAX_ASSIGN_DISTANCE) {
          setLocatedIn(world, eid, nearestRoom);
          const n = Name.value[eid] || `entity:${eid}`;
          const roomName = Name.value[nearestRoom] || `entity:${nearestRoom}`;
          ctx.log(`[LocationIntegrity] Grounded orphan ${n} into ${roomName}`);
        }
      }
    },
  };
}


/**
 * GoalPursuitSystem - Executes goal-driven movement (room-to-room) deterministically.
 * This is the bridge between cognition-created Goals ("Go to X") and actual world state changes.
 */
export function createGoalPursuitSystem(): SystemDefinition {
  const movementLocks = new Map<number, { targetEid: number; untilMs: number }>();
  const RETARGET_LOCK_MS = 8000;
  return {
    name: "GoalPursuitSystem",
    description: "Executes movement and other goal-driven actions",
    pseudocode: `
FOR EACH agent WITH active Goal matching "Go to <room>":
  If already in room: mark goal completed
  Else: move agent to room (update LocatedIn + GridPosition), mark goal completed
`,
    frequency: 1000, // Run frequently so goal-based movement feels responsive
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      // Step-based pursuit: translate movement goals into grid movement targets.
      // Movement + RoomArrival then handle locomotion and canonical room containment.
      // In an AI world, an active goal is a candidate intention, not authority
      // to move the actor. The cognitive executor admits explicit moves (and
      // installs native grid targets when needed). Keep this independent goal
      // arbiter only for no-AI/legacy worlds, just like idle wandering.
      if (world.meta.aiEnabled === true) return;
      const agents = Array.from(ctx.query(world, [Agent, Mind, Name, GridPosition])).filter((eid) => entityExists(world, eid));
      const rooms = Array.from(ctx.query(world, [Room, Name, GridPosition])).filter((eid) => entityExists(world, eid));
      const nowMs = world.time.elapsed;

      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;

        // Domain locomotion (doors, timed journeys, interrupted routes) must go
        // through the ordinary intention -> package -> physical proof pipeline.
        if (getAgentWorldCapabilities(world, agentEid)?.ownsMovement) continue;

        const currentTarget = getMovementTarget(agentEid);
        const lock = movementLocks.get(agentEid);
        if (lock && nowMs < lock.untilMs && currentTarget === lock.targetEid) {
          continue;
        }

        const goalEids = ctx.getRelationTargets(world, agentEid, HasGoal);
        const activeGoals = goalEids
          .filter((geid) => entityExists(world, geid) && Goal.status[geid] === "active")
          .sort((a, b) => ((Goal.priority[b] || 0) - (Goal.priority[a] || 0)) || ((Goal.createdAt[a] || 0) - (Goal.createdAt[b] || 0)) || (a - b));

        if (activeGoals.length == 0) continue;

        // Prefer movement goals if any exist.
        const movementGoalEid = activeGoals.find((geid) => {
          const kind = String(Goal.kind[geid] || "");
          if (kind === "move_to_room") return true;
          const desc = String(Goal.description[geid] || "");
          return /Go to /i.test(desc);
        });

        const topGoalEid = movementGoalEid ?? activeGoals[0];

        // Extract target room name.
        let targetRoomName: string | undefined;
        if (String(Goal.kind[topGoalEid] || "") === "move_to_room") {
          try {
            const raw = String(Goal.paramsJson[topGoalEid] || "").trim();
            if (raw) {
              const parsed = JSON.parse(raw);
              if (typeof parsed?.roomName === "string" && parsed.roomName.trim()) {
                targetRoomName = parsed.roomName.trim();
              }
            }
          } catch {}
        }
        if (!targetRoomName) {
          const desc = String(Goal.description[topGoalEid] || "");
          const m = desc.match(/Go to ([^.]+)/i);
          if (m) {
            let parsed = m[1].trim();
            const forIndex = parsed.indexOf(" for ");
            const toIndex = parsed.indexOf(" to ");
            if (forIndex !== -1) parsed = parsed.substring(0, forIndex);
            else if (toIndex !== -1) parsed = parsed.substring(0, toIndex);
            targetRoomName = parsed.trim();
          }
        }

        if (!targetRoomName) continue;

        const currentRoomEid = getRoomForEntity(world, agentEid);
        const currentRoomName = currentRoomEid !== undefined ? String(Name.value[currentRoomEid] || "") : "";

        // If already at destination, complete (match by room name OR ambience).
        if (currentRoomEid !== undefined) {
          const wantedRoom = targetRoomName.toLowerCase();
          const hereName = currentRoomName.toLowerCase();
          const hereAmbience = String(Room.ambience[currentRoomEid] || "").toLowerCase();
          if (hereName.includes(wantedRoom) || hereAmbience.includes(wantedRoom)) {
            Goal.status[topGoalEid] = "completed";
            Goal.progress[topGoalEid] = 100;
            retireGoalPlans(world, topGoalEid, ctx.getRelationTargets(world, agentEid, HasPlan));
            Mind.focus[agentEid] = "arrived";
            clearMovementTarget(agentEid);
            movementLocks.delete(agentEid);
            ctx.emit("goal_completed", { agent: Name.value[agentEid], goal: Goal.description[topGoalEid] || targetRoomName });
            continue;
          }
        }

        // Resolve target room entity (match by name OR ambience).
        const wanted = targetRoomName.toLowerCase();
        const targetRoomEid =
          rooms.find((rid) => String(Name.value[rid] || "").trim().toLowerCase() === wanted) ??
          rooms.find((rid) => String(Room.ambience[rid] || "").trim().toLowerCase() === wanted) ??
          rooms.find((rid) => String(Name.value[rid] || "").trim().toLowerCase().includes(wanted)) ??
          rooms.find((rid) => String(Room.ambience[rid] || "").trim().toLowerCase().includes(wanted));

        if (targetRoomEid === undefined) {
          Goal.status[topGoalEid] = "failed";
          retireGoalPlans(world, topGoalEid, ctx.getRelationTargets(world, agentEid, HasPlan));
          movementLocks.delete(agentEid);
          continue;
        }

        // Set movement target (idempotent).
        if (getMovementTarget(agentEid) !== targetRoomEid) {
          setMovementTarget(agentEid, targetRoomEid);
          movementLocks.set(agentEid, { targetEid: targetRoomEid, untilMs: nowMs + RETARGET_LOCK_MS });
          Mind.focus[agentEid] = `going to ${Name.value[targetRoomEid] || targetRoomName}`;
        }
      }
    },
  };
}

/**
 * NeedsBasedMovementSystem - Creates movement goals based on critical needs.
 * Deterministic fallback so simulations can run without LLM planning.
 */
export function createNeedsBasedMovementSystem(): SystemDefinition {
  return {
    name: "NeedsBasedMovementSystem",
    description: "Creates movement goals based on hunger/energy/social needs",
    pseudocode: `
FOR EACH agent:
  IF hunger high -> create goal Go to food location
  IF energy low -> create goal Go to rest location
  IF lonely -> create goal Go to social location
`,
    frequency: 5000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      needsBasedMovementSystem(world, ctx);
    },
  };
}

/**
 * GoalCleanupSystem - Removes completed/failed goals and expires stale ones.
 */
export function createGoalCleanupSystem(): SystemDefinition {
  return {
    name: "GoalCleanupSystem",
    description: "Cleans up completed/failed goals and expires goals past deadline",
    pseudocode: `
FOR EACH agent goal:
  Remove completed/failed goals
  Mark goals past deadline as failed
`,
    frequency: 15000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      goalCleanupSystem(world, ctx);
    },
  };
}

/**
 * GoalEvaluationSystem - Deterministically checks typed goal success criteria against world state.
 *
 * This is the "grounded completion" gate: goals can carry a success contract, and completion is
 * decided by ECS state (not by LLM narration).
 */
export function createGoalEvaluationSystem(): SystemDefinition {
  return {
    name: "GoalEvaluationSystem",
    description: "Evaluates goal success criteria against world state and completes satisfied goals",
    pseudocode: `
FOR EACH agent WITH active goals:
  IF goal.success criteria satisfied (room/trait/recent interact):
    mark goal completed
`,
    frequency: 500,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      goalEvaluationSystem(world, ctx);
    },
  };
}

/**
 * IdleWanderSystem - Gives otherwise-idle agents something grounded to do without LLM involvement.
 *
 * When agents have no active goals and their basic needs are not pressing, they will occasionally
 * create a low-priority "Go to <room>" goal. GoalPursuitSystem executes it.
 */
export function createIdleWanderSystem(): SystemDefinition {
  return {
    name: "IdleWanderSystem",
    description: "Creates low-priority wander goals for idle agents",
    pseudocode: `
FOR EACH agent WITHOUT active goals AND needs are okay:
  Pick a different room
  Create Goal: "Go to <room> to wander"
`,
    frequency: 25000, // every 25s — backup wander for truly idle agents
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      // This is the no-AI fallback. A live character may choose quiet or rest;
      // periodic random movement must not overrule its own decision loop.
      if (world.meta.aiEnabled === true) return;
      const rooms = Array.from(ctx.query(world, [Room, Name])).filter((eid) => entityExists(world, eid));
      if (rooms.length < 2) return;

      const agents = Array.from(ctx.query(world, [Agent, Needs, Mind, Name])).filter((eid) => entityExists(world, eid));
      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;

        // Skip agents with behavior policies — their templates handle movement decisions
        if (hasComponent(world, agentEid, BehaviorPolicy) && BehaviorPolicy.enabled[agentEid]) continue;

        const hunger = Needs.hunger[agentEid] || 0;
        const energy = Needs.energy[agentEid] ?? 100;
        if (isResting(world, agentEid)) continue;
        if (hunger >= 60) continue;
        if (energy <= 35) continue;

        const goalEids = getRelationTargets(world, agentEid, HasGoal);
        const hasAnyActiveGoal = goalEids.some((gid) => {
          if (!hasComponent(world, gid, Goal)) return false;
          return Goal.status[gid] === "active";
        });
        if (hasAnyActiveGoal) continue;

        const currentRoomEid = getRoomForEntity(world, agentEid);
        const candidates = rooms.filter((rid) => rid !== currentRoomEid);
        if (candidates.length === 0) continue;

        // Deterministic in harness runs because the harness seeds Math.random.
        const targetRoomEid = candidates[Math.floor(Math.random() * candidates.length)]!;
        const targetRoomName = Name.value[targetRoomEid] || "somewhere";

        const goalEid = addEntity(world);
        addComponent(world, goalEid, Goal);
        addComponent(world, agentEid, HasGoal(goalEid));

        Goal.description[goalEid] = `Go to ${targetRoomName} to wander`;
        Goal.priority[goalEid] = 2;
        Goal.status[goalEid] = "active";
        Goal.progress[goalEid] = 0;
        Goal.deadline[goalEid] = Date.now() + 2 * 60 * 1000;
        Goal.createdAt[goalEid] = Date.now();
        stampGoalTiming(world, goalEid);
        setGoalContract(world, goalEid, {
          version: 1,
          kind: "move_to_room",
          params: { roomName: targetRoomName, reason: "wander" },
          success: { type: "in_room", roomName: targetRoomName },
          description: Goal.description[goalEid],
        });

        Mind.focus[agentEid] = `going to ${targetRoomName}`;
      }
    },
  };
}

/**
 * SleepWakeSystem - Releases occupied sleep targets and clears SleepingOn after sleep completes.
 *
 * Currently, `sleep` is an instantaneous affordance (sets energy to 100 immediately), but it also
 * marks the bed/cot as "occupied". Without a wake/release pass, sleepables can become permanently
 * blocked, causing NPC interaction loops.
 */
export function createSleepWakeSystem(): SystemDefinition {
  return {
    name: "SleepWakeSystem",
    description: "Clears SleepingOn relations and frees occupied sleepables when agents are rested",
    pseudocode: `
FOR EACH agent WITH SleepingOn(target):
  IF Needs.energy >= 95:
    remove SleepingOn
    set target.state = normal
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world, [Agent, Needs])).filter((eid) => entityExists(world, eid));

      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;
        const targets = getRelationTargets(world, agentEid, SleepingOn);
        const bedEid = targets[0];
        if (bedEid === undefined) continue;
        if (!entityExists(world, bedEid)) {
          removeComponent(world, agentEid, SleepingOn(bedEid));
          continue;
        }

        const energy = Needs.energy[agentEid] ?? 100;
        if (energy < 95) continue;

        removeComponent(world, agentEid, SleepingOn(bedEid));
        if (hasComponent(world, bedEid, ObjectState)) {
          ObjectState.current[bedEid] = "normal";
        }
        Mind.focus[agentEid] = "refreshed";
      }
    },
  };
}

export function createRestRecoverySystem(): SystemDefinition {
  return {
    name: "RestRecovery", description: "Recovers energy during an admitted rest state over simulation time",
    pseudocode: "For resting actors, recover energy using this tick's elapsed time; maintain rest until a competing action.",
    frequency: 0, active: true, lastRun: 0,
    compiledFn: (world, ctx) => updateRestState(world, ctx.delta),
  };
}

export const BUILTIN_SYSTEMS = {
  TimeProgression: createTimeProgressionSystem,
  DailySchedulePlanner: createDailySchedulePlannerSystem,
  ScheduleSystem: createScheduleSystem,
  DayPlanPreplanner: createDayPlanPreplannerSystem,
  DayPlanActivation: createDayPlanActivationSystem,
  ScheduleExecutionSystem: createScheduleExecutionSystem,
  ScheduleAdaptation: createScheduleAdaptationSystem,
  ScheduledActivityGoals: createScheduledActivityGoalSystem,
  ScheduledActivityTemplatePlanner: createScheduledActivityTemplatePlannerSystem,
  OfficeToolJobSystem: createOfficeToolJobSystem,
  RepoIntegratorSystem: createRepoIntegratorSystem,
  SocialDynamics: createSocialDynamicsSystem,
  NarrativeEvents: createNarrativeEventSystem,
  RelationshipEvolution: createRelationshipEvolutionSystem,
  GoalEvaluationSystem: createGoalEvaluationSystem,
  GoalPursuitSystem: createGoalPursuitSystem,
  NeedsBasedMovementSystem: createNeedsBasedMovementSystem,
  GoalCleanupSystem: createGoalCleanupSystem,
  IdleWanderSystem: createIdleWanderSystem,
  SleepWakeSystem: createSleepWakeSystem,
  RestRecovery: createRestRecoverySystem,
  Movement: createMovementSystem,
  RoomArrival: createRoomArrivalSystem,
  LocationIntegrity: createLocationIntegritySystem,
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
 * - GoalPursuitSystem: Executes goal-driven movement between rooms
 * - NeedsBasedMovementSystem: Creates movement goals driven by needs
 * - GoalCleanupSystem: Removes completed/failed/expired goals
 * - IdleWanderSystem: Creates low-priority wander goals for idle agents
 * - SleepWakeSystem: Releases beds/cots after sleeping
 * - Movement: Grid-based agent movement toward targets
 * - RoomArrival: Updates LocatedIn(room) when agents reach rooms via GridPosition
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
