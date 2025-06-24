import { World, query, hasComponent } from "bitecs";
import { Agent, Room, OccupiesRoom, Stimulus, StimulusInRoom } from "../components";
import { getStimuliInRoom } from "../components/relationships/stimulus";

/**
 * Get all agents in a room
 */
export function getRoomAgents(world: World, roomEid: number): number[] {
  return query(world, [Agent]).filter((eid) =>
    hasComponent(world, eid, OccupiesRoom(roomEid))
  );
}

/**
 * Get all stimuli in a room
 */
export function getRoomStimuli(world: World, roomEid: number): any[] {
  const stimuliEids = getStimuliInRoom(world, roomEid);
  
  return stimuliEids.map(eid => ({
    id: eid,
    type: Stimulus.type[eid],
    content: Stimulus.content[eid],
    source: Stimulus.source[eid],
    timestamp: Stimulus.timestamp[eid],
    metadata: Stimulus.metadata[eid],
  }));
}