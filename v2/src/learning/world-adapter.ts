/** What a world package tells the skill library about its own entities. All
 * optional: without an adapter, abstraction uses native ObjectType/Traits and
 * schedules only, and nothing is treated as story-bound. The adapter is read
 * at harvest (to abstract) and at run time (to bind queries); it grants no
 * authority and is never shown to a resident. */
import { hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Name, ObjectType, Room, Schedule, Traits } from "../ecs/components";
import { getCurrentActivity, getSchedule } from "../cognition/schedule-system";
import type { ScheduledActivity } from "../cognition/schedule-system";

export interface SkillWorldAdapter {
  /** The authored scenario this world belongs to (scope for story-bound skills). */
  scenarioId?: string;
  /** Story-unique things: authored props with private text, plot objects. */
  isScenarioEntity?(eid: number): boolean;
  /** Verbs only this scenario installs (e.g. read/knock/write_note in Saltmere). */
  scenarioVerbs?: readonly string[];
  /** Proper nouns/phrases that only make sense in this scenario. */
  scenarioTerms?: readonly string[];
  /** A finer, world-portable kind than ObjectType (e.g. a catalog asset id). */
  entityKind?(eid: number): string | undefined;
  homeRoom?(agentEid: number): number | undefined;
  workplaceRoom?(agentEid: number): number | undefined;
  /** A world-portable kind of public place ("square", "cafe", "garden");
   * undefined for private dwellings and places without a meaningful kind. */
  placeKind?(roomEid: number): string | undefined;
}

const adapters = new WeakMap<World, SkillWorldAdapter>();
export function setSkillWorldAdapter(world: World, adapter: SkillWorldAdapter | undefined): void {
  if (adapter) adapters.set(world, adapter); else adapters.delete(world);
}
export function getSkillWorldAdapter(world: World): SkillWorldAdapter {
  return adapters.get(world) ?? {};
}

export function entityTraits(eid: number): string[] {
  try {
    const parsed = JSON.parse(Traits.active[eid] || "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").sort() : [];
  } catch { return []; }
}
export function entityObjectType(world: World, eid: number): string | undefined {
  return hasComponent(world, eid, ObjectType) ? ObjectType.typeId[eid] || undefined : undefined;
}
export function entityKind(world: World, eid: number): string | undefined {
  try { return getSkillWorldAdapter(world).entityKind?.(eid) || undefined; } catch { return undefined; }
}

function roomNamed(world: World, name: string | undefined): number | undefined {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return undefined;
  return [...query(world, [Room, Name])].find(id => Name.value[id]?.trim().toLowerCase() === wanted);
}
function activities(world: World, eid: number): ScheduledActivity[] {
  const schedule = getSchedule(world, eid);
  if (schedule === undefined || !hasComponent(world, schedule, Schedule)) return [];
  try { const rows = JSON.parse(Schedule.activities[schedule] || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; }
}

/** Home: the adapter's answer, else where the resident's schedule says they sleep. */
export function homeRoomOf(world: World, eid: number): number | undefined {
  const adapter = getSkillWorldAdapter(world);
  try { const home = adapter.homeRoom?.(eid); if (home !== undefined) return home; } catch { /* adapter fault: fall back */ }
  return roomNamed(world, activities(world, eid).find(a => /sleep|bed/i.test(a.name) && a.location)?.location);
}
/** Workplace: the adapter's answer, else the longest located non-sleep activity. */
export function workplaceRoomOf(world: World, eid: number): number | undefined {
  const adapter = getSkillWorldAdapter(world);
  try { const work = adapter.workplaceRoom?.(eid); if (work !== undefined) return work; } catch { /* adapter fault: fall back */ }
  const located = activities(world, eid).filter(a => a.location && !/sleep|bed|breakfast/i.test(a.name))
    .sort((a, b) => (b.duration || 0) - (a.duration || 0) || (b.priority || 0) - (a.priority || 0));
  return roomNamed(world, located[0]?.location);
}
export function currentActivityRoom(world: World, eid: number): number | undefined {
  return roomNamed(world, getCurrentActivity(world, eid)?.location);
}

export function placeKindOf(world: World, room: number): string | undefined {
  try { return getSkillWorldAdapter(world).placeKind?.(room)?.trim().toLowerCase() || undefined; } catch { return undefined; }
}
