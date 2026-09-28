import { addComponent, getAllEntities, getRelationTargets, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, Mind, Inventory, PhysicalObject, Removed } from "../../ecs/components";
import { AdjacentTo } from "../../ecs/relations";
import { initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry, registerSystem } from "../../ecs/dynamic-systems";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { getInventoryItems } from "../../ecs/inventory";
import { materializeApprovedEntity } from "../entity-materialization";
import { materializePlaceBlueprint, getPlaceBuildStatus, type RoomBlueprint } from "../place-materialization";
import { executeEntityProposal } from "../../spirits/architect-spirit";
import { enableRoomRouteTopology, captureRoomRouteEvidence, connectRoomRoute, disconnectRoomRoute } from "../../runtime/room-routes";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { configureWorldConstructionBudget, getWorldConstructionStatus } from "../../runtime/world-construction-budget";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";

function setup() {
  const world = createArgosWorld("Inhabited construction"); initializeRegistry(world); startCommittedEvents(world);
  enableRoomRouteTopology(world); const registry = createSystemRegistry();
  const street = materializeApprovedEntity(world, { name:"Street",description:"A public street.",type:"room",components:[] });
  const blueprint:RoomBlueprint = { name:"Workshop",description:"A workshop with two people and a workbench.",type:"room",components:[],connectToRoomEids:[street],
    contents:[
      {id:"keeper",entity:{name:"Nora",description:"The workshop keeper.",type:"agent",components:[{name:"Agent",values:{role:"keeper",systemPrompt:"You are Nora. You care about your workshop and your visitors."}}]}},
      {id:"visitor",entity:{name:"Ivo",description:"A curious visitor.",type:"agent",components:[]}},
      {id:"bench",entity:{name:"Workbench",description:"A heavy wooden workbench.",type:"object",components:[{name:"PhysicalObject",values:{portable:false}}]}},
    ] };
  return { world,registry,street,blueprint };
}

test("authored new stock can start in a new resident's native inventory without later reasserting custody",()=>{
  const f=setup(), spec:any=structuredClone(f.blueprint);
  spec.contents[2].entity.components=[{name:"PhysicalObject",values:{portable:true,weight:1}}];
  spec.contents[2].carriedBy="keeper";
  materializePlaceBlueprint(f.world,spec);
  const first=getPlaceBuildStatus(f.world,f.registry)[0];
  const keeper=first.members.find(m=>m.id==="keeper")!, stock=first.members.find(m=>m.id==="bench")!;
  expect(getDirectContainer(f.world,stock.eid)).toBe(keeper.eid);
  expect(getInventoryItems(f.world,keeper.eid)).toEqual([stock.eid]);
  expect(JSON.parse(Inventory.items[keeper.eid])).toEqual([stock.eid]);
  setLocatedIn(f.world,stock.eid,f.street);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].members.find(m=>m.id==="bench")!.roomEid).toBe(f.street);
  expect(getDirectContainer(f.world,stock.eid)).toBe(f.street);
});

test.each(["unknown","existing","non_agent","non_object","fixed","capacity","removed_identity"])("initial custody rejects %s without allocating",boundary=>{
  const f=setup(), spec:any=structuredClone(f.blueprint);
  spec.contents[2].entity.components=[{name:"PhysicalObject",values:{portable:true}}];
  spec.contents[2].carriedBy="keeper";
  if(boundary==="unknown")spec.contents[2].carriedBy="ghost";
  if(boundary==="existing")spec.contents[2].carriedBy=f.street;
  if(boundary==="non_agent")spec.contents[2].carriedBy="bench";
  if(boundary==="non_object")spec.contents[1].carriedBy="keeper";
  if(boundary==="fixed")spec.contents[2].entity.components=[{name:"PhysicalObject",values:{portable:false}}];
  if(boundary==="capacity")spec.contents[0].entity.components.push({name:"Inventory",values:{maxSlots:0}});
  if(boundary==="removed_identity") { addComponent(f.world,f.street,Removed); spec.contents[2].entity.name="Street"; spec.connectToRoomEids=[]; }
  const before=[...getAllEntities(f.world)];
  expect(()=>materializePlaceBlueprint(f.world,spec)).toThrow();
  expect([...getAllEntities(f.world)]).toEqual(before);
  expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
});

test("a compound architect proposal builds actual native inhabitants and props before publishing its route",()=>{
  const f=setup(); configureWorldConstructionBudget(f.world,5);
  const room=executeEntityProposal(f.world,f.blueprint);
  const [status]=getPlaceBuildStatus(f.world,f.registry);
  expect(status).toBeDefined(); expect(status.readyNow).toBe(true); expect(status.phase).toBe("constructed");
  expect(status.members).toHaveLength(4); expect(status.unmet).toEqual([]);
  const keeper=status.members.find(m=>m.id==="keeper")!, bench=status.members.find(m=>m.id==="bench")!;
  for (const c of [Agent,Mind,Inventory]) expect(hasComponent(f.world,keeper.eid,c)).toBe(true);
  expect(Agent.active[keeper.eid]).toBe(true); expect(Agent.role[keeper.eid]).toBe("keeper");
  expect(hasComponent(f.world,bench.eid,PhysicalObject)).toBe(true); expect(PhysicalObject.portable[bench.eid]).toBe(false);
  expect(getRoomForEntity(f.world,keeper.eid)).toBe(room); expect(getRoomForEntity(f.world,bench.eid)).toBe(room);
  expect(getRelationTargets(f.world,f.street,AdjacentTo)).toEqual([room]);
  expect(getWorldConstructionStatus(f.world)).toMatchObject({admitted:5,remaining:0,byKind:{room:2,agent:2,object:1}});
});

test.each(["unknown_component","duplicate_id","duplicate_name","existing_name","invalid_reference","nested_room","invalid_placement","budget","stopped","duplicate_route"])("%s fails before any construction",boundary=>{
  const f=setup(), spec:any=structuredClone(f.blueprint), before=[...getAllEntities(f.world)];
  if(boundary==="unknown_component") spec.contents[2].entity.components.push({name:"UnknownMechanic",values:{}});
  if(boundary==="duplicate_id") spec.contents[2].id="keeper";
  if(boundary==="duplicate_name") spec.contents[2].entity.name=spec.contents[0].entity.name;
  if(boundary==="existing_name") spec.contents[2].entity.name="Street";
  if(boundary==="invalid_reference") spec.requiredInteractions=[{actor:"ghost",target:"bench",affordance:"examine"}];
  if(boundary==="nested_room") spec.contents[2].entity.type="room";
  if(boundary==="invalid_placement") spec.contents[2].entity.roomEid=f.street;
  if(boundary==="budget") configureWorldConstructionBudget(f.world,4);
  if(boundary==="stopped") stopCommittedEvents(f.world);
  if(boundary==="duplicate_route") spec.connectToRoomEids=[f.street,f.street];
  expect(()=>materializePlaceBlueprint(f.world,spec)).toThrow();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(getWorldConstructionStatus(f.world).admitted).toBe(1);
  expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
});

test("availability is live ECS/service evidence, not a declaration that a mechanic works",()=>{
  const f=setup(); f.blueprint.requiredSystems=["BenchHeat"];
  materializePlaceBlueprint(f.world,f.blueprint);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].unmet).toEqual(["system:BenchHeat"]);
  registerSystem(f.registry,{name:"BenchHeat",description:"fixture",pseudocode:"",frequency:1,active:true,lastRun:0,compiledFn:()=>{}});
  expect(getPlaceBuildStatus(f.world,f.registry)[0].readyNow).toBe(true);
  f.registry.systems.get("BenchHeat")!.consecutiveErrors=1;
  expect(getPlaceBuildStatus(f.world,f.registry)[0].readyNow).toBe(false);
});

test("ordinary departures are not missing construction or permission to fabricate replacement people",()=>{
  const f=setup(); materializePlaceBlueprint(f.world,f.blueprint);
  const first=getPlaceBuildStatus(f.world,f.registry)[0], visitor=first.members.find(m=>m.id==="visitor")!;
  setLocatedIn(f.world,visitor.eid,f.street);
  expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({phase:"constructed",readyNow:true});
  expect(getPlaceBuildStatus(f.world,f.registry)[0].members.find(m=>m.id==="visitor")!.roomEid).toBe(f.street);
  addComponent(f.world,visitor.eid,Removed);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].unmet).toEqual(["member:visitor"]);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].members.find(m=>m.id==="visitor")!.roomEid).toBeUndefined();
  expect(getWorldConstructionStatus(f.world).admitted).toBe(5);
});

test.each(["demand","source","membership"])("reentrant %s change cannot publish a completed place or route",boundary=>{
  const f=setup(); let calls=0;
  expect(()=>materializePlaceBlueprint(f.world,f.blueprint,()=>{
    calls++;
    if(calls===3) {
      if(boundary==="source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
      if(boundary==="membership") {
        const keeper=getPlaceBuildStatus(f.world,f.registry)[0]?.members.find(m=>m.id==="keeper");
        if(keeper) setLocatedIn(f.world,keeper.eid,f.street);
      }
      if(boundary==="demand") return false;
    }
    return true;
  })).toThrow();
  const [status]=getPlaceBuildStatus(f.world,f.registry);
  expect(status.phase).toBe("failed"); expect(status.readyNow).toBe(false);
  expect(getRelationTargets(f.world,f.street,AdjacentTo)).toEqual([]);
  expect(status.members.length).toBeGreaterThan(0);
});

test("source restart cannot turn historical construction into current readiness",()=>{
  const f=setup(); materializePlaceBlueprint(f.world,f.blueprint);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].unmet).toContain("source_unavailable");
});

test.each(["during_members", "during_routes", "unrelated", "current"])("construction retains captured route evidence without invalidating its own extension: %s",boundary=>{
  const f=setup();
  const square=materializeApprovedEntity(f.world,{name:"Square",description:"A square.",type:"room",components:[]});
  const yard=materializeApprovedEntity(f.world,{name:"Yard",description:"A yard.",type:"room",components:[]});
  const shed=materializeApprovedEntity(f.world,{name:"Shed",description:"A shed.",type:"room",components:[]});
  connectRoomRoute(f.world,f.street,square);
  const blueprint={...f.blueprint,connectToRoomEids:[f.street,square]};
  const evidence=captureRoomRouteEvidence(f.world,[f.street,square]).bind([f.street,square]);
  let changed=false;
  const build=()=>materializePlaceBlueprint(f.world,blueprint,room=>{
    const firstRouteExists=room && getRelationTargets(f.world,f.street,AdjacentTo).includes(room.eid);
    if(!changed && (boundary==="during_routes" ? firstRouteExists : !!room)) {
      changed=true;
      if(boundary==="during_members"||boundary==="during_routes") disconnectRoomRoute(f.world,f.street,square);
      if(boundary==="unrelated") connectRoomRoute(f.world,yard,shed);
    }
    return evidence(room ? blueprint.connectToRoomEids.map(from=>({from,to:room.eid,key:room.key})) : []);
  });
  if(boundary==="during_members"||boundary==="during_routes") {
    expect(build).toThrow(/changed/);
    const [status]=getPlaceBuildStatus(f.world,f.registry);
    expect(status).toMatchObject({phase:"failed",readyNow:false});
    expect(status.members).toHaveLength(boundary==="during_members"?1:4);
    // Keep actual partial work, but never publish the second exit or success.
    expect(getRelationTargets(f.world,square,AdjacentTo)).toEqual([]);
  } else {
    expect(build().roomEid).toBeDefined();
    expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({phase:"constructed",readyNow:true});
  }
  stopCommittedEvents(f.world);
});

test("repeated authoring cannot silently duplicate an already built place",()=>{
  const f=setup(); materializePlaceBlueprint(f.world,f.blueprint);
  expect(()=>materializePlaceBlueprint(f.world,f.blueprint)).toThrow(/duplicate existing entity/);
  expect(getPlaceBuildStatus(f.world,f.registry)).toHaveLength(1);
  expect(getWorldConstructionStatus(f.world).admitted).toBe(5);
});

test("interaction readiness checks actual local availability and fails closed if the capability is unhealthy",()=>{
  const f=setup(); f.blueprint.requiredInteractions=[{actor:"keeper",target:"bench",affordance:"examine"}];
  materializePlaceBlueprint(f.world,f.blueprint);
  const [first]=getPlaceBuildStatus(f.world,f.registry); expect(first.unmet).toEqual([]);
  const keeper=first.members.find(m=>m.id==="keeper")!;
  const unregister=registerAgentWorldCapabilities(f.world,keeper.eid,{context:()=>"",ready:()=>true,busy:()=>false,execute:()=>false,affordances:()=>{throw new Error("broken package");}});
  try { expect(getPlaceBuildStatus(f.world,f.registry)[0].unmet).toEqual(["interaction:keeper:bench:examine"]); }
  finally { unregister(); }
  setLocatedIn(f.world,keeper.eid,f.street);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].unmet).toEqual(["interaction:keeper:bench:examine"]);
});
