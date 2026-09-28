import { jest } from "@jest/globals";
import { ObjectState } from "../../ecs/components";
import { getObservedStateFields } from "../../cognition/world-capabilities";
import { captureWorkingMemoryObservation } from "../../cognition/working-memory-observation";
import { evaluatePlanEvidenceBarrier, issuePlanEvidenceBarrier } from "../../cognition/plan-evidence-barrier";
import { getWorkingMemory } from "../../cognition/working-memory";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture } from "../../evals/escape-room-fixture";
import { EscapeRoomTestbed } from "../escape-room";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Typed escape observables are offline")); });
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create() { room = await EscapeRoomTestbed.create({ live: false, seed: 3619 }); await room.start(); return room; }

test("only local public control schemas appear after real sensing", async () => {
  const r = await create(), i = r.ids, w = r.sim.world;
  captureWorkingMemoryObservation(w, i.Mara);
  expect(getObservedStateFields(w, i.Mara, i.pump)).toEqual([]);
  expect(getObservedStateFields(w, i.Mara, i.exit).map(f => [f.slot, f.value]))
    .toEqual([["Observable.powered", "false"], ["Observable.open", "false"], ["Observable.operating", "false"]]);
  const d = new EscapeFixtureDriver(r); d.move("Mara", "Workshop");
  expect(getObservedStateFields(w, i.Mara, i.router)).toEqual([expect.objectContaining({
    slot: "Observable.route", type: "enum", allowedValues: ["off", "optics", "exit"], value: "off",
  })]);
  const slots = getObservedStateFields(w, i.Mara).map(f => f.slot);
  expect(slots).toContain("Observable.drained");
  for (const privateSlot of ["Observable.allEscaped", "Observable.aligned", "Observable.exitCode", "Observable.lockerCode", "Observable.helperId"])
    expect(slots).not.toContain(privateSlot);
  expect(getObservedStateFields(w, i.Mara, i.archiveClue)).toEqual([]);
});

test("real elapsed cooperative pumping satisfies an exact boolean barrier despite changing display prose", async () => {
  const r = await create(); runEscapeRoomFixture(r, { stopAfter: "locker" });
  const i = r.ids, w = r.sim.world, d = new EscapeFixtureDriver(r);
  d.move("Mara", "Workshop"); d.move("Ivo", "Workshop");
  captureWorkingMemoryObservation(w, i.Ivo);
  const token = issuePlanEvidenceBarrier(w, i.Ivo, { kind: "physical_fact", subject: "Drain pump",
    predicate: "state", slot: "Observable.drained", equals: "true" }, "observatory:drain");
  expect(token).toBeDefined();
  d.interact("Sera", "Drain pump", "install"); d.begin("Mara", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump");
  expect(getObservedStateFields(w, i.Ivo, i.pump).find(f => f.slot === "Observable.operating")?.value).toBe("true");
  r.advance(7999);
  expect(evaluatePlanEvidenceBarrier(w, i.Ivo, token, "observatory:drain", { observation: captureWorkingMemoryObservation(w, i.Ivo) }).status).toBe("waiting");
  r.advance(1);
  expect(ObjectState.current[i.pump]).toBe("Archive drained; route passable");
  const result = evaluatePlanEvidenceBarrier(w, i.Ivo, token, "observatory:drain", { observation: captureWorkingMemoryObservation(w, i.Ivo) });
  expect(result.status).toBe("satisfied");
  expect(getWorkingMemory(w, i.Ivo).facts.find(f => f.subjectLabel === "Drain pump" && f.slot === "Observable.drained")?.value).toBe("true");
  expect(getObservedStateFields(w, i.Ivo, i.pump).find(f => f.slot === "Observable.operating")?.value).toBe("false");
  expect(r.invariants()).toEqual([]);
});

test("visible optics fields describe the present controls, never the private readable answer", async () => {
  const r = await create(), report = runEscapeRoomFixture(r, { stopAfter: "optics" });
  const i = r.ids, w = r.sim.world, d = new EscapeFixtureDriver(r);
  captureWorkingMemoryObservation(w, i.Sera);
  const bench = getObservedStateFields(w, i.Sera, i.bench);
  expect(bench.map(f => f.slot)).toEqual(["Observable.prismInstalled", "Observable.calibration", "Observable.illuminated"]);
  expect(bench.find(f => f.slot === "Observable.calibration")).toMatchObject({ value: report.alignment, allowedValues: ["unset", "amber", "cobalt", "violet"] });
  expect(bench.find(f => f.slot === "Observable.illuminated")?.value).toBe("true");
  expect(JSON.stringify(bench)).not.toContain(report.exitCode!); expect(JSON.stringify(bench)).not.toContain(report.lockerCode);
  expect(getObservedStateFields(w, i.Ivo, i.bench)).toEqual([]);
  d.interact("Ivo", "Power router", "route exit");
  captureWorkingMemoryObservation(w, i.Sera);
  expect(getObservedStateFields(w, i.Sera, i.bench).find(f => f.slot === "Observable.illuminated")?.value).toBe("false");
  expect(getObservedStateFields(w, i.Sera, i.router)).toEqual([]);
  expect(r.invariants()).toEqual([]);
});
