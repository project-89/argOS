import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { getCommittedSource, getCommittedEvents, publishCommittedEvent, startCommittedEvents, stopCommittedEvents } from "../committed-events";

test("status lookup neither creates a source nor traverses its history", () => {
  const world = createArgosWorld("Status only"); initializePrefabs(world);
  expect(getCommittedSource(world)).toEqual({ sourceId: null, latestSequence: 0, stopped: false });
  expect(getCommittedEvents(world).sourceId).toBeNull();
  const roomId = createRoomEntity(world, { name: "Hall" });
  const actorId = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Live", roomId });
  const sourceId = startCommittedEvents(world);
  for (let i = 0; i < 2100; i++) publishCommittedEvent(world, { executionId: String(i), kind: "speech",
    action: "speak", actorId, roomId, status: "succeeded", text: "Public fixture." });
  const filter = jest.spyOn(Array.prototype, "filter");
  let result;
  try { result = getCommittedSource(world); expect(filter).not.toHaveBeenCalled(); }
  finally { filter.mockRestore(); }
  expect(result).toEqual({ sourceId, latestSequence: 2100, stopped: false });
  expect(getCommittedEvents(world)).toMatchObject({ sourceId, latestSequence: 2100, gap: true, stopped: false });
  expect(getCommittedEvents(world).events).toHaveLength(2048);
});

test("status is fresh across stop/restart, detached, and isolated by world", () => {
  const first = createArgosWorld("First"), other = createArgosWorld("Other");
  const id = startCommittedEvents(first), before = getCommittedSource(first);
  stopCommittedEvents(first);
  expect(getCommittedSource(first)).toEqual({ sourceId: id, latestSequence: 0, stopped: true });
  expect(before.stopped).toBe(false);
  expect(getCommittedSource(other)).toEqual({ sourceId: null, latestSequence: 0, stopped: false });
  const restarted = startCommittedEvents(first);
  expect(restarted).not.toBe(id);
  expect(getCommittedSource(first)).toEqual({ sourceId: restarted, latestSequence: 0, stopped: false });
  expect(Object.isFrozen(before)).toBe(true);
});
