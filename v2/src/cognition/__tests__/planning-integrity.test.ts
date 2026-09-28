import { jest } from "@jest/globals";
import { addEntity, addComponent, getRelationTargets, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, Mind, Name, Goal, Plan, Room } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { withSimulationTask } from "../../runtime/task-scope";
import { advancePlanStep, createPlanEntity, generatePlanForGoal, getNextPlannedAction, hasPendingPlanning, runPlanningSystem, validateGeneratedPlan, formatPlansForContext, type GeneratedPlan } from "../planning-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { integrateActorContinuation } from "../actor-continuation";
import { captureCoordinationGoal } from "../coordination-memory";

function fixture() {
  const world = createArgosWorld("planning integrity");
  const agent = addEntity(world);
  for (const component of [Agent, Mind, Name]) addComponent(world, agent, component);
  Agent.active[agent] = true; Name.value[agent] = "Planner";
  function goal(description: string, priority = 5) {
    const id = addEntity(world);
    addComponent(world, id, Goal); addComponent(world, agent, HasGoal(id));
    Goal.description[id] = description;
    Goal.status[id] = "active"; Goal.priority[id] = priority; Goal.progress[id] = 0;
    Goal.createdAt[id] = 1; Goal.kind[id] = "custom"; Goal.successJson[id] = ""; Goal.paramsJson[id] = "{}";
    return id;
  }
  const id = goal("Investigate the noise");
  return { world, agent, id, goal };
}
const plan: GeneratedPlan = { goalDescription: "Investigate", steps: [
  { description: "Consider the evidence", actionType: "think", content: "What made that sound?" },
  { description: "Choose a route", actionType: "think", content: "I should check safely." },
], estimatedCompletion: "short", potentialObstacles: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe("Planning integrity under changing world state", () => {
  afterEach(() => jest.useRealTimers());

  test.each(["completed", "abandoned", "removed", "revised", "detached", "deactivated", "new priority", "moved"])(
    "discards a pending plan when its context becomes %s", async change => {
      const f = fixture(); const result = deferred<GeneratedPlan | null>();
      const running = runPlanningSystem(f.world, { focusActiveGoal: true, planGenerator: () => result.promise });
      if (change === "completed" || change === "abandoned") Goal.status[f.id] = change;
      if (change === "removed") removeEntity(f.world, f.id);
      if (change === "revised") Goal.description[f.id] = "Stay away from the noise";
      if (change === "detached") { const { removeComponent } = await import("bitecs"); removeComponent(f.world, f.agent, HasGoal(f.id)); }
      if (change === "deactivated") Agent.active[f.agent] = false;
      if (change === "new priority") f.goal("Escape the fire", 10);
      if (change === "moved") { const room = addEntity(f.world); addComponent(f.world, room, Room); setLocatedIn(f.world, f.agent, room); }
      result.resolve(plan); await running;
      expect(getRelationTargets(f.world, f.agent, HasPlan)).toHaveLength(0);
    });

  test("coalesces duplicate overlapping planner requests", async () => {
    const f = fixture(); const result = deferred<GeneratedPlan | null>();
    const generate = jest.fn(() => result.promise);
    const a = runPlanningSystem(f.world, { planGenerator: generate });
    await runPlanningSystem(f.world, { planGenerator: generate });
    expect(generate).toHaveBeenCalledTimes(1);
    result.resolve(plan); await a;
    expect(getRelationTargets(f.world, f.agent, HasPlan)).toHaveLength(1);
  });

  test("cancelled planner cannot install a result and releases its in-flight slot", async () => {
    const f = fixture(); const result = deferred<GeneratedPlan | null>(); const abort = new AbortController();
    const running = withSimulationTask(abort.signal, () => runPlanningSystem(f.world, { planGenerator: () => result.promise }));
    abort.abort(); result.resolve(plan);
    await expect(running).rejects.toThrow();
    expect(getRelationTargets(f.world, f.agent, HasPlan)).toHaveLength(0);
    await runPlanningSystem(f.world, { planGenerator: async () => plan });
    expect(getRelationTargets(f.world, f.agent, HasPlan)).toHaveLength(1);
  });

  test("does not strand an unmet success contract after plan exhaustion", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); Goal.successJson[f.id] = JSON.stringify({ type: "has_trait", trait: "safe" });
    const old = createPlanEntity(f.world, f.agent, f.id, plan); Plan.status[old] = "completed";
    const generate = jest.fn(async () => plan);
    await runPlanningSystem(f.world, { planGenerator: generate }); expect(generate).not.toHaveBeenCalled();
    jest.setSystemTime(102_001);
    await runPlanningSystem(f.world, { planGenerator: generate }); expect(generate).toHaveBeenCalledTimes(1);
    expect(Goal.status[f.id]).toBe("active");
  });

  test("urgent goals interrupt and later resume the old cursor with stable action identity", () => {
    const f = fixture(); const old = createPlanEntity(f.world, f.agent, f.id, plan); advancePlanStep(old);
    const urgent = f.goal("Escape fire", 10);
    expect(getNextPlannedAction(f.world, f.agent)).toBeNull();
    const urgentPlan = createPlanEntity(f.world, f.agent, urgent, plan);
    expect(getNextPlannedAction(f.world, f.agent)).toMatchObject({ planEid: urgentPlan, goalEid: urgent, currentStep: 0 });
    Goal.status[urgent] = "completed";
    expect(getNextPlannedAction(f.world, f.agent)).toMatchObject({ planEid: old, goalEid: f.id, currentStep: 1 });
  });

  test("failed or empty plans cannot be advanced into completion", () => {
    const f = fixture(); const id = createPlanEntity(f.world, f.agent, f.id, plan); Plan.status[id] = "failed";
    expect(advancePlanStep(id)).toBe(false); expect(Plan.status[id]).toBe("failed");
    Plan.status[id] = "active"; Plan.steps[id] = "[]";
    expect(advancePlanStep(id)).toBe(false); expect(Plan.status[id]).toBe("active");
  });

  test("model output cannot introduce unsupported actions or unknown targets", () => {
    const f = fixture();
    expect(validateGeneratedPlan(f.world, f.agent, "Investigate", { ...plan, steps: [
      { description: "Teleport", actionType: "teleport" as any, target: "Secret Room" },
    ] }).ok).toBe(false);
    expect(validateGeneratedPlan(f.world, f.agent, "Investigate", { ...plan, steps: [
      { description: "Open the imaginary box", actionType: "interact", target: "Imaginary Box", content: "open" },
    ] }).ok).toBe(false);
    expect(validateGeneratedPlan(f.world, f.agent, "Investigate", { ...plan, steps: [
      { description: "Reason from evidence", actionType: "think", content: "I need to find a safe route first." },
    ] }).ok).toBe(true);
  });

  test("does not install a failed attempt or obsolete plan after a visible target disappears", async () => {
    const f = fixture(); const room = addEntity(f.world); addComponent(f.world, room, Room); setLocatedIn(f.world, f.agent, room);
    const object = addEntity(f.world); addComponent(f.world, object, Name); Name.value[object] = "Phone"; setLocatedIn(f.world, object, room);
    const result = deferred<GeneratedPlan | null>();
    const running = runPlanningSystem(f.world, { planGenerator: () => result.promise });
    removeEntity(f.world, object); result.resolve(null); await running;
    expect(getRelationTargets(f.world, f.agent, HasPlan)).toHaveLength(0);
  });

  test("retires a stored interact step when its live package affordance disappears", () => {
    const f = fixture();
    const room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = "Bedroom";
    setLocatedIn(f.world, f.agent, room);
    const phone = addEntity(f.world); addComponent(f.world, phone, Name); Name.value[phone] = "Phone"; setLocatedIn(f.world, phone, room);
    let unread = true;
    const unregister = registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "A phone with a transient unread message.", ready: () => true, busy: () => false, execute: () => false,
      affordances: target => target === phone && unread ? [{ name: "read_phone", requires: [], description: "Read one unread message." }] : [],
    });
    try {
      const stored = createPlanEntity(f.world, f.agent, f.id, { ...plan, steps: [
        { description: "Read the unread message", actionType: "interact", target: "Phone", content: "read_phone" },
      ] });
      expect(getNextPlannedAction(f.world, f.agent)).toMatchObject({ planEid: stored, target: "Phone", content: "read_phone" });
      unread = false;
      expect(getNextPlannedAction(f.world, f.agent)).toBeNull();
      expect(Plan.status[stored]).toBe("failed");
    } finally { unregister(); }
  });

  test("native world planning uses a small physical prompt and bounded provider work", async () => {
    const f = fixture(); registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "I heard a noise near the staircase.", ready: () => true, busy: () => false, execute: () => false,
    });
    const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify(plan) }));
    const output = await generatePlanForGoal(f.world, f.agent, f.id, { generateText: generate as any });
    expect(output?.steps).toHaveLength(2);
    const request = generate.mock.calls[0][0];
    // Existing background policy is medium; foreground remains separate.
    expect(request).toMatchObject({ maxOutputTokens: 4096, maxRetries: 0, providerOptions: { google: { thinkingConfig: { thinkingLevel: "medium" } } } });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(request.abortSignal.aborted).toBe(false);
    expect(request.prompt).toContain("travel, reach and possession");
    expect(request.prompt).not.toContain("replace_in_file"); expect(request.system).not.toContain("CLI-only");
  });

  test("native planner permits only one semantic repair retry", async () => {
    const f = fixture(); registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "Known room", ready: () => true, busy: () => false, execute: () => false,
    });
    const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify({ ...plan, steps: [
      { description: "Invent a door", actionType: "teleport", target: "Not Real" },
    ] }) }));
    expect(await generatePlanForGoal(f.world, f.agent, f.id, { generateText: generate as any })).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test("non-package planner keeps its existing request settings without unrelated tool instructions", async () => {
    const f = fixture(); const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify(plan) }));
    await generatePlanForGoal(f.world, f.agent, f.id, { generateText: generate as any });
    const request = generate.mock.calls[0][0];
    expect(request.prompt).not.toContain("replace_in_file"); expect(request.maxOutputTokens).toBeUndefined();
    expect(request.abortSignal).toBeUndefined();
  });

  test.each([
    ["native physical failure", true, JSON.stringify(plan.steps), 2_000],
    ["native generation failure", true, "[]", 15_000],
    ["native malformed failure", true, "{", 15_000],
    ["office physical failure", false, JSON.stringify(plan.steps), 15_000],
  ] as const)("%s uses the appropriate replan backoff", async (_label, native, steps, backoff) => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture();
    if (native) registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "The fuse moved while I approached.", ready: () => true, busy: () => false, execute: () => false,
    });
    const old = createPlanEntity(f.world, f.agent, f.id, plan);
    Plan.steps[old] = steps; Plan.status[old] = "failed";
    const generate = jest.fn(async () => plan);
    jest.setSystemTime(100_000 + backoff - 1);
    await runPlanningSystem(f.world, { planGenerator: generate }); expect(generate).not.toHaveBeenCalled();
    jest.setSystemTime(100_000 + backoff);
    await runPlanningSystem(f.world, { planGenerator: generate }); expect(generate).toHaveBeenCalledTimes(1);
  });

  test("per-actor planning scopes exclude every other agent", async () => {
    const f = fixture(); const other = addEntity(f.world);
    addComponent(f.world, other, Agent); addComponent(f.world, other, Mind); Agent.active[other] = true;
    const otherGoal = addEntity(f.world); addComponent(f.world, otherGoal, Goal); addComponent(f.world, other, HasGoal(otherGoal));
    Goal.status[otherGoal] = "active"; Goal.description[otherGoal] = "Do something else"; Goal.priority[otherGoal] = 5;
    const generate = jest.fn(async (_world: any, actor: number) => { expect(actor).toBe(f.agent); return plan; });
    await runPlanningSystem(f.world, { agentEids: [f.agent], planGenerator: generate });
    expect(generate).toHaveBeenCalledTimes(1); expect(getRelationTargets(f.world, other, HasPlan)).toHaveLength(0);
  });

  test("opt-in background planning runs while the actor is physically occupied", async () => {
    const f = fixture(); f.world.meta.aiEnabled = true; registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "I am walking.", ready: () => false, busy: () => true, execute: () => false,
    });
    expect(hasPendingPlanning(f.world, f.agent)).toBe(false);
    expect(hasPendingPlanning(f.world, f.agent, { background: true })).toBe(true);
    const generate = jest.fn(async () => plan);
    await runPlanningSystem(f.world, { agentEids: [f.agent], planGenerator: generate }); expect(generate).not.toHaveBeenCalled();
    await runPlanningSystem(f.world, { agentEids: [f.agent], background: true, planGenerator: generate }); expect(generate).toHaveBeenCalledTimes(1);
  });

  test("planning readiness shares in-flight, active-plan, backoff and priority eligibility", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); f.world.meta.aiEnabled = true;
    expect(hasPendingPlanning(f.world, f.agent, { focusActiveGoal: true })).toBe(true);
    const pending = deferred<GeneratedPlan | null>();
    const running = runPlanningSystem(f.world, { agentEids: [f.agent], planGenerator: () => pending.promise });
    expect(hasPendingPlanning(f.world, f.agent)).toBe(false);
    pending.resolve(plan); await running;
    expect(hasPendingPlanning(f.world, f.agent)).toBe(false);
    const old = getRelationTargets(f.world, f.agent, HasPlan)[0]; Plan.status[old] = "failed";
    expect(hasPendingPlanning(f.world, f.agent)).toBe(false);
    jest.setSystemTime(115_000); expect(hasPendingPlanning(f.world, f.agent)).toBe(true);
    Plan.status[old] = "active"; f.goal("A new low priority wish", 1);
    expect(hasPendingPlanning(f.world, f.agent, { focusActiveGoal: true })).toBe(false);
    expect(hasPendingPlanning(f.world, f.agent)).toBe(true);
    f.world.meta.aiEnabled = false; expect(hasPendingPlanning(f.world, f.agent)).toBe(false);
  });

  test("a new urgent goal suppresses lower-plan instructions while its plan is pending", () => {
    const f = fixture(); createPlanEntity(f.world, f.agent, f.id, plan);
    f.goal("Leave the burning room", 10);
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).toContain("Current priority: 10"); expect(context).toContain("Leave the burning room");
    expect(context).toContain("No plan yet for this current-priority goal"); expect(context).toContain("DEFERRED PLANS");
    expect(context).toContain("Investigate the noise"); expect(context).toContain("saved step 1/2");
    expect(context).not.toContain("Current:"); expect(context).not.toContain("Next:");
    expect(context).not.toContain(plan.steps[0].description); expect(context).not.toContain(plan.steps[1].description);
  });

  test("priority context permits deliberate detours without granting automatic fallback", () => {
    const f = fixture(), saved = createPlanEntity(f.world, f.agent, f.id, plan);
    const urgent = f.goal("Deal with an important personal concern", 10);
    const before = JSON.stringify([Plan.steps[saved], Plan.status[saved], Plan.currentStep[saved], Goal.status[urgent]]);
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).not.toContain("Only plans at this priority");
    expect(context).not.toContain("Do not fall back to lower-priority work");
    expect(context).not.toContain("Resume only after higher-priority goals are resolved");
    expect(context).toContain("deliberate choice");
    expect(getNextPlannedAction(f.world, f.agent)).toBeNull();
    expect(JSON.stringify([Plan.steps[saved], Plan.status[saved], Plan.currentStep[saved], Goal.status[urgent]])).toBe(before);
  });

  test("a freshly selected lower-priority purpose keeps its saved next step visible", () => {
    const f = fixture();
    Goal.successJson[f.id] = JSON.stringify({ type: "custom", description: "Understand the noise" });
    const goalKey = captureCoordinationGoal(f.world, f.agent, f.id)!.goalKey;
    const saved = createPlanEntity(f.world, f.agent, f.id, plan);
    const urgent = f.goal("Deal with an important personal concern", 10);
    integrateActorContinuation(f.world, f.agent, { purpose: "Check the noise while considering the concern",
      actionType: "think", goalId: f.id, goalKey,
      switchReason: "It is a short useful detour I chose.", observedAtSimMs: 0 });
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).toContain(`Current: ${plan.steps[0].description}`);
    expect(context).not.toContain("Investigate the noise (priority 5; saved step");
    expect(getNextPlannedAction(f.world, f.agent)).toMatchObject({ planEid: saved, goalEid: f.id });
    expect(Plan.currentStep[saved]).toBe(0); expect(Goal.status[urgent]).toBe("active");
  });

  test("resolving urgency restores the original saved cursor to the executable projection", () => {
    const f = fixture(); const saved = createPlanEntity(f.world, f.agent, f.id, plan); advancePlanStep(saved);
    const urgent = f.goal("Leave the burning room", 10);
    expect(formatPlansForContext(f.world, f.agent)).toContain("saved step 2/2");
    Goal.status[urgent] = "completed";
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).toContain(`Current: ${plan.steps[1].description}`); expect(context).toContain("Progress: Step 2/2");
    expect(context).not.toContain("DEFERRED PLANS"); expect(context).not.toContain("Leave the burning room");
  });

  test("equal-priority plans remain eligible while genuinely lower-priority plans stay deferred", () => {
    const f = fixture(); createPlanEntity(f.world, f.agent, f.id, plan);
    const peer = f.goal("Find the other sound", 5);
    createPlanEntity(f.world, f.agent, peer, { ...plan, steps: [{ description: "Inspect the window", actionType: "think", content: "Inspect" }] });
    const low = f.goal("Polish a brass knob", 1);
    createPlanEntity(f.world, f.agent, low, { ...plan, steps: [{ description: "Polish immediately", actionType: "think", content: "Polish" }] });
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).toContain(`Current: ${plan.steps[0].description}`); expect(context).toContain("Current: Inspect the window");
    expect(context).toContain("Polish a brass knob (priority 1; saved step 1/1)"); expect(context).not.toContain("Polish immediately");
  });

  test.each(["completed", "failed"])("projection distinguishes an existing %s plan from never having planned", status => {
    const f = fixture(); const id = createPlanEntity(f.world, f.agent, f.id, plan); Plan.status[id] = status;
    const context = formatPlansForContext(f.world, f.agent);
    expect(context).toContain(status === "completed" ? "still unverified" : "previous plan failed");
    expect(context).not.toContain("No plan yet for this current-priority goal"); expect(context).not.toContain("Current:");
  });
});
