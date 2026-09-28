import { removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { Name, WorkingMemoryIdentity } from "../../ecs/components";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { enableRoomRouteTopology } from "../../runtime/room-routes";
import { captureEntityMaterializationScope } from "../entity-materialization-scope";
import type { MaterializedEntitySpec } from "../entity-materialization";
import { materializeApprovedEntity } from "../entity-materialization";
import { worldSchema } from "../../world/schema";

test.each(["same", "during_design", "during_approval", "unrelated", "compound", "new_type", "native_registration"])("typed object admission checks observed definitions: %s",boundary=>{
  const world=createArgosWorld("Typed construction");initializePrefabs(world);startCommittedEvents(world);
  const room=createRoomEntity(world,{name:"Study"});
  const original=worldSchema.getObjectType("laptop")!;
  try {
    const scope=captureEntityMaterializationScope(world,[room]);
    if(boundary==="during_design")worldSchema.defineObjectType({...original,description:"Changed during design"});
    if(boundary==="new_type")worldSchema.defineObjectType({...original,name:"newly_seen_type"});
    const prop={name:"Terminal",description:"A computer",type:"object" as const,roomEid:room,
      components:[{name:"ObjectType",values:{typeId:boundary==="new_type" ? "newly_seen_type" : "laptop"}}]};
    if(boundary==="new_type") {expect(()=>scope.bind(prop)).toThrow(/observed/);return;}
    const current=scope.bind(boundary==="compound"
      ?{name:"Lab",description:"A lab",type:"room",components:[],contents:[{id:"computer",entity:{name:prop.name,description:prop.description,type:"object",components:prop.components}}]}
      :prop);
    if(["during_approval","compound"].includes(boundary))worldSchema.defineObjectType({...original,description:"Changed after approval"});
    if(boundary==="unrelated")worldSchema.defineObjectType({...original,name:"unrelated_computer"});
    if(boundary==="native_registration")materializeApprovedEntity(world,prop);
    expect(current()).toBe(["same","unrelated","native_registration"].includes(boundary));
  } finally {worldSchema.defineObjectType(original);stopCommittedEvents(world);}
});

test.each(["current", "renamed", "identity", "removed", "source", "topology", "specification"])("delayed materialization respects its observed %s boundary", boundary => {
  const world = createArgosWorld("Expansion"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Square" });
  let disable = enableRoomRouteTopology(world);
  try {
    const observation = captureEntityMaterializationScope(world, [room]);
    const spec: MaterializedEntitySpec = { name: "Workshop", description: "A place to work.", type: "room", components: [], connectToRoomEids: [room] };
    const current = observation.bind(spec);
    expect(current()).toBe(true);
    if (boundary === "renamed") Name.value[room] = "Different place";
    if (boundary === "identity") WorkingMemoryIdentity.id[room] = "replacement";
    if (boundary === "removed") removeEntity(world, room);
    if (boundary === "source") { stopCommittedEvents(world); startCommittedEvents(world); }
    if (boundary === "topology") { disable(); disable = enableRoomRouteTopology(world); }
    if (boundary === "specification") spec.connectToRoomEids = [];
    expect(current()).toBe(boundary === "current");
  } finally { disable(); stopCommittedEvents(world); }
});

test("a model cannot place inhabitants in an unobserved room that appeared during inference", () => {
  const world = createArgosWorld("Expansion"); initializePrefabs(world); startCommittedEvents(world);
  try {
    const observed = createRoomEntity(world, { name: "Square" });
    const scope = captureEntityMaterializationScope(world, [observed]);
    const unseen = createRoomEntity(world, { name: "Workshop" });
    const spec: MaterializedEntitySpec = { name: "Nora", description: "A baker", type: "agent", roomEid: unseen, components: [] };
    expect(() => scope.bind(spec)).toThrow(/observed rooms/);
    spec.roomEid = observed;
    expect(scope.bind(spec)()).toBe(true);
  } finally { stopCommittedEvents(world); }
});
