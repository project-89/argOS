import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, LastAction, Needs, WorkingMemoryIdentity } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { reserveSimulationResources, isSimulationResourceBusy, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { beginTimedSpeech, clearTimedSpeech, isSpeaking } from "../timed-speech";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { workingMemoryEntityRef } from "../working-memory";
import { getAgentMemory } from "../agent-mind";
import { createIntentGoal } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { deferForegroundSpeech, getForegroundCognitionReadiness, isForegroundActorAvailable, wakeForegroundCognition } from "../idle-cognition";

const cleanups: Array<() => void> = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline readiness tests")); });
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Speech attention"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Think and act from evidence.", roomId: room });
  workingMemoryEntityRef(world, actor);
  cleanups.push(() => { clearTimedSpeech(world); clearSimulationTimeline(world); });
  return { world, room, actor };
}
function occupied() {
  const f = fixture();
  cleanups.push(registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => false, busy: () => true, execute: () => true }));
  expect(reserveSimulationResources(f.world, f.actor, "holding:original", ["body"])).toBe(true);
  expect(beginTimedSpeech(f.world, f.actor, "I am still explaining my earlier idea.", "speech:original", () => {}, () => {})).toBe(true);
  return f;
}

test("new perceivable evidence reaches a speaking, physically occupied mind without freeing either channel", () => {
  const f = occupied();
  expect(isForegroundActorAvailable(f.world, f.actor)).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, reason: "occupied" });
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true })).toMatchObject({ ready: true, reason: "new_stimulus" });
  expect(isSpeaking(f.world, f.actor)).toBe(true);
  expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(true);
  expect(reserveSimulationResources(f.world, f.actor, "not-a-new-body-command", ["body"])).toBe(false);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, reason: "occupied" });
});

test("a critical need can prompt voluntary speech revision during physical work, not silently cancel it", () => {
  const f = occupied(); Needs.hunger[f.actor] = 90;
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: true, reason: "critical_need" });
  expect(isSpeaking(f.world, f.actor)).toBe(true); expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(true);
  Needs.hunger[f.actor] = 0;
  for (let n = 0; n < 20; n++) expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(false);
});

test("package cooldown remains authoritative when no physical channel is occupied", () => {
  const f = fixture();
  cleanups.push(registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => false, busy: () => false, execute: () => false }));
  expect(isForegroundActorAvailable(f.world, f.actor)).toBe(false);
  expect(beginTimedSpeech(f.world, f.actor, "A sentence already underway.", "speech:cooldown", () => {}, () => {})).toBe(true);
  expect(isForegroundActorAvailable(f.world, f.actor)).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, reason: "speaking" });
});

test("floor deferral throttles the first-decision retry without fabricating a wait, thought or action receipt", () => {
  const f = fixture();
  const before = getAgentMemory(f.world, f.actor), lastActionBefore = hasComponent(f.world, f.actor, LastAction);
  deferForegroundSpeech(f.world, f.actor, 30_000);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, reason: "speech_floor", nextCheckAtMs: 1000, quietDecisions: 0 });
  expect(getAgentMemory(f.world, f.actor)).toEqual(before);
  expect(hasComponent(f.world, f.actor, LastAction)).toBe(lastActionBefore);
  advanceSimulationTime(f.world, 1, 999); expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(false);
  advanceSimulationTime(f.world, 2, 1); expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("first_decision");
});

test("fresh attention and critical needs bypass conversational backpressure", () => {
  const f = fixture(); deferForegroundSpeech(f.world, f.actor, 500);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true }).reason).toBe("new_stimulus");
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("speech_floor");
  Needs.hunger[f.actor] = 90; expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("critical_need");
  Needs.hunger[f.actor] = 0; wakeForegroundCognition(f.world, f.actor);
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("first_decision");
});

test("a real physical plan remains runnable during a floor deferral", () => {
  const f = fixture(); createObjectEntity(f.world, { name: "Key", roomId: f.room, portable: true });
  const goal = createIntentGoal(f.world, f.actor, "Take key");
  createPlanEntity(f.world, f.actor, goal, { goalDescription: Goal.description[goal],
    steps: [{ description: "Take key", actionType: "pickup", target: "Key" }], estimatedCompletion: "short", potentialObstacles: [] });
  deferForegroundSpeech(f.world, f.actor, 5000);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: true, reason: "actionable_plan" });
});

test("speech deferrals are world/actor-identity bound and invalid deadlines cannot strand cognition", () => {
  const f = fixture(); deferForegroundSpeech(f.world, f.actor, NaN);
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("first_decision");
  deferForegroundSpeech(f.world, f.actor, 500);
  WorkingMemoryIdentity.id[f.actor] = "actor:replacement";
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("first_decision");
  const other = fixture(); expect(getForegroundCognitionReadiness(other.world, other.actor).reason).toBe("first_decision");
});
