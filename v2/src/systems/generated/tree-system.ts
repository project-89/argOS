import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "TreeSystem";
export const description = "Monitors tree health and handles falling.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Health, Name } = ctx.components;
      const entities = Array.from(ctx.query(world, [Health, Name]));
      if (!Health || !Health.current || !Name || !Name.value) return;
      for (const eid of entities) {
        if (Health.current[eid] !== undefined) {
          const currentHealth = Health.current[eid];
          if (currentHealth <= 0) {
            if (Name.value[eid]) {
              const name = Name.value[eid];
              if (name && name.includes("Tree")) {
                ctx.log(`${name} has been chopped down and cleared!`);
                ctx.emit("tree_felled", { name });
                ctx.removeEntity(world, eid);
              }
            }
          }
        }
      }
}
