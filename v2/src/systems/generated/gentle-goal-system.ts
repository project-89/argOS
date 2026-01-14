import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "GentleGoalSystem";
export const description = "Gives agents peaceful goals based on their roles.";
export const frequency = 45;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Agent, Name } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Name]));
  for (const eid of agents) {
    const name = Name.value[eid];
    const role = Agent.role[eid];
    
    // Only give goal if they don't have one (simplified check)
    if (!ctx.getRelationTargets(world, eid, ctx.relations.HasGoal).length) {
      let goal = "Enjoy the peaceful day";
      if (name.includes("Ada")) goal = "Bake a honey cake";
      else if (name.includes("Bjorn")) goal = "Forge a sturdy tool";
      else if (name.includes("Willem") || name.includes("Hilda")) goal = "Tend the golden crops";
      else if (name.includes("Greta")) goal = "Greet a traveler";
      else if (name.includes("Aldric")) goal = "Welcome a newcomer";
      else if (name.includes("Anya")) goal = "Tend the temple lilies";
      else if (name.includes("Mathis")) goal = "Recall an old legend";
      
      // We can't easily 'add' a goal via simple ECS write here without the Goal component, 
      // but we can log it or emit a cognitive stimulus to the agent.
      ctx.emit("cognitive_stimulus", { target: name, content: `You decide to: ${goal}` });
    }
  }
}
