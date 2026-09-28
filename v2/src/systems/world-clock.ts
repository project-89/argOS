/**
 * World Clock System — Pure ECS time management
 *
 * Creates and maintains a clock entity with WorldClock component.
 * Projects the authoritative simulation calendar; polling does not advance time.
 *
 * Also manages WorldEvent entities:
 *   - Expires events whose duration has elapsed
 *   - Injects event awareness into agent perceptions at event start
 *
 * The clock and events are just entities — queryable, composable, and
 * manipulable by the God AI with standard ECS tools.
 */

import { addEntity, addComponent, removeEntity, query, hasComponent } from "bitecs";
import { WorldClock, WorldEvent, Name, Agent } from "../ecs/components";
import type { World } from "../ecs/world";
import { chronicle } from "../cognition/simulation-chronicle";
import { formatSimulationHour, readSimulationTime, simulationDayPhase } from "../ecs/simulation-time";
import { getStampedSimulationTime, stampSimulationTime } from "../ecs/temporal-age";

// =============================================================================
// CONSTANTS
// =============================================================================

export const PERIODS = ["morning", "midday", "evening", "night"] as const;
export type Period = typeof PERIODS[number];

const DEFAULT_TICKS_PER_PERIOD = 20;
const LEGACY_EVENT_TICK_MS = 1_000;
const PERIOD_HOUR: Record<Period, number> = { morning: 5, midday: 12, evening: 18, night: 21 };
function calendarPeriod(world: World): Period {
  const hour = world.time.simulationHour;
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "midday" : hour >= 18 && hour < 21 ? "evening" : "night";
}

// =============================================================================
// CLOCK ENTITY MANAGEMENT
// =============================================================================

/** Create the world clock entity. Call once at simulation start. */
export function createWorldClock(
  world: World,
  options: { ticksPerPeriod?: number; startPeriod?: Period; startDay?: number } = {},
): number {
  if (options.startPeriod !== undefined && !PERIODS.includes(options.startPeriod)) throw new RangeError("Invalid starting calendar period");
  if (options.startDay !== undefined && (!Number.isSafeInteger(options.startDay) || options.startDay < 1)) throw new RangeError("Starting day must be a positive integer");
  if (options.ticksPerPeriod !== undefined && (!Number.isSafeInteger(options.ticksPerPeriod) || options.ticksPerPeriod <= 0)) throw new RangeError("Legacy display slots must be a positive integer");
  if (options.startPeriod) {
    world.time.simulationHour = options.startPeriod === "morning" ? 8 : PERIOD_HOUR[options.startPeriod];
    world.time.timeOfDay = simulationDayPhase(world.time.simulationHour);
  }
  if (options.startDay !== undefined) world.time.simulationDay = options.startDay;
  const eid = addEntity(world);
  addComponent(world, eid, WorldClock as any);
  addComponent(world, eid, Name as any);

  Name.value[eid] = "WorldClock";
  WorldClock.period[eid] = calendarPeriod(world);
  WorldClock.tick[eid] = 0;
  WorldClock.ticksPerPeriod[eid] = options.ticksPerPeriod ?? DEFAULT_TICKS_PER_PERIOD;
  WorldClock.day[eid] = world.time.simulationDay;
  WorldClock.totalTicks[eid] = world.time.tick;

  return eid;
}

/** Get the current time period, even without a legacy projection entity. */
export function getCurrentPeriod(world: World): Period {
  return calendarPeriod(world);
}

/** Get the current day number. */
export function getCurrentDay(world: World): number {
  return world.time.simulationDay;
}

/** Get full clock state for context injection. */
export function getClockState(world: World): {
  period: Period;
  day: number;
  tickInPeriod: number;
  ticksPerPeriod: number;
  totalTicks: number;
} {
  const clocks = Array.from(query(world as any, [WorldClock as any]));
  if (clocks.length === 0) {
    return { period: calendarPeriod(world), day: world.time.simulationDay, tickInPeriod: 0, ticksPerPeriod: DEFAULT_TICKS_PER_PERIOD, totalTicks: world.time.tick };
  }
  const eid = clocks[0];
  return {
    period: calendarPeriod(world),
    day: world.time.simulationDay,
    tickInPeriod: WorldClock.tick[eid] || 0,
    ticksPerPeriod: WorldClock.ticksPerPeriod[eid] || DEFAULT_TICKS_PER_PERIOD,
    totalTicks: world.time.tick,
  };
}

// =============================================================================
// CLOCK ADVANCEMENT
// =============================================================================

/**
 * Refresh the legacy calendar projection after physical time has advanced.
 * MUD input and LIL turns call this safely without creating a second clock.
 * Returns the new period if it changed, null otherwise.
 */
export function advanceWorldClock(world: World): Period | null {
  const clocks = Array.from(query(world as any, [WorldClock as any]));
  if (clocks.length === 0) return null;

  const eid = clocks[0];
  migrateLegacyEvents(world, WorldClock.totalTicks[eid] || 0);
  const period = calendarPeriod(world), changed = period !== WorldClock.period[eid] || world.time.simulationDay !== WorldClock.day[eid];
  WorldClock.period[eid] = period;
  WorldClock.day[eid] = world.time.simulationDay;
  WorldClock.totalTicks[eid] = world.time.tick;
  // This entity is a calendar projection, never another physical clock. Legacy
  // display slots remain available but cannot turn polling into lived time.
  const hours = period === "night" ? 8 : period === "morning" ? 7 : period === "midday" ? 6 : 3;
  const elapsedHours = (world.time.simulationHour - PERIOD_HOUR[period] + 24) % 24;
  WorldClock.tick[eid] = Math.floor(elapsedHours / hours * (WorldClock.ticksPerPeriod[eid] || DEFAULT_TICKS_PER_PERIOD));
  if (changed) chronicle.record("phase_change", { period, day: world.time.simulationDay, totalTicks: world.time.tick });
  return changed ? period : null;
}

function migrateLegacyEvents(world: World, legacyTicks: number): void {
  for (const eid of query(world, [WorldEvent])) {
    if (Number.isFinite(WorldEvent.durationMs[eid])
      && getStampedSimulationTime(world, eid, "WorldEvent.startTick", WorldEvent.startTick[eid] || 0) !== undefined) continue;
    WorldEvent.durationMs[eid] = Math.max(0, WorldEvent.duration[eid] || 0) * LEGACY_EVENT_TICK_MS;
    const age = Math.max(0, legacyTicks - (WorldEvent.startTick[eid] || 0)) * LEGACY_EVENT_TICK_MS;
    stampSimulationTime(world, eid, "WorldEvent.startTick", WorldEvent.startTick[eid] || 0, readSimulationTime(world) - age);
  }
}

// =============================================================================
// WORLD EVENTS
// =============================================================================

/** Create a world event entity. Returns the event entity ID. */
export function createWorldEvent(
  world: World,
  config: {
    name: string;
    eventType: string;
    description: string;
    priority?: number;
    duration?: number;       // 0 = permanent
    durationMs?: number;     // Explicit in-world milliseconds; preferred over legacy duration ticks
    affectsGoals?: Record<string, number>;  // e.g. { social: 2, survive: -1 }
    location?: string;       // "" = global
  },
): number {
  const durationMs = config.durationMs ?? (config.duration ?? 0) * LEGACY_EVENT_TICK_MS;
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError("World event duration must be non-negative in-world milliseconds");
  const eid = addEntity(world);
  addComponent(world, eid, WorldEvent as any);
  addComponent(world, eid, Name as any);

  Name.value[eid] = config.name;
  WorldEvent.name[eid] = config.name;
  WorldEvent.eventType[eid] = config.eventType;
  WorldEvent.description[eid] = config.description;
  WorldEvent.priority[eid] = config.priority ?? 50;
  WorldEvent.duration[eid] = config.duration ?? 0;
  WorldEvent.durationMs[eid] = durationMs;
  WorldEvent.affectsGoals[eid] = JSON.stringify(config.affectsGoals || {});
  WorldEvent.location[eid] = config.location || "";

  // Start tick from world clock
  const clock = getClockState(world);
  WorldEvent.startTick[eid] = clock.totalTicks;
  stampSimulationTime(world, eid, "WorldEvent.startTick", WorldEvent.startTick[eid]);

  chronicle.record("crisis_event", {
    name: config.name,
    type: config.eventType,
    description: config.description,
    priority: config.priority ?? 50,
  });

  console.log(`[WorldEvent] "${config.name}" started (${config.eventType}, priority ${config.priority ?? 50})`);

  return eid;
}

/** Get all active world events, sorted by priority (highest first). */
export function getActiveWorldEvents(world: World): Array<{
  eid: number;
  name: string;
  eventType: string;
  description: string;
  priority: number;
  location: string;
  affectsGoals: Record<string, number>;
}> {
  const eventEids = Array.from(query(world as any, [WorldEvent as any]));

  return eventEids
    .map(eid => ({
      eid,
      name: WorldEvent.name[eid] || "",
      eventType: WorldEvent.eventType[eid] || "",
      description: WorldEvent.description[eid] || "",
      priority: WorldEvent.priority[eid] || 0,
      location: WorldEvent.location[eid] || "",
      affectsGoals: safeParseJSON(WorldEvent.affectsGoals[eid]),
    }))
    .sort((a, b) => b.priority - a.priority);
}

/** Expire world events that have exceeded their duration. */
export function expireWorldEvents(world: World): number {
  const clockEntity = Array.from(query(world, [WorldClock]))[0];
  migrateLegacyEvents(world, clockEntity === undefined ? world.time.tick : WorldClock.totalTicks[clockEntity] || 0);
  const eventEids = Array.from(query(world as any, [WorldEvent as any]));
  let expired = 0;

  for (const eid of eventEids) {
    const duration = WorldEvent.durationMs[eid] || 0;
    if (duration <= 0) continue; // Permanent event

    const startTick = WorldEvent.startTick[eid] || 0;
    const startedAt = getStampedSimulationTime(world, eid, "WorldEvent.startTick", startTick) ?? readSimulationTime(world);
    if (readSimulationTime(world) - startedAt >= duration) {
      const name = WorldEvent.name[eid] || "unknown event";
      console.log(`[WorldEvent] "${name}" ended (duration expired)`);
      chronicle.record("crisis_event", { name, ended: true });
      removeEntity(world as any, eid);
      expired++;
    }
  }

  return expired;
}

// =============================================================================
// CONTEXT FORMATTING (for agent LLM prompts)
// =============================================================================

/** Format current time and events for injection into agent context. */
export function formatWorldTimeForContext(world: World): string {
  const clock = getClockState(world);
  const events = getActiveWorldEvents(world);

  // Report the calendar, not a generic agenda. A broad period alone cannot
  // establish whether a remembered appointment is due.
  let context = `\nTIME OF DAY: ${simulationDayPhase(world.time.simulationHour).toUpperCase()} (Day ${clock.day})`;
  context += `\nCURRENT WORLD TIME: ${formatSimulationHour(world.time.simulationHour)} (Day ${clock.day})`;
  context += `\nLIVED TIME: ${(readSimulationTime(world) / 1000).toFixed(1)} seconds elapsed in this simulation, not time spent computing or rendering.`;

  if (events.length > 0) {
    context += `\n\nACTIVE EVENTS:`;
    for (const evt of events) {
      const loc = evt.location ? ` (at ${evt.location})` : " (village-wide)";
      context += `\n- ${evt.name}${loc}: ${evt.description}`;
    }
    context += `\nThese events should influence what you choose to focus on.`;
  }

  return context;
}

/** Get goal biases from time of day + active events. */
export function getGoalBiases(world: World): Record<string, number> {
  const clock = getClockState(world);
  const events = getActiveWorldEvents(world);

  // Base biases from time of day
  const timeBiases: Record<string, Record<string, number>> = {
    morning:  { craft: 2, improve: 2, acquire: 1, explore: 1, social: -1 },
    midday:   { survive: 2, craft: 1, social: 1 },
    evening:  { social: 3, explore: 1, craft: -1, survive: 1 },
    night:    { survive: 2, social: -1, craft: -2, explore: -2 },
  };

  const biases: Record<string, number> = { ...(timeBiases[clock.period] || {}) };

  // Layer event biases on top
  for (const evt of events) {
    for (const [kind, modifier] of Object.entries(evt.affectsGoals)) {
      biases[kind] = (biases[kind] || 0) + modifier;
    }
  }

  return biases;
}

// =============================================================================
// HELPERS
// =============================================================================

function safeParseJSON(str: string | undefined): Record<string, number> {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}
