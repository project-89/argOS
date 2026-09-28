import { query, getRelationTargets, addEntity, addComponent, removeComponent, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { snapshotWorldConstructionBudget, restoreWorldConstructionBudget, type WorldConstructionSnapshot } from "../runtime/world-construction-budget";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import {
  AllComponents,
  Name, Description, Position, Room, Agent, Mind, WorkingMemory, AuthoredAspirations, SocialMemory, CoordinationMemory,
  Stimulus, KnowledgeNode, Memory, Belief, Goal, GoalLifecycle, Impression,
  Action, CognitiveEvent, PhysicalObject, StimulusSource, GodAgent,
  GridPosition, Sprite, WorldMap, Visual, CharacterRigConfig, Needs, Interactable,
  BehaviorPolicy, ProcedureState, StoryScaffold, Thought, Perception, ConversationTurn, EquipSlot, Plan, ToolResult
} from "../ecs/components";
import { createCharacterRig, getCharacterRig } from "../rendering/character-rig";
import { initializeCharacterEquipment } from "../rendering/character-appearance";
import { LocatedIn, Knows, HasMemory, HasBelief, HasGoal, HasThought, HasPerception, HasConversation, HasImpression,
  HasPlan, HasSchedule, HasReflectionState, HasToolResult, HasNarrative,
  SittingOn, SleepingOn, OnTopOf, OccupiedBy, AdjacentTo } from "../ecs/relations";
import { getMergedComponents, listDynamic, registryCreateComponent } from "../ecs/component-registry";
import type { ComponentDefinition } from "../ecs/dynamic-components";
import { worldSchema } from "../world/schema";
import { getWorldSpecification, parseWorldSpecification, setWorldSpecification, type WorldSpecification } from "../world/world-specification";
import { stampObjectStateTime } from "../world/object-state-time";
import { getStampedSimulationTime } from "../ecs/temporal-age";
import { ObjectState } from "../ecs/components";
import { getRuntimePackageRequirements, requireRuntimePackage } from "../runtime/package-requirements";
import { getDirectContainer, setLocatedIn } from "../ecs/location";
import { getAgentKnowledge } from "../cognition/knowledge-graph";
import { getAgentMemory } from "../cognition/agent-mind";
import { restoreAuthoredAspirationOwnership, snapshotAuthoredAspirations } from "../cognition/goal-learning";
import { restoreSocialMemoryFields } from "../cognition/social-memory";
import { CommunicationMemory, CoordinationReviewState, OngoingActivity } from "../ecs/components";
import { compileSystemCode } from "../god/system-baker";
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
  managedRelease?: { digest: string; jobId: string };
  async?: boolean;
  name: string;
  description: string;
  pseudocode: string;
  frequency: number;
  active: boolean;
  code: string;
}

export interface SerializedAgentMemory {
  /** Original entity ID; names are display labels and need not be unique. */
  agentId?: number;
  thoughts: Array<{ content: string; timestamp: number }>;
  recentActions: Array<{ type: string; target?: string; content?: string }>;
  perceptions: Array<{ type: string; content: string; source: string; timestamp?: number }>;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string; timestamp?: number }>;
}

export interface SerializedWorld {
  /** Authored setting/cast intent, including private history; never runtime authority. */
  worldSpecification?: WorldSpecification;
  /** Lifetime admitted world construction; internal cognition entities are excluded. */
  constructionBudget?: WorldConstructionSnapshot;
  runtimePackages?: string[];
  /** Authored affordances/types/rules; host permissions are not included. */
  schema?: object;
  version: string;
  name: string;
  createdAt: number;
  savedAt: number;
  tick: number;
  /** Simulation time continues from the snapshot; loading does not replay a frame. */
  clock?: Omit<World["time"], "delta">;
  temporalBaseline?: World["meta"]["temporalBaseline"];
  timedSpeech?: boolean;
  timedActions?: boolean;
  narrativeMind?: boolean;
  entities: SerializedEntity[];
  systems: SerializedSystem[];
  componentDefinitions?: ComponentDefinition[];
  agentMemories: Record<string, SerializedAgentMemory>;
  /** ECS links are complete. Summaries must not resurrect missing targets. */
  cognitionStorage?: "ecs";
  narrative?: string;
}

const COGNITIVE_RELATIONS: Record<string, { relation: any; fields: string[] }> = {
  Knows: { relation: Knows, fields: ["familiarity", "sentiment", "lastInteraction"] },
  HasMemory: { relation: HasMemory, fields: [] },
  HasNarrative: { relation: HasNarrative, fields: [] },
  HasBelief: { relation: HasBelief, fields: [] },
  HasGoal: { relation: HasGoal, fields: [] },
  HasThought: { relation: HasThought, fields: [] },
  HasPerception: { relation: HasPerception, fields: [] },
  HasConversation: { relation: HasConversation, fields: [] },
  HasImpression: { relation: HasImpression, fields: ["sentiment", "lastUpdated"] },
  HasPlan: { relation: HasPlan, fields: [] },
  HasSchedule: { relation: HasSchedule, fields: [] },
  HasReflectionState: { relation: HasReflectionState, fields: [] },
  HasToolResult: { relation: HasToolResult, fields: [] },
};

// Posture/support is actual world state, not descriptive appearance. Restoring
// an "occupied" chair without its actor->chair link loses the native sit effect.
// Keep these links separate from LocatedIn: sitting on a chair does not put the
// actor inside its inventory/container, and a support need not be its room.
const PERSISTED_RELATIONS: Record<string, { relation: any; fields: string[] }> = {
  ...COGNITIVE_RELATIONS,
  SittingOn: { relation: SittingOn, fields: [] },
  SleepingOn: { relation: SleepingOn, fields: [] },
  OnTopOf: { relation: OnTopOf, fields: [] },
  OccupiedBy: { relation: OccupiedBy, fields: [] },
  AdjacentTo: { relation: AdjacentTo, fields: [] },
};

/**
 * Hydrate missing short-term ECS context from a legacy summary for a live Agent
 * in the supplied world. Callers must resolve its ID in that world (e.g. using
 * oldToNewId). Existing context wins; no perceptions, arousal or actions replay.
 */
export function restoreAgentMemory(world: World, agentEid: number, memory: SerializedAgentMemory): void {
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent)) return;

  const restore = (relation: any, component: any, rows: Record<string, any>[], limit: number) => {
    // Even a dangling saved relationship is authoritative; do not resurrect it.
    if (getRelationTargets(world, agentEid, relation).length) return;
    for (const row of rows.slice(-limit)) {
      const eid = addEntity(world);
      addComponent(world, eid, component);
      addComponent(world, agentEid, relation(eid));
      for (const [field, value] of Object.entries(row)) component[field][eid] = value;
    }
  };

  restore(HasThought, Thought, (memory.thoughts || [])
    .filter(row => typeof row?.content === "string")
    .map((row, index) => ({ content: row.content, type: "reflection", salience: 0.5,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : index })), 10);
  restore(HasPerception, Perception, (memory.perceptions || [])
    .filter(row => typeof row?.content === "string" && typeof row.type === "string" && typeof row.source === "string")
    .map((row, index) => ({ type: row.type, content: row.content, source: row.source, intensity: 1,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : index })), 20);
  restore(HasConversation, ConversationTurn, (memory.conversationHistory || [])
    .filter(row => typeof row?.content === "string" && (row.role === "user" || row.role === "assistant"))
    .map((row, index) => ({ role: row.role, content: row.content,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : index })), 20);
}

const COMPONENT_SERIALIZERS: Record<string, (eid: number) => Record<string, any> | null> = {
  Name: (eid) => Name.value[eid] ? { value: Name.value[eid] } : null,
  Description: (eid) => Description.value[eid] ? { value: Description.value[eid] } : null,
  Position: (eid) => Position.x[eid] !== undefined ? { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] } : null,
  Room: (eid) => Room.capacity[eid] !== undefined ? { capacity: Room.capacity[eid], ambience: Room.ambience[eid] } : null,
  Agent: (eid) => Agent.role[eid] ? { role: Agent.role[eid], systemPrompt: Agent.systemPrompt[eid], active: Agent.active[eid] } : null,
  Mind: (eid) => Mind.mode[eid] ? { mode: Mind.mode[eid], arousal: Mind.arousal[eid], focus: Mind.focus[eid], lastUpdate: Mind.lastUpdate[eid] } : null,
  Memory: (eid) => Memory.type[eid] ? {
    type: Memory.type[eid],
    content: Memory.content[eid],
    emotionalValence: Memory.emotionalValence[eid],
    importance: Memory.importance[eid],
    timestamp: Memory.timestamp[eid],
    lastRecalled: Memory.lastRecalled[eid],
    recallCount: Memory.recallCount[eid],
  } : null,
  ProcedureState: (eid) => ProcedureState.signature[eid] ? {
    signature: ProcedureState.signature[eid],
    stepIndex: ProcedureState.stepIndex[eid],
    status: ProcedureState.status[eid],
    startedAt: ProcedureState.startedAt[eid],
    lastUpdatedAt: ProcedureState.lastUpdatedAt[eid],
  } : null,
  BehaviorPolicy: (eid) => BehaviorPolicy.treeJson[eid] ? {
    enabled: BehaviorPolicy.enabled[eid],
    treeJson: BehaviorPolicy.treeJson[eid],
    version: BehaviorPolicy.version[eid],
    lastUpdatedAt: BehaviorPolicy.lastUpdatedAt[eid],
  } : null,
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
    tick: GodAgent.tick[eid],
    narrativeGoals: GodAgent.narrativeGoals[eid],
    tension: GodAgent.tension[eid],
    lastObservation: GodAgent.lastObservation[eid],
    interventionCount: GodAgent.interventionCount[eid],
    observationInterval: GodAgent.observationInterval[eid],
    stagnationScore: GodAgent.stagnationScore[eid],
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
  StoryScaffold: (eid) => StoryScaffold.seed[eid] ? {
    tensions: StoryScaffold.tensions[eid],
    npcRoles: StoryScaffold.npcRoles[eid],
    currentAct: StoryScaffold.currentAct[eid],
    adaptations: StoryScaffold.adaptations[eid],
    seed: StoryScaffold.seed[eid]
  } : null,
};

export function serializeWorld(
  world: World, 
  registry: SystemRegistry,
  narrative?: string
): SerializedWorld {
  const entities: SerializedEntity[] = [];
  const entityIdToName = new Map<number, string>();
  const registeredComponents: Record<string, any> = { ...AllComponents, ...getMergedComponents() };
  
  const allEntities = new Set<number>();
  for (const [compName, component] of Object.entries(registeredComponents)) {
    if (compName === "Removed") continue;
    try {
      const eids = Array.from(query(world, [component]));
      for (const eid of eids) {
        allEntities.add(eid);
        if (hasComponent(world, eid, Name) && Name.value[eid]) {
          entityIdToName.set(eid, Name.value[eid]);
        }
      }
    } catch {}
  }

  for (const eid of allEntities) {
    // Skip entities that no longer exist (stale references)
    if (!entityExists(world, eid)) continue;

    const components: Record<string, Record<string, any>> = {};

    for (const [compName, component] of Object.entries(registeredComponents)) {
      try {
        // Sparse SoA values survive deletion and EID reuse. Membership, not a
        // leftover array value, decides which components the live entity owns.
        if (!component || !hasComponent(world, eid, component)) continue;
        const serializer = COMPONENT_SERIALIZERS[compName];
        const data = compName === "AuthoredAspirations" ? snapshotAuthoredAspirations(world, eid) : serializer ? serializer(eid) : Object.fromEntries(
          Object.entries(component).filter(([, values]) => (values as any)?.[eid] !== undefined)
            .map(([field, values]) => [field, (values as any)[eid]])
        );
        if (data) {
          components[compName] = data;
        }
      } catch {
        // Skip components that fail to serialize (entity may have been removed)
      }
    }

    const relations: SerializedEntity["relations"] = [];

    // Canonical containment/location
    const locatedInTargets = safeGetRelationTargets(world, eid, LocatedIn);
    for (const targetId of locatedInTargets) {
      if (!entityExists(world, targetId)) continue;
      relations.push({
        type: "LocatedIn",
        targetId,
        targetName: entityIdToName.get(targetId) || `entity_${targetId}`,
      });
    }

    for (const [type, { relation, fields }] of Object.entries(PERSISTED_RELATIONS)) {
      for (const targetId of safeGetRelationTargets(world, eid, relation)) {
        if (!entityExists(world, targetId)) continue;
        const store = relation(targetId);
        relations.push({ type, targetId, targetName: entityIdToName.get(targetId) || `entity_${targetId}`,
          ...(fields.length ? { data: Object.fromEntries(fields.map(field => [field, store[field][eid]])) } : {}),
        });
      }
    }

    entities.push({
      id: eid,
      name: entityIdToName.get(eid) || `entity_${eid}`,
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
        active: system.managedRestorePending?.active ?? system.active,
        managedRelease: system.managedRelease ? { ...system.managedRelease } : undefined,
        async: system.async === true,
        code: system.code,
      });
    }
  }

  const agentMemories: SerializedWorld["agentMemories"] = Object.create(null);
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    let key = entityIdToName.get(eid) || `entity_${eid}`;
    while (Object.prototype.hasOwnProperty.call(agentMemories, key)) key += `#${eid}`;
    const memory = getAgentMemory(world, eid);
    agentMemories[key] = { agentId: eid, ...memory };
  }

  return {
    version: "1.1.0",
    worldSpecification: getWorldSpecification(world),
    constructionBudget: snapshotWorldConstructionBudget(world),
    runtimePackages: getRuntimePackageRequirements(world),
    schema: structuredClone(worldSchema.toJSON()),
    name: world.meta.name,
    createdAt: world.meta.createdAt,
    savedAt: Date.now(),
    tick: world.time.tick,
    clock: {
      tick: world.time.tick,
      elapsed: world.time.elapsed,
      simulationHour: world.time.simulationHour,
      timeOfDay: world.time.timeOfDay,
      simulationDay: world.time.simulationDay,
    },
    temporalBaseline: world.meta.temporalBaseline ?? { wallAtMs: world.meta.createdAt, simAtMs: 0 },
    timedSpeech: world.meta.timedSpeech,
    timedActions: world.meta.timedActions,
    narrativeMind: world.meta.narrativeMind,
    entities,
    systems,
    componentDefinitions: listDynamic(),
    agentMemories,
    cognitionStorage: "ecs",
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
  WorkingMemory: (eid, data) => {
    WorkingMemory.capacity[eid] = data.capacity;
    WorkingMemory.currentLoad[eid] = data.currentLoad;
    WorkingMemory.decayRate[eid] = data.decayRate;
    // Legacy working memory held only load counters. Never let a reused SoA
    // slot import another actor's newer evidence into that older snapshot.
    WorkingMemory.factsJson[eid] = typeof data.factsJson === "string" ? data.factsJson : "[]";
    WorkingMemory.receiptsJson[eid] = typeof data.receiptsJson === "string" ? data.receiptsJson : "[]";
    WorkingMemory.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    WorkingMemory.revision[eid] = Number.isFinite(data.revision) ? data.revision : 0;
    WorkingMemory.evidenceFloorMs[eid] = Number.isFinite(data.evidenceFloorMs) ? data.evidenceFloorMs : -1;
  },
  AuthoredAspirations: (eid, data) => {
    // Old saves never serialized the old process-local aspiration map. Missing
    // fields are empty, not recovered from another actor or regenerated by role.
    AuthoredAspirations.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    AuthoredAspirations.itemsJson[eid] = typeof data.itemsJson === "string" ? data.itemsJson : "[]";
  },
  SocialMemory: restoreSocialMemoryFields,
  OngoingActivity: (eid, data) => {
    OngoingActivity.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    OngoingActivity.stateJson[eid] = typeof data.stateJson === "string" ? data.stateJson : "";
  },
  CommunicationMemory: (eid, data) => {
    CommunicationMemory.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    CommunicationMemory.receiptsJson[eid] = typeof data.receiptsJson === "string" ? data.receiptsJson : "[]";
  },
  CoordinationReviewState: (eid, data) => {
    CoordinationReviewState.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    CoordinationReviewState.reviewedJson[eid] = typeof data.reviewedJson === "string" ? data.reviewedJson : "[]";
  },
  CoordinationMemory: (eid, data) => {
    CoordinationMemory.ownerKey[eid] = typeof data.ownerKey === "string" ? data.ownerKey : "";
    CoordinationMemory.itemsJson[eid] = typeof data.itemsJson === "string" ? data.itemsJson : "[]";
    CoordinationMemory.revision[eid] = Number.isSafeInteger(data.revision) && data.revision >= 0 ? data.revision : 0;
  },
  Memory: (eid, data) => {
    Memory.type[eid] = data.type;
    Memory.content[eid] = data.content;
    Memory.emotionalValence[eid] = data.emotionalValence;
    Memory.importance[eid] = data.importance;
    Memory.timestamp[eid] = data.timestamp;
    Memory.lastRecalled[eid] = data.lastRecalled;
    Memory.recallCount[eid] = data.recallCount;
  },
  ProcedureState: (eid, data) => {
    ProcedureState.signature[eid] = typeof data.signature === "string" && data.signature.length <= 512 ? data.signature : "";
    ProcedureState.stepIndex[eid] = Number.isSafeInteger(data.stepIndex) && data.stepIndex >= 0 ? data.stepIndex : 0;
    // Preserve the draft cursor, never revive an in-flight command or its wait
    // authority. A current controller must admit a new execution explicitly.
    ProcedureState.status[eid] = "needs_revision";
    ProcedureState.startedAt[eid] = Number.isFinite(data.startedAt) ? data.startedAt : 0;
    ProcedureState.lastUpdatedAt[eid] = Number.isFinite(data.lastUpdatedAt) ? data.lastUpdatedAt : 0;
  },
  BehaviorPolicy: (eid, data) => {
    BehaviorPolicy.enabled[eid] = data.enabled;
    BehaviorPolicy.treeJson[eid] = data.treeJson;
    BehaviorPolicy.version[eid] = data.version;
    BehaviorPolicy.lastUpdatedAt[eid] = data.lastUpdatedAt;
  },
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
    GodAgent.narrativeGoals[eid] = typeof data.narrativeGoals === "string" ? data.narrativeGoals : "[]";
    GodAgent.tension[eid] = Number.isFinite(data.tension) ? data.tension : 0;
    GodAgent.lastObservation[eid] = Number.isFinite(data.lastObservation) ? data.lastObservation : 0;
    GodAgent.interventionCount[eid] = Number.isFinite(data.interventionCount) ? data.interventionCount : 0;
    GodAgent.observationInterval[eid] = Number.isFinite(data.observationInterval) ? data.observationInterval : 30_000;
    GodAgent.stagnationScore[eid] = Number.isFinite(data.stagnationScore) ? data.stagnationScore : 0;
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
  StoryScaffold: (eid, data) => {
    StoryScaffold.tensions[eid] = data.tensions;
    StoryScaffold.npcRoles[eid] = data.npcRoles;
    StoryScaffold.currentAct[eid] = data.currentAct;
    StoryScaffold.adaptations[eid] = data.adaptations;
    StoryScaffold.seed[eid] = data.seed;
  },
};

export function deserializeWorld(
  world: World,
  registry: SystemRegistry,
  data: SerializedWorld,
  options: { reuseGod?: { savedEid: number; liveEid: number }; strictSystems?: boolean } = {}
): { oldToNewId: Map<number, number> } {
  // A strict authored brief is metadata, not instructions to build the world or
  // reseed characters. Reject invalid/conflicting input before budget, schema,
  // registry or ECS restoration can write anything.
  if (data.worldSpecification !== undefined)
    setWorldSpecification(world, parseWorldSpecification(data.worldSpecification));
  restoreWorldConstructionBudget(world, data.constructionBudget);
  const oldToNewId = new Map<number, number>();
  for (const name of data.runtimePackages ?? []) requireRuntimePackage(world, name);
  if (options.reuseGod && (!entityExists(world, options.reuseGod.liveEid)
    || !hasComponent(world, options.reuseGod.liveEid, GodAgent)
    || !data.entities.find(entity => entity.id === options.reuseGod!.savedEid)?.components.GodAgent))
    throw new Error("Restore may only reuse the runtime's existing God entity");
  if (data.schema) worldSchema.restoreFromJSON(data.schema);
  for (const definition of data.componentDefinitions || []) registryCreateComponent(definition);
  const registeredComponents: Record<string, any> = { ...AllComponents, ...getMergedComponents() };
  
  for (const entity of data.entities) {
    const eid = entity.id === options.reuseGod?.savedEid ? options.reuseGod.liveEid : addEntity(world);
    oldToNewId.set(entity.id, eid);
    
    for (const [compName, compData] of Object.entries(entity.components)) {
      const component = registeredComponents[compName];
      if (component) {
        addComponent(world, eid, component);
        const deserializer = COMPONENT_DESERIALIZERS[compName];
        if (deserializer) {
          deserializer(eid, compData);
        } else {
          for (const [field, value] of Object.entries(compData)) {
            if (Object.prototype.hasOwnProperty.call(component, field)) component[field][eid] = value;
          }
        }
      }
    }
    restoreAuthoredAspirationOwnership(world, eid);
  }
  
  for (const entity of data.entities) {
    const eid = oldToNewId.get(entity.id)!;
    for (const rel of entity.relations) {
      const targetEid = oldToNewId.get(rel.targetId);
      if (targetEid === undefined) continue;
      
      if (rel.type === "LocatedIn") {
        setLocatedIn(world, eid, targetEid);
      } else if (rel.type === "OccupiesRoom") {
        // Legacy: map room occupancy to canonical containment
        setLocatedIn(world, eid, targetEid);
      } else if (Object.prototype.hasOwnProperty.call(PERSISTED_RELATIONS, rel.type)) {
        const { relation, fields } = PERSISTED_RELATIONS[rel.type];
        const store = relation(targetEid);
        addComponent(world, eid, store);
        for (const field of fields) store[field][eid] = rel.data?.[field] ?? 0;
      } else if (rel.type === "Contains") {
        // Legacy: invert container->child to child->container
        setLocatedIn(world, targetEid, eid);
      }
    }
  }

  // Entity IDs are process-local. Never reconnect an intention or a receipt by
  // display name: names can repeat, and a deleted goal must stay deleted.
  for (const entity of data.entities) {
    const eid = oldToNewId.get(entity.id)!;
    const lifecycle = entity.components.GoalLifecycle;
    if (lifecycle) {
      const parent = oldToNewId.get(lifecycle.parentGoalEid);
      const hadParent = Number.isSafeInteger(lifecycle.parentGoalEid) && lifecycle.parentGoalEid >= 0;
      const validParent = parent !== undefined && hasComponent(world, parent, Goal)
        && Goal.createdAt[parent] === lifecycle.parentCreatedAt
        && String(Goal.signature[parent] || "") === String(lifecycle.parentSignature || "");
      GoalLifecycle.parentGoalEid[eid] = validParent ? parent : -1;
      if (hadParent && !validParent && hasComponent(world, eid, Goal) && ["active", "paused", "pending"].includes(Goal.status[eid])) {
        Goal.status[eid] = "retired";
        GoalLifecycle.settledAt[eid] = Date.now();
        GoalLifecycle.reason[eid] = "Parent goal is absent or changed in the restored world.";
      }
    }
    const savedPlan = entity.components.Plan;
    if (savedPlan) {
      const goal = oldToNewId.get(savedPlan.goalEid);
      Plan.goalEid[eid] = goal !== undefined && hasComponent(world, goal, Goal) ? goal : -1;
      if (typeof savedPlan.heardDialogueId === "string") Plan.heardDialogueId[eid] = savedPlan.heardDialogueId;
      else delete Plan.heardDialogueId[eid];
      if (typeof savedPlan.routeRoomKey === "string") Plan.routeRoomKey[eid] = savedPlan.routeRoomKey;
      else delete Plan.routeRoomKey[eid];
      if (Plan.goalEid[eid] === -1 && ["active", "paused", "awaiting_evidence", "awaiting_decision"].includes(Plan.status[eid])) {
        Plan.status[eid] = "failed";
      }
    }
    const receipt = entity.components.ToolResult;
    if (receipt) {
      const goal = oldToNewId.get(receipt.goalEid);
      // Preserve absent/zero legacy associations. An explicit dangling target
      // becomes -1 rather than unscoped proof for a different goal.
      ToolResult.goalEid[eid] = goal !== undefined && hasComponent(world, goal, Goal) ? goal
        : receipt.goalEid === undefined || receipt.goalEid === 0 ? receipt.goalEid : -1;
      ToolResult.deviceEid[eid] = oldToNewId.get(receipt.deviceEid) ?? -1;
    }
  }
  for (const entity of data.entities) {
    const eid = oldToNewId.get(entity.id)!;
    for (const plan of getRelationTargets(world, eid, HasPlan)) {
      if (!hasComponent(world, eid, Agent) || !hasComponent(world, plan, Plan)
        || !getRelationTargets(world, eid, HasGoal).includes(Plan.goalEid[plan])) {
        // Preserve the orphan artifact for inspection, without granting it an
        // actor/goal owner it did not have in the snapshot.
        removeComponent(world, eid, HasPlan(plan));
      }
    }
  }

  // Equipment stores an entity reference in a component field. Remap only after
  // containment has loaded; a wearing claim cannot survive outside its owner.
  for (const entity of data.entities) {
    const equipment = entity.components.EquipSlot;
    if (!equipment) continue;
    const eid = oldToNewId.get(entity.id)!;
    const owner = Number.isSafeInteger(equipment.equippedBy) && equipment.equippedBy >= 0
      ? oldToNewId.get(equipment.equippedBy) : undefined;
    EquipSlot.equippedBy[eid] = owner !== undefined && hasComponent(world, owner, Agent)
      && getDirectContainer(world, eid) === owner ? owner : -1;
  }
  initializeCharacterEquipment(world);

  if (data.cognitionStorage !== "ecs") {
    for (const [name, memory] of Object.entries(data.agentMemories || {})) {
      const candidates = memory.agentId !== undefined
        ? data.entities.filter(entity => entity.id === memory.agentId && entity.components.Agent)
        : data.entities.filter(entity => entity.components.Agent && entity.components.Name?.value === name);
      // Legacy summaries keyed only by a shared display name are ambiguous.
      if (candidates.length !== 1) continue;
      const entity = candidates[0];
      const eid = oldToNewId.get(entity.id);
      if (eid === undefined) continue;
      const hasSavedRelation = (type: string) => entity.relations.some(rel => rel.type === type);
      restoreAgentMemory(world, eid, { ...memory,
        thoughts: hasSavedRelation("HasThought") ? [] : memory.thoughts,
        perceptions: hasSavedRelation("HasPerception") ? [] : memory.perceptions,
        conversationHistory: hasSavedRelation("HasConversation") ? [] : memory.conversationHistory,
      });
    }
  }
  
  for (const sys of data.systems) {
    if (sys.managedRelease) {
      if (!/^[a-f0-9]{64}$/.test(sys.managedRelease.digest)
        || !/^[a-f0-9-]{36}$/i.test(sys.managedRelease.jobId)) throw new Error(`Invalid managed release: ${sys.name}`);
      if (registry.systems.has(sys.name)) throw new Error(`Cannot restore managed system over existing system: ${sys.name}`);
      registry.systems.set(sys.name, {
        name: sys.name, description: sys.description, pseudocode: sys.pseudocode,
        frequency: sys.frequency, code: sys.code, active: false, lastRun: 0,
        managedRelease: { ...sys.managedRelease }, managedRestorePending: { active: sys.active },
      });
      continue;
    }
    if (sys.code) {
      // Match the compiler's legacy await detection, but never revive the old
      // running callback or silently put async work in the synchronous lane.
      const async = sys.async === true || /\bawait\b/.test(sys.code);
      const result = compileSystemCode(sys.code, async);
      if (options.strictSystems && (!result.success || !result.fn)) throw new Error(`Could not restore system: ${sys.name}`);
      if (result.success && result.fn) {
        const systemDef: SystemDefinition = {
          name: sys.name,
          description: sys.description,
          pseudocode: sys.pseudocode,
          frequency: sys.frequency,
          active: sys.active,
          async,
          running: false,
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
  if (data.clock) {
    const { elapsed, simulationHour, simulationDay, timeOfDay } = data.clock;
    if (Number.isFinite(elapsed) && elapsed >= 0) world.time.elapsed = elapsed;
    if (Number.isFinite(simulationHour) && simulationHour >= 0 && simulationHour < 24) world.time.simulationHour = simulationHour;
    if (Number.isInteger(simulationDay) && simulationDay >= 0) world.time.simulationDay = simulationDay;
    if (["dawn", "morning", "midday", "afternoon", "evening", "night"].includes(timeOfDay)) world.time.timeOfDay = timeOfDay;
  }
  world.time.delta = 0;
  // Modes survive; in-flight callback closures deliberately do not resume.
  if (typeof data.timedSpeech === "boolean") world.meta.timedSpeech = data.timedSpeech;
  if (typeof data.timedActions === "boolean") world.meta.timedActions = data.timedActions;
  if (typeof data.narrativeMind === "boolean") world.meta.narrativeMind = data.narrativeMind;
  const baseline = data.temporalBaseline;
  world.meta.temporalBaseline = baseline && Number.isFinite(baseline.wallAtMs) && Number.isFinite(baseline.simAtMs)
    ? { ...baseline } : { wallAtMs: Number.isFinite(data.savedAt) ? data.savedAt : data.createdAt, simAtMs: world.time.elapsed };

  // Explicit legacy migration only after the saved clock is restored. Unknown
  // state age is not evidence that food spent the offline interval decaying.
  for (const eid of oldToNewId.values()) if (hasComponent(world, eid, ObjectState)
    && getStampedSimulationTime(world, eid, "ObjectState.current", 0, ObjectState.current[eid]) === undefined)
    stampObjectStateTime(world, eid);

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
