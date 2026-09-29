/** Run-time binding of abstract procedure steps (library skills) to this
 * world: a kind of thing to a visible entity, a kind of place to a room, a kind
 * of person to someone perceptible. Binding reads only what the resident can
 * perceive plus public layout (furniture standing in rooms) and their own
 * routine (home, schedule); it never reads a hidden object's current location. */
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, ObjectState, Position, Room } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getAgentVisibleEntities, getAgentWorldCapabilities } from "../cognition/world-capabilities";
import { getSocialDialogue } from "../cognition/social-memory";
import type { PersonQuery, PlaceQuery, TargetQuery } from "./library";
import { entityKind, entityObjectType, entityTraits, homeRoomOf, workplaceRoomOf } from "./world-adapter";

const STRUCTURE = new Set(["structural_wall"]);

function distance(a: number, b: number): number {
  const ax = Position.x[a], ay = Position.y[a], bx = Position.x[b], by = Position.y[b];
  if (![ax, ay, bx, by].every(Number.isFinite)) return 0;
  return Math.hypot(ax - bx, ay - by);
}
const byNearest = (actor: number) => (a: number, b: number) => distance(actor, a) - distance(actor, b) || a - b;

/** Does this entity satisfy the kind-of-thing description? (Affordance checked separately.) */
export function entityMatchesQuery(world: World, eid: number, q: TargetQuery): boolean {
  if (!entityExists(world, eid) || hasComponent(world, eid, Agent) || hasComponent(world, eid, Room) || !Name.value[eid]) return false;
  const type = entityObjectType(world, eid);
  if (type && STRUCTURE.has(type)) return false;
  if (q.objectType && type !== q.objectType) return false;
  if (q.kind) {
    const kind = entityKind(world, eid);
    // A world without a kind oracle falls back to the native object type.
    if (kind !== undefined && kind !== q.kind) return false;
  }
  if (q.traits?.length) {
    const traits = new Set(entityTraits(eid));
    if (!q.traits.every(t => traits.has(t))) return false;
  }
  return true;
}

function offersAffordance(world: World, actor: number, eid: number, affordance: string | undefined): boolean {
  if (!affordance) return true;
  const capabilities = getAgentWorldCapabilities(world, actor);
  const names = (list?: Array<{ name: string }>) => (list ?? []).map(a => a.name.toLowerCase());
  if (!capabilities?.affordances) return true; // native world: executor admission decides
  const wanted = affordance.toLowerCase();
  try {
    return names(capabilities.affordances(eid)).includes(wanted) || names(capabilities.knownAffordances?.(eid)).includes(wanted);
  } catch { return false; }
}

/** Nearest visible, available entity of the described kind that offers the affordance. */
export function bindTargetQuery(world: World, actor: number, q: TargetQuery): number | undefined {
  return getAgentVisibleEntities(world, actor)
    .filter(eid => eid !== actor && entityMatchesQuery(world, eid, q))
    .filter(eid => ObjectState.current[eid] !== "occupied")
    .filter(eid => offersAffordance(world, actor, eid, q.affordance))
    .sort(byNearest(actor))[0];
}

function roomHas(world: World, room: number, q: { objectType?: string; kind?: string }): boolean {
  // Public layout only: things standing in the room, not the insides of containers.
  return listDirectContents(world, room).some(eid => entityMatchesQuery(world, eid, q));
}

/** A room for the place query, or undefined when this resident has no such place. */
export function bindPlaceQuery(world: World, actor: number, q: PlaceQuery): number | undefined {
  const here = getRoomForEntity(world, actor);
  if (q.place === "current") return here;
  if (q.place === "home") return homeRoomOf(world, actor);
  if (q.place === "workplace") return workplaceRoomOf(world, actor);
  if (!q.objectType && !q.kind) return undefined;
  if (here !== undefined && roomHas(world, here, q)) return here;
  let reachable: number[] | undefined;
  try { reachable = getAgentWorldCapabilities(world, actor)?.movementTargets?.(); } catch { reachable = undefined; }
  const rooms = [...query(world, [Room, Name])].filter(room => room !== here && (!reachable || reachable.includes(room)));
  return rooms.filter(room => roomHas(world, room, q)).sort(byNearest(actor))[0];
}

function visiblePeople(world: World, actor: number): number[] {
  return getAgentVisibleEntities(world, actor)
    .filter(eid => eid !== actor && hasComponent(world, eid, Agent) && !!Agent.active[eid] && !!Name.value[eid])
    .sort(byNearest(actor));
}

/** The person a remembered line or gesture was for: whoever is talking with me, else someone here. */
export function bindPerson(world: World, actor: number, q: PersonQuery): number | undefined {
  const people = visiblePeople(world, actor);
  if (!people.length) return undefined;
  const named = (name: string | undefined) => name ? people.find(eid => Name.value[eid].toLowerCase() === name.toLowerCase()) : undefined;
  if (q.person === "role") return people.find(eid => String(Agent.role[eid] || "").toLowerCase().includes(q.role.toLowerCase()));
  if (q.person === "addressee") {
    const now = readSimulationTime(world), me = Name.value[actor];
    const recent = getSocialDialogue(world, actor)
      .filter(turn => now - (turn.simulation?.completedAtSimMs ?? turn.atSimMs ?? 0) <= 120_000)
      .reverse();
    for (const turn of recent) {
      const partner = turn.own ? named(turn.target) : turn.target === me || !turn.target ? named(turn.speaker) : undefined;
      if (partner !== undefined) return partner;
    }
  }
  return people[0];
}

export type PlaceholderValues = { addressee?: string; person?: string; object?: string; place?: string };
export function fillPlaceholders(content: string, values: PlaceholderValues): string {
  return content
    .replace(/\{addressee\}/g, values.addressee ?? values.person ?? "you")
    .replace(/\{person\}/g, values.person ?? values.addressee ?? "someone")
    .replace(/\{object\}/g, values.object ?? "it")
    .replace(/\{place\}/g, values.place ?? "here");
}
export const hasPlaceholder = (content: string | undefined) => !!content && /\{(addressee|person|object|place)\}/.test(content);
