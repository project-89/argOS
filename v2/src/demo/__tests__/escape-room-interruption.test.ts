import { jest } from "@jest/globals";
import { LastAction, ObjectState } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture } from "../../evals/escape-room-fixture";
import { runEscapeRoomRecoveryFixture } from "../../evals/escape-room-recovery-fixture";
import { evaluateEscapeRoomRun } from "../../evals/escape-room-evaluation";
import { EscapeRoomTestbed, isEscapePerturbationStage, type EscapeRoomEvent } from "../escape-room";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Recovery fixtures never call models")); });
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create(seed = 2718) { room = await EscapeRoomTestbed.create({ live: false, seed }); await room.start(); return room; }
function atEntry(r: EscapeRoomTestbed) {
  const { exitCode } = runEscapeRoomFixture(r, { stopAfter: "optics" });
  const d = new EscapeFixtureDriver(r);
  d.interact("Ivo", "Power router", "route exit");
  d.move("Mara", "Atrium"); d.move("Sera", "Atrium");
  d.begin("Mara", "Exit release", "hold");
  return { d, exitCode: exitCode! };
}
const entry = (e: EscapeRoomEvent) => e.kind === "action" && e.action?.type === "interact"
  && e.action.target === "Exit keypad" && e.action.content?.startsWith("enter ");
const evaluate = (r: EscapeRoomTestbed, events = r.snapshot().events) => evaluateEscapeRoomRun(events, r.snapshot(), {
  live: false, violations: r.invariants(), interruptionRequested: true, interruptionApplied: true,
  interruptionStage: "exit_unlock_started",
});

test.each([11, 917, 2718, 9103])("seed %s recovers from a failed actual unlock through new physical work", async seed => {
  const r = await create(seed), report = runEscapeRoomRecoveryFixture(r);
  const events = r.snapshot().events, originalFailures = events.filter(e => entry(e) && e.status === "failed");
  expect(originalFailures).toHaveLength(1);
  expect(originalFailures[0].elapsedMs).toBe(report.interruptedAtMs);
  expect(events.filter(e => entry(e) && e.status === "succeeded")).toHaveLength(1);
  expect(evaluate(r).passed).toBe(true);
  expect(evaluate(r).interruption.unlockRecovery).toMatchObject({ observed: true, interruptedActorId: r.ids.Sera, helperId: r.ids.Mara });
  for (const actor of r.characters) {
    expect(getRoomForEntity(r.sim.world, r.ids[actor])).toBe(r.ids.outside);
    expect(events.filter(e => e.kind === "movement" && e.actorId === r.ids[actor]
      && e.action?.target === "Courtyard" && e.status === "succeeded")).toHaveLength(1);
  }
});

test("the recovery oracle works with different physical roles, not a character-specific script", async () => {
  const r = await create(4201);
  runEscapeRoomRecoveryFixture(r, { actors: ["Mara", "Ivo", "Sera"] });
  expect(evaluate(r).interruption.unlockRecovery).toMatchObject({ observed: true, interruptedActorId: r.ids.Mara, helperId: r.ids.Ivo });
});

test("the stage allowlist and actual-admission guard reject invented, premature and stale triggers", async () => {
  expect(isEscapePerturbationStage("exit_unlock_started")).toBe(true);
  expect(isEscapePerturbationStage("exit_code_read")).toBe(true);
  for (const stage of ["exit_open", "EXIT_UNLOCK_STARTED", "", "exit_unlock_started; route off"]) expect(isEscapePerturbationStage(stage)).toBe(false);
  const r = await create(), { d, exitCode } = atEntry(r);
  expect(r.snapshot().milestones.exit_unlock_started).toBeUndefined();
  expect(r.canPerturbAfter("exit_unlock_started")).toBe(false);
  expect(r.perturb({ after: "exit_unlock_started" })).toEqual({ changed: false });
  d.interact("Sera", "Exit keypad", "enter 0000", false);
  expect(r.snapshot().milestones.exit_unlock_started).toBeUndefined();
  d.begin("Sera", "Exit keypad", `enter ${exitCode}`);
  expect(r.canPerturbAfter("exit_unlock_started")).toBe(true);
  expect(r.snapshot().milestones.exit_unlock_started).toBe(r.elapsedMs);
  r.advance(2000);
  expect(r.canPerturbAfter("exit_unlock_started")).toBe(false);
  expect(r.perturb({ after: "exit_unlock_started" })).toEqual({ changed: false });
  expect(r.snapshot().state).toMatchObject({ power: "exit", exitOpen: true });
});

test("a trip leaves the original entry failed and the helper holding until its original deadline", async () => {
  const r = await create(), { d, exitCode } = atEntry(r), deadline = r.activity.untilMs[r.ids.Mara];
  d.begin("Sera", "Exit keypad", `enter ${exitCode}`); r.advance(1999);
  const receiptIds = new Set(getWorkingMemory(r.sim.world, r.ids.Sera).receipts.map(receipt => receipt.id));
  r.perturb({ after: "exit_unlock_started" });
  const ownFailure = getWorkingMemory(r.sim.world, r.ids.Sera).receipts.filter(receipt => !receiptIds.has(receipt.id)
    && receipt.provenance === "own_action" && receipt.succeeded === false);
  expect(ownFailure).toHaveLength(1);
  expect(ownFailure[0].summary).toContain("lost generator power");
  expect(ObjectState.current[r.ids.exit]).toMatch(/locked/i);
  expect(r.activity.phase[r.ids.Mara]).toBe("holding_release");
  expect(r.activity.untilMs[r.ids.Mara]).toBe(deadline);
  r.advance(deadline - r.elapsedMs - 1);
  expect(r.activity.phase[r.ids.Mara]).toBe("holding_release");
  expect(r.snapshot().state.exitOpen).toBe(false);
  r.advance(1);
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  expect(LastAction.success[r.ids.Mara]).toBe(false);
  expect(r.snapshot().events.filter(e => entry(e) && e.status === "failed")).toHaveLength(1);
  d.interact("Ivo", "Power router", "route exit");
  d.interact("Sera", "Exit keypad", `enter ${exitCode}`, false);
  d.begin("Mara", "Exit release", "hold"); d.begin("Sera", "Exit keypad", `enter ${exitCode}`);
  r.advance(2000);
  expect(r.snapshot().state.exitOpen).toBe(true);
});

test("the earlier code-read trip is supported without pretending it interrupted an unlock", async () => {
  const r = await create(); runEscapeRoomFixture(r, { stopAfter: "optics" });
  expect(r.canPerturbAfter("exit_code_read")).toBe(true);
  expect(r.perturb({ after: "exit_code_read" })).toEqual({ changed: true });
  expect(r.snapshot().state.power).toBe("off");
  expect(r.snapshot().milestones.exit_unlock_interrupted).toBeUndefined();
  expect(r.snapshot().events.find(e => e.powerTrip)?.powerTrip?.pendingUnlock).toBeUndefined();
  expect(r.perturb({ after: "exit_code_read" })).toEqual({ changed: false });
});

test("a disrupted helper can explicitly release, but restoration alone cannot replace that helper", async () => {
  const r = await create(), { d, exitCode } = atEntry(r);
  d.begin("Sera", "Exit keypad", `enter ${exitCode}`); r.advance(500);
  r.perturb({ after: "exit_unlock_started" });
  d.interact("Mara", "Exit release", "release");
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  expect(r.snapshot().events.filter(e => e.kind === "action" && e.actorId === r.ids.Mara
    && e.action?.target === "Exit release" && e.action.content === "hold" && e.status === "failed")).toHaveLength(1);
  d.interact("Ivo", "Power router", "route exit");
  d.interact("Sera", "Exit keypad", `enter ${exitCode}`, false);
  r.advance(2000);
  expect(r.snapshot().state.exitOpen).toBe(false);
});

test("planning telemetry remains operator-only and adds no knowledge or sensory input", async () => {
  const r = await create(); drainPendingStimuli();
  const before = r.characters.map(name => JSON.stringify(getWorkingMemory(r.sim.world, r.ids[name])));
  const event = { requestId: "operator-only-planning-probe", agentEid: r.ids.Mara,
    goalEid: r.sharedGoals.get(r.ids.Mara)!, atMs: Date.now(), stage: "discarded" as const,
    reason: "visible_state_changed" as const, issues: ["operator-only-issue-probe"] };
  getAgentWorldCapabilities(r.sim.world, r.ids.Mara)!.onPlanningEvent!(event);
  expect(r.snapshot().events.at(-1)).toMatchObject({ kind: "planning_discarded", actorId: r.ids.Mara,
    visibility: "operator", text: "visible_state_changed", planningEvent: event });
  for (const [index, name] of r.characters.entries()) {
    expect(JSON.stringify(getWorkingMemory(r.sim.world, r.ids[name]))).toBe(before[index]);
    expect(r.context(r.ids[name])).not.toContain("operator-only-");
  }
  expect(JSON.stringify(r.scenes())).not.toContain("operator-only-");
  expect(r.snapshot().events.filter(e => e.kind === "perception" && e.text.includes("operator-only-"))).toHaveLength(0);
});

test("recovery gates require failed original work, fresh duration, restoration, and eventual escape", async () => {
  const r = await create(); runEscapeRoomRecoveryFixture(r);
  const tape = r.snapshot().events;
  expect(evaluate(r).gates.interruptedUnlockRecovered).toBe(true);
  const mutations: EscapeRoomEvent[][] = [
    tape.filter(e => !(entry(e) && e.status === "failed")),
    tape.filter(e => !(e.kind === "operator_edit")),
    tape.map(e => e.powerTrip ? { ...e, powerTrip: { ...e.powerTrip, pendingUnlock: undefined } } : e),
    tape.map(e => entry(e) && e.status === "failed" ? { ...e, kind: "speech" } : e),
    tape.map(e => entry(e) && e.status === "failed" ? { ...e, elapsedMs: e.elapsedMs + 1 } : e),
    tape.filter(e => !(entry(e) && e.status === "pending")),
    tape.map(e => entry(e) && e.status === "succeeded" ? { ...e, elapsedMs: e.elapsedMs - 1000 } : e),
    tape.filter(e => !(e.kind === "milestone" && e.text === "exit_open")),
    tape.filter(e => !(e.kind === "action" && e.status === "succeeded" && e.action?.target === "Power router" && e.action.content === "route exit")),
  ];
  for (const broken of mutations) expect(evaluate(r, broken).gates.interruptedUnlockRecovered).toBe(false);
  expect(evaluate(r, tape.filter(e => !(e.kind === "movement" && e.action?.target === "Courtyard"))).passed).toBe(false);
});
