import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { Goal, Plan } from "../../ecs/components";
import { createPersonalIntention, isStandingIntention, markStandingIntention } from "../goal-lifecycle";
import { createPlanEntity, formatPlansForContext } from "../planning-system";
import { executeActions, getActiveGoals } from "../cognition-system";
import { buildAgentContext } from "../agent-mind";
import { drainPendingStimuli } from "../stimulus-queue";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";

let bed: ApartmentSitcom | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline regression forbids inference")); });
afterEach(() => { bed?.stop(); bed = undefined; expect(globalThis.fetch).not.toHaveBeenCalled();
  drainPendingStimuli(); jest.restoreAllMocks(); });

function fixture(standing: boolean) {
  const world = createArgosWorld("Standing desire is not unfinished work"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose for myself.", roomId: room });
  const goal = createPersonalIntention(world, actor, "Keep learning about the world", 7)!;
  if (standing) markStandingIntention(world, goal);
  const plan = createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Consider today's experience", actionType: "think", content: "I have considered this experience." }] });
  const finish = () => executeActions(world, [{ eid: actor, action: { type: "think", content: "I have considered this experience." } }], createSystemRegistry());
  return { world, actor, goal, plan, finish };
}

test("an executed standing-desire plan does not create a new verification-demand stimulus", () => {
  const f = fixture(true); f.finish();
  expect(Plan.status[f.plan]).toBe("completed"); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(drainPendingStimuli().filter(s => s.targetEid === f.actor && s.source === "planning")).toEqual([]);
});

test("episodic unfinished work retains its verification demand and cannot claim completion", () => {
  const f = fixture(false); f.finish();
  expect(Plan.status[f.plan]).toBe("completed"); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(drainPendingStimuli().filter(s => s.targetEid === f.actor && s.source === "planning").map(s => s.content).join("\n")).toContain("not verified");
});

test("standing goal context describes persistence, not a zero-percent task", () => {
  const f = fixture(true);
  const line = buildAgentContext(f.world, f.actor).split("\n").find(line => line.includes(`[ID ${f.goal},`))!;
  expect(line).toContain("standing desire"); expect(line).not.toContain("progress estimate");
});

test("completed standing plan context does not demand proof of finishing the desire", () => {
  const f = fixture(true); f.finish(); const context = formatPlansForContext(f.world, f.actor);
  expect(context).toContain("standing desire"); expect(context).not.toContain("still unverified");
  expect(context).not.toContain("Do not fall back to lower-priority work");
});

test("native phone read finishes at its deadline without erasing notification, message or goal state", async () => {
  bed = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, worldMaintenance: false });
  await bed.start(); const t = bed, w = t.sim.world;
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  const message = t.text("I changed my plans."), unread = t.text("PRIVATE_NEXT_MESSAGE"); t.advance(200);
  const goal = getActiveGoals(w, t.ids.Elaine).find(g => isStandingIntention(w, g.eid))!.eid;
  const plan = createPlanEntity(w, t.ids.Elaine, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Read the first notification", actionType: "interact", target: "Elaine's phone", content: "read_phone" }] });
  drainPendingStimuli(); t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
  t.advance(1199); expect(Plan.status[plan]).toBe("active"); expect(t.message.status[message]).toBe("delivered");
  t.advance(1); expect(Plan.status[plan]).toBe("completed"); expect(t.message.status[message]).toBe("read");
  expect(t.message.status[unread]).toBe("delivered"); expect(Goal.priority[goal]).toBe(8); expect(Goal.status[goal]).toBe("active");
  expect(drainPendingStimuli().filter(s => s.targetEid === t.ids.Elaine && s.source === "planning")).toEqual([]);
  expect(t.context("Elaine")).not.toContain("PRIVATE_NEXT_MESSAGE"); expect(t.context("Jerry")).not.toContain("I changed my plans.");
  expect(t.snapshot().phone.filter(m => m.direction === "out")).toHaveLength(0);
});
