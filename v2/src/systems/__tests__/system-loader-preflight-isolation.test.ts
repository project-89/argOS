import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Agent, PhysicalObject } from "../../ecs/components";
import { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } from "../../ecs/prefabs";
import { attachToEntity, getComponent, getRegistryWorld, registryCreateComponent } from "../../ecs/component-registry";
import { getRoomForEntity } from "../../ecs/location";
import { preflightValidateSystem, type LoadedSystem } from "../system-loader";

test("legacy system preflight cannot replace or write through the live ECS registry",async()=>{
  const world=createArgosWorld("Live world");initializePrefabs(world);
  const room=createRoomEntity(world,{name:"Live Room"});
  const agent=createAgentEntity(world,{name:"Mara",role:"npc",systemPrompt:"stay alive",roomId:room});
  const corrosion=registryCreateComponent({name:"LiveCorrosion",description:"live-only schema",properties:{level:"number"},defaults:{level:0}});
  attachToEntity(world,agent,"LiveCorrosion",{level:37});
  const nameBefore=Name.value[agent];
  const system:LoadedSystem={name:"HarmlessPreflight",description:"fixture",frequency:1,active:true,filePath:"/tmp/fixture.ts",
    source:"export function run() {}",run:(validationWorld,ctx)=>{
      for(const eid of ctx.query(validationWorld,[ctx.components.Name]))ctx.log(`saw ${ctx.components.Name.value[eid]}`);
    },lastRun:0,consecutiveErrors:0,lastError:null,fixAttempts:0};

  await expect(preflightValidateSystem(system,{ticks:2})).resolves.toEqual({ok:true});
  expect(getRegistryWorld()).toBe(world);
  expect(getComponent("LiveCorrosion")).toBe(corrosion);
  expect(corrosion.level[agent]).toBe(37);
  expect(Name.value[agent]).toBe(nameBefore);
  expect(hasComponent(world,agent,Agent)).toBe(true);
  expect(getRoomForEntity(world,agent)).toBe(room);

  const laterRoom=createRoomEntity(world,{name:"After Repair"});
  const laterAgent=createAgentEntity(world,{name:"Still Alive",role:"npc",systemPrompt:"continue",roomId:laterRoom});
  const laterObject=createObjectEntity(world,{name:"New Tool",roomId:laterRoom});
  expect(Name.value[laterRoom]).toBe("After Repair");
  expect(Name.value[laterAgent]).toBe("Still Alive");
  expect(Name.value[laterObject]).toBe("New Tool");
  expect(hasComponent(world,laterAgent,Agent)).toBe(true);
  expect(hasComponent(world,laterObject,PhysicalObject)).toBe(true);
  expect(getRoomForEntity(world,laterAgent)).toBe(laterRoom);
  expect(getRoomForEntity(world,laterObject)).toBe(laterRoom);
});
