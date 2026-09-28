import { addComponent, Prefab } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Removed } from "../../ecs/components";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { entityExistsByName, validateAgentAction, validateNarrativeEvent, recordIssue, getAccumulatedIssues, getAndClearAccumulatedIssues, checkNarrativeMechanics } from "../consistency-spirit";
import { getTopObservations, resetAggregator } from "../observation-aggregator";
function fixture() {
  const world = createArgosWorld("Grounding"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Study" }); return { world, room };
}
beforeEach(() => { getAndClearAccumulatedIssues(); resetAggregator(); });
test("ordinary named props resolve case-insensitively; ambiguous names do not pick arbitrarily", () => {
  const f = fixture(), a = createObjectEntity(f.world, { name: "Oil can", roomId: f.room });
  expect(entityExistsByName(f.world, " OIL CAN ")).toBe(a);
  createObjectEntity(f.world, { name: "Oil can", roomId: f.room });
  expect(entityExistsByName(f.world, "Oil can")).toBeNull();
});
test.each([Removed, Prefab])("removed/prefab named props are not physical candidates", component => {
  const f = fixture(), prop = createObjectEntity(f.world, { name: "Oil can", roomId: f.room }); addComponent(f.world, prop, component);
  expect(entityExistsByName(f.world, "Oil can")).toBeNull();
});
test("absence in action and narration never becomes repair permission", () => {
  const f = fixture();
  const issues = [...validateAgentAction(f.world, "Mara", "examine", "north key"), ...validateNarrativeEvent(f.world, "She takes the missing can", ["Oil can"])];
  expect(issues.length).toBeGreaterThanOrEqual(2);
  for (const issue of issues) { expect(issue.autoFixable).toBe(false); expect(issue.recommendation).not.toMatch(/^Create/); }
  expect(entityExistsByName(f.world, "Oil can")).toBeNull();
});
test("issues retain originating world and expire with its source", () => {
  const a = fixture(), b = fixture();
  const [issue] = validateNarrativeEvent(a.world, "A private-world unresolved prop", ["A prop"]); recordIssue(issue);
  expect(getAccumulatedIssues(a.world)).toHaveLength(1); expect(getAccumulatedIssues(b.world)).toEqual([]);
  expect(getTopObservations(10, b.world)).toEqual([]); expect(getTopObservations(10, a.world)).toHaveLength(1);
  getAndClearAccumulatedIssues(b.world); expect(getAccumulatedIssues(a.world)).toHaveLength(1);
  stopCommittedEvents(a.world);
  expect(getAccumulatedIssues(a.world)).toEqual([]); expect(getTopObservations(10, a.world)).toEqual([]);
  expect(getAccumulatedIssues()).toContain(issue); // Failed evidence still inspectable.
});
test("text-only mechanics check makes no claim a system is absent", () => {
  const issues = checkNarrativeMechanics("Mara strikes the foe and picks up a bag.");
  expect(issues.length).toBeGreaterThan(0);
  expect(issues.every(issue => issue.category !== "missing_system" && !issue.autoFixable)).toBe(true);
});
