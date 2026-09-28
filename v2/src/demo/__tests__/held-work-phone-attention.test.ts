import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { ApartmentSitcom, type SitcomCharacter } from "../apartment-sitcom";
import { Goal, Plan } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createIntentGoal } from "../../cognition/cognition-system";
import { advancePlanStep, createPlanEntity, hasPendingPlanning } from "../../cognition/planning-system";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { snapshotAttentionSignals } from "../../cognition/unresolved-attention";

let demo: ApartmentSitcom | undefined;
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline phone/planning integration only"));
});
afterEach(() => { demo?.stop(); demo = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test.each(["Elaine", "Jerry"] as const)("%s's completed work review can reconsider a personally read text through the physical phone", async reader => {
  demo = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" }); await demo.start();
  const t = demo, w = t.sim.world, actor = t.ids[reader];
  const peer: SitcomCharacter = reader === "Elaine" ? "Jerry" : "Elaine";
  // Explicit offline executor intentions test plumbing, not voluntary behavior.
  t.dispatch(reader, { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch(reader, { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  const text = "The Kitchen needs an inspection: there may be a leak behind the sink.";
  t.text(text); t.advance(200);
  expect(getPrivateCommunications(w, actor)).toEqual([]);
  expect(t.context(reader)).not.toContain(text);
  expect(snapshotAttentionSignals(w, actor)).toHaveLength(1);
  // Isolate an authored continuing-work goal from the demo's opening desires.
  for (const id of getRelationTargets(w, actor, HasGoal)) Goal.status[id] = "paused";
  const goal = createIntentGoal(w, actor, "Maintain the Kitchen", 10);
  Goal.successJson[goal] = JSON.stringify({ type: "productive_time", roomName: "Kitchen", atLeastMs: 3600000 });
  const plan = createPlanEntity(w, actor, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [], steps: [
    { description: "Review Kitchen upkeep", actionType: "think", content: "Consider current Kitchen conditions." },
  ] });
  advancePlanStep(plan, { world: w, agentEid: actor });
  const pending = () => {
    w.meta.aiEnabled = true;
    try { return hasPendingPlanning(w, actor, { background: true }); } finally { w.meta.aiEnabled = false; }
  };
  expect(pending()).toBe(false);
  t.dispatch(reader, { type: "interact", target: "Elaine's phone", content: "read_phone" });
  t.advance(600);
  expect(getPrivateCommunications(w, actor)).toEqual([]);
  expect(pending()).toBe(false);
  t.advance(600);
  expect(getPrivateCommunications(w, actor)).toEqual([expect.objectContaining({ content: text, own: false })]);
  expect(getPrivateCommunications(w, t.ids[peer])).toEqual([]);
  expect(t.context(peer)).not.toContain(text);
  expect(pending()).toBe(true);
  expect(Plan.status[plan]).toBe("completed"); expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
  expect(t.snapshot().events.filter(e => e.kind === "reply_delivered")).toEqual([]);
});
