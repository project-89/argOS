import { addComponent, entityExists, getEntityComponents, hasComponent, removeEntity } from "bitecs";
import type { World } from "../ecs/world";
import { Room, Name, Removed } from "../ecs/components";
import { getRegistryEntry, validateComponentInitialValues } from "../ecs/component-registry";
import { setLocatedIn } from "../ecs/location";
import { OccupiesRoom } from "../ecs/relations";
import { initializeAgentEntity, initializeRoomEntity, initializeObjectEntity } from "../ecs/prefabs";
import { assertRoomRouteAuthoringAllowed, connectRoomRoute, disconnectRoomRoute } from "../runtime/room-routes";
import { clearAspirations } from "../cognition/goal-learning";
import { allocateWorldEntity } from "../runtime/world-construction-budget";
import { assertAgentIdentityAvailable, assertParticipantComponentAuthoringAllowed } from "../runtime/participant-identities";
import { ObjectManager, type SpawnOptions } from "../world/object-manager";
import { worldSchema } from "../world/schema";
import { stampObjectStateTime } from "../world/object-state-time";
import { characterPastSchema, type CharacterPast } from "../cognition/character-past-schema";
import { withWorldMaterializationAdapter } from "./world-materialization-adapter";

export interface MaterializedEntitySpec {
  name: string; description: string; type: "agent" | "object" | "room" | "stimulus_source";
  components: { name: string; values: Record<string, unknown> }[]; roomEid?: number;
  /** New rooms only: bounded explicit two-way routes to existing named rooms. */
  connectToRoomEids?: number[];
  /** Private creation-time history, never generic component-write authority. */
  past?: CharacterPast;
}

/** Physical references are separate from the private intention motivating a build. */
export function materializationRoomDependencies(spec: MaterializedEntitySpec): number[] {
  if (spec.connectToRoomEids !== undefined && (spec.type !== "room" || !Array.isArray(spec.connectToRoomEids)
    || spec.connectToRoomEids.length > 8 || spec.connectToRoomEids.some(eid => !Number.isInteger(eid) || eid < 0)
    || new Set(spec.connectToRoomEids).size !== spec.connectToRoomEids.length))
    throw new Error("connectToRoomEids requires at most eight distinct existing rooms for a new room");
  return spec.type === "room" ? spec.connectToRoomEids ?? [] : [spec.roomEid!];
}

/** Validate a complete additive entity before allocating it. Static and dynamic
 * components use the same registry. Unknown fields are errors, never fake success. */
export function materializeApprovedEntity(world: World, spec: MaterializedEntitySpec): number {
  return withWorldMaterializationAdapter(world, spec, derived => materializeNativeEntity(world, derived));
}

function materializeNativeEntity(world: World, spec: MaterializedEntitySpec): number {
  const { requested, plan, objectSpawn } = prepareMaterializedEntityDefinition(spec);
  if(spec.type === "agent") assertAgentIdentityAvailable(world,spec.name);
  if (spec.type !== "room" && (!Number.isInteger(spec.roomEid) || !entityExists(world, spec.roomEid!) || !hasComponent(world, spec.roomEid!, Room)))
    throw new Error("A non-room entity requires an existing roomEid");
  for (const room of materializationRoomDependencies(spec)) {
    if (!entityExists(world, room) || !hasComponent(world, room, Room) || hasComponent(world, room, Removed)
      || !hasComponent(world, room, Name) || !Name.value[room]?.trim()) throw new Error("Entity placement/routes require existing named rooms");
  }
  if (spec.connectToRoomEids?.length) assertRoomRouteAuthoringAllowed(world);
  if (objectSpawn) {
    const eid = new ObjectManager(world).spawn(objectSpawn.typeId,{...objectSpawn.options,containedIn:spec.roomEid});
    if(eid === null) throw new Error("Typed object construction failed its native preflight");
    return eid;
  }
  return materializePreparedEntity(world, spec, requested, plan);
}

/** Pure definition preflight. A containing room may be created by a larger
 * blueprint later; actual placement/routes are checked again at allocation. */
export function prepareMaterializedEntityDefinition(spec: MaterializedEntitySpec) {
  if (!spec || typeof spec.name !== "string" || !spec.name.trim() || spec.name.length > 200 || typeof spec.description !== "string" || spec.description.length > 4000)
    throw new Error("Entity requires a bounded name and description");
  if (!["agent", "object", "room", "stimulus_source"].includes(spec.type) || !Array.isArray(spec.components) || spec.components.length > 32)
    throw new Error("Invalid entity type or component list");
  if(spec.past !== undefined) {
    if(spec.type!=="agent")throw new Error("Only new agents may have a private past");
    characterPastSchema.parse(spec.past);
  }
  const requested = new Map<string, Record<string, unknown>>();
  for (const component of spec.components) {
    if (!component || typeof component.name !== "string" || !component.values || typeof component.values !== "object" || Array.isArray(component.values)) throw new Error("Invalid component values");
    assertParticipantComponentAuthoringAllowed(component.name);
    if (requested.has(component.name)) throw new Error(`Duplicate component ${component.name}`);
    requested.set(component.name, { ...component.values });
  }
  const defaults: Record<string, Record<string, unknown>> = {
    Name: { value: spec.name }, Description: { value: spec.description },
    ...(spec.type === "stimulus_source" ? { StimulusSource: { stimulusType: "environmental", template: `${spec.name} hums softly.`, interval: 12000, lastEmit: 0 } } : {}),
  };
  for (const [name, values] of Object.entries(defaults)) requested.set(name, { ...values, ...requested.get(name) });
  if (requested.get("Name")?.value !== spec.name || requested.get("Description")?.value !== spec.description) throw new Error("Entity identity conflicts with proposed components");
  if (spec.type !== "agent" && requested.has("Agent") || spec.type !== "room" && requested.has("Room")) throw new Error("Entity type conflicts with its components");
  const typeId=requested.get("ObjectType")?.typeId;
  let objectSpawn:{typeId:string;options:SpawnOptions}|undefined;
  let objectComponents:ReturnType<typeof ObjectManager.prepareComponentSpecs>|undefined;
  if(spec.type === "object" && typeId !== undefined) {
    const definition=typeof typeId === "string" ? worldSchema.getObjectType(typeId) : undefined;
    if(!definition) throw new Error(`Unknown registered object type: ${String(typeId)}`);
    const instanceName=requested.get("ObjectType")?.instanceName;
    if(instanceName !== undefined && instanceName !== spec.name) throw new Error("Object type identity conflicts with entity name");
    const state=requested.get("ObjectState")?.current ?? definition.defaultState;
    if(typeof state !== "string" || !Object.hasOwn(definition.states,state)) throw new Error("Unknown initial state for registered object type");
    requested.set("ObjectType",{...requested.get("ObjectType"),typeId,instanceName:spec.name});
    const options:SpawnOptions={name:spec.name,description:spec.description,state,components:Object.fromEntries(requested)};
    objectComponents=ObjectManager.prepareComponentSpecs(definition,options.components);
    objectSpawn={typeId:typeId as string,options};
  }
  const plan = objectSpawn ? [] : [...requested].map(([name, values]) => {
    const entry = getRegistryEntry(name);
    if (!entry?.definition) throw new Error(`Unknown component ${name}`);
    const initial = validateComponentInitialValues(entry.definition, values);
    return { name, soa: entry.soa, initial };
  });
  return { requested, plan, objectSpawn, objectComponents };
}

function materializePreparedEntity(world: World, spec: MaterializedEntitySpec,
  requested: ReturnType<typeof prepareMaterializedEntityDefinition>["requested"], plan: ReturnType<typeof prepareMaterializedEntityDefinition>["plan"]): number {
  const eid = allocateWorldEntity(world, spec.type);
  const connected: number[] = [];
  try {
    if (spec.type === "agent") initializeAgentEntity(world, eid, {
      name: spec.name, description: spec.description, roomId: spec.roomEid,
      role: (requested.get("Agent")?.role as string | undefined) ?? "resident",
      systemPrompt: (requested.get("Agent")?.systemPrompt as string | undefined) ?? `You are ${spec.name}, an autonomous person in this world.`,
      past: spec.past,
    });
    if (spec.type === "room") initializeRoomEntity(world, eid, {
      name: spec.name, description: spec.description,
      x: requested.get("Position")?.x as number | undefined,
      y: requested.get("Position")?.y as number | undefined,
    });
    if (spec.type === "object") initializeObjectEntity(world, eid, {
      name:spec.name, description:spec.description, roomId:spec.roomEid,
      material:requested.get("PhysicalObject")?.material as string | undefined,
      weight:requested.get("PhysicalObject")?.weight as number | undefined,
      portable:requested.get("PhysicalObject")?.portable as boolean | undefined,
    });
    for (const { name, soa, initial } of plan) {
      // Canonical constructors already supply complete defaults. A partial
      // override must not zero unrelated fields (e.g. inventory carrying capacity).
      const values = hasComponent(world, eid, soa) ? requested.get(name)! : initial;
      addComponent(world, eid, soa);
      for (const [field, value] of Object.entries(values)) {
        // The constructor already applied the requested persona plus private
        // biography. A generic component override must not erase that history.
        if(spec.type==="agent" && name==="Agent" && field==="systemPrompt")continue;
        soa[field][eid] = value;
      }
    }
    // Initial state overrides are birth data, not an untracked later edit.
    stampObjectStateTime(world, eid);
    if (spec.type !== "room") { setLocatedIn(world, eid, spec.roomEid); if (spec.type === "agent") addComponent(world, eid, OccupiesRoom(spec.roomEid!)); }
    for (const room of spec.connectToRoomEids ?? []) { connectRoomRoute(world, room, eid); connected.push(room); }
    return eid;
  } catch (error) {
    for (const room of connected) { try { disconnectRoomRoute(world, room, eid); } catch { /* Source may have stopped; removal below invalidates traversal. */ } }
    const initialized = new Set([...getEntityComponents(world, eid), ...plan.map(({ soa }) => soa)]);
    removeEntity(world, eid);
    for (const component of initialized) for (const field of Object.values(component))
      if (field && typeof field === "object") delete (field as Record<number, unknown>)[eid];
    if (spec.type === "agent") clearAspirations(world, eid);
    throw error;
  }
}
