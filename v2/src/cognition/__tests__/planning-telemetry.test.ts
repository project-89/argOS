import { jest } from "@jest/globals";
import { getRelationTargets, removeComponent, removeEntity } from "bitecs";
import { Agent, Goal, Plan } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { setLocatedIn } from "../../ecs/location";
import { withSimulationTask } from "../../runtime/task-scope";
import { createIntentGoal } from "../cognition-system";
import { getAgentMemory } from "../agent-mind";
import { createPlanEntity, generatePlanForGoal, runPlanningSystem, type GeneratedPlan } from "../planning-system";
import type { PlanningEvent, PlanGenerationOutcome } from "../planning-telemetry";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { getWorkingMemory, recordWorkingMemoryEvidence } from "../working-memory";
import { applyCoordinationReviews } from "../coordination-memory";
import { getSocialDialogue, recordCommittedSpeech } from "../social-memory";
import { drainPendingStimuli } from "../stimulus-queue";

const proposal: GeneratedPlan = { goalDescription: "Consider the evidence", steps: [
  { description: "Consider the evidence", actionType: "think", content: "I need to understand the local mechanism." },
], estimatedCompletion: "short", potentialObstacles: [] };
function fixture(observer?: (event: PlanningEvent) => void) {
  const world = createArgosWorld("Planning telemetry"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" }), remote = createRoomEntity(world, { name: "Landing" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use actual evidence.", roomId: room });
  const other = createAgentEntity(world, { name: "Bea", role: "resident", systemPrompt: "Use actual evidence.", roomId: room });
  const goal = createIntentGoal(world, actor, "Understand the mechanism", 8);
  const events: PlanningEvent[] = [];
  const dispose = registerAgentWorldCapabilities(world, actor, { context: () => "Operator diagnostics are not my thoughts.", ready: () => true, busy: () => false,
    execute: () => false, onPlanningEvent: event => { events.push(event); observer?.(event); } });
  const run = (planGenerator: typeof generatePlanForGoal) =>
    runPlanningSystem(world, { agentEids: [actor], focusActiveGoal: true, planGenerator });
  return { world, room, remote, actor, other, goal, events, dispose, run };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Telemetry tests cannot call models")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("background preparation skips a higher-priority goal that already has an active plan", async () => {
  const f = fixture();
  const existing = createPlanEntity(f.world, f.actor, f.goal, proposal);
  const lower = createIntentGoal(f.world, f.actor, "Inspect the desk", 7);
  await runPlanningSystem(f.world, { agentEids: [f.actor], focusActiveGoal: true, background: true,
    planGenerator: async () => proposal });
  expect(f.events.filter(e => e.stage === "admitted")).toEqual([
    expect.objectContaining({ goalEid: lower }),
  ]);
  expect(Plan.status[existing]).toBe("active");
  expect(Plan.currentStep[existing]).toBe(0);
  expect(Goal.status[f.goal]).toBe("active");
  f.dispose();
});

test("new higher-priority planning demand still invalidates background preparation", async () => {
  const f = fixture();
  createPlanEntity(f.world, f.actor, f.goal, proposal);
  createIntentGoal(f.world, f.actor, "Inspect the desk", 7);
  const pending = deferred<GeneratedPlan>();
  const running = runPlanningSystem(f.world, { agentEids: [f.actor], focusActiveGoal: true,
    background: true, planGenerator: () => pending.promise });
  expect(f.events.map(e => e.stage)).toEqual(["requested"]);
  createIntentGoal(f.world, f.actor, "Escape the fire", 10);
  pending.resolve(proposal); await running;
  expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "higher_priority_goal" });
  f.dispose();
});

test("requested, validated and admitted are distinct operator events, never NPC experiences", async () => {
  const f = fixture(), pending = deferred<GeneratedPlan>();
  const memory = getWorkingMemory(f.world, f.actor), dialogue = getSocialDialogue(f.world, f.actor), thoughts = getAgentMemory(f.world, f.actor);
  const running = f.run(() => pending.promise);
  expect(f.events.map(e => e.stage)).toEqual(["requested"]);
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([]);
  pending.resolve(proposal); await running;
  expect(f.events.map(e => e.stage)).toEqual(["requested", "validated", "admitted"]);
  expect(new Set(f.events.map(e => e.requestId)).size).toBe(1);
  const plan = getRelationTargets(f.world, f.actor, HasPlan)[0];
  expect(f.events[2]).toMatchObject({ agentEid: f.actor, goalEid: f.goal, planEid: plan, stepCount: 1 });
  expect(Plan.currentStep[plan]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory); expect(getSocialDialogue(f.world, f.actor)).toEqual(dialogue);
  expect(getAgentMemory(f.world, f.actor)).toEqual(thoughts); expect(drainPendingStimuli()).toEqual([]);
  f.dispose();
});

test.each([
  ["goal_unavailable", (f: ReturnType<typeof fixture>) => { Goal.status[f.goal] = "completed"; }],
  ["goal_detached", (f: ReturnType<typeof fixture>) => removeComponent(f.world, f.actor, HasGoal(f.goal))],
  ["goal_changed", (f: ReturnType<typeof fixture>) => { Goal.description[f.goal] = "Leave the mechanism alone"; }],
  ["actor_unavailable", (f: ReturnType<typeof fixture>) => { Agent.active[f.actor] = false; }],
  ["actor_unavailable", (f: ReturnType<typeof fixture>) => { f.dispose(); removeEntity(f.world, f.actor); }],
  ["room_changed", (f: ReturnType<typeof fixture>) => setLocatedIn(f.world, f.actor, f.remote)],
  ["visible_state_changed", (f: ReturnType<typeof fixture>) => createObjectEntity(f.world, { name: "New parcel", roomId: f.room })],
  ["higher_priority_goal", (f: ReturnType<typeof fixture>) => createIntentGoal(f.world, f.actor, "Escape the fire", 10)],
  ["plan_replaced", (f: ReturnType<typeof fixture>) => createPlanEntity(f.world, f.actor, f.goal, proposal)],
] as const)("pending proposal reports %s rather than silently vanishing", async (reason, mutate) => {
  const f = fixture(), pending = deferred<GeneratedPlan>(); const running = f.run(() => pending.promise);
  mutate(f); pending.resolve(proposal); await running;
  expect(f.events.filter(e => e.stage === "discarded")).toEqual([expect.objectContaining({ reason })]);
  expect(f.events.some(e => e.stage === "admitted")).toBe(false); f.dispose();
});

test("own committed speech has its own stale-admission reason", async () => {
  const f = fixture(), pending = deferred<GeneratedPlan>(); const running = f.run(() => pending.promise);
  recordCommittedSpeech(f.world, f.actor, "Are you familiar with this mechanism?", "Bea");
  pending.resolve({ ...proposal, steps: [{ description: "Ask Bea", actionType: "speak", target: "Bea", content: "What do you know about this mechanism?" }] });
  await running; expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "own_speech_changed" }); f.dispose();
});

test("newly heard dialogue and private working memory retain distinct discard reasons", async () => {
  for (const reason of ["dialogue_changed", "working_memory_changed"]) {
    const f = fixture(), pending = deferred<GeneratedPlan>(); const running = f.run(() => pending.promise);
    if (reason === "dialogue_changed") recordCommittedSpeech(f.world, f.other, "The mechanism is already repaired.", "Ada");
    else recordWorkingMemoryEvidence(f.world, f.actor, { id: "actual-mechanism-observation", atMs: Date.now(), kind: "observation", provenance: "own_observation",
      summary: "I saw the mechanism is repaired.", facts: [{ subject: "mechanism", subjectLabel: "mechanism", predicate: "state", value: "repaired" }] });
    pending.resolve({ ...proposal, steps: [{ description: "Ask about the mechanism", actionType: "speak", target: "Bea", content: "Does the mechanism need repair?" }] });
    await running; expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason }); f.dispose();
  }
});

test("a captured undertaking changing mid-request is not hidden among generic validation failures", async () => {
  const f = fixture();
  const speech = recordCommittedSpeech(f.world, f.actor, "I will inspect the mechanism.", "Bea")!;
  const pending = deferred<GeneratedPlan>(); const running = f.run(() => pending.promise);
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: speech.id, task: "Inspect the mechanism", goalId: f.goal }])).toBe(1);
  pending.resolve({ ...proposal, steps: [{ ...proposal.steps[0], description: "Inspect the mechanism" }] }); await running;
  expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "coordination_changed" }); f.dispose();
});

test("first-step admission failure stays separate from whole-plan syntax/target validation", async () => {
  const f = fixture();
  // Legacy whole-plan validation knows room names; only the immediate observe
  // gate requires that this actor is actually in that room now.
  await f.run(async () => ({ ...proposal, steps: [{ description: "Observe Landing", actionType: "observe", target: "Landing" }] }));
  expect(f.events.map(e => e.stage)).toEqual(["requested", "validated", "discarded"]);
  expect(f.events.at(-1)).toMatchObject({ reason: "first_step_unavailable" }); f.dispose();
});

test.each([null, { ...proposal, steps: [{ description: "Teleport", actionType: "teleport" }] }])(
  "null and invalid provider proposals have explicit, non-admitted outcomes", async candidate => {
    const f = fixture(); await f.run(async () => candidate as GeneratedPlan | null);
    expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: candidate ? "validation_failed" : "generation_failed" });
    expect(f.events.some(e => e.stage === "validated" || e.stage === "admitted")).toBe(false);
    const plan = getRelationTargets(f.world, f.actor, HasPlan)[0]; expect(Plan.status[plan]).toBe("failed"); f.dispose();
  });

test("cancellation has one terminal event and releases the request slot", async () => {
  const f = fixture(), pending = deferred<GeneratedPlan>(), abort = new AbortController();
  const running = withSimulationTask(abort.signal, () => f.run(() => pending.promise));
  abort.abort(); pending.resolve(proposal); await expect(running).rejects.toThrow();
  expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "cancelled" });
  await f.run(async () => proposal);
  const terminals = f.events.filter(e => e.stage === "discarded" || e.stage === "admitted");
  expect(terminals).toHaveLength(2); expect(new Set(terminals.map(e => e.requestId)).size).toBe(2); f.dispose();
});

test("a throwing operator observer cannot veto an otherwise valid plan", async () => {
  const f = fixture(() => { throw new Error("Recorder offline"); }); await f.run(async () => proposal);
  expect(f.events.at(-1)).toMatchObject({ stage: "admitted" }); expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(1); f.dispose();
});

test("a truncated provider plan is rejected before admission even with parseable JSON",async()=>{
  const f=fixture();
  const result=await generatePlanForGoal(f.world,f.actor,f.goal,{generateText:(async()=>({text:JSON.stringify(proposal),finishReason:"length"})) as any});
  expect(result).toBeNull();expect(getRelationTargets(f.world,f.actor,HasPlan)).toEqual([]);f.dispose();
});

test("planning context distinguishes the assigned intention from competing routines", async () => {
  const f = fixture();
  const routine = createIntentGoal(f.world, f.actor, "Write the afternoon report", 9);
  Goal.kind[routine] = "scheduled_activity";
  let request: any;
  await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: (async (input: any) => {
    request = input; return { text: JSON.stringify(proposal) };
  }) as any });
  expect(request.system).toContain(`GOAL TO PLAN FOR:\n- Goal ID: ${f.goal}`);
  expect(request.system).toContain("COMPETING INTENTIONS (context, not steps of this goal):");
  expect(request.system).toContain(JSON.stringify({ goalId: routine, kind: "scheduled_activity", description: "Write the afternoon report", priority: 9 }));
  expect(request.prompt).toContain("Respect travel, reach and possession");
  expect(request.providerOptions.google.thinkingConfig.thinkingLevel).toBe("medium");
  expect(request.maxOutputTokens).toBe(4096);
  expect(request.maxRetries).toBe(0);
  expect(request.abortSignal).toBeDefined();
  expect(Goal.status[routine]).toBe("active");
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual([]);
  f.dispose();
});

test("a provider exception is reported and retains existing rejection semantics", async () => {
  const f = fixture(); await expect(f.run(async () => { throw new Error("Provider down"); })).rejects.toThrow("Provider down");
  expect(f.events.at(-1)).toMatchObject({ stage: "discarded", reason: "generation_error" });
  await f.run(async () => proposal); expect(f.events.at(-1)).toMatchObject({ stage: "admitted" }); f.dispose();
});

test("initial planning and validation repair share one deadline and preserve failed evidence", async () => {
  const f = fixture(), deadline = new AbortController(), signals: AbortSignal[] = [], outcomes: PlanGenerationOutcome[] = [];
  const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const generate = jest.fn(async (input: any) => {
    signals.push(input.abortSignal);
    if (signals.length === 1) return { text: JSON.stringify({ ...proposal, steps: [] }) };
    deadline.abort(new DOMException("Operation budget expired", "TimeoutError"));
    // A late SDK response must not be admitted even if the transport returns.
    return { text: JSON.stringify(proposal) };
  });
  const result = await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any, onOutcome: o => outcomes.push(o) });
  expect(result).toBeNull(); expect(generate).toHaveBeenCalledTimes(2);
  expect(timeout).toHaveBeenCalledTimes(1); expect(signals[1]).toBe(signals[0]);
  expect(outcomes).toEqual([expect.objectContaining({ ok: false, reason: "generation_error", issues: expect.any(Array) })]);
  expect((outcomes[0] as any).issues.length).toBeGreaterThan(0);
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(0); f.dispose();
});

test("cancellation after the initial response prevents a repair call", async () => {
  const f = fixture(), controller = new AbortController(), generate = jest.fn(async () => {
    controller.abort(); return { text: JSON.stringify({ ...proposal, steps: [] }) };
  });
  await withSimulationTask(controller.signal, async () => {
    expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any })).toBeNull();
  });
  expect(generate).toHaveBeenCalledTimes(1); f.dispose();
});

test.each(["parse_failed", "validation_failed", "generation_error"] as const)("model generation reports %s without inventing validation success", async reason => {
  const f = fixture(), outcomes: PlanGenerationOutcome[] = [];
  const generate = jest.fn(async () => {
    if (reason === "generation_error") throw new Error("Offline provider failure");
    return { text: reason === "parse_failed" ? "not JSON" : JSON.stringify({ ...proposal, steps: [] }) };
  });
  const result = await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any, onOutcome: outcome => outcomes.push(outcome) });
  expect(result).toBeNull(); expect(outcomes).toEqual([expect.objectContaining({ ok: false, reason })]);
  expect(generate).toHaveBeenCalledTimes(reason === "validation_failed" ? 2 : 1); f.dispose();
});
