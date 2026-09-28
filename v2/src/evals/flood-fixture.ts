import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import type {AcceptanceTest, ComponentSpec, EntitySnapshot, Release} from "../engineering/contracts";

export type FloodCell = {water:number;capacity:number;inflow:number;drain:number;rust:number;sealed:boolean;on:boolean;threshold:number};
export const floodComponents:ComponentSpec[] = [
  {name:"Hydraulics",description:"Water balance in a workshop cell",fields:{water:{type:"number",default:0},capacity:{type:"number",default:20},inflow:{type:"number",default:0},drain:{type:"number",default:0}}},
  {name:"Corrosion",description:"Exposure-dependent corrosion",fields:{level:{type:"number",default:0},sealed:{type:"boolean",default:false}}},
  {name:"Circuit",description:"Power safety interlock",fields:{on:{type:"boolean",default:true},threshold:{type:"number",default:3}}},
];
export const floodSystems = [
  {name:"FloodStep",description:"Water balance with saturation",file:"systems/FloodStep.ts",frequency:1,reads:["Hydraulics"],writes:["Hydraulics.water"],
    code:'export function run(ctx:any){for(const id of ctx.query("Hydraulics")){const water=ctx.get(id,"Hydraulics","water");const net=ctx.get(id,"Hydraulics","inflow")-ctx.get(id,"Hydraulics","drain");ctx.set(id,"Hydraulics","water",Math.max(0,Math.min(ctx.get(id,"Hydraulics","capacity"),water+net*ctx.deltaMs/1000)));}}'},
  {name:"CorrosionStep",description:"Only exposed wet metal corrodes",file:"systems/CorrosionStep.ts",frequency:1,reads:["Hydraulics","Corrosion"],writes:["Corrosion.level"],
    code:'export function run(ctx:any){for(const id of ctx.query("Hydraulics","Corrosion")){if(!ctx.get(id,"Corrosion","sealed")&&ctx.get(id,"Hydraulics","water")>5)ctx.set(id,"Corrosion","level",Math.min(100,ctx.get(id,"Corrosion","level")+0.25*ctx.deltaMs/1000));}}'},
  {name:"CircuitStep",description:"Trip flooded or corroded electrical cells",file:"systems/CircuitStep.ts",frequency:1,reads:["Hydraulics","Corrosion","Circuit"],writes:["Circuit.on"],
    code:'export function run(ctx:any){for(const id of ctx.query("Hydraulics","Corrosion","Circuit")){ctx.set(id,"Circuit","on",ctx.get(id,"Hydraulics","water")<ctx.get(id,"Hydraulics","capacity")&&ctx.get(id,"Corrosion","level")<ctx.get(id,"Circuit","threshold"));}}'},
];

export function cellEntity(cell:FloodCell,id=1):EntitySnapshot {
  return {id,components:{Hydraulics:{water:cell.water,capacity:cell.capacity,inflow:cell.inflow,drain:cell.drain},Corrosion:{level:cell.rust,sealed:cell.sealed},Circuit:{on:cell.on,threshold:cell.threshold}}};
}
const base:FloodCell={water:10,capacity:20,inflow:2,drain:1,rust:1,sealed:false,on:true,threshold:3};
export const floodAcceptance:AcceptanceTest[] = [
  {name:"water conserves net flow",system:"FloodStep",entities:[cellEntity(base)],ticks:2,deltaMs:500,expect:[{entity:1,component:"Hydraulics",field:"water",equals:11}]},
  {name:"overflow clamps at capacity",system:"FloodStep",entities:[cellEntity({...base,water:19,inflow:100})],ticks:2,deltaMs:1000,expect:[{entity:1,component:"Hydraulics",field:"water",equals:20}]},
  {name:"empty tank cannot go negative",system:"FloodStep",entities:[cellEntity({...base,water:0,inflow:0,drain:100})],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Hydraulics",field:"water",equals:0}]},
  {name:"wet unsealed metal corrodes in simulation seconds",system:"CorrosionStep",entities:[cellEntity(base)],ticks:2,deltaMs:500,expect:[{entity:1,component:"Corrosion",field:"level",equals:1.25}]},
  {name:"sealed metal remains intact",system:"CorrosionStep",entities:[cellEntity({...base,sealed:true})],ticks:2,deltaMs:1000,expect:[{entity:1,component:"Corrosion",field:"level",equals:1}]},
  {name:"dry metal remains intact",system:"CorrosionStep",entities:[cellEntity({...base,water:5})],ticks:2,deltaMs:1000,expect:[{entity:1,component:"Corrosion",field:"level",equals:1}]},
  {name:"flooded circuit trips",system:"CircuitStep",entities:[cellEntity({...base,water:20})],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Circuit",field:"on",equals:false}]},
  {name:"corroded circuit stays off",system:"CircuitStep",entities:[cellEntity({...base,rust:3,on:false})],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Circuit",field:"on",equals:false}]},
  {name:"safe circuit recovers",system:"CircuitStep",entities:[cellEntity({...base,on:false})],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Circuit",field:"on",equals:true}]},
];

export async function writeFloodRelease(directory:string):Promise<void> {
  await mkdir(path.join(directory,"components"),{recursive:true});await mkdir(path.join(directory,"systems"),{recursive:true});
  for(const component of floodComponents) await writeFile(path.join(directory,`components/${component.name}.json`),JSON.stringify(component));
  for(const system of floodSystems) await writeFile(path.join(directory,system.file),system.code);
  const release:Release={version:1,components:floodComponents.map(c=>`components/${c.name}.json`),systems:floodSystems.map(({code,...s})=>s),tests:floodAcceptance};
  await writeFile(path.join(directory,"release.json"),JSON.stringify(release,null,2));
}

/** Independent equations, not an invocation of the candidate code. All read the prior state. */
export function referenceStep(cell:FloodCell,deltaMs:number,corrosionRate=0.25):FloodCell {
  const change=(cell.inflow-cell.drain)*deltaMs/1000;
  const water=cell.water+change<0?0:cell.water+change>cell.capacity?cell.capacity:cell.water+change;
  const rust=cell.sealed||cell.water<=5?cell.rust:Math.min(100,cell.rust+deltaMs*corrosionRate/1000);
  return {...cell,water,rust,on:cell.water<cell.capacity&&cell.rust<cell.threshold};
}

export function seededCells(seed:number,count:number):FloodCell[] {
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  return Array.from({length:count},()=>({water:random()*20,capacity:20,inflow:random()*4,drain:random()*3,rust:random()*2,sealed:random()<0.25,on:true,threshold:3}));
}

export const floodInstruction = `Build exactly FloodStep, CorrosionStep, and CircuitStep, frequency 1, with these component schemas: ${JSON.stringify(floodComponents)}.
Reuse existing components; include complete additive definitions only if needed. Components already exist on target entities; do not attach components to bystanders.
FloodStep: query Hydraulics; water = clamp(water + (inflow - drain) * ctx.deltaMs / 1000, 0, capacity).
CorrosionStep: query Hydraulics and Corrosion; when water > 5 and sealed is false, increase level by 0.25 * ctx.deltaMs / 1000 capped at 100, otherwise leave it unchanged.
CircuitStep: query Hydraulics, Corrosion, Circuit; set on to (water < capacity AND level < threshold); recover when both conditions are safe.
Each system owns ONLY its named output: Hydraulics.water, Corrosion.level, Circuit.on respectively. Declare all component reads. Use exact names. No other fields, entities, inventory or private minds may change. Include positive and boundary tests. These independent systems evaluate prior state, not an imperative call chain.`;
