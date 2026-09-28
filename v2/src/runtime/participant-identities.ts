/** Remote participants exist without bodies. Names resolve identity conflicts,
 * not presence: only a host-held, one-shot grant can delegate an NPC avatar. */
import { randomUUID } from "node:crypto";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { ExternalParticipant, ParticipantEmbodiment, WorkingMemoryIdentity, Agent, Removed, Name } from "../ecs/components";
import { getCommittedEvents, startCommittedEvents } from "./committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "./task-scope";

const canonical = (name:string) => name.normalize("NFKC").trim().replace(/\s+/gu," ").toLocaleLowerCase("en-US");
const protectedNames = new Set(["ExternalParticipant","ParticipantEmbodiment"]);
export function assertParticipantComponentAuthoringAllowed(name:string) {
  if(protectedNames.has(name)) throw new Error("Participant identity and embodiment require host authority");
}
/** Generic author tools must not bypass constructors by renaming/adding Agent. */
export function assertParticipantMutationAllowed(world:World,eid:number,component:string,values:Record<string,unknown> = {}) {
  assertParticipantComponentAuthoringAllowed(component);
  if(hasComponent(world,eid,ExternalParticipant)) throw new Error("External participant metadata requires host authority");
  if(component === "Agent" && !hasComponent(world,eid,Agent)) assertAgentIdentityAvailable(world,Name.value[eid]??"");
  if(component === "Name" && hasComponent(world,eid,Agent) && typeof values.value === "string" && values.value!==Name.value[eid])
    assertAgentIdentityAvailable(world,values.value);
}
function records(world:World) {
  const ids=[...query(world,[ExternalParticipant])].filter(eid=>!hasComponent(world,eid,Removed));
  if(ids.length>256) throw new Error("External participant identity bound exceeded");
  const seen=new Set<string>();
  return ids.map(eid=>{
    const id=ExternalParticipant.id[eid],name=ExternalParticipant.displayName[eid],revision=ExternalParticipant.revision[eid];
    let aliases:unknown; try {aliases=JSON.parse(ExternalParticipant.aliasesJson[eid]);} catch {throw new Error("Invalid participant identity aliases");}
    if(!id || seen.has(id) || !name || !Number.isSafeInteger(revision) || revision<1 || !Array.isArray(aliases)
      || aliases.length<1 || aliases.length>32 || aliases.some(a=>typeof a!=="string" || !a.trim() || a.length>200)
      || !aliases.some(a=>canonical(a)===canonical(name))) throw new Error("Invalid or ambiguous participant identity record");
    seen.add(id);return {eid,id,name,revision,aliases:aliases as string[]};
  });
}
/** Trusted contact/channel setup. Metadata is persisted ECS, not a world entity
 * construction admission. Retain old labels so delayed work cannot evade a rename. */
export function registerExternalParticipant(world:World,id:string,name:string):void {
  assertSimulationTaskActive();
  if(typeof id!=="string" || !id.trim() || id.length>200 || typeof name!=="string" || !name.trim() || name.length>200)
    throw new Error("A bounded participant ID and display name are required");
  name=name.trim();
  const all=records(world),old=all.find(r=>r.id===id);
  const aliases=old?[...old.aliases]:[];
  if(!aliases.some(a=>canonical(a)===canonical(name))) aliases.push(name);
  if(aliases.length>32 || !old && all.length>=256) throw new Error("External participant identity bound exceeded");
  if(old?.name===name) return;
  const eid=old?.eid ?? addEntity(world);
  addComponent(world,eid,ExternalParticipant);
  ExternalParticipant.id[eid]=id;ExternalParticipant.displayName[eid]=name;
  ExternalParticipant.aliasesJson[eid]=JSON.stringify(aliases);ExternalParticipant.revision[eid]=(old?.revision??0)+1;
}
export function getExternalParticipants(world:World) {
  return records(world).map(({id,name,aliases})=>({id,name,aliases:[...aliases],presence:"outside_world" as const,
    delegatedAvatars:[...query(world,[Agent,ParticipantEmbodiment,WorkingMemoryIdentity])].filter(eid=>
      !hasComponent(world,eid,Removed) && ParticipantEmbodiment.participantId[eid]===id
      && ParticipantEmbodiment.ownerKey[eid]===WorkingMemoryIdentity.id[eid]).map(eid=>({eid,key:WorkingMemoryIdentity.id[eid]}))}));
}
declare const permitBrand:unique symbol;
export type ParticipantEmbodimentGrant = Readonly<{[permitBrand]:true}>;
type Grant={world:World;source:string;record:string;participantId:string;name:string;signal:AbortSignal|undefined;used:boolean};
const grants=new WeakMap<object,Grant>();
/** Host API only. No God/spirit/model tool exposes this function or token. This
 * authorizes an autonomous delegate, not control of the remote person's actions. */
export function authorizeParticipantEmbodiment(world:World,participantId:string):ParticipantEmbodimentGrant {
  assertSimulationTaskActive();
  const record=records(world).find(r=>r.id===participantId),tape=getCommittedEvents(world);
  if(!record || tape.stopped) throw new Error("Participant identity/source unavailable");
  const token=Object.freeze({}) as ParticipantEmbodimentGrant;
  grants.set(token,{world,source:tape.sourceId??startCommittedEvents(world),record:JSON.stringify(record),participantId,
    name:record.name,signal:getSimulationTaskSignal(),used:false});
  return token;
}
function currentGrant(world:World,name:string,token:ParticipantEmbodimentGrant,consumed=false):Grant {
  const grant=token && typeof token==="object"?grants.get(token):undefined,tape=getCommittedEvents(world);
  const record=grant&&records(world).find(r=>r.id===grant.participantId);
  if(!grant || grant.world!==world || grant.used!==consumed || grant.signal?.aborted || tape.stopped || tape.sourceId!==grant.source
    || !record || JSON.stringify(record)!==grant.record || canonical(name)!==canonical(grant.name)
    || getExternalParticipants(world).find(r=>r.id===grant.participantId)?.delegatedAvatars.length)
    throw new Error("Participant embodiment grant is unavailable, stale or already used");
  return grant;
}
export function assertAgentIdentityAvailable(world:World,name:string,grant?:ParticipantEmbodimentGrant):void {
  assertSimulationTaskActive();
  if(grant!==undefined) {currentGrant(world,name,grant);return;}
  if(records(world).some(r=>r.aliases.some(a=>canonical(a)===canonical(name))))
    throw new Error(`Outside participant identity conflicts with new actor '${name}'; use a distinct new resident or explicit host-authorized embodiment`);
}
/** Constructor-only handoff. Consume before mutation; failures do not mint a
 * retry permission. The returned closure retains the exact source/identity. */
export function beginParticipantEmbodiment(world:World,name:string,token?:ParticipantEmbodimentGrant):(eid:number)=>void {
  if(token===undefined) return ()=>assertAgentIdentityAvailable(world,name);
  currentGrant(world,name,token).used=true;
  let finished=false;
  return eid=>{
    if(finished) throw new Error("Participant embodiment construction already finished");
    finished=true;
    const grant=currentGrant(world,name,token,true);
    if(!hasComponent(world,eid,Agent)) throw new Error("Participant embodiment requires an actual agent");
    const key=hasComponent(world,eid,WorkingMemoryIdentity)?WorkingMemoryIdentity.id[eid]:undefined;
    addComponent(world,eid,WorkingMemoryIdentity);
    WorkingMemoryIdentity.id[eid] = key || `entity:${randomUUID()}`;
    addComponent(world,eid,ParticipantEmbodiment);
    ParticipantEmbodiment.participantId[eid]=grant.participantId;
    ParticipantEmbodiment.ownerKey[eid]=WorkingMemoryIdentity.id[eid];
  };
}
