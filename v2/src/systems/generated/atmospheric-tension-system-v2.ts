import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "AtmosphericTensionSystemV2";
export const description = "Calculates ambient and internal tension levels for agents and adjusts arousal.";
export const frequency = 10;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Agent, Mind, Needs, Health, Room, StatusEffect, Position, Name, Thought } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Mind, Position]));
  
  // Group agents by room for crowding calculation
  const roomCounts = new Map();
  for (const eid of agents) {
    const roomId = Room.value[eid];
    if (roomId !== undefined) {
      roomCounts.set(roomId, (roomCounts.get(roomId) || 0) + 1);
    }
  }
  
  for (const eid of agents) {
    const roomId = Room.value[eid];
    const crowding = roomCounts.get(roomId) || 0;
    
    const healthVal = Health.current[eid] ?? 100;
    const hungerVal = Needs.hunger[eid] ?? 0;
    const energyVal = Needs.energy[eid] ?? 100;
    
    const internalStress = (100 - healthVal) + (hungerVal > 70 ? hungerVal - 70 : 0) + (energyVal < 30 ? 30 - energyVal : 0);
    const totalTension = (crowding * 5) + internalStress;
    
    // Apply effects
    if (totalTension > 50) {
      Mind.arousal[eid] = Math.min(1, (Mind.arousal[eid] ?? 0.5) + 0.005);
    } else if (totalTension < 20) {
      Mind.arousal[eid] = Math.max(0, (Mind.arousal[eid] ?? 0.5) - 0.002);
    }
  }
}
