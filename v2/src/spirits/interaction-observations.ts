/** Author-only observations of executor failures. A requested target is not
 * proof of an absent entity, a missing mechanic, or permission to replenish it.
 * Raw command content never enters this view or the public event stream. */
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent, Prefab, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Room, Removed, PhysicalObject, ObjectState, Traits, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getAgentWorldCapabilityGeneration } from "../cognition/world-capabilities";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";

const LIMIT=64;
const normalize=(value:string)=>value.trim().toLowerCase();
type Match={eid:number;key:string;kind:"agent"|"room"|"object"|"other";roomId?:number;containerId?:number;state?:string;traits?:string};
type Observation=Readonly<{ref:string;causalKey:string;sourceId:string;actorId:number;actor:string;actorKey:string;
  roomId:number;room:string;action:string;attemptedTarget:string;atSimMs:number;lastAtSimMs:number;attempts:number;matches:readonly Match[]}>;
type Row={value:Observation;current:(allowTravel?:boolean)=>boolean;basisCurrent:(allowTravel?:boolean)=>boolean};
type Store={sourceId:string;rows:Row[];omitted:number};
const stores=new WeakMap<World,Store>();

function matchingEntities(world:World,target:string): Match[] | undefined {
  const ids=Array.from(query(world,[Name])).filter(eid=>!hasComponent(world,eid,Removed) && !hasComponent(world,eid,Prefab)
    && normalize(Name.value[eid] || "")===normalize(target));
  if (ids.length>LIMIT) return; // Never hide additional matching identities behind a truncated precondition.
  return ids.sort((a,b)=>a-b).map(eid=>({eid,key:workingMemoryEntityRef(world,eid)!.key,
      kind:hasComponent(world,eid,Agent)?"agent":hasComponent(world,eid,Room)?"room":hasComponent(world,eid,PhysicalObject)?"object":"other",
      roomId:getRoomForEntity(world,eid),containerId:getDirectContainer(world,eid),
      state:hasComponent(world,eid,ObjectState)?ObjectState.current[eid]:undefined,
      traits:hasComponent(world,eid,Traits)?Traits.active[eid]:undefined}));
}

export function recordUnavailableInteraction(world:World,actor:number,action:string,target:string): void {
  assertSimulationTaskActive();
  const source=getCommittedEvents(world), at=readSimulationTime(world), signal=getSimulationTaskSignal();
  if (!source.sourceId || source.stopped || !Number.isFinite(at) || typeof action!=="string" || !action.trim() || action.length>64
    || typeof target!=="string" || !target.trim() || target.length>200 || !entityExists(world,actor) || !hasComponent(world,actor,Agent)
    || !Agent.active[actor] || hasComponent(world,actor,Removed) || hasComponent(world,actor,Prefab)) return;
  const roomId=getRoomForEntity(world,actor);
  if (roomId===undefined || !hasComponent(world,roomId,Room) || hasComponent(world,roomId,Removed)) return;
  const owner=workingMemoryEntityRef(world,actor), room=workingMemoryEntityRef(world,roomId);
  if (!owner || !room) return;
  let store=stores.get(world);
  if (!store || store.sourceId!==source.sourceId) {store={sourceId:source.sourceId,rows:[],omitted:0};stores.set(world,store);}
  const repeated=store.rows.find(row=>row.value.actorKey===owner.key && row.value.action===action.trim()
    && normalize(row.value.attemptedTarget)===normalize(target) && row.current());
  if (repeated) {
    repeated.value=Object.freeze({...repeated.value,lastAtSimMs:at,attempts:Math.min(Number.MAX_SAFE_INTEGER,repeated.value.attempts+1)});
    return;
  }
  const matches=matchingEntities(world,target);
  if (!matches) {store.omitted++;return;}
  const matchBasis=JSON.stringify(matches), persona=JSON.stringify([Agent.role[actor],Agent.systemPrompt[actor]]);
  const generation=getAgentWorldCapabilityGeneration(world,actor), ref=`interaction:${randomUUID()}`;
  const row:Row={value:Object.freeze({ref,causalKey:ref,sourceId:source.sourceId,actorId:actor,actor:owner.label,actorKey:owner.key,
    roomId,room:room.label,action:action.trim(),attemptedTarget:target.trim(),atSimMs:at,lastAtSimMs:at,attempts:1,matches}),current:()=>false,basisCurrent:()=>false};
  const boundStore=store;
  let basisRevoked=false, locationRevoked=false, matchesRevoked=false;
  row.basisCurrent=(allowTravel=false)=>{
    try {
      const live=getCommittedEvents(world), now=readSimulationTime(world);
      const current=!basisRevoked && !signal?.aborted && stores.get(world)===boundStore && boundStore.rows.includes(row)
        && !live.stopped && live.sourceId===source.sourceId && Number.isFinite(now) && now>=at
        && entityExists(world,actor) && hasComponent(world,actor,Agent) && !hasComponent(world,actor,Removed) && Agent.active[actor]
        && hasComponent(world,actor,WorkingMemoryIdentity) && WorkingMemoryIdentity.id[actor]===owner.key && Name.value[actor]===owner.label
        && JSON.stringify([Agent.role[actor],Agent.systemPrompt[actor]])===persona && getAgentWorldCapabilityGeneration(world,actor)===generation
        && entityExists(world,roomId) && hasComponent(world,roomId,Room) && !hasComponent(world,roomId,Removed)
        && WorkingMemoryIdentity.id[roomId]===room.key && Name.value[roomId]===room.label;
      if (!current) basisRevoked=true;
      if (getRoomForEntity(world,actor)!==roomId) locationRevoked=true;
      return current && (allowTravel || !locationRevoked);
    } catch {basisRevoked=true;return false;}
  };
  row.current=(allowTravel=false)=>{
    try {
      if (!row.basisCurrent(allowTravel)) return false;
      const current=!matchesRevoked && JSON.stringify(matchingEntities(world,target))===matchBasis;
      if (!current) matchesRevoked=true;
      return current;
    } catch {matchesRevoked=true;return false;}
  };
  store.rows.push(row);
  if (store.rows.length>LIMIT) {store.rows.shift();store.omitted++;}
}

/** Immutable snapshots plus opaque binders: copying serialized observations
 * cannot grant another world, source or later proposal permission to write. */
export function captureInteractionObservations(world:World) {
  const store=stores.get(world), rows=store?.rows.filter(row=>row.current()) ?? [];
  const guards=new Map(rows.map(row=>[row.value.ref,row]));
  const records=rows.map(row=>Object.freeze({...row.value,matches:Object.freeze(row.value.matches.map(m=>Object.freeze({...m})))}));
  // Only a caller that also enforces the cited actor's durable goal may opt
  // that actor into travel. The architect derives these keys from its own
  // captured Goal evidence, never from model-provided keys or flags.
  return {records:Object.freeze(records),omitted:store?.omitted ?? 0,bind:(refs:readonly string[],durableActorKeys:readonly string[]=[])=>{
    const selected=refs.filter(ref=>ref.startsWith("interaction:"));
    if (selected.some(ref=>!guards.has(ref))) return;
    return {
      current:()=>selected.every(ref=>{const row=guards.get(ref)!;return row.current(durableActorKeys.includes(row.value.actorKey));}),
      // The native executor consumes the full precondition before its first
      // write. Its own construction may then supply the target; source/actor/
      // room identity and the proposal's separate intention guards still hold.
      duringConstruction:()=>selected.every(ref=>{const row=guards.get(ref)!;return row.basisCurrent(durableActorKeys.includes(row.value.actorKey));}),
    };
  }};
}

export function getInteractionObservations(world:World) {
  const {records,omitted}=captureInteractionObservations(world);return {records,omitted};
}
