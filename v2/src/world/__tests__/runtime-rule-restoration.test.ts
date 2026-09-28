import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { WorldSchema, worldSchema, type RuleDefinition } from "../schema";
import { canExecuteRule } from "../runtime-rule-scope";
import { approveRuntimeRuleDefinitions, restoreRuntimeRuleApprovals } from "../runtime-rule-restoration";
import { validateRuleCandidate } from "../../spirits/rule-admission";
import { ObjectManager } from "../object-manager";
import { RulesEngine } from "../rules-engine";

const definition=(name="restore_drying")=>validateRuleCandidate({name,description:"Dry selected cloth",trigger:"tick",
  conditions:[{has:["wet","on_rack"]}],effects:[{action:"remove_trait",params:{trait:"wet"}},{action:"add_trait",params:{trait:"dry"}}]});
function fixture(){const world=createArgosWorld("Trusted rule restore");initializePrefabs(world);startCommittedEvents(world);return world;}
beforeEach(()=>worldSchema.restoreFromJSON(new WorldSchema().toJSON()));
test("save/reload keeps rules inert until exact host approval; native target changes and control does not",()=>{
  const world=fixture(),rules=createSystemRegistry(),objects=new ObjectManager(world);
  const selected=objects.spawn("object",{name:"Cloth on rack"})!,control=objects.spawn("object",{name:"Cloth in hamper"})!;
  objects.addTrait(selected,"wet");objects.addTrait(selected,"on_rack");objects.addTrait(control,"wet");
  const approved=definition(),catalogue=approveRuntimeRuleDefinitions([approved]);worldSchema.defineRule(approved);
  const snapshot=serializeWorld(world,rules);
  stopCommittedEvents(world);
  const restored=fixture();const {oldToNewId}=deserializeWorld(restored,createSystemRegistry(),snapshot);
  const rule=worldSchema.getRule(approved.name)!;expect(canExecuteRule(restored,rule)).toBe(false);
  expect(restoreRuntimeRuleApprovals(restored,catalogue).restored).toEqual([approved.name]);
  const manager=new ObjectManager(restored),engine=new RulesEngine(restored,manager);engine.processTick(1);
  expect(manager.hasTrait(oldToNewId.get(selected)!,"dry")).toBe(true);
  expect(manager.hasTrait(oldToNewId.get(control)!,"wet")).toBe(true);
});
test("restoration preserves disabled state; host enable remains possible",()=>{
  const world=fixture(),rule=definition();rule.enabled=false;const catalogue=approveRuntimeRuleDefinitions([rule]);worldSchema.defineRule(rule);
  restoreRuntimeRuleApprovals(world,catalogue);const restored=worldSchema.getRule(rule.name)!;
  expect(restored.enabled).toBe(false);expect(canExecuteRule(world,restored)).toBe(false);
  restored.enabled=true;expect(canExecuteRule(world,restored)).toBe(true);
  expect(()=>{restored.then[0].params!.trait="changed";}).toThrow();
});
test.each(["altered","unknown","unsupported","duplicate","forged catalogue"])("%s rejects the entire restore batch",variant=>{
  const world=fixture(),first=definition(),second=definition("second_drying");
  const catalogue=approveRuntimeRuleDefinitions([first,second]);
  worldSchema.defineRule(structuredClone(first));worldSchema.defineRule(structuredClone(second));
  if(variant==="altered")worldSchema.getRule(second.name)!.then[0].params!.trait="invented";
  if(variant==="unknown")worldSchema.defineRule(definition("unknown"));
  if(variant==="unsupported")worldSchema.getRule(second.name)!.then[0]={action:"modify_value",params:{component:"Mind",field:"arousal",delta:1}};
  if(variant==="duplicate")worldSchema.getRule(second.name)!.name=first.name;
  expect(()=>restoreRuntimeRuleApprovals(world,variant==="forged catalogue"?structuredClone(catalogue):catalogue)).toThrow();
  expect(canExecuteRule(world,worldSchema.getRule(first.name)!)).toBe(false);
});
test.each(["stop","reset","rewind","task cancellation"])("%s invalidates restored rule authority",async variant=>{
  const world=fixture();world.time.elapsed=100;const rule=definition(),catalogue=approveRuntimeRuleDefinitions([rule]);worldSchema.defineRule(rule);
  const abort=new AbortController();await withSimulationTask(abort.signal,async()=>restoreRuntimeRuleApprovals(world,catalogue));
  const restored=worldSchema.getRule(rule.name)!;expect(canExecuteRule(world,restored)).toBe(true);
  if(variant==="rewind")world.time.elapsed=0;
  else if(variant==="task cancellation")abort.abort();
  else {stopCommittedEvents(world);if(variant==="reset")startCommittedEvents(world);}
  expect(canExecuteRule(world,restored)).toBe(false);
});
test("a copied/restored rule cannot execute in another world or steal a live grant",()=>{
  const first=fixture(),rule=definition(),catalogue=approveRuntimeRuleDefinitions([rule]);worldSchema.defineRule(rule);
  restoreRuntimeRuleApprovals(first,catalogue);const current=worldSchema.getRule(rule.name)!;
  const second=fixture();expect(canExecuteRule(second,current)).toBe(false);
  expect(()=>restoreRuntimeRuleApprovals(second,catalogue)).toThrow(/another world/);
  expect(()=>restoreRuntimeRuleApprovals(first,catalogue)).toThrow(/owning isolated/);
  expect(canExecuteRule(first,current)).toBe(true);
});
test("marker removal and base-name impersonation in snapshots never restore authority",()=>{
  const world=fixture(),schema=new WorldSchema(),rule=definition();delete rule.executionScope;schema.defineRule(rule);
  const data:any=schema.toJSON();data.rules.fire_spreads.then=[{action:"destroy"}];
  worldSchema.restoreFromJSON(data);
  expect(worldSchema.getRule(rule.name)?.executionScope).toBe("lawgiver-runtime");
  expect(canExecuteRule(world,worldSchema.getRule(rule.name)!)).toBe(false);
  expect(canExecuteRule(world,worldSchema.getRule("fire_spreads")!)).toBe(false);
});
test("approval rejects duplicate and incomplete native definitions",()=>{
  const rule=definition();expect(()=>approveRuntimeRuleDefinitions([rule,rule])).toThrow(/Duplicate/);
  expect(()=>approveRuntimeRuleDefinitions([{...rule,extra:"ignored"} as RuleDefinition])).toThrow(/incomplete/);
  expect(()=>approveRuntimeRuleDefinitions([{...rule,when:{...rule.when,event:"invented"}}])).toThrow();
});
test("approved spawn cannot inherit a changed object capability from a save",()=>{
  const world=fixture(),rule=validateRuleCandidate({name:"restore_spawn",description:"Spawn plain props",trigger:"tick",conditions:[],
    effects:[{action:"spawn",params:{typeId:"object"}}]});
  const catalogue=approveRuntimeRuleDefinitions([rule]);worldSchema.defineRule(rule);
  worldSchema.defineObjectType({...worldSchema.getObjectType("object")!,traits:["changed_spawn_capability"]});
  expect(()=>restoreRuntimeRuleApprovals(world,catalogue)).toThrow(/capabilities/);
  expect(canExecuteRule(world,rule)).toBe(false);
});
