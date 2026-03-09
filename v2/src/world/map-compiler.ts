import type { World } from "../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity } from "../ecs/prefabs";
import { ObjectType } from "../ecs/components";
import { worldSchema } from "./schema";
import { ObjectManager } from "./object-manager";
import { createDynamicComponent, getDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";

export interface MapCompilerResult {
  defaultRoomId: number;
  roomByZoneId: Map<string, number>;
  spawnedAgentEids: number[];
  spawnedObjectEids: number[];
  definedObjectTypes: string[];
}

type RectShape = { kind: "rect"; x: number; y: number; w: number; h: number };
type PolyShapeXY = { kind: "poly"; points: Array<{ x: number; y: number }> };
type PolyShapeFlat = { kind: "polygon"; points: number[] };
type ZoneShape = RectShape | PolyShapeXY | PolyShapeFlat;

export interface MapZone {
  id: string;
  name: string;
  roomType?: string;
  shape: ZoneShape;
  properties?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface MapMarker {
  id: string;
  x: number;
  y: number;
  kind: "spawn" | "portal" | "event" | "label";
  name?: string;
  text?: string;
  spawnType?: "agent" | "object";
  typeId?: string;
  traits?: string[];
  agentDef?: string;
  to?: { x: number; y: number };
  bidirectional?: boolean;
  meta?: Record<string, any>;
}

export interface ArgosMapData {
  id: string;
  name: string;
  grid: { width: number; height: number; tileSize: number };
  zones?: MapZone[];
  markers?: MapMarker[];
}

function ensureRoomZoneComponent(): void {
  if (getDynamicComponent("RoomZone")) return;
  createDynamicComponent({
    name: "RoomZone",
    description: "Zone bounds for rooms compiled from UI maps",
    properties: {
      zoneId: "string",
      kind: "string", // world|rect|poly
      x: "number",
      y: "number",
      w: "number",
      h: "number",
      pointsJson: "string", // JSON array of {x,y} points for poly zones
    },
  });
}

function toSnakeCaseId(value: string): string {
  const s = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return s || "object";
}

function parseTraitHints(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function guessCategoryAndTraits(typeId: string): { category: string; traits: string[]; isContainer?: boolean; capacity?: number } {
  const t = typeId.toLowerCase();
  const traits = new Set<string>(["examinable"]);

  const containerHints = ["chest", "box", "bag", "sack", "basket", "barrel", "jar", "bottle", "crate", "cabinet", "drawer"];
  const furnitureHints = ["table", "chair", "bed", "counter", "shelf", "rack", "stool", "bench"];
  const workstationHints = ["workstation", "computer", "forge", "oven", "anvil", "hearth", "kiln", "terminal"];
  const toolHints = ["hammer", "tongs", "bellows", "knife", "saw", "spoon", "ladle", "needle"];
  const structureHints = ["house", "hut", "building", "shed"];

  if (containerHints.some((h) => t.includes(h))) {
    traits.add("container");
    traits.add("openable");
    return { category: "container", traits: Array.from(traits), isContainer: true, capacity: 20 };
  }

  if (workstationHints.some((h) => t.includes(h))) {
    traits.add("workstation");
    traits.add("interactable");
    return { category: "workstation", traits: Array.from(traits) };
  }

  if (structureHints.some((h) => t.includes(h))) {
    traits.add("structure");
    traits.add("building");
    return { category: "structure", traits: Array.from(traits) };
  }

  if (furnitureHints.some((h) => t.includes(h))) {
    traits.add("furniture");
    return { category: "furniture", traits: Array.from(traits) };
  }

  if (toolHints.some((h) => t.includes(h))) {
    traits.add("takeable");
    traits.add("tool");
    traits.add("usable");
    return { category: "tool", traits: Array.from(traits) };
  }

  traits.add("takeable");
  return { category: "object", traits: Array.from(traits) };
}

function toPolyPoints(shape: PolyShapeXY | PolyShapeFlat): Array<{ x: number; y: number }> {
  if (shape.kind === "poly") return shape.points;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < shape.points.length; i += 2) {
    pts.push({ x: shape.points[i] ?? 0, y: shape.points[i + 1] ?? 0 });
  }
  return pts;
}

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

function pointInZone(x: number, y: number, zone: MapZone): boolean {
  const shape = zone.shape;
  if (shape.kind === "rect") {
    return x >= shape.x && y >= shape.y && x < shape.x + shape.w && y < shape.y + shape.h;
  }
  const pts = toPolyPoints(shape);
  if (pts.length < 3) return false;
  return pointInPoly(x, y, pts);
}

function zoneCenter(zone: MapZone): { x: number; y: number } {
  const shape = zone.shape;
  if (shape.kind === "rect") {
    return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
  }
  const pts = toPolyPoints(shape);
  if (pts.length === 0) return { x: 0, y: 0 };
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

function roomForPoint(x: number, y: number, zones: MapZone[], roomByZoneId: Map<string, number>, defaultRoomId: number): number {
  for (const zone of zones) {
    if (pointInZone(x, y, zone)) {
      const id = roomByZoneId.get(zone.id);
      if (id !== undefined) return id;
    }
  }
  return defaultRoomId;
}

function defineObjectTypeFromSeed(seed: { typeId: string; description?: string; traitHints?: string[] }): { defined: boolean; typeId: string } {
  const typeId = toSnakeCaseId(seed.typeId);
  if (worldSchema.getObjectType(typeId)) return { defined: false, typeId };

  const { category, traits } = guessCategoryAndTraits(typeId);
  const extraTraits = (seed.traitHints ?? []).map(toSnakeCaseId);
  const unique = Array.from(new Set([...traits, ...extraTraits]));
  const description = seed.description?.trim() || `A ${typeId.replace(/_/g, " ")}`;

  worldSchema.defineObjectType({
    name: typeId,
    description,
    traits: unique,
    states: {
      normal: {
        description,
        stimuli: [{ type: "visual", template: description, intensity: 0.4 }],
      },
    },
    defaultState: "normal",
    category,
  });

  return { defined: true, typeId };
}

export function compileMapIntoWorld(world: World, map: ArgosMapData): MapCompilerResult {
  ensureRoomZoneComponent();
  const objectManager = new ObjectManager(world as any);
  const zones = map.zones ?? [];
  const markers = map.markers ?? [];

  const mapCenter = { x: Math.floor(map.grid.width / 2), y: Math.floor(map.grid.height / 2) };
  const defaultRoomId = createRoomEntity(world as any, {
    name: "World",
    description: "The unzoned area of the map (fallback room).",
    ambience: "general",
    x: mapCenter.x * 20,
    y: mapCenter.y * 20,
  });

  setDynamicComponentValue("RoomZone", defaultRoomId, "zoneId", "world");
  setDynamicComponentValue("RoomZone", defaultRoomId, "kind", "world");
  setDynamicComponentValue("RoomZone", defaultRoomId, "x", 0);
  setDynamicComponentValue("RoomZone", defaultRoomId, "y", 0);
  setDynamicComponentValue("RoomZone", defaultRoomId, "w", map.grid.width);
  setDynamicComponentValue("RoomZone", defaultRoomId, "h", map.grid.height);
  setDynamicComponentValue("RoomZone", defaultRoomId, "pointsJson", "");

  const roomByZoneId = new Map<string, number>();
  for (const zone of zones) {
    const description = zone.properties?.description ?? zone.meta?.description ?? "A room in the simulation.";
    const ambience = zone.roomType || "general";
    const center = zoneCenter(zone);
    const roomEid = createRoomEntity(world as any, {
      name: zone.name,
      description,
      ambience,
      x: Math.round(center.x * 20),
      y: Math.round(center.y * 20),
    });
    setDynamicComponentValue("RoomZone", roomEid, "zoneId", zone.id);
    const shape = zone.shape as any;
    if (shape.kind === "rect") {
      setDynamicComponentValue("RoomZone", roomEid, "kind", "rect");
      setDynamicComponentValue("RoomZone", roomEid, "x", shape.x ?? 0);
      setDynamicComponentValue("RoomZone", roomEid, "y", shape.y ?? 0);
      setDynamicComponentValue("RoomZone", roomEid, "w", shape.w ?? 0);
      setDynamicComponentValue("RoomZone", roomEid, "h", shape.h ?? 0);
      setDynamicComponentValue("RoomZone", roomEid, "pointsJson", "");
    } else {
      setDynamicComponentValue("RoomZone", roomEid, "kind", "poly");
      setDynamicComponentValue("RoomZone", roomEid, "x", 0);
      setDynamicComponentValue("RoomZone", roomEid, "y", 0);
      setDynamicComponentValue("RoomZone", roomEid, "w", 0);
      setDynamicComponentValue("RoomZone", roomEid, "h", 0);
      setDynamicComponentValue("RoomZone", roomEid, "pointsJson", JSON.stringify(toPolyPoints(shape)));
    }

    roomByZoneId.set(zone.id, roomEid);
  }

  const definedObjectTypes: string[] = [];
  const spawnedAgentEids: number[] = [];
  const spawnedObjectEids: number[] = [];

  // First pass: ensure any object prefab seeds become schema types
  for (const marker of markers) {
    if (marker.kind !== "spawn" || marker.spawnType !== "object") continue;
    const requestedType = marker.typeId || "";
    if (!requestedType.trim()) continue;
    if (worldSchema.getObjectType(toSnakeCaseId(requestedType))) continue;

    const seedDescription = String(marker.meta?.description ?? "");
    const traitHints = [
      ...parseTraitHints((marker.meta as any)?.traitHints),
      ...(marker.traits ?? []),
    ];
    const { defined, typeId } = defineObjectTypeFromSeed({
      typeId: requestedType,
      description: seedDescription || undefined,
      traitHints,
    });
    if (defined) definedObjectTypes.push(typeId);
  }

  // Spawn agents
  for (const marker of markers) {
    if (marker.kind !== "spawn" || marker.spawnType !== "agent") continue;
    const rid = roomForPoint(marker.x, marker.y, zones, roomByZoneId, defaultRoomId);
    const name = marker.name || `Agent_${marker.id}`;
    const eid = createAgentEntity(world as any, {
      name,
      role: "npc",
      systemPrompt: "You are an NPC in a simulation. Take grounded actions and interact with the world.",
      roomId: rid,
      gridPosition: { x: marker.x, y: marker.y },
    });
    spawnedAgentEids.push(eid);
  }

  // Spawn objects
  for (const marker of markers) {
    if (marker.kind !== "spawn" || marker.spawnType !== "object") continue;
    const rid = roomForPoint(marker.x, marker.y, zones, roomByZoneId, defaultRoomId);
    const requestedType = marker.typeId || "object";
    const typeId = toSnakeCaseId(requestedType);
    const name = marker.name || typeId;

    const spawned = objectManager.spawn(typeId, {
      name,
      position: { x: marker.x, y: marker.y },
      containedIn: rid,
      properties: (marker.meta as any)?.properties,
      description: String(marker.meta?.description ?? "") || undefined,
    });

    if (spawned !== null) {
      spawnedObjectEids.push(spawned);
      continue;
    }

    // Fallback: grounded generic object with the requested typeId preserved.
    const fallback = createObjectEntity(world as any, {
      name,
      description: String(marker.meta?.description ?? ""),
      roomId: rid,
      traits: marker.traits,
      gridPosition: { x: marker.x, y: marker.y },
    });
    ObjectType.typeId[fallback] = typeId;
    ObjectType.instanceName[fallback] = name;
    spawnedObjectEids.push(fallback);
  }

  return {
    defaultRoomId,
    roomByZoneId,
    spawnedAgentEids,
    spawnedObjectEids,
    definedObjectTypes,
  };
}

