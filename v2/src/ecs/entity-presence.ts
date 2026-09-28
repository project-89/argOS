import { entityExists, hasComponent } from "bitecs";
import type { World } from "./world";
import { Removed } from "./components";
import { getDirectContainer } from "./location";

/** Physical presence, not historical identity. Tombstones and their contained
 * contents remain inspectable by authors/persistence but cannot be sensed or
 * acted on as current world matter. No mutation, relocation or memory erasure. */
export function isEntityPresent(world:World,eid:number):boolean {
  const visited=new Set<number>();let current:number|undefined=eid;
  while(current!==undefined && visited.size<32) {
    if(!Number.isSafeInteger(current)||visited.has(current)||!entityExists(world,current)||hasComponent(world,current,Removed))return false;
    visited.add(current);current=getDirectContainer(world,current);
  }
  return current===undefined;
}
