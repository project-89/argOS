import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "GroundedLoopSystem";
export const description = "Grounded loop for NPC behavior: updates and executes BehaviorPolicy based on needs (Hunger/Energy) and proximity to resources.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Agent, Needs, BehaviorPolicy, Name, Room } = ctx.components;
  const { LocatedIn, Contains } = ctx.relations;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const rooms = Array.from(ctx.query(world, [Room, Name]));
  
  for (const eid of agents) {
    // Ensure BehaviorPolicy exists
    if (BehaviorPolicy.action[eid] === undefined) {
        BehaviorPolicy.action[eid] = "";
        BehaviorPolicy.target[eid] = 0;
    }
  
    const currentRoom = ctx.getRelationTargets(world, eid, LocatedIn)[0];
    if (currentRoom === undefined) continue;
  
    const hunger = Needs.hunger[eid] ?? 0;
    const energy = Needs.energy[eid] ?? 100;
  
    // --- 1. POLICY UPDATE ---
    if (!BehaviorPolicy.action[eid] || BehaviorPolicy.action[eid] === "") {
        if (hunger > 80) {
            const items = ctx.getRelationTargets(world, currentRoom, Contains);
            const edible = items.find(item => (ObjectMeta?.traits[item] || "").includes("edible"));
            if (edible) {
                BehaviorPolicy.action[eid] = "eat";
                BehaviorPolicy.target[eid] = edible;
            } else {
                const hubs = rooms.filter(r => ["Marketplace", "The Golden Wheat", "Bakery"].includes(Name.value[r]));
                const target = hubs[Math.floor(Math.random() * hubs.length)];
                if (target !== currentRoom) {
                    BehaviorPolicy.action[eid] = "move";
                    BehaviorPolicy.target[eid] = target;
                }
            }
        } else if (energy < 20) {
            const items = ctx.getRelationTargets(world, currentRoom, Contains);
            const sleepable = items.find(item => (ObjectMeta?.traits[item] || "").includes("sleepable"));
            if (sleepable) {
                BehaviorPolicy.action[eid] = "sleep";
                BehaviorPolicy.target[eid] = sleepable;
            } else {
                const hubs = rooms.filter(r => ["Bakery", "Village Square"].includes(Name.value[r]));
                const target = hubs[Math.floor(Math.random() * hubs.length)];
                if (target !== currentRoom) {
                    BehaviorPolicy.action[eid] = "move";
                    BehaviorPolicy.target[eid] = target;
                }
            }
        } else {
            if (Math.random() < 0.05) {
                const target = rooms[Math.floor(Math.random() * rooms.length)];
                if (target !== currentRoom) {
                    BehaviorPolicy.action[eid] = "move";
                    BehaviorPolicy.target[eid] = target;
                }
            }
        }
    }
  
    // --- 2. POLICY EXECUTION ---
    const action = BehaviorPolicy.action[eid];
    const target = BehaviorPolicy.target[eid];
    if (action && target) {
        if (action === "eat") {
            const targetRoom = ctx.getRelationTargets(world, target, LocatedIn)[0];
            if (targetRoom === currentRoom) {
                Needs.hunger[eid] = Math.max(0, (Needs.hunger[eid] ?? 100) - 60);
                ctx.log(`${Name.value[eid]} ate ${Name.value[target]}`);
                if (ObjectMeta && ObjectMeta.state[target] !== undefined) {
                    ObjectMeta.state[target] = "empty";
                    ObjectMeta.traits[target] = "examinable";
                } else {
                    ctx.removeEntity(world, target);
                }
                BehaviorPolicy.action[eid] = "";
                BehaviorPolicy.target[eid] = 0;
            }
        } else if (action === "sleep") {
            const targetRoom = ctx.getRelationTargets(world, target, LocatedIn)[0];
            if (targetRoom === currentRoom) {
                Needs.energy[eid] = Math.min(100, (Needs.energy[eid] ?? 0) + 5);
                if (Needs.energy[eid] >= 100) {
                    BehaviorPolicy.action[eid] = "";
                    BehaviorPolicy.target[eid] = 0;
                }
            }
        } else if (action === "move") {
            if (currentRoom !== target) {
                ctx.removeRelation(world, eid, currentRoom, LocatedIn);
                ctx.addRelation(world, eid, target, LocatedIn);
                ctx.log(`${Name.value[eid]} moved to ${Name.value[target]}`);
            }
            BehaviorPolicy.action[eid] = "";
            BehaviorPolicy.target[eid] = 0;
        }
    }
  }
}
