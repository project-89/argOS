import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ValueIncrementSystem";
export const description = "Demonstrates read/write capabilities on SoA data structures";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const TestValue = ctx.getDynamic("TestValue");
  if (!TestValue) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid =>
    TestValue.amount?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const current_val = TestValue.amount[eid] || 0;
    TestValue.amount[eid] = current_val + 1;
  }
}
