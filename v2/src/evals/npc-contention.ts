import assert from "node:assert/strict";
import {entityExists,query,removeEntity,getRelationTargets} from "bitecs";
import {createSimulation} from "../index";
import {createObjectEntity} from "../ecs/prefabs";
import {Agent,Inventory,Name,Room} from "../ecs/components";
import {LocatedIn} from "../ecs/relations";
import {getDirectContainer,setLocatedIn} from "../ecs/location";
import {executeActions} from "../cognition/cognition-system";
import {advanceSimulationTimeline} from "../runtime/simulation-timeline";

/** Real action executor, scripted competing intentions; no LLM judgment or fabricated scores. */
export async function npcContention():Promise<Record<string,unknown>> {
  const sim=await createSimulation({name:"Scarce fuse contention",preset:"minimal",enableAI:false,enableSpirits:false,evolution:false,codingDaemons:false,enableNarrativeEngine:false,enableServer:false,
    rooms:[{name:"Workshop"},{name:"Locked store"}],agents:Array.from({length:12},(_,i)=>({name:`Keeper ${i+1}`,role:"tester",startRoom:"Workshop"}))});
  try {
    const agents=[...query(sim.world,[Agent])];
    const rooms=[...query(sim.world,[Room])];const workshop=rooms.find(id=>Name.value[id]==="Workshop")!;const store=rooms.find(id=>Name.value[id]==="Locked store")!;
    let attempts=0,successfulPickups=0,removedBeforeArrival=0;
    for(let round=0;round<30;round++) {
      const name=`Unique fuse ${round}`;
      const item=createObjectEntity(sim.world,{name,portable:true,roomId:workshop,traits:["takeable"]});
      const ordered=[...agents.slice(round%agents.length),...agents.slice(0,round%agents.length)];
      if(round%3===0){removeEntity(sim.world,item);removedBeforeArrival++;}
      executeActions(sim.world,ordered.map(eid=>({eid,action:{type:"pickup" as const,target:name}})),sim.god.systemRegistry);attempts+=agents.length;
      if(entityExists(sim.world,item))assert.equal(getDirectContainer(sim.world,item),workshop,"Intent mutated possession before physical completion");
      advanceSimulationTimeline(sim.world,800,{integrate:()=>{}});
      if(round%3===0) {
        assert(!entityExists(sim.world,item),"Missing fuse resurrected");
        for(const id of agents)assert(!(JSON.parse(Inventory.items[id]||"[]") as number[]).includes(item),"Missing fuse entered inventory");
        continue;
      }
      assert.equal(getDirectContainer(sim.world,item),ordered[0],"Later NPC stole the first NPC's acquired fuse");
      assert.equal(getRelationTargets(sim.world,item,LocatedIn).length,1,"Item acquired duplicate owners");
      const cachedOwners=agents.filter(id=>(JSON.parse(Inventory.items[id]||"[]") as number[]).includes(item));
      assert.deepEqual(cachedOwners,[ordered[0]],"Inventory caches disagree with canonical ownership");successfulPickups++;
      executeActions(sim.world,[{eid:ordered[0],action:{type:"drop",target:name}}],sim.god.systemRegistry);
      advanceSimulationTimeline(sim.world,600,{integrate:()=>{}});
      assert.equal(getDirectContainer(sim.world,item),workshop);
      setLocatedIn(sim.world,item,store);
      executeActions(sim.world,ordered.map(eid=>({eid,action:{type:"pickup" as const,target:name}})),sim.god.systemRegistry);attempts+=agents.length;
      advanceSimulationTimeline(sim.world,800,{integrate:()=>{}});
      assert.equal(getDirectContainer(sim.world,item),store,"Remote item teleported into an inventory");
      removeEntity(sim.world,item);
    }
    assert.equal([...query(sim.world,[Agent])].length,12,"NPC membership changed");
    return {npcs:12,rounds:30,attempts,successfulPickups,removedBeforeArrival,oracle:"Exactly one canonical owner, no remote pickup, no item resurrection."};
  } finally {sim.stop();}
}
