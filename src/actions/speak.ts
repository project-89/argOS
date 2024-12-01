import { z } from "zod";
import { World } from "../types/bitecs";
import { addComponent, addEntity } from "bitecs";
import { Agent, Memory, Room, Stimulus } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { findAgentRoom } from "../utils/world-utils";

export const schema = z.object({
  message: z.string(),
  tone: z.enum(["neutral", "gentle", "firm"]).optional(),
  target: z.string().optional(),
});

export const action = {
  name: "speak",
  description: "Say something to others in the room",
  parameters: ["message", "tone", "target"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>
) {
  const roomId = findAgentRoom(world, eid);
  if (roomId === null) return;

  const { message, tone = "neutral" } = parameters;

  // Log the speech
  logger.agent(eid, `Says: ${message}`);

  // Create speech stimulus in the room
  const speechStimulus = addEntity(world);
  addComponent(world, speechStimulus, Stimulus);
  Stimulus.type[speechStimulus] = "SPEECH";
  Stimulus.sourceEntity[speechStimulus] = eid;
  Stimulus.source[speechStimulus] = "AGENT";
  Stimulus.content[speechStimulus] = JSON.stringify({
    name: Agent.name[eid],
    role: Agent.role[eid],
    appearance: Agent.appearance[eid],
    message,
    tone,
    location: {
      roomId: Room.id[roomId],
      roomName: Room.name[roomId],
    },
  });
  Stimulus.timestamp[speechStimulus] = Date.now();
  Stimulus.roomId[speechStimulus] = Room.id[roomId];
  Stimulus.decay[speechStimulus] = 1;

  // Create memory for speaker
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "speech",
    content: `I said: "${message}"`,
    timestamp: Date.now(),
  });
}
