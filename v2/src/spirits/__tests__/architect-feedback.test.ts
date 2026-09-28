import { createArgosWorld } from "../../ecs/world";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { recordArchitectDesignFeedback, getArchitectDesignFeedback } from "../architect-feedback";

function setup() {
  const world=createArgosWorld("Author feedback"); startCommittedEvents(world); const actor={};
  const input={type:"entity",description:"An incomplete place",reason:"contract",requirementIds:["meal"]};
  return {world,actor,input};
}

test.each(["world","actor","source","age","revoked"])("design feedback isolates and expires: %s",boundary=>{
  const f=setup();let current=true;
  recordArchitectDesignFeedback(f.world,f.actor,f.input,()=>current);
  expect(getArchitectDesignFeedback(f.world,f.actor)).toHaveLength(1);
  if(boundary==="world")expect(getArchitectDesignFeedback(setup().world,f.actor)).toEqual([]);
  if(boundary==="actor")expect(getArchitectDesignFeedback(f.world,{})).toEqual([]);
  if(boundary==="source"){stopCommittedEvents(f.world);startCommittedEvents(f.world);}
  if(boundary==="age")advanceSimulationTimeline(f.world,120001,{integrate:()=>{}});
  if(boundary==="revoked")current=false;
  if(!["world","actor"].includes(boundary))expect(getArchitectDesignFeedback(f.world,f.actor)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);stopCommittedEvents(f.world);
});

test("feedback is bounded, copied, and never revives after observed revocation",()=>{
  const f=setup();let current=true;
  for(let i=0;i<30;i++)recordArchitectDesignFeedback(f.world,f.actor,{...f.input,description:`Failure ${i}`},()=>current);
  const feedback=getArchitectDesignFeedback(f.world,f.actor);expect(feedback).toHaveLength(8);
  feedback[0].requirementIds.push("forged");
  expect(getArchitectDesignFeedback(f.world,f.actor)[0].requirementIds).toEqual(["meal"]);
  current=false;expect(getArchitectDesignFeedback(f.world,f.actor)).toEqual([]);
  current=true;expect(getArchitectDesignFeedback(f.world,f.actor)).toEqual([]);stopCommittedEvents(f.world);
});
