import { addEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../world";
import { Traits } from "../components";
import { initializeRegistry, getRegistryEntry, validateComponentInitialValues, attachToEntity } from "../component-registry";
import { createEcsTools, createEntityRegistry, registerEntity } from "../tools";
import { ObjectManager } from "../../world/object-manager";
import { getEntityAuthoringCatalog } from "../../engineering/entity-authoring-catalog";
import { compileManagedSystem, executeManagedSystem, ManagedSystemWorker } from "../../engineering/system-sandbox";
import type { SystemSpec } from "../../engineering/contracts";

test.each(["readable,examinable","","null","{}",'"readable"',"[1]",'["readable",null]','[" "]',"[" ])(
  "encoded trait values reject malformed structure: %s",active=>{
    initializeRegistry(createArgosWorld("Formats"));
    expect(()=>validateComponentInitialValues(getRegistryEntry("Traits")!.definition!,{active})).toThrow(/Traits.active/);
  });

test("metadata documents the same encoding that construction accepts, with a safe empty default",()=>{
  const world=createArgosWorld("Formats");initializeRegistry(world);
  const definition=getRegistryEntry("Traits")!.definition!;
  expect(validateComponentInitialValues(definition,{})).toEqual({active:"[]"});
  const formats=getEntityAuthoringCatalog().componentSchemas.find(c=>c.name==="Traits")!.valueFormats;
  expect(formats.active).toMatchObject({encoding:"json-string-array",defaultValue:"[]"});
  expect(validateComponentInitialValues(definition,{active:formats.active.example}).active).toBe(formats.active.example);
  formats.active.defaultValue="bad";
  expect(getEntityAuthoringCatalog().componentSchemas.find(c=>c.name==="Traits")!.valueFormats.active.defaultValue).toBe("[]");
});

test.each(["registry","add_tool","set_tool"])("%s preflights before membership, retains good values and defaults fresh attachment",boundary=>{
  const world=createArgosWorld("Mutation formats");initializeRegistry(world);const eid=addEntity(world),registry=createEntityRegistry();registerEntity(registry,"Record",eid);
  const tools=createEcsTools(world,registry);
  const write=(values:Record<string,unknown>)=>boundary==="registry"?attachToEntity(world,eid,"Traits",values)
    :tools[boundary==="add_tool"?"addComponent":"setComponentValues"]({entityName:"Record",componentName:"Traits",values});
  if(boundary==="registry")expect(()=>write({active:"readable,examinable"})).toThrow(/Traits.active/);
  else expect(write({active:"readable,examinable"})).toMatchObject({success:false,error:expect.stringContaining("Traits.active")});
  expect(hasComponent(world,eid,Traits)).toBe(false);
  write({});expect(new ObjectManager(world).getTraits(eid)).toEqual([]);
  write({active:'["readable"]'});expect(new ObjectManager(world).getTraits(eid)).toEqual(["readable"]);
  if(boundary==="registry")expect(()=>write({active:"not-json"})).toThrow();else expect(write({active:"not-json"})).toMatchObject({success:false});
  expect(Traits.active[eid]).toBe('["readable"]');write({});expect(Traits.active[eid]).toBe('["readable"]');
});

test.each(["synchronous","worker"])("%s managed execution rejects the whole invalid trait-write batch",async mode=>{
  const spec:SystemSpec={name:"EditRecord",description:"Trait update",file:"systems/EditRecord.ts",frequency:1,reads:["Traits","Counter"],writes:["Traits.active","Counter.value"]};
  const entities=[{id:1,components:{Traits:{active:'["examinable"]'},Counter:{value:0}}}],before=JSON.stringify(entities);
  const code=compileManagedSystem('export function run(ctx:any){ctx.set(1,"Counter","value",1);ctx.set(1,"Traits","active","readable,examinable");}');
  if(mode==="synchronous")expect(()=>executeManagedSystem(code,spec,entities,[],1,1000)).toThrow(/Traits.active/);
  else {const worker=new ManagedSystemWorker(code);try{await expect(worker.run(spec,entities,[],1,1000)).rejects.toThrow(/Traits.active/);}finally{worker.close();}}
  expect(JSON.stringify(entities)).toBe(before);
  const good=compileManagedSystem('export function run(ctx:any){ctx.set(1,"Traits","active",JSON.stringify(["readable","examinable"]));}');
  expect(executeManagedSystem(good,spec,entities,[],1,1000)[0].components.Traits.active).toBe('["readable","examinable"]');
});
