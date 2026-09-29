/** Saltmere as a settlement you can walk in: the same land as the headless
 * settlement (learning/settlement/saltmere-land.ts) laid out at real scale —
 * about 140 × 110 m on 1 m walking cells. The Common holds the market stall,
 * the campfire, the chopping stump, spare tools, ten tents and bare plots; the
 * old Net House is the one building. Birch Wood lies west, the Shingle south,
 * the flax field east, the spring and the quarry north.
 *
 * The residents are Saltmere's own people (personas, pasts and secrets from
 * the coastal-mystery cast), each with a trade; their crafts are installed by
 * spatial-recipes.ts from the same recipe data. */
import { SPATIAL_ASSETS, type SpatialBlueprint, type SpatialProp, type SpatialRoom } from "./spatial-catalog";
import type { SpatialResident, SpatialScenarioDefinition } from "./spatial-scenario";
import { createLovecraftTownScenario } from "./spatial-lovecraft-town";
import { SALTMERE_LAND, type LandDef } from "../learning/settlement/saltmere-land";

export const SETTLEMENT_SCENARIO_ID = "saltmere-settlement";

/** Land place id -> 3D room. */
const ROOMS: Record<string, Omit<SpatialRoom, "name" | "description">> = {
  common: { id: "settle-common", bounds: { minX: 50, minY: 40, maxX: 100, maxY: 80 }, entry: { x: 75, y: 66 }, floor: "#8fa876", environment: "outdoor" },
  wood: { id: "settle-wood", bounds: { minX: 10, minY: 40, maxX: 50, maxY: 80 }, entry: { x: 46, y: 60 }, floor: "#5f7d4e", environment: "outdoor" },
  shore: { id: "settle-shore", bounds: { minX: 50, minY: 80, maxX: 100, maxY: 100 }, entry: { x: 75, y: 84 }, floor: "#b8ad92", environment: "outdoor" },
  field: { id: "settle-field", bounds: { minX: 100, minY: 40, maxX: 136, maxY: 80 }, entry: { x: 104, y: 60 }, floor: "#9aa36d", environment: "outdoor" },
  spring: { id: "settle-spring", bounds: { minX: 60, minY: 15, maxX: 90, maxY: 40 }, entry: { x: 75, y: 36 }, floor: "#86a07d", environment: "outdoor" },
  quarry: { id: "settle-quarry", bounds: { minX: 100, minY: 5, maxX: 136, maxY: 40 }, entry: { x: 118, y: 36 }, floor: "#9b9a90", environment: "outdoor" },
};
const NET_HOUSE: SpatialRoom = { id: "settle-net-house", name: "The Net House", description: "The old communal net house, the one building standing: a long rack for drying and mending nets.",
  bounds: { minX: 90, minY: 30, maxX: 100, maxY: 40 }, entry: { x: 95, y: 36 }, floor: "#8c9690", environment: "indoor",
  building: { style: "workshop", wallColor: "#a6b0a4", roofColor: "#485d5b", front: "south" } };

/** Where each kind of thing stands in its room (metres), in order of appearance. */
function placeThings(land: LandDef): Array<{ thing: LandDef["things"][number]; roomId: string; x: number; y: number; anchor: { x: number; y: number } }> {
  const counters = new Map<string, number>(), out: ReturnType<typeof placeThings> = [];
  const next = (key: string) => { const n = counters.get(key) ?? 0; counters.set(key, n + 1); return n; };
  for (const thing of land.things) {
    const room = thing.kind === "net-rack" && thing.place === "common" ? NET_HOUSE.id : ROOMS[thing.place]?.id;
    if (!room) continue;
    let x: number, y: number, anchor = { x: 0, y: -1.4 };
    const i = next(`${thing.place}:${thing.kind}`);
    switch (thing.kind) {
      case "stall": x = 75; y = 60; anchor = { x: 0, y: -1.3 }; break;
      case "hearth": x = 68; y = 54; break;
      case "stump": x = 62; y = 50; anchor = { x: 0, y: -1 }; break;
      case "axe": x = 80 + i * 1.2; y = 48; anchor = { x: 0, y: -.8 }; break;
      case "net": x = 83 + i * 1.2; y = 48; anchor = { x: 0, y: -.8 }; break;
      case "tent": x = 54 + i * 4.4; y = 76; anchor = { x: 0, y: -1.8 }; break;
      case "net-rack": x = 95; y = 33; anchor = { x: 0, y: 1 }; break;
      case "workshop-plot": x = 58; y = 63; anchor = { x: 0, y: 0 }; break;
      case "house-plot": x = 86 + (i % 2) * 8; y = 45 + Math.floor(i / 2) * 8; anchor = { x: 0, y: 0 }; break;
      case "fishing-water": x = 62 + i * 13; y = 97; anchor = { x: 0, y: -2 }; break;
      case "tree": x = 15 + (i % 5) * 7; y = 46 + Math.floor(i / 5) * 8; anchor = { x: 0, y: 1 }; break;
      case "bramble": x = 18 + i * 12; y = 76; anchor = { x: 0, y: -1.3 }; break;
      case "spring": x = 75; y = 26; anchor = { x: 0, y: 1.5 }; break;
      case "stone-pile": x = 118; y = 20; anchor = { x: 0, y: 1.6 }; break;
      case "flax-patch": x = 118; y = 60; anchor = { x: 0, y: -3 }; break;
      default: x = 75 + i; y = 70; break;
    }
    out.push({ thing, roomId: room, x, y, anchor });
  }
  return out;
}

const ASSET: Record<string, string> = { stall: "market-stall", hearth: "campfire", "workshop-plot": "plot", "house-plot": "plot", "net-rack": "drying-rack" };

export function createSettlementBlueprint(land: LandDef = SALTMERE_LAND): SpatialBlueprint {
  const rooms: SpatialRoom[] = land.places.filter(p => ROOMS[p.id]).map(p => ({ ...ROOMS[p.id], name: p.name, description: p.description }));
  rooms.push(structuredClone(NET_HOUSE));
  const props: SpatialProp[] = [], doors: SpatialBlueprint["doors"] = [];
  const add = (prop: Omit<SpatialProp, "elevation" | "rotationY" | "reach"> & Partial<SpatialProp>) =>
    props.push({ elevation: 0, rotationY: 0, reach: 1.1, ...prop } as SpatialProp);
  // Wide open ways between the outdoor places; the Net House has its door onto the Common.
  const way = (id: string, from: string, to: string, x: number, y: number, axis: "x" | "y", width: number, anchor: { x: number; y: number }) => {
    add({ id: `${id}-way`, roomId: from, assetId: "passage", name: `${id.replace(/-/g, " ")} way`, description: "An open way between two places.",
      position: { x, y }, interactionAnchors: [anchor] });
    doors.push({ id, from, to, propId: `${id}-way`, position: { x, y }, axis, width });
  };
  way("common-wood", "settle-common", "settle-wood", 50, 60, "x", 8, { x: 1, y: 0 });
  way("common-shore", "settle-common", "settle-shore", 75, 80, "y", 8, { x: 0, y: -1 });
  way("common-field", "settle-common", "settle-field", 100, 60, "x", 8, { x: -1, y: 0 });
  way("common-spring", "settle-common", "settle-spring", 75, 40, "y", 8, { x: 0, y: 1 });
  way("field-quarry", "settle-field", "settle-quarry", 118, 40, "y", 8, { x: 0, y: 1 });
  way("net-house-door", "settle-common", "settle-net-house", 95, 40, "y", 2, { x: 0, y: 1 });
  for (const { thing, roomId, x, y, anchor } of placeThings(land)) {
    const assetId = ASSET[thing.kind] ?? thing.kind, collider = SPATIAL_ASSETS[assetId]?.collider;
    // On 1 m walking cells a place to stand must clear the footprint by more than a cell.
    // Several places to stand, one per side, so one person idling cannot block a station.
    const room = rooms.find(r => r.id === roomId)!.bounds;
    const w = (collider?.halfWidth ?? .4) + 1.3, h = (collider?.halfDepth ?? .4) + 1.3;
    const sides = [{ x: 0, y: Math.sign(anchor.y || -1) * h }, { x: 0, y: -Math.sign(anchor.y || -1) * h }, { x: w, y: 0 }, { x: -w, y: 0 }]
      .filter(p => x + p.x > room.minX + .6 && x + p.x < room.maxX - .6 && y + p.y > room.minY + .6 && y + p.y < room.maxY - .6);
    add({ id: `thing-${thing.id}`, roomId, assetId, name: thing.kind === "net-rack" && thing.name === NET_HOUSE.name ? "Net House rack" : thing.name,
      description: `${thing.name}.`, position: { x, y }, interactionAnchors: sides.length ? sides : [anchor] });
  }
  return { id: SETTLEMENT_SCENARIO_ID, author: "operator", rooms, props, walls: [], doors, spawns: [] };
}

const PLACE_OF_ROOM = Object.fromEntries(Object.entries(ROOMS).map(([place, room]) => [room.id, place]));
export const settlementPlaceOfRoom = (roomId: string) => PLACE_OF_ROOM[roomId] ?? (roomId === NET_HOUSE.id ? "common" : undefined);

/** Where a trade works (a land place id). */
const WORKPLACE: Record<string, string> = { fisher: "shore", cook: "common", "net-mender": "common", woodcutter: "wood", grower: "field", forager: "wood", builder: "common" };

export function createSettlementScenario(land: LandDef = SALTMERE_LAND): SpatialScenarioDefinition {
  const cast = createLovecraftTownScenario();
  const blueprint = createSettlementBlueprint(land);
  const roomName = (place: string) => blueprint.rooms.find(r => r.id === ROOMS[place].id)!.name;
  const residents: SpatialResident[] = [];
  land.residents.forEach((r, i) => {
    const person = cast.residents.find(c => c.name === r.name);
    if (!person) throw Error(`Saltmere has no resident ${r.name}`);
    const start = ROOMS[r.start], duties = land.trades.find(t => t.role === r.trade)?.duties ?? [];
    const work = roomName(WORKPLACE[r.trade] ?? "common");
    const resident: SpatialResident = { ...structuredClone(person), startRoomId: start.id, startRoom: roomName(r.start),
      homeRoomId: undefined, phoneId: undefined, phoneContact: undefined,
      initialGoal: { description: r.trade === "builder" ? "Raise the town: a workshop first, then houses so people can leave their tents."
        : `Keep Saltmere supplied as its ${r.trade}: ${duties.map(d => d.item.replace(/-/g, " ")).join(" and ")} on the market stall.`, priority: 6, kind: "custom" },
      initialObservation: `Dawn on Saltmere Common. The town is tents, the old Net House, a market stall and bare plots; everything else has to be made. You are the town's ${r.trade}.`,
      schedule: [
        { name: "work", startHour: 7, duration: 10, location: work, priority: 6, interruptible: true, description: `Work as the town's ${r.trade}.` },
        { name: "supper at the campfire", startHour: 18, duration: 3, location: roomName("common"), priority: 5, interruptible: true, description: "Eat, trade, talk by the fire." },
        { name: "sleep", startHour: 22, duration: 8, location: roomName("common"), priority: 8, interruptible: true, description: "Sleep in your tent (or house, once there is one)." },
      ],
      needs: { hunger: 20, energy: 90 } };
    resident.role = `${person.role}; the town's ${r.trade}`;
    residents.push(resident);
    const room = blueprint.rooms.find(x => x.id === start.id)!;
    blueprint.spawns.push({ id: person.id, roomId: start.id, name: person.name, assetId: person.assetId,
      position: { x: room.entry.x + ((i % 5) - 2) * 1.5, y: room.entry.y + Math.floor(i / 5) * 1.5 } });
  });
  return { id: SETTLEMENT_SCENARIO_ID, title: "Argos · Saltmere Settlement", blueprint, bounds: { minX: 0, minY: 0, maxX: 140, maxY: 110 },
    residents, maxWorldEntities: 1000, navigationCellSize: 1 };
}
