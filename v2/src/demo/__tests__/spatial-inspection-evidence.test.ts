import { jest } from "@jest/globals";
import { SpatialDemo } from "../spatial-demo";
import { Description, ObjectState, WorkingMemoryIdentity } from "../../ecs/components";
import { getCurrentInspection } from "../../cognition/inspection-memory";
import { getWorkingMemory } from "../../cognition/working-memory";

beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Saltmere evidence check is offline")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("Saltmere's native inspection retains its real lid evidence before and after opening", async () => {
  const demo = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "town", evolving: true, story: "coastal-mystery" });
  try {
    await demo.start();
    const actor = demo.snapshot().actors.find(row => row.name === "Ada")!;
    const box = demo.byId.get("workshop-box")!;
    expect(box).toBeDefined();
    const exterior = Description.value[box];
    expect(exterior).toContain("Three shallow hooked cuts");
    const inspect = () => {
      demo.dispatch(actor.key, "observe", WorkingMemoryIdentity.id[box]); demo.advance(20_000);
      return getCurrentInspection(demo.sim.world, actor.id, WorkingMemoryIdentity.id[box]);
    };
    const closed = inspect()!;
    expect(closed).toMatchObject({ outcome: "not_observable" });
    expect(closed.summary).toContain("pale paint caught in the middle cut");
    demo.dispatch(actor.key, "interact", WorkingMemoryIdentity.id[box], "open"); demo.advance(20_000);
    expect(ObjectState.current[box]).toBe("open");
    expect(Description.value[box]).toBe(exterior);
    const opened = inspect()!;
    expect(opened).toMatchObject({ outcome: "empty" });
    expect(opened.summary).toContain("pale paint caught in the middle cut");
    expect(opened.sourceId).not.toBe(closed.sourceId);
    const receipts = getWorkingMemory(demo.sim.world, actor.id).receipts.filter(row => row.id.startsWith("inspection:"));
    expect(receipts.map(row => row.summary)).toEqual(expect.arrayContaining([
      expect.stringContaining("contents are not observable"), expect.stringContaining("Visibly empty"),
    ]));
  } finally { demo.stop(); }
});
