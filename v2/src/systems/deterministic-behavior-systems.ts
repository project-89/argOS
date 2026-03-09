/**
 * Deterministic Behavior Systems
 *
 * These systems drive agent behavior through pure ECS state transformation.
 * No AI/LLM involved - just deterministic rules that create emergent behavior.
 *
 * Philosophy: Like Dwarf Fortress, complex behaviors emerge from many simple rules interacting.
 */

import type { World } from "../ecs/world";
import {
  Agent, Mind, Name, Needs, GridPosition, Goal, Plan, Schedule, Room,
  AllComponents
} from "../ecs/components";
import {
  LocatedIn, HasGoal, HasPlan, HasSchedule, AllRelations
} from "../ecs/relations";
import type { SystemContext } from "../ecs/dynamic-systems";
import { ActionRegistry } from "../cognition/action-registry";
import { setGoalContract } from "../cognition/goal-contract";
import { getRoomForEntity } from "../ecs/location";
import { setLocatedIn } from "../ecs/location";

// =============================================================================
// REGISTER SYSTEM-PROVIDED ACTIONS
// =============================================================================

// Register actions that these deterministic systems enable
ActionRegistry.registerSystemActions("DeterministicBehavior", [
  {
    name: "move",
    description: "Travel to a different location (system will execute via goals)",
    requiresTarget: true,
    requiresContent: false,
    targetTypes: ["room"],
    examples: ["move to Market", "move to Tavern"],
    category: "movement",
  },
  {
    name: "rest",
    description: "Rest at current location to restore energy (effective at home/inn)",
    requiresTarget: false,
    requiresContent: false,
    category: "self",
  },
]);

// =============================================================================
// SCHEDULE EXECUTION SYSTEM
// =============================================================================

/**
 * Drives agents to follow their schedules by creating movement goals.
 *
 * Logic:
 * 1. Check each agent with a schedule
 * 2. Get current scheduled activity based on world time
 * 3. If activity has a location and agent isn't there, create a movement goal
 * 4. Priority based on how late they are
 */
export function scheduleExecutionSystem(world: World, ctx: SystemContext): void {
  const { Agent: AgentComp, Mind: MindComp, Name: NameComp, Schedule: ScheduleComp, Goal: GoalComp, Room: RoomComp } = ctx.components;
  const { HasGoal: HasGoalRel, HasSchedule: HasScheduleRel } = ctx.relations;

  // Authoritative simulation time comes from the world context (TimeProgression system).
  const worldContext = world as any;
  const currentHour = typeof worldContext.time?.simulationHour === "number" ? worldContext.time.simulationHour : 8;

  const agents = Array.from(ctx.query(world, [Agent, Name]));
  const allRooms = Array.from(ctx.query(world, [Room, Name]));

  const findRoomMatching = (needle: string): number | undefined => {
    const wanted = needle.trim().toLowerCase();
    if (!wanted) return undefined;
    return (
      allRooms.find((roomEid) => String(NameComp.value[roomEid] || "").trim().toLowerCase() === wanted) ??
      allRooms.find((roomEid) => String(NameComp.value[roomEid] || "").trim().toLowerCase().includes(wanted))
    );
  };

  const isHourInActivity = (hour: number, startHour: number, duration: number): boolean => {
    const dur = Math.max(1, Math.min(24, Math.floor(duration || 1)));
    const start = ((startHour % 24) + 24) % 24;
    const end = (start + dur) % 24;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    // Spans midnight.
    return hour >= start || hour < end;
  };

  for (const eid of agents) {
    // Get agent's schedule
    const scheduleTargets = ctx.getRelationTargets(world, eid, HasSchedule);
    if (scheduleTargets.length === 0) continue;

    const scheduleEid = scheduleTargets[0];
    if (!ctx.hasComponent(world, scheduleEid, Schedule)) continue;

    // Parse schedule activities
    const activitiesJson = ScheduleComp.activities[scheduleEid];
    if (!activitiesJson) continue;

    let activities: Array<{ name: string; startHour: number; duration: number; location?: string; priority?: number }>;
    try {
      activities = JSON.parse(activitiesJson);
    } catch {
      continue;
    }

    // Find current activity
    const currentActivity = activities.find((act) => {
      const startHour = Number(act.startHour);
      const duration = Number(act.duration ?? 1);
      if (!Number.isFinite(startHour) || !Number.isFinite(duration)) return false;
      return isHourInActivity(currentHour, Math.floor(startHour), Math.floor(duration));
    });

    if (!currentActivity || !currentActivity.location) continue;
    const targetLocation = String(currentActivity.location || "").trim();
    if (!targetLocation) continue;

    // If no room exists that matches this location string, don't create a thrashy goal.
    const targetRoomEid = findRoomMatching(targetLocation);
    if (targetRoomEid === undefined) continue;

    // Get agent's current room
    const currentRoomEid = getRoomForEntity(world, eid);
    if (currentRoomEid === undefined) continue;
    const currentRoomName = NameComp.value[currentRoomEid] || "";

    // Check if agent is already at scheduled location.
    if (currentRoomEid === targetRoomEid || currentRoomName.toLowerCase().includes(targetLocation.toLowerCase())) {
      continue; // Already there
    }

    // Check if agent already has a movement goal to this location
    const existingGoals = ctx.getRelationTargets(world, eid, HasGoal);
    const hasMovementGoal = existingGoals.some(goalEid => {
      if (!ctx.hasComponent(world, goalEid, Goal)) return false;
      const desc = GoalComp.description[goalEid] || "";
      const wanted = targetLocation.toLowerCase();
      const wantedRoom = String(NameComp.value[targetRoomEid] || "").toLowerCase();
      return desc.includes("Go to") && (desc.toLowerCase().includes(wanted) || (wantedRoom && desc.toLowerCase().includes(wantedRoom)));
    });

    if (hasMovementGoal) continue; // Already has goal

    // Calculate urgency based on how late
    const start = Math.floor(Number(currentActivity.startHour));
    const hoursIntoActivity = (currentHour - start + 24) % 24;
    const minutesIntoActivity = hoursIntoActivity * 60;
    const urgency = Math.min(10, Math.floor(minutesIntoActivity / 10) + 3);

    // Create movement goal
    const goalEid = ctx.addEntity(world);
    ctx.addComponent(world, goalEid, Goal);
    ctx.addComponent(world, eid, HasGoal(goalEid));

    GoalComp.description[goalEid] = `Go to ${NameComp.value[targetRoomEid] || targetLocation} for ${currentActivity.name}`;
    GoalComp.priority[goalEid] = urgency;
    GoalComp.status[goalEid] = "active";
    GoalComp.progress[goalEid] = 0;
    GoalComp.deadline[goalEid] = ctx.elapsed + (currentActivity.duration || 1) * 60 * 60 * 1000;
    (GoalComp as any).createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "move_to_room",
      params: { roomName: NameComp.value[targetRoomEid] || targetLocation, reason: `for ${currentActivity.name}` },
      success: { type: "in_room", roomName: NameComp.value[targetRoomEid] || targetLocation },
      description: GoalComp.description[goalEid],
    });

    // Update mind focus
    MindComp.focus[eid] = `going to ${NameComp.value[targetRoomEid] || targetLocation}`;
    MindComp.arousal[eid] = Math.min(1, (MindComp.arousal[eid] || 0.5) + 0.1);

    ctx.emit("goal_created", {
      agent: NameComp.value[eid],
      goal: GoalComp.description[goalEid],
      reason: "schedule",
      priority: urgency,
    });

    ctx.log(`[ScheduleExec] ${NameComp.value[eid]} needs to go to ${currentActivity.location} (priority: ${urgency})`);
  }
}

// =============================================================================
// GOAL PURSUIT SYSTEM
// =============================================================================

/**
 * Advances agents toward their goals by executing plan steps.
 *
 * Logic:
 * 1. Find agents with active goals
 * 2. Get their plan for the goal
 * 3. Execute the current step if conditions are met
 * 4. Advance to next step when complete
 */
export function goalPursuitSystem(world: World, ctx: SystemContext): void {
  const {
    Agent: AgentComp,
    Mind: MindComp,
    Name: NameComp,
    Goal: GoalComp,
    Plan: PlanComp,
    Room: RoomComp,
    GridPosition: GridPositionComp,
  } = ctx.components;
  const { HasGoal: HasGoalRel, HasPlan: HasPlanRel } = ctx.relations;

  const agents = Array.from(ctx.query(world, [Agent, Mind, Name]));

  for (const eid of agents) {
    // Skip if agent is not active or is highly aroused (let them calm down)
    if (!AgentComp.active[eid]) continue;

    // Get active goals sorted by priority
    const goalEids = ctx.getRelationTargets(world, eid, HasGoal);
    const activeGoals = goalEids
      .filter(geid => ctx.hasComponent(world, geid, Goal) && GoalComp.status[geid] === "active")
      .sort((a, b) => (GoalComp.priority[b] || 0) - (GoalComp.priority[a] || 0));

    if (activeGoals.length === 0) continue;

    // Prefer movement goals if any exist.
    // Cognition often creates movement goals as sub-steps toward higher-level goals,
    // so movement goals must be executable even when a higher-priority non-movement goal exists.
    const movementGoal = activeGoals.find((geid) => {
      const kind = String((GoalComp as any).kind?.[geid] || "");
      if (kind === "move_to_room") return true;
      const desc = GoalComp.description[geid] || "";
      return /Go to /i.test(desc);
    });

    const topGoal = movementGoal ?? activeGoals[0];
    const goalDesc = GoalComp.description[topGoal] || "";

    // Execute movement goals.
    let targetLocation: string | null = null;
    const topKind = String((GoalComp as any).kind?.[topGoal] || "");
    if (topKind === "move_to_room") {
      try {
        const raw = String((GoalComp as any).paramsJson?.[topGoal] || "").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          const roomName = typeof parsed?.roomName === "string" ? parsed.roomName : "";
          if (roomName.trim()) targetLocation = roomName.trim();
        }
      } catch {}
    }

    if (!targetLocation) {
      // Legacy: parse description (format: "Go to <location>..." or "Go to <location> to...")
      const moveMatch = goalDesc.match(/Go to ([^.]+)/i);
      if (moveMatch) {
        targetLocation = moveMatch[1].trim();
        const forIndex = targetLocation.indexOf(" for ");
        const toIndex = targetLocation.indexOf(" to ");

        if (forIndex !== -1) {
          targetLocation = targetLocation.substring(0, forIndex);
        } else if (toIndex !== -1) {
          targetLocation = targetLocation.substring(0, toIndex);
        }
      }
    }

    if (targetLocation) {

      // Get current room
      const currentRoomEid = getRoomForEntity(world, eid);
      if (currentRoomEid === undefined) continue;
      const currentRoomName = NameComp.value[currentRoomEid] || "";

      // Check if we're at target
      if (currentRoomName.toLowerCase().includes(targetLocation.toLowerCase())) {
        // Goal complete!
        GoalComp.status[topGoal] = "completed";
        GoalComp.progress[topGoal] = 100;

        MindComp.focus[eid] = "arrived";
        MindComp.arousal[eid] = Math.max(0, (MindComp.arousal[eid] || 0.5) - 0.1);

        // Success feedback for cognition/harness metrics.
        ctx.emit("stimulus", {
          targetEid: eid,
          type: "action_result",
          modality: "cognitive",
          content: `You are already at ${targetLocation}.`,
          source: "movement",
        });

        ctx.emit("goal_completed", {
          agent: NameComp.value[eid],
          goal: goalDesc,
        });

        ctx.log(`[GoalPursuit] ${NameComp.value[eid]} completed: ${goalDesc}`);
        continue;
      }

      // Need to move - find target room
      const { Room: RoomComponent, Name: NameComponent } = ctx.components;
      const allRooms = Array.from(ctx.query(world, [RoomComponent, NameComponent]));

      const wanted = targetLocation.toLowerCase();
      const targetRoom =
        allRooms.find((roomEid) => String(NameComp.value[roomEid] || "").trim().toLowerCase() === wanted) ??
        allRooms.find((roomEid) => String(NameComp.value[roomEid] || "").trim().toLowerCase().includes(wanted));

      if (!targetRoom) {
        // Can't find room - fail goal
        GoalComp.status[topGoal] = "failed";
        continue;
      }

      const agentName = NameComp.value[eid] || "Someone";
      const targetRoomName = NameComp.value[targetRoom] || "somewhere";

      // Broadcast departure to agents in current room (visual stimulus)
      const agentsInCurrentRoom = Array.from(ctx.query(world, [Agent])).filter(otherEid => {
        if (otherEid === eid) return false;
        return getRoomForEntity(world, otherEid) === currentRoomEid;
      });

      for (const otherEid of agentsInCurrentRoom) {
        ctx.emit("stimulus", {
          targetEid: otherEid,
          type: "visual",
          content: `${agentName} leaves toward ${targetRoomName}.`,
          source: agentName,
        });
      }

      // Execute movement (canonical: `LocatedIn` is exclusive)
      setLocatedIn(world, eid, targetRoom);

      // Keep grid position consistent with room occupancy so RoomArrival doesn't immediately undo this.
      const roomX = GridPositionComp?.x?.[targetRoom];
      const roomY = GridPositionComp?.y?.[targetRoom];
      if (typeof roomX === "number" && typeof roomY === "number") {
        GridPositionComp.x[eid] = roomX;
        GridPositionComp.y[eid] = roomY;
      }

      // Broadcast arrival to agents in new room (visual stimulus)
      const agentsInTargetRoom = Array.from(ctx.query(world, [Agent])).filter(otherEid => {
        if (otherEid === eid) return false;
        return getRoomForEntity(world, otherEid) === targetRoom;
      });

      for (const otherEid of agentsInTargetRoom) {
        ctx.emit("stimulus", {
          targetEid: otherEid,
          type: "visual",
          content: `${agentName} arrives from ${currentRoomName}.`,
          source: agentName,
        });
      }

      // Notify the moving agent they've arrived (cognitive feedback)
      ctx.emit("stimulus", {
        targetEid: eid,
        type: "action_result",
        modality: "cognitive",
        content: `You have arrived at ${targetRoomName}.`,
        source: "movement",
      });

      // Update progress - complete since we're at destination now
      GoalComp.progress[topGoal] = 100;
      GoalComp.status[topGoal] = "completed";

      // Emit events for tracking/debugging
      ctx.emit("movement", {
        agent: agentName,
        from: currentRoomName,
        to: targetRoomName,
        reason: goalDesc,
      });

      ctx.emit("goal_completed", {
        agent: agentName,
        goal: goalDesc,
      });

      ctx.log(`[GoalPursuit] ${agentName} moved from ${currentRoomName} to ${targetRoomName} (goal completed)`);
    }
  }
}

// =============================================================================
// NEEDS-BASED MOVEMENT SYSTEM
// =============================================================================

/**
 * Creates movement goals based on agent needs (hunger, energy, social).
 *
 * Logic:
 * 1. Check agent needs
 * 2. If need is critical, find appropriate location
 * 3. Create movement goal to address need
 */
export function needsBasedMovementSystem(world: World, ctx: SystemContext): void {
  const { Agent: AgentComp, Mind: MindComp, Name: NameComp, Needs: NeedsComp, Goal: GoalComp, Room: RoomComp } = ctx.components;
  const { HasGoal: HasGoalRel } = ctx.relations;

  const agents = Array.from(ctx.query(world, [Agent, Needs, Name]));

  // Location mappings for needs
  const needLocations: Record<string, string[]> = {
    hunger: ["kitchen", "tavern", "dining", "bakery", "inn"],
    energy: ["bedroom", "home", "quarters", "inn"],
    social: ["square", "tavern", "market", "temple", "hall"],
  };

  for (const eid of agents) {
    // Check needs thresholds
    // Canonical needs scale:
    // - hunger: 0..100 (higher = worse)
    // - energy: 0..100 (lower = worse)
    // - social: 0..100 (lower = worse; social satisfaction)
    const hunger = NeedsComp.hunger[eid] || 0;
    const energy = NeedsComp.energy[eid] ?? 100;
    const social = NeedsComp.social[eid] ?? 50;

    let criticalNeed: string | null = null;
    let needPriority = 0;

    // Hunger >= 75 is critical
    if (hunger >= 75) {
      criticalNeed = "hunger";
      needPriority = Math.min(10, Math.max(1, Math.floor(hunger / 10)));
    }
    // Energy <= 25 is critical
    else if (energy <= 25) {
      criticalNeed = "energy";
      needPriority = Math.min(10, Math.max(1, Math.floor((100 - energy) / 10)));
    }
    // Social satisfaction <= 25 suggests loneliness / need for company
    else if (social <= 25) {
      criticalNeed = "social";
      needPriority = Math.min(8, Math.max(1, Math.floor((30 - social) / 5)));
    }

    if (!criticalNeed) continue;

    // Check if already has a need-based goal
    const goalEids = ctx.getRelationTargets(world, eid, HasGoal);
    const hasNeedGoal = goalEids.some(geid => {
      if (!ctx.hasComponent(world, geid, Goal)) return false;
      const desc = GoalComp.description[geid] || "";
      return desc.includes("need:") && GoalComp.status[geid] === "active";
    });

    if (hasNeedGoal) continue;

    // Find appropriate location
    const possibleLocations = needLocations[criticalNeed] || [];
    const allRooms = Array.from(ctx.query(world, [Room, Name]));

    const targetRoom = allRooms.find(roomEid => {
      const roomName = (NameComp.value[roomEid] || "").toLowerCase();
      const ambience = String(RoomComp.ambience?.[roomEid] || "").toLowerCase();
      return possibleLocations.some(loc => roomName.includes(loc) || ambience.includes(loc));
    });

    if (!targetRoom) continue;

    // Get current room
    const currentRoomEid = getRoomForEntity(world, eid);
    if (currentRoomEid !== undefined) {
      const currentRoomName = NameComp.value[currentRoomEid] || "";
      const targetRoomName = NameComp.value[targetRoom] || "";

      // Skip if already there
      if (currentRoomName === targetRoomName) continue;
    }

    // Create need-based movement goal
    const goalEid = ctx.addEntity(world);
    ctx.addComponent(world, goalEid, Goal);
    ctx.addComponent(world, eid, HasGoal(goalEid));

    const needDescriptions: Record<string, string> = {
      hunger: "find food",
      energy: "rest",
      social: "socialize",
    };

    GoalComp.description[goalEid] = `Go to ${NameComp.value[targetRoom]} to ${needDescriptions[criticalNeed]} (need: ${criticalNeed})`;
    GoalComp.priority[goalEid] = needPriority;
    GoalComp.status[goalEid] = "active";
    GoalComp.progress[goalEid] = 0;
    (GoalComp as any).createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "move_to_room",
      params: { roomName: NameComp.value[targetRoom], reason: `need:${criticalNeed}` },
      success: { type: "in_room", roomName: NameComp.value[targetRoom] },
      description: GoalComp.description[goalEid],
    });

    // Update mind state
    MindComp.focus[eid] = needDescriptions[criticalNeed];
    MindComp.arousal[eid] = Math.min(1, (MindComp.arousal[eid] || 0.5) + 0.15);

    ctx.emit("need_triggered_movement", {
      agent: NameComp.value[eid],
      need: criticalNeed,
      value: criticalNeed === "hunger" ? hunger : criticalNeed === "energy" ? energy : social,
      destination: NameComp.value[targetRoom],
    });

    ctx.log(`[NeedsMovement] ${NameComp.value[eid]} needs to ${needDescriptions[criticalNeed]} (${criticalNeed}: ${criticalNeed === "hunger" ? hunger.toFixed(0) : criticalNeed === "energy" ? energy.toFixed(0) : social.toFixed(0)})`);
  }
}

// =============================================================================
// GOAL CLEANUP SYSTEM
// =============================================================================

/**
 * Cleans up completed/failed goals and removes stale ones.
 *
 * Logic:
 * 1. Find goals that are completed/failed
 * 2. Remove them after a delay
 * 3. Remove goals past their deadline
 */
export function goalCleanupSystem(world: World, ctx: SystemContext): void {
  const { Goal: GoalComp, Name: NameComp } = ctx.components;
  const { HasGoal: HasGoalRel } = ctx.relations;

  const agents = Array.from(ctx.query(world, [Agent, Name]));

  for (const eid of agents) {
    const goalEids = ctx.getRelationTargets(world, eid, HasGoal);

    for (const goalEid of goalEids) {
      if (!ctx.hasComponent(world, goalEid, Goal)) continue;

      const status = GoalComp.status[goalEid];
      const deadline = GoalComp.deadline[goalEid] || 0;

      // Remove completed/failed goals
      if (status === "completed" || status === "failed") {
        ctx.removeEntity(world, goalEid);
        continue;
      }

      // Fail goals past deadline
      if (deadline > 0 && ctx.elapsed > deadline) {
        GoalComp.status[goalEid] = "failed";
        ctx.emit("goal_expired", {
          agent: NameComp.value[eid],
          goal: GoalComp.description[goalEid],
        });
      }
    }
  }
}

// =============================================================================
// NEEDS DECAY SYSTEM
// =============================================================================

/**
 * Gradually increases needs over time (hunger grows, energy depletes).
 *
 * This is the foundation of emergent behavior - needs drive movement,
 * which drives interaction, which creates narrative.
 */
export function needsDecaySystem(world: World, ctx: SystemContext): void {
  const { Agent: AgentComp, Needs: NeedsComp, Name: NameComp, Mind: MindComp } = ctx.components;

  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const deltaSeconds = ctx.delta / 1000;

  // Canonical needs scale:
  // - hunger: 0..100 (higher = worse)
  // - energy: 0..100 (lower = worse)
  // - social: 0..100 (lower = worse; satisfaction decays over time)
  //
  // Rates are per second.
  const HUNGER_RATE = 0.02;   // +0.02 hunger per second
  const ENERGY_RATE = 0.01;   // -0.01 energy per second (scaled by arousal)
  const SOCIAL_RATE = 0.01;   // -0.01 social satisfaction per second

  for (const eid of agents) {
    // Hunger increases over time
    const oldHunger = NeedsComp.hunger[eid] || 0;
    NeedsComp.hunger[eid] = Math.min(100, oldHunger + HUNGER_RATE * 100 * deltaSeconds);

    // Energy decreases over time (affected by arousal)
    const arousal = MindComp.arousal[eid] || 0.5;
    const oldEnergy = NeedsComp.energy[eid] ?? 100;
    const energyDrain = ENERGY_RATE * (1 + arousal) * 100 * deltaSeconds; // More active = more drain
    NeedsComp.energy[eid] = Math.max(0, oldEnergy - energyDrain);

    // Social need increases (faster for extroverts if we had personality)
    const oldSocial = NeedsComp.social[eid] ?? 50;
    NeedsComp.social[eid] = Math.max(0, Math.min(100, oldSocial - SOCIAL_RATE * 100 * deltaSeconds));
  }
}

// =============================================================================
// LOCATION-BASED NEED SATISFACTION SYSTEM
// =============================================================================

/**
 * Satisfies needs based on current location.
 *
 * Being in the kitchen reduces hunger, being in bedroom restores energy, etc.
 */
export function locationNeedSatisfactionSystem(world: World, ctx: SystemContext): void {
  const { Agent: AgentComp, Needs: NeedsComp, Name: NameComp, Room: RoomComp } = ctx.components;

  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const deltaSeconds = ctx.delta / 1000;

  // Satisfaction rates per second (normalized 0..1, then scaled to 0..100 points).
  const HUNGER_SATISFY_RATE = 0.04; // ~4 hunger points per second in food locations
  const ENERGY_SATISFY_RATE = 0.03; // ~3 energy points per second in rest locations
  const SOCIAL_SATISFY_RATE = 0.02; // ~2 social points per second per nearby agent

  // Location keywords that satisfy needs
  const hungerLocations = ["kitchen", "tavern", "dining", "bakery", "inn"];
  const energyLocations = ["bedroom", "home", "quarters", "inn", "temple"];
  const socialLocations = ["square", "tavern", "market", "temple", "hall", "inn"];

  for (const eid of agents) {
    const roomEid = getRoomForEntity(world, eid);
    if (roomEid === undefined) continue;
    const roomName = (NameComp.value[roomEid] || "").toLowerCase();

    // Check if location satisfies hunger
    if (hungerLocations.some(loc => roomName.includes(loc))) {
      const oldHunger = NeedsComp.hunger[eid] || 0;
      if (oldHunger > 0) {
        const drop = HUNGER_SATISFY_RATE * 100 * deltaSeconds;
        NeedsComp.hunger[eid] = Math.max(0, oldHunger - drop);

        if (oldHunger >= 60 && NeedsComp.hunger[eid] < 60) {
          ctx.emit("need_satisfied", {
            agent: NameComp.value[eid],
            need: "hunger",
            location: NameComp.value[roomEid],
          });
        }
      }
    }

    // Check if location restores energy
    if (energyLocations.some(loc => roomName.includes(loc))) {
      const oldEnergy = NeedsComp.energy[eid] ?? 100;
      if (oldEnergy < 100) {
        const gain = ENERGY_SATISFY_RATE * 100 * deltaSeconds;
        NeedsComp.energy[eid] = Math.min(100, oldEnergy + gain);

        if (oldEnergy <= 40 && NeedsComp.energy[eid] > 40) {
          ctx.emit("need_satisfied", {
            agent: NameComp.value[eid],
            need: "energy",
            location: NameComp.value[roomEid],
          });
        }
      }
    }

    // Check if location satisfies social need
    if (socialLocations.some(loc => roomName.includes(loc))) {
      // Also check if there are other agents here
      const otherAgents = Array.from(ctx.query(world, [Agent])).filter(otherEid => {
        if (otherEid === eid) return false;
        return getRoomForEntity(world, otherEid) === roomEid;
      });

      if (otherAgents.length > 0) {
        const oldSocial = NeedsComp.social[eid] ?? 50;
        const socialGain = SOCIAL_SATISFY_RATE * 100 * otherAgents.length * deltaSeconds;
        NeedsComp.social[eid] = Math.min(100, oldSocial + socialGain);
      }
    }
  }
}

// =============================================================================
// EXPORT ALL SYSTEMS
// =============================================================================

export const deterministicBehaviorSystems = {
  scheduleExecutionSystem,
  goalPursuitSystem,
  needsBasedMovementSystem,
  goalCleanupSystem,
  needsDecaySystem,
  locationNeedSatisfactionSystem,
};

// System definitions for registration
export const DETERMINISTIC_SYSTEM_DEFINITIONS = [
  {
    name: "ScheduleExecutionSystem",
    description: "Creates movement goals from agent schedules",
    frequency: 30000, // Every 30 seconds
    run: scheduleExecutionSystem,
  },
  {
    name: "GoalPursuitSystem",
    description: "Executes movement and other goal-driven actions",
    frequency: 5000, // Every 5 seconds
    run: goalPursuitSystem,
  },
  {
    name: "NeedsBasedMovementSystem",
    description: "Creates movement goals based on critical needs",
    frequency: 15000, // Every 15 seconds
    run: needsBasedMovementSystem,
  },
  {
    name: "GoalCleanupSystem",
    description: "Cleans up completed and expired goals",
    frequency: 60000, // Every 60 seconds
    run: goalCleanupSystem,
  },
  {
    name: "NeedsDecaySystem",
    description: "Gradually increases needs over time",
    frequency: 1000, // Every second
    run: needsDecaySystem,
  },
  {
    name: "LocationNeedSatisfactionSystem",
    description: "Satisfies needs based on current location",
    frequency: 2000, // Every 2 seconds
    run: locationNeedSatisfactionSystem,
  },
];
