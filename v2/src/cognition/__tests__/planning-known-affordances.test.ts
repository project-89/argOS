import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../../demo/apartment-sitcom");
const { getDirectContainer, setLocatedIn } = await import("../../ecs/location");
const { Goal, ObjectState, Plan } = await import("../../ecs/components");
const { createIntentGoal, runActorControlStep } = await import("../cognition-system");
const { agentThink, addPerception } = await import("../agent-mind");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getAvailableAffordances, getKnownAffordances } = await import("../../world/affordance-availability");
const { validateGeneratedPlan, checkStepPrerequisites, getPlanForGoal, generatePlanForGoal, createPlanEntity } = await import("../planning-system");
const { getPrivateCommunications } = await import("../communication-memory");
const { chronicle } = await import("../simulation-chronicle");

let bed: Awaited<ReturnType<typeof ApartmentSitcom.create>> | undefined, oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Native planning tests must remain offline"));
});
afterEach(() => {
  bed?.stop(); bed = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});
async function fixture(phone = false) {
  bed = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, cognitionController: "priority" });
  const t = bed, world = t.sim.world, name = phone ? "Elaine" as const : "Jerry" as const, actor = t.ids[name];
  await t.start(); t.dispatch(name, { type: "move", target: "Kitchen" }); t.advance(3000);
  world.meta.aiEnabled = true;
  const goal = createIntentGoal(world, actor, phone ? "Check my phone" : "Have a coffee", 10);
  const steps = phone ? [{ type: "pickup", target: "Elaine's phone" }, { type: "interact", target: "Elaine's phone", content: "read_phone" }]
    : [{ type: "pickup", target: "Blue mug" }, { type: "interact", target: "Coffee pot", content: "pour" }];
  const proposal = () => ({ control: { version: 2, purpose: Goal.description[goal], goalId: goal, localDependencies: [] },
    action: { ...steps[0], goalId: goal }, motorPlan: steps });
  const plan = { goalDescription: Goal.description[goal], steps: steps.map(s => ({ ...s, actionType: s.type, description: `${s.type} ${s.target}` })),
    estimatedCompletion: "short", potentialObstacles: [] };
  return { t, world, name, actor, goal, steps, proposal, plan };
}

test("pickup then pour is a valid intention, not evidence that pouring is executable or coffee exists in the cup", async () => {
  const f = await fixture(), { t, world, actor } = f;
  const before = JSON.stringify(t.snapshot());
  expect(getAvailableAffordances(world, actor, t.ids.coffee).some(a => a.name === "pour")).toBe(false);
  expect(checkStepPrerequisites(world, actor, f.plan.steps[1])).toBe(false);
  expect(validateGeneratedPlan(world, actor, Goal.description[f.goal], f.plan)).toEqual({ ok: true, issues: [] });
  expect(JSON.stringify(t.snapshot())).toBe(before);
  expect(getDirectContainer(world, t.ids.blueMug)).toBe(t.ids.counter);
  expect(t.cup.filled[t.ids.blueMug]).toBe(false); expect(t.coffee.portions[t.ids.coffee]).toBe(4);
});

test.each(["normal", "supply_removed", "mug_moved"])("one foreground call can stage pickup→pour while native prerequisites remain authoritative (%s)", async variant => {
  const f = await fixture(), { t, world, actor } = f;
  generate.mockResolvedValue({ text: JSON.stringify(f.proposal()) });
  const action = await agentThink(world, actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  const id = getPlanForGoal(world, actor, f.goal)!;
  t.dispatch(f.name, action);
  expect(getDirectContainer(world, t.ids.blueMug)).toBe(t.ids.counter);
  runActorControlStep(world, actor, t.sim.god.systemRegistry);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
  t.advance(800); expect(getDirectContainer(world, t.ids.blueMug)).toBe(actor);
  if (variant === "supply_removed") { t.coffee.portions[t.ids.coffee] = 0; ObjectState.current[t.ids.coffee] = "empty"; }
  if (variant === "mug_moved") setLocatedIn(world, t.ids.blueMug, t.ids.living);
  runActorControlStep(world, actor, t.sim.god.systemRegistry);
  t.advance(1999); expect(t.cup.filled[t.ids.blueMug]).toBe(false);
  t.advance(1);
  expect(t.cup.filled[t.ids.blueMug]).toBe(variant === "normal");
  expect(t.coffee.portions[t.ids.coffee]).toBe(variant === "normal" ? 3 : variant === "supply_removed" ? 0 : 4);
  expect(Plan.status[id] === "completed").toBe(variant === "normal");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a pickup→read plan grants no message knowledge before the actual phone read completes", async () => {
  const f = await fixture(true), { t, world, actor } = f;
  const id = t.text("PRIVATE_READ_BOUNDARY"); t.advance(200);
  generate.mockResolvedValue({ text: JSON.stringify(f.proposal()) });
  const action = await agentThink(world, actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(t.context("Elaine")).not.toContain("PRIVATE_READ_BOUNDARY");
  expect(getPrivateCommunications(world, actor)).toHaveLength(0);
  t.dispatch("Elaine", action); t.advance(800);
  runActorControlStep(world, actor, t.sim.god.systemRegistry); t.advance(1199);
  expect(t.message.status[id]).toBe("delivered");
  expect(t.context("Elaine")).not.toContain("PRIVATE_READ_BOUNDARY");
  t.advance(1); expect(t.message.status[id]).toBe("read");
  expect(t.context("Elaine")).toContain("PRIVATE_READ_BOUNDARY");
  expect(t.context("Jerry")).not.toContain("PRIVATE_READ_BOUNDARY");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a chosen motor sequence retires an untouched search draft and reads natively without another inference", async () => {
  const f=await fixture(true),{t,world,actor}=f;
  const prior=createPlanEntity(world,actor,f.goal,{...f.plan,steps:[{description:"Inspect the kitchen",actionType:"observe",target:"Kitchen"}]});
  const basis=JSON.stringify([Plan.steps[prior],Plan.currentStep[prior]]);
  const message=t.text("PRIVATE_MOTOR_RESULT");t.advance(200);
  const record=jest.spyOn(chronicle,"record");
  addPerception(world,actor,{type:"attention",source:"phone",content:"My phone vibrates."});
  // Match the runtime's intake-before-deliberation order. Otherwise the test
  // delivers the original notification only after pickup, a valid interruption.
  expect(runActorControlStep(world,actor,t.sim.god.systemRegistry)).toBe(true);
  generate.mockResolvedValue({text:JSON.stringify(f.proposal())});
  const action=await agentThink(world,actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);expect(action.type).toBe("pickup");
  expect(getPlanForGoal(world,actor,f.goal)).not.toBe(prior);
  expect(Plan.status[prior]).toBe("retired");
  expect(JSON.stringify([Plan.steps[prior],Plan.currentStep[prior]])).toBe(basis);
  expect(record.mock.calls.filter(([kind])=>kind==="motor_plan_admitted")).toHaveLength(1);
  expect(getDirectContainer(world,t.ids.phone)).toBe(t.ids.counter);
  t.dispatch(f.name,action);t.advance(800);
  expect(getDirectContainer(world,t.ids.phone)).toBe(actor);
  expect(getPrivateCommunications(world,actor)).toEqual([]);
  expect(t.context("Elaine")).not.toContain("PRIVATE_MOTOR_RESULT");
  const actions: string[]=[];
  runActorControlStep(world,actor,t.sim.god.systemRegistry,{onAction: action=>actions.push(action.type)});
  expect({ actions, status: Plan.status[getPlanForGoal(world,actor,f.goal)!], cursor: Plan.currentStep[getPlanForGoal(world,actor,f.goal)!] })
    .toEqual({ actions: ["interact"], status: "active", cursor: 1 });
  t.advance(1199);expect(t.message.status[message]).toBe("delivered");
  t.advance(1);expect(t.message.status[message]).toBe("read");
  expect(actions).toEqual(["interact"]);expect(generate).toHaveBeenCalledTimes(1);
  expect(t.context("Jerry")).not.toContain("PRIVATE_MOTOR_RESULT");
  expect(Goal.status[f.goal]).toBe("active");
});

test.each(["progress", "decision", "barrier", "motor"])("an optional motor prefix preserves a prior %s plan", async kind => {
  const f=await fixture(true),{t,world,actor}=f;
  const prior=createPlanEntity(world,actor,f.goal,f.plan);
  if(kind==="progress")Plan.currentStep[prior]=1;
  if(kind==="decision")Plan.status[prior]="awaiting_decision";
  if(kind==="barrier")Plan.steps[prior]=JSON.stringify([{actionType:"wait",waitUntil:{kind:"heard_evidence",timeoutMs:15000}}]);
  if(kind==="motor")Plan.steps[prior]=JSON.stringify(JSON.parse(Plan.steps[prior]).map((s:any)=>({...s,motorScope:"owned-existing-motor"})));
  const basis=JSON.stringify([Plan.status[prior],Plan.steps[prior],Plan.currentStep[prior]]);
  addPerception(world,actor,{type:"attention",source:"phone",content:"My phone vibrates."});
  generate.mockResolvedValue({text:JSON.stringify(f.proposal())});
  const action=await agentThink(world,actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);expect(action.type).toBe("pickup");
  expect(getPlanForGoal(world,actor,f.goal)).toBe(prior);
  expect(JSON.stringify([Plan.status[prior],Plan.steps[prior],Plan.currentStep[prior]])).toBe(basis);
  expect(getPrivateCommunications(world,actor)).toEqual([]);
});

test("an existing plan does not excuse a malformed or speculative motor prefix", async () => {
  const f=await fixture(true);
  const prior=createPlanEntity(f.world,f.actor,f.goal,f.plan),proposal=f.proposal();
  proposal.motorPlan.push({type:"interact",target:"Elaine's phone",content:"reply_phone I already know the unread text"});
  addPerception(f.world,f.actor,{type:"attention",source:"phone",signalKey:"fresh",content:"My phone vibrates."});
  generate.mockResolvedValue({text:JSON.stringify(proposal)});
  expect(isDiscardedForegroundDecision(await agentThink(f.world,f.actor))).toBe(true);
  expect(getPlanForGoal(f.world,f.actor,f.goal)).toBe(prior);
  expect(getDirectContainer(f.world,f.t.ids.phone)).toBe(f.t.ids.counter);
});

test("background planning receives known operations with their current readiness, not pretend possession", async () => {
  const f = await fixture();
  const planner = jest.fn(async (_input: any) => ({ text: JSON.stringify(f.plan) }));
  expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: planner as any })).not.toBeNull();
  const prompt = planner.mock.calls[0][0].system;
  expect(prompt).toContain("pour (prerequisites not met now)");
  expect(prompt).toContain("Blue mug"); expect(prompt).toContain("native actions: pickup");
  expect(getDirectContainer(f.world, f.t.ids.blueMug)).toBe(f.t.ids.counter);
  expect(f.t.coffee.portions[f.t.ids.coffee]).toBe(4);
});

test.each(["reply", "unknown_command", "unread_reaction"])("a catalogue does not make %s a valid pre-scripted motor choice", async kind => {
  const f = await fixture(true), record = jest.spyOn(chronicle, "record");
  f.t.text("UNREAD_PRIVATE_ARGUMENT"); f.t.advance(200);
  const proposal = f.proposal();
  const second = kind === "unknown_command" ? { type: "interact", target: "Elaine's phone", content: "invented_upload" }
    : { type: "interact", target: "Elaine's phone", content: 'reply {"replyTo":999,"text":"Unseen conclusion"}' };
  proposal.motorPlan = kind === "unread_reaction" ? [...proposal.motorPlan, second] : [proposal.motorPlan[0], second];
  generate.mockResolvedValue({ text: JSON.stringify(proposal) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(record).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ schemaField: "motorPlan" }));
  expect(f.t.context("Elaine")).not.toContain("UNREAD_PRIVATE_ARGUMENT");
  expect(getDirectContainer(f.world, f.t.ids.phone)).toBe(f.t.ids.counter);
  expect(getKnownAffordances(f.world, f.actor, f.t.ids.phone).find(a => a.name === "reply")?.requiresFreshDecision).toBe(true);
});
