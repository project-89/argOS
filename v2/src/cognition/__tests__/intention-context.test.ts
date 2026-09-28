import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, SimulationAge } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents } from "../../runtime/committed-events";
import { createPersonalIntention, requestIntentionReconsideration, formatGoalLifecycleContext } from "../goal-lifecycle";
import { workingMemoryEntityRef } from "../working-memory";
import { snapshotIntentionContext, formatIntentionTiming } from "../intention-context";
import { snapshotActivitySituation, activitySituationBasis } from "../activity-situation";
import { recordGoalAttemptActivity } from "../goal-attempt";
import { buildAgentContext } from "../agent-mind";
import { integrateActorContinuation, updateActorContinuation } from "../actor-continuation";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { formatPlansForContext } from "../planning-system";
import { RECONSIDERATION_INSTRUCTION } from "../intention-reconsideration";

function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "Choose your own purposes", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "friend", systemPrompt: "Private peer", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, peer);
  const conversation = createPersonalIntention(world, actor, "Discuss the missing cookie", 7)!;
  const dinner = createPersonalIntention(world, actor, "PRIVATE dinner invitation", 6)!;
  return { world, actor, peer, conversation, dinner };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); });
afterEach(() => jest.useRealTimers());
test("shared context includes competing intentions, temporal provenance and no foreign private goals", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 30_000); recordGoalAttemptActivity(f.world, f.actor, f.conversation);
  advanceSimulationTime(f.world, 2, 20_000);
  const rows = snapshotIntentionContext(f.world, f.actor);
  expect(rows.find(r => r.id === f.conversation)).toMatchObject({ adoptedAtSimMs: 0, lastAttemptAtSimMs: 30_000, progressEstimate: 0 });
  expect(rows.find(r => r.id === f.dinner)).toMatchObject({ adoptedAtSimMs: 0, lastAttemptAtSimMs: null });
  expect(formatIntentionTiming(f.world, rows[0])).toContain("last attributed attempt 20s ago, not proof of progress");
  expect(buildAgentContext(f.world, f.actor)).toContain("adopted 50s ago; no attributed attempt recorded");
  expect(snapshotActivitySituation(f.world, f.actor).intentions).toEqual(rows);
  expect(JSON.stringify(snapshotActivitySituation(f.world, f.peer))).not.toContain("PRIVATE dinner");
});
test("projection never renews timers; pure elapsed time does not invalidate a review basis", () => {
  const f = fixture(), before = SimulationAge.marksJson[f.dinner];
  const basis = activitySituationBasis(snapshotActivitySituation(f.world, f.actor));
  advanceSimulationTime(f.world, 1, 90_000); jest.advanceTimersByTime(86_400_000);
  for (let i = 0; i < 3; i++) snapshotIntentionContext(f.world, f.actor);
  expect(activitySituationBasis(snapshotActivitySituation(f.world, f.actor))).toBe(basis);
  expect(SimulationAge.marksJson[f.dinner]).toBe(before); expect(Goal.progress[f.dinner]).toBe(0);
});
test("pending review is visible beside ongoing intentions, never described as a terminal outcome", () => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 120_001);
  requestIntentionReconsideration(f.world, f.actor, f.dinner, "Review this inactive intention");
  expect(snapshotIntentionContext(f.world, f.actor).find(r => r.id === f.dinner)).toMatchObject({ status: "paused", awaitingReconsiderationSinceSimMs: 120_001 });
  expect(formatGoalLifecycleContext(f.world, f.actor)).not.toContain("PRIVATE dinner");
  expect(GoalLifecycle.reason[f.dinner]).toBe("Review this inactive intention");
});

test("desired outcomes, a side-turn approach and actual evidence have separate foreground homes", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Ask what happened", actionType: "speak", observedAtSimMs: 0,
    goalId: f.conversation, goalKey: WorkingMemoryIdentity.id[f.conversation] });
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer Bo's joke", actionType: "speak", observedAtSimMs: 0 });
  const prompt = buildAgentContext(f.world, f.actor);
  expect(prompt).toContain("WHAT YOU WANT RIGHT NOW");
  expect(prompt).toContain("LATEST CHOSEN APPROACH");
  expect(prompt).toContain("WHAT YOU'VE DONE AND KNOW FOR SURE");
  expect(prompt.indexOf("WHAT YOU WANT RIGHT NOW")).toBeLessThan(prompt.indexOf("LATEST CHOSEN APPROACH"));
  expect(prompt).not.toContain("CONTINUING INTENTION (");
  expect(prompt).toContain("PRIVATE dinner invitation");
  const situation = snapshotActivitySituation(f.world, f.actor) as any;
  expect(situation.immediateApproach).toMatchObject({ purpose: "Answer Bo's joke", actionType: "speak" });
  expect(situation.organizingActivity.intention.description).toBe("Discuss the missing cookie");
  expect(Goal.description[f.conversation]).toBe("Discuss the missing cookie");
  expect(JSON.stringify(snapshotActivitySituation(f.world, f.peer))).not.toContain("Answer Bo's joke");
});

test("advisory approach projection does not expand the physical/activity freshness fence", () => {
  const f = fixture();
  const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Enjoy company", actionType: "speak", observedAtSimMs: 0 })!;
  const first = snapshotActivitySituation(f.world, f.actor) as any;
  updateActorContinuation(f.world, f.actor, revision, "dispatched");
  const next = snapshotActivitySituation(f.world, f.actor) as any;
  expect(first.immediateApproach?.status).toBe("proposed");
  expect(next.immediateApproach?.status).toBe("dispatched");
  expect(activitySituationBasis(next)).toBe(activitySituationBasis(first));
});

test("planning rank is advisory and appraisal refinement changes outcomes rather than accumulating tactics", () => {
  const f = fixture(), text = formatPlansForContext(f.world, f.actor);
  expect(text).not.toContain("lower-priority purpose needs a deliberate choice and reason");
  expect(RECONSIDERATION_INSTRUCTION).toContain("desired outcome");
  expect(RECONSIDERATION_INSTRUCTION).toMatch(/current\s+approach/);
});
