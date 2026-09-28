import {describe,expect,test} from "@jest/globals";
import {compileManagedSystem,executeManagedSystem,ManagedSystemWorker,captureEntities} from "../system-sandbox";
import {addEntity,addPrefab,addComponent,removeEntity} from "bitecs";
import {createArgosWorld} from "../../ecs/world";
import {initializeRegistry} from "../../ecs/component-registry";
import {Name} from "../../ecs/components";
import type {SystemSpec,ComponentSpec} from "../contracts";
const spec:SystemSpec={name:"Growth",description:"test",file:"systems/Growth.ts",frequency:1,reads:["Counter"],writes:["Counter.value"]};
const components:ComponentSpec[]=[{name:"Counter",description:"count",fields:{value:{type:"number",default:0}}}];
const entities=[{id:1,components:{Counter:{value:1}}}];
describe("managed system constraints",()=>{
  test("snapshots see late-created entities, exclude prefabs, and forget removed entities",()=>{
    const world=createArgosWorld("snapshot churn");initializeRegistry(world);expect(captureEntities(world)).toEqual([]);
    const template=addPrefab(world);addComponent(world,template,Name);Name.value[template]="not an inhabitant";
    const id=addEntity(world);addComponent(world,id,Name);Name.value[id]="new arrival";
    expect(captureEntities(world,["Name"]).map(e=>e.id)).toEqual([id]);
    removeEntity(world,id);expect(captureEntities(world,["Name"])).toEqual([]);
  });
  test("rejects top-level effects and runtime imports",()=>{
    expect(()=>compileManagedSystem('import fs from "node:fs"; export function run(ctx:any){}')).toThrow();
    expect(()=>compileManagedSystem('throw Error("bad"); export function run(ctx:any){}')).toThrow();
    expect(()=>compileManagedSystem('export async function run(ctx:any){}')).toThrow();
  });
  test("bounds infinite loops without touching input",()=>{
    const code=compileManagedSystem('export function run(ctx:any){while(true){}}');
    expect(()=>executeManagedSystem(code,spec,entities,components,1,1000)).toThrow(/timed out/);
    expect(entities[0].components.Counter.value).toBe(1);
  });
  test("rejects undeclared and non-finite writes",()=>{
    for(const body of ['ctx.set(1,"Counter","other",2)','ctx.set(1,"Counter","value",NaN)','ctx.set(1,"Counter","value","oops")']) {
      const code=compileManagedSystem(`export function run(ctx:any){${body}}`);
      expect(()=>executeManagedSystem(code,spec,entities,components,1,1000)).toThrow();
    }
  });
  test("no host APIs or dynamic code generation",()=>{
    expect(()=>compileManagedSystem('export function run(ctx:any){process.exit()}')).toThrow(/Forbidden/);
    const code=compileManagedSystem('export function run(ctx:any){ctx.set(1,"Counter","value",typeof console=== "undefined" ? 2 : 3)}');
    expect(executeManagedSystem(code,spec,entities,components,1,1000)[0].components.Counter.value).toBe(3);
  });
  test("an infinite generated system times out in a worker while the host continues",async()=>{
    const worker=new ManagedSystemWorker(compileManagedSystem('export function run(ctx:any){while(true){}}'));
    let hostTicks=0;const timer=setInterval(()=>hostTicks++,1);
    try {
      await expect(worker.run(spec,entities,components,1,1000)).rejects.toThrow(/timed out/);
      expect(hostTicks).toBeGreaterThan(0);expect(entities[0].components.Counter.value).toBe(1);
    } finally {clearInterval(timer);worker.close();}
  });
});
