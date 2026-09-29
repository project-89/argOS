/** Authored world package: data supplies opportunities; native cognition chooses
 * what to do with them. This is not a controller or a construction permission. */
import type { AgentConfig } from "../index";
import type { CharacterAppearanceConfig } from "../rendering/character-appearance";
import type { ScheduledActivity } from "../cognition/schedule-system";
import { SPATIAL_ASSETS, validateSpatialBlueprint, type SpatialBlueprint, type SpatialBounds } from "./spatial-catalog";
import { createSpatialGeometry, findSpatialPath } from "../world/spatial-path";

export interface SpatialResident extends AgentConfig {
  id: string;
  homeRoomId?: string;
  startRoomId: string;
  assetId: string;
  personality?: string;
  aspirations: string[];
  appearance: CharacterAppearanceConfig;
  needs: { hunger: number; energy: number };
  initialGoal: { description: string; priority: number; kind?: "custom" | "social" };
  phoneId?: string;
  phoneContact?: { name: string; description: string; memory: string };
  initialObservation?: string;
  /** This person's own daily rhythm (livelihood, evening habits). Installed in
   * place of the generic baseline; it is context and intention, not a script. */
  schedule?: ScheduledActivity[];
}

export interface SpatialScenarioDefinition {
  id: string;
  title: string;
  blueprint: SpatialBlueprint;
  bounds: SpatialBounds;
  residents: SpatialResident[];
  maxWorldEntities: number;
  /** Explicit host choice; a larger town changes resolution, not clock/speed. */
  navigationCellSize?: .25 | .5 | 1;
}

/** Preflight before createSimulation allocates anything. Validate the renderer,
 * navigation and resident bindings as one package, then detach caller data.
 * The host's bounded navigation grid and per-session construction ceiling cannot be
 * bypassed by a pretty scene or a resident naming an uninstalled object. */
/** The pathfinder's own ceiling. */
export const SPATIAL_MAX_GRID_CELLS = 65_536;
export function spatialGridCells(b: { minX: number; minY: number; maxX: number; maxY: number }, cellSize: number): number {
  return (Math.floor((b.maxX - b.minX) / cellSize) + 1) * (Math.floor((b.maxY - b.minY) / cellSize) + 1);
}
export function validateSpatialScenario(input: SpatialScenarioDefinition): SpatialScenarioDefinition {
  const value = structuredClone(input);
  value.blueprint = validateSpatialBlueprint(value.blueprint);
  const { bounds: b, blueprint, residents } = value;
  const cellSize = value.navigationCellSize ?? .25;
  // 1 m cells serve large outdoor worlds (a 160 m map paths in ~27 ms, measured
  // 2026-09-29, against ~18 ms for the 48 m town at .5 m).
  if (cellSize !== .25 && cellSize !== .5 && cellSize !== 1) throw Error("Unsupported navigation resolution");
  if (!value.id?.trim() || !value.title?.trim() || !b || !Object.values(b).every(Number.isFinite)
    || b.maxX <= b.minX || b.maxY <= b.minY
    || spatialGridCells(b, cellSize) > SPATIAL_MAX_GRID_CELLS)
    throw Error("Scenario exceeds the bounded spatial grid");
  if (!Number.isSafeInteger(value.maxWorldEntities) || value.maxWorldEntities < 1 || value.maxWorldEntities > 1000)
    throw Error("Scenario needs a bounded construction budget");
  const count = blueprint.rooms.length + blueprint.props.length + blueprint.walls.length + blueprint.spawns.length;
  if (count > value.maxWorldEntities) throw Error("Scenario seed exceeds its construction budget");
  if (blueprint.rooms.some(r => r.bounds.minX < b.minX || r.bounds.minY < b.minY || r.bounds.maxX > b.maxX || r.bounds.maxY > b.maxY))
    throw Error("Scenario room leaves the navigation bounds");
  const names = [...blueprint.rooms, ...blueprint.props, ...blueprint.spawns].map(row => row.name.toLowerCase().trim());
  names.push(...blueprint.walls.map(row => row.id.toLowerCase()));
  if (new Set(names).size !== names.length) throw Error("Scenario names must resolve unambiguously");
  if (!residents.length || residents.length !== blueprint.spawns.length || new Set(residents.map(r => r.id)).size !== residents.length)
    throw Error("Every spawn needs exactly one resident");
  const phones = new Set<string>();
  for (const r of residents) {
    const spawn = blueprint.spawns.find(s => s.id === r.id), room = blueprint.rooms.find(room => room.id === r.startRoomId);
    if (!spawn || !room || spawn.name !== r.name || spawn.roomId !== room.id || r.startRoom !== room.name || spawn.assetId !== r.assetId
      || r.homeRoomId && !blueprint.rooms.some(room => room.id === r.homeRoomId))
      throw Error("Resident identity, appearance and starting room must agree with the blueprint");
    if (!r.needs || ![r.needs.hunger, r.needs.energy].every(n => Number.isFinite(n) && n >= 0 && n <= 100)
      || !r.initialGoal?.description?.trim() || r.initialGoal.description.trim().length > 300
      || !Number.isInteger(r.initialGoal.priority) || r.initialGoal.priority < 1 || r.initialGoal.priority > 10
      || r.initialGoal.kind !== undefined && !["custom", "social"].includes(r.initialGoal.kind)
      || !Array.isArray(r.aspirations) || !r.aspirations.length || r.aspirations.length > 12
      || r.aspirations.some(a => typeof a !== "string" || !a.trim() || a.length > 500))
      throw Error("Resident needs, aspirations and opening intention must be bounded and explicit");
    if (r.schedule !== undefined && (!Array.isArray(r.schedule) || !r.schedule.length || r.schedule.length > 12
      || r.schedule.some(a => !a || typeof a.name !== "string" || !a.name.trim() || a.name.length > 80
        || !Number.isInteger(a.startHour) || a.startHour < 0 || a.startHour > 23 || !Number.isFinite(a.duration) || a.duration <= 0 || a.duration > 24
        || !Number.isInteger(a.priority) || a.priority < 1 || a.priority > 10 || typeof a.interruptible !== "boolean"
        || a.location !== undefined && !blueprint.rooms.some(room => room.name === a.location)
        || a.description !== undefined && (typeof a.description !== "string" || a.description.length > 300))))
      throw Error("Resident schedules must be bounded and name installed places");
    if (r.phoneContact && (!r.phoneId || !r.phoneContact.name.trim() || !r.phoneContact.description.trim() || !r.phoneContact.memory.trim()))
      throw Error("A phone relationship requires a bound physical phone and authored context");
    if (r.phoneId) {
      const phone = blueprint.props.find(p => p.id === r.phoneId);
      if (!phone || phone.assetId !== "phone" || phones.has(r.phoneId)) throw Error("Resident phone must be unique and physically installed");
      phones.add(r.phoneId);
    }
  }
  if (cellSize !== .25) {
    // A layout connected on the fine catalog grid may be impassable at the
    // selected motor resolution. Check the real continuous collision geometry
    // and endpoint connectors, still before allocating any ECS identity.
    const obstacles = [...blueprint.walls, ...blueprint.props.flatMap(p => {
      const collider = SPATIAL_ASSETS[p.assetId].collider;
      return collider ? [{ position: p.position, ...collider }] : [];
    })].map(c => ({ minX: c.position.x - c.halfWidth, maxX: c.position.x + c.halfWidth,
      minY: c.position.y - c.halfDepth, maxY: c.position.y + c.halfDepth }));
    const shape = createSpatialGeometry(b, blueprint.rooms.map(r => r.bounds), obstacles, .18, cellSize);
    for (const room of blueprint.rooms) {
      if (!findSpatialPath(blueprint.rooms[0].entry, room.entry, b, cellSize, shape)) throw Error("Room is unreachable at the selected navigation resolution");
      const anchors = [...blueprint.props.filter(p => p.roomId === room.id).flatMap(p => p.interactionAnchors.map(a => ({ x: p.position.x + a.x, y: p.position.y + a.y }))),
        ...blueprint.spawns.filter(s => s.roomId === room.id).map(s => s.position)];
      if (anchors.some(a => !findSpatialPath(room.entry, a, b, cellSize, shape))) throw Error("Interaction is unreachable at the selected navigation resolution");
    }
  }
  return value;
}

/** Keep visual/interaction metadata out of the cognitive character config. */
export function spatialAgentConfig(r: SpatialResident): AgentConfig {
  return { name: r.name, role: r.role, description: r.description, systemPrompt: r.systemPrompt, startRoom: r.startRoom, past: r.past };
}
