import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, LastAction, ObjectState, ObjectType, Perception, Plan } from "../../ecs/components";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { createIntentGoal, executeActions, completeDeferredAction, advanceAgentPlan, recordCompletedGoalAction } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { addPerception, buildAgentContext, getAgentPerceptions, type AgentAction } from "../agent-mind";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";
import { setLocatedIn } from "../../ecs/location";
import { setGoalContract } from "../goal-contract";
import { createGoalEvaluationSystem } from "../../systems/builtin-systems";
import { captureLLMDecision, getCompilationStats, resetCompilerState } from "../bt-compiler";
import { setAgentBehaviorPolicy } from "../behavior-policy";
import { getGoalLearningStats, onGoalCompleted, resetGoalLearning } from "../goal-learning";
import { readGoalAttemptActivity } from "../goal-attempt";

function fixture() {
  const world = createArgosWorld("Cognition proof"); world.meta.aiEnabled = false;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const remote = createRoomEntity(world, { name: "Store" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Be grounded.", roomId: room });
  const registry = createSystemRegistry();
  function plan(action: AgentAction, priority = 5) {
    const goal = createIntentGoal(world, actor, `Finish ${action.type} ${action.target || ""}`, priority);
    const id = createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [],
      steps: [{ description: "Do the required action", actionType: action.type, target: action.target, content: action.content },
        { description: "Verify the result", actionType: "observe", target: "Workshop" }] });
    return { goal, id };
  }
  return { world, room, remote, actor, registry, plan };
}

beforeEach(() => { drainPendingStimuli(); resetCompilerState(); resetGoalLearning(); });
afterEach(() => jest.restoreAllMocks());

test.each(["pickup", "drop", "give", "move", "examine", "use", "attack"] as const)("failed %s cannot advance a plan or leave successful action evidence", type => {
  const f = fixture();
  const action = { type, target: "Nonexistent target", content: "Nonexistent item" };
  const p = f.plan(action);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(Plan.currentStep[p.id]).toBe(0);
  expect(Goal.status[p.goal]).toBe("active");
  expect(LastAction.success[f.actor]).toBe(false);
});

test("observing the current room is valid; observing a remote room is not", () => {
  const f = fixture();
  executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Workshop" } }], f.registry);
  expect(LastAction.success[f.actor]).toBe(true);
  executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Store" } }], f.registry);
  expect(LastAction.success[f.actor]).toBe(false);
});

test("failed remote pickup does not disclose the hidden object's room", () => {
  const f = fixture();
  createObjectEntity(f.world, { name: "Fuse", roomId: f.remote });
  executeActions(f.world, [{ eid: f.actor, action: { type: "pickup", target: "Fuse" } }], f.registry);
  expect(drainPendingStimuli().filter(s => s.targetEid === f.actor).map(s => s.content).join("\n")).not.toContain('located in "Store"');
});

test("finishing an unverified custom plan is not proof of goal completion", () => {
  const f = fixture();
  const goal = createIntentGoal(f.world, f.actor, "Make the house safe", 8);
  const id = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Make the house safe", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Think about safety", actionType: "think", content: "It might be safe." }] });
  executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: "It might be safe." } }], f.registry);
  expect(Plan.status[id]).toBe("completed");
  expect(Goal.status[goal]).toBe("active");
  expect(Goal.progress[goal]).toBeLessThan(100);
});

test("a failed deferred step invalidates only its own plan, not a suspended goal", () => {
  const f = fixture();
  const low = f.plan({ type: "observe", target: "Workshop" }, 3);
  const action: AgentAction = { type: "pickup", target: "Fuse" };
  createObjectEntity(f.world, { name: "Fuse", roomId: f.room, portable: true });
  const high = f.plan(action, 9);
  let received!: AgentAction;
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: action => { received = action; return true; } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  completeDeferredAction(f.world, f.actor, received, false, "The fuse was moved before pickup finished.");
  expect(Plan.status[high.id]).toBe("failed");
  expect(Plan.status[low.id]).toBe("active");
});

test("an old deferred result cannot advance a replacement plan with the same first action", () => {
  const f = fixture(); const action: AgentAction = { type: "pickup", target: "Fuse" };
  const fuse = createObjectEntity(f.world, { name: "Fuse", roomId: f.room, portable: true });
  const old = f.plan(action, 9);
  let received!: AgentAction;
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: action => { received = action; return true; } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  Plan.status[old.id] = "failed";
  const replacement = createPlanEntity(f.world, f.actor, old.goal, { goalDescription: "Try again", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Take fuse again", actionType: "pickup", target: "Fuse" }, { description: "Wait", actionType: "wait" }] });
  setLocatedIn(f.world, fuse, f.actor); // The package commits the original transfer before acknowledging it.
  completeDeferredAction(f.world, f.actor, received, true, "The original pickup finished.");
  expect(Plan.currentStep[replacement]).toBe(0);
});

test("a mismatched deferred completion cannot train the goal of another pending action", () => {
  const f = fixture(); const action: AgentAction = { type: "pickup", target: "Fuse" };
  const fuse = createObjectEntity(f.world, { name: "Fuse", roomId: f.room, portable: true });
  setAgentBehaviorPolicy(f.world, f.actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
  const pending = f.plan(action, 9);
  let received!: AgentAction;
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: action => { received = action; return true; } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  completeDeferredAction(f.world, f.actor, { ...received, type: "observe", target: "Workshop" }, true, "An unrelated observation finished.");
  expect(getGoalLearningStats(f.world, f.actor).activeGoalActions).toBe(0);
  expect(Plan.currentStep[pending.id]).toBe(0);
  setLocatedIn(f.world, fuse, f.actor);
  completeDeferredAction(f.world, f.actor, received, true, "The fuse pickup finished.");
  expect(getGoalLearningStats(f.world, f.actor).activeGoalActions).toBe(1);
  expect(Plan.currentStep[pending.id]).toBe(1);
});

test("retained urgent perceptions actually reach cognition context after a furnishing burst", () => {
  const f = fixture();
  addPerception(f.world, f.actor, { type: "attention", content: "URGENT_PHONE_SIGNAL", source: "phone" });
  for (let i = 0; i < 40; i++) addPerception(f.world, f.actor, { type: "visual", content: `Routine object ${i}`, source: "room" });
  expect(buildAgentContext(f.world, f.actor)).toContain("URGENT_PHONE_SIGNAL");
});

test("direct speech cannot reach an actor in a different room", () => {
  const f = fixture();
  const other = createAgentEntity(f.world, { name: "Ivo", role: "resident", systemPrompt: "Test", roomId: f.remote });
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", target: "Ivo", content: "PRIVATE_LOCAL_SPEECH" } }], f.registry);
  expect(drainPendingStimuli().filter(s => s.targetEid === other).map(s => s.content).join("\n")).not.toContain("PRIVATE_LOCAL_SPEECH");
});

test("partial speech content cannot satisfy a different planned statement", () => {
  const f = fixture(); const p = f.plan({ type: "speak", content: "Do not open the door" });
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: "open the door" } }], f.registry);
  expect(Plan.currentStep[p.id]).toBe(0);
});

test("inaccessible interact does not disclose a remote room or an unseen remote container", () => {
  const f = fixture();
  const fuse = createObjectEntity(f.world, { name: "Fuse", roomId: f.remote });
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Fuse", content: "take" } }], f.registry);
  let failures = getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id]).join("\n");
  expect(failures).not.toContain('inside "Store"');
  const box = createObjectEntity(f.world, { name: "Secret remote drawer", roomId: f.remote });
  setLocatedIn(f.world, fuse, box);
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Fuse", content: "examine" } }], f.registry);
  failures = getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id]).join("\n");
  expect(failures).not.toContain("Secret remote drawer");
});

test("an accessible local container can still provide a useful failure hint", () => {
  const f = fixture();
  const box = createObjectEntity(f.world, { name: "Visible drawer", roomId: f.room });
  const fuse = createObjectEntity(f.world, { name: "Fuse", roomId: f.room });
  setLocatedIn(f.world, fuse, box);
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Fuse", content: "take" } }], f.registry);
  expect(getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id]).join("\n")).toContain('inside "Visible drawer"');
});

test("canonical open: success satisfies an open goal with actual physical proof", () => {
  const f = fixture();
  const door = createObjectEntity(f.world, { name: "Door", roomId: f.room, traits: ["openable"] });
  ObjectType.typeId[door] = "door"; ObjectState.current[door] = "closed";
  const goal = createIntentGoal(f.world, f.actor, "Open the door", 8);
  setGoalContract(f.world, goal, { version: 1, kind: "use_affordance", params: {}, success: { type: "did_interact", targetName: "Door", affordance: "open" } });
  const evaluator = createGoalEvaluationSystem(); evaluator.frequency = 0; registerSystem(f.registry, evaluator);
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Door", content: "open:" } }], f.registry);
  runSystems(f.world, f.registry, 1, 1000);
  expect(ObjectState.current[door]).toBe("open"); expect(LastAction.content[f.actor]).toBe("open");
  expect(LastAction.success[f.actor]).toBe(true); expect(Goal.status[goal]).toBe("completed");
});

test("argument whitespace survives execution and different quoted arguments cannot advance the same step", () => {
  const f = fixture(); createObjectEntity(f.world, { name: "Plaque", roomId: f.room });
  const action: AgentAction = { type: "interact", target: "Plaque", content: 'examine {"text":"two  spaces"}' };
  const p = f.plan(action);
  executeActions(f.world, [{ eid: f.actor, action: { ...action, content: 'examine {"text":"two spaces"}' } }], f.registry);
  expect(Plan.currentStep[p.id]).toBe(0);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(LastAction.content[f.actor]).toBe(action.content); expect(Plan.currentStep[p.id]).toBe(1);
});

test("afterAction reprioritization cannot credit the just-created plan with an earlier action", () => {
  const f = fixture(); const action: AgentAction = { type: "observe", target: "Workshop" }; const old = f.plan(action, 5);
  let replacement: ReturnType<typeof f.plan> | undefined;
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: () => false,
    afterAction: () => { replacement = f.plan(action, 10); } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(Plan.currentStep[old.id]).toBe(1); expect(Plan.currentStep[replacement!.id]).toBe(0);
});

test("afterAction plan replacement cannot inherit the old action's success", () => {
  const f = fixture(); const action: AgentAction = { type: "observe", target: "Workshop" }; const old = f.plan(action, 5);
  let replacement: number | undefined;
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: () => false,
    afterAction: () => {
      Plan.status[old.id] = "failed";
      replacement = createPlanEntity(f.world, f.actor, old.goal, { goalDescription: "Revised plan", estimatedCompletion: "short", potentialObstacles: [], steps: [
        { description: "Observe again", actionType: "observe", target: "Workshop" }, { description: "Wait", actionType: "wait" },
      ] });
    } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(Plan.currentStep[replacement!]).toBe(0);
});

test("repeated failure invalidates its captured plan even when a hook reprioritizes an identical-looking step", () => {
  const f = fixture(); const action: AgentAction = { type: "interact", target: "Missing button", content: "press" };
  const old = f.plan(action, 5); const other = f.plan(action, 3);
  let now = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => now);
  registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute: () => false,
    afterAction: () => { Goal.priority[other.goal] = Goal.priority[old.goal] + 1; } });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  now += 6000; Goal.priority[old.goal] = 20;
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(Plan.status[old.id]).toBe("failed"); expect(Plan.status[other.id]).toBe("active");
});

test.each(["", "not json", "[]", "{}", "[null]", "[{}]", '[{"actionType":"unimplemented_nonsense"}]'])("malformed steps %s cannot pretend a plan was exhausted successfully", steps => {
  const f = fixture(); const p = f.plan({ type: "observe", target: "Workshop" }); Plan.steps[p.id] = steps;
  expect(advanceAgentPlan(f.world, f.actor)).toBe(false);
  expect(Plan.status[p.id]).not.toBe("completed"); expect(Goal.status[p.goal]).toBe("active"); expect(Goal.progress[p.goal]).toBe(0);
});

test("a synchronous result cannot resolve a different pending model decision", () => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
  captureLLMDecision(f.world, f.actor, "Check another result", { type: "interact", target: "Other device", content: "verify" });
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: "This is a different action." } }], f.registry);
  expect(getCompilationStats(f.actor)).toMatchObject({ pendingDecision: true, compiledBranches: 0 });
});

test("explicit completed-action attribution trains only the captured goal, not a newly urgent one", () => {
  const f = fixture();
  setAgentBehaviorPolicy(f.world, f.actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
  const old = createIntentGoal(f.world, f.actor, "Original captured goal", 5);
  const urgent = createIntentGoal(f.world, f.actor, "A new unrelated emergency", 10);
  recordCompletedGoalAction(f.world, f.actor, { type: "speak", content: "First actual result" }, old);
  recordCompletedGoalAction(f.world, f.actor, { type: "speak", content: "Second actual result" }, old);
  expect(readGoalAttemptActivity(f.world, f.actor, old)).toBe(f.world.time.elapsed);
  expect(readGoalAttemptActivity(f.world, f.actor, urgent)).toBeUndefined();
  expect(getGoalLearningStats(f.world, f.actor).activeGoalActions).toBe(1);
  onGoalCompleted(f.world, f.actor, urgent); expect(getGoalLearningStats(f.world, f.actor).compiledGoalSkills).toBe(0);
  onGoalCompleted(f.world, f.actor, old); expect(getGoalLearningStats(f.world, f.actor).compiledGoalSkills).toBe(1);
  recordCompletedGoalAction(f.world, f.actor, { type: "wait" }, urgent);
  expect(readGoalAttemptActivity(f.world, f.actor, urgent)).toBeUndefined();
});
