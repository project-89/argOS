import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext } from "../ecs/dynamic-systems";
import { entityExists, hasComponent, query, getRelationTargets } from "bitecs";
import { Agent, DayPlanState, Goal, Name, Plan, Room, Schedule } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getCurrentActivity, getCurrentDay, getCurrentHour, getSchedule } from "../cognition/schedule-system";
import { setGoalContract, type GoalContractV1 } from "../cognition/goal-contract";
import { getAvailableAffordances } from "../world/affordance-availability";
import { createPlanEntity, getPlanForGoal } from "../cognition/planning-system";
import { getAgentProceduralSkills } from "../cognition/procedural-skills";
import { ensureGoalSignature, goalSignatureId } from "../cognition/goal-contract";

type ActivityType = "eat_meal" | "sleep_block" | "work_block" | "socialize_block" | "leisure_block";

function normalize(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function classifyActivity(name: string): { type: ActivityType; label: string } | null {
  const n = normalize(name);
  if (!n) return null;

  if (n.includes("sleep")) return { type: "sleep_block", label: "sleep" };
  if (n.includes("social")) return { type: "socialize_block", label: "socialize" };
  if (n.includes("leisure") || n.includes("relax") || n.includes("routine")) return { type: "leisure_block", label: "leisure" };
  if (n.includes("work")) return { type: "work_block", label: n.includes("afternoon") ? "afternoon work" : "work" };
  if (n.includes("breakfast")) return { type: "eat_meal", label: "breakfast" };
  if (n.includes("lunch")) return { type: "eat_meal", label: "lunch" };
  if (n.includes("dinner")) return { type: "eat_meal", label: "dinner" };
  // Generic meals: "eat", "meal"
  if (n === "eat" || n.includes("meal")) return { type: "eat_meal", label: "meal" };

  return null;
}

function findRoomMatching(world: World, needle: string): number | undefined {
  const wanted = normalize(needle);
  if (!wanted) return undefined;

  const rooms = Array.from(query(world as any, [Room, Name] as any)) as number[];

  const nameLower = (rid: number) => normalize(Name.value[rid] || "");
  const ambienceLower = (rid: number) => normalize((Room as any).ambience?.[rid] || "");

  return (
    rooms.find((rid) => nameLower(rid) === wanted) ??
    rooms.find((rid) => ambienceLower(rid) === wanted) ??
    rooms.find((rid) => nameLower(rid).includes(wanted)) ??
    rooms.find((rid) => ambienceLower(rid).includes(wanted))
  );
}

function roomHasAffordanceTarget(world: World, actorEid: number, roomEid: number, affordances: string[]): { targetEid: number; affordance: string } | null {
  for (const contentEid of listDirectContents(world as any, roomEid)) {
    if (!entityExists(world as any, contentEid)) continue;
    if (hasComponent(world as any, contentEid, Agent as any)) continue;
    const available = getAvailableAffordances(world as any, actorEid, contentEid).map((a) => normalize(a.name));
    for (const wanted of affordances) {
      if (available.includes(normalize(wanted))) {
        return { targetEid: contentEid, affordance: normalize(wanted) };
      }
    }
  }
  return null;
}

function findOtherAgentInRoom(world: World, roomEid: number, selfEid: number): number | undefined {
  for (const contentEid of listDirectContents(world as any, roomEid)) {
    if (contentEid === selfEid) continue;
    if (!entityExists(world as any, contentEid)) continue;
    if (!hasComponent(world as any, contentEid, Agent as any)) continue;
    if (!Agent.active[contentEid]) continue;
    return contentEid;
  }
  return undefined;
}

function findObservableTargetInRoom(world: World, roomEid: number, selfEid: number): number | undefined {
  for (const contentEid of listDirectContents(world as any, roomEid)) {
    if (contentEid === roomEid) continue;
    if (!entityExists(world as any, contentEid)) continue;
    // Observing self is allowed (and better than failing on a room entity).
    if (contentEid === selfEid) return contentEid;
    // Otherwise prefer any non-room entity (agents or objects).
    return contentEid;
  }
  return undefined;
}

function findRoomWithAffordanceTarget(
  world: World,
  actorEid: number,
  preferredRoomName: string | undefined,
  affordances: string[]
): { roomEid: number; targetEid: number; affordance: string } | null {
  // Prefer schedule location if it resolves and contains a usable target.
  const preferredRoomEid = preferredRoomName ? findRoomMatching(world, preferredRoomName) : undefined;
  if (preferredRoomEid !== undefined) {
    const found = roomHasAffordanceTarget(world, actorEid, preferredRoomEid, affordances);
    if (found) return { roomEid: preferredRoomEid, targetEid: found.targetEid, affordance: found.affordance };
  }

  const rooms = Array.from(query(world as any, [Room, Name] as any)) as number[];
  for (const roomEid of rooms) {
    if (!entityExists(world as any, roomEid)) continue;
    const found = roomHasAffordanceTarget(world, actorEid, roomEid, affordances);
    if (found) return { roomEid, targetEid: found.targetEid, affordance: found.affordance };
  }
  return null;
}

function hasActiveGoalWithSignature(world: World, agentEid: number, signature: string): boolean {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    const status = String(Goal.status[gid] || "");
    if (status === "completed" || status === "expired" || status === "failed") continue;
    if (String(Goal.signature[gid] || "") === signature) return true;
  }
  return false;
}

function findGoalBySignature(world: World, agentEid: number, signature: string): number | undefined {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.signature[gid] || "") === signature) return gid;
  }
  return undefined;
}

function ensureMoveToRoomGoal(world: World, ctx: SystemContext, agentEid: number, roomName: string, priority: number): void {
  const wanted = normalize(roomName);
  if (!wanted) return;

  const targetRoomEid = findRoomMatching(world, roomName);
  const currentRoomEid = getRoomForEntity(world as any, agentEid);
  if (targetRoomEid !== undefined && currentRoomEid !== undefined && targetRoomEid === currentRoomEid) {
    return; // Already there, no need to create a movement goal.
  }

  const goals = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goals) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.status[gid] || "") !== "active") continue;
    const kind = String(Goal.kind[gid] || "");
    if (kind !== "move_to_room") continue;
    try {
      const parsed = JSON.parse(String(Goal.paramsJson[gid] || "{}"));
      const rn = normalize(String(parsed?.roomName || ""));
      if (rn && rn === wanted) return;
    } catch {
      continue;
    }
  }

  const goalEid = ctx.addEntity(world as any);
  ctx.addComponent(world as any, goalEid, Goal as any);
  ctx.addComponent(world as any, agentEid, HasGoal(goalEid) as any);
  Goal.description[goalEid] = `Go to ${roomName}`;
  Goal.priority[goalEid] = Math.min(10, Math.max(1, priority));
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 2 * 60 * 1000;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "move_to_room",
    params: { roomName },
    success: { type: "in_room", roomName },
    description: Goal.description[goalEid],
  });
}

function hasGoalMacroForSignature(world: World, agentEid: number, goalEid: number): boolean {
  const sig = ensureGoalSignature(world as any, goalEid);
  if (!sig) return false;
  const id = goalSignatureId(sig);
  const prefix = `goalid:${id}|`;
  return getAgentProceduralSkills(world as any, agentEid)
    .map((s) => s.skill)
    .some((s) => String(s.trigger?.affordance || "") === "__goal_macro__" && String(s.signature || "").startsWith(prefix));
}

function buildScheduledActivityContract(input: {
  activityType: ActivityType;
  label: string;
  roomName: string;
  startHour?: number;
  durationHours?: number;
}): GoalContractV1 {
  if (input.activityType === "sleep_block") {
    return {
      version: 1,
      kind: "scheduled_activity",
      params: { activityType: input.activityType, label: input.label, roomName: input.roomName, startHour: input.startHour, durationHours: input.durationHours },
      success: {
        type: "all_of",
        conditions: [
          { type: "in_room", roomName: input.roomName },
          {
            type: "any_of",
            conditions: [
              { type: "did_interact_affordance", affordance: "sleep" },
              { type: "need_at_least", need: "energy", atLeast: 80 },
            ],
          },
        ],
      },
      description: `Follow schedule: sleep (${input.roomName})`,
    };
  }

  if (input.activityType === "eat_meal") {
    return {
      version: 1,
      kind: "scheduled_activity",
      params: { activityType: input.activityType, label: input.label, roomName: input.roomName, startHour: input.startHour, durationHours: input.durationHours },
      success: {
        type: "all_of",
        conditions: [
          { type: "in_room", roomName: input.roomName },
          {
            type: "any_of",
            conditions: [
              { type: "did_interact_affordance", affordance: "eat" },
              { type: "did_interact_affordance", affordance: "drink" },
              { type: "need_at_most", need: "hunger", atMost: 40 },
            ],
          },
        ],
      },
      description: `Follow schedule: ${input.label} (${input.roomName})`,
    };
  }

  if (input.activityType === "socialize_block") {
    return {
      version: 1,
      kind: "scheduled_activity",
      params: { activityType: input.activityType, label: input.label, roomName: input.roomName, startHour: input.startHour, durationHours: input.durationHours },
      success: {
        type: "all_of",
        conditions: [
          { type: "in_room", roomName: input.roomName },
          {
            type: "any_of",
            conditions: [
              { type: "did_action_type", actionType: "speak" },
              { type: "need_at_least", need: "social", atLeast: 60 },
            ],
          },
        ],
      },
      description: `Follow schedule: socialize (${input.roomName})`,
    };
  }

  if (input.activityType === "work_block") {
    return {
      version: 1,
      kind: "scheduled_activity",
      params: { activityType: input.activityType, label: input.label, roomName: input.roomName, startHour: input.startHour, durationHours: input.durationHours },
      success: {
        type: "all_of",
        conditions: [
          { type: "in_room", roomName: input.roomName },
          { type: "did_action_type", actionType: "interact" },
        ],
      },
      description: `Follow schedule: ${input.label} (${input.roomName})`,
    };
  }

  // leisure_block (fallback)
  return {
    version: 1,
    kind: "scheduled_activity",
    params: { activityType: input.activityType, label: input.label, roomName: input.roomName, startHour: input.startHour, durationHours: input.durationHours },
    success: {
      type: "all_of",
      conditions: [
        { type: "in_room", roomName: input.roomName },
        { type: "did_action_type", actionType: "interact" },
      ],
    },
    description: `Follow schedule: ${input.label} (${input.roomName})`,
  };
}

export function createScheduledActivityGoalSystem(): SystemDefinition {
  // Track recently completed schedule goals to prevent re-creation spam
  const completedCooldowns = new Map<string, number>(); // "agentEid:signature" -> completedAtMs
  const SCHEDULE_COOLDOWN_MS = 60_000; // Don't re-create for 60s after completion

  return {
    name: "ScheduledActivityGoals",
    description: "Creates typed scheduled activity goals (meals/sleep/work/leisure/socialize) and movement subgoals",
    pseudocode: `
FOR EACH agent WITH Schedule:
  Determine current scheduled activity (by world time)
  If activity is supported:
    Pick an appropriate room (and optional target) for that activity
    Ensure movement goal exists to reach that room
    Ensure a scheduled_activity goal exists with a deterministic success contract
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world as any, [Agent, Name] as any)) as number[];
      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;

        // Only operate on agents that have a schedule.
        const scheduleEid = getSchedule(world as any, agentEid);
        if (!scheduleEid) continue;
        if (!hasComponent(world as any, scheduleEid, Schedule as any)) continue;

        const current = getCurrentActivity(world as any, agentEid);
        if (!current) continue;
        const classified = classifyActivity(current.name);
        if (!classified) continue;

        const needsTarget = classified.type === "sleep_block" || classified.type === "eat_meal";
        const desiredAffordances =
          classified.type === "sleep_block"
            ? ["sleep"]
            : classified.type === "eat_meal"
              ? ["eat", "drink"]
              : classified.type === "work_block"
                ? ["search_files", "browse_web", "run_command"]
                : classified.type === "leisure_block"
                  ? ["sit", "browse_web", "drink"]
                  : [];

        const found =
          desiredAffordances.length > 0
            ? findRoomWithAffordanceTarget(world as any, agentEid, current.location, desiredAffordances)
            : null;

        const resolvedRoomEid = found?.roomEid ?? (current.location ? findRoomMatching(world as any, current.location) : undefined) ?? getRoomForEntity(world as any, agentEid);
        if (resolvedRoomEid === undefined) continue;
        if (needsTarget && !found) continue;

        const roomName = String(Name.value[resolvedRoomEid] || current.location || "").trim();
        if (!roomName) continue;

        // Movement is a subgoal (so we keep accomplishment goals separate from navigation).
        ensureMoveToRoomGoal(world as any, ctx, agentEid, roomName, Math.max(3, current.priority || 5));

        const contract = buildScheduledActivityContract({
          activityType: classified.type,
          label: classified.label,
          roomName,
          startHour: Number(current.startHour),
          durationHours: Number(current.duration),
        });

        // Compute signature by briefly using a temp GoalContract (setGoalContract computes it),
        // but we can also just set and then check for duplicates by signature afterwards.
        const tempGoalEid = ctx.addEntity(world as any);
        ctx.addComponent(world as any, tempGoalEid, Goal as any);
        Goal.description[tempGoalEid] = contract.description || "";
        Goal.priority[tempGoalEid] = Math.min(10, Math.max(1, current.priority || 6));
        Goal.status[tempGoalEid] = "active";
        Goal.progress[tempGoalEid] = 0;
        Goal.deadline[tempGoalEid] = Date.now() + 3 * 60 * 1000;
        // For correctness, prefer "activation time" as createdAt. This is an active-now goal, so set it.
        Goal.createdAt[tempGoalEid] = Date.now();
        const sig = setGoalContract(world as any, tempGoalEid, contract);

        // Check cooldown: don't re-create goals that were recently completed
        const cooldownKey = `${agentEid}:${sig}`;
        const completedAt = completedCooldowns.get(cooldownKey);
        if (completedAt !== undefined && Date.now() - completedAt < SCHEDULE_COOLDOWN_MS) {
          ctx.removeEntity(world as any, tempGoalEid);
          continue;
        }

        // If agent already has a non-completed scheduled activity goal for this signature, discard temp.
        if (hasActiveGoalWithSignature(world as any, agentEid, sig)) {
          // If it exists but is queued (from preplanning), activate it now.
          const existing = findGoalBySignature(world as any, agentEid, sig);
          if (existing !== undefined && String(Goal.status[existing] || "") === "queued") {
            Goal.status[existing] = "active";
            Goal.createdAt[existing] = Date.now();
            Goal.priority[existing] = Math.min(10, Math.max(1, Number(current.priority || Goal.priority[existing] || 6)));
            ensureMoveToRoomGoal(world as any, ctx, agentEid, roomName, Goal.priority[existing] || 6);
          }
          // best-effort removal: goal entities are unattached (no HasGoal relation).
          // Removing them avoids registry clutter.
          ctx.removeEntity(world as any, tempGoalEid);
          continue;
        }

        // Track completion for cooldown when goal is evaluated as complete
        // (Listen for the goal being completed by goal evaluation system)
        const onComplete = () => {
          completedCooldowns.set(cooldownKey, Date.now());
          // Clean old entries periodically
          if (completedCooldowns.size > 200) {
            const now = Date.now();
            for (const [k, v] of completedCooldowns) {
              if (now - v > SCHEDULE_COOLDOWN_MS * 2) completedCooldowns.delete(k);
            }
          }
        };
        // We can't directly observe goal completion from here, but we can check
        // if the goal will be immediately completed (agent already satisfies success conditions)
        // and set the cooldown proactively.
        const agentRoom = getRoomForEntity(world as any, agentEid);
        const agentRoomName = agentRoom !== undefined ? String(Name.value[agentRoom] || "").trim().toLowerCase() : "";
        if (agentRoomName && agentRoomName === roomName.trim().toLowerCase()) {
          // Agent is already in the target room — goal will likely complete immediately
          completedCooldowns.set(cooldownKey, Date.now());
          ctx.removeEntity(world as any, tempGoalEid);
          continue;
        }

        // Attach goal to agent.
        ctx.addComponent(world as any, agentEid, HasGoal(tempGoalEid) as any);
        ctx.emit("goal_created", {
          agent: Name.value[agentEid],
          goal: Goal.description[tempGoalEid],
          reason: "schedule_activity",
          priority: Goal.priority[tempGoalEid],
        });
      }
    },
  };
}

function parseActivitiesJson(raw: string): any[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function timeWindowContainsHour(startHour: number, durationHours: number, hour: number): boolean {
  const start = ((Number(startHour) % 24) + 24) % 24;
  const duration = Math.max(0, Number(durationHours) || 0);
  const end = (start + duration) % 24;
  const h = ((Number(hour) % 24) + 24) % 24;
  if (duration <= 0) return false;
  if (start === end) return true; // 24h block (or ambiguous); treat as always active.
  // Handle midnight wrap.
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

function findQueuedGoalForSlot(world: World, agentEid: number, slot: { activityType: string; startHour: number }): number | undefined {
  const goals = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goals) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.kind[gid] || "") !== "scheduled_activity") continue;
    const status = String(Goal.status[gid] || "");
    if (status !== "queued") continue;
    try {
      const params = JSON.parse(String(Goal.paramsJson[gid] || "{}"));
      if (String(params?.activityType || "") !== slot.activityType) continue;
      if (Number(params?.startHour) !== Number(slot.startHour)) continue;
      return gid;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * DayPlanPreplanner - Seeds queued scheduled_activity goals for the whole day (once per sim day).
 *
 * These goals remain queued until their time window begins, at which point DayPlanActivationSystem
 * flips them to active and stamps createdAt so evaluation/macros are gated to the activity window.
 */
export function createDayPlanPreplannerSystem(): SystemDefinition {
  return {
    name: "DayPlanPreplanner",
    description: "Seeds queued scheduled activity goals for the full day from each agent's schedule",
    pseudocode: `
FOR EACH agent WITH Schedule:
  IF DayPlanState.plannedDay != world.time.simulationDay:
    FOR EACH scheduled activity in Schedule.activities:
      if supported:
        create Goal(kind=scheduled_activity, status=queued) with startHour/duration in params
    set DayPlanState.plannedDay = current day
`,
    frequency: 2000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const day = getCurrentDay(world as any);

      const agents = Array.from(ctx.query(world as any, [Agent, Name] as any)) as number[];
      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;
        const scheduleEid = getSchedule(world as any, agentEid);
        if (!scheduleEid) continue;
        if (!hasComponent(world as any, scheduleEid, Schedule as any)) continue;

        if (!hasComponent(world as any, agentEid, DayPlanState as any)) {
          ctx.addComponent(world as any, agentEid, DayPlanState as any);
          DayPlanState.plannedDay[agentEid] = 0;
          DayPlanState.lastPlannedAt[agentEid] = 0;
        }

        const already = Number(DayPlanState.plannedDay[agentEid] || 0);
        if (already === day) continue;

        const activities = parseActivitiesJson(String(Schedule.activities[scheduleEid] || ""));
        for (const raw of activities) {
          const name = typeof raw?.name === "string" ? raw.name : "";
          const startHour = Number(raw?.startHour);
          const durationHours = Number(raw?.duration ?? 1);
          const location = typeof raw?.location === "string" ? raw.location : "";
          const priority = Number(raw?.priority ?? 5);

          const classified = classifyActivity(name);
          if (!classified) continue;

          // Avoid duplicates for the (activityType,startHour) slot.
          const existingQueued = findQueuedGoalForSlot(world as any, agentEid, { activityType: classified.type, startHour });
          if (existingQueued !== undefined) continue;

          // Best-effort resolve to a real room name; use affordance grounding when possible.
          const desiredAffordances =
            classified.type === "sleep_block"
              ? ["sleep"]
              : classified.type === "eat_meal"
                ? ["eat", "drink"]
                : classified.type === "work_block"
                  ? ["search_files", "browse_web", "run_command"]
                  : classified.type === "leisure_block"
                    ? ["sit", "browse_web", "drink", "read"]
                    : [];

          const found =
            desiredAffordances.length > 0 ? findRoomWithAffordanceTarget(world as any, agentEid, location, desiredAffordances) : null;

          const resolvedRoomEid =
            found?.roomEid ??
            (location ? findRoomMatching(world as any, location) : undefined) ??
            getRoomForEntity(world as any, agentEid);
          if (resolvedRoomEid === undefined) continue;

          const roomName = String(Name.value[resolvedRoomEid] || location || "").trim();
          if (!roomName) continue;

          const contract = buildScheduledActivityContract({
            activityType: classified.type,
            label: classified.label,
            roomName,
            startHour,
            durationHours,
          });

          const goalEid = ctx.addEntity(world as any);
          ctx.addComponent(world as any, goalEid, Goal as any);
          ctx.addComponent(world as any, agentEid, HasGoal(goalEid) as any);
          Goal.description[goalEid] = contract.description || "";
          Goal.priority[goalEid] = Math.min(10, Math.max(1, Number.isFinite(priority) ? priority : 5));
          Goal.status[goalEid] = "queued";
          Goal.progress[goalEid] = 0;
          Goal.deadline[goalEid] = Date.now() + 24 * 60 * 60 * 1000;
          Goal.createdAt[goalEid] = 0; // stamped on activation
          setGoalContract(world as any, goalEid, contract);
        }

        DayPlanState.plannedDay[agentEid] = day;
        DayPlanState.lastPlannedAt[agentEid] = Date.now();
      }
    },
  };
}

/**
 * DayPlanActivationSystem - Activates queued scheduled_activity goals when their time window begins.
 *
 * - Sets Goal.status="active"
 * - Stamps Goal.createdAt=now so evaluation is gated to the window
 * - Ensures a move_to_room subgoal exists to reach the activity room
 */
export function createDayPlanActivationSystem(): SystemDefinition {
  return {
    name: "DayPlanActivation",
    description: "Activates queued day-plan activity goals when their scheduled time window starts",
    pseudocode: `
FOR EACH agent WITH queued scheduled_activity goals:
  IF current hour within [startHour, startHour+duration):
    set goal.status=active; set goal.createdAt=now; ensure move_to_room to roomName
  ELSE IF goal is queued and window already passed:
    set goal.status=expired
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const hour = getCurrentHour(world as any);
      const agents = Array.from(ctx.query(world as any, [Agent, Name] as any)) as number[];
      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;

        const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
        for (const goalEid of goalEids) {
          if (!entityExists(world as any, goalEid)) continue;
          if (!hasComponent(world as any, goalEid, Goal as any)) continue;
          if (String(Goal.kind[goalEid] || "") !== "scheduled_activity") continue;

          const status = String(Goal.status[goalEid] || "");
          if (status !== "queued") continue;

          let params: any = null;
          try {
            params = JSON.parse(String(Goal.paramsJson[goalEid] || "{}"));
          } catch {
            params = null;
          }

          const startHour = Number(params?.startHour);
          const durationHours = Number(params?.durationHours ?? 1);
          const roomName = typeof params?.roomName === "string" ? params.roomName : "";

          if (!Number.isFinite(startHour) || !Number.isFinite(durationHours) || durationHours <= 0) continue;
          if (!roomName.trim()) continue;

          if (timeWindowContainsHour(startHour, durationHours, hour)) {
            Goal.status[goalEid] = "active";
            Goal.createdAt[goalEid] = Date.now();
            // Provide a bit of urgency as the window progresses.
            Goal.priority[goalEid] = Math.min(10, Math.max(1, Number(Goal.priority[goalEid] || 5)));
            ensureMoveToRoomGoal(world as any, ctx, agentEid, roomName, Goal.priority[goalEid] || 5);
            continue;
          }

          // If window has clearly passed, expire it. (Best-effort: assume non-wrapping windows are most common.)
          const endHour = (Number(startHour) + Number(durationHours)) % 24;
          const startNorm = ((startHour % 24) + 24) % 24;
          const endNorm = ((endHour % 24) + 24) % 24;
          const hourNorm = ((Number(hour) % 24) + 24) % 24;
          const nonWrapping = startNorm < endNorm;
          if (nonWrapping && hourNorm >= endNorm && hourNorm < startNorm) {
            Goal.status[goalEid] = "expired";
          } else if (nonWrapping && hourNorm >= endNorm) {
            Goal.status[goalEid] = "expired";
          }
        }
      }
    },
  };
}

export function createScheduledActivityTemplatePlannerSystem(): SystemDefinition {
  return {
    name: "ScheduledActivityTemplatePlanner",
    description: "Creates deterministic micro-plans for scheduled activity goals once agents are in the right room",
    pseudocode: `
FOR EACH agent WITH active scheduled_activity goal:
  If no active plan for that goal and no learned macro:
    If agent is in the goal room:
      Find a usable bed/food and create a 2-step plan: observe -> interact
`,
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const agents = Array.from(ctx.query(world as any, [Agent, Name] as any)) as number[];
      const rooms = Array.from(ctx.query(world as any, [Room, Name] as any)) as number[];

      const roomByName = new Map<string, number>();
      for (const rid of rooms) {
        if (!entityExists(world as any, rid)) continue;
        const n = String(Name.value[rid] || "").trim();
        if (n) roomByName.set(normalize(n), rid);
      }

      for (const agentEid of agents) {
        if (!Agent.active[agentEid]) continue;

        const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
        for (const goalEid of goalEids) {
          if (!entityExists(world as any, goalEid)) continue;
          if (!hasComponent(world as any, goalEid, Goal as any)) continue;
          if (String(Goal.status[goalEid] || "") !== "active") continue;
          if (String(Goal.kind[goalEid] || "") !== "scheduled_activity") continue;

          // Skip if we already have an active plan for this goal.
          const existingPlan = getPlanForGoal(world as any, agentEid, goalEid);
          if (existingPlan && hasComponent(world as any, existingPlan, Plan as any) && String(Plan.status[existingPlan] || "") === "active") {
            continue;
          }

          // If we have a learned goal macro for this goal signature, do not create a template plan.
          // Procedural skills will auto-start when there is an active goal and no plan.
          if (hasGoalMacroForSignature(world as any, agentEid, goalEid)) continue;

          // Parse params (roomName + activityType).
          let params: any = null;
          try {
            params = JSON.parse(String(Goal.paramsJson[goalEid] || "{}"));
          } catch {
            params = null;
          }
          const roomName = params && typeof params.roomName === "string" ? params.roomName : "";
          const activityType = params && typeof params.activityType === "string" ? params.activityType : "";

          const targetRoomEid = roomByName.get(normalize(roomName));
          if (targetRoomEid === undefined) continue;

          const agentRoomEid = getRoomForEntity(world as any, agentEid);
          if (agentRoomEid === undefined || agentRoomEid !== targetRoomEid) continue;

          if (activityType === "socialize_block") {
            const other = findOtherAgentInRoom(world as any, targetRoomEid, agentEid);
            const otherName = other !== undefined ? String(Name.value[other] || "").trim() : "";
            const plan = otherName
              ? {
                  steps: [
                    { description: `Observe ${otherName}.`, actionType: "observe", target: otherName },
                    { description: `Greet ${otherName}.`, actionType: "speak", target: otherName, content: "Hello." },
                  ],
                }
              : {
                  steps: [{ description: "Wait and see who arrives.", actionType: "wait" }],
                };
            createPlanEntity(world as any, agentEid, goalEid, plan as any);
            continue;
          }

          const desiredAffordances =
            activityType === "sleep_block"
              ? ["sleep"]
              : activityType === "eat_meal"
                ? ["eat", "drink"]
                : activityType === "work_block"
                  ? ["search_files", "browse_web", "sit", "run_command"]
                  : ["sit", "browse_web", "drink", "read"];

          const found = roomHasAffordanceTarget(world as any, agentEid, targetRoomEid, desiredAffordances);
          if (found) {
            const targetName = String(Name.value[found.targetEid] || "").trim();
            if (!targetName) continue;
            const affordance = found.affordance;
            const content = affordance === "run_command" ? "run_command echo working" : affordance;
            const plan = {
              steps: [
                { description: `Observe ${targetName}.`, actionType: "observe", target: targetName },
                { description: `Use ${affordance} on ${targetName}.`, actionType: "interact", target: targetName, content },
              ],
            };
            createPlanEntity(world as any, agentEid, goalEid, plan as any);
            continue;
          }

          // No obvious target: still create a minimal plan so the activity can be "done" deterministically.
          const observeTargetEid = findObservableTargetInRoom(world as any, targetRoomEid, agentEid);
          const observeTargetName = observeTargetEid !== undefined ? String(Name.value[observeTargetEid] || "").trim() : "";
          const plan = observeTargetName
            ? {
                steps: [
                  { description: `Observe ${observeTargetName}.`, actionType: "observe", target: observeTargetName },
                  { description: `Examine ${observeTargetName}.`, actionType: "interact", target: observeTargetName, content: "examine" },
                ],
              }
            : {
                steps: [{ description: "Wait for a moment.", actionType: "wait" }],
              };
          createPlanEntity(world as any, agentEid, goalEid, plan as any);
        }
      }
    },
  };
}
