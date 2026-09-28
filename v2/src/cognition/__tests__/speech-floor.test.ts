import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { setLocatedIn } from "../../ecs/location";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { advanceSimulationTimeline, isSimulationResourceBusy, reserveSimulationResources } from "../../runtime/simulation-timeline";
import { beginTimedSpeech, clearTimedSpeech, estimateSpeechDurationMs, getSpeakingActivity, interruptTimedSpeech,
  readLocalSpeechOpportunity, requestConversationTurn, releaseConversationTurn,
  SPEECH_HANDOFF_GAP_MS, SPEECH_REPEAT_GAP_MS } from "../timed-speech";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
afterEach(() => { for (const world of worlds.splice(0)) clearTimedSpeech(world); });
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); worlds.push(world);
  const hall = createRoomEntity(world, { name: "Hall" }), kitchen = createRoomEntity(world, { name: "Kitchen" });
  const actor = (name: string, roomId = hall) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId });
  const ada = actor("Ada"), bo = actor("Bo"), cy = actor("Cy", kitchen);
  const advance = (delta: number) => advanceSimulationTimeline(world, delta, { integrate: () => {} });
  const begin = (eid: number, content: string, id: string, floor: "conversational" | "urgent" = "conversational") =>
    beginTimedSpeech(world, eid, content, id, () => {}, () => {}, { floor });
  return { world, hall, kitchen, ada, bo, cy, advance, begin };
}

test("the first admitted speaker takes the local floor; denied proposals never become hidden queued speeches", () => {
  const f = fixture(), rejected = jest.fn(), cancelled = jest.fn();
  expect(f.begin(f.ada, "I found the key.", "first")).toBe(true);
  expect(beginTimedSpeech(f.world, f.bo, "OBSOLETE_PROPOSAL", "denied", rejected, cancelled, { floor: "conversational" })).toBe(false);
  const busy = readLocalSpeechOpportunity(f.world, f.bo);
  expect(busy).toMatchObject({ available: false, reason: "another_speaker", speakerIds: [f.ada] });
  expect(busy).not.toHaveProperty("content"); expect(busy).not.toHaveProperty("spokenText");
  expect(f.begin(f.cy, "An independent conversation.", "kitchen")).toBe(true);
  f.advance(20_000);
  expect(rejected).not.toHaveBeenCalled(); expect(cancelled).not.toHaveBeenCalled();
  expect(getSpeakingActivity(f.world, f.bo)).toBeUndefined();
  expect(f.begin(f.bo, "A fresh response.", "fresh")).toBe(true);
  expect(getSpeakingActivity(f.world, f.bo)?.executionId).toBe("fresh");
});

test("opportunity reads are pure and do not reserve the floor or assign entity identities", () => {
  const f = fixture(), before = JSON.stringify(f.world.time);
  const identities = [f.ada, f.bo, f.hall].map(id => [hasComponent(f.world, id, WorkingMemoryIdentity), WorkingMemoryIdentity.id[id]]);
  for (let i = 0; i < 20; i++) expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
  expect([f.ada, f.bo, f.hall].map(id => [hasComponent(f.world, id, WorkingMemoryIdentity), WorkingMemoryIdentity.id[id]])).toEqual(identities);
  expect(JSON.stringify(f.world.time)).toBe(before);
  expect(isSimulationResourceBusy(f.world, f.bo, "voice")).toBe(false);
  expect(f.begin(f.ada, "Hello.", "won")).toBe(true);
});

test("a stalled turn request expires without emitting words or reviving after another conversation", () => {
  const f = fixture();
  requestConversationTurn(f.world, f.bo, "Ada", () => true);
  expect(readLocalSpeechOpportunity(f.world, f.ada).reason).toBe("queued_turn");
  expect(getSpeakingActivity(f.world, f.bo)).toBeUndefined();
  f.advance(3000);
  expect(f.begin(f.ada, "A new conversation.", "later")).toBe(true);
  f.advance(4000);
  expect(readLocalSpeechOpportunity(f.world, f.ada).reason).not.toBe("queued_turn");
  expect(getSpeakingActivity(f.world, f.bo)).toBeUndefined();
});

test("waiting behind an earlier queued author does not consume the free-floor revision grace", () => {
  const f = fixture(); setLocatedIn(f.world, f.cy, f.hall);
  requestConversationTurn(f.world, f.ada, "Bo", () => true);
  f.advance(100);
  requestConversationTurn(f.world, f.bo, "Ada", () => true);
  f.advance(2400); // Earlier author takes most of its grace to finish wording.
  expect(f.begin(f.ada, "This is the first actual turn.", "earlier")).toBe(true);
  f.advance(estimateSpeechDurationMs("This is the first actual turn.") + SPEECH_HANDOFF_GAP_MS);
  requestConversationTurn(f.world, f.cy, "Ada", () => true);
  expect(readLocalSpeechOpportunity(f.world, f.cy).reason).toBe("queued_turn");
  expect(f.begin(f.bo, "My next turn.", "next")).toBe(true);
});

test.each(["leave", "replacement", "restart", "release", "clear", "new intent"])("turn request cannot block after %s", change => {
  const f = fixture(); startCommittedEvents(f.world); let valid = true;
  requestConversationTurn(f.world, f.bo, "Ada", () => valid);
  if (change === "leave") setLocatedIn(f.world, f.bo, f.kitchen);
  if (change === "replacement") WorkingMemoryIdentity.id[f.bo] = "new owner";
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "release") releaseConversationTurn(f.world, f.bo);
  if (change === "clear") clearTimedSpeech(f.world);
  if (change === "new intent") valid = false;
  expect(readLocalSpeechOpportunity(f.world, f.ada).available).toBe(true);
});

test("an explicit urgent interruption can bypass a waiting turn without cancelling its intent", () => {
  const f = fixture(); requestConversationTurn(f.world, f.bo, "Ada", () => true);
  expect(f.begin(f.ada, "Stop!", "warning", "urgent")).toBe(true);
  f.advance(1100);
  expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
});

test("a recent speaker yields a short opportunity to others without imposing a wall-time cooldown", () => {
  const f = fixture(), duration = estimateSpeechDurationMs("Hello.");
  f.begin(f.ada, "Hello.", "ada-turn"); f.advance(duration);
  expect(readLocalSpeechOpportunity(f.world, f.bo)).toMatchObject({ reason: "handoff_gap", nextCheckAtSimMs: duration + SPEECH_HANDOFF_GAP_MS });
  expect(readLocalSpeechOpportunity(f.world, f.ada)).toMatchObject({ reason: "recent_turn", nextCheckAtSimMs: duration + SPEECH_REPEAT_GAP_MS });
  f.advance(SPEECH_HANDOFF_GAP_MS);
  expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
  expect(f.begin(f.ada, "Repeating myself.", "too-soon")).toBe(false);
  expect(f.begin(f.bo, "Thanks.", "bo-turn")).toBe(true);
  f.advance(estimateSpeechDurationMs("Thanks.") + SPEECH_HANDOFF_GAP_MS);
  expect(readLocalSpeechOpportunity(f.world, f.ada).available).toBe(true);
  expect(readLocalSpeechOpportunity(f.world, f.bo).reason).toBe("recent_turn");
});

test("the local floor follows real rooms and does not block independent body work", () => {
  const f = fixture();
  expect(reserveSimulationResources(f.world, f.ada, "walking", ["body"])).toBe(true);
  expect(f.begin(f.ada, "One two three four five.", "walking-voice")).toBe(true);
  expect(readLocalSpeechOpportunity(f.world, f.bo).reason).toBe("another_speaker");
  setLocatedIn(f.world, f.ada, f.kitchen);
  expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
  expect(readLocalSpeechOpportunity(f.world, f.cy).reason).toBe("another_speaker");
  expect(isSimulationResourceBusy(f.world, f.ada, "body")).toBe(true);
  f.advance(estimateSpeechDurationMs("One two three four five."));
  expect(isSimulationResourceBusy(f.world, f.ada, "body")).toBe(true);
});

test("urgent admission is deliberate and bypasses another speaker, never one's own busy voice", () => {
  const f = fixture(); f.begin(f.ada, "A sentence still underway.", "normal");
  expect(f.begin(f.bo, "Stop!", "urgent", "urgent")).toBe(true);
  expect(readLocalSpeechOpportunity(f.world, f.bo, { mode: "urgent" }).reason).toBe("voice_busy");
  expect(f.begin(f.bo, "Another warning.", "duplicate", "urgent")).toBe(false);
});

test("an overlong bounded unit is rejected whole, never clipped or scheduled for later", () => {
  const f = fixture(), finish = jest.fn(), abandon = jest.fn();
  expect(beginTimedSpeech(f.world, f.ada, "one two three four five six seven", "overlong", finish, abandon,
    { floor: "conversational", maxDurationMs: 1500 })).toBe(false);
  expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
  f.advance(10_000); expect(finish).not.toHaveBeenCalled(); expect(abandon).not.toHaveBeenCalled();
  expect(beginTimedSpeech(f.world, f.ada, "Done.", "brief", finish, abandon,
    { floor: "conversational", maxDurationMs: 1500 })).toBe(true);
  f.advance(1500); expect(finish).toHaveBeenCalledWith(expect.objectContaining({ success: true, spokenText: "Done." }));
});

test("explicit interruption commits only the emitted prefix once and never releases an independent body reservation", () => {
  const f = fixture(), finish = jest.fn(), abandon = jest.fn(), words: string[] = [];
  reserveSimulationResources(f.world, f.ada, "carrying", ["body"]);
  beginTimedSpeech(f.world, f.ada, "one two UNHEARD secret suffix", "cut", finish, abandon, { floor: "conversational", fragment: f => words.push(f.content) });
  f.advance(1100);
  expect(interruptTimedSpeech(f.world, f.ada, "new_world_evidence", { executionId: "cut" })).toBe(true);
  expect(interruptTimedSpeech(f.world, f.ada, "duplicate", { executionId: "cut" })).toBe(false);
  expect(finish).toHaveBeenCalledTimes(1); expect(abandon).not.toHaveBeenCalled();
  expect(finish.mock.calls[0][0]).toMatchObject({ success: false, reason: "new_world_evidence", spokenText: "one two ", emittedTokens: 2,
    interval: { executionId: "cut", completedAtSimMs: 1100 } });
  expect(finish.mock.calls[0][0].audience.size).toBe(0);
  expect(isSimulationResourceBusy(f.world, f.ada, "body")).toBe(true);
  expect(isSimulationResourceBusy(f.world, f.ada, "voice")).toBe(false);
  f.advance(10_000); expect(words).toEqual(["one ", "two "]); expect(finish).toHaveBeenCalledTimes(1);
});

test("a stale interruption cannot stop the replacement utterance, including a replacement admitted by the finish callback", () => {
  const f = fixture(), current = jest.fn();
  beginTimedSpeech(f.world, f.ada, "Old sentence.", "old", () => {
    expect(f.begin(f.ada, "New evidence.", "new", "urgent")).toBe(true);
    current();
  }, () => {});
  expect(interruptTimedSpeech(f.world, f.ada, "replace", { executionId: "old" })).toBe(true);
  expect(current).toHaveBeenCalledTimes(1);
  expect(interruptTimedSpeech(f.world, f.ada, "stale", { executionId: "old" })).toBe(false);
  expect(getSpeakingActivity(f.world, f.ada)?.executionId).toBe("new");
});

test("retired actor and room identities cannot hold a replacement conversation floor", () => {
  const f = fixture(), abandon = jest.fn();
  beginTimedSpeech(f.world, f.ada, "Obsolete identity.", "old-life", () => {}, abandon, { floor: "conversational" });
  WorkingMemoryIdentity.id[f.ada] = "replacement actor lifetime";
  expect(readLocalSpeechOpportunity(f.world, f.bo).available).toBe(true);
  expect(interruptTimedSpeech(f.world, f.ada, "stale identity", { executionId: "old-life" })).toBe(false);
  f.advance(1000); expect(abandon).toHaveBeenCalledTimes(1);
  f.begin(f.bo, "A new turn.", "room-life");
  WorkingMemoryIdentity.id[f.hall] = "replacement room lifetime";
  expect(readLocalSpeechOpportunity(f.world, f.ada).available).toBe(true);
});

test("a reentrant clear during obsolete-voice cancellation cannot resurrect the incoming speech proposal", () => {
  const f = fixture(), finished = jest.fn();
  beginTimedSpeech(f.world, f.ada, "Old context.", "obsolete", () => {}, () => clearTimedSpeech(f.world));
  const remove = registerAgentWorldCapabilities(f.world, f.ada, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  try {
    expect(beginTimedSpeech(f.world, f.ada, "New but cancelled context.", "incoming", finished, () => {}, { floor: "conversational" })).toBe(false);
    expect(isSimulationResourceBusy(f.world, f.ada, "voice")).toBe(false);
    f.advance(10_000); expect(finished).not.toHaveBeenCalled();
  } finally { remove(); }
});
