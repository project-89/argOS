/** Authored spatial demo data. Meshes describe appearance; only registered ECS
 * object types and their native affordances confer behavior. Ground coordinates
 * are global ECS x/y metres (the renderer projects y to z). */
import { z } from "zod/v3";
import { BASE_AFFORDANCES, worldSchema } from "../world/schema";
import type { MaterializedEntitySpec } from "../engineering/entity-materialization";

export type SpatialPoint = { x: number; y: number };
export type SpatialBounds = { minX: number; minY: number; maxX: number; maxY: number };
export interface SpatialAsset {
  id: string; size: { x: number; y: number; z: number }; color: string;
  objectType?: string; initialState?: string; affordances: readonly string[];
  collider?: { halfWidth: number; halfDepth: number };
}
// Built-in kinds. The data-driven registry (spatial-asset-registry.ts) extends
// this same table at runtime, so every existing reader sees registered kinds.
const assetTable: Record<string, SpatialAsset> = {
  sofa: { id: "sofa", size: { x: 2.5, y: 1, z: 1 }, color: "#657e6d", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1.25, halfDepth: .5 } },
  table: { id: "table", size: { x: 1.5, y: .75, z: 1 }, color: "#aa7955", objectType: "table", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .75, halfDepth: .5 } },
  chair: { id: "chair", size: { x: .6, y: .95, z: .65 }, color: "#b28d66", objectType: "chair", initialState: "empty", affordances: ["sit"], collider: { halfWidth: .3, halfDepth: .325 } },
  // The host binds its existing private phone service. This catalog deliberately
  // does not promise read/reply capability merely because a phone is visible.
  phone: { id: "phone", size: { x: .16, y: .025, z: .28 }, color: "#17262a", objectType: "smartphone", initialState: "powered_on", affordances: ["take", "examine"] },
  food: { id: "food", size: { x: .35, y: .12, z: .3 }, color: "#e1ae65", objectType: "food_item", initialState: "fresh", affordances: ["eat", "take"] },
  door: { id: "door", size: { x: 1.5, y: 2.25, z: .12 }, color: "#698071", objectType: "door", initialState: "open", affordances: ["open", "close"] },
  // Fixed architectural opening: it links floors but has no door mechanism.
  // In particular, a mesh must not advertise an unimplemented shared-room latch.
  passage: { id: "passage", size: { x: 1.5, y: 2.25, z: .12 }, color: "#698071", objectType: "object", initialState: "normal", affordances: ["examine"] },
  plant: { id: "plant", size: { x: .55, y: 1.1, z: .55 }, color: "#75945e", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .275, halfDepth: .275 } },
  // A solid trunk and an ornamental canopy, not an installed wood/fruit source.
  tree: { id: "tree", size: { x: 1.6, y: 3.5, z: 1.6 }, color: "#789663", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .3, halfDepth: .3 } },
  lamp: { id: "lamp", size: { x: .4, y: 1.65, z: .4 }, color: "#e3c88b", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .2, halfDepth: .2 } },
  "power-panel": { id: "power-panel", size: { x: .65, y: 1.1, z: .4 }, color: "#596b72", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .325, halfDepth: .2 } },
  "supply-box": { id: "supply-box", size: { x: .9, y: .45, z: .65 }, color: "#ae8052", objectType: "chest", initialState: "closed", affordances: ["open", "close", "examine"], collider: { halfWidth: .45, halfDepth: .325 } },
  "repair-part": { id: "repair-part", size: { x: .18, y: .12, z: .3 }, color: "#e2ba63", objectType: "object", initialState: "normal", affordances: ["examine"] },
  // Small generic story objects. They render as simple boxes; carrying,
  // reading, giving, showing and hiding are installed by the spatial executor
  // from the prop's authored item data, not by these visual entries.
  book: { id: "book", size: { x: .24, y: .06, z: .32 }, color: "#4d3b2a", objectType: "object", initialState: "normal", affordances: ["examine"] },
  paper: { id: "paper", size: { x: .21, y: .012, z: .28 }, color: "#e6dcc2", objectType: "object", initialState: "normal", affordances: ["examine"] },
  trinket: { id: "trinket", size: { x: .14, y: .05, z: .08 }, color: "#8a8d84", objectType: "object", initialState: "normal", affordances: ["examine"] },
  // A door knocker on a cottage's front post: the audible way to call on a house.
  knocker: { id: "knocker", size: { x: .16, y: .2, z: .06 }, color: "#4f544e", objectType: "object", initialState: "normal", affordances: ["examine"] },
  // Settlement (Saltmere as a town that feeds and builds itself). Sources and
  // stations render as simple shapes until models exist; their crafts are
  // installed by the settlement's recipe module, not by these entries.
  tent: { id: "tent", size: { x: 2.4, y: 1.6, z: 2.4 }, color: "#b9a67e", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1.2, halfDepth: 1.2 } },
  "market-stall": { id: "market-stall", size: { x: 3, y: 2.2, z: 1.4 }, color: "#a86b4a", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1.5, halfDepth: .7 } },
  campfire: { id: "campfire", size: { x: 1.2, y: .5, z: 1.2 }, color: "#c9652f", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .6, halfDepth: .6 } },
  stump: { id: "stump", size: { x: .8, y: .5, z: .8 }, color: "#7b5a3c", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .4, halfDepth: .4 } },
  "stone-pile": { id: "stone-pile", size: { x: 2.2, y: .9, z: 2 }, color: "#8d8f8a", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1.1, halfDepth: 1 } },
  bramble: { id: "bramble", size: { x: 1.6, y: 1.1, z: 1.6 }, color: "#5d7d45", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .8, halfDepth: .8 } },
  "flax-patch": { id: "flax-patch", size: { x: 6, y: .8, z: 4 }, color: "#8fa6d6", objectType: "object", initialState: "normal", affordances: ["examine"] },
  "fishing-water": { id: "fishing-water", size: { x: 6, y: .1, z: 2 }, color: "#3f6f86", objectType: "object", initialState: "normal", affordances: ["examine"] },
  spring: { id: "spring", size: { x: 1.8, y: .7, z: 1.8 }, color: "#7aa9b8", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: .9, halfDepth: .9 } },
  workbench: { id: "workbench", size: { x: 2, y: .9, z: 1 }, color: "#9b7650", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1, halfDepth: .5 } },
  "drying-rack": { id: "drying-rack", size: { x: 2.5, y: 1.8, z: .5 }, color: "#8a7a5c", objectType: "object", initialState: "normal", affordances: ["examine"], collider: { halfWidth: 1.25, halfDepth: .25 } },
  plot: { id: "plot", size: { x: 6, y: .05, z: 6 }, color: "#a0896a", objectType: "object", initialState: "normal", affordances: ["examine"] },
  cabin: { id: "cabin", size: { x: 5, y: 3.2, z: 5 }, color: "#b08a64", objectType: "object", initialState: "normal", affordances: ["examine"] },
  ...Object.fromEntries(([["axe", "#8b8f93", .8], ["net", "#c9b98f", .5], ["torn-net", "#9c8f73", .5], ["log", "#8a6440", .9], ["firewood", "#a47a4d", .4],
    ["planks", "#caa77a", 1], ["stone", "#8e908b", .25], ["raw-fish", "#9fb3b8", .35], ["cooked-fish", "#c89a5d", .35], ["berries", "#7b2f4f", .15],
    ["flax", "#b9c78f", .5], ["twine", "#d8c9a0", .15], ["water", "#8ec0d1", .25]] as const)
    .map(([id, color, length]) => [id, { id, size: { x: length, y: .12, z: .15 }, color, objectType: "object", initialState: "normal", affordances: ["examine"] }])),
  "actor-mara": { id: "actor-mara", size: { x: .5, y: 1.7, z: .5 }, color: "#d3a74d", affordances: [] },
  "actor-ivo": { id: "actor-ivo", size: { x: .5, y: 1.8, z: .5 }, color: "#6c9daf", affordances: [] },
  "actor-a": { id: "actor-a", size: { x: .5, y: 1.7, z: .5 }, color: "#7fa990", affordances: [] },
  "actor-b": { id: "actor-b", size: { x: .5, y: 1.8, z: .5 }, color: "#cc876f", affordances: [] },
  "actor-f": { id: "actor-f", size: { x: .5, y: 1.75, z: .5 }, color: "#8d93bb", affordances: [] },
};
export const SPATIAL_ASSETS: Readonly<Record<string, SpatialAsset>> = assetTable;
/** Registry-only extension point. Callers must validate first; ids are never replaced. */
export function installSpatialAsset(asset: SpatialAsset): void {
  if (Object.hasOwn(assetTable, asset.id)) throw new Error(`Spatial asset ${asset.id} is already registered`);
  assetTable[asset.id] = Object.freeze({ ...asset, affordances: Object.freeze([...asset.affordances]) });
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const number = z.number().finite().min(-256).max(256);
const point = z.object({ x: number, y: number }).strict();
const bounds = z.object({ minX: number, minY: number, maxX: number, maxY: number }).strict();
const roomSchema = z.object({ id, name: z.string().min(1).max(120), description: z.string().max(2000), bounds, entry: point, floor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  environment: z.enum(["indoor", "outdoor"]).optional(),
  // Presentation over the same native footprint; never a second building or
  // a new interaction. Its front must coincide with an installed entrance.
  building: z.object({ style: z.enum(["cottage", "cafe", "workshop"]),
    wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), roofColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    front: z.enum(["north", "south"]) }).strict().optional() }).strict();
const propSchema = z.object({ id, roomId: id, assetId: id, name: z.string().min(1).max(120), description: z.string().max(2000), position: point,
  elevation: z.number().finite().min(0).max(3).default(0), rotationY: z.number().finite().default(0),
  interactionAnchors: z.array(point).min(1).max(8), reach: z.number().finite().positive().max(3).default(1.1),
  supportedBy: id.optional(), state: z.string().min(1).max(40).optional(),
  // Story-object data. Document text is private to whoever reads it; the
  // excerpt is the page someone sees when it is shown to them.
  item: z.object({
    portable: z.boolean().optional(),
    text: z.string().trim().min(1).max(2000).optional(),
    excerpt: z.string().trim().min(1).max(400).optional(),
    /** Starts inside this chest-type prop in the same room (hidden while closed). */
    containedBy: id.optional(),
    /** Starts in this resident spawn's possession (pocketed, not in hand). */
    carriedBy: id.optional(),
    /** A knocker announces knocks to the people inside this room. */
    knockFor: id.optional(),
  }).strict().optional() }).strict();
const wallSchema = z.object({ id, roomId: id, position: point, halfWidth: z.number().finite().positive().max(16), halfDepth: z.number().finite().positive().max(16), height: z.number().finite().positive().max(4) }).strict();
// Bounded authored neighborhoods, not permission for unbounded model output.
// Native construction authority and lifetime entity budgets remain separate.
const blueprintSchema = z.object({ id, author: z.literal("operator"), rooms: z.array(roomSchema).min(1).max(40),
  props: z.array(propSchema).max(600), walls: z.array(wallSchema).max(300),
  doors: z.array(z.object({ id, from: id, to: id, propId: id, position: point, axis: z.enum(["x", "y"]), width: z.number().finite().min(1.2).max(8) }).strict()).max(80),
  spawns: z.array(z.object({ id, roomId: id, name: z.string().min(1).max(80), assetId: id, position: point }).strict()).max(40) }).strict();
export type SpatialBlueprint = z.infer<typeof blueprintSchema>;
export type SpatialRoom = SpatialBlueprint["rooms"][number];
export type SpatialProp = SpatialBlueprint["props"][number];
export const SPATIAL_WORLD_BOUNDS: SpatialBounds = { minX: 0, minY: 0, maxX: 16, maxY: 11 };

const prop = (id: string, roomId: string, assetId: string, name: string, x: number, y: number, anchors: SpatialPoint[], extras: Partial<SpatialProp> = {}): SpatialProp =>
  ({ id, roomId, assetId, name, description: name, position: { x, y }, elevation: 0, rotationY: 0, interactionAnchors: anchors, reach: 1.1, ...extras });
const wall = (id: string, roomId: string, x: number, y: number, halfWidth: number, halfDepth: number): SpatialBlueprint["walls"][number] =>
  ({ id, roomId, position: { x, y }, halfWidth, halfDepth, height: 2.5 });

export const INITIAL_SPATIAL_BLUEPRINT: SpatialBlueprint = {
  id: "apartment-street-v1", author: "operator",
  rooms: [
    { id: "apartment", name: "Apartment", description: "A sunny furnished apartment. Mara's phone and a snack rest on the table. An open doorway leads to the street.", bounds: { minX: 0, minY: 0, maxX: 8, maxY: 7 }, entry: { x: 4, y: 6 }, floor: "#ba9e7e" },
    { id: "street", name: "Street", description: "A quiet pedestrian street outside the apartment. The neighboring cafe site is not yet built.", bounds: { minX: 0, minY: 7, maxX: 8, maxY: 11 }, entry: { x: 4, y: 9 }, floor: "#7d8886" },
  ],
  props: [
    prop("apartment-sofa", "apartment", "sofa", "Green sofa", 2, 1.1, [{ x: 0, y: 1 }]),
    prop("apartment-table", "apartment", "table", "Apartment table", 4, 3, [{ x: 0, y: 1 }]),
    prop("apartment-chair", "apartment", "chair", "Apartment chair", 6, 3, [{ x: 0, y: 1 }]),
    prop("maras-phone", "apartment", "phone", "Mara's phone", 3.65, 3, [{ x: 0, y: 1 }], { elevation: .77, supportedBy: "apartment-table" }),
    prop("apartment-snack", "apartment", "food", "Apple pastry", 4.4, 3, [{ x: 0, y: 1 }], { elevation: .77, supportedBy: "apartment-table" }),
    prop("apartment-plant", "apartment", "plant", "Window plant", 7.2, 1, [{ x: -.8, y: 0 }]),
    prop("apartment-lamp", "apartment", "lamp", "Reading lamp", .7, 3, [{ x: .8, y: 0 }]),
    prop("apartment-door", "apartment", "door", "Open apartment door", 4, 7, [{ x: 0, y: -.8 }]),
  ],
  walls: [wall("apartment-north", "apartment", 4, 0, 4, .08), wall("apartment-west", "apartment", 0, 3.5, .08, 3.5), wall("apartment-east", "apartment", 8, 3.5, .08, 3.5),
    wall("apartment-south-left", "apartment", 1.5, 7, 1.5, .08), wall("apartment-south-right", "apartment", 6.5, 7, 1.5, .08)],
  doors: [{ id: "apartment-street", from: "apartment", to: "street", propId: "apartment-door", position: { x: 4, y: 7 }, axis: "y", width: 2 }],
  spawns: [{ id: "mara", name: "Mara", roomId: "apartment", assetId: "actor-mara", position: { x: 3, y: 5 } },
    { id: "ivo", name: "Ivo", roomId: "apartment", assetId: "actor-ivo", position: { x: 6, y: 5 } }],
};

export const CAFE_SPATIAL_BLUEPRINT: SpatialBlueprint = {
  id: "adjacent-cafe-v1", author: "operator",
  rooms: [{ id: "cafe", name: "Corner Cafe", description: "A newly built cafe beside the pedestrian street, with a table, a seat and a fresh sandwich available to eat.", bounds: { minX: 8, minY: 7, maxX: 16, maxY: 11 }, entry: { x: 9, y: 9 }, floor: "#d4b595" }],
  props: [prop("cafe-table", "cafe", "table", "Cafe table", 12, 8.5, [{ x: 0, y: 1 }]),
    prop("cafe-chair", "cafe", "chair", "Cafe chair", 14, 8.5, [{ x: 0, y: 1 }]),
    prop("cafe-sandwich", "cafe", "food", "Fresh cafe sandwich", 12, 8.5, [{ x: 0, y: 1 }], { elevation: .77, supportedBy: "cafe-table" }),
    prop("cafe-door", "cafe", "door", "Open cafe door", 8, 9, [{ x: .8, y: 0 }], { rotationY: Math.PI / 2 })],
  walls: [wall("cafe-north", "cafe", 12, 7, 4, .08), wall("cafe-south", "cafe", 12, 11, 4, .08), wall("cafe-east", "cafe", 16, 9, .08, 2),
    wall("cafe-west-top", "cafe", 8, 7.5, .08, .5), wall("cafe-west-bottom", "cafe", 8, 10.5, .08, .5)],
  doors: [{ id: "street-cafe", from: "street", to: "cafe", propId: "cafe-door", position: { x: 8, y: 9 }, axis: "x", width: 2 }], spawns: [],
};

/** Same small world, with a physical problem. No solution is encoded in the
 * room description: the panel diagnosis has to be personally inspected. */
export function blackoutSpatialBlueprint(): SpatialBlueprint {
  const blueprint = structuredClone(INITIAL_SPATIAL_BLUEPRINT);
  blueprint.id = "blackout-apartment-v1";
  blueprint.rooms[0].description = "An apartment during a lighting failure. The reading lamp is dark. There is a lighting panel, a closed supplies box, furniture and an open doorway to the street.";
  blueprint.props.push(
    prop("lighting-panel", "apartment", "power-panel", "Lighting panel", 1, 5.3, [{ x: .8, y: 0 }],
      { description: "A serviceable low-voltage lighting panel with a diagnostic label, an isolation switch and a cartridge slot. Inspect it to find the current fault." }),
    prop("supply-box", "apartment", "supply-box", "Supplies box", 6.8, 5.6, [{ x: 0, y: -.9 }],
      { description: "A closed box of household repair supplies." }),
    prop("amber-cartridge", "apartment", "repair-part", "Amber cartridge", 6.65, 5.6, [{ x: 0, y: -.9 }],
      { elevation: .45, description: "A removable lighting cartridge. Its physical label reads specification A." }),
    prop("blue-cartridge", "apartment", "repair-part", "Blue cartridge", 6.95, 5.6, [{ x: 0, y: -.9 }],
      { elevation: .45, description: "A removable lighting cartridge. Its physical label reads specification B." }),
  );
  return blueprint;
}

/** A harder authored repair layout, not autonomous world growth. The same
 * puzzle identities now span three physically separated rooms. Fixed open
 * passages avoid pretending that the current single-room object ownership
 * supports a door latch operated from both sides. The supplies box remains a
 * native closed container; its contents must actually be revealed.
 */
export function extendedBlackoutSpatialBlueprint(): SpatialBlueprint {
  const blueprint = blackoutSpatialBlueprint();
  blueprint.id = "blackout-three-room-v1";
  blueprint.rooms = [
    { ...blueprint.rooms[0], description: "An apartment during a lighting failure. The reading lamp is dark. A permanent open passage on the east wall leads to the utility room." },
    { id: "utility", name: "Utility room", description: "A separate household utility room with a lighting panel. Open passages lead west to the apartment and south to the storeroom. The panel's current fault has not been diagnosed.",
      bounds: { minX: 8, minY: 0, maxX: 16, maxY: 7 }, entry: { x: 9.5, y: 5 }, floor: "#8b9891" },
    { id: "storeroom", name: "Storeroom", description: "A separate storeroom with a closed household supplies box. A permanent open passage leads north to the utility room.",
      bounds: { minX: 8, minY: 7, maxX: 16, maxY: 11 }, entry: { x: 14, y: 8.25 }, floor: "#b49b7a" },
  ];
  const byId = new Map(blueprint.props.map(p => [p.id, p]));
  Object.assign(byId.get("apartment-door")!, prop("apartment-door", "apartment", "passage", "Utility passage", 8, 5,
    [{ x: -.8, y: 0 }], { rotationY: Math.PI / 2, description: "A permanent open passage between the apartment and the utility room." }));
  Object.assign(byId.get("lighting-panel")!, { roomId: "utility", position: { x: 9.1, y: 1.5 } });
  Object.assign(byId.get("supply-box")!, { roomId: "storeroom", position: { x: 14.4, y: 9.5 } });
  Object.assign(byId.get("amber-cartridge")!, { roomId: "storeroom", position: { x: 14.25, y: 9.5 } });
  Object.assign(byId.get("blue-cartridge")!, { roomId: "storeroom", position: { x: 14.55, y: 9.5 } });
  blueprint.props.push(prop("storeroom-passage", "utility", "passage", "Storeroom passage", 14, 7,
    [{ x: 0, y: -.8 }], { description: "A permanent open passage between the utility room and the storeroom." }));
  blueprint.walls = [
    wall("apartment-north", "apartment", 4, 0, 4, .08),
    wall("apartment-west", "apartment", 0, 3.5, .08, 3.5),
    wall("apartment-south", "apartment", 4, 7, 4, .08),
    wall("apartment-east-north", "apartment", 8, 2, .08, 2),
    wall("apartment-east-south", "apartment", 8, 6.5, .08, .5),
    wall("utility-north", "utility", 12, 0, 4, .08),
    wall("utility-east", "utility", 16, 3.5, .08, 3.5),
    wall("utility-south-west", "utility", 10.5, 7, 2.5, .08),
    wall("utility-south-east", "utility", 15.5, 7, .5, .08),
    wall("storeroom-west", "storeroom", 8, 9, .08, 2),
    wall("storeroom-south", "storeroom", 12, 11, 4, .08),
    wall("storeroom-east", "storeroom", 16, 9, .08, 2),
  ];
  blueprint.doors = [
    { id: "apartment-utility", from: "apartment", to: "utility", propId: "apartment-door", position: { x: 8, y: 5 }, axis: "x", width: 2 },
    { id: "utility-storeroom", from: "utility", to: "storeroom", propId: "storeroom-passage", position: { x: 14, y: 7 }, axis: "y", width: 2 },
  ];
  return blueprint;
}

const inside = (p: SpatialPoint, b: SpatialBounds) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const overlaps = (a: SpatialBounds, b: SpatialBounds) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
const near = (a: number, b: number) => Math.abs(a - b) < .001;

/** Entire structural preflight, with no allocations, registrations, or ECS writes.
 * Returned data is a parsed copy, never the caller's mutable blueprint. */
export function validateSpatialBlueprint(input: unknown, existingRooms: readonly SpatialRoom[] = []): SpatialBlueprint {
  const value = blueprintSchema.parse(input), rooms = [...existingRooms.map(r => roomSchema.parse(r)), ...value.rooms];
  const identities = [...rooms.map(r => r.id), ...value.props.map(p => p.id), ...value.walls.map(w => w.id), ...value.spawns.map(s => s.id), ...value.doors.map(d => d.id)];
  if (new Set(identities).size !== identities.length) throw new Error("Spatial IDs must be unique");
  const roomMap = new Map(rooms.map(r => [r.id, r]));
  for (const r of rooms) {
    const b = r.bounds;
    if (b.maxX <= b.minX || b.maxY <= b.minY || b.maxX - b.minX > 160 || b.maxY - b.minY > 160 || !inside(r.entry, b)) throw new Error("Invalid room geometry or entry");
    if (r.building && r.environment !== "indoor") throw Error("Building exteriors require an indoor native footprint");
  }
  for (const r of value.rooms) for (const other of rooms) if (r.id !== other.id && overlaps(r.bounds, other.bounds)) throw new Error("Room interiors overlap");
  const colliders: Array<{ position: SpatialPoint; halfWidth: number; halfDepth: number }> = [...value.walls];
  for (const w of value.walls) if (!roomMap.has(w.roomId) || !inside(w.position, roomMap.get(w.roomId)!.bounds)) throw new Error("Wall must belong to its room");
  for (const p of value.props) {
    const asset = SPATIAL_ASSETS[p.assetId], room = roomMap.get(p.roomId);
    if (!asset?.objectType || !room || !value.rooms.some(r => r.id === room.id) || !inside(p.position, room.bounds)) throw new Error("Invalid prop catalog reference or placement");
    const schema = worldSchema.getObjectType(asset.objectType), state = schema?.states[p.state ?? asset.initialState!];
    if (!schema || !state) throw new Error("Missing native object type or state");
    const traits = new Set([...schema.traits, ...(state.traits ?? [])].filter(t => !(state.blockedTraits ?? []).includes(t)));
    for (const affordance of asset.affordances) if (!BASE_AFFORDANCES[affordance]?.requires.every(t => traits.has(t))) throw new Error("Catalog affordance is not supplied by native traits");
    if (asset.collider) {
      // Colliders remain axis aligned; authored rotations cannot silently rotate
      // visual furniture through a different physical footprint.
      if (!near(p.rotationY % Math.PI, 0)) throw new Error("Collidable props require axis-aligned orientation");
      const c = { position: p.position, ...asset.collider };
      if (!inside({ x: p.position.x - c.halfWidth, y: p.position.y - c.halfDepth }, room.bounds) || !inside({ x: p.position.x + c.halfWidth, y: p.position.y + c.halfDepth }, room.bounds)) throw new Error("Prop collider leaves room");
      colliders.push(c);
    }
    if (p.item) {
      const item = p.item;
      if (item.excerpt && !item.text) throw new Error("A document excerpt requires document text");
      if (item.containedBy) {
        const holder = value.props.find(s => s.id === item.containedBy);
        if (!holder || holder.roomId !== p.roomId || SPATIAL_ASSETS[holder.assetId]?.objectType !== "chest" || p.supportedBy || item.carriedBy)
          throw new Error("Contained story objects need a chest in the same room");
      }
      if (item.carriedBy) {
        const spawn = value.spawns.find(s => s.id === item.carriedBy);
        if (!spawn || spawn.roomId !== p.roomId || p.supportedBy || asset.collider) throw new Error("Carried story objects need their holder's spawn room");
      }
      if (item.knockFor && (item.knockFor === p.roomId || !roomMap.has(item.knockFor))) throw new Error("A knocker must announce to another installed room");
    }
    if (p.supportedBy) {
      const support = value.props.find(s => s.id === p.supportedBy), surface = support && SPATIAL_ASSETS[support.assetId];
      if (!support || support.roomId !== p.roomId || surface?.objectType !== "table" || Math.abs(p.position.x - support.position.x) > surface.size.x / 2 || Math.abs(p.position.y - support.position.y) > surface.size.z / 2 || p.elevation < surface.size.y) throw new Error("Invalid native support surface");
    }
  }
  for (const d of value.doors) {
    const a = roomMap.get(d.from)?.bounds, b = roomMap.get(d.to)?.bounds, p = value.props.find(p => p.id === d.propId);
    if (!a || !b || d.from === d.to || !p || !["door", "passage"].includes(p.assetId) || !near(p.position.x, d.position.x) || !near(p.position.y, d.position.y)) throw new Error("Door references must resolve to rooms and a real door or fixed passage");
    const shared = d.axis === "x" ? (near(a.maxX, b.minX) || near(b.maxX, a.minX)) && near(d.position.x, Math.max(a.minX, b.minX)) && d.position.y - d.width / 2 >= Math.max(a.minY, b.minY) && d.position.y + d.width / 2 <= Math.min(a.maxY, b.maxY)
      : (near(a.maxY, b.minY) || near(b.maxY, a.minY)) && near(d.position.y, Math.max(a.minY, b.minY)) && d.position.x - d.width / 2 >= Math.max(a.minX, b.minX) && d.position.x + d.width / 2 <= Math.min(a.maxX, b.maxX);
    if (!shared) throw new Error("Door must fit a shared room boundary");
  }
  for (const r of value.rooms) if (r.building && !value.doors.some(d => (d.from === r.id || d.to === r.id)
    && d.axis === "y" && near(d.position.y, r.building!.front === "north" ? r.bounds.minY : r.bounds.maxY)))
    throw Error("Building front must have a real installed entrance");
  const connected = new Set(existingRooms.length ? existingRooms.map(r => r.id) : [value.rooms[0].id]);
  for (let i = 0; i < rooms.length; i++) for (const d of value.doors) if (connected.has(d.from) || connected.has(d.to)) { connected.add(d.from); connected.add(d.to); }
  if (value.rooms.some(r => !connected.has(r.id))) throw new Error("Expansion must connect to the existing floor plan");
  for (const s of value.spawns) if (!SPATIAL_ASSETS[s.assetId] || SPATIAL_ASSETS[s.assetId].objectType || !roomMap.has(s.roomId) || !inside(s.position, roomMap.get(s.roomId)!.bounds)) throw new Error("Invalid actor spawn");
  const clear = (p: SpatialPoint) => rooms.some(r => inside(p, r.bounds)) && !colliders.some(c => Math.abs(p.x - c.position.x) < c.halfWidth + .25 && Math.abs(p.y - c.position.y) < c.halfDepth + .25);
  const anchors = [...value.rooms.map(r => r.entry), ...value.spawns.map(s => s.position), ...value.props.flatMap(p => p.interactionAnchors.map(a => ({ x: p.position.x + a.x, y: p.position.y + a.y }))), ...value.doors.map(d => d.position)];
  if (anchors.some(p => !clear(p))) throw new Error("Spawn, entry, doorway or interaction anchor is blocked");
  // Bounded deterministic flood fill catches a decorative but unusable room.
  // Large outdoor worlds flood at .5 m (the walkable grid there is coarser still).
  const area = rooms.reduce((n, r) => n + (r.bounds.maxX - r.bounds.minX) * (r.bounds.maxY - r.bounds.minY), 0);
  const step = area > 4000 ? .5 : .25, snap = (p: SpatialPoint): SpatialPoint => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step });
  const key = (p: SpatialPoint) => `${p.x},${p.y}`;
  const queue = [snap(anchors[0])], reached = new Set([key(queue[0])]);
  if (!clear(queue[0])) throw new Error("Room entry has no walkable grid cell");
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 262144) throw new Error("Spatial navigation preflight budget exceeded");
    const p = queue[i];
    for (const d of [{ x: step, y: 0 }, { x: -step, y: 0 }, { x: 0, y: step }, { x: 0, y: -step }]) {
      const next = { x: p.x + d.x, y: p.y + d.y }, k = key(next);
      if (!reached.has(k) && clear(next)) { reached.add(k); queue.push(next); }
    }
  }
  if (anchors.some(p => !reached.has(key(snap(p))))) throw new Error("Interaction anchor or doorway is unreachable");
  return value;
}

/** A visual phone never gets read/reply behavior here: the native host must
 * explicitly install that service. These are ordinary object schema inputs. */
export function spatialEntityDefinition(prop: SpatialProp): MaterializedEntitySpec {
  const asset = SPATIAL_ASSETS[prop.assetId];
  if (!asset?.objectType) throw new Error("Unknown native prop asset");
  return { name: prop.name, description: prop.description, type: "object", components: [
    { name: "ObjectType", values: { typeId: asset.objectType } },
    { name: "ObjectState", values: { current: prop.state ?? asset.initialState } },
    { name: "Position", values: { x: prop.position.x, y: prop.position.y } },
  ] };
}
