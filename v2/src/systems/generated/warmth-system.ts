import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";
import { getRoomForEntity } from "../../ecs/location";

export const name = "WarmthSystem";
export const description = "Manages agent body temperature based on location and stove state.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Warmth = ctx.getDynamic("Warmth");
  const StoveState = ctx.getDynamic("StoveState");
  const { Room, Name, Position } = ctx.components;
  
  if (!Warmth) return;
  
  const entities = Array.from(ctx.query(world, [ctx.components.Agent]));
  const stoveEntity = Array.from(ctx.query(world, [Name])).find(eid => Name.value[eid] === "Iron Stove");
  
  for (const eid of entities) {
    const currentWarmth = Warmth.current[eid] ?? 50;
    const roomEid = getRoomForEntity(world, eid);
    const roomName = roomEid !== undefined ? Name.value[roomEid] : "";
  
    let change = -2; // Default freezing outside
  
    if (roomName === "Main Shelter") {
      const isStoveBurning = stoveEntity !== undefined && StoveState.burning[stoveEntity];
      if (isStoveBurning) {
        change = 4; // Warming up near stove
      } else {
        change = -0.5; // Chilly but sheltered
      }
    }
  
    Warmth.current[eid] = Math.max(0, Math.min(100, currentWarmth + change));
  
    // Threshold stimuli
    if (Warmth.current[eid] < 25) {
      ctx.emit("stimulus", { targetEid: eid, type: "internal", content: "Hypothermia is setting in. Your limbs are numb." });
    } else if (Warmth.current[eid] < 50) {
      ctx.emit("stimulus", { targetEid: eid, type: "internal", content: "You are shivering uncontrollably." });
    }
  }
}
