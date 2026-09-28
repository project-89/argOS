import { getAllEntities, removeEntity } from "bitecs";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";
import { executeEntityProposal } from "../../spirits/architect-spirit";
import { materializePlaceBlueprint } from "../place-materialization";
import { createAgentEntity } from "../../ecs/prefabs";

test.each(["entity", "place", "prefab"])("%s cannot turn the outside phone contact into an autonomous namesake", async path => {
  const t = await ApartmentSitcom.create({ live:false, scenario:"duet", outsideTextAtMs:null });
  try {
    t.setPhoneContact({name:"Morgan",relationship:"friend",context:"A real person outside this simulation."});
    const before=[...getAllEntities(t.sim.world)];
    const spec={name:"Morgan",description:"The person waiting to meet Elaine.",type:"agent" as const,components:[],roomEid:t.ids.living};
    expect(()=>{
      if(path==="entity") executeEntityProposal(t.sim.world,spec);
      if(path==="prefab") createAgentEntity(t.sim.world,{name:"Morgan",role:"friend",systemPrompt:"You are Morgan.",roomId:t.ids.living});
      if(path==="place") materializePlaceBlueprint(t.sim.world,{name:"New cafe",description:"A cafe.",type:"room",components:[],
        connectToRoomEids:[t.ids.street],contents:[{id:"guest",entity:{name:spec.name,description:spec.description,type:spec.type,components:[]}}]});
    }).toThrow(/participant|identity|outside/i);
    expect([...getAllEntities(t.sim.world)]).toEqual(before);
  } finally { t.stop(); }
});

test("removing the actual phone does not erase the outside participant's identity",async()=>{
  const t=await ApartmentSitcom.create({live:false,scenario:"duet",outsideTextAtMs:null});
  try {
    t.setPhoneContact({name:"Morgan",relationship:"friend",context:"Private relationship"});
    removeEntity(t.sim.world,t.ids.phone);
    expect(()=>executeEntityProposal(t.sim.world,{name:"Morgan",description:"An imagined caller",type:"agent",components:[],roomEid:t.ids.living})).toThrow(/identity/);
  } finally {t.stop();}
});
