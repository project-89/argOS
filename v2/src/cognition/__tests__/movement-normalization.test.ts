import { jest } from "@jest/globals";
import { removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { BehaviorPolicy, Goal, LastAction, Plan } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { clearMovementTarget, setMovementTarget } from "../../systems/builtin-systems";
import { agentThink } from "../agent-mind";
import { createIntentGoal, executeActions } from "../cognition-system";
import { setGoalContract } from "../goal-contract";
import { createPlanEntity } from "../planning-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";

function fixture(destination = "Utility Room") {
  const world = createArgosWorld("Movement arbitration");
  world.meta.aiEnabled = false;
  initializePrefabs(world);
  const common = createRoomEntity(world, { name: "Common Room" });
  const utility = createRoomEntity(world, { name: "Utility Room" });
  const actor = createAgentEntity(world, { name: "Ivo", role: "caretaker", systemPrompt: "Repair the lamp safely.", roomId: common });
  BehaviorPolicy.enabled[actor] = false;
  clearMovementTarget(actor);
  const goal = createIntentGoal(world, actor, "Restore the reading lamp safely", 8);
  const plan = createPlanEntity(world, actor, goal, {
    goalDescription: "Restore the reading lamp safely", estimatedCompletion: "short", potentialObstacles: [],
    steps: [
      { description: "I will move to the Utility Room to check the isolation switch and supply cupboard.", actionType: "move", target: destination },
      { description: "Inspect the room", actionType: "observe", target: destination },
    ],
  });
  return { world, common, utility, actor, goal, plan, registry: createSystemRegistry() };
}

beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("This regression must not call a model"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  drainPendingStimuli();
});

test.each(["Follow schedule: leisure (Common Room)", "Discuss when to go to the workshop"])(
  "a lower-priority non-navigation goal cannot convert the planned move into wait: %s", async description => {
    const f = fixture();
    const otherGoal = createIntentGoal(f.world, f.actor, description, 5);
    if (description.startsWith("Follow schedule")) {
      setGoalContract(f.world, otherGoal, {
        version: 1, kind: "scheduled_activity", params: { activityType: "leisure_block", roomName: "Common Room" },
        success: { type: "did_action_type", actionType: "interact" },
      });
    }
    const action = await agentThink(f.world, f.actor);
    expect(action).toMatchObject({ type: "move", target: "Utility Room" });
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    expect(getRoomForEntity(f.world, f.actor)).toBe(f.utility);
    expect(Plan.currentStep[f.plan]).toBe(1);
    expect(Goal.status[otherGoal]).toBe("active");
  },
);

test("an already-arrived planned move is reconciled without a fictional movement receipt", async () => {
  const f = fixture("Common Room");
  const satisfiedMovement = createIntentGoal(f.world, f.actor, "Go to Common Room", 5);
  setGoalContract(f.world, satisfiedMovement, {
    version: 1, kind: "move_to_room", params: { roomName: "Common Room" }, success: { type: "in_room", roomName: "Common Room" },
  });
  const before = [LastAction.type[f.actor], LastAction.target[f.actor], LastAction.success[f.actor], LastAction.timestamp[f.actor]];
  const action = await agentThink(f.world, f.actor);
  expect(action).toMatchObject({ type: "observe" });
  expect([LastAction.type[f.actor], LastAction.target[f.actor], LastAction.success[f.actor], LastAction.timestamp[f.actor]]).toEqual(before);
  expect(Plan.currentStep[f.plan]).toBe(1);
  expect(JSON.parse(Plan.steps[f.plan])[0].resolution).toMatchObject({ kind: "already_here", sourceId: "own-location" });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.common);
  expect(LastAction.type[f.actor]).toBe("observe");
  expect(LastAction.success[f.actor]).toBe(true);
  expect(Plan.currentStep[f.plan]).toBe(1);
});

test("native grid transit suppresses duplicate navigation but a deleted target cannot strand the actor", async () => {
  const f = fixture();
  const destination = createRoomEntity(f.world, { name: "Attic" });
  setMovementTarget(f.actor, destination);
  try {
    expect(await agentThink(f.world, f.actor)).toEqual({ type: "wait" });
    removeEntity(f.world, destination);
    expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Utility Room" });
  } finally { clearMovementTarget(f.actor); }
});

test("only a typed goal with an existing unreached destination counts as native movement intent", async () => {
  const f = fixture();
  const navigation = createIntentGoal(f.world, f.actor, "Travel to the controls", 5);
  setGoalContract(f.world, navigation, {
    version: 1, kind: "move_to_room", params: { roomName: "Utility Room" }, success: { type: "in_room", roomName: "Utility Room" },
  });
  expect(await agentThink(f.world, f.actor)).toEqual({ type: "wait" });
  Goal.paramsJson[navigation] = JSON.stringify({ roomName: "Common Room" });
  expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Utility Room" });
  Goal.paramsJson[navigation] = "malformed";
  expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Utility Room" });
  Goal.paramsJson[navigation] = JSON.stringify({ roomName: "Imaginary attic" });
  expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Utility Room" });
});

test("a package that owns movement uses its actual busy state rather than a native schedule's grid intent", async () => {
  const f = fixture();
  let busy = false;
  const remove = registerAgentWorldCapabilities(f.world, f.actor, {
    ownsMovement: true, context: () => "A three-second indoor walk", ready: () => !busy, busy: () => busy, execute: () => true,
  });
  const navigation = createIntentGoal(f.world, f.actor, "Go to Utility Room", 5);
  setGoalContract(f.world, navigation, {
    version: 1, kind: "move_to_room", params: { roomName: "Utility Room" }, success: { type: "in_room", roomName: "Utility Room" },
  });
  setMovementTarget(f.actor, f.utility);
  try {
    expect(await agentThink(f.world, f.actor)).toMatchObject({ type: "move", target: "Utility Room" });
    busy = true;
    expect(await agentThink(f.world, f.actor)).toEqual({ type: "wait" });
  } finally { clearMovementTarget(f.actor); remove(); }
});
