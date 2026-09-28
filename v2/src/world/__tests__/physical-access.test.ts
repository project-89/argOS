import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, createStimulusEmissionSystem, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Agent, Needs, ObjectState, Removed, StimulusSource, Surface, Traits } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { executeActions } from "../../cognition/cognition-system";
import { getAgentVisualEntities, getAgentObservableEntities, registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getInventoryItems, tryAddToInventory } from "../../ecs/inventory";
import { canUseAffordance, executeAffordance, getEffectiveActorTraits } from "../effect-executor";
import { generateStimuliForAgent, getInventoryItemNames } from "../../cognition/sensory-system";
import { worldSchema } from "../schema";
import { ObjectManager } from "../object-manager";
import { getAvailableAffordances, getKnownAffordances } from "../affordance-availability";
import { isInteractTargetAccessible } from "../physical-access";
import { materializePlaceBlueprint, getPlaceBuildStatus } from "../../engineering/place-materialization";

function fixture(){
  const world=createArgosWorld("Physical availability");initializePrefabs(world);startCommittedEvents(world);world.meta.aiEnabled=false;
  const room=createRoomEntity(world,{name:"Bakery"}),remote=createRoomEntity(world,{name:"Street"});
  const actor=createAgentEntity(world,{name:"Ada",role:"visitor",systemPrompt:"Choose",roomId:room});
  const baker=createAgentEntity(world,{name:"Leo",role:"baker",systemPrompt:"Choose",roomId:room});
  const food=new ObjectManager(world).spawn("food_item",{name:"Loaf",containedIn:room})!;
  const box=createObjectEntity(world,{name:"Bread box",roomId:room}),inner=createObjectEntity(world,{name:"Inner box",roomId:room});
  const registry=createSystemRegistry();Needs.hunger[actor]=70;
  return {world,room,remote,actor,baker,food,box,inner,registry,
    menu:()=>getAvailableAffordances(world,actor,food).map(a=>a.name),
    accessible:()=>isInteractTargetAccessible(world,actor,getRoomForEntity(world,actor),food),
    act:(eid:number,action:any)=>executeActions(world,[{eid,action}],registry)};
}

test.each(["present", "object", "holder", "room", "actor", "inactive_actor"])(
  "native periodic emissions respect current physical presence: %s", kind => {
    const f = fixture();
    setLocatedIn(f.world, f.food, f.box); ObjectState.current[f.box] = "open";
    StimulusSource.lastEmit[f.food] = 0;
    if (["object", "holder", "room", "actor"].includes(kind)) addComponent(f.world,
      kind === "object" ? f.food : kind === "holder" ? f.box : kind === "room" ? f.room : f.actor, Removed);
    if (kind === "inactive_actor") Agent.active[f.actor] = false;
    registerSystem(f.registry, createStimulusEmissionSystem()); runSystems(f.world, f.registry, 1, 500);
    const emissions = f.registry.events.filter(e => e.type === "stimulus" && e.data.source === "Loaf");
    expect(emissions.some(e => e.data.target === "Ada")).toBe(kind === "present");
    expect(emissions.some(e => e.data.target === "Leo")).toBe(["present", "actor", "inactive_actor"].includes(kind));
    if (["object", "holder", "room"].includes(kind)) expect(StimulusSource.lastEmit[f.food]).toBe(0);
    expect(getDirectContainer(f.world, f.food)).toBe(f.box); // No deletion/relocation to suppress the signal.
    expect(f.registry.errors).toEqual([]);
  });
test.each(["room","self","open","surface","nested_open","own_closed_bag","other_actor","closed","locked_stale_open","nested_closed","remote"])(
  "generic availability and existing executor access agree for %s",state=>{
    const f=fixture(),allowed=["room","self","open","surface","nested_open","own_closed_bag"].includes(state);
    if(state==="self")setLocatedIn(f.world,f.food,f.actor);
    if(state==="other_actor")setLocatedIn(f.world,f.food,f.baker);
    if(state==="remote")setLocatedIn(f.world,f.food,f.remote);
    if(["open","surface","closed","locked_stale_open","nested_open","nested_closed","own_closed_bag"].includes(state)){
      setLocatedIn(f.world,f.food,f.box);ObjectState.current[f.box]="open";
      if(state==="surface"){ObjectState.current[f.box]="normal";addComponent(f.world,f.box,Surface);}
      if(state==="closed" || state==="own_closed_bag")ObjectState.current[f.box]="closed";
      if(state==="own_closed_bag")setLocatedIn(f.world,f.box,f.actor);
      if(state==="locked_stale_open"){ObjectState.current[f.box]="locked";Traits.active[f.box]='["open"]';}
      if(state.startsWith("nested")){setLocatedIn(f.world,f.box,f.inner);ObjectState.current[f.inner]=state==="nested_open"?"open":"closed";}
    }
    expect(f.accessible()).toBe(allowed);expect(f.menu().includes("eat")).toBe(allowed);
  });
test("native give changes availability for giver and receiver; words alone do not",()=>{
  const f=fixture();f.act(f.baker,{type:"pickup",target:"Loaf"});
  expect(getDirectContainer(f.world,f.food)).toBe(f.baker);expect(f.menu()).not.toContain("eat");
  f.act(f.baker,{type:"speak",target:"Ada",content:"Here is your bread."});
  expect(getDirectContainer(f.world,f.food)).toBe(f.baker);expect(f.menu()).not.toContain("eat");
  f.act(f.baker,{type:"give",target:"Ada",content:"Loaf"});
  expect(getDirectContainer(f.world,f.food)).toBe(f.actor);expect(f.menu()).toContain("eat");
  expect(getAvailableAffordances(f.world,f.baker,f.food).map(a=>a.name)).not.toContain("eat");
});
test("timed interaction rechecks custody at completion and cannot consume another actor's loaf",()=>{
  const f=fixture();f.world.meta.timedActions=true;expect(f.menu()).toContain("eat");
  f.act(f.actor,{type:"interact",target:"Loaf",content:"eat"});setLocatedIn(f.world,f.food,f.baker);
  expect(f.menu()).not.toContain("eat");advanceSimulationTimeline(f.world,1000,{integrate:()=>{}});
  expect(getDirectContainer(f.world,f.food)).toBe(f.baker);expect(Needs.hunger[f.actor]).toBe(70);
  expect(getCommittedEvents(f.world).events.some(e=>e.kind==="action" && e.status==="failed")).toBe(true);
});
test("package-owned operations and known-but-not-ready plans keep their own admission",()=>{
  const f=fixture();setLocatedIn(f.world,f.food,f.baker);
  const remove=registerAgentWorldCapabilities(f.world,f.actor,{context:()=>"",execute:()=>false,
    affordances:()=>[{name:"request_serving",requires:[]}],knownAffordances:()=>[{name:"eat",requires:["edible"]}]});
  try{expect(f.menu()).toContain("request_serving");expect(f.menu()).not.toContain("eat");
    // Visible ground item known operation remains known when physical prerequisites are absent.
    setLocatedIn(f.world,f.food,f.room);expect(getKnownAffordances(f.world,f.actor,f.food).map(a=>a.name)).toContain("eat");
  }finally{remove();}
});
test("removed or whole-room generic targets do not advertise physical interactions",()=>{
  const f=fixture();expect(getAvailableAffordances(f.world,f.actor,f.room)).toEqual([]);
  removeEntity(f.world,f.food);expect(f.menu()).toEqual([]);
});

test.each(["object","holder","room","actor"])("tombstoned %s excludes physical presence without erasing historical containment",kind=>{
  const f=fixture();setLocatedIn(f.world,f.food,f.box);ObjectState.current[f.box]="open";
  const removed=kind==="object"?f.food:kind==="holder"?f.box:kind==="room"?f.room:f.actor;
  addComponent(f.world,removed,Removed);
  expect(getAgentVisualEntities(f.world,f.actor)).not.toContain(f.food);
  expect(getAgentObservableEntities(f.world,f.actor)).not.toContain(f.food);
  expect(f.accessible()).toBe(false);expect(f.menu()).toEqual([]);
  expect(canUseAffordance(f.world,worldSchema.getAffordance("eat")!,f.actor,f.food).available).toBe(false);
  const result=executeAffordance("eat",{world:f.world,actorEid:f.actor,targetEid:f.food,worldSchema});
  expect(result.success).toBe(false);expect(Needs.hunger[f.actor]).toBe(70);expect(getDirectContainer(f.world,f.food)).toBe(f.box);
});

test("a removed carried item is not tangible, usable, transferable or a current inventory item",()=>{
  const f=fixture();setLocatedIn(f.world,f.food,f.actor);addComponent(f.world,f.food,Removed);
  expect(getInventoryItems(f.world,f.actor)).not.toContain(f.food);
  expect(getAgentObservableEntities(f.world,f.actor)).not.toContain(f.food);
  expect(tryAddToInventory(f.world,f.baker,f.food).success).toBe(false);
  f.act(f.actor,{type:"give",target:"Leo",content:"Loaf"});
  expect(getDirectContainer(f.world,f.food)).toBe(f.actor);expect(Needs.hunger[f.actor]).toBe(70);
});

test.each(["food","actor"])("removal of %s during timed interaction closes the interval without consumption",which=>{
  const f=fixture();f.world.meta.timedActions=true;
  f.act(f.actor,{type:"interact",target:"Loaf",content:"eat"});addComponent(f.world,which==="food"?f.food:f.actor,Removed);
  advanceSimulationTimeline(f.world,1000,{integrate:()=>{}});
  expect(Needs.hunger[f.actor]).toBe(70);expect(getDirectContainer(f.world,f.food)).toBe(f.room);
  expect(getCommittedEvents(f.world).events.some(e=>e.kind==="action" && e.status==="failed")).toBe(true);
});

test("removed contents supply neither current inventory labels nor inherited tool traits",()=>{
  const f=fixture();setLocatedIn(f.world,f.food,f.actor);Traits.active[f.food]='["hasGhostKey"]';
  expect(getEffectiveActorTraits(f.world,f.actor).has("hasGhostKey")).toBe(true);
  addComponent(f.world,f.food,Removed);
  expect(getInventoryItemNames(f.world,f.actor)).not.toContain("Loaf");
  expect(getEffectiveActorTraits(f.world,f.actor).has("hasGhostKey")).toBe(false);
});

test("removal invalidates cached sight, smell and ambient sound rather than renewing an old perception",()=>{
  const f=fixture();addComponent(f.world,f.food,StimulusSource);
  StimulusSource.stimulusType[f.food]="sound";StimulusSource.template[f.food]="{name} rattles audibly.";
  expect(JSON.stringify(generateStimuliForAgent(f.world,f.actor,[]))).toContain("Loaf");
  addComponent(f.world,f.food,Removed);
  expect(JSON.stringify(generateStimuliForAgent(f.world,f.actor,[]))).not.toContain("Loaf");
});

test("a permissive package projection cannot make a removed target visible or actionable",()=>{
  const f=fixture();addComponent(f.world,f.food,Removed);
  const remove=registerAgentWorldCapabilities(f.world,f.actor,{context:()=>"",execute:()=>false,visibleEntities:()=>[f.food],
    affordances:()=>[{name:"ghost_access",requires:[]}]});
  try {expect(getAgentVisualEntities(f.world,f.actor)).not.toContain(f.food);expect(f.menu()).toEqual([]);}finally{remove();}
});
test("place readiness follows real custody and returns after a handoff",()=>{
  const f=fixture();materializePlaceBlueprint(f.world,{name:"Cafe",description:"A place to eat",type:"room",components:[],contents:[
    {id:"visitor",entity:{name:"Jo",description:"A visitor",type:"agent",components:[]}},
    {id:"baker",entity:{name:"Nora",description:"A baker",type:"agent",components:[]}},
    {id:"bread",entity:{name:"Sourdough",description:"Food",type:"object",components:[{name:"ObjectType",values:{typeId:"food_item"}}]}}],
    requiredInteractions:[{actor:"visitor",target:"bread",affordance:"eat"}]});
  const status=()=>getPlaceBuildStatus(f.world,f.registry)[0];const before=status();
  const baker=before.members.find(m=>m.id==="baker")!.eid,visitor=before.members.find(m=>m.id==="visitor")!.eid;
  expect(before.readyNow).toBe(true);f.act(baker,{type:"pickup",target:"Sourdough"});
  expect(status().readyNow).toBe(false);expect(status().interactions[0].status).toBe("unavailable");
  f.act(baker,{type:"give",target:"Jo",content:"Sourdough"});expect(status().readyNow).toBe(true);
  expect(Needs.hunger[visitor]).toBe(0); // availability never executes the meal
});
