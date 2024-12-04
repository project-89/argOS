import { createRelation, withStore } from "bitecs";

// Core Agent component - essential properties every agent needs
export const Agent = {
  id: [] as string[],
  name: [] as string[],
  role: [] as string[],
  systemPrompt: [] as string[],
  active: [] as number[],
  platform: [] as string[],
  appearance: [] as string[],
  attention: [] as number[],
};

// Memory component for storing thoughts and experiences
export const Memory = {
  thoughts: [] as string[][],
  lastThought: [] as string[],
  perceptions: [] as Array<{
    timestamp: number;
    content: string;
  }>[],
  experiences: [] as Array<{
    type: string;
    content: string;
    timestamp: number;
  }>[],
};

export type RoomType =
  | "physical"
  | "discord"
  | "twitter"
  | "private"
  | "astral";

// Room component for spatial organization
export const Room = {
  id: [] as string[],
  name: [] as string[],
  description: [] as string[],
  type: [] as RoomType[],
};

// Room occupancy relationship with store for metadata
export const OccupiesRoom = createRelation({
  exclusive: true, // An agent can only be in one room at a time
});

// Perception component for storing what an agent perceives
export const Perception = {
  currentStimuli: [] as any[][],
  lastProcessedTime: [] as number[],
};

// Action component for handling agent actions and tool usage
export const Action = {
  pendingAction: [] as ({
    tool: string;
    parameters: any;
  } | null)[],
  lastActionTime: [] as number[],
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>[],
};

// Dynamic appearance component for handling physical state and social cues
export const Appearance = {
  baseDescription: [] as string[],
  facialExpression: [] as string[],
  bodyLanguage: [] as string[],
  currentAction: [] as string[],
  socialCues: [] as string[],
  lastUpdate: [] as number[],
};

// Stimulus component for broadcasting events in the environment
export const Stimulus = {
  type: [] as string[],
  sourceEntity: [] as number[],
  source: [] as string[],
  content: [] as string[],
  timestamp: [] as number[],
  decay: [] as number[],
  roomId: [] as string[],
};

// Stimulus relationships with stores for metadata
export const StimulusInRoom = createRelation(
  withStore(() => ({
    roomId: [] as string[],
    enteredAt: [] as number[],
    intensity: [] as number[],
  }))
);

export const StimulusSource = createRelation(
  withStore(() => ({
    source: [] as string[],
    createdAt: [] as number[],
    strength: [] as number[],
  }))
);
