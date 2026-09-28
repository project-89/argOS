import { jest } from "@jest/globals";
import { LastAction, ObjectState } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAgentWorldCapabilities, getObservedStateFields } from "../../cognition/world-capabilities";
import { captureWorkingMemoryObservation } from "../../cognition/working-memory-observation";
import { getWorkingMemory } from "../../cognition/working-memory";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture, type EscapeActor } from "../../evals/escape-room-fixture";
import { runEscapeRoomRecoveryFixture } from "../../evals/escape-room-recovery-fixture";
import { evaluateEscapeRoomRun } from "../../evals/escape-room-evaluation";
import { EscapeRoomTestbed, type EscapeRoomEvent } from "../escape-room";
import { getKnownAffordances, getAvailableAffordances } from "../../world/affordance-availability";
import { validateGeneratedPlan, checkStepPrerequisites, type PlanStep } from "../../cognition/planning-system";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Relay oracle cannot call models")); });
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create(seed = 701) { room = await EscapeRoomTestbed.create({ live: false, seed, topology: "relay" }); await room.start(); return room; }
const evaluate = (r: EscapeRoomTestbed, events = r.snapshot().events) => evaluateEscapeRoomRun(events, r.snapshot(), { live: false, violations: r.invariants() });
const menu = (r: EscapeRoomTestbed, actor: EscapeActor, target: number) => getAgentWorldCapabilities(r.sim.world, r.ids[actor])!.affordances!(target).map(a => a.name);
const action = (e: EscapeRoomEvent, target: string, content?: string) => e.kind === "action" && e.action?.type === "interact"
  && e.action.target === target && (content === undefined || e.action.content === content);

test("public puzzle labels support planning prerequisites without revealing codes or activating controls", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), i = r.ids, w = r.sim.world;
  d.move("Mara", "Workshop");
  const before = JSON.stringify(r.snapshot());
  expect(getKnownAffordances(w, i.Mara, i.pump).map(a => a.name)).toContain("install");
  expect(getAvailableAffordances(w, i.Mara, i.pump).map(a => a.name)).not.toContain("install");
  expect(getKnownAffordances(w, i.Mara, i.locker).map(a => a.name)).toContain("unlock <four digits>");
  expect(getKnownAffordances(w, i.Mara, i.archiveClue)).toEqual([]);
  const step: PlanStep = { description: "Install the crank after obtaining it", actionType: "interact", target: "Drain pump", content: "install" };
  expect(validateGeneratedPlan(w, i.Mara, "Prepare the pump", { goalDescription: "Prepare the pump", steps: [step],
    estimatedCompletion: "short", potentialObstacles: [] }).ok).toBe(true);
  expect(checkStepPrerequisites(w, i.Mara, step)).toBe(false);
  expect(JSON.stringify(r.snapshot())).toBe(before);
  expect(r.invariants()).toEqual([]);
});

function readyPump(r: EscapeRoomTestbed, installCoil = true) {
  runEscapeRoomFixture(r, { stopAfter: "locker" });
  const d = new EscapeFixtureDriver(r);
  d.interact("Sera", "Drain pump", "install");
  if (installCoil) {
    d.move("Sera", "Archive"); d.act("Sera", { type: "pickup", target: "Copper coil" });
    d.move("Sera", "Workshop"); d.interact("Sera", "Generator", "install");
  }
  d.move("Mara", "Workshop"); d.move("Ivo", "Workshop");
  d.begin("Mara", "Pump bypass", "hold");
  return d;
}

test("relay changes accessibility and dependency, not just the displayed title", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), i = r.ids;
  expect(r.snapshot().topology).toBe("relay");
  expect(r.context(i.Mara)).not.toContain("flooded route");
  expect(r.context(i.Mara)).not.toContain("optical calibration diagram");
  d.move("Mara", "Workshop");
  expect(getAgentWorldCapabilities(r.sim.world, i.Mara)!.movementTargets!()).toContain(i.archive);
  expect(r.context(i.Mara)).not.toContain("the first two digits are");
  d.move("Mara", "Archive");
  expect(getRoomForEntity(r.sim.world, i.Mara)).toBe(i.archive);
  expect(r.snapshot().state.drained).toBe(false);
  expect(r.invariants()).toEqual([]);
  d.act("Sera", { type: "move", target: "Courtyard" }, false);
  expect(getRoomForEntity(r.sim.world, i.Sera)).toBe(i.atrium);
});

test("the selected physical topology cannot change through a returned options object", async () => {
  const r = await create();
  expect(Object.isFrozen(r.options)).toBe(true);
  expect(() => Object.assign(r.snapshot().options, { topology: "observatory" })).toThrow();
  expect(r.snapshot().topology).toBe("relay");
  await expect(EscapeRoomTestbed.create({ live: false, topology: "invented" as "relay" })).rejects.toThrow("Unknown escape topology");
});

test("all relay pump prerequisites agree between current menu and deliberate executor failures", async () => {
  const r = await create(), d = readyPump(r, false), i = r.ids;
  expect(menu(r, "Ivo", i.router)).not.toContain("route pump");
  d.interact("Ivo", "Power router", "route pump", false);
  expect(menu(r, "Sera", i.pump)).not.toContain("pump");
  d.interact("Sera", "Drain pump", "pump", false);
  d.move("Sera", "Archive"); d.act("Sera", { type: "pickup", target: "Copper coil" });
  d.move("Sera", "Workshop"); d.interact("Sera", "Generator", "install");
  expect(menu(r, "Ivo", i.router)).toContain("route pump");
  for (const route of ["off", "optics", "exit"]) {
    d.interact("Ivo", "Power router", `route ${route}`);
    expect(menu(r, "Sera", i.pump)).not.toContain("pump");
    d.interact("Sera", "Drain pump", "pump", false);
  }
  d.interact("Ivo", "Power router", "route pump");
  expect(menu(r, "Sera", i.pump)).toContain("pump");
  expect(menu(r, "Mara", i.pump)).not.toContain("pump");
  d.begin("Sera", "Drain pump", "pump");
  expect(menu(r, "Ivo", i.pump)).not.toContain("pump");
  r.advance(7999); expect(r.snapshot().state.drained).toBe(false);
  r.advance(1); expect(r.snapshot().state.drained).toBe(true);
  expect(r.snapshot().milestones.archive_drained).toBeUndefined();
  expect(r.snapshot().milestones.threshold_drained).toBe(r.elapsedMs);
});

test.each(["off", "optics", "exit"] as const)("routing to %s interrupts original powered work without refreshing its helper", async route => {
  const r = await create(), d = readyPump(r), i = r.ids;
  d.interact("Ivo", "Power router", "route pump");
  const helperUntil = r.activity.untilMs[i.Mara];
  d.begin("Sera", "Drain pump", "pump");
  const original = r.snapshot().events.filter(e => action(e, "Drain pump", "pump") && e.status === "pending").at(-1)!;
  r.advance(1500); d.interact("Ivo", "Power router", `route ${route}`);
  expect(LastAction.success[i.Sera]).toBe(false);
  expect(getWorkingMemory(r.sim.world, i.Sera).receipts.some(receipt => receipt.provenance === "own_action"
    && receipt.succeeded === false && receipt.summary.includes("lost its generator supply"))).toBe(true);
  expect(r.activity.phase[i.Sera]).toBe("idle");
  expect(r.activity.phase[i.Mara]).toBe("holding_bypass");
  expect(r.activity.untilMs[i.Mara]).toBe(helperUntil);
  expect(r.snapshot().events.filter(e => action(e, "Drain pump", "pump") && e.status === "failed"))
    .toEqual([expect.objectContaining({ action: expect.objectContaining({ executionId: original.action!.executionId }) })]);
  r.advance(6500); expect(r.snapshot().state.drained).toBe(false);
  d.interact("Ivo", "Power router", "route pump"); d.begin("Sera", "Drain pump", "pump");
  const retry = r.snapshot().events.filter(e => action(e, "Drain pump", "pump") && e.status === "pending").at(-1)!;
  expect(retry.action!.executionId).not.toBe(original.action!.executionId);
  r.advance(7999); expect(r.snapshot().state.drained).toBe(false);
  expect(r.activity.untilMs[i.Mara]).toBe(helperUntil);
  r.advance(1); expect(r.snapshot().state.drained).toBe(true);
  expect(LastAction.success[i.Mara]).toBe(true);
  expect(r.invariants()).toEqual([]);
});

test("a powered valid code cannot bypass actual threshold drainage", async () => {
  const r = await create(), report = runEscapeRoomFixture(r, { branchOrder: "optics-first", stopAfter: "optics" });
  const d = new EscapeFixtureDriver(r), i = r.ids;
  expect(report.exitCode).toMatch(/^\d{4}$/);
  expect(r.snapshot().state.drained).toBe(false);
  d.interact("Ivo", "Power router", "route exit"); d.move("Mara", "Atrium"); d.move("Sera", "Atrium");
  d.begin("Mara", "Exit release", "hold");
  expect(menu(r, "Sera", i.exit)).not.toContain("enter <four digits>");
  d.interact("Sera", "Exit keypad", `enter ${report.exitCode}`, false);
  expect(ObjectState.current[i.exit]).toContain("drainage interlock blocking");
  r.advance(2000); expect(r.snapshot().state.exitOpen).toBe(false);
  d.act("Sera", { type: "move", target: "Courtyard" }, false);
  expect(r.snapshot().milestones.exit_unlock_started).toBeUndefined();
});

test("relay public contracts show local route choices and drainage, never private answers", async () => {
  const r = await create(), i = r.ids, d = new EscapeFixtureDriver(r);
  captureWorkingMemoryObservation(r.sim.world, i.Mara);
  expect(getObservedStateFields(r.sim.world, i.Mara, i.router)).toEqual([]);
  expect(getObservedStateFields(r.sim.world, i.Mara, i.exit).find(f => f.slot === "Observable.drainageClear")?.value).toBe("false");
  d.move("Mara", "Workshop");
  expect(getObservedStateFields(r.sim.world, i.Mara, i.router)).toEqual([expect.objectContaining({
    slot: "Observable.route", allowedValues: ["off", "optics", "exit", "pump"], value: "off",
  })]);
  expect(getObservedStateFields(r.sim.world, i.Mara, i.exit)).toEqual([]);
  expect(getObservedStateFields(r.sim.world, i.Mara, i.archiveClue)).toEqual([]);
  d.move("Mara", "Archive");
  const clue = d.read("Mara", "Archive diagram");
  expect(clue).toMatch(/amber|cobalt|violet/);
  expect(getWorkingMemory(r.sim.world, i.Ivo).receipts.some(receipt => receipt.summary.includes("For the observatory's Glass prism"))).toBe(false);
  expect(JSON.stringify(r.scenes())).not.toContain("For the observatory's Glass prism");
  expect(getDirectContainer(r.sim.world, i.coil)).toBe(i.archive);
});

test.each([701, 2909, 4019, 7103].flatMap(seed => (["pump-first", "optics-first"] as const).map(branchOrder => ({ seed, branchOrder }))))(
  "$seed / $branchOrder is solvable through actions and passes causal proof", async ({ seed, branchOrder }) => {
    const r = await create(seed), report = runEscapeRoomFixture(r, { branchOrder });
    const milestones = r.snapshot().milestones;
    expect(milestones.archive_entered).toBeLessThan(milestones.threshold_drained!);
    expect(milestones.coil_installed).toBeLessThanOrEqual(milestones.power_pump!);
    expect(milestones.power_pump).toBeLessThan(milestones.threshold_drained!);
    expect(branchOrder === "pump-first" ? milestones.threshold_drained! < milestones.exit_code_read! : milestones.exit_code_read! < milestones.threshold_drained!).toBe(true);
    expect(report.topology).toBe("relay");
    expect(evaluate(r).passed).toBe(true);
    expect(evaluate(r).causalProof?.observed).toBe(true);
    expect(evaluate(r).causalProof).toMatchObject({ branchOrder, drainedMs: milestones.threshold_drained,
      codeReadMs: milestones.exit_code_read, openedMs: milestones.exit_open });
  });

const rolePermutations: Array<readonly [EscapeActor, EscapeActor, EscapeActor]> = [
  ["Mara", "Ivo", "Sera"], ["Mara", "Sera", "Ivo"], ["Ivo", "Mara", "Sera"],
  ["Ivo", "Sera", "Mara"], ["Sera", "Mara", "Ivo"], ["Sera", "Ivo", "Mara"],
];
test.each(rolePermutations.map(actors => ({ actors })))("relay has no actor-specific physical roles: $actors", async ({ actors }) => {
  const r = await create(), report = runEscapeRoomFixture(r, { actors, branchOrder: "optics-first", interruptPumpWith: "optics" });
  expect(report.pumpInterruption).toBeDefined();
  expect(evaluate(r).passed).toBe(true);
  expect(evaluate(r).causalProof).toMatchObject({ pumpActorId: r.ids[actors[0]], helperId: r.ids[actors[1]] });
});

test("the established hard unlock interruption remains recoverable on the relay graph", async () => {
  const r = await create(); runEscapeRoomRecoveryFixture(r);
  const report = evaluateEscapeRoomRun(r.snapshot().events, r.snapshot(), { live: false, violations: r.invariants(),
    interruptionRequested: true, interruptionApplied: true, interruptionStage: "exit_unlock_started" });
  expect(report.gates.interruptedUnlockRecovered).toBe(true);
  expect(report.gates.topologyCausalProof).toBe(true);
  expect(report.passed).toBe(true);
});

test("relay score rejects renamed old topology or missing, recycled and premature work proof", async () => {
  const r = await create(); runEscapeRoomFixture(r);
  const tape = r.snapshot().events;
  const pumpStart = tape.find(e => action(e, "Drain pump", "pump") && e.status === "pending")!;
  const pumpEnd = tape.find(e => action(e, "Drain pump", "pump") && e.status === "succeeded")!;
  const wrong: EscapeRoomEvent[][] = [
    tape.filter(e => !action(e, "Generator", "install")),
    tape.filter(e => !action(e, "Drain pump", "install")),
    tape.filter(e => !action(e, "Crank locker")),
    tape.filter(e => !action(e, "Optical bench", "install")),
    tape.filter(e => !action(e, "Optical bench", "read")),
    tape.filter(e => !(e.kind === "action_detail" && e.action?.target === "Optical bench" && e.action.content === "read")),
    tape.filter(e => !action(e, "Power router", "route optics")),
    tape.filter(e => !(e.kind === "milestone" && e.text === "exit_code_read")),
    tape.filter(e => !(e.kind === "movement" && e.action?.target === "Archive")),
    tape.filter(e => !action(e, "Power router", "route pump")),
    tape.map(e => e === pumpStart ? { ...e, kind: "speech" } : e),
    tape.map(e => e === pumpEnd ? { ...e, elapsedMs: e.elapsedMs - 1 } : e),
    tape.map(e => e === pumpEnd ? { ...e, action: { ...e.action!, executionId: "different-attempt" } } : e),
    tape.map(e => action(e, "Pump bypass", "hold") ? { ...e, actorId: pumpStart.actorId } : e),
    tape.filter(e => !(e.kind === "milestone" && e.text === "threshold_drained")),
    tape.map(e => action(e, "Pump bypass", "hold") && e.status === "succeeded" ? { ...e, status: "failed" } : e),
    [...tape, { ...pumpStart, sequence: 4000, status: "failed", elapsedMs: pumpStart.elapsedMs + 1000 }],
    [...tape, { ...pumpStart, sequence: 4001, status: "succeeded", elapsedMs: pumpStart.elapsedMs + 1000,
      action: { type: "interact", target: "Power router", content: "route off", executionId: "power-loss" } }],
    ...([r.ids.Mara, r.ids.Sera].map(actorId => [...tape, { ...pumpStart, actorId, sequence: 4002,
      kind: "movement", status: "succeeded" as const, elapsedMs: pumpStart.elapsedMs + 1000,
      action: { type: "move" as const, target: "Atrium", executionId: "displaced-body" } }])),
    [...tape, { ...pumpStart, actorId: r.ids.Mara, sequence: 4003, status: "succeeded", elapsedMs: pumpStart.elapsedMs + 1000,
      action: { type: "interact", target: "Pump bypass", content: "release", executionId: "released-helper" } }],
  ];
  for (const missing of wrong) expect(evaluate(r, missing).gates.topologyCausalProof).toBe(false);
  expect(evaluateEscapeRoomRun(tape, r.snapshot(), { live: false, topology: "observatory", violations: [] }).passed).toBe(false);
});

test("original observatory is still the default and cannot be relabelled as relay proof", async () => {
  room = await EscapeRoomTestbed.create({ live: false, seed: 701 }); await room.start();
  expect(room.options.topology).toBe("observatory");
  runEscapeRoomFixture(room);
  expect(evaluate(room).passed).toBe(true);
  expect(evaluateEscapeRoomRun(room.snapshot().events, { ...room.snapshot(), topology: "relay" }, { live: false, violations: [] }).passed).toBe(false);
});
