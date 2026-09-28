/** A bounded authoring blueprint, not a second world. Receipts retain what was
 * constructed; current availability is always read from the real ECS/services. */
import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { entityExists, getRelationTargets, hasComponent, query, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { getRegistryEntry } from "../ecs/component-registry";
import { Agent, ExternalParticipant, GodAgent, Room, Name, Removed, ObjectType, PhysicalObject, StimulusSource, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { DEFAULT_INVENTORY_LIMITS, tryAddToInventory } from "../ecs/inventory";
import { AdjacentTo } from "../ecs/relations";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { assertWorldConstructionAvailable } from "../runtime/world-construction-budget";
import { captureEntityMaterializationScope } from "./entity-materialization-scope";
import { materializationRoomDependencies, materializeApprovedEntity, prepareMaterializedEntityDefinition,
  type MaterializedEntitySpec } from "./entity-materialization";
import { getAvailableAffordances } from "../world/affordance-availability";
import { connectRoomRoute, isRoomRouteTopologyCurrent } from "../runtime/room-routes";
import { assertAgentIdentityAvailable } from "../runtime/participant-identities";
import { existingPlaceActorSchema, hasPlaceData, validatePlaceSupportDesign, type PlaceSupportRequirements } from "./place-support";
import { characterPastSchema } from "../cognition/character-past-schema";

const text = (max:number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
const scalar = z.union([z.string().max(4000),z.number().finite(),z.boolean()]);
const component = z.object({ name:text(64), values:z.record(scalar) }).strict();
const fields = { name:text(200), description:z.string().max(4000), components:z.array(component).max(32), past:characterPastSchema.optional() };
export const roomBlueprintSchema = z.object({
  ...fields, type:z.literal("room"), connectToRoomEids:z.array(z.number().int().nonnegative()).max(8).optional(),
  contents:z.array(z.object({ id, carriedBy:id.optional(), entity:z.object({ ...fields, type:z.enum(["agent","object","stimulus_source"]) }).strict() }).strict()).max(12),
  existingActors:z.array(existingPlaceActorSchema).max(8).optional(),
  requiredSystems:z.array(text(64)).max(6).optional(),
  requiredInteractions:z.array(z.object({ actor:id, target:id, affordance:text(80) }).strict()).max(12).optional(),
}).strict().superRefine((value,ctx) => {
  const ids = [...value.contents.map(row=>row.id),...(value.existingActors ?? []).map(row=>row.id)];
  if (ids.includes("room") || new Set(ids).size !== ids.length) ctx.addIssue({ code:"custom", message:"Content IDs must be distinct; room is reserved" });
  const refs=(value.existingActors ?? []).map(a=>a.intentionRef);
  if(new Set(refs).size!==refs.length) ctx.addIssue({code:"custom",message:"An existing actor reference has one local ID"});
  const names=[value.name,...value.contents.map(row=>row.entity.name)].map(name=>name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({code:"custom",message:"Blueprint entity names must be distinct"});
  const systems = value.requiredSystems ?? [];
  for (const row of value.contents) if (row.carriedBy !== undefined && (row.entity.type !== "object"
    || !value.contents.some(holder=>holder.id===row.carriedBy && holder.entity.type==="agent")))
    ctx.addIssue({code:"custom",message:"Initial custody requires a new object and a new resident's local content ID"});
  if (new Set(systems).size !== systems.length) ctx.addIssue({ code:"custom", message:"Required system names must be distinct" });
  for (const r of value.requiredInteractions ?? []) {
    if (!(value.contents.some(row=>row.id === r.actor && row.entity.type === "agent") || value.existingActors?.some(a=>a.id===r.actor)) || r.target !== "room" && !ids.includes(r.target))
      ctx.addIssue({ code:"custom", message:"Interaction requirements reference a new or bound existing actor and target by local ID" });
  }
});
export type RoomBlueprint = z.infer<typeof roomBlueprintSchema>;
export type EntityBlueprint = MaterializedEntitySpec | RoomBlueprint;
type Member = { id:string; eid:number; key:string; name:string; type:MaterializedEntitySpec["type"] };
/** Trusted native dependency, never accepted from model JSON. The architect
 * resolves it only from a cited captured intention and retains its demand guard. */
export type PlaceActorReference=Readonly<{world:World;sourceId:string;eid:number;key:string;name:string}>;
type ExistingActor=Member & {intentionRef:string};
type InitialCustody = { item:string; holder:string; itemKey:string; holderKey:string; atSimMs:number };
type Receipt = { id:string; sourceId:string; name:string; phase:"constructing"|"constructed"|"failed";
  members:Member[]; expected:string[]; routes:Array<{eid:number;key:string}>; error?:string;
  existingActors:ExistingActor[];
  initialCustody:InitialCustody[];
  supportRequirements?:PlaceSupportRequirements;
  requiredSystems:string[]; requiredInteractions:NonNullable<RoomBlueprint["requiredInteractions"]> };
const receipts = new WeakMap<World,Receipt[]>();
const LIMIT = 64;

export function hasPlaceBlueprint(spec: EntityBlueprint): spec is RoomBlueprint {
  return !!spec && typeof spec === "object" && ("contents" in spec || "existingActors" in spec || "requiredSystems" in spec || "requiredInteractions" in spec);
}

/** New model-authored designs make assembly and object kind explicit. Native
 * host constructors retain their smaller legacy specs; an intentionally empty
 * room is valid, but an omitted manifest is not a populated place. */
export function validateAuthoredEntityBlueprint(input: unknown): EntityBlueprint {
  const value = input && typeof input === "object" && "type" in input && input.type === "room"
    ? validatePlaceBlueprint(input)
    : z.object({ ...fields, type:z.enum(["agent","object","stimulus_source"]),
      roomEid:z.number().int().nonnegative() }).strict().parse(input);
  const members = hasPlaceBlueprint(value) ? value.contents.map(row => row.entity) : [value];
  for (const member of members) {
    if (member.type === "object" && typeof member.components.find(c => c.name === "ObjectType")?.values.typeId !== "string")
      throw new Error("Authored objects require an explicit registered ObjectType.typeId; use object for a deliberately generic prop");
    prepareMaterializedEntityDefinition(member);
  }
  return value;
}

/** Parse/validate every member before the first allocation. A malformed final
 * member must not leave an empty restaurant behind as apparent success. */
export function validatePlaceBlueprint(input: unknown): RoomBlueprint {
  const value = roomBlueprintSchema.parse(input);
  prepareMaterializedEntityDefinition(value);
  materializationRoomDependencies(value);
  const schemas=new Map<string,string>();
  const loads=new Map<string,{slots:number;weight:number}>();
  for (const row of value.contents) {
    const prepared=prepareMaterializedEntityDefinition(row.entity);
    if(row.carriedBy) {
      const physical=prepared.objectComponents?.find(p=>p.definition.name==="PhysicalObject")?.values ?? prepared.requested.get("PhysicalObject");
      const weight=physical?.weight ?? 1;
      if(physical?.portable!==true || typeof weight!=="number" || !Number.isFinite(weight) || weight<0)
        throw new Error("Initially carried stock requires explicit PhysicalObject.portable=true and a valid weight");
      const load=loads.get(row.carriedBy) ?? {slots:0,weight:0};
      load.slots++; load.weight+=weight; loads.set(row.carriedBy,load);
    }
    for(const plan of prepared.objectComponents ?? []) {
      const shape=JSON.stringify(Object.entries(plan.definition.properties).sort(([a],[b])=>a.localeCompare(b)));
      if(schemas.has(plan.definition.name) && schemas.get(plan.definition.name)!==shape)
        throw new Error(`Conflicting object component schema ${plan.definition.name} within place`);
      schemas.set(plan.definition.name,shape);
    }
  }
  for(const [holder,load] of loads) {
    const inventory=value.contents.find(row=>row.id===holder)!.entity.components.find(c=>c.name==="Inventory")?.values;
    if(load.slots>Number(inventory?.maxSlots ?? DEFAULT_INVENTORY_LIMITS.maxSlots)
      || load.weight>Number(inventory?.maxWeight ?? DEFAULT_INVENTORY_LIMITS.maxWeight))
      throw new Error("Authored stock exceeds its new resident's inventory capacity");
  }
  return value;
}

/** The optional progress value comes from this constructor after allocation,
 * never from a model specification. It permits only this place's own routes. */
export type PlaceConstructionCurrent = (room?: Readonly<{ eid:number; key:string }>) => boolean;
export function materializePlaceBlueprint(world:World, input:unknown,
  demandCurrent:PlaceConstructionCurrent = ()=>true, supportRequirements?:PlaceSupportRequirements,
  actorReferences:ReadonlyMap<string,PlaceActorReference> = new Map()): { roomEid:number; receiptId:string } {
  assertSimulationTaskActive();
  const value = validatePlaceBlueprint(input), tape = getCommittedEvents(world), signal = getSimulationTaskSignal();
  const support=supportRequirements===undefined ? undefined : validatePlaceSupportDesign(value,supportRequirements);
  for(const row of value.contents) if(row.entity.type === "agent") assertAgentIdentityAvailable(world,row.entity.name);
  if (tape.stopped) throw new Error("Cannot construct a place on a stopped source");
  const sourceId = tape.sourceId ?? startCommittedEvents(world);
  if(actorReferences.size!==(value.existingActors ?? []).length) throw new Error("Existing place actors require exact native observation bindings");
  const existingActors:ExistingActor[]=(value.existingActors ?? []).map(actor=>{
    const ref=actorReferences.get(actor.intentionRef);
    if(!ref || ref.world!==world || ref.sourceId!==sourceId) throw new Error("Existing actor observation belongs to a different world/source or is missing");
    return {...actor,eid:ref.eid,key:ref.key,name:ref.name,type:"agent"};
  });
  if(new Set(existingActors.map(a=>a.eid)).size!==existingActors.length) throw new Error("One existing person cannot stand in for multiple independent participants");
  const actorsCurrent=()=>existingActors.every(actor=>existingActorCurrent(world,actor));
  const dependencies = materializationRoomDependencies(value);
  const physicalCurrent = captureEntityMaterializationScope(world,dependencies).bind(value);
  let constructedRoom: Readonly<{eid:number;key:string}> | undefined;
  const current = () => !signal?.aborted && actorsCurrent() && physicalCurrent() && demandCurrent(constructedRoom) && !signal?.aborted && actorsCurrent() && physicalCurrent();
  if (!current()) throw new Error("Place authoring source/demand is stale");
  const names=new Set([value.name,...value.contents.map(row=>row.entity.name)].map(name=>name.toLowerCase()));
  for (const eid of query(world,[Name])) if (names.has(Name.value[eid]?.trim().toLowerCase()))
    throw new Error(`Place construction would duplicate existing entity ${Name.value[eid]}; inspect and adapt to current work`);
  let rows = receipts.get(world); if (!rows) { rows=[]; receipts.set(world,rows); }
  if (rows.length >= LIMIT) throw new Error("Place receipt limit reached; history cannot be silently evicted");
  assertWorldConstructionAvailable(world,1+value.contents.length);
  const receipt:Receipt = { id:`place:${randomUUID()}`,sourceId,name:value.name,phase:"constructing",members:[],
    supportRequirements:support,existingActors,initialCustody:[],
    expected:["room",...value.contents.map(row=>row.id)], routes:dependencies.map(eid=>({eid,key:workingMemoryEntityRef(world,eid)!.key})),
    requiredSystems:value.requiredSystems ?? [], requiredInteractions:value.requiredInteractions ?? [] };
  rows.push(receipt);
  const remember = (id:string,eid:number,type:Member["type"]) => {
    const ref=workingMemoryEntityRef(world,eid); if (!ref) throw new Error("Constructed entity identity unavailable");
    receipt.members.push({id,eid,key:ref.key,name:ref.label,type});
  };
  const intact = () => receipt.members.every(member => memberCurrent(world,member)
    && (member.id === "room" || getRoomForEntity(world,member.eid) === receipt.members[0]?.eid));
  try {
    // Publish connectivity last. The partial room is real, but no route claims
    // a complete usable place before all native content has been constructed.
    const roomEid=materializeApprovedEntity(world,{name:value.name,description:value.description,type:"room",components:value.components}); remember("room",roomEid,"room");
    constructedRoom=Object.freeze({eid:roomEid,key:receipt.members[0].key});
    for (const row of value.contents) {
      if (!current() || !intact()) throw new Error("Place authoring source/demand or constructed membership changed");
      const eid=materializeApprovedEntity(world,{...row.entity,roomEid}); remember(row.id,eid,row.entity.type);
    }
    // Initial assembly only; never replay this manifest as a repair of later
    // possession changes. Only entities allocated by this receipt participate.
    for(const row of value.contents) if(row.carriedBy) {
      if(!current() || !intact()) throw new Error("Place changed during stock assembly");
      const item=receipt.members.find(m=>m.id===row.id)!, holder=receipt.members.find(m=>m.id===row.carriedBy)!;
      if(!PhysicalObject.portable[item.eid]) throw new Error("Authored stock is not portable");
      const result=tryAddToInventory(world,holder.eid,item.eid);
      if(!result.success) throw new Error(`Initial stock custody failed: ${result.reason}`);
      if(!current() || !intact() || getDirectContainer(world,item.eid)!==holder.eid)
        throw new Error("Initial stock custody changed during native assembly");
      receipt.initialCustody.push({item:row.id,holder:row.carriedBy,itemKey:item.key,holderKey:holder.key,atSimMs:world.time.elapsed});
    }
    if (!current() || !intact()) throw new Error("Place authoring source/demand or constructed membership changed");
    for (const route of dependencies) {
      if (!current() || !intact()) throw new Error("Place changed during route construction");
      connectRoomRoute(world,route,roomEid);
    }
    if (!current() || !intact() || dependencies.some(route => !routeConnected(world,roomEid,route))) throw new Error("Place changed during route construction");
    receipt.phase="constructed";
    return {roomEid,receiptId:receipt.id};
  } catch(error) {
    receipt.phase="failed"; receipt.error=String(error).slice(0,500);
    // Retain actual partial work and its identity. Do not delete unrelated
    // reentrant creations or refund consumed construction admissions.
    throw error;
  }
}

function routeConnected(world:World,from:number,to:number): boolean {
  return isRoomRouteTopologyCurrent(world) && entityExists(world,to) && hasComponent(world,to,Room)
    && !hasComponent(world,to,Removed) && getRelationTargets(world,from,AdjacentTo).includes(to)
    && getRelationTargets(world,to,AdjacentTo).includes(from);
}

function memberCurrent(world:World,member:Member): boolean {
  const type = member.type === "room" ? Room : member.type === "agent" ? Agent : member.type === "object" ? PhysicalObject : StimulusSource;
  return entityExists(world,member.eid) && !hasComponent(world,member.eid,Removed) && hasComponent(world,member.eid,type)
    && hasComponent(world,member.eid,WorkingMemoryIdentity) && WorkingMemoryIdentity.id[member.eid] === member.key
    && Name.value[member.eid] === member.name;
}

function existingActorCurrent(world:World,actor:Member):boolean {
  const room=getRoomForEntity(world,actor.eid);
  return memberCurrent(world,actor) && !!Agent.active[actor.eid]
    && !hasComponent(world,actor.eid,ExternalParticipant) && !hasComponent(world,actor.eid,GodAgent) && !hasComponent(world,actor.eid,Prefab)
    && room!==undefined && entityExists(world,room) && hasComponent(world,room,Room) && !hasComponent(world,room,Removed);
}

/** Author/operator observation only. Construction is historical; readyNow is a
 * current availability check, not proof of an NPC's choices or a mechanic's
 * behavioral correctness. A departed resident is not an order to replace them. */
export function getPlaceBuildStatus(world:World,registry:SystemRegistry) {
  const source=getCommittedEvents(world);
  return (receipts.get(world) ?? []).map(receipt => {
    const currentSource=!source.stopped && source.sourceId === receipt.sourceId;
    const members=receipt.members.map(member=>{
      const current=memberCurrent(world,member);
      return {...member,current,roomEid:current ? getRoomForEntity(world,member.eid) : undefined};
    });
    const existingActors=receipt.existingActors.map(actor=>{
      const current=existingActorCurrent(world,actor);
      return {...actor,current,roomEid:current ? getRoomForEntity(world,actor.eid) : undefined};
    });
    const participants=[...members,...existingActors];
    const root=members.find(member=>member.id === "room");
    const unmet:string[]=[];
    const awaitingPresence=existingActors.filter(a=>currentSource && receipt.phase==="constructed" && a.current && root?.current && a.roomEid!==root.eid).map(a=>a.id);
    if (!currentSource) unmet.push("source_unavailable");
    if (receipt.phase !== "constructed") unmet.push(`assembly:${receipt.phase}`);
    for(const actor of existingActors) if(!actor.current) unmet.push(`existing_actor:${actor.id}`);
    for (const id of receipt.expected) {
      const member=members.find(m=>m.id === id);
      if (!member?.current) unmet.push(`member:${id}`);
      else if (member.type === "agent" && !Agent.active[member.eid]) unmet.push(`inactive_actor:${id}`);
    }
    for (const route of receipt.routes) if (!entityExists(world,route.eid) || WorkingMemoryIdentity.id[route.eid] !== route.key
      || !root?.current || !routeConnected(world,root.eid,route.eid)) unmet.push(`route:${route.eid}`);
    for (const name of receipt.requiredSystems) {
      const system=registry.systems.get(name);
      if (!system?.active || !system.compiledFn || system.managedRestorePending || (system.consecutiveErrors ?? 0)>0) unmet.push(`system:${name}`);
    }
    const interactions=receipt.requiredInteractions.map(r=>{
      const actor=participants.find(m=>m.id===r.actor),target=participants.find(m=>m.id===r.target);
      let status:"available"|"awaiting_presence"|"unavailable"="unavailable";
      try {
        const pair=[actor,target];
        if(currentSource && receipt.phase==="constructed" && root?.current && pair.every(p=>p?.current
          && (p.type!=="agent" || Agent.active[p.eid])
          && (p.type==="room"?p.eid===root.eid:p.roomEid===root.eid||awaitingPresence.includes(p.id)))) {
          // No teleportation or hypothetical capability execution. Only presence
          // is deferred; actual affordance availability is checked on arrival.
          if(pair.some(p=>awaitingPresence.includes(p!.id))) status="awaiting_presence";
          else if(getAvailableAffordances(world,actor!.eid,target!.eid).some(a=>a.name===r.affordance)) status="available";
        }
      } catch { /* An unhealthy capability is unavailable, not a failed observer. */ }
      if(status==="unavailable") unmet.push(`interaction:${r.actor}:${r.target}:${r.affordance}`);
      return {...r,status};
    });
    const supportUnmet: {id:string;reason:string}[]=[];
    for(const r of receipt.supportRequirements ?? []) {
      let reason:string|undefined;
      if(!currentSource || receipt.phase!=="constructed" || !root?.current) reason="place_unavailable";
      else if(r.kind==="connection" && unmet.includes(`route:${r.roomEid}`)) reason="route_unavailable";
      else if(r.kind==="system" && unmet.includes(`system:${r.name}`)) reason="system_unavailable";
      // An initial condition is historical. Transfers and consumption must not
      // turn it into a perpetual inventory invariant or a restocking request.
      else if(r.kind==="initial_custody" && !receipt.initialCustody.some(c=>c.item===r.item&&c.holder===r.holder)) reason="initial_custody_unverified";
      else if(r.kind==="interaction" && unmet.includes(`interaction:${r.actor}:${r.target}:${r.affordance}`)) reason="interaction_unavailable";
      else if(r.kind==="interaction" && interactions.some(i=>i.actor===r.actor&&i.target===r.target&&i.affordance===r.affordance&&i.status==="awaiting_presence")) reason="awaiting_presence";
      else if(r.kind==="existing_actor") {
        if(!existingActors.find(a=>a.id===r.id)?.current) reason="actor_unavailable";
        else if(awaitingPresence.includes(r.id)) reason="awaiting_presence";
      }
      else if(r.kind==="data") {
        const member=members.find(m=>m.id===r.target),component=getRegistryEntry(r.component)?.soa;
        if(!member?.current || !component || !hasComponent(world,member.eid,component)
          || !hasPlaceData(r.component,r.fields,field=>component[field]?.[member.eid])) reason="data_unavailable";
      }
      else if(r.kind==="entity") {
        const member=members.find(m=>m.id===r.id);
        if(!member?.current) reason="member_unavailable";
        else if(member.roomEid!==root.eid) reason="member_elsewhere";
        else if(r.entityType==="agent"&&!Agent.active[member.eid]) reason="member_inactive";
        else if(r.role!==undefined&&Agent.role[member.eid]!==r.role) reason="role_changed";
        else if(r.objectType!==undefined&&(!hasComponent(world,member.eid,ObjectType)||ObjectType.typeId[member.eid]!==r.objectType)) reason="object_type_changed";
      }
      if(reason) supportUnmet.push({id:r.id,reason});
    }
    const support=receipt.supportRequirements===undefined ? {status:"unassessed" as const}
      : {status:supportUnmet.some(r=>r.reason!=="awaiting_presence")||unmet.length ? "unavailable" as const
        : awaitingPresence.length ? "awaiting_presence" as const : "available" as const,
        requirements:structuredClone(receipt.supportRequirements),unmet:supportUnmet,assemblyUnmet:[...unmet]};
    return {id:receipt.id,sourceId:receipt.sourceId,name:receipt.name,phase:receipt.phase,readyNow:unmet.length===0&&!awaitingPresence.length,support,
      members,existingActors,initialCustody:structuredClone(receipt.initialCustody),awaitingPresence,interactions,requiredSystems:[...receipt.requiredSystems],requiredInteractions:structuredClone(receipt.requiredInteractions),unmet,
      ...(receipt.error ? {error:receipt.error} : {})};
  });
}
