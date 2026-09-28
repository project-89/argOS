/** Author requirements precede detailed place design. They describe offered
 * possibilities, never actions the inhabitants must take or accomplished goals. */
import { z } from "zod/v3";
import type { RoomBlueprint } from "./place-materialization";
import { getRegistryEntry } from "../ecs/component-registry";
import { PRIVATE_MANAGED_COMPONENTS } from "./contracts";
import { canonicalBuildJson } from "./build-work-identity";

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
const label=(max:number)=>z.string().trim().min(1).max(max);
const common={id,description:label(400)};
const field=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(value=>!["constructor","prototype","__proto__"].includes(value),"Reserved field");
export const existingPlaceActorSchema=z.object({id,intentionRef:z.string().startsWith("intention:").max(100)}).strict();
export const placeSupportRequirementsSchema=z.array(z.discriminatedUnion("kind",[
  z.object({...common,kind:z.literal("space")}).strict(),
  z.object({...common,kind:z.literal("connection"),roomEid:z.number().int().nonnegative()}).strict(),
  z.object({...common,kind:z.literal("entity"),entityType:z.enum(["agent","object","stimulus_source"]),
    role:label(100).optional(),objectType:label(100).optional()}).strict(),
  z.object({...common,kind:z.literal("existing_actor"),intentionRef:existingPlaceActorSchema.shape.intentionRef}).strict(),
  z.object({...common,kind:z.literal("initial_custody"),item:id,holder:id}).strict(),
  z.object({...common,kind:z.literal("data"),target:id,component:field.refine(name=>!PRIVATE_MANAGED_COMPONENTS.has(name),"Data support cannot require private cognition"),
    fields:z.array(field).min(1).max(16).refine(fields=>new Set(fields).size===fields.length,"Data fields must be distinct")}).strict(),
  z.object({...common,kind:z.literal("interaction"),actor:id,target:id,affordance:label(80)}).strict(),
  z.object({...common,kind:z.literal("system"),name:label(64)}).strict(),
])).min(1).max(24).superRefine((requirements,ctx)=>{
  const ids=requirements.map(r=>r.id);
  if(ids.includes("room")||new Set(ids).size!==ids.length) ctx.addIssue({code:"custom",message:"Support IDs must be distinct; room is reserved"});
  for(const r of requirements) {
    if(r.kind==="data" && r.target!=="room" && !requirements.some(t=>t.id===r.target&&t.kind==="entity"&&t.entityType!=="agent"))
      ctx.addIssue({code:"custom",message:"Data requirements target newly authored physical records, not actors or their private minds"});
    if(r.kind==="entity" && (r.role!==undefined&&r.entityType!=="agent" || r.objectType!==undefined&&r.entityType!=="object"))
      ctx.addIssue({code:"custom",message:"Roles describe agents; objectType describes objects"});
    if(r.kind==="initial_custody") {
      if(!requirements.some(item=>item.id===r.item&&item.kind==="entity"&&item.entityType==="object")
        || !requirements.some(holder=>holder.id===r.holder&&holder.kind==="entity"&&holder.entityType==="agent"))
        ctx.addIssue({code:"custom",message:"Initial custody references a newly authored object and resident, never existing entities"});
      if(requirements.filter(other=>other.kind==="initial_custody"&&other.item===r.item).length!==1)
        ctx.addIssue({code:"custom",message:"Each new object has at most one initial-custody requirement"});
    }
    if(r.kind==="interaction" && (!requirements.some(a=>a.id===r.actor&&(a.kind==="existing_actor"||a.kind==="entity"&&a.entityType==="agent"))
      || r.target!=="room"&&!requirements.some(t=>t.id===r.target&&(t.kind==="entity"||t.kind==="existing_actor"))))
      ctx.addIssue({code:"custom",message:"Support interactions reference declared entity requirements (or target room)"});
  }
});
export type PlaceSupportRequirements=z.infer<typeof placeSupportRequirementsSchema>;

/** The designer can strengthen an incomplete need without silently replacing
 * the first author's contract. These fields are author metadata, not ECS fields.
 * Semantic completeness remains an author judgment; structural discharge and
 * subsequent native use are independently checked by the existing builder. */
export function readPlaceDesignResponse(raw: unknown, base?: PlaceSupportRequirements): {
  blueprint: unknown; requirements?: PlaceSupportRequirements;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { blueprint: raw, requirements: base };
  const record = raw as Record<string, unknown>;
  if (!Object.hasOwn(record, "additionalSupportRequirements") && !Object.hasOwn(record, "unresolvedSupport") && !Object.hasOwn(record, "supportRequirements"))
    return { blueprint: raw, requirements: base }; // Existing direct blueprint API remains valid.
  if (record.type !== "room" || !base) throw new Error("Support amendments require a room with a predeclared contract");
  const { additionalSupportRequirements = [], unresolvedSupport = [], supportRequirements: echoed, ...blueprint } = record;
  const gaps = z.array(label(400)).max(8).parse(unresolvedSupport);
  if (gaps.length) throw new Error("Place design reports unresolved support; revise the need before construction");
  const additions = z.array(z.unknown()).max(24).parse(additionalSupportRequirements);
  const echoedRequirements = echoed === undefined ? undefined : placeSupportRequirementsSchema.parse(echoed);
  if (echoedRequirements && base.some(original => {
    const repeated = echoedRequirements.find(requirement => requirement.id === original.id);
    return !repeated || canonicalBuildJson(repeated) !== canonicalBuildJson(original);
  })) throw new Error("A repeated support contract must preserve every original requirement unchanged");
  // A full contract echo is common model output. Accept identical originals in
  // any key/array order, retain our originals, and admit only genuinely new IDs.
  const echoedAdditions = echoedRequirements?.filter(requirement => !base.some(original => original.id === requirement.id)) ?? [];
  // Parsing the union also validates cross-references and duplicate IDs. No
  // replacement, deletion or redefinition of an original requirement is possible.
  const requirements = placeSupportRequirementsSchema.parse([...base, ...echoedAdditions, ...additions]);
  return { blueprint, requirements };
}

export const PLACE_SUPPORT_SCHEMA_INSTRUCTIONS=`Each requirement has a distinct id and description, plus one of:
- kind: "space" for a deliberately empty usable space.
- kind: "connection", roomEid: an observed existing room.
- kind: "entity", entityType: "agent" | "object" | "stimulus_source"; optionally role for an agent or objectType for an object. Use separate IDs for independently needed people/props.
- kind: "existing_actor", intentionRef: an exact current intention reference also included in this need's evidence. This binds that real NPC (such as the visitor), without creating a substitute or moving them. Use one ID per existing person.
- kind: "initial_custody", item: a new object requirement ID, holder: a new agent requirement ID. When a purpose depends on receiving a resident's stock, declare who starts with each item; the design must set that object's carriedBy to this holder and make it portable within inventory capacity. Loose props plus a profession do not establish this dependency. This is initial state, not a promised handoff, ownership law or replenishment rule; later choices and consumption remain native outcomes.
- kind: "data", target: a new non-agent entity requirement ID or "room", component: a registered non-private component, fields: 1–16 distinct field names. The design must explicitly supply nonempty strings, finite numbers or booleans in those real component fields. This checks data presence/type, not factual accuracy or successful use.
- kind: "interaction", actor: a new or existing agent requirement ID, target: a new/existing entity requirement ID or "room", affordance: an actual native interaction name. Use the intended participant's ID, not another person's action as a substitute.
- kind: "system", name: an exact required mechanic name. An absent mechanic must follow validated system construction; naming it does not implement it.`;

export const PLACE_SUPPORT_AUTHORING_INSTRUCTIONS=`For an entity need that requires a NEW ROOM, include supportRequirements before detailed design (1–24 entries). Choose the possibilities needed for the full cited purpose, not merely arrival.
${PLACE_SUPPORT_SCHEMA_INSTRUCTIONS}
For information-dependent work, supply actual readable records and a native read interaction; generic talk and a person's profession do not supply missing data. Use native compositions from the catalog when they fit. New records are authored world content, not previously observed facts or memories. World-changing work needs an actual native effect or managed system, not an ability claimed in a persona. Keep new residents' expertise/disposition separate from knowledge of another actor's private intention.
Rooms are rejected without this contract. Non-room entity needs omit it. Empty transit spaces can require only space/connections; inhabited destinations need their actual people, props and capabilities declared. Outside participants are not constructible residents. These are offered opportunities, not completed actor goals or mandatory behavior. Existing place support status distinguishes unassessed, unavailable, awaiting_presence and available. Awaiting presence is not proof that an interaction will succeed on arrival; a departed resident is not permission to replace them.`;

/** Check only declared field shape/presence; no text interpretation, truth
 * scoring, or return of stored content to the observer. Zero and false are data. */
export function hasPlaceData(component:string,fields:readonly string[],read:(field:string)=>unknown):boolean {
  const definition=getRegistryEntry(component)?.definition;
  if(!definition || PRIVATE_MANAGED_COMPONENTS.has(component)) return false;
  return fields.every(field=>{
    const type=Object.hasOwn(definition.properties,field)?definition.properties[field]:undefined,value=read(field);
    return type==="string"?typeof value==="string"&&!!value.trim():type==="number"?typeof value==="number"&&Number.isFinite(value):type==="boolean"&&typeof value==="boolean";
  });
}

/** Structural discharge only. The author's interpretation of the purpose and
 * the quality of the offered experience still require behavioral evaluation. */
export function validatePlaceSupportDesign(spec:RoomBlueprint,input:unknown):PlaceSupportRequirements {
  const requirements=placeSupportRequirementsSchema.parse(input);
  for(const actor of spec.existingActors ?? []) if(!requirements.some(r=>r.kind==="existing_actor"&&r.id===actor.id&&r.intentionRef===actor.intentionRef))
    throw new Error("Existing place actors must be declared in the original support contract");
  for(const r of requirements) {
    let satisfied=false;
    if(r.kind==="space") satisfied=true;
    if(r.kind==="existing_actor") satisfied=!!spec.existingActors?.some(a=>a.id===r.id&&a.intentionRef===r.intentionRef);
    if(r.kind==="connection") satisfied=!!spec.connectToRoomEids?.includes(r.roomEid);
    if(r.kind==="system") satisfied=!!spec.requiredSystems?.includes(r.name);
    if(r.kind==="initial_custody") satisfied=spec.contents.find(row=>row.id===r.item)?.carriedBy===r.holder;
    if(r.kind==="data") {
      const entity=r.target==="room"?spec:spec.contents.find(row=>row.id===r.target)?.entity;
      const values=entity?.components.find(c=>c.name===r.component)?.values;
      satisfied=!!values && hasPlaceData(r.component,r.fields,field=>Object.hasOwn(values,field)?values[field]:undefined);
    }
    if(r.kind==="interaction") satisfied=!!spec.requiredInteractions?.some(i=>i.actor===r.actor&&i.target===r.target&&i.affordance===r.affordance);
    if(r.kind==="entity") {
      const entity=spec.contents.find(row=>row.id===r.id)?.entity;
      satisfied=entity?.type===r.entityType
        && (r.role===undefined||(entity?.components.find(c=>c.name==="Agent")?.values.role??"resident")===r.role)
        && (r.objectType===undefined||entity?.components.find(c=>c.name==="ObjectType")?.values.typeId===r.objectType);
    }
    if(!satisfied) throw new Error(`Place design does not discharge support requirement ${r.id} (${r.kind})`);
  }
  return requirements;
}
