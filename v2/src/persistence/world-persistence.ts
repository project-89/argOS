import { query, getRelationTargets, addEntity, addComponent, entityExists } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import {
  AllComponents,
  Name, Description, Position, Room, Agent, Mind,
  Stimulus, KnowledgeNode, Memory, Belief, Goal, Impression,
  Action, CognitiveEvent, PhysicalObject, StimulusSource, GodAgent,
  GridPosition, Sprite, WorldMap, Visual, CharacterRigConfig, Needs, Interactable
} from "../ecs/components";
import { createCharacterRig, getCharacterRig } from "../rendering/character-rig";
import { AllRelations, OccupiesRoom, Knows, Contains, BelongsTo } from "../ecs/relations";
import { getAgentKnowledge } from "../cognition/knowledge-graph";
import { getAgentMemory } from "../cognition/agent-mind";
import * as fs from "fs/promises";
import * as path from "path";

export interface SerializedEntity {
  id: number;
  name: string;
  components: Record<string, Record<string, any>>;
  relations: Array<{
    type: string;
    targetId: number;
    targetName: string;
    data?: Record<string, any>;
  }>;
}

export interface SerializedSystem {
  name: string;
  description: string;
  pseudocode: string;
  frequency: number;
  active: boolean;
  code: string;
}

export interface SerializedWorld {
  version: string;
  name: string;
  createdAt: number;
  savedAt: number;
  tick: number;
  entities: SerializedEntity[];
  systems: SerializedSystem[];
  agentMemories: Record<string, {
    thoughts: Array<{ content: string; timestamp: number }>;
    recentActions: Array<{ type: string; target?: string; content?: string }>;
    perceptions: Array<{ type: string; content: string; source: string }>;
  }>;
  narrative?: string;
}

const COMPONENT_SERIALIZERS: Record<string, (eid: number) => Record<string, any> | null> = {
  Name: (eid) => Name.value[eid] ? { value: Name.value[eid] } : null,
  Description: (eid) => Description.value[eid] ? { value: Description.value[eid] } : null,
  Position: (eid) => Position.x[eid] !== undefined ? { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] } : null,
  Room: (eid) => Room.capacity[eid] !== undefined ? { capacity: Room.capacity[eid], ambience: Room.ambience[eid] } : null,
  Agent: (eid) => Agent.role[eid] ? { role: Agent.role[eid], systemPrompt: Agent.systemPrompt[eid], active: Agent.active[eid] } : null,
  Mind: (eid) => Mind.mode[eid] ? { mode: Mind.mode[eid], arousal: Mind.arousal[eid], focus: Mind.focus[eid], lastUpdate: Mind.lastUpdate[eid] } : null,
  StimulusSource: (eid) => StimulusSource.stimulusType[eid] ? { 
    stimulusType: StimulusSource.stimulusType[eid], 
    template: StimulusSource.template[eid], 
    interval: StimulusSource.interval[eid],
    lastEmit: StimulusSource.lastEmit[eid]
  } : null,
  PhysicalObject: (eid) => PhysicalObject.material[eid] ? {
    material: PhysicalObject.material[eid],
    weight: PhysicalObject.weight[eid],
    portable: PhysicalObject.portable[eid]
  } : null,
  GodAgent: (eid) => GodAgent.worldName[eid] ? {
    worldName: GodAgent.worldName[eid],
    narrative: GodAgent.narrative[eid],
    tick: GodAgent.tick[eid]
  } : null,
  GridPosition: (eid) => GridPosition.x[eid] !== undefined ? {
    x: GridPosition.x[eid],
    y: GridPosition.y[eid],
    facing: GridPosition.facing[eid]
  } : null,
  Sprite: (eid) => Sprite.char[eid] ? {
    char: Sprite.char[eid],
    color: Sprite.color[eid],
    bgColor: Sprite.bgColor[eid],
    zIndex: Sprite.zIndex[eid]
  } : null,
  WorldMap: (eid) => WorldMap.name[eid] ? {
    name: WorldMap.name[eid],
    width: WorldMap.width[eid],
    height: WorldMap.height[eid],
    tiles: WorldMap.tiles[eid]
  } : null,
  Visual: (eid) => Visual.shape[eid] ? {
    shape: Visual.shape[eid],
    color: Visual.color[eid],
    size: Visual.size[eid],
    label: Visual.label[eid],
    opacity: Visual.opacity[eid],
    glow: Visual.glow[eid],
    pulseRate: Visual.pulseRate[eid]
  } : null,
  CharacterRigConfig: (eid) => CharacterRigConfig.baseAtlas[eid] ? {
    baseAtlas: CharacterRigConfig.baseAtlas[eid],
    idleAnimation: CharacterRigConfig.idleAnimation[eid],
    currentDirection: CharacterRigConfig.currentDirection[eid]
  } : null,
  Needs: (eid) => Needs.hunger[eid] !== undefined ? {
    hunger: Needs.hunger[eid],
    energy: Needs.energy[eid],
    social: Needs.social[eid],
    comfort: Needs.comfort[eid]
  } : null,
  Interactable: (eid) => Interactable.action[eid] ? {
    action: Interactable.action[eid],
    targetNeed: Interactable.targetNeed[eid],
    effectAmount: Interactable.effectAmount[eid],
    cooldown: Interactable.cooldown[eid],
    lastUsed: Interactable.lastUsed[eid]
  } : null,
};

export function serializeWorld(
  world: World, 
  registry: SystemRegistry,
  narrative?: string
): SerializedWorld {
  const entities: SerializedEntity[] = [];
  const entityIdToName = new Map<number, string>();
  
  const allEntities = new Set<number>();
  for (const [compName, component] of Object.entries(AllComponents)) {
    if (compName === "Removed") continue;
    try {
      const eids = Array.from(query(world, [component]));
      for (const eid of eids) {
        allEntities.add(eid);
        if (Name.value[eid]) {
          entityIdToName.set(eid, Name.value[eid]);
        }
      }
    } catch {}
  }

  for (const eid of allEntities) {
    // Skip entities that no longer exist (stale references)
    if (!entityExists(world, eid)) continue;

    const components: Record<string, Record<string, any>> = {};

    for (const [compName, serializer] of Object.entries(COMPONENT_SERIALIZERS)) {
      try {
        const data = serializer(eid);
        if (data) {
          components[compName] = data;
        }
      } catch {
        // Skip components that fail to serialize (entity may have been removed)
      }
    }

    const relations: SerializedEntity["relations"] = [];

    // Use safeGetRelationTargets to avoid errors with stale entity references
    const roomTargets = safeGetRelationTargets(world, eid, OccupiesRoom);
    for (const targetId of roomTargets) {
      if (!entityExists(world, targetId)) continue;
      relations.push({
        type: "OccupiesRoom",
        targetId,
        targetName: entityIdToName.get(targetId) || `entity_${targetId}`,
      });
    }

    const knowsTargets = safeGetRelationTargets(world, eid, Knows);
    for (const targetId of knowsTargets) {
      if (!entityExists(world, targetId)) continue;
      const store = Knows(targetId);
      relations.push({
        type: "Knows",
        targetId,
        targetName: entityIdToName.get(targetId) || `entity_${targetId}`,
        data: {
          familiarity: store.familiarity[eid],
          sentiment: store.sentiment[eid],
          lastInteraction: store.lastInteraction[eid],
        },
      });
    }

    const containsTargets = safeGetRelationTargets(world, eid, Contains);
    for (const targetId of containsTargets) {
      if (!entityExists(world, targetId)) continue;
      relations.push({
        type: "Contains",
        targetId,
        targetName: entityIdToName.get(targetId) || `entity_${targetId}`,
      });
    }

    entities.push({
      id: eid,
      name: Name.value[eid] || `entity_${eid}`,
      components,
      relations,
    });
  }

  const systems: SerializedSystem[] = [];
  for (const [name, system] of registry.systems) {
    if (system.code) {
      systems.push({
        name: system.name,
        description: system.description,
        pseudocode: system.pseudocode || "",
        frequency: system.frequency,
        active: system.active,
        code: system.code,
      });
    }
  }

  const agentMemories: SerializedWorld["agentMemories"] = {};
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    const name = Name.value[eid];
    if (name) {
      const memory = getAgentMemory(world, eid);
      agentMemories[name] = {
        thoughts: memory.thoughts,
        recentActions: memory.recentActions,
        perceptions: memory.perceptions,
      };
    }
  }

  return {
    version: "1.0.0",
    name: world.meta.name,
    createdAt: world.meta.createdAt,
    savedAt: Date.now(),
    tick: world.time.tick,
    entities,
    systems,
    agentMemories,
    narrative,
  };
}

export async function saveWorld(
  world: World,
  registry: SystemRegistry,
  filePath: string,
  narrative?: string
): Promise<void> {
  const serialized = serializeWorld(world, registry, narrative);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(serialized, null, 2));
  console.log(`[Persistence] Saved world to ${filePath}`);
}

export async function loadWorldData(filePath: string): Promise<SerializedWorld> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as SerializedWorld;
}

export function getWorldSaves(saveDir: string = "./saves"): Promise<string[]> {
  return fs.readdir(saveDir).then(files => 
    files.filter(f => f.endsWith(".json")).map(f => path.join(saveDir, f))
  ).catch(() => []);
}

const COMPONENT_DESERIALIZERS: Record<string, (eid: number, data: Record<string, any>) => void> = {
  Name: (eid, data) => { Name.value[eid] = data.value; },
  Description: (eid, data) => { Description.value[eid] = data.value; },
  Position: (eid, data) => { Position.x[eid] = data.x; Position.y[eid] = data.y; Position.z[eid] = data.z; },
  Room: (eid, data) => { Room.capacity[eid] = data.capacity; Room.ambience[eid] = data.ambience; },
  Agent: (eid, data) => { Agent.role[eid] = data.role; Agent.systemPrompt[eid] = data.systemPrompt; Agent.active[eid] = data.active; },
  Mind: (eid, data) => { Mind.mode[eid] = data.mode; Mind.arousal[eid] = data.arousal; Mind.focus[eid] = data.focus; Mind.lastUpdate[eid] = data.lastUpdate; },
  StimulusSource: (eid, data) => { 
    StimulusSource.stimulusType[eid] = data.stimulusType; 
    StimulusSource.template[eid] = data.template; 
    StimulusSource.interval[eid] = data.interval;
    StimulusSource.lastEmit[eid] = data.lastEmit;
  },
  PhysicalObject: (eid, data) => { 
    PhysicalObject.material[eid] = data.material; 
    PhysicalObject.weight[eid] = data.weight; 
    PhysicalObject.portable[eid] = data.portable; 
  },
  GodAgent: (eid, data) => { 
    GodAgent.worldName[eid] = data.worldName; 
    GodAgent.narrative[eid] = data.narrative; 
    GodAgent.tick[eid] = data.tick; 
  },
  GridPosition: (eid, data) => { 
    GridPosition.x[eid] = data.x; 
    GridPosition.y[eid] = data.y; 
    GridPosition.facing[eid] = data.facing; 
  },
  Sprite: (eid, data) => { 
    Sprite.char[eid] = data.char; 
    Sprite.color[eid] = data.color; 
    Sprite.bgColor[eid] = data.bgColor; 
    Sprite.zIndex[eid] = data.zIndex; 
  },
  WorldMap: (eid, data) => { 
    WorldMap.name[eid] = data.name; 
    WorldMap.width[eid] = data.width; 
    WorldMap.height[eid] = data.height; 
    WorldMap.tiles[eid] = data.tiles; 
  },
  Visual: (eid, data) => {
    Visual.shape[eid] = data.shape;
    Visual.color[eid] = data.color;
    Visual.size[eid] = data.size;
    Visual.label[eid] = data.label;
    Visual.opacity[eid] = data.opacity;
    Visual.glow[eid] = data.glow;
    Visual.pulseRate[eid] = data.pulseRate;
  },
  CharacterRigConfig: (eid, data) => {
    CharacterRigConfig.baseAtlas[eid] = data.baseAtlas;
    CharacterRigConfig.idleAnimation[eid] = data.idleAnimation;
    CharacterRigConfig.currentDirection[eid] = data.currentDirection;
  },
  Needs: (eid, data) => {
    Needs.hunger[eid] = data.hunger;
    Needs.energy[eid] = data.energy;
    Needs.social[eid] = data.social;
    Needs.comfort[eid] = data.comfort;
  },
  Interactable: (eid, data) => {
    Interactable.action[eid] = data.action;
    Interactable.targetNeed[eid] = data.targetNeed;
    Interactable.effectAmount[eid] = data.effectAmount;
    Interactable.cooldown[eid] = data.cooldown;
    Interactable.lastUsed[eid] = data.lastUsed;
  },
};

export function deserializeWorld(
  world: World,
  registry: SystemRegistry,
  data: SerializedWorld
): { oldToNewId: Map<number, number> } {
  const oldToNewId = new Map<number, number>();
  
  for (const entity of data.entities) {
    const eid = addEntity(world);
    oldToNewId.set(entity.id, eid);
    
    for (const [compName, compData] of Object.entries(entity.components)) {
      const component = AllComponents[compName as keyof typeof AllComponents];
      if (component) {
        addComponent(world, eid, component);
        const deserializer = COMPONENT_DESERIALIZERS[compName];
        if (deserializer) {
          deserializer(eid, compData);
        }
      }
    }
  }
  
  for (const entity of data.entities) {
    const eid = oldToNewId.get(entity.id)!;
    for (const rel of entity.relations) {
      const targetEid = oldToNewId.get(rel.targetId);
      if (!targetEid) continue;
      
      if (rel.type === "OccupiesRoom") {
        addComponent(world, eid, OccupiesRoom(targetEid));
      } else if (rel.type === "Knows" && rel.data) {
        const store = Knows(targetEid);
        addComponent(world, eid, store);
        store.familiarity[eid] = rel.data.familiarity;
        store.sentiment[eid] = rel.data.sentiment;
        store.lastInteraction[eid] = rel.data.lastInteraction;
      } else if (rel.type === "Contains") {
        addComponent(world, eid, Contains(targetEid));
      }
    }
  }
  
  for (const sys of data.systems) {
    if (sys.code) {
      const { compileSystemCode } = require("../god/system-baker");
      const result = compileSystemCode(sys.code);
      if (result.success && result.fn) {
        const systemDef: SystemDefinition = {
          name: sys.name,
          description: sys.description,
          pseudocode: sys.pseudocode,
          frequency: sys.frequency,
          active: sys.active,
          lastRun: 0,
          code: sys.code,
          compiledFn: result.fn,
        };
        registry.systems.set(sys.name, systemDef);
      }
    }
  }

  // Recreate character rigs from saved config
  let rigCount = 0;
  for (const entity of data.entities) {
    const eid = oldToNewId.get(entity.id)!;
    const rigConfig = entity.components.CharacterRigConfig;
    if (rigConfig && rigConfig.baseAtlas) {
      const entityName = Name.value[eid] || `entity_${eid}`;
      // Check if rig already exists (shouldn't, but just in case)
      if (!getCharacterRig(eid)) {
        createCharacterRig({
          entityId: eid,
          entityName: entityName,
          baseAtlas: rigConfig.baseAtlas,
        });
        rigCount++;
        console.log(`[Persistence] Recreated character rig for ${entityName} (${rigConfig.baseAtlas})`);
      }
    }
  }

  world.meta.name = data.name;
  world.time.tick = data.tick;

  console.log(`[Persistence] Loaded world with ${data.entities.length} entities, ${data.systems.length} systems, ${rigCount} character rigs`);

  return { oldToNewId };
}

export async function loadWorld(
  world: World,
  registry: SystemRegistry,
  filePath: string
): Promise<{ oldToNewId: Map<number, number> }> {
  const data = await loadWorldData(filePath);
  return deserializeWorld(world, registry, data);
}

const AUTOSAVE_PATH = "./saves/autosave.json";

export async function autoSave(world: World, registry: SystemRegistry): Promise<void> {
  await saveWorld(world, registry, AUTOSAVE_PATH);
}

export async function loadAutoSave(world: World, registry: SystemRegistry): Promise<boolean> {
  try {
    await fs.access(AUTOSAVE_PATH);
    await loadWorld(world, registry, AUTOSAVE_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function hasAutoSave(): Promise<boolean> {
  try {
    await fs.access(AUTOSAVE_PATH);
    return true;
  } catch {
    return false;
  }
}
