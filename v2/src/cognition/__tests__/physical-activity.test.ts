import { publicPhysicalOperation } from "../physical-activity";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeActions } from "../cognition-system";
import { getObservedPublicActivity } from "../world-capabilities";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";

test("public labels describe the admitted verb, never its private arguments", () => {
  expect(publicPhysicalOperation({ type: "interact", content: "  UNLOCK 3149" })).toBe("opening");
  expect(publicPhysicalOperation({ type: "interact", content: "align cobalt" })).toBe("calibrating");
  expect(publicPhysicalOperation({ type: "interact", content: "invented_private_plan" })).toBeUndefined();
  expect(publicPhysicalOperation({ type: "interact", content: "__proto__" })).toBeUndefined();
  expect(publicPhysicalOperation({ type: "think", content: "install the secret device" })).toBeUndefined();
});

test("native finite work is observable through its body reservation only while active", () => {
  const world = createArgosWorld("Visible work"); world.meta.timedActions = true; world.meta.aiEnabled = false;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Work", roomId: room });
  const observer = createAgentEntity(world, { name: "Bea", role: "resident", systemPrompt: "Observe", roomId: room });
  createObjectEntity(world, { name: "Brass spool", portable: true, roomId: room });
  executeActions(world, [{ eid: actor, action: { type: "pickup", target: "Brass spool" } }], createSystemRegistry());
  expect(getObservedPublicActivity(world, observer, actor)).toBe("picking up Brass spool");
  advanceSimulationTimeline(world, 800, { integrate: () => {} });
  expect(getObservedPublicActivity(world, observer, actor)).toBeUndefined();
});
