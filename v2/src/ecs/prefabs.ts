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
import { Name, Description, Agent, Mind, Room, PhysicalObject, StimulusSource, GodAgent, Position } from "./components";
import { OccupiesRoom, BelongsTo } from "./relations";

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

  RoomPrefab = addPrefab(world);
  addComponent(world, RoomPrefab, Name);
  addComponent(world, RoomPrefab, Description);
  addComponent(world, RoomPrefab, Room);
  addComponent(world, RoomPrefab, Position);

  ObjectPrefab = addPrefab(world);
  addComponent(world, ObjectPrefab, Name);
  addComponent(world, ObjectPrefab, Description);
  addComponent(world, ObjectPrefab, PhysicalObject);

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

  if (config.roomId !== undefined) {
    addComponent(world, eid, OccupiesRoom(config.roomId));
  }

  return eid;
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
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(ObjectPrefab));

  Name.value[eid] = config.name;
  Description.value[eid] = config.description ?? "";
  PhysicalObject.material[eid] = config.material ?? "unknown";
  PhysicalObject.weight[eid] = config.weight ?? 1;
  PhysicalObject.portable[eid] = config.portable ?? true;

  if (config.roomId !== undefined) {
    addComponent(world, eid, OccupiesRoom(config.roomId));
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
    addComponent(world, eid, OccupiesRoom(config.roomId));
  }

  return eid;
}

export function createGodAgentEntity(
  world: World,
  config: {
    name: string;
    worldName: string;
    narrative?: string;
  }
): number {
  const eid = addEntity(world);
  addComponent(world, eid, IsA(GodAgentPrefab));

  Name.value[eid] = config.name;
  GodAgent.worldName[eid] = config.worldName;
  GodAgent.narrative[eid] = config.narrative ?? "";
  GodAgent.tick[eid] = 0;
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
