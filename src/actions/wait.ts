import { z } from "zod";
import { World } from "../types/bitecs";
import { addComponent, addEntity } from "bitecs";
import { Agent, Memory, Room, Stimulus } from "../components/agent/Agent";
import { findAgentRoom } from "../utils/world-utils";
import { logger } from "../utils/logger";

export const schema = z.object({
  reason: z.string(),
  duration: z.number().optional(),
});

export const action = {
  name: "wait",
  description: "Choose to wait and observe the situation",
  parameters: ["reason", "duration"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>
) {
  const roomId = findAgentRoom(world, eid);
  if (roomId === null) return;

  const { reason, duration = 5000 } = parameters;

  // Log the waiting
  logger.agent(eid, `Waiting: ${reason}`);

  // Create visual stimulus for others to observe the waiting
  const waitStimulus = addEntity(world);
  addComponent(world, waitStimulus, Stimulus);
  Stimulus.type[waitStimulus] = "VISUAL";
  Stimulus.sourceEntity[waitStimulus] = eid;
  Stimulus.source[waitStimulus] = "AGENT";
  Stimulus.content[waitStimulus] = JSON.stringify({
    name: Agent.name[eid],
    role: Agent.role[eid],
    appearance: Agent.appearance[eid],
    action: "waiting",
    reason,
    location: {
      roomId: Room.id[roomId],
      roomName: Room.name[roomId],
    },
  });
  Stimulus.timestamp[waitStimulus] = Date.now();
  Stimulus.roomId[waitStimulus] = Room.id[roomId];
  Stimulus.decay[waitStimulus] = 1;

  // Create memory for the agent
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "action",
    content: `I waited patiently: ${reason}`,
    timestamp: Date.now(),
  });
}
