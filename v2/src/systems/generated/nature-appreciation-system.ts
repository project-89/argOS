import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NatureAppreciationSystem";
export const description = "Emits peaceful environmental descriptions.";
export const frequency = 30;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Room, Name } = ctx.components;
  const rooms = Array.from(ctx.query(world, [Room, Name]));
  const messages = [
    "Birds sing sweetly in the nearby trees.",
    "A gentle breeze carries the scent of autumn leaves and flowers.",
    "Sunlight dances peacefully on the ground.",
    "Golden leaves drift slowly from the trees, caught in the light breeze."
  ];
  
  const message = messages[Math.floor(Math.random() * messages.length)];
  for (const eid of rooms) {
    ctx.emit("environmental_stimulus", { room: Name.value[eid], content: message });
  }
}
