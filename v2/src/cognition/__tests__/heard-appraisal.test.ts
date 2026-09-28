import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, SocialMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { workingMemoryEntityRef } from "../working-memory";
import { recordCommittedSpeech, recordHeardSpeechFragment } from "../social-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { captureHeardAppraisal, prepareHeardAppraisal } from "../heard-appraisal";
import { queueExperiencedEvent, snapshotExperienceAppraisal } from "../experience-appraisal";

function fixture() {
  const world = createArgosWorld("Heard appraisal boundaries"); initializePrefabs(world);
  world.meta.experienceReconsideration = true;
  const room = createRoomEntity(world, { name: "Hall" }), remote = createRoomEntity(world, { name: "Remote" });
  const actor = createAgentEntity(world, { name: "Ada", role: "guest", systemPrompt: "Own priorities", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "guest", systemPrompt: "PRIVATE_MIND", roomId: room });
  for (const eid of [actor, other]) workingMemoryEntityRef(world, eid);
  startCommittedEvents(world);
  const speak = (text = "I have lost my home.") => recordCommittedSpeech(world, other, text, "Ada")!;
  return { world, room, remote, actor, other, speak };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline only")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("hearing alone queues nothing; selection queues exact attributed words once", () => {
  const f = fixture(), speech = f.speak();
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toBeUndefined();
  const c = captureHeardAppraisal(f.world, f.actor);
  expect(c.receipts.get(speech.id)).toMatchObject({ atSimMs: 0, channel: "heard-speech" });
  expect(c.receipts.get(speech.id)?.content).toContain("I have lost my home.");
  expect(JSON.stringify([...c.receipts.values()])).not.toContain("PRIVATE_MIND");
  const p = prepareHeardAppraisal(c, [speech.id])!;
  expect(p.commit()).toBe(true); expect(p.commit()).toBe(false);
  expect(snapshotExperienceAppraisal(f.world, f.actor)).toMatchObject({ pending: 1 });
  expect(captureHeardAppraisal(f.world, f.actor).receipts.size).toBe(0);
  expect(captureHeardAppraisal(f.world, f.other).receipts.size).toBe(0);
});

test("a remote disclosure and an interrupted fragment are not completed heard evidence", () => {
  const f = fixture(); setLocatedIn(f.world, f.other, f.remote); const remote = f.speak("REMOTE_SECRET");
  setLocatedIn(f.world, f.other, f.room);
  recordHeardSpeechFragment(f.world, f.other, { executionId: "partial", roomId: f.room, content: "I was ", tokenIndex: 0,
    totalTokens: 3, audience: new Set([f.actor]), startedAtSimMs: 0, heardAtSimMs: 0 });
  const c = captureHeardAppraisal(f.world, f.actor);
  expect(c.receipts.size).toBe(0); expect(prepareHeardAppraisal(c, [remote.id])).toBeUndefined();
});

test.each([{ ids: [] }, { ids: ["invented"] }, { ids: [1] }, { ids: [null] }])("rejects malformed or unowned selection $ids", ({ ids }) => {
  const f = fixture(); f.speak(); expect(prepareHeardAppraisal(captureHeardAppraisal(f.world, f.actor), ids)).toBeUndefined();
});

test("duplicate and oversized selections fail without partial queue writes", () => {
  const f = fixture(), ids = [f.speak().id, f.speak().id, f.speak().id, f.speak().id], c = captureHeardAppraisal(f.world, f.actor);
  expect(prepareHeardAppraisal(c, [ids[0], ids[0]])).toBeUndefined();
  expect(prepareHeardAppraisal(c, ids)).toBeUndefined(); expect(snapshotExperienceAppraisal(f.world, f.actor)).toBeUndefined();
});

test.each(["disabled", "appraisal_disabled", "source", "owner", "inactive", "deleted", "rewritten"])("rejects a stale %s after preparation", change => {
  const f = fixture(), speech = f.speak(), p = prepareHeardAppraisal(captureHeardAppraisal(f.world, f.actor), [speech.id])!;
  if (change === "disabled") f.world.meta.experienceReconsideration = false;
  if (change === "appraisal_disabled") f.world.meta.experienceAppraisalEnabled = false;
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "inactive") Agent.active[f.actor] = false;
  if (change === "deleted") removeEntity(f.world, f.actor);
  if (change === "rewritten") { addComponent(f.world, f.actor, SocialMemory); SocialMemory.turnsJson[f.actor] = JSON.stringify([{ ...speech, own: false, content: "rewritten" }]); }
  expect(p.commit()).toBe(false);
});

test("queue capacity is checked for the entire batch, including work arriving after preparation", () => {
  const f = fixture(), ids = [f.speak().id, f.speak().id], p = prepareHeardAppraisal(captureHeardAppraisal(f.world, f.actor), ids)!;
  for (let n = 0; n < 7; n++) queueExperiencedEvent(f.world, f.actor, { id: `existing:${n}`, channel: "heard-speech", source: "heard", content: "earlier words", atSimMs: 0 });
  expect(p.current()).toBe(false); expect(p.commit()).toBe(false);
  expect(snapshotExperienceAppraisal(f.world, f.actor)?.pending).toBe(7);
});

test("a newer selection cannot replay older speech backward into the same channel", () => {
  const f = fixture(), earlier = f.speak(); advanceSimulationTime(f.world, 1, 1000); const later = f.speak();
  expect(prepareHeardAppraisal(captureHeardAppraisal(f.world, f.actor), [later.id])!.commit()).toBe(true);
  expect(captureHeardAppraisal(f.world, f.actor).receipts.has(earlier.id)).toBe(false);
});
