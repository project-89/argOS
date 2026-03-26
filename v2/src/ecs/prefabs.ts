import {
  addPrefab,
  addComponent,
  addEntity,
  IsA,
  observe,
  onSet,
  onGet,
} from "bitecs";
import type { World } from "./world";
import { Name, Description, Agent, Mind, Room, PhysicalObject, StimulusSource, GodAgent, Position, GridPosition, Needs, Health, Inventory, ObjectType, ObjectState, Traits } from "./components";
import { setLocatedIn } from "./location";
import {
  getDynamicComponent,
  setDynamicComponentValue,
  createDynamicComponent,
} from "./dynamic-components";

let AgentPrefab: number;
let RoomPrefab: number;
let ObjectPrefab: number;
let StimulusSourcePrefab: number;
let GodAgentPrefab: number;

export function initializePrefabs(world: World): void {
  observe(world, onSet(Name), (eid, params: { value: string }) => {
    Name.value[eid] = params.value;
  });
  observe(world, onGet(Name), (eid) => ({ value: Name.value[eid] }));

  observe(world, onSet(Description), (eid, params: { value: string }) => {
    Description.value[eid] = params.value;
  });
  observe(world, onGet(Description), (eid) => ({ value: Description.value[eid] }));

  observe(world, onSet(Agent), (eid, params: { role: string; systemPrompt: string; active?: boolean }) => {
    Agent.role[eid] = params.role;
    Agent.systemPrompt[eid] = params.systemPrompt;
    Agent.active[eid] = params.active ?? true;
  });
  observe(world, onGet(Agent), (eid) => ({
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    active: Agent.active[eid],
  }));

  observe(world, onSet(Mind), (eid, params: { mode?: string; arousal?: number; focus?: string }) => {
    Mind.mode[eid] = params.mode ?? "reactive";
    Mind.arousal[eid] = params.arousal ?? 0.5;
    Mind.focus[eid] = params.focus ?? "";
    Mind.lastUpdate[eid] = Date.now();
  });
  observe(world, onGet(Mind), (eid) => ({
    mode: Mind.mode[eid],
    arousal: Mind.arousal[eid],
    focus: Mind.focus[eid],
    lastUpdate: Mind.lastUpdate[eid],
  }));

  observe(world, onSet(Room), (eid, params: { capacity?: number; ambience?: string }) => {
    Room.capacity[eid] = params.capacity ?? 10;
    Room.ambience[eid] = params.ambience ?? "neutral";
  });
  observe(world, onGet(Room), (eid) => ({
    capacity: Room.capacity[eid],
    ambience: Room.ambience[eid],
  }));

  observe(world, onSet(PhysicalObject), (eid, params: { material?: string; weight?: number; portable?: boolean }) => {
    PhysicalObject.material[eid] = params.material ?? "unknown";
    PhysicalObject.weight[eid] = params.weight ?? 1;
    PhysicalObject.portable[eid] = params.portable ?? true;
  });
  observe(world, onGet(PhysicalObject), (eid) => ({
    material: PhysicalObject.material[eid],
    weight: PhysicalObject.weight[eid],
    portable: PhysicalObject.portable[eid],
  }));

  observe(world, onSet(StimulusSource), (eid, params: { stimulusType: string; template: string; interval?: number }) => {
    StimulusSource.stimulusType[eid] = params.stimulusType;
    StimulusSource.template[eid] = params.template;
    StimulusSource.interval[eid] = params.interval ?? 10000;
    StimulusSource.lastEmit[eid] = 0;
  });
  observe(world, onGet(StimulusSource), (eid) => ({
    stimulusType: StimulusSource.stimulusType[eid],
    template: StimulusSource.template[eid],
    interval: StimulusSource.interval[eid],
    lastEmit: StimulusSource.lastEmit[eid],
  }));

  observe(world, onSet(GodAgent), (eid, params: { worldName: string; narrative?: string }) => {
    GodAgent.worldName[eid] = params.worldName;
    GodAgent.narrative[eid] = params.narrative ?? "";
    GodAgent.tick[eid] = 0;
  });
  observe(world, onGet(GodAgent), (eid) => ({
    worldName: GodAgent.worldName[eid],
    narrative: GodAgent.narrative[eid],
    tick: GodAgent.tick[eid],
  }));

  AgentPrefab = addPrefab(world);
  addComponent(world, AgentPrefab, Name);
  addComponent(world, AgentPrefab, Description);
  addComponent(world, AgentPrefab, Agent);
  addComponent(world, AgentPrefab, Mind);
  addComponent(world, AgentPrefab, GridPosition);
  addComponent(world, AgentPrefab, Needs);
  addComponent(world, AgentPrefab, Health);
  addComponent(world, AgentPrefab, Inventory);
  addComponent(world, AgentPrefab, ObjectType);
  addComponent(world, AgentPrefab, ObjectState);
  addComponent(world, AgentPrefab, Traits);

  RoomPrefab = addPrefab(world);
  addComponent(world, RoomPrefab, Name);
  addComponent(world, RoomPrefab, Description);
  addComponent(world, RoomPrefab, Room);
  addComponent(world, RoomPrefab, Position);
  addComponent(world, RoomPrefab, GridPosition); // For movement system targeting
  addComponent(world, RoomPrefab, ObjectType);
  addComponent(world, RoomPrefab, ObjectState);
  addComponent(world, RoomPrefab, Traits);

  ObjectPrefab = addPrefab(world);
  addComponent(world, ObjectPrefab, Name);
  addComponent(world, ObjectPrefab, Description);
  addComponent(world, ObjectPrefab, PhysicalObject);
  addComponent(world, ObjectPrefab, GridPosition); // For movement system targeting
  addComponent(world, ObjectPrefab, ObjectType);
  addComponent(world, ObjectPrefab, ObjectState);
  addComponent(world, ObjectPrefab, Traits);

  StimulusSourcePrefab = addPrefab(world);
  addComponent(world, StimulusSourcePrefab, Name);
  addComponent(world, StimulusSourcePrefab, StimulusSource);

  GodAgentPrefab = addPrefab(world);
  addComponent(world, GodAgentPrefab, Name);
  addComponent(world, GodAgentPrefab, GodAgent);
  addComponent(world, GodAgentPrefab, Mind);
}

export function createAgentEntity(
  world: World,
  config: {
    name: string;
    role: string;
    systemPrompt: string;
    description?: string;
    roomId?: number;
    /** Initial grid position (x, y) - defaults to random 0-20 */
    gridPosition?: { x: number; y: number };
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(AgentPrefab));

  Name.value[eid] = config.name;
  Description.value[eid] = config.description ?? "";
  Agent.role[eid] = config.role;
  Agent.systemPrompt[eid] = config.systemPrompt;
  Agent.active[eid] = true;
  Mind.mode[eid] = "reactive";
  Mind.arousal[eid] = 0.5;
  Mind.focus[eid] = "";
  Mind.lastUpdate[eid] = Date.now();

  // Initialize GridPosition for movement system.
  // If the agent spawns in a room and no explicit gridPosition is provided, inherit the room's GridPosition
  // so RoomArrival doesn't immediately clear LocatedIn due to distance.
  if (config.gridPosition) {
    GridPosition.x[eid] = config.gridPosition.x;
    GridPosition.y[eid] = config.gridPosition.y;
    GridPosition.facing[eid] = "south";
  } else if (config.roomId !== undefined && GridPosition.x[config.roomId] !== undefined) {
    GridPosition.x[eid] = GridPosition.x[config.roomId] + Math.floor(Math.random() * 3) - 1;
    GridPosition.y[eid] = GridPosition.y[config.roomId] + Math.floor(Math.random() * 3) - 1;
    GridPosition.facing[eid] = "south";
  } else {
    GridPosition.x[eid] = Math.floor(Math.random() * 20);
    GridPosition.y[eid] = Math.floor(Math.random() * 20);
    GridPosition.facing[eid] = "south";
  }

  // Initialize Needs for hunger/energy systems
  Needs.hunger[eid] = 0;      // 0 = not hungry, increases over time
  Needs.energy[eid] = 100;    // 100 = full energy, decreases over time
  // Social is tracked as "social satisfaction" on a 0..100 scale (higher = better).
  // Some deterministic systems treat low social satisfaction as loneliness.
  Needs.social[eid] = 60;     // 60 = moderately socially satisfied
  Needs.comfort[eid] = 100;   // 100 = comfortable

  // Initialize Health for survival systems
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  Health.regenRate[eid] = 0.1;
  Health.lastDamage[eid] = 0;

  // Initialize Inventory for item interactions
  Inventory.items[eid] = JSON.stringify([]);
  Inventory.maxSlots[eid] = 10;
  Inventory.weight[eid] = 0;
  Inventory.maxWeight[eid] = 50;

  // Set default agent traits for affordance system
  // Canonical: ObjectType/ObjectState/Traits in ECS
  ObjectType.typeId[eid] = "npc";
  ObjectType.instanceName[eid] = config.name;
  ObjectState.current[eid] = "idle";
  ObjectState.previous[eid] = "";
  ObjectState.lockedUntil[eid] = 0;
  Traits.active[eid] = JSON.stringify(["talkable", "examinable", "attackable", "alive"]);

  // Legacy mirror (compat)
  ensureObjectMetaComponent();
  setDynamicComponentValue("ObjectMeta", eid, "type", "npc");
  setDynamicComponentValue("ObjectMeta", eid, "state", "idle");
  setDynamicComponentValue("ObjectMeta", eid, "traits", "talkable,examinable,attackable,alive");

  if (config.roomId !== undefined) {
    setLocatedIn(world, eid, config.roomId);
  }

  return eid;
}

/**
 * Ensure ObjectMeta dynamic component exists
 */
function ensureObjectMetaComponent(): void {
  if (!getDynamicComponent("ObjectMeta")) {
    createDynamicComponent({
      name: "ObjectMeta",
      description: "Metadata for object affordance system",
      properties: {
        type: "string",
        state: "string",
        traits: "string",
      },
    });
  }
}

let roomPositionCounter = 0;

export function resetRoomPositionCounter(): void {
  roomPositionCounter = 0;
}

export function createRoomEntity(
  world: World,
  config: {
    name: string;
    description?: string;
    capacity?: number;
    ambience?: string;
    x?: number;
    y?: number;
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(RoomPrefab));

  Name.value[eid] = config.name;
  Description.value[eid] = config.description ?? "";
  Room.capacity[eid] = config.capacity ?? 10;
  Room.ambience[eid] = config.ambience ?? "neutral";
  
  const col = roomPositionCounter % 4;
  const row = Math.floor(roomPositionCounter / 4);
  Position.x[eid] = config.x ?? 50 + col * 200;
  Position.y[eid] = config.y ?? 50 + row * 200;
  Position.z[eid] = 0;

  // Set GridPosition for movement system (agents can move toward rooms)
  // GridPosition uses smaller scale coordinates (10-unit grid)
  GridPosition.x[eid] = Math.floor((config.x ?? 50 + col * 200) / 20);
  GridPosition.y[eid] = Math.floor((config.y ?? 50 + row * 200) / 20);
  GridPosition.facing[eid] = "center";

  // Canonical: treat rooms as schema "room" objects
  ObjectType.typeId[eid] = "room";
  ObjectType.instanceName[eid] = config.name;
  ObjectState.current[eid] = "normal";
  ObjectState.previous[eid] = "";
  ObjectState.lockedUntil[eid] = 0;
  Traits.active[eid] = JSON.stringify(["container", "location"]);

  roomPositionCounter++;

  return eid;
}

export function createObjectEntity(
  world: World,
  config: {
    name: string;
    description?: string;
    material?: string;
    weight?: number;
    portable?: boolean;
    roomId?: number;
    traits?: string[];
    gridPosition?: { x: number; y: number };
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(ObjectPrefab));

  Name.value[eid] = config.name;
  Description.value[eid] = config.description ?? "";
  PhysicalObject.material[eid] = config.material ?? "unknown";
  PhysicalObject.weight[eid] = config.weight ?? 1;
  PhysicalObject.portable[eid] = config.portable ?? true;

  // Canonical object identity for generic objects created outside schema types
  ObjectType.typeId[eid] = "object";
  ObjectType.instanceName[eid] = config.name;
  ObjectState.current[eid] = "normal";
  ObjectState.previous[eid] = "";
  ObjectState.lockedUntil[eid] = 0;

  // Set default object traits for affordance system (canonical Traits component)
  const defaultTraits = ["examinable"];
  if (config.portable !== false) {
    defaultTraits.push("takeable");
  }
  // Expand common trait aliases so affordances work correctly
  const traitAliases: Record<string, string[]> = {
    food: ["edible"],       // "food" implies "edible" for eat affordance
    weapon: ["attackable"],  // "weapon" implies "attackable"
    bed: ["sleepable"],      // "bed" implies "sleepable"
    chair: ["sittable"],     // "chair" implies "sittable"
    book: ["readable"],      // "book" implies "readable"
    door: ["openable"],      // "door" implies "openable"
  };
  const rawTraits = [...defaultTraits, ...(config.traits || [])];
  const expanded = new Set(rawTraits);
  for (const t of rawTraits) {
    const aliases = traitAliases[t];
    if (aliases) aliases.forEach(a => expanded.add(a));
  }
  const allTraits = [...expanded];
  Traits.active[eid] = JSON.stringify(allTraits);

  // Legacy mirror (compat)
  ensureObjectMetaComponent();
  setDynamicComponentValue("ObjectMeta", eid, "type", "object");
  setDynamicComponentValue("ObjectMeta", eid, "state", "normal");
  setDynamicComponentValue("ObjectMeta", eid, "traits", allTraits.join(","));

  if (config.roomId !== undefined) {
    setLocatedIn(world, eid, config.roomId);
    // Inherit GridPosition from room if not specified
    if (!config.gridPosition && GridPosition.x[config.roomId] !== undefined) {
      // Place near the room's center with small offset
      GridPosition.x[eid] = GridPosition.x[config.roomId] + Math.floor(Math.random() * 3) - 1;
      GridPosition.y[eid] = GridPosition.y[config.roomId] + Math.floor(Math.random() * 3) - 1;
      GridPosition.facing[eid] = "south";
    }
  }

  // Set explicit GridPosition if provided
  if (config.gridPosition) {
    GridPosition.x[eid] = config.gridPosition.x;
    GridPosition.y[eid] = config.gridPosition.y;
    GridPosition.facing[eid] = "south";
  } else if (GridPosition.x[eid] === undefined) {
    // Fallback to random position
    GridPosition.x[eid] = Math.floor(Math.random() * 20);
    GridPosition.y[eid] = Math.floor(Math.random() * 20);
    GridPosition.facing[eid] = "south";
  }

  return eid;
}

export function createStimulusSourceEntity(
  world: World,
  config: {
    name: string;
    stimulusType: string;
    template: string;
    interval?: number;
    roomId?: number;
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(StimulusSourcePrefab));

  Name.value[eid] = config.name;
  StimulusSource.stimulusType[eid] = config.stimulusType;
  StimulusSource.template[eid] = config.template;
  StimulusSource.interval[eid] = config.interval ?? 10000;
  StimulusSource.lastEmit[eid] = 0;

  if (config.roomId !== undefined) {
    setLocatedIn(world, eid, config.roomId);
  }

  return eid;
}

export function createGodAgentEntity(
  world: World,
  config: {
    name: string;
    worldName: string;
    narrative?: string;
    narrativeGoals?: string[];
    observationInterval?: number;
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(GodAgentPrefab));

  Name.value[eid] = config.name;
  GodAgent.worldName[eid] = config.worldName;
  GodAgent.narrative[eid] = config.narrative ?? "";
  GodAgent.tick[eid] = 0;
  // Monitoring fields
  GodAgent.narrativeGoals[eid] = JSON.stringify(config.narrativeGoals ?? []);
  GodAgent.tension[eid] = 0;
  GodAgent.lastObservation[eid] = 0;
  GodAgent.interventionCount[eid] = 0;
  GodAgent.observationInterval[eid] = config.observationInterval ?? 30000;
  GodAgent.stagnationScore[eid] = 0;
  // Mind state
  Mind.mode[eid] = "deliberative";
  Mind.arousal[eid] = 0.3;
  Mind.focus[eid] = "";
  Mind.lastUpdate[eid] = Date.now();

  return eid;
}

export function getPrefabs() {
  return {
    AgentPrefab,
    RoomPrefab,
    ObjectPrefab,
    StimulusSourcePrefab,
    GodAgentPrefab,
  };
}
