import { jest } from "@jest/globals";
import { addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { drainPendingStimuli, getStimulusQueueStatus, queueStimulus, STIMULUS_QUEUE_LIMITS } from "../stimulus-queue";
import { bridgeWorldEventsToStimuli } from "../world-event-bridge";
import { injectEvent } from "../../god/monitoring-system";
import { getActiveCalls, initiateIncomingCall } from "../../spirits/operator-spirit";

function fixture() {
  const world = createArgosWorld("Producer admission"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
  return { world, room, actor };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline producer regression")); });
afterEach(() => { drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("event bridges and operator injection never report delivery when an actor mailbox is full", () => {
  const f = fixture();
  for (let i = 0; i < STIMULUS_QUEUE_LIMITS.perActor; i++) expect(queueStimulus(f.world,
    { targetEid: f.actor, type: "attention", content: `${i}`, source: "fixture" })).toBe(true);
  expect(bridgeWorldEventsToStimuli(f.world, [{ type: "stimulus", timestamp: 0,
    data: { targetEid: f.actor, type: "attention", content: "Overflow", source: "fixture" } }])).toEqual({ queued: 0, rejected: 1 });
  expect(injectEvent(f.world, { byId: new Map(), byName: new Map() }, { type: "attention", content: "Overflow" }, { agent: f.actor }).success).toBe(false);
  expect(getStimulusQueueStatus(f.world)).toMatchObject({ pending: STIMULUS_QUEUE_LIMITS.perActor, rejected: 2 });
});

test("legacy device-addressed incoming call fails closed instead of claiming it rang", () => {
  const f = fixture(), device = addEntity(f.world), before = getActiveCalls().length;
  const call = initiateIncomingCall(f.world, "Caller", "Ada", device);
  expect(call.status).toBe("ended"); expect(call.notificationError).toMatch(/rejected/);
  expect(getActiveCalls()).toHaveLength(before); expect(drainPendingStimuli(undefined, f.world)).toEqual([]);
  expect(getStimulusQueueStatus(f.world).reasons.invalid_target).toBe(1);
});
