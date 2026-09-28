import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { Agent, LastAction, Name, ObjectState, Traits } from "../../ecs/components";
import { createObjectEntity } from "../../ecs/prefabs";
import { getObservedPublicActivity } from "../../cognition/world-capabilities";
import { isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { getWorkingMemory } from "../../cognition/working-memory";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture } from "../../evals/escape-room-fixture";
import { EscapeRoomTestbed } from "../escape-room";
import { getCommittedEvents } from "../../runtime/committed-events";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Adversarial escape tests are offline")); });
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create() { room = await EscapeRoomTestbed.create({ live: false, seed: 911 }); await room.start(); return room; }
function preparePump(r: EscapeRoomTestbed) {
  runEscapeRoomFixture(r, { stopAfter: "locker" });
  const d = new EscapeFixtureDriver(r);
  d.interact("Sera", "Drain pump", "install"); d.move("Mara", "Workshop"); d.move("Ivo", "Workshop");
  return d;
}

test("remote targets, hidden portable objects, and nonadjacent routes cannot bypass discovery", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), i = r.ids;
  for (const [target, content] of [["Gallery plaque", "read"], ["Crank locker", "unlock 0000"], ["Power router", "route exit"], ["Optical bench", "read"]])
    d.interact("Mara", target, content, false);
  for (const target of ["Pump crank", "Copper coil", "Glass prism"]) d.act("Mara", { type: "pickup", target }, false);
  for (const target of ["Archive", "Courtyard"]) d.act("Mara", { type: "move", target }, false);
  expect(getRoomForEntity(r.sim.world, i.Mara)).toBe(i.atrium);
  expect(getDirectContainer(r.sim.world, i.crank)).toBe(i.locker);
  expect(r.snapshot().state).toMatchObject({ lockerOpen: false, drained: false, exitOpen: false, allEscaped: false });
});

test("a read reveals nothing until its interval ends and losing sight cancels the read", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world;
  d.move("Mara", "Gallery"); const before = getWorkingMemory(w, r.ids.Mara).receipts.map(receipt => receipt.id);
  r.dispatch("Mara", { type: "interact", target: "Gallery plaque", content: "read" });
  r.advance(1499);
  expect(getWorkingMemory(w, r.ids.Mara).receipts.filter(receipt => !before.includes(receipt.id))).toEqual([]);
  addComponent(w, r.ids.Mara, Traits); Traits.active[r.ids.Mara] = '["blind"]'; r.advance(1);
  expect(LastAction.success[r.ids.Mara]).toBe(false);
  expect(JSON.stringify(getWorkingMemory(w, r.ids.Mara))).not.toMatch(/first two digits are/);
});

test("moving the intended item mid-pickup leaves it in its actual new place", async () => {
  const r = await create(); runEscapeRoomFixture(r, { stopAfter: "locker" });
  const d = new EscapeFixtureDriver(r), w = r.sim.world;
  d.act("Sera", { type: "drop", target: "Pump crank" });
  r.dispatch("Sera", { type: "pickup", target: "Pump crank" });
  expect(getDirectContainer(w, r.ids.crank)).toBe(r.ids.workshop);
  r.advance(400); setLocatedIn(w, r.ids.crank, r.ids.gallery); r.advance(400);
  expect(LastAction.success[r.ids.Sera]).toBe(false); expect(getDirectContainer(w, r.ids.crank)).toBe(r.ids.gallery);
  const events = getCommittedEvents(w).events.filter(event => event.actorId === r.ids.Sera && event.action === "pickup");
  const terminal = events.at(-1)!;
  expect(terminal.status).toBe("failed"); expect(terminal.completedAtSimMs! - terminal.startedAtSimMs!).toBe(800);
});

test("renaming the intended item cannot redirect pending pickup to a same-named replacement", async () => {
  const r = await create(), w = r.sim.world;
  const original = createObjectEntity(w, { name: "Portable test token", roomId: r.ids.atrium, portable: true });
  r.dispatch("Mara", { type: "pickup", target: "Portable test token" });
  Name.value[original] = "Renamed original";
  const replacement = createObjectEntity(w, { name: "Portable test token", roomId: r.ids.atrium, portable: true });
  r.advance(800);
  expect(getDirectContainer(w, original)).toBe(r.ids.atrium);
  expect(getDirectContainer(w, replacement)).toBe(r.ids.atrium);
  expect(LastAction.success[r.ids.Mara]).toBe(false);
  expect(isSimulationResourceBusy(w, r.ids.Mara, "body")).toBe(false);
});

test("deactivating a worker cancels its handling interval without possession", async () => {
  const r = await create(), w = r.sim.world;
  const token = createObjectEntity(w, { name: "Portable test token", roomId: r.ids.atrium, portable: true });
  r.dispatch("Mara", { type: "pickup", target: "Portable test token" });
  Agent.active[r.ids.Mara] = false; r.advance(800);
  expect(getDirectContainer(w, token)).toBe(r.ids.atrium);
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  Agent.active[r.ids.Mara] = true;
  expect(isSimulationResourceBusy(w, r.ids.Mara, "body")).toBe(false);
  expect(getCommittedEvents(w).events.filter(event => event.actorId === r.ids.Mara && event.action === "pickup").at(-1)?.status).toBe("failed");
});

test("a deactivated helper cannot support cooperative work", async () => {
  const r = await create(), d = preparePump(r), w = r.sim.world;
  d.begin("Mara", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump");
  r.advance(7999); Agent.active[r.ids.Mara] = false; r.advance(1);
  expect(r.snapshot().state.drained).toBe(false);
  expect(r.activity.phase[r.ids.Sera]).toBe("idle");
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  expect(LastAction.success[r.ids.Sera]).toBe(false);
  Agent.active[r.ids.Mara] = true;
  expect(isSimulationResourceBusy(w, r.ids.Mara, "body")).toBe(false);
});

test("observers distinguish installing a part from pumping, without seeing command arguments", async () => {
  const r = await create(), w = r.sim.world;
  runEscapeRoomFixture(r, { stopAfter: "locker" });
  const d = new EscapeFixtureDriver(r); d.move("Mara", "Workshop");
  r.dispatch("Sera", { type: "interact", target: "Drain pump", content: "install" });
  expect(getObservedPublicActivity(w, r.ids.Mara, r.ids.Sera)).toBe("installing Drain pump");
  expect(getDirectContainer(w, r.ids.crank)).toBe(r.ids.Sera);
  r.advance(2000);
  d.begin("Mara", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump");
  expect(getObservedPublicActivity(w, r.ids.Mara, r.ids.Sera)).toBe("pumping Drain pump");
  expect(r.snapshot().state.drained).toBe(false);
});

test.each(["open", "unlock", "break", "repair", "set state open", "enter 0000; unlock", "read; enter 0000"])("unsupported verb %s cannot fall through to generic world mutation", async content => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.interact("Mara", "Exit keypad", content, false);
  d.move("Mara", "Workshop"); d.interact("Mara", "Crank locker", content, false);
  expect(r.snapshot().state).toMatchObject({ lockerOpen: false, drained: false, exitOpen: false });
  expect(getDirectContainer(r.sim.world, r.ids.crank)).toBe(r.ids.locker);
});

test("a wrong observed-code variant does not unlock the locker", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.move("Sera", "Gallery"); const first = d.read("Sera", "Gallery plaque").match(/\b(\d{2})\b/)![1];
  d.move("Sera", "Atrium"); d.move("Sera", "Workshop");
  const last = d.read("Sera", "Workshop notebook").match(/\b(\d{2})\b/)![1];
  const correct = first + last, wrong = String((Number(correct) + 1) % 10_000).padStart(4, "0");
  // The exact answer still confers no remote physical authority. Mara has not
  // left the Atrium, even though this deliberately adversarial input names it.
  d.interact("Mara", "Crank locker", `unlock ${correct}`, false);
  expect(r.snapshot().state.lockerOpen).toBe(false);
  d.interact("Sera", "Crank locker", `unlock ${wrong}`, false);
  expect(r.snapshot().state.lockerOpen).toBe(false);
  d.act("Sera", { type: "pickup", target: "Pump crank" }, false);
  d.interact("Sera", "Crank locker", `  UNLOCK\t${correct}  `);
  expect(r.snapshot().state.lockerOpen).toBe(true);
});

test("knowing the pump verb does not replace the crank or a physically distinct helper", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.move("Mara", "Workshop"); d.interact("Mara", "Drain pump", "pump", false);
  d.act("Mara", { type: "move", target: "Archive" }, false);
  expect(r.snapshot().state.drained).toBe(false);
  d.move("Mara", "Atrium");
  const p = preparePump(r);
  p.interact("Sera", "Drain pump", "pump", false);
  p.begin("Sera", "Pump bypass", "hold");
  r.dispatch("Sera", { type: "interact", target: "Drain pump", content: "pump" });
  r.advance(8_000);
  expect(r.snapshot().state.drained).toBe(false);
  expect(r.activity.phase[r.ids.Sera]).not.toBe("pumping");
  p.interact("Sera", "Pump bypass", "release");
  p.begin("Mara", "Pump bypass", "hold"); p.begin("Sera", "Drain pump", "pump");
  r.advance(7_999); expect(r.snapshot().state.drained).toBe(false);
  r.advance(1); expect(r.snapshot().state.drained).toBe(true);
});

test("releasing a helper interrupts a nearly completed drain; retry must pay the full work duration", async () => {
  const r = await create(), d = preparePump(r);
  d.begin("Mara", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump"); r.advance(7_500);
  d.interact("Mara", "Pump bypass", "release");
  expect(r.snapshot().state.drained).toBe(false);
  expect(r.activity.phase[r.ids.Sera]).toBe("idle");
  expect(LastAction.success[r.ids.Sera]).toBe(false);
  expect(getDirectContainer(r.sim.world, r.ids.crank)).toBe(r.ids.pump);
  r.advance(1_000); expect(r.snapshot().state.drained).toBe(false);
  d.begin("Ivo", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump");
  r.advance(7_999); expect(r.snapshot().state.drained).toBe(false);
  r.advance(1); expect(r.snapshot().state.drained).toBe(true);
});

test("an externally displaced helper is no longer physical support even if its old holding activity remains", async () => {
  const r = await create(), d = preparePump(r);
  d.begin("Mara", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump"); r.advance(1_000);
  // An adversarial external world edit, never a step in the solution oracle.
  setLocatedIn(r.sim.world, r.ids.Mara, r.ids.atrium);
  r.advance(1);
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  expect(r.activity.phase[r.ids.Sera]).toBe("idle");
  expect(LastAction.success[r.ids.Sera]).toBe(false);
  expect(r.snapshot().state.drained).toBe(false);
  r.advance(8_000); expect(r.snapshot().state.drained).toBe(false);
  d.begin("Ivo", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump"); r.advance(8_000);
  expect(r.snapshot().state.drained).toBe(true);
});

test("written clues require the reader's own visual access, not just a known object name", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.move("Mara", "Gallery");
  addComponent(r.sim.world, r.ids.Mara, Traits); Traits.active[r.ids.Mara] = '["blind"]';
  const before = getWorkingMemory(r.sim.world, r.ids.Mara).receipts.map(receipt => receipt.id);
  d.interact("Mara", "Gallery plaque", "read", false);
  expect(r.snapshot().milestones.gallery_clue_read).toBeUndefined();
  expect(getWorkingMemory(r.sim.world, r.ids.Mara).receipts.filter(receipt => !before.includes(receipt.id))
    .some(receipt => /first two digits are \d{2}/.test(receipt.summary))).toBe(false);
  Traits.active[r.ids.Mara] = "[]";
  expect(d.read("Mara", "Gallery plaque")).toMatch(/first two digits are \d{2}/);
});

test.each(["observe", "examine", "use", "attack"] as const)("%s does not silently turn a known written object's description into a read", async type => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.move("Mara", "Gallery");
  d.act("Mara", { type, target: "Gallery plaque", content: "read" }, type === "observe" || type === "examine");
  expect(r.snapshot().milestones.gallery_clue_read).toBeUndefined();
  expect(JSON.stringify(getWorkingMemory(r.sim.world, r.ids.Mara))).not.toMatch(/first two digits are \d{2}/);
  expect(d.read("Mara", "Gallery plaque")).toMatch(/first two digits are \d{2}/);
});

test("a move requested while holding cannot teleport a helper or replace its original deadline", async () => {
  const r = await create(), d = preparePump(r);
  d.begin("Mara", "Pump bypass", "hold");
  const deadline = r.activity.untilMs[r.ids.Mara];
  r.dispatch("Mara", { type: "move", target: "Atrium" });
  r.advance(3_000);
  expect(getRoomForEntity(r.sim.world, r.ids.Mara)).toBe(r.ids.workshop);
  expect(r.activity.phase[r.ids.Mara]).toBe("holding_bypass");
  expect(r.activity.untilMs[r.ids.Mara]).toBe(deadline);
  r.advance(42_000);
  expect(r.activity.phase[r.ids.Mara]).toBe("idle");
  expect(getRoomForEntity(r.sim.world, r.ids.Mara)).toBe(r.ids.workshop);
  expect(LastAction.type[r.ids.Mara]).toBe("interact");
  expect(LastAction.target[r.ids.Mara]).toBe("Pump bypass");
  expect(LastAction.success[r.ids.Mara]).toBe(false);
  d.move("Mara", "Atrium");
});

test("helper expiry is processed causally, including coarse physical time steps", async () => {
  const r = await create(), d = preparePump(r);
  d.begin("Mara", "Pump bypass", "hold"); r.advance(44_000);
  d.begin("Sera", "Drain pump", "pump"); r.advance(10_000);
  expect(r.snapshot().state.drained).toBe(false);
  expect(LastAction.success[r.ids.Sera]).toBe(false);
  d.begin("Ivo", "Pump bypass", "hold"); d.begin("Sera", "Drain pump", "pump");
  r.advance(60_000); // Successful +8s completion precedes the hypothetical +45s expiry.
  expect(r.snapshot().state.drained).toBe(true);
  expect(LastAction.success[r.ids.Sera]).toBe(true);
  expect(LastAction.success[r.ids.Ivo]).toBe(true);
});

test("an archive visit alone cannot substitute for installed coil, prism, alignment and routed power", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  runEscapeRoomFixture(r, { stopAfter: "drained" });
  d.interact("Ivo", "Power router", "route optics", false);
  d.move("Mara", "Atrium"); d.move("Mara", "Gallery");
  expect(d.read("Mara", "Optical bench")).not.toMatch(/\b\d{4}\b/);
  expect(r.snapshot().milestones.exit_code_read).toBeUndefined();
  d.interact("Mara", "Optical bench", "install", false);
  d.move("Sera", "Archive");
  d.act("Sera", { type: "pickup", target: "Copper coil" });
  d.act("Sera", { type: "pickup", target: "Glass prism" });
  d.move("Sera", "Workshop"); d.interact("Sera", "Generator", "install");
  d.interact("Ivo", "Power router", "  ROUTE\t optics  ");
  // Reading the blank display is a valid observation, not a discovered answer.
  expect(d.read("Mara", "Optical bench")).not.toMatch(/\b\d{4}\b/);
  expect(r.snapshot().milestones.exit_code_read).toBeUndefined(); // Prism is still carried elsewhere.
  expect(getDirectContainer(r.sim.world, r.ids.prism)).toBe(r.ids.Sera);
  expect(r.snapshot().state.exitOpen).toBe(false);
});

test("the real exit code cannot bypass route power, distinct release holder, or timed unlocking", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  const report = runEscapeRoomFixture(r, { stopAfter: "optics" });
  d.move("Sera", "Atrium"); d.move("Mara", "Atrium");
  d.begin("Mara", "Exit release", "hold");
  d.interact("Sera", "Exit keypad", `enter ${report.exitCode}`, false); // Still powered optics.
  expect(r.snapshot().state.exitOpen).toBe(false);
  d.interact("Mara", "Exit release", "release");
  d.interact("Ivo", "Power router", "route exit");
  d.interact("Sera", "Exit keypad", `enter ${report.exitCode}`, false); // No physical helper.
  d.begin("Mara", "Exit release", "hold");
  const wrongCode = String((Number(report.exitCode) + 1) % 10_000).padStart(4, "0");
  d.interact("Sera", "Exit keypad", `enter ${wrongCode}`, false);
  expect(r.snapshot().state.exitOpen).toBe(false);
  expect(r.activity.phase[r.ids.Mara]).toBe("holding_release");
  r.dispatch("Mara", { type: "interact", target: "Exit keypad", content: `enter ${report.exitCode}` });
  r.advance(2_000); expect(r.snapshot().state.exitOpen).toBe(false);
  d.begin("Sera", "Exit keypad", `enter ${report.exitCode}`);
  r.advance(1_999); expect(r.snapshot().state.exitOpen).toBe(false);
  d.interact("Mara", "Exit release", "release");
  r.advance(1); expect(r.snapshot().state.exitOpen).toBe(false);
  expect(LastAction.success[r.ids.Sera]).toBe(false);
});

test("a wrong calibration extinguishes the answer even with both real parts installed and optical power on", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  const report = runEscapeRoomFixture(r, { stopAfter: "optics" });
  const wrong = report.alignment === "amber" ? "violet" : "amber";
  d.interact("Sera", "Optical bench", `align ${wrong}`);
  expect(r.snapshot().state).toMatchObject({ power: "optics", coilInstalled: true, prismInstalled: true, aligned: false, illuminated: false });
  expect(d.read("Sera", "Optical bench")).not.toMatch(/\b\d{4}\b/);
  d.interact("Sera", "Optical bench", `align ${report.alignment}`);
  expect(d.read("Sera", "Optical bench")).toContain(report.exitCode);
  expect(r.snapshot().state.exitOpen).toBe(false);
});

test("valid alternate prerequisite order illuminates the display and records its derived milestone", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  runEscapeRoomFixture(r, { stopAfter: "drained" });
  d.move("Sera", "Archive");
  const calibration = d.read("Sera", "Archive diagram").match(/\b(amber|cobalt|violet)\b/)![1];
  d.act("Sera", { type: "pickup", target: "Copper coil" }); d.act("Sera", { type: "pickup", target: "Glass prism" });
  d.move("Sera", "Workshop"); d.interact("Sera", "Generator", "install");
  d.move("Sera", "Atrium"); d.move("Sera", "Gallery");
  d.interact("Sera", "Optical bench", `align ${calibration}`); // Align before installation and power.
  expect(r.snapshot().state.illuminated).toBe(false);
  d.interact("Sera", "Optical bench", "install");
  expect(r.snapshot().state.illuminated).toBe(false);
  expect(r.snapshot().milestones.optical_display_lit).toBeUndefined();
  d.interact("Ivo", "Power router", "route optics");
  expect(r.snapshot().state.illuminated).toBe(true);
  expect(r.snapshot().milestones.optical_display_lit).toBe(r.elapsedMs);
  expect(r.snapshot().milestones.exit_code_read).toBeUndefined(); // Light alone is not a read.
  expect(d.read("Sera", "Optical bench")).toMatch(/exit code: \d{4}/);
});

test("power loss during final unlocking cancels safely and preserves a retryable known answer", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  const report = runEscapeRoomFixture(r, { stopAfter: "optics" });
  d.interact("Ivo", "Power router", "route exit");
  d.move("Mara", "Atrium"); d.move("Sera", "Atrium");
  d.begin("Mara", "Exit release", "hold"); d.begin("Sera", "Exit keypad", `enter ${report.exitCode}`);
  // Switching now takes one second: begin early enough for the actual power
  // loss, not merely its intention, to precede the unlock deadline.
  r.advance(500); d.interact("Ivo", "Power router", "route off"); r.advance(500);
  expect(r.snapshot().state.exitOpen).toBe(false);
  expect(LastAction.success[r.ids.Sera]).toBe(false);
  expect(ObjectState.current[r.ids.exit]).not.toMatch(/^open/i);
  d.interact("Ivo", "Power router", "route exit");
  if (r.activity.phase[r.ids.Mara] === "idle") d.begin("Mara", "Exit release", "hold");
  d.begin("Sera", "Exit keypad", `enter ${report.exitCode}`); r.advance(2_000);
  expect(r.snapshot().state.exitOpen).toBe(true);
  expect(r.snapshot().state.allEscaped).toBe(false);
});
