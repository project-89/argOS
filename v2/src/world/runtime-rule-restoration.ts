/** Explicit host approval, separate from snapshot data. No snapshot loader calls
 * approveRuntimeRuleDefinitions: the caller must supply its trusted catalogue. */
import { createHash } from "node:crypto";
import type { World } from "../ecs/world";
import { getRegistryWorld } from "../ecs/component-registry";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { validateRuleCandidate } from "../spirits/rule-admission";
import { canonicalBuildJson } from "../engineering/build-work-identity";
import { captureRuleSource, grantRuntimeRule, assertRuntimeRuleRestoreOwnership } from "./runtime-rule-scope";
import { worldSchema, type RuleDefinition } from "./schema";

export type RuntimeRuleApprovalCatalogue = Readonly<{ digest: string; rules: readonly string[] }>;
const approved = new WeakMap<RuntimeRuleApprovalCatalogue, Map<string,{definition:string;capabilities:string}>>();
const shape = (rule: RuleDefinition) => canonicalBuildJson({...rule,enabled:true});
// A trusted spawn rule must not inherit a changed object type from an untrusted
// save. Numeric coordinates are revalidated against the current native registry.
const capabilities = (rule: RuleDefinition) => canonicalBuildJson(rule.then.filter(effect=>effect.action==="spawn")
  .map(effect=>[effect.params!.typeId,worldSchema.getObjectType(effect.params!.typeId)]));

function validateDefinition(input: RuleDefinition): RuleDefinition {
  if (!input || input.executionScope!=="lawgiver-runtime" || typeof input.enabled!=="boolean"
    || Object.keys(input).some(key=>!["name","description","executionScope","when","then","priority","enabled"].includes(key))
    || !input.when || Object.keys(input.when).some(key=>!["event","condition"].includes(key)))
    throw Error("Unknown or incomplete runtime rule definition");
  const validated=validateRuleCandidate({name:input.name,description:input.description,trigger:input.when.event,
    conditions:input.when.condition ? [input.when.condition] : [],effects:input.then,priority:input.priority});
  if(shape(input)!==shape(validated))throw Error("Rule definition differs from its supported native contract");
  return {...validated,enabled:input.enabled};
}

/** Calling this is explicit HOST approval, not proof that supplied JSON is
 * trusted. Persist approved definitions in a host-selected store outside world
 * snapshots, and call this only on that store after restart. Never expose as a
 * model tool or pass snapshot.schema.rules here. Tokens are non-portable. */
export function approveRuntimeRuleDefinitions(definitions: readonly RuleDefinition[]): RuntimeRuleApprovalCatalogue {
  if(!Array.isArray(definitions) || definitions.length>256)throw Error("Bounded host rule catalogue required");
  const entries=new Map<string,{definition:string;capabilities:string}>();
  for(const definition of definitions) {
    const rule=validateDefinition(definition);
    if(entries.has(rule.name))throw Error("Duplicate approved rule name");
    entries.set(rule.name,{definition:shape(rule),capabilities:capabilities(rule)});
  }
  const digest=createHash("sha256").update(canonicalBuildJson([...entries].sort(([a],[b])=>a.localeCompare(b)))).digest("hex");
  const catalogue=Object.freeze({digest,rules:Object.freeze([...entries.keys()])});
  approved.set(catalogue,entries);return catalogue;
}

/** All candidates validate before any grant/registry change. Disabled rules stay
 * disabled. Current capabilities and the isolated world's source are rechecked. */
export function restoreRuntimeRuleApprovals(world: World, catalogue: RuntimeRuleApprovalCatalogue) {
  const entries=approved.get(catalogue),signal=getSimulationTaskSignal();
  if(!entries)throw Error("Host-owned rule approval catalogue required; snapshot/copy is not authority");
  if(getRegistryWorld()!==world)throw Error("Rule restoration requires the owning isolated world; WorldSchema is still a singleton");
  const current=captureRuleSource(world);
  if(!current() || signal?.aborted)throw Error("Rule restore source/task is stopped or stale");
  const seen=new Set<string>();
  const candidates=worldSchema.getAllRules().filter(rule=>rule.executionScope!==undefined).map(rule=>{
    assertRuntimeRuleRestoreOwnership(world,rule);
    const validated=validateDefinition(rule);
    if(seen.has(validated.name))throw Error("Duplicate snapshot rule name");seen.add(validated.name);
    const allowed=entries.get(validated.name);
    if(allowed?.definition!==shape(validated) || allowed.capabilities!==capabilities(validated))
      throw Error(`Rule or capabilities not exactly approved: ${validated.name}`);
    return validated;
  });
  if(!current() || signal?.aborted)throw Error("Rule restore source/task expired");
  for(const rule of candidates) {
    // Protect nested effects while preserving host enable/disable control.
    const freeze=(value:any):void=>{if(value && typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
    for(const [key,value] of Object.entries(rule))if(key!=="enabled") {
      freeze(value);Object.defineProperty(rule,key,{value,writable:false,configurable:false,enumerable:true});
    }
    Object.seal(rule);
    grantRuntimeRule(world,rule,()=>!signal?.aborted && current());
  }
  for(const rule of candidates)worldSchema.defineRule(rule);
  return {digest:catalogue.digest,restored:candidates.map(rule=>rule.name)};
}
