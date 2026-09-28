import { jest } from "@jest/globals";
import { LastAction } from "../../ecs/components";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { getAgentWorldCapabilities, getObservedPublicActivity } from "../../cognition/world-capabilities";
import { generateStimuliForAgent } from "../../cognition/sensory-system";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture } from "../../evals/escape-room-fixture";
import { EscapeRoomTestbed, type EscapeCharacter } from "../escape-room";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Readiness fixtures are offline")); });
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create() { room = await EscapeRoomTestbed.create({ live: false, seed: 6137 }); await room.start(); return room; }
const menu = (r: EscapeRoomTestbed, actor: EscapeCharacter, target: number) => getAvailableAffordances(r.sim.world, r.ids[actor], target).map(a => a.name);

test("unpowered controls and unpossessed installation parts are not offered as immediately usable", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), i = r.ids;
  expect(menu(r, "Mara", i.exit)).not.toContain("enter <four digits>");
  expect(menu(r, "Mara", i.release)).toContain("hold");
  d.interact("Mara", "Exit keypad", "enter 0000", false);
  d.move("Mara", "Workshop");
  for (const target of [i.pump, i.generator]) expect(menu(r, "Mara", target)).not.toContain("install");
  expect(menu(r, "Mara", i.pump)).not.toContain("pump");
  expect(menu(r, "Mara", i.router)).toContain("route off");
  for (const command of ["route optics", "route exit"]) {
    expect(menu(r, "Mara", i.router)).not.toContain(command); d.interact("Mara", "Power router", command, false);
  }
  expect(menu(r, "Mara", i.locker)).toContain("unlock <four digits>");
  d.interact("Mara", "Crank locker", "unlock 0000", false);
  expect(menu(r, "Mara", i.locker)).toContain("unlock <four digits>"); // No secret-code oracle.
});

test("pump admission follows carried parts, a distinct helper and exclusive resource occupancy", async () => {
  const r = await create(); runEscapeRoomFixture(r, { stopAfter: "locker" });
  const d = new EscapeFixtureDriver(r), i = r.ids;
  d.move("Mara", "Workshop"); d.move("Ivo", "Workshop");
  expect(menu(r, "Sera", i.pump)).toContain("install"); expect(menu(r, "Mara", i.pump)).not.toContain("install");
  d.interact("Sera", "Drain pump", "install");
  expect(menu(r, "Sera", i.pump)).not.toContain("pump");
  d.begin("Mara", "Pump bypass", "hold");
  expect(menu(r, "Sera", i.pump)).toContain("pump"); expect(menu(r, "Mara", i.pump)).not.toContain("pump");
  expect(menu(r, "Ivo", i.bypass)).not.toContain("hold");
  d.begin("Sera", "Drain pump", "pump");
  expect(menu(r, "Ivo", i.pump)).not.toContain("pump");
  const due = r.activity.untilMs[i.Sera]; d.interact("Ivo", "Drain pump", "pump", false);
  expect(r.activity.untilMs[i.Sera]).toBe(due); expect(r.activity.phase[i.Sera]).toBe("pumping");
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Mara)).toBe("holding Pump bypass");
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Sera)).toBe("pumping Drain pump");
  const people = generateStimuliForAgent(r.sim.world, i.Ivo, []).filter(s => s.type === "people").map(s => s.content).join(" ");
  expect(people).toContain("Sera (pumping Drain pump)"); expect(people).not.toContain("Sera (idle)");
  expect(r.context(i.Ivo)).toContain('"state":"holding Pump bypass"');
  expect(getAgentWorldCapabilities(r.sim.world, i.Mara)!.ready()).toBe(false);
  r.advance(8000);
  expect(menu(r, "Ivo", i.pump)).not.toContain("pump");
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Mara)).toBeUndefined();
});

test("keypad admission disappears while occupied or unpowered and returns for a real retry", async () => {
  const r = await create(), { exitCode } = runEscapeRoomFixture(r, { stopAfter: "optics" });
  const d = new EscapeFixtureDriver(r), i = r.ids;
  d.interact("Ivo", "Power router", "route exit");
  d.move("Mara", "Atrium"); d.move("Sera", "Atrium"); d.move("Ivo", "Atrium");
  expect(menu(r, "Sera", i.exit)).not.toContain("enter <four digits>");
  d.begin("Mara", "Exit release", "hold");
  expect(menu(r, "Sera", i.exit)).toContain("enter <four digits>");
  d.interact("Sera", "Exit keypad", "enter 0000", false);
  expect(menu(r, "Sera", i.exit)).toContain("enter <four digits>");
  d.begin("Sera", "Exit keypad", `enter ${exitCode}`);
  expect(menu(r, "Ivo", i.exit)).not.toContain("enter <four digits>");
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Sera)).toBe("opening Exit keypad");
  expect(r.context(i.Ivo)).not.toContain(exitCode!);
  r.advance(500); r.perturb({ after: "exit_unlock_started" });
  expect(LastAction.success[i.Sera]).toBe(false);
  expect(menu(r, "Sera", i.exit)).not.toContain("enter <four digits>");
  d.move("Ivo", "Workshop"); d.interact("Ivo", "Power router", "route exit");
  expect(menu(r, "Sera", i.exit)).toContain("enter <four digits>");
  d.begin("Sera", "Exit keypad", `enter ${exitCode}`); r.advance(2000);
  expect(r.snapshot().state.exitOpen).toBe(true); expect(menu(r, "Sera", i.exit)).not.toContain("enter <four digits>");
});

test("moving is visibly directed toward a local doorway, not an early arrival or a private goal", async () => {
  const r = await create(), i = r.ids;
  r.dispatch("Mara", { type: "move", target: "Gallery", content: "private purpose sentinel" });
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Mara)).toBe("moving toward Gallery");
  expect(r.context(i.Ivo)).not.toContain("private purpose sentinel");
  expect(r.snapshot().actors.find(a => a.name === "Mara")!.room).toBe("Atrium");
  r.advance(3000);
  expect(getObservedPublicActivity(r.sim.world, i.Ivo, i.Mara)).toBeUndefined();
});
