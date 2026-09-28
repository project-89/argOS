import { jest } from "@jest/globals";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";
import { Goal, Plan, PlanningDecision, Agent, WorkingMemoryIdentity, Memory } from "../../ecs/components";
import { addComponent, addEntity, removeComponent } from "bitecs";
import { HasPlan, HasGoal, HasMemory } from "../../ecs/relations";
import { createIntentGoal } from "../cognition-system";
import { createPlanEntity, generatePlanForGoal, getCurrentStep, getNextPlannedAction, hasPendingPlanning,
  advancePlanStep, validateGeneratedPlan } from "../planning-system";
import { capturePlanDecisions, formatPlanDecisions, preparePlanDecisionReview, preservePlanDecision, planDecisionNeedsReplanning } from "../planner-decision";
import { getPrivateCommunications } from "../communication-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { getAgentWorldCapabilities, registerAgentWorldCapabilities } from "../world-capabilities";
import { getDirectContainer } from "../../ecs/location";
import { setAgentBehaviorPolicy } from "../behavior-policy";
import { selectFastAgentAction } from "../agent-mind";
import { compileCompletedPlanToProceduralMacro, compileSuccessfulGoalActionsToProceduralMacro } from "../plan-compiler";
import { serializeProceduralSkillV1, selectProceduralAction, tryStartProcedureExecution } from "../procedural-skills";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { captureLLMDecision, getCompilationStats, resolveDecision } from "../bt-compiler";
import { expireStaleGoals } from "../autonomous-goals";

let bed: Awaited<ReturnType<typeof ApartmentSitcom.create>> | undefined;
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Decision-frontier tests must stay offline")); });
afterEach(() => { bed?.stop(); bed = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

async function fixture() {
  bed = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, cognitionController: "priority" });
  const t = bed; await t.start(); t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  const world = t.sim.world, actor = t.ids.Elaine;
  const goal = createIntentGoal(world, actor, "Decide how to answer a personal message", 10);
  const decision = { purpose: "Decide whether to answer the message", target: "Elaine's phone", command: "reply" };
  const proposal = { goalDescription: Goal.description[goal], steps: [], decision, estimatedCompletion: "short", potentialObstacles: [] };
  return { t, world, actor, goal, decision, proposal };
}

test("planner guidance permits cross-goal review without requiring adoption or granting execution", async () => {
  const f = await fixture();
  createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const prompt = formatPlanDecisions(capturePlanDecisions(f.world, f.actor));
  expect(prompt).toContain("Optional planDecision");
  expect(prompt).toContain("For select, choose the matching interact action and control.goalId");
  expect(prompt).toContain("You may defer or decline a proposal while acting for another goal");
  expect(prompt).toContain("omit planDecision when you are not reviewing one");
  expect(prompt).not.toContain("When acting for another goal, omit planDecision");
  expect(prompt).toContain("Review is not execution or goal completion");
});

test("a background reply becomes a non-executable decision, not a retry into generic thinking", async () => {
  const f = await fixture();
  const provider = jest.fn(async () => ({ text: JSON.stringify({ ...f.proposal, decision: undefined, steps: [
    { actionType: "interact", target: "Elaine's phone", content: 'reply {"replyTo":123,"text":"DRAFT_MUST_NOT_EXECUTE"}',
      description: "Decide whether to reply to the personal message" },
    { actionType: "think", description: "Assume they answered", content: "SPECULATIVE_SUCCESSOR" },
  ] }) }));
  const result = await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: provider as any });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ steps: [], decision: { target: "Elaine's phone", command: "reply" } });
  expect(JSON.stringify(result)).not.toContain("DRAFT_MUST_NOT_EXECUTE");
  expect(JSON.stringify(result)).not.toContain("SPECULATIVE_SUCCESSOR");
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
});

test("an immediate frontier has no automatic action and grants no completion or hidden knowledge", async () => {
  const f = await fixture(); f.t.text("STILL_UNREAD_PRIVATE_TEXT"); f.t.advance(200);
  expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], f.proposal)).toEqual({ ok: true, issues: [] });
  const id = createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  f.world.meta.aiEnabled = true;
  expect(Plan.status[id]).toBe("awaiting_decision"); expect(getCurrentStep(id)).toBeNull();
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(advancePlanStep(id)).toBe(false);
  expect(hasPendingPlanning(f.world, f.actor, { focusActiveGoal: true })).toBe(false);
  const decisions = capturePlanDecisions(f.world, f.actor);
  expect(decisions.items).toHaveLength(1);
  expect(decisions.items[0]).toMatchObject({ goalId: f.goal, ...f.decision });
  expect(JSON.stringify(decisions.items)).not.toContain("STILL_UNREAD_PRIVATE_TEXT");
  expect(capturePlanDecisions(f.world, f.t.ids.Jerry).items).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test("inactivity expiry retires a real decision draft without erasing its evidence or authorizing a reply", async () => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const context = capturePlanDecisions(f.world, f.actor);
  expect(context.items).toHaveLength(1);
  const review = preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "decline", reason: "I choose not to answer." })!;
  expect(review).toBeDefined();
  const before = { definition: PlanningDecision.definitionJson[id], review: PlanningDecision.reviewJson[id], steps: Plan.steps[id], cursor: Plan.currentStep[id] };
  expireStaleGoals(f.world, f.actor, 1); f.t.advance(200);
  expireStaleGoals(f.world, f.actor, 1);
  expect(Goal.status[f.goal]).toBe("expired"); expect(Plan.status[id]).toBe("retired");
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
  expect({ definition: PlanningDecision.definitionJson[id], review: PlanningDecision.reviewJson[id], steps: Plan.steps[id], cursor: Plan.currentStep[id] }).toEqual(before);
  expect(Goal.progress[f.goal]).toBe(0); expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
});

test("background reprioritization preserves an offered reply rather than triggering replacement planning", async () => {
  const f = await fixture();
  const { createPersonalIntention } = await import("../goal-lifecycle");
  const { captureIntentionReconsideration, prepareIntentionReconsideration } = await import("../intention-reconsideration");
  const { runPlanningSystem } = await import("../planning-system");
  const goal = createPersonalIntention(f.world, f.actor, "Decide whether to reply to my partner", 6)!;
  const id = createPlanEntity(f.world, f.actor, goal, { ...f.proposal, goalDescription: Goal.description[goal] });
  const context = capturePlanDecisions(f.world, f.actor), choice = context.items.find(r => r.goalId === goal)!;
  const selected = { id: choice.id, disposition: "select", reason: "I want to confirm dinner." };
  const action = { type: "interact", target: f.decision.target, content: "reply {}" };
  const pending = preparePlanDecisionReview(context, selected, { goalId: goal, action })!;
  expect(prepareIntentionReconsideration(captureIntentionReconsideration(f.world, f.actor),
    [{ goalId: goal, disposition: "reprioritize", priority: 5, reason: "The message is no longer urgent." }])?.commit()).toBe(true);
  expect(Goal.priority[goal]).toBe(5); expect(Plan.status[id]).toBe("awaiting_decision");
  expect(planDecisionNeedsReplanning(f.world, f.actor, id)).toBe(false);
  expect(pending.current()).toBe(true);
  const generator = jest.fn(async (..._args: any[]) => f.proposal);
  await runPlanningSystem(f.world, { agentEids: [f.actor], background: true, planGenerator: generator });
  expect(generator.mock.calls.some((args: any[]) => args[2] === goal)).toBe(false);
  expect(capturePlanDecisions(f.world, f.actor).items.find(r => r.goalId === goal)?.id).toBe(choice.id);
  expect(preparePlanDecisionReview(context, selected, { goalId: goal, action })?.commit()).toBe(true);
  expect(Goal.progress[goal]).toBe(0); expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
});

test("declining the proposal is a private choice, not success or an instruction to do something else", async () => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const context = capturePlanDecisions(f.world, f.actor);
  const review = preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "decline", reason: "I prefer not to answer." });
  expect(review).toBeDefined(); expect(review!.commit()).toBe(true); expect(review!.commit()).toBe(false);
  expect(Plan.status[id]).toBe("awaiting_decision");
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
});

test("a real pickup finishes the prefix, never the decision or the goal", async () => {
  const f = await fixture(), phone = f.t.ids.phone;
  const id = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal, steps: [
    { actionType: "pickup", target: f.decision.target, description: "Take my phone" },
  ] });
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(getDirectContainer(f.world, phone)).not.toBe(f.actor);
  expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ actionType: "pickup" });
  f.t.dispatch("Elaine", { type: "pickup", target: f.decision.target }); f.t.advance(3000);
  expect(getDirectContainer(f.world, phone)).toBe(f.actor);
  expect(Plan.status[id]).toBe("awaiting_decision"); expect(Plan.currentStep[id]).toBe(1);
  expect(getCurrentStep(id)).toBeNull(); expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(1);
  expect(Goal.status[f.goal]).toBe("active"); expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
});

test("defer uses simulation time and does not repeatedly call the planner", async () => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const context = capturePlanDecisions(f.world, f.actor);
  expect(preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "defer", reason: "Later", afterSeconds: 10 })!.commit()).toBe(true);
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(planDecisionNeedsReplanning(f.world, f.actor, id)).toBe(false);
  f.t.advance(9000); expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  f.t.advance(1000); expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(1);
  expect(planDecisionNeedsReplanning(f.world, f.actor, id)).toBe(false);
  expect(Plan.status[id]).toBe("awaiting_decision"); expect(Goal.status[f.goal]).toBe("active");
});

test.each(["action", "target", "command", "goal"])("select cannot consume a proposal with a mismatching %s", async mismatch => {
  const f = await fixture(); createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const context = capturePlanDecisions(f.world, f.actor), action = { type: "interact", target: f.decision.target, content: "reply {}" };
  if (mismatch === "action") action.type = "think";
  if (mismatch === "target") action.target = "Jerry's phone";
  if (mismatch === "command") action.content = "read_phone";
  expect(preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "select", reason: "Answer." },
    { action, goalId: mismatch === "goal" ? null : f.goal })).toBeUndefined();
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(1);
});

test.each(["goal_definition", "goal_owner", "actor_identity", "persona", "target_identity", "proposal_edit", "prefix_edit", "replacement", "source"])("a late review cannot consume a changed %s", async change => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  const context = capturePlanDecisions(f.world, f.actor), review = preparePlanDecisionReview(context,
    { id: context.items[0].id, disposition: "decline", reason: "Not now." })!;
  expect(review.current()).toBe(true);
  if (change === "goal_definition") Goal.description[f.goal] = "A replacement purpose";
  if (change === "goal_owner") removeComponent(f.world, f.actor, HasGoal(f.goal));
  if (change === "actor_identity") WorkingMemoryIdentity.id[f.actor] = "replacement-owner";
  if (change === "persona") Agent.systemPrompt[f.actor] += " Changed character.";
  if (change === "target_identity") WorkingMemoryIdentity.id[f.t.ids.phone] = "replacement-phone";
  if (change === "proposal_edit") PlanningDecision.definitionJson[id] += " ";
  if (change === "prefix_edit") Plan.steps[id] = '[{"actionType":"think","description":"Replaced prefix"}]';
  if (change === "replacement") createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
  let stale = false;
  expect(preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "decline", reason: "Not now." },
    undefined, () => { stale = true; })).toBeUndefined();
  expect(stale).toBe(true);
  expect(PlanningDecision.reviewJson[id]).toBe(""); expect(Goal.status[f.goal]).toBe("active");
});

test("re-registering the same capability object cannot inherit a proposal's grant", () => {
  const world = createArgosWorld("Proposal package epoch"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "writer", systemPrompt: "Choose", roomId: room });
  const target = createObjectEntity(world, { name: "Console", roomId: room });
  const cap = { ready: () => true, busy: () => false, context: () => "", execute: () => false,
    affordances: (id: number) => id === target ? [{ name: "transmit", requires: [], requiresFreshDecision: true }] : [] };
  const unregister = registerAgentWorldCapabilities(world, actor, cap), goal = createIntentGoal(world, actor, "Update a friend", 8);
  const id = createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal], steps: [], estimatedCompletion: "short",
    potentialObstacles: [], decision: { purpose: "Decide whether to update", target: "Console", command: "transmit" } });
  const context = capturePlanDecisions(world, actor), review = preparePlanDecisionReview(context,
    { id: context.items[0].id, disposition: "decline", reason: "Later." })!;
  unregister(); const remove = registerAgentWorldCapabilities(world, actor, cap);
  try { expect(review.commit()).toBe(false); expect(planDecisionNeedsReplanning(world, actor, id)).toBe(true); }
  finally { remove(); }
});

test("public validation still rejects a fresh reply in motor steps and payloads in decisions", async () => {
  const f = await fixture();
  expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], { ...f.proposal, decision: undefined,
    steps: [{ actionType: "interact", target: f.decision.target, content: 'reply {"text":"not authorized"}', description: "Reply" }] }).ok).toBe(false);
  for (const decision of [{ ...f.decision, content: "DRAFT" }, { ...f.decision, command: "reply {}" }, { ...f.decision, target: "Unknown phone" }])
    expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], { ...f.proposal, decision }).ok).toBe(false);
});

test("an earlier heard-evidence boundary removes the speculative decision too", async () => {
  const f = await fixture();
  const proposal = preservePlanDecision(f.world, f.actor, { ...f.proposal, steps: [
    { actionType: "wait", description: "Await Jerry's response", waitUntil: { kind: "heard_evidence", speaker: "Jerry" } },
    { actionType: "interact", target: f.decision.target, content: 'reply {"text":"Then Jerry agreed"}', description: "Reply" },
  ] });
  expect(proposal?.decision).toBeUndefined(); expect(proposal?.steps).toHaveLength(1);
});

test("read first, then choose: a proposal cannot pre-author a reaction to an unread result", async () => {
  const f = await fixture();
  const proposal = { ...f.proposal, steps: [
    { actionType: "interact" as const, target: f.decision.target, content: "read_phone", description: "Read what arrived" },
  ] };
  expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], proposal).ok).toBe(false);
  const bounded = preservePlanDecision(f.world, f.actor, proposal)!;
  expect(bounded.decision).toBeUndefined(); expect(bounded.steps).toHaveLength(1);
  expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], bounded).ok).toBe(true);
});

test("a fresh reply does not teach a literal behavior-tree branch", async () => {
  const f = await fixture(); f.t.text("Call tomorrow?"); f.t.advance(500);
  f.t.dispatch("Elaine", { type: "pickup", target: f.decision.target }); f.t.advance(2000);
  f.t.dispatch("Elaine", { type: "interact", target: f.decision.target, content: "read_phone" }); f.t.advance(2000);
  setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "think", content: "A prior habit" } });
  captureLLMDecision(f.world, f.actor, "Choose fresh words", { type: "interact", target: f.decision.target, content: 'reply {"text":"NOT_A_REUSABLE_SCRIPT"}' }, "reply");
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  const before = getCompilationStats(f.actor, f.world); resolveDecision(f.world, f.actor, true);
  expect(getCompilationStats(f.actor, f.world)).toEqual(before);
});

test("native reading changes a reviewed proposal's evidence; mere unread delivery never grants knowledge", async () => {
  const f = await fixture();
  f.t.text("NEW_PRIVATE_MESSAGE"); f.t.advance(500);
  f.t.dispatch("Elaine", { type: "pickup", target: f.decision.target }); f.t.advance(2000);
  const id = createPlanEntity(f.world, f.actor, f.goal, f.proposal), context = capturePlanDecisions(f.world, f.actor);
  const review = preparePlanDecisionReview(context, { id: context.items[0].id, disposition: "decline", reason: "Wait." })!;
  expect(review.commit()).toBe(true); expect(planDecisionNeedsReplanning(f.world, f.actor, id)).toBe(false);
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
  f.t.dispatch("Elaine", { type: "interact", target: f.decision.target, content: "read_phone" }); f.t.advance(2000);
  expect(getPrivateCommunications(f.world, f.actor).some(r => r.content === "NEW_PRIVATE_MESSAGE")).toBe(true);
  expect(planDecisionNeedsReplanning(f.world, f.actor, id)).toBe(true);
  expect(Goal.status[f.goal]).toBe("active");
});

test("a policy or remembered flat routine cannot skip an immediate decision", async () => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal), memory = addEntity(f.world);
  addComponent(f.world, memory, Memory); addComponent(f.world, f.actor, HasMemory(memory)); Memory.type[memory] = "procedural";
  Memory.content[memory] = serializeProceduralSkillV1({ kind: "procedure_v1", signature: "frontier-routine", name: "Old habit",
    trigger: { affordance: "old" }, steps: [{ type: "think", content: "SKIP THE CHOICE" }],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } });
  expect(tryStartProcedureExecution(f.world, f.actor, "frontier-routine")).toBe(false);
  expect(selectProceduralAction(f.world, f.actor)).toBeNull();
  setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "think", content: "SKIP THE CHOICE" } });
  expect(selectFastAgentAction(f.world, f.actor)).toBeNull();
  Goal.status[f.goal] = "completed"; Plan.status[id] = "completed";
  expect(compileCompletedPlanToProceduralMacro(f.world, f.actor, f.goal, id).ok).toBe(false);
  expect(compileSuccessfulGoalActionsToProceduralMacro(f.world, f.actor, f.goal, []).ok).toBe(false);
});

test("a restored proposal keeps its record but needs revalidation, not an inherited grant", async () => {
  const f = await fixture(), id = createPlanEntity(f.world, f.actor, f.goal, f.proposal), registry = createSystemRegistry();
  const data = JSON.parse(JSON.stringify(serializeWorld(f.world, registry)));
  const world = createArgosWorld("Restored proposal"); initializePrefabs(world); addEntity(world);
  const restored = deserializeWorld(world, createSystemRegistry(), data), actor = restored.oldToNewId.get(f.actor)!;
  const plan = restored.oldToNewId.get(id)!;
  expect(PlanningDecision.definitionJson[plan]).toBe(PlanningDecision.definitionJson[id]);
  expect(Plan.status[plan]).toBe("awaiting_decision"); expect(capturePlanDecisions(world, actor).items).toHaveLength(0);
  expect(planDecisionNeedsReplanning(world, actor, plan)).toBe(true); expect(getNextPlannedAction(world, actor)).toBeNull();
});
