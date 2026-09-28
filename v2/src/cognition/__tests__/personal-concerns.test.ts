import { addComponent } from "bitecs";
import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, PersonalConcerns, WorkingMemoryIdentity } from "../../ecs/components";
import { workingMemoryEntityRef } from "../working-memory";
import { createGeneratedIntention } from "../goal-lifecycle";
import { captureGoalReviewContext, prepareGoalReview } from "../goal-pursuit";
import { getPersonalConcerns, recordPersonalConcern, formatPersonalConcerns } from "../personal-concerns";
import { getCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { personalConcernContext } from "../personal-concerns";

function fixture() {
  const world = createArgosWorld("Private significance"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "I care about friends", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "I care about friends", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, peer);
  const concern = { channel: "friend:message", evidenceIds: ["read:1"], appraisal: "PRIVATE: A friend cancelled an important shared plan.",
    significance: "Our time together matters to me", importance: .8, appraisedAtSimMs: 0 };
  return { world, actor, peer, concern };
}
test("deferring an external objective does not erase its personal significance or tell anyone", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, f.concern);
  const goal = createGeneratedIntention(f.world, f.actor, { description: "Arrange a different time", priority: 9, kind: "social" }, "foreground")!;
  prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: goal, disposition: "defer", reason: "Await their response", afterSeconds: 30, wake: { kind: "review" } })!.commit();
  expect(Goal.status[goal]).toBe("paused"); expect(formatPersonalConcerns(f.world, f.actor)).toContain(f.concern.appraisal);
  expect(getPersonalConcerns(f.world, f.peer)).toEqual([]); expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE");
});
test("new low-significance appraisal replaces an intense interpretation without discarding the resolution", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, f.concern);
  recordPersonalConcern(f.world, f.actor, { ...f.concern, channel: "work", evidenceIds: ["work:1"] });
  recordPersonalConcern(f.world, f.actor, { ...f.concern, evidenceIds: ["read:2"], appraisal: "We resolved the scheduling confusion", importance: .1 });
  expect(getPersonalConcerns(f.world, f.actor)).toMatchObject([
    { channel: "work", importance: .8 },
    { channel: "friend:message", importance: .1, appraisal: "We resolved the scheduling confusion" },
  ]);
});
test("bounded private recall neither aliases mutable inputs nor leaks across recycled ownership", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, f.concern); f.concern.evidenceIds.push("invented");
  expect(getPersonalConcerns(f.world, f.actor)[0].evidenceIds).toEqual(["read:1"]);
  for (let i = 0; i < 12; i++) recordPersonalConcern(f.world, f.actor, { ...f.concern, channel: `channel:${i}`, importance: i / 12 });
  expect(getPersonalConcerns(f.world, f.actor)).toHaveLength(8);
  WorkingMemoryIdentity.id[f.actor] = "replacement"; expect(getPersonalConcerns(f.world, f.actor)).toEqual([]);
});
test("malformed saves, future events and stopped worlds do not become concerns", () => {
  const f = fixture(); addComponent(f.world, f.actor, PersonalConcerns); PersonalConcerns.ownerKey[f.actor] = WorkingMemoryIdentity.id[f.actor];
  PersonalConcerns.itemsJson[f.actor] = "[null,{},123]"; expect(getPersonalConcerns(f.world, f.actor)).toEqual([]);
  expect(recordPersonalConcern(f.world, f.actor, { ...f.concern, appraisedAtSimMs: 500 })).toBe(false);
  stopCommittedEvents(f.world); expect(recordPersonalConcern(f.world, f.actor, f.concern)).toBe(false);
});
test("private significance survives serialization without becoming public scene knowledge", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, f.concern);
  const saved = serializeWorld(f.world, createSystemRegistry()), restored = createArgosWorld("Restored");
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  expect(getPersonalConcerns(restored, oldToNewId.get(f.actor)!)).toEqual([f.concern]);
  expect(getPersonalConcerns(restored, oldToNewId.get(f.peer)!)).toEqual([]);
});

test("experience age differs from interpretation age and survives save/reload", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 60_000);
  const concern = { ...f.concern, experiencedAtSimMs: 5_000, appraisedAtSimMs: 60_000, integration: "historical_only" as const };
  expect(recordPersonalConcern(f.world, f.actor, concern)).toBe(true);
  advanceSimulationTime(f.world, 2, 5_000);
  expect(personalConcernContext(f.world, f.actor)).toMatchObject([{ experienceAgeSeconds: 60, appraisalAgeSeconds: 5, integration: "historical_only" }]);
  const saved = serializeWorld(f.world, createSystemRegistry()), restored = createArgosWorld("Restored");
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  expect(personalConcernContext(restored, oldToNewId.get(f.actor)!)).toEqual(personalConcernContext(f.world, f.actor));
  expect(personalConcernContext(restored, oldToNewId.get(f.peer)!)).toEqual([]);
});
test("legacy records report unknown experience age rather than dating the event to its interpretation", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, f.concern);
  advanceSimulationTime(f.world, 1, 20_000);
  expect(personalConcernContext(f.world, f.actor)).toMatchObject([{ experienceAgeSeconds: null, appraisalAgeSeconds: 20 }]);
});
test("a replay or older experience cannot replace a newer concern or quiet it", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 100_000);
  const current = { ...f.concern, experiencedAtSimMs: 50_000, appraisedAtSimMs: 60_000, integration: "current" as const };
  expect(recordPersonalConcern(f.world, f.actor, current)).toBe(true);
  expect(recordPersonalConcern(f.world, f.actor, { ...current, appraisedAtSimMs: 90_000 })).toBe(false);
  expect(recordPersonalConcern(f.world, f.actor, { ...current, evidenceIds: ["older"], experiencedAtSimMs: 30_000, appraisedAtSimMs: 90_000, importance: .1 })).toBe(false);
  expect(getPersonalConcerns(f.world, f.actor)).toEqual([current]);
});
test.each([NaN, -1, 20_000])("invalid/future experience timestamp %s is rejected before mutation", experiencedAtSimMs => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 10_000);
  expect(recordPersonalConcern(f.world, f.actor, { ...f.concern, appraisedAtSimMs: 10_000, experiencedAtSimMs })).toBe(false);
  expect(getPersonalConcerns(f.world, f.actor)).toEqual([]);
});
test("wall-clock passage does not age a concern and formatting never edits stored significance", () => {
  const f = fixture(); recordPersonalConcern(f.world, f.actor, { ...f.concern, experiencedAtSimMs: 0 });
  const before = PersonalConcerns.itemsJson[f.actor];
  const wall = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
  try {
    expect(personalConcernContext(f.world, f.actor)).toMatchObject([{ experienceAgeSeconds: 0, appraisalAgeSeconds: 0 }]);
    formatPersonalConcerns(f.world, f.actor);
    expect(PersonalConcerns.itemsJson[f.actor]).toBe(before);
  } finally { wall.mockRestore(); }
});
