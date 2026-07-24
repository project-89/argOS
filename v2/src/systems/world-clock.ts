/**
 * World Clock System — Pure ECS time management
 *
 * Creates and maintains a clock entity with WorldClock component.
 * Advances time each tick: morning → midday → evening → night → morning (new day).
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

// =============================================================================
// CONSTANTS
// =============================================================================

export const PERIODS = ["morning", "midday", "evening", "night"] as const;
export type Period = typeof PERIODS[number];

const DEFAULT_TICKS_PER_PERIOD = 20;

// =============================================================================
// CLOCK ENTITY MANAGEMENT
// =============================================================================

/** Create the world clock entity. Call once at simulation start. */
export function createWorldClock(
  world: World,
  options: { ticksPerPeriod?: number; startPeriod?: Period; startDay?: number } = {},
): number {
  const eid = addEntity(world);
  addComponent(world, eid, WorldClock as any);
  addComponent(world, eid, Name as any);

  Name.value[eid] = "WorldClock";
  WorldClock.period[eid] = options.startPeriod || "morning";
  WorldClock.tick[eid] = 0;
  WorldClock.ticksPerPeriod[eid] = options.ticksPerPeriod ?? DEFAULT_TICKS_PER_PERIOD;
  WorldClock.day[eid] = options.startDay ?? 1;
  WorldClock.totalTicks[eid] = 0;

  return eid;
}

/** Get the current time period. Returns "morning" if no clock exists. */
export function getCurrentPeriod(world: World): Period {
  const clocks = Array.from(query(world as any, [WorldClock as any]));
  if (clocks.length === 0) return "morning";
  return (WorldClock.period[clocks[0]] || "morning") as Period;
}

/** Get the current day number. */
export function getCurrentDay(world: World): number {
  const clocks = Array.from(query(world as any, [WorldClock as any]));
  if (clocks.length === 0) return 1;
  return WorldClock.day[clocks[0]] || 1;
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
    return { period: "morning", day: 1, tickInPeriod: 0, ticksPerPeriod: DEFAULT_TICKS_PER_PERIOD, totalTicks: 0 };
  }
  const eid = clocks[0];
  return {
    period: (WorldClock.period[eid] || "morning") as Period,
    day: WorldClock.day[eid] || 1,
    tickInPeriod: WorldClock.tick[eid] || 0,
    ticksPerPeriod: WorldClock.ticksPerPeriod[eid] || DEFAULT_TICKS_PER_PERIOD,
    totalTicks: WorldClock.totalTicks[eid] || 0,
  };
}

// =============================================================================
// CLOCK ADVANCEMENT
// =============================================================================

/**
 * Advance the world clock by one tick.
 * When a period ends, transitions to the next period.
 * When night ends, advances to a new day.
 * Returns the new period if it changed, null otherwise.
 */
export function advanceWorldClock(world: World): Period | null {
  const clocks = Array.from(query(world as any, [WorldClock as any]));
  if (clocks.length === 0) return null;

  const eid = clocks[0];
  WorldClock.totalTicks[eid] = (WorldClock.totalTicks[eid] || 0) + 1;
  WorldClock.tick[eid] = (WorldClock.tick[eid] || 0) + 1;

  const ticksPerPeriod = WorldClock.ticksPerPeriod[eid] || DEFAULT_TICKS_PER_PERIOD;

  if (WorldClock.tick[eid] >= ticksPerPeriod) {
    // Period transition
    WorldClock.tick[eid] = 0;
    const currentPeriod = WorldClock.period[eid] || "morning";
    const currentIdx = PERIODS.indexOf(currentPeriod as Period);
    const nextIdx = (currentIdx + 1) % PERIODS.length;
    const nextPeriod = PERIODS[nextIdx];

    WorldClock.period[eid] = nextPeriod;

    // New day when cycling back to morning
    if (nextPeriod === "morning") {
      WorldClock.day[eid] = (WorldClock.day[eid] || 1) + 1;
    }

    chronicle.record("phase_change", {
      period: nextPeriod,
      day: WorldClock.day[eid],
      totalTicks: WorldClock.totalTicks[eid],
    });

    return nextPeriod;
  }

  return null;
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
    affectsGoals?: Record<string, number>;  // e.g. { social: 2, survive: -1 }
    location?: string;       // "" = global
  },
): number {
  const eid = addEntity(world);
  addComponent(world, eid, WorldEvent as any);
  addComponent(world, eid, Name as any);

  Name.value[eid] = config.name;
  WorldEvent.name[eid] = config.name;
  WorldEvent.eventType[eid] = config.eventType;
  WorldEvent.description[eid] = config.description;
  WorldEvent.priority[eid] = config.priority ?? 50;
  WorldEvent.duration[eid] = config.duration ?? 0;
  WorldEvent.affectsGoals[eid] = JSON.stringify(config.affectsGoals || {});
  WorldEvent.location[eid] = config.location || "";

  // Start tick from world clock
  const clock = getClockState(world);
  WorldEvent.startTick[eid] = clock.totalTicks;

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
  const clock = getClockState(world);
  const eventEids = Array.from(query(world as any, [WorldEvent as any]));
  let expired = 0;

  for (const eid of eventEids) {
    const duration = WorldEvent.duration[eid] || 0;
    if (duration <= 0) continue; // Permanent event

    const startTick = WorldEvent.startTick[eid] || 0;
    if (clock.totalTicks - startTick >= duration) {
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

  const periodDescriptions: Record<string, string> = {
    morning: "It is morning — time for work, chores, and starting the day's tasks.",
    midday: "It is midday — time to eat, rest briefly, and tend to basic needs.",
    evening: "It is evening — time to wind down, socialize, share stories, and visit the tavern.",
    night: "It is night — time to rest, sleep, and reflect on the day.",
  };

  let context = `\nTIME OF DAY: ${clock.period.toUpperCase()} (Day ${clock.day})`;
  context += `\n${periodDescriptions[clock.period] || ""}`;

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
