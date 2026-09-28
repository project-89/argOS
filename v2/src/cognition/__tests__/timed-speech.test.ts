import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { advanceSimulationTimeline, scheduleSimulationEvent, reserveSimulationResources, releaseSimulationResources } from "../../runtime/simulation-timeline";
import { getCommittedEvents } from "../../runtime/committed-events";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { setLocatedIn } from "../../ecs/location";
import { Goal, Plan, LastAction, SocialMemory, ObjectState, Traits } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createPlanEntity } from "../planning-system";
import { executeActions } from "../cognition-system";
import { getSocialDialogue, getSocialExchanges, getSocialSpeechFragments, formatSocialMemoryContext } from "../social-memory";
import { drainPendingStimuli } from "../stimulus-queue";
import { getForegroundCognitionReadiness, recordCognitionOutcome } from "../idle-cognition";
import { getObservedPublicActivity, registerAgentWorldCapabilities } from "../world-capabilities";
import { advanceTimedSpeech, clearTimedSpeech, estimateSpeechDurationMs, getSpeakingActivity, interruptTimedSpeech, isSpeaking } from "../timed-speech";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_000_000); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline speech test")); });
afterEach(() => { for (const world of worlds.splice(0)) clearTimedSpeech(world); drainPendingStimuli();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });
function fixture() {
  const world = createArgosWorld("Temporal speech"); worlds.push(world); world.meta.timedSpeech = true;
  initializePrefabs(world); const registry = createSystemRegistry();
  const room = createRoomEntity(world, { name: "Hall" }), away = createRoomEntity(world, { name: "Kitchen" });
  const actor = (name: string, roomId = room) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId });
  const ada = actor("Ada"), bo = actor("Bo"), cy = actor("Cy", away);
  const speak = (content = "The blue key is inside the cupboard.") => {
    executeActions(world, [{ eid: ada, action: { type: "speak", target: "Bo", content } }], registry);
    return estimateSpeechDurationMs(content);
  };
  const advance = (delta: number) => advanceSimulationTimeline(world, delta, { integrate: () => {} });
  return { world, registry, room, away, ada, bo, cy, speak, advance };
}
test("speech has finite simulation duration; wall time cannot finish it or give listeners future words", () => {
  const f = fixture(), duration = f.speak();
  expect(duration).toBeGreaterThan(3000);
  expect(isSpeaking(f.world, f.ada)).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.ada).reason).toBe("speaking");
  expect(getObservedPublicActivity(f.world, f.bo, f.ada)).toBe("speaking");
  expect(getSpeakingActivity(f.world, f.ada)).not.toHaveProperty("content");
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(LastAction.success[f.ada]).toBe(false);
  jest.setSystemTime(2_000_000); advanceTimedSpeech(f.world);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  f.advance(duration - 1); expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  f.advance(1);
  expect(isSpeaking(f.world, f.ada)).toBe(false);
  expect(LastAction.success[f.ada]).toBe(true);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(1);
  expect(getSocialDialogue(f.world, f.bo)[0].simulation).toMatchObject({ startedAtSimMs: 0, expectedEndSimMs: duration, completedAtSimMs: duration });
  expect(getSocialDialogue(f.world, f.cy)).toHaveLength(0);
  advanceTimedSpeech(f.world); f.advance(1000);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(1);
  expect(formatSocialMemoryContext(f.world, f.bo)).toContain("1s ago");
});
test("coarse and fine stepping yield the same speech deadline with no wall-clock waiting", () => {
  const coarse = fixture(), duration = coarse.speak();
  coarse.advance(duration);
  const coarseEnd = getSocialDialogue(coarse.world, coarse.bo)[0].simulation?.completedAtSimMs;
  clearTimedSpeech(coarse.world);
  const fine = fixture(); fine.speak();
  for (let remaining = duration; remaining > 0;) { const step = Math.min(100, remaining); fine.advance(step); remaining -= step; }
  expect(coarseEnd).toBe(duration);
  expect(getSocialDialogue(fine.world, fine.bo)[0].simulation?.completedAtSimMs).toBe(duration);
});
test("a second utterance cannot replace the voice while an independent body intention is allowed", () => {
  const f = fixture(), duration = f.speak();
  const original = getSpeakingActivity(f.world, f.ada);
  f.speak("A conflicting second sentence.");
  executeActions(f.world, [{ eid: f.ada, action: { type: "move", target: "Kitchen" } }], f.registry);
  expect(getSpeakingActivity(f.world, f.ada)).toEqual(original);
  f.advance(duration);
  expect(getSocialDialogue(f.world, f.ada).map(t => t.content)).toEqual(["The blue key is inside the cupboard."]);
  expect(LastAction.type[f.ada]).toBe("speak");
  expect(LastAction.success[f.ada]).toBe(true);
});
test("a listener arriving late or leaving mid-sentence does not acquire a complete-turn receipt", () => {
  const f = fixture(), duration = f.speak();
  f.advance(1000); setLocatedIn(f.world, f.bo, f.away); setLocatedIn(f.world, f.cy, f.room); f.advance(200);
  setLocatedIn(f.world, f.bo, f.room); f.advance(duration - 1200);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(getSocialDialogue(f.world, f.cy)).toHaveLength(0);
  expect(getSocialSpeechFragments(f.world, f.bo).map(row => row.content).join("")).not.toContain("blue");
  expect(getSocialSpeechFragments(f.world, f.cy)[0].firstToken).toBe(1);
  expect(getSocialDialogue(f.world, f.ada)).toHaveLength(1);
});
test("speech follows a moving speaker without sending words to listeners left behind", () => {
  const f = fixture(), duration = f.speak(); setLocatedIn(f.world, f.ada, f.away); f.advance(duration);
  expect(isSpeaking(f.world, f.ada)).toBe(false);
  expect(LastAction.success[f.ada]).toBe(true);
  expect(getSocialDialogue(f.world, f.ada)).toHaveLength(1);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  expect(getSocialDialogue(f.world, f.cy)).toHaveLength(1);
});
test("a speech plan advances only on its exact utterance completion, never on admission", () => {
  const f = fixture(), goal = addEntity(f.world);
  addComponent(f.world, goal, Goal); addComponent(f.world, f.ada, HasGoal(goal));
  Goal.description[goal] = "Tell Bo what I know"; Goal.priority[goal] = 10; Goal.status[goal] = "active";
  Goal.progress[goal] = 0; Goal.createdAt[goal] = Date.now(); Goal.deadline[goal] = 0;
  const content = "The blue key is inside the cupboard.";
  const plan = createPlanEntity(f.world, f.ada, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Tell Bo", actionType: "speak", target: "Bo", content },
      { description: "Look around", actionType: "observe" }] });
  const duration = f.speak(content);
  expect(Plan.currentStep[plan]).toBe(0);
  f.advance(duration - 1); expect(Plan.currentStep[plan]).toBe(0);
  f.advance(1); expect(Plan.currentStep[plan]).toBe(1);
  advanceTimedSpeech(f.world); expect(Plan.currentStep[plan]).toBe(1);
});
test.each(["stop", "deleted actor"])("%s cancels a queued completion", reason => {
  const f = fixture(), duration = f.speak();
  if (reason === "stop") clearTimedSpeech(f.world); else removeEntity(f.world, f.ada);
  f.advance(duration);
  expect(isSpeaking(f.world, f.ada)).toBe(false);
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
});
test("long utterances are not squeezed into a video chunk and non-Latin text takes time", () => {
  expect(estimateSpeechDurationMs("word ".repeat(100))).toBeGreaterThan(30_000);
  expect(estimateSpeechDurationMs("你好世界。" )).toBeGreaterThan(1000);
  expect(estimateSpeechDurationMs("  ")).toBe(0);
});
test("accelerated dialogue windows age in lived time, not elapsed API time", () => {
  const f = fixture(), duration = f.speak("Where is the key?"); f.advance(duration);
  f.advance(60_001);
  executeActions(f.world, [{ eid: f.bo, action: { type: "speak", target: "Ada", content: "I am back now." } }], f.registry);
  f.advance(estimateSpeechDurationMs("I am back now."));
  expect(getSocialExchanges(f.world, f.ada)).toHaveLength(0);
  expect(formatSocialMemoryContext(f.world, f.ada)).toContain("Your spoken turns in the last minute: 0.");
});

test("coherent heard spans update cognition without exposing a future word or repeating the complete script", () => {
  const f = fixture(), duration = f.speak("one two three four five six seven eight nine ten.");
  f.advance(700);
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("one ");
  expect(getSpeakingActivity(f.world, f.ada)?.spokenText).toBe("one ");
  expect(formatSocialMemoryContext(f.world, f.bo)).not.toContain("two");
  expect(SocialMemory.revision[f.bo]).toBe(0);
  expect(drainPendingStimuli().filter(s => s.targetEid === f.bo)).toHaveLength(0);
  f.advance(1600);
  const first = drainPendingStimuli().filter(s => s.targetEid === f.bo);
  expect(first).toHaveLength(0);
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("one two three four five ");
  expect(formatSocialMemoryContext(f.world, f.bo)).not.toContain("six");
  expect(SocialMemory.revision[f.bo]).toBe(0);
  f.advance(duration - 2300);
  const last = drainPendingStimuli().filter(s => s.targetEid === f.bo);
  expect(last).toHaveLength(1); expect(last[0].content).toContain("one two three four five six seven eight nine ten.");
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(1);
  const events = getCommittedEvents(f.world).events;
  expect(events[0]).toMatchObject({ status: "pending", expectedEndSimMs: duration });
  expect(events.filter(e => e.text !== undefined)).toHaveLength(10);
  expect(events.filter(e => e.text !== undefined).every(e => e.completedAtSimMs === undefined)).toBe(true);
  expect(events.filter(e => e.completedAtSimMs !== undefined)).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ status: "succeeded", completedAtSimMs: duration });
  expect(events.at(-1)?.text).toBeUndefined();
});

test("a chosen listening wait survives ordinary word progress but wakes at a bounded heard boundary", () => {
  const f = fixture(); f.speak("one two three four five six seven eight nine ten eleven twelve thirteen fourteen.");
  f.advance(700); drainPendingStimuli();
  recordCognitionOutcome(f.world, f.bo, { type: "wait" }, { succeeded: true, pending: false });
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ ready: false, nextCheckAtMs: 5700,
    listening: { executionIds: [getSpeakingActivity(f.world, f.ada)!.executionId], untilSimMs: 5700 } });
  f.advance(2000); // Past the former two-second check, before a coherent boundary.
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("one two three four five six ");
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ ready: false, reason: "quiet" });
  expect(drainPendingStimuli().filter(s => s.targetEid === f.bo)).toHaveLength(0);
  f.advance(1600); // The bounded four-second heard span, not a future suffix.
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ ready: true, reason: "state_changed", changedFields: ["dialogue"] });
  const notices = drainPendingStimuli().filter(s => s.targetEid === f.bo);
  expect(notices).toHaveLength(1); expect(notices[0].content).toContain("nine ten");
  expect(notices[0].content).not.toContain("eleven");
  expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
});

test.each(["new stimulus", "visible change", "speaker stops", "listener leaves", "hearing lost"])("listening remains interruptible by %s", change => {
  const f = fixture(); const lamp = createObjectEntity(f.world, { name: "Lamp", roomId: f.room });
  f.speak("one two three four five six seven eight nine ten eleven twelve."); f.advance(700); drainPendingStimuli();
  recordCognitionOutcome(f.world, f.bo, { type: "wait" }, { succeeded: true, pending: false });
  if (change === "visible change") ObjectState.current[lamp] = "broken";
  if (change === "speaker stops") interruptTimedSpeech(f.world, f.ada, "changed my mind");
  if (change === "listener leaves") setLocatedIn(f.world, f.bo, f.away);
  if (change === "hearing lost") Traits.active[f.bo] = JSON.stringify(["deaf"]);
  expect(getForegroundCognitionReadiness(f.world, f.bo, { hasPendingStimuli: change === "new stimulus" }).ready).toBe(true);
});

test("a remote or not-yet-heard voice cannot impose a listening wait", () => {
  const f = fixture(); f.speak("one two three four five six seven eight nine ten.");
  recordCognitionOutcome(f.world, f.bo, { type: "wait" }, { succeeded: true, pending: false });
  expect(getForegroundCognitionReadiness(f.world, f.bo)).toMatchObject({ nextCheckAtMs: 2000 });
  expect(getForegroundCognitionReadiness(f.world, f.bo).listening).toBeUndefined();
  f.advance(700);
  recordCognitionOutcome(f.world, f.cy, { type: "wait" }, { succeeded: true, pending: false });
  expect(getForegroundCognitionReadiness(f.world, f.cy)).toMatchObject({ nextCheckAtMs: 2700 });
  expect(getForegroundCognitionReadiness(f.world, f.cy).listening).toBeUndefined();
});

test("coarse and fine advances merge a speaker's room transition before a simultaneous spoken word", () => {
  function run(step: number) {
    const f = fixture(), content = "one two three four five six.";
    const duration = f.speak(content);
    const remove = registerAgentWorldCapabilities(f.world, f.bo, { ready: () => true, busy: () => false, context: () => "", execute: () => false });
    scheduleSimulationEvent(f.world, { atSimMs: 1500, phase: "physical", run: () => setLocatedIn(f.world, f.ada, f.away) });
    for (let left = duration; left > 0;) { const dt = Math.min(step, left); f.advance(dt); left -= dt; }
    const result = {
      bo: getSocialSpeechFragments(f.world, f.bo).map(row => row.content).join(""),
      cy: getSocialSpeechFragments(f.world, f.cy).map(row => row.content).join(""),
      complete: [getSocialDialogue(f.world, f.bo).length, getSocialDialogue(f.world, f.cy).length],
      words: getCommittedEvents(f.world).events.filter(e => e.text).map(e => [e.text, e.atSimMs]),
    };
    remove(); clearTimedSpeech(f.world); return result;
  }
  const coarse = run(20_000), fine = run(100);
  expect(coarse).toEqual(fine);
  expect(coarse.bo).toBe("one two "); expect(coarse.cy).toBe("three four five six.");
  expect(coarse.complete).toEqual([0, 0]);
});

test("visible body activity remains visible while that actor speaks", () => {
  const f = fixture();
  const remove = registerAgentWorldCapabilities(f.world, f.ada, {
    ready: () => false, busy: () => true, context: () => "", execute: () => false,
    publicActivity: () => ({ kind: "holding" }),
  });
  try { f.speak("I am holding this."); expect(getObservedPublicActivity(f.world, f.bo, f.ada)).toBe("holding while speaking"); }
  finally { clearTimedSpeech(f.world); remove(); }
});

test("native body reservations expose an allowlisted physical operation, never a hidden target or arbitrary command", () => {
  const f = fixture(), pump = createObjectEntity(f.world, { name: "Drain pump", roomId: f.room });
  expect(reserveSimulationResources(f.world, f.ada, "install-pump", ["body"], { activity: { kind: "operating", operation: "installing", targetEid: pump } })).toBe(true);
  f.speak("Hold this, please.");
  expect(getObservedPublicActivity(f.world, f.bo, f.ada)).toBe("installing Drain pump while speaking");
  setLocatedIn(f.world, pump, f.away);
  expect(getObservedPublicActivity(f.world, f.bo, f.ada)).toBe("installing while speaking");
  releaseSimulationResources(f.world, f.ada, "install-pump");
  reserveSimulationResources(f.world, f.ada, "bad-label", ["body"], { activity: { kind: "operating", operation: "PRIVATE_PASSWORD_123" as any } });
  expect(getObservedPublicActivity(f.world, f.bo, f.ada)).toBe("operating while speaking");
  releaseSimulationResources(f.world, f.ada, "bad-label");
});
