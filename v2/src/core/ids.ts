import { nanoid } from "nanoid";

export function createEventId(): string {
  return `evt_${nanoid(12)}`;
}

export function createStimulusId(): string {
  return `stm_${nanoid(12)}`;
}

export function createNodeId(): string {
  return `node_${nanoid(12)}`;
}

export function createEdgeId(): string {
  return `edge_${nanoid(12)}`;
}

export function createActionId(): string {
  return `act_${nanoid(12)}`;
}
