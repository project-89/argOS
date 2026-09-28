import { randomUUID } from "node:crypto";
import { addComponent, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { createIntentGoal } from "./cognition-system";
import { markStandingIntention } from "./goal-lifecycle";
import { addMemory } from "./knowledge-graph";
import { workingMemoryEntityRef } from "./working-memory";

/** A competing desire, not an action policy. Only a perceived notification may
 * raise its salience; the caller must not pass private delivery state here.
 * Deliberation still chooses the action, and a retired goal stays retired. */
export function createCommunicationMotivation(world: World, actor: number, options: {
  description: string; memory: string; priority?: number; notificationPriority?: number;
}) {
  if (![options.priority ?? 6, options.notificationPriority ?? 8].every(value => typeof value === "number" && Number.isFinite(value)))
    throw new Error("Communication motivation priorities must be finite numbers.");
  const priority = Math.max(1, Math.min(10, options.priority ?? 6));
  const notificationPriority = Math.max(priority, Math.min(10, options.notificationPriority ?? 8));
  if (!entityExists(world, actor) || !hasComponent(world, actor, Agent)) throw new Error("A living agent is required for a communication motivation.");
  const actorKey = workingMemoryEntityRef(world, actor)?.key;
  if (!actorKey) throw new Error("A named agent is required for a communication motivation.");
  const goal = createIntentGoal(world, actor, options.description, priority);
  Goal.kind[goal] = "social";
  // Being reachable is a standing desire, not a ten-minute task. The actor may
  // still retire it explicitly; a notification never resurrects a dead goal.
  markStandingIntention(world, goal);
  // Goals are nonvisual entities and need no Name; do not use the observation
  // helper, which intentionally assigns identities only to named entities.
  const goalKey = `goal:${randomUUID()}`;
  addComponent(world, goal, WorkingMemoryIdentity); WorkingMemoryIdentity.id[goal] = goalKey;
  addMemory(world, actor, { type: "episodic", content: options.memory, importance: .85, emotionalValence: .15, timestamp: Date.now() });
  const active = () => entityExists(world, actor) && entityExists(world, goal)
    && WorkingMemoryIdentity.id[actor] === actorKey && WorkingMemoryIdentity.id[goal] === goalKey
    && hasComponent(world, actor, Agent) && Agent.active[actor] && hasComponent(world, actor, HasGoal(goal))
    && hasComponent(world, goal, Goal) && Goal.status[goal] === "active";
  return {
    goal,
    noticeNotification() { if (active()) Goal.priority[goal] = notificationPriority; },
    // The reader may observe a remaining-unread indicator on the channel. A
    // successful read is not proof the entire notification was resolved.
    readCommunication(observed?: { unreadRemaining: boolean }) {
      if (active()) Goal.priority[goal] = observed?.unreadRemaining ? notificationPriority : priority;
    },
  };
}
