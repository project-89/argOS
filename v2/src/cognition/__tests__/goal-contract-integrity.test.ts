import { addEntity, addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Goal } from "../../ecs/components";
import { ensureGoalSignature, setGoalContract } from "../goal-contract";

describe("Goal identity follows authoritative contract edits", () => {
  test("changing a goal in place invalidates the cached procedural identity", () => {
    const world = createArgosWorld("contract edit"); const goal = addEntity(world); addComponent(world, goal, Goal);
    const original = setGoalContract(world, goal, { version: 1, kind: "move_to_room", params: { destination: "Bedroom" }, success: { type: "in_room", roomName: "Bedroom" } });
    Goal.successJson[goal] = JSON.stringify({ type: "in_room", roomName: "Basement" });
    expect(ensureGoalSignature(world, goal)).not.toBe(original);
    const changed = Goal.signature[goal]; Goal.description[goal] = "Only rewrite the wording";
    expect(ensureGoalSignature(world, goal)).toBe(changed);
  });

  test("malformed edited contract data cannot retain a trusted cached signature", () => {
    const world = createArgosWorld("invalid contract"); const goal = addEntity(world); addComponent(world, goal, Goal);
    setGoalContract(world, goal, { version: 1, kind: "custom", params: {}, success: { type: "has_trait", trait: "safe" } });
    Goal.successJson[goal] = "{";
    expect(ensureGoalSignature(world, goal)).toBeNull();
  });
});
