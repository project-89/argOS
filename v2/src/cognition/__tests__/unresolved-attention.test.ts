import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Attention, WorkingMemoryIdentity } from "../../ecs/components";
import { addPerception, buildAgentContext, clearAllAgentMemory, getAgentPerceptions } from "../agent-mind";
import { snapshotAttentionSignals, hasDueAttentionSignal, markAttentionSignalsPresented, prepareAttentionReview,
  resolveAttentionSignal, formatAttentionSignals, snapshotAttentionResolutions, clearAttentionSignals, formatDueAttentionReview } from "../unresolved-attention";
import { serializeWorld } from "../../persistence/world-persistence";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { recordCommittedSpeech } from "../social-memory";
import { setLocatedIn } from "../../ecs/location";

function fixture() {
  const world = createArgosWorld("Experienced attention"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const person = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Choose your own response.", roomId: room });
  const actor = person("Ada"), other = person("Bo");
  const signal = (signalKey = "message:one") => addPerception(world, actor, { type: "attention", source: "indicator",
    content: "My familiar indicator flashes; I do not know its contents.", signalKey });
  return { world, room, actor, other, signal };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Attention tests are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("timeout-only review compares bounded completed heard replies without waking early or declaring success", () => {
  const f=fixture();startCommittedEvents(f.world);f.signal();
  recordCommittedSpeech(f.world,f.other,"OLD CLAIM","Ada");
  const issued=snapshotAttentionSignals(f.world,f.actor);
  prepareAttentionReview(f.world,f.actor,issued,{signalId:issued[0].id,disposition:"defer",reason:"Hear the answer first",afterSeconds:10})!.commit();
  for(let i=1;i<=5;i++){f.world.time.elapsed=i*1000;recordCommittedSpeech(f.world,f.other,`Answer ${i}`,"Ada");}
  expect(hasDueAttentionSignal(f.world,f.actor)).toBe(false);
  expect(formatDueAttentionReview(f.world,f.actor)).toBe("");
  f.world.time.elapsed=10000;
  const prompt=formatDueAttentionReview(f.world,f.actor);
  expect(prompt).toContain("Answer 1");expect(prompt).toContain("Answer 4");expect(prompt).toContain("Answer 5");
  expect(prompt).not.toContain("Answer 2");expect(prompt).not.toContain("OLD CLAIM");
  expect(prompt).toContain('"omittedHeardTurns":2');expect(prompt).toContain("attributed claims");
  expect(snapshotAttentionSignals(f.world,f.actor)[0].status).toBe("deferred");
  stopCommittedEvents(f.world);startCommittedEvents(f.world);
  expect(formatDueAttentionReview(f.world,f.actor)).not.toContain("Answer 1");
});

test("timeout review cannot learn remote or own speech, and clock rewind cannot project future replies", () => {
  const f=fixture();startCommittedEvents(f.world);f.signal();
  const signal=snapshotAttentionSignals(f.world,f.actor)[0];
  prepareAttentionReview(f.world,f.actor,[signal],{signalId:signal.id,disposition:"defer",reason:"Wait briefly",afterSeconds:5})!.commit();
  f.world.time.elapsed=6000;recordCommittedSpeech(f.world,f.actor,"MY OWN WORDS");
  setLocatedIn(f.world,f.other,createRoomEntity(f.world,{name:"Remote"}));
  recordCommittedSpeech(f.world,f.other,"REMOTE SECRET");
  expect(formatDueAttentionReview(f.world,f.actor)).not.toMatch(/MY OWN WORDS|REMOTE SECRET/);
  setLocatedIn(f.world,f.other,f.room);f.world.time.elapsed=8000;recordCommittedSpeech(f.world,f.other,"LATER REPLY","Ada");
  f.world.time.elapsed=5000;expect(formatDueAttentionReview(f.world,f.actor)).not.toContain("LATER REPLY");
});

test("early dialogue reminders cannot hide the actor's chosen timeout", () => {
  const f = fixture(); startCommittedEvents(f.world); f.signal();
  const issued = snapshotAttentionSignals(f.world, f.actor);
  prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
    reason: "Hear this answer, then reconsider", afterSeconds: 15, wake: { kind: "heard_evidence" } })!.commit();
  f.world.time.elapsed = 4000; recordCommittedSpeech(f.world, f.other, "Another joke", "Ada");
  markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 14999; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 15000; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ reason: "Hear this answer, then reconsider", reconsiderAtSimMs: 15000 });
  markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false); // No per-tick reminder storm.
});

test("successive choices retain bounded first-and-recent review history without forcing resolution", () => {
  const f = fixture(); startCommittedEvents(f.world); f.signal();
  for (let i = 0; i < 8; i++) {
    f.world.time.elapsed = i * 10000;
    const issued = snapshotAttentionSignals(f.world, f.actor);
    expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
      reason: i === 0 ? "Hear Bo's answer first" : `I choose to keep listening, review ${i + 1}`,
      afterSeconds: 15, wake: { kind: "heard_evidence" } })?.commit()).toBe(true);
    f.signal(); // Re-emission does not create a choice.
  }
  const row = snapshotAttentionSignals(f.world, f.actor)[0];
  expect(row.previousReviews).toEqual([
    { consideredAtSimMs: 0, status: "deferred", reason: "Hear Bo's answer first", reconsiderAtSimMs: 15000 },
    { consideredAtSimMs: 50000, status: "deferred", reason: "I choose to keep listening, review 6", reconsiderAtSimMs: 65000 },
    { consideredAtSimMs: 60000, status: "deferred", reason: "I choose to keep listening, review 7", reconsiderAtSimMs: 75000 },
  ]);
  const before = Attention.signalsJson[f.actor];
  expect(formatAttentionSignals(f.world, f.actor)).toContain("Hear Bo's answer first");
  expect(formatAttentionSignals(f.world, f.actor)).toContain('"priorReviews":8');
  expect(formatAttentionSignals(f.world, f.actor)).toContain('"omittedPreviousReviews":4');
  expect(formatAttentionSignals(f.world, f.other)).toBe("");
  f.world.time.elapsed = 71000; recordCommittedSpeech(f.world, f.other, "Actually, I do not know", "Ada");
  const due = formatDueAttentionReview(f.world, f.actor);
  expect(due).toContain("Hear Bo's answer first");
  expect(due).toContain('"speaker":"Bo"');
  expect(due).toContain("Actually, I do not know");
  expect(due).toContain("not proof that your reason for waiting was satisfied");
  expect(Attention.signalsJson[f.actor]).toBe(before);
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
  expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)).toEqual([]);
});

test("experienced signals survive perception churn without leaking unread contents or other minds", () => {
  const f = fixture(); f.signal();
  for (let i = 0; i < 70; i++) addPerception(f.world, f.actor, { type: "speech", source: "Bo", content: `Recent unrelated sentence ${i}` });
  expect(getAgentPerceptions(f.world, f.actor).length).toBeLessThanOrEqual(20);
  expect(buildAgentContext(f.world, f.actor)).toContain("My familiar indicator flashes");
  expect(snapshotAttentionSignals(f.world, f.actor)).toHaveLength(1);
  expect(snapshotAttentionSignals(f.world, f.other)).toEqual([]);
  expect(formatAttentionSignals(f.world, f.other)).toBe("");
});

test("review history survives ECS serialization as private memory, never restored wake authority", () => {
  const f = fixture(); startCommittedEvents(f.world); f.signal();
  for (const now of [0, 1000]) {
    f.world.time.elapsed = now;
    const issued = snapshotAttentionSignals(f.world, f.actor);
    prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
      reason: "Stay with a grieving friend", afterSeconds: 120, wake: { kind: "heard_evidence" } })!.commit();
  }
  expect(JSON.stringify(serializeWorld(f.world, createSystemRegistry()))).toContain("previousReviews");
  const before = snapshotAttentionSignals(f.world, f.actor)[0];
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  f.world.time.elapsed = 2000; recordCommittedSpeech(f.world, f.other, "Thank you for staying", "Ada");
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false); // Historical wake cannot cross epochs.
  expect(snapshotAttentionSignals(f.world, f.actor)[0].previousReviews).toEqual(before.previousReviews);
  // A fresh deliberate choice to keep listening is valid; no increasing urgency or speech quota.
  const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
    reason: "Quiet company is still what I want", afterSeconds: 120 })?.commit()).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)[0].reconsiderAtSimMs).toBe(122000);
});

test("history edits invalidate pending reviews and clock rewind cannot overwrite a later choice", () => {
  const f = fixture(); f.signal();
  for (const now of [1000, 2000]) {
    f.world.time.elapsed = now; const issued = snapshotAttentionSignals(f.world, f.actor);
    prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "consider", reason: "I noticed" })!.commit();
  }
  const issued = snapshotAttentionSignals(f.world, f.actor);
  const pending = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "consider", reason: "Fresh choice" })!;
  const altered = structuredClone(issued); altered[0].previousReviews![0].reason = "Externally changed recollection";
  Attention.signalsJson[f.actor] = JSON.stringify(altered);
  expect(pending.commit()).toBe(false);
  f.world.time.elapsed = 1500;
  expect(prepareAttentionReview(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor),
    { signalId: issued[0].id, disposition: "consider", reason: "Before the last choice" })?.commit()).toBe(false);
});

test("legacy reviewed cues do not fabricate historical choices or become unreadable on review", () => {
  const f = fixture(); f.signal(); const rows = snapshotAttentionSignals(f.world, f.actor);
  Object.assign(rows[0], { status: "deferred", consideredAtSimMs: 0, reconsiderAtSimMs: 5000, reason: "Older saved choice" });
  Attention.signalsJson[f.actor] = JSON.stringify(rows);
  expect(formatAttentionSignals(f.world, f.actor)).toContain('"previousReviews":[]');
  expect(prepareAttentionReview(f.world, f.actor, rows, { signalId: rows[0].id, disposition: "consider", reason: "Review now" })?.commit()).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "considered", reviewRevision: 1 });
});

test("presentation is not consideration; unresolved signals are reconsidered on simulation time", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
  markAttentionSignalsPresented(f.world, f.actor, issued);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "unreviewed", lastPresentedAtSimMs: 0 });
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 1_200_000);
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 30_000;
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
});

test("the current decision receives one due cue, with no action authority or renewed deadline", () => {
  const f=fixture(); f.signal(); f.world.time.elapsed=1000; f.signal("second");
  const before=Attention.signalsJson[f.actor],text=formatDueAttentionReview(f.world,f.actor);
  expect(text).toContain(snapshotAttentionSignals(f.world,f.actor)[0].id);
  expect(text).not.toContain(snapshotAttentionSignals(f.world,f.actor)[1].id);
  expect(text).toContain("You may keep your current activity");
  expect(Attention.signalsJson[f.actor]).toBe(before);
  expect(formatDueAttentionReview(f.world,f.other)).toBe("");
  const issued=snapshotAttentionSignals(f.world,f.actor);
  for(const cue of issued) expect(prepareAttentionReview(f.world,f.actor,issued,{signalId:cue.id,disposition:"defer",reason:"Finish what I chose",afterSeconds:5})?.commit()).toBe(true);
  expect(formatDueAttentionReview(f.world,f.actor)).toBe("");
  f.world.time.elapsed=6000;expect(formatDueAttentionReview(f.world,f.actor)).toContain("Attention review due");
  markAttentionSignalsPresented(f.world,f.actor,snapshotAttentionSignals(f.world,f.actor));
  expect(formatDueAttentionReview(f.world,f.actor)).toBe("");
  expect(snapshotAttentionSignals(f.world,f.actor)[0].reconsiderAtSimMs).toBe(6000);
});

test("chosen heard-evidence deferral wakes on a new completed heard turn, never consideration or resolution", () => {
  const f = fixture(); startCommittedEvents(f.world); f.signal();
  recordCommittedSpeech(f.world, f.other, "Earlier answer", "Ada");
  const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
    reason: "Hear the next answer first", afterSeconds: 60, wake: { kind: "heard_evidence" } })?.commit()).toBe(true);
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 1000; f.signal();
  recordCommittedSpeech(f.world, f.actor, "My own words do not answer me", "Bo");
  addPerception(f.world, f.actor, { type: "speech", source: "Bo", content: "Partial or described speech" });
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 2000; recordCommittedSpeech(f.world, f.other, "Here is what happened", "Ada");
  const before = Attention.signalsJson[f.actor];
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
  expect(formatDueAttentionReview(f.world, f.actor)).toContain("New completed dialogue");
  expect(Attention.signalsJson[f.actor]).toBe(before);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "deferred", reconsiderAtSimMs: 60000 });
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
  markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false); // One wake does not spin every tick.
  const next = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, next, { signalId: next[0].id, disposition: "defer",
    reason: "I still choose to wait", afterSeconds: 60, wake: { kind: "heard_evidence" } })?.commit()).toBe(true);
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false); // Previously heard answer cannot wake again.
  f.world.time.elapsed = 62000; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
});

test("heard-evidence wake respects remote speech, owner, epoch, clock and timeout", () => {
  const f = fixture(); startCommittedEvents(f.world); f.signal();
  const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
    reason: "Wait for more evidence", afterSeconds: 60, wake: { kind: "heard_evidence" } })?.commit()).toBe(true);
  const elsewhere = createRoomEntity(f.world, { name: "Remote room" }); setLocatedIn(f.world, f.other, elsewhere);
  f.world.time.elapsed = 1000; recordCommittedSpeech(f.world, f.other, "Not heard remotely", "Ada");
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  setLocatedIn(f.world, f.other, f.room); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  recordCommittedSpeech(f.world, f.other, "Different epoch", "Ada");
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  for (const now of [-1, NaN, Infinity]) { f.world.time.elapsed = now; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false); }
  f.world.time.elapsed = 60000; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true); // Old wake grants nothing; timeout survives.
  expect(hasDueAttentionSignal(f.world, f.other)).toBe(false);
});

test.each([{ kind: "phone_read" }, { kind: "heard_evidence", speaker: "invented" }, "heard_evidence", null])("unissued attention wake rejects %j", wake => {
  const f = fixture(); startCommittedEvents(f.world); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer", reason: "Wait", afterSeconds: 30, wake })).toBeUndefined();
  expect(snapshotAttentionSignals(f.world, f.actor)[0].status).toBe("unreviewed");
});

test("an explicit deferral survives repeated emissions but a different signal remains new", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const review = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer", reason: "Finish this conversation first", afterSeconds: 60 })!;
  expect(review.commit()).toBe(true);
  f.world.time.elapsed = 10_000; f.signal();
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "deferred", reason: "Finish this conversation first", reconsiderAtSimMs: 60_000, lastObservedAtSimMs: 10_000 });
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.signal("message:two"); expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)).toHaveLength(2);
});

test("actual resolution removes only the exact identified signal, not newer unread signals", () => {
  const f = fixture(); f.signal(); f.signal("message:two");
  expect(resolveAttentionSignal(f.world, f.actor, { source: "different source", signalKey: "message:one" })).toBe(false);
  expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor).map(x => x.signalKey)).toEqual(["message:two"]);
});

test("a considered newer cue is shown beside the older actual resolution, without conflating their evidence", () => {
  const f = fixture(); f.world.time.elapsed = 8200; f.signal();
  const old = snapshotAttentionSignals(f.world, f.actor)[0];
  f.world.time.elapsed = 24200; expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(true);
  f.world.time.elapsed = 28200; f.signal("message:two");
  const issued = snapshotAttentionSignals(f.world, f.actor), next = issued[0];
  f.world.time.elapsed = 31000;
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: next.id, disposition: "consider", reason: "I thought my earlier check accounted for it." })?.commit()).toBe(true);
  const before = Attention.signalsJson[f.actor], text = formatAttentionSignals(f.world, f.actor);
  expect(text).toContain(`Cue ${next.id} remains unresolved: first observed 2.8s ago`);
  expect(text).toContain(`different cue ${old.id}`); expect(text).toContain("resolved 6.8s ago, 4.0s before this cue began");
  expect(text).toContain("same named sensory source"); expect(text).toContain("not proof of the same physical entity");
  expect(text).toContain("Consideration is considered, not a resolution");
  expect(text).not.toMatch(/message:one|message:two/);
  expect(Attention.signalsJson[f.actor]).toBe(before); // Projection cannot reconsider or resolve it.
  expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 34200; f.signal("message:two");
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ id: next.id, observedAtSimMs: 28200, lastObservedAtSimMs: 34200, reconsiderAtSimMs: 61000 });
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([{ signalId: old.id, source: "indicator", firstObservedAtSimMs: 8200, resolvedAtSimMs: 24200 }]);
});

test("chronology never joins a different named source or labels a later sibling resolution as preceding this cue", () => {
  const f = fixture(); f.signal(); f.world.time.elapsed = 1000; f.signal("message:two");
  f.world.time.elapsed = 2000; resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" });
  expect(formatAttentionSignals(f.world, f.actor)).not.toContain("before this cue began");
  resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:two" });
  f.world.time.elapsed = 3000;
  addPerception(f.world, f.actor, { type: "attention", source: "other indicator", content: "A different cue.", signalKey: "other" });
  expect(formatAttentionSignals(f.world, f.actor)).not.toContain("different cue attention:");
  expect(snapshotAttentionResolutions(f.world, f.other)).toEqual([]);
});

test("resolution receipts require actual matching resolution, a live owner, an active epoch and chronological time", () => {
  const f = fixture(); f.world.time.elapsed = 1000; f.signal();
  expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "invented" })).toBe(false);
  expect(resolveAttentionSignal(f.world, f.other, { source: "indicator", signalKey: "message:one" })).toBe(false);
  for (const time of [500, Number.NaN, Number.POSITIVE_INFINITY]) {
    f.world.time.elapsed = time;
    expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(false);
  }
  f.world.time.elapsed = 2000; stopCommittedEvents(f.world);
  const before = Attention.resolutionsJson[f.actor];
  expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(false);
  expect(Attention.resolutionsJson[f.actor]).toBe(before);
  startCommittedEvents(f.world); expect(resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" })).toBe(true);
  expect(snapshotAttentionResolutions(f.world, f.actor)).toHaveLength(1);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]); // Archive is not authority in a replaced epoch.
  f.signal("message:two"); expect(formatAttentionSignals(f.world, f.actor)).not.toContain("different cue attention:");
});

test("receipt snapshots remain bounded, private, backwards-compatible and clearable without source-value leakage", () => {
  const f = fixture(); f.signal(); Attention.resolutionsJson[f.actor] = undefined as any;
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
  for (let i = 0; i < 24; i++) {
    f.world.time.elapsed = i * 1000; f.signal(`internal-message-key:${i}`);
    resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: `internal-message-key:${i}` });
  }
  expect(snapshotAttentionResolutions(f.world, f.actor)).toHaveLength(16);
  expect(Attention.resolutionsJson[f.actor]).not.toMatch(/internal-message-key|familiar indicator|contents/);
  const stored = Attention.resolutionsJson[f.actor], epoch = getCommittedEvents(f.world).sourceId;
  const serialized = serializeWorld(f.world, createSystemRegistry());
  expect(JSON.stringify(serialized)).toContain("resolutionsJson"); expect(JSON.stringify(serialized)).toContain(epoch!);
  addComponent(f.world, f.other, Attention); Attention.ownerKey[f.other] = WorkingMemoryIdentity.id[f.other]; Attention.resolutionsJson[f.other] = stored;
  expect(snapshotAttentionResolutions(f.world, f.other)).toEqual([]); // The receipt envelope has its own owner fence.
  const invalid = JSON.parse(stored); invalid.receipts = [{ ...invalid.receipts[0], resolvedAtSimMs: -1 }, { ...invalid.receipts[1], firstObservedAtSimMs: 999999 }];
  Attention.resolutionsJson[f.actor] = JSON.stringify(invalid); expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
  Attention.resolutionsJson[f.actor] = stored;
  clearAllAgentMemory(f.world); expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]); expect(Attention.resolutionsJson[f.actor]).toBe("");
  Attention.resolutionsJson[f.actor] = stored; stopCommittedEvents(f.world); clearAttentionSignals(f.world);
  expect(Attention.resolutionsJson[f.actor]).toBe("");
});

test("a cancelled task cannot partially clear the resolution archive", async () => {
  const f = fixture(); f.signal(); resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" });
  const before = Attention.resolutionsJson[f.actor], controller = new AbortController();
  await expect(withSimulationTask(controller.signal, async () => {
    controller.abort(new Error("Stopped task")); clearAttentionSignals(f.world);
  })).rejects.toThrow("Stopped task");
  expect(Attention.resolutionsJson[f.actor]).toBe(before);
});

test.each([
  { disposition: "defer", reason: "later", afterSeconds: 0 },
  { disposition: "defer", reason: "later", afterSeconds: 121 },
  { disposition: "defer", reason: "later", afterSeconds: 10.5 },
  { disposition: "defer", reason: "" , afterSeconds: 30 },
  { disposition: "consider", reason: "now", afterSeconds: 30 },
  { disposition: "resolved", reason: "I imagined handling it" },
  { disposition: "consider", reason: "now", extra: true },
])("invalid review has no effect: %j", input => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, ...input })).toBeUndefined();
  expect(snapshotAttentionSignals(f.world, f.actor)).toEqual(issued);
});

test("late or invented reviews cannot retire a resolved/replaced signal or another actor's record", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const raw = { signalId: issued[0].id, disposition: "consider", reason: "This deserves a look" };
  expect(prepareAttentionReview(f.world, f.other, [], raw)).toBeUndefined();
  const review = prepareAttentionReview(f.world, f.actor, issued, raw)!;
  resolveAttentionSignal(f.world, f.actor, { source: "indicator", signalKey: "message:one" }); f.signal();
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
  expect(snapshotAttentionSignals(f.world, f.actor)[0].status).toBe("unreviewed");
});

test("same-world source replacement fences a late review", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const review = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "consider", reason: "Now" })!;
  stopCommittedEvents(f.world); startCommittedEvents(f.world); expect(review.current()).toBe(false);
});

test("the ledger is bounded and explicitly reports retired older signals", () => {
  const f = fixture(); for (let i = 0; i < 40; i++) f.signal(`message:${i}`);
  expect(snapshotAttentionSignals(f.world, f.actor)).toHaveLength(16);
  expect(Attention.droppedSignals[f.actor]).toBe(24);
  expect(formatAttentionSignals(f.world, f.actor)).toContain("retired 24 older signals");
});

test("ECS snapshot retains experienced signals; explicit memory clearing removes them", () => {
  const f = fixture(); f.signal();
  const serialized = serializeWorld(f.world, createSystemRegistry());
  expect(JSON.stringify(serialized)).toContain("My familiar indicator flashes");
  clearAllAgentMemory(f.world); expect(snapshotAttentionSignals(f.world, f.actor)).toEqual([]);
});

test("actor ownership prevents sparse-array residue from becoming a new actor's memory", () => {
  const f = fixture(); f.signal(); const original = snapshotAttentionSignals(f.world, f.actor);
  addComponent(f.world, f.other, Attention); Attention.signalsJson[f.other] = JSON.stringify(original);
  Attention.ownerKey[f.other] = WorkingMemoryIdentity.id[f.actor];
  expect(snapshotAttentionSignals(f.world, f.other)).toEqual([]);
  removeEntity(f.world, f.actor); expect(snapshotAttentionSignals(f.world, f.actor)).toEqual([]);
});

test("presenting a past-due deferral never renews the actor's chosen deadline or reason", () => {
  const f = fixture(); f.world.time.elapsed = 28_200; f.signal();
  const issued = snapshotAttentionSignals(f.world, f.actor);
  f.world.time.elapsed = 33_500;
  expect(prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer",
    reason: "Finish talking, then reconsider", afterSeconds: 15 })?.commit()).toBe(true);
  markAttentionSignalsPresented(f.world, f.actor, issued);
  for (const at of [50_000, 81_000, 112_000]) {
    f.world.time.elapsed = at;
    expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
    markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
    expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ status: "deferred",
      consideredAtSimMs: 33_500, reconsiderAtSimMs: 48_500, reviewRevision: 1,
      reason: "Finish talking, then reconsider", nextPresentationAtSimMs: at + 30_000 });
    expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
    expect(formatAttentionSignals(f.world, f.actor)).toContain("Your chosen revisit time has arrived");
    expect(formatAttentionSignals(f.world, f.actor)).not.toContain("nextPresentationAtSimMs");
  }
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
});

test("unrelated prompt inclusions cannot slide the next due reminder indefinitely", () => {
  const f = fixture(); f.signal(); markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
  for (const at of [1000, 10_000, 29_000]) {
    f.world.time.elapsed = at; f.signal();
    markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
    expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  }
  const row = snapshotAttentionSignals(f.world, f.actor)[0];
  expect(row).toMatchObject({ status: "unreviewed", nextPresentationAtSimMs: 30_000 });
  expect(row.reconsiderAtSimMs).toBeUndefined(); expect(row.consideredAtSimMs).toBeUndefined();
  f.world.time.elapsed = 30_000; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
});

test("a genuinely chosen short revisit overrides engine backoff without requiring an action or resolution", () => {
  const f = fixture(); f.signal(); markAttentionSignalsPresented(f.world, f.actor, snapshotAttentionSignals(f.world, f.actor));
  f.world.time.elapsed = 1000; const issued = snapshotAttentionSignals(f.world, f.actor);
  const review = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "defer", reason: "Give me a moment", afterSeconds: 5 })!;
  expect(review.commit()).toBe(true); expect(review.commit()).toBe(false);
  markAttentionSignalsPresented(f.world, f.actor, issued);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ reconsiderAtSimMs: 6000, reviewRevision: 1 });
  expect(snapshotAttentionSignals(f.world, f.actor)[0].nextPresentationAtSimMs).toBeUndefined();
  f.world.time.elapsed = 5999; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(false);
  f.world.time.elapsed = 6000; expect(hasDueAttentionSignal(f.world, f.actor)).toBe(true);
  expect(snapshotAttentionResolutions(f.world, f.actor)).toEqual([]);
});

test("same-tick competing reviews cannot overwrite a newer identical-looking consideration", () => {
  const f = fixture(); f.signal(); let issued = snapshotAttentionSignals(f.world, f.actor);
  const raw = { signalId: issued[0].id, disposition: "consider", reason: "I noticed it" };
  expect(prepareAttentionReview(f.world, f.actor, issued, raw)?.commit()).toBe(true);
  issued = snapshotAttentionSignals(f.world, f.actor);
  const first = prepareAttentionReview(f.world, f.actor, issued, raw)!, stale = prepareAttentionReview(f.world, f.actor, issued, raw)!;
  expect(first.commit()).toBe(true); expect(stale.current()).toBe(false); expect(stale.commit()).toBe(false);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ reviewRevision: 2, consideredAtSimMs: 0, reconsiderAtSimMs: 30_000 });
});

test("rewind and cancelled task cannot admit or consume a chosen reconsideration", async () => {
  const f = fixture(); f.world.time.elapsed = 5000; f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const review = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "consider", reason: "Acknowledge this cue" })!;
  const before = Attention.signalsJson[f.actor];
  f.world.time.elapsed = 4000;
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
  markAttentionSignalsPresented(f.world, f.actor, issued); expect(Attention.signalsJson[f.actor]).toBe(before);
  f.world.time.elapsed = 5000; const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => review.commit()).toThrow();
    expect(() => markAttentionSignalsPresented(f.world, f.actor, issued)).toThrow();
  });
  expect(Attention.signalsJson[f.actor]).toBe(before); expect(review.current()).toBe(true);
  expect(review.commit()).toBe(true);
});

test("prepared review captures validated values and basis rather than mutable caller objects", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const raw = { signalId: issued[0].id, disposition: "defer", reason: "A short pause", afterSeconds: 5 };
  const review = prepareAttentionReview(f.world, f.actor, issued, raw)!;
  raw.afterSeconds = Number.POSITIVE_INFINITY; raw.reason = "A changed caller object";
  issued[0].reason = "Mutated snapshot"; issued[0].id = "not-the-issued-signal";
  expect(review.commit()).toBe(true);
  expect(snapshotAttentionSignals(f.world, f.actor)[0]).toMatchObject({ reason: "A short pause", reconsiderAtSimMs: 5000 });
});

test("periodic re-emission preserves review authority, but replacing the original cue onset does not", () => {
  const f = fixture(); f.signal(); const issued = snapshotAttentionSignals(f.world, f.actor);
  const review = prepareAttentionReview(f.world, f.actor, issued, { signalId: issued[0].id, disposition: "consider", reason: "Attend to that cue" })!;
  f.world.time.elapsed = 1000; f.signal(); expect(review.current()).toBe(true);
  Attention.signalsJson[f.actor] = JSON.stringify(snapshotAttentionSignals(f.world, f.actor).map(row => ({ ...row, observedAtSimMs: 1000 })));
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
});
