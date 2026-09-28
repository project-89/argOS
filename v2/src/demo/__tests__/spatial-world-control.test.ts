import { jest } from "@jest/globals";
import { addComponent, getRelationTargets } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialWorldControl, directWorldCommand, type WorldCommandInterpreter } from "../spatial-world-control";
import { Goal, ObjectState, Perception, Position, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { HasGoal } from "../../ecs/relations";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";

let demo: SpatialDemo;
let controls: Array<ReturnType<typeof createSpatialWorldControl>>;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("World-control tests are offline"));
  controls = [];
  demo = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "blackout" });
  await demo.start();
});
afterEach(() => {
  controls.forEach(control => control.stop()); demo?.stop();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers();
});
const id = (name: string) => demo.byId.get(name)!;
const actor = (name = "Mara") => demo.snapshot().actors.find(row => row.name === name)!;
const state = () => ObjectState.current[id("supply-box")];
function control(interpreter?: WorldCommandInterpreter, changed = jest.fn<(operation: string) => void>()) {
  const record = jest.fn();
  const value = createSpatialWorldControl({ world: demo.sim.world, running: () => demo.running, live: false,
    blackout: demo.blackout!, box: id("supply-box"), interpreter, changed, record });
  controls.push(value); return { value, changed, record };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  const interpreter = jest.fn<WorldCommandInterpreter>(() => promise);
  return { ...control(interpreter), interpreter, resolve };
}
function action(verb: string, target = "lighting-panel") {
  demo.dispatch(actor().key, verb === "pickup" ? "pickup" : "interact", WorkingMemoryIdentity.id[id(target)], verb);
  demo.advance(12_000);
}
function repair() {
  action("inspect"); action("isolate"); action("open", "supply-box");
  action("pickup", "amber-cartridge"); action("install Amber cartridge"); action("power_on");
  expect(demo.blackout!.view().power).toBe("on");
}

test("exact direct commands operate the native box without invoking language interpretation", async () => {
  const interpreter = jest.fn<WorldCommandInterpreter>(async () => { throw Error("Unexpected model call"); });
  const c = control(interpreter);
  expect(await c.value.command("Please open the supplies box.")).toMatchObject({ status: "applied", operation: "box_open" });
  expect(state()).toBe("open");
  expect(await c.value.command("open supply box")).toMatchObject({ status: "unchanged" });
  expect(await c.value.command("close the supplies box")).toMatchObject({ status: "applied", operation: "box_close" });
  expect(state()).toBe("closed"); expect(interpreter).not.toHaveBeenCalled();
  expect(c.changed.mock.calls.map(row => row[0])).toEqual(["box_open", "box_close"]);
  expect(c.record).toHaveBeenCalledTimes(3);
});

test.each(["open the supplies box and restore power", 'Say "open the supplies box"', "Can you open the supplies box?", "open the other box"])(
  "whole-request matching does not partially execute %s", async request => {
    expect(directWorldCommand(request)).toBeUndefined();
    const c = control(); expect(await c.value.command(request)).toMatchObject({ status: "rejected" });
    expect(state()).toBe("closed"); expect(c.changed).not.toHaveBeenCalled();
  });

test.each([{ operation: "unsupported" }, { operation: "create_room" }, { operation: "box_open", entityId: 7 }, null, "box_open"])(
  "untrusted interpreter result %j cannot broaden authority", async result => {
    const c = control(async () => result);
    expect(await c.value.command("A request needing interpretation")).toMatchObject({ status: "rejected" });
    expect(state()).toBe("closed"); expect(demo.blackout!.view().power).toBe("off");
    expect(c.changed).not.toHaveBeenCalled();
  });

test("the interpreter receives only the operator's text and an abort signal, never private world context", async () => {
  demo.plantThought(actor().key, "PRIVATE INNER LIFE SENTINEL");
  demo.text(actor().key, "PRIVATE PHONE SENTINEL");
  const c = deferred();
  const pending = c.value.command("Please lift the lid of the household supplies box");
  expect(c.interpreter).toHaveBeenCalledTimes(1);
  expect(c.interpreter.mock.calls[0]).toHaveLength(2);
  expect(c.interpreter.mock.calls[0][0]).toBe("Please lift the lid of the household supplies box");
  expect(c.interpreter.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  c.resolve({ operation: "box_open" }); expect(await pending).toMatchObject({ status: "applied" });
  expect(state()).toBe("open");
});

test("only one interpretation can run, then the same controller accepts a subsequent request", async () => {
  const c = deferred(), pending = c.value.command("Lift the lid");
  expect(c.value.busy).toBe(true);
  await expect(c.value.command("open supplies box")).rejects.toThrow(/previous request/);
  expect(state()).toBe("closed"); c.resolve({ operation: "box_open" }); await pending;
  expect(c.value.busy).toBe(false);
  expect(await c.value.command("close supplies box")).toMatchObject({ status: "applied" });
});

test("request capacity is bounded even for requests which make no physical change", async () => {
  const c = control();
  for (let i = 0; i < 64; i++) expect(await c.value.command("close supplies box")).toMatchObject({ status: "unchanged" });
  expect(c.value.view().available).toBe(false);
  await expect(c.value.command("open supplies box")).rejects.toThrow(/64 world-request limit/);
  expect(state()).toBe("closed"); expect(c.changed).not.toHaveBeenCalled();
});

test("a timed-out interpreter cannot apply a late valid result", async () => {
  jest.useFakeTimers();
  const c = deferred(), pending = c.value.command("Lift the lid");
  jest.advanceTimersByTime(15_001);
  expect(c.interpreter.mock.calls[0][1].aborted).toBe(true);
  c.resolve({ operation: "box_open" }); expect(await pending).toMatchObject({ status: "rejected" });
  expect(state()).toBe("closed"); expect(c.changed).not.toHaveBeenCalled();
});

test.each(["controller stopped", "world stopped", "source replaced"])("delayed interpretation after %s cannot commit or append late evidence", async mutation => {
  const c = deferred(), pending = c.value.command("Lift the lid");
  if (mutation === "controller stopped") c.value.stop();
  if (mutation === "world stopped") demo.stop();
  if (mutation === "source replaced") { stopCommittedEvents(demo.sim.world); startCommittedEvents(demo.sim.world); }
  c.resolve({ operation: "box_open" }); expect(await pending).toMatchObject({ status: "rejected" });
  expect(state()).toBe("closed"); expect(c.changed).not.toHaveBeenCalled(); expect(c.record).not.toHaveBeenCalled();
  if (mutation === "controller stopped") expect(c.interpreter.mock.calls[0][1].aborted).toBe(true);
});

test.each(["identity", "state", "position", "container", "removed"])("delayed box edit rejects changed %s", async mutation => {
  const c = deferred(), pending = c.value.command("Lift the lid"), box = id("supply-box"), world = demo.sim.world;
  if (mutation === "identity") WorkingMemoryIdentity.id[box] = "replacement-box-lifetime";
  if (mutation === "state") ObjectState.current[box] = "locked";
  if (mutation === "position") Position.x[box] += 1;
  if (mutation === "container") setLocatedIn(world, box, id("street"));
  if (mutation === "removed") addComponent(world, box, Removed);
  const before = state(); c.resolve({ operation: "box_open" });
  expect(await pending).toMatchObject({ status: "rejected" }); expect(state()).toBe(before);
  expect(c.changed).not.toHaveBeenCalled();
});

test.each(["revision", "isolation", "identity", "removed"])("delayed circuit edit rejects changed %s", async mutation => {
  repair(); const c = deferred(), pending = c.value.command("Disconnect the lighting circuit"), panel = id("lighting-panel");
  if (mutation === "revision") demo.blackout!.component.revision[panel]++;
  if (mutation === "isolation") demo.blackout!.component.isolated[panel] = true;
  if (mutation === "identity") WorkingMemoryIdentity.id[panel] = "replacement-panel-lifetime";
  if (mutation === "removed") addComponent(demo.sim.world, panel, Removed);
  const before = demo.blackout!.component.isolated[panel];
  c.resolve({ operation: "light_off" }); expect(await pending).toMatchObject({ status: "rejected" });
  expect(demo.blackout!.component.isolated[panel]).toBe(before); expect(c.changed).not.toHaveBeenCalled();
});

test("restoring power cannot create or repair a cartridge, even when the interpreter chooses light_on", async () => {
  const c = control(async () => ({ operation: "light_on" }));
  expect(await c.value.command("Restore the apartment's lighting")).toMatchObject({ status: "rejected" });
  expect(demo.blackout!.view().power).toBe("off");
  for (const name of ["amber-cartridge", "blue-cartridge"]) expect(getDirectContainer(demo.sim.world, id(name))).toBe(id("supply-box"));
  expect(c.changed).not.toHaveBeenCalled();
});

test.each(["moved", "replaced", "damaged"])("power restoration rejects an installed part %s during interpretation", async mutation => {
  repair(); const c = deferred(), part = id("amber-cartridge");
  expect(await c.value.command("turn the lights off")).toMatchObject({ status: "applied" });
  c.changed.mockClear(); const pending = c.value.command("Reenergize the circuit");
  if (mutation === "moved") setLocatedIn(demo.sim.world, part, id("apartment"));
  if (mutation === "replaced") WorkingMemoryIdentity.id[part] = "replacement-installed-part";
  if (mutation === "damaged") demo.blackout!.partComponent.intact[part] = false;
  c.resolve({ operation: "light_on" }); expect(await pending).toMatchObject({ status: "rejected" });
  expect(demo.blackout!.view().power).toBe("off"); expect(c.changed).not.toHaveBeenCalled();
});

test("cutting power isolates an already dark faulty circuit without claiming the lamp changed", async () => {
  const c = control();
  expect(await c.value.command("cut power")).toMatchObject({ status: "applied", operation: "light_off" });
  expect(demo.blackout!.component.isolated[id("lighting-panel")]).toBe(true);
  expect(demo.blackout!.view().power).toBe("off");
  expect(c.changed).toHaveBeenCalledWith("light_off", { powerChanged: false });
  expect(await c.value.command("cut power")).toMatchObject({ status: "unchanged" });
});

test("a native repair can be switched off/on without consuming its part or rewriting completed goals", async () => {
  repair(); const c = control(), panel = id("lighting-panel"), part = id("amber-cartridge");
  const partKey = WorkingMemoryIdentity.id[part];
  const goals = demo.actors.flatMap(eid => getRelationTargets(demo.sim.world, eid, HasGoal));
  const priorGoals = goals.map(g => [g, Goal.status[g], Goal.description[g]]);
  expect(await c.value.command("turn the lights off")).toMatchObject({ status: "applied" });
  expect(demo.blackout!.view().power).toBe("off");
  expect(await c.value.command("restore power")).toMatchObject({ status: "applied" });
  expect(demo.blackout!.view().power).toBe("on");
  expect(getDirectContainer(demo.sim.world, part)).toBe(panel); expect(WorkingMemoryIdentity.id[part]).toBe(partKey);
  expect(goals.map(g => [g, Goal.status[g], Goal.description[g]])).toEqual(priorGoals);
});

test("host edits create only locally witnessed physical perceptions, not the operator request", async () => {
  const ivo = actor("Ivo").id, mara = actor().id, world = demo.sim.world;
  setLocatedIn(world, ivo, id("street"));
  const beforeMara = new Set(getAgentPerceptions(world, mara)), beforeIvo = new Set(getAgentPerceptions(world, ivo));
  expect(await demo.worldCommand("Please open the supplies box.")).toMatchObject({ status: "applied" });
  const newPerceptions = (eid: number, before: Set<number>) => getAgentPerceptions(world, eid).filter(pid => !before.has(pid));
  const local = newPerceptions(mara, beforeMara).map(pid => Perception.content[pid]);
  expect(local).toContain("The supplies box lid opens.");
  expect(local.join(" ")).not.toMatch(/Please|operator|house spirit/i);
  expect(newPerceptions(ivo, beforeIvo)).toHaveLength(0);
});

test("a notification failure cannot describe a committed physical edit as rejected", async () => {
  const c = control(undefined, jest.fn(() => { throw Error("Broken scene observer"); }));
  const result = await c.value.command("open supplies box");
  expect(state()).toBe("open");
  expect(result).toMatchObject({ status: "applied", operation: "box_open" });
  expect(result.detail).not.toMatch(/No change was applied/);
});

test("a log observer failure cannot reject a command whose native edit already committed", async () => {
  const c = control(); c.record.mockImplementation(() => { throw Error("Broken log observer"); });
  await expect(c.value.command("open supplies box")).resolves.toMatchObject({ status: "applied", operation: "box_open" });
  expect(state()).toBe("open");
});
