import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ResourceReplenishmentSystem";
export const description = "Replenishes food supplies in common rooms by emitting spawn requests.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  
  const { Room, Name } = ctx.components;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  const LocatedIn = ctx.relations.LocatedIn;
  
  if (ctx.tick % 50 !== 0) return;
  
  const rooms = [11, 9, 8]; // Bakery, Market, Tavern
  const roomNames = ["Bakery", "Marketplace", "The Golden Wheat"];
  
  for (let i = 0; i < rooms.length; i++) {
    const roomEid = rooms[i];
    const roomName = roomNames[i];
    
    const objectsInRoom = Array.from(ctx.query(world, [Name]))
      .filter(eid => ctx.hasDynamic(eid, "ObjectMeta"))
      .filter(eid => {
        const targets = ctx.getRelationTargets(world, eid, LocatedIn);
        return targets.includes(roomEid);
      });
    
    const foodInRoom = objectsInRoom.filter(eid => {
      const traits = ObjectMeta.traits[eid];
      return traits && traits.includes("edible");
    });
  
    if (foodInRoom.length < 2) {
      ctx.emit("spawn_request", { 
        type: "provision", 
        name: `Supply_${roomName}_${ctx.tick}`, 
        roomName: roomName,
        properties: { adjective: "fresh", foodType: "ration" }
      });
    }
  }
  
}
