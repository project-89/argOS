import { jest } from "@jest/globals";
import { removeComponent } from "bitecs";
import { Goal, LastAction, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { getCommittedEvents } from "../../runtime/committed-events";
import { createIntentGoal, executeActions, completeDeferredAction, capturePlanExecution, advanceAgentPlan } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { getSuccessfulGoalActions } from "../goal-learning";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";
import type { AgentAction } from "../agent-mind";

const removers: Array<() => void> = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline episode tests")); });
afterEach(() => { removers.splice(0).forEach(remove => remove()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

function fixture(withPlan = true) {
  const world = createArgosWorld("Original execution episode"); world.meta.aiEnabled = false; world.meta.timedActions = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use real evidence.", roomId: room });
  const item = createObjectEntity(world, { name: "Brass key", roomId: room, portable: true });
  const registry = createSystemRegistry(), goal = createIntentGoal(world, actor, "Collect the brass key");
  const plan = withPlan ? createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal],
    steps: [{ description: "Take the key", actionType: "pickup", target: "Brass key" }], estimatedCompletion: "short", potentialObstacles: [] }) : undefined;
  const action: AgentAction = { type: "pickup", target: "Brass key" };
  const execute = () => executeActions(world, [{ eid: actor, action }], registry);
  const advance = () => advanceSimulationTimeline(world, 800, { integrate: () => {} });
  return { world, room, actor, item, registry, goal, plan, action, execute, advance };
}

test.each(["createdAt", "steps", "identity", "detached"])("native completion cannot advance a plan after its %s changes", changed => {
  const f = fixture(), plan = f.plan!; f.execute();
  if (changed === "createdAt") Plan.createdAt[plan] += 1;
  if (changed === "steps") Plan.steps[plan] = JSON.stringify([{ description: "Replacement episode with the same action", actionType: "pickup", target: "Brass key" }]);
  if (changed === "identity") WorkingMemoryIdentity.id[plan] = "plan:replacement";
  if (changed === "detached") removeComponent(f.world, f.actor, HasPlan(plan));
  f.advance();
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(LastAction.success[f.actor]).toBe(true);
  expect(Plan.status[plan]).toBe("active"); expect(Plan.currentStep[plan]).toBe(0);
  expect(getCommittedEvents(f.world).events.at(-1)).toMatchObject({ status: "succeeded", atSimMs: 800 });
  // The original unchanged goal may still learn from valid physical work.
  expect(getSuccessfulGoalActions(f.world, f.actor, f.goal)).toHaveLength(1);
});

test.each(["createdAt", "description", "kind", "paramsJson", "successJson", "signature", "identity", "detached"])(
  "native completion neither advances nor teaches a goal after its %s changes", changed => {
    const f = fixture(); f.execute();
    if (changed === "createdAt") Goal.createdAt[f.goal] += 1;
    else if (changed === "identity") WorkingMemoryIdentity.id[f.goal] = "goal:replacement";
    else if (changed === "detached") removeComponent(f.world, f.actor, HasGoal(f.goal));
    else Goal[changed as "description" | "kind" | "paramsJson" | "successJson" | "signature"][f.goal] += " changed";
    f.advance();
    expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
    expect(LastAction.success[f.actor]).toBe(true);
    expect(Plan.status[f.plan!]).toBe("active"); expect(Plan.currentStep[f.plan!]).toBe(0);
    expect(getSuccessfulGoalActions(f.world, f.actor, f.goal)).toHaveLength(0);
  });

test("off-plan work also captures its goal episode before physical admission", () => {
  const f = fixture(false); f.execute(); Goal.createdAt[f.goal] += 1;
  f.advance();
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(getSuccessfulGoalActions(f.world, f.actor, f.goal)).toHaveLength(0);
});

test("progress, priority and deadline updates do not starve an unchanged episode", () => {
  const f = fixture(); f.execute();
  Goal.progress[f.goal] = 20; Goal.priority[f.goal] = 1; Goal.deadline[f.goal] += 1000; Plan.lastUpdated[f.plan!] += 1;
  f.advance();
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(Plan.status[f.plan!]).toBe("completed");
  expect(getSuccessfulGoalActions(f.world, f.actor, f.goal)).toHaveLength(1);
});

test.each(["plan", "goal"])("deferred package success preserves physical evidence without crediting replaced %s", changed => {
  const f = fixture(); let issued!: AgentAction;
  removers.push(registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: action => { issued = { ...action }; return true; } }));
  f.execute();
  if (changed === "plan") Plan.createdAt[f.plan!] += 1; else Goal.createdAt[f.goal] += 1;
  setLocatedIn(f.world, f.item, f.actor); // The package's actual physical completion.
  completeDeferredAction(f.world, f.actor, issued, true, "You picked up the real brass key.");
  expect(LastAction.success[f.actor]).toBe(true); expect(Plan.status[f.plan!]).toBe("active");
  expect(getSuccessfulGoalActions(f.world, f.actor, f.goal)).toHaveLength(changed === "goal" ? 0 : 1);
});

test("a stale package failure cannot fail a replacement plan", () => {
  const f = fixture(); let issued!: AgentAction;
  removers.push(registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: action => { issued = { ...action }; return true; } }));
  f.execute(); Plan.createdAt[f.plan!] += 1;
  completeDeferredAction(f.world, f.actor, issued, false, "The physical pickup failed.");
  expect(LastAction.success[f.actor]).toBe(false); expect(Plan.status[f.plan!]).toBe("active");
});

test("captured episode remains strict when routed through the public advancement helper", () => {
  const f = fixture(), issuance = capturePlanExecution(f.world, f.actor, f.action)!;
  Plan.createdAt[f.plan!] += 1;
  expect(advanceAgentPlan(f.world, f.actor, issuance)).toBe(false);
  expect(Plan.currentStep[f.plan!]).toBe(0); expect(Plan.status[f.plan!]).toBe("active");
});
