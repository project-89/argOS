import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { Goal, LastAction, ObjectState } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAgentMemory, buildAgentContext } from "../../cognition/agent-mind";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getSocialDialogue } from "../../cognition/social-memory";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { EscapeFixtureDriver, runEscapeRoomFixture } from "../../evals/escape-room-fixture";
import type { EscapeActor } from "../../evals/escape-room-fixture";
import { EscapeRoomTestbed } from "../escape-room";

let room: EscapeRoomTestbed | undefined;
beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Escape-room fixtures must never call a model"));
});
afterEach(() => { room?.stop(); room = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create(seed: number | string = 19) {
  room = await EscapeRoomTestbed.create({ live: false, seed }); await room.start(); return room;
}

test.each([1, 7, 2026, "underfloor"])('%s: a complete chain is solvable using real actions and inspected clues', async seed => {
  const r = await create(seed), report = runEscapeRoomFixture(r);
  expect(report).toMatchObject({ mode: "scripted-physical-oracle", completedThrough: "escaped" });
  expect(report.actions).toBeGreaterThan(30);
  expect(report.checkpoints.map(checkpoint => checkpoint.stage)).toEqual(["locker", "drained", "optics", "exit", "escaped"]);
  expect(report.checkpoints.every((checkpoint, index, list) => index === 0 || checkpoint.elapsedMs > list[index - 1].elapsedMs)).toBe(true);
  const { ids: i, sim: { world: w } } = r;
  expect(getDirectContainer(w, i.crank)).toBe(i.pump);
  expect(getDirectContainer(w, i.coil)).toBe(i.generator);
  expect(getDirectContainer(w, i.prism)).toBe(i.bench);
  for (const actor of r.characters) {
    expect(getRoomForEntity(w, i[actor])).toBe(i.outside);
    expect(r.activity.phase[i[actor]]).toBe("idle");
    expect(LastAction.success[i[actor]]).toBe(true);
  }
  expect(r.snapshot().state).toMatchObject({ drained: true, exitOpen: true, allEscaped: true });
});

test.each<readonly [EscapeActor, EscapeActor, EscapeActor]>([
  ["Mara", "Ivo", "Sera"], ["Mara", "Sera", "Ivo"], ["Ivo", "Mara", "Sera"],
  ["Ivo", "Sera", "Mara"], ["Sera", "Ivo", "Mara"],
])("the chain has no hard-coded protagonist: reader %s, helper %s, power operator %s", async (reader, helper, operator) => {
  const r = await create(53);
  runEscapeRoomFixture(r, { actors: [reader, helper, operator] });
  expect(r.snapshot().state.allEscaped).toBe(true);
  const evidence = getWorkingMemory(r.sim.world, r.ids[reader]);
  expect(evidence.receipts.some(receipt => receipt.provenance === "own_action" && receipt.summary.includes("exit code:"))).toBe(true);
});

test("codes vary with seed and are discovered from actual reads, not an operator answer field", async () => {
  // Regression: this timestamp contains one seed's code (8177). Mechanical
  // clock/source metadata is not a disclosed clue; all scene content still is.
  jest.spyOn(Date, "now").mockReturnValue(1788909098177);
  const codes = new Set<string>();
  for (const seed of [11, 29, 71, 103]) {
    const r = await create(seed);
    const initialContexts = r.characters.map(actor => r.context(r.ids[actor]));
    const initialScenes = JSON.stringify(r.scenes().map(({ capturedWallMs: _clock, sourceId: _source, ...content }) => content));
    const report = runEscapeRoomFixture(r, { stopAfter: "locker" });
    expect(report.lockerCode).toMatch(/^\d{4}$/);
    codes.add(report.lockerCode);
    expect(initialScenes).not.toContain(report.lockerCode);
    for (const context of initialContexts) expect(context).not.toContain(report.lockerCode);
    expect(r.snapshot().state).not.toHaveProperty("lockerCode");
    expect(r.snapshot().state).not.toHaveProperty("exitCode");
    r.stop(); room = undefined;
  }
  expect(codes.size).toBeGreaterThan(1);
});

test("a private local read enters only the reader's memory; repeated context rendering does not manufacture knowledge", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world;
  d.move("Sera", "Gallery");
  const others = ["Mara", "Ivo"] as const;
  const before = others.map(actor => ({ working: getWorkingMemory(w, r.ids[actor]), mind: getAgentMemory(w, r.ids[actor]) }));
  const clue = d.read("Sera", "Gallery plaque");
  expect(clue).toMatch(/\b\d{2}\b/);
  expect(getWorkingMemory(w, r.ids.Sera).receipts.some(receipt => receipt.summary.includes(clue))).toBe(true);
  for (let n = 0; n < 10; n++) for (const actor of others) { r.context(r.ids[actor]); buildAgentContext(w, r.ids[actor]); }
  for (const [index, actor] of others.entries()) {
    expect(getWorkingMemory(w, r.ids[actor])).toEqual(before[index].working);
    expect(getAgentMemory(w, r.ids[actor])).toEqual(before[index].mind);
  }
  expect(JSON.stringify(r.scenes())).not.toContain(clue);
});

test("silent reading does not disclose the text to sighted people standing in the same room", async () => {
  const r = await create("private-reader-seed-not-a-scene"), d = new EscapeFixtureDriver(r), w = r.sim.world;
  for (const actor of r.characters) d.move(actor, "Gallery");
  const clue = d.read("Sera", "Gallery plaque");
  const statement = clue.match(/first two digits are \d{2}/)![0];
  expect(JSON.stringify(getWorkingMemory(w, r.ids.Sera))).toContain(statement);
  for (const actor of ["Mara", "Ivo"] as const) {
    expect(JSON.stringify(getWorkingMemory(w, r.ids[actor]))).not.toContain(statement);
    expect(JSON.stringify(getAgentMemory(w, r.ids[actor]))).not.toContain(statement);
    expect(JSON.stringify(getSocialDialogue(w, r.ids[actor]))).not.toContain(statement);
    expect(buildAgentContext(w, r.ids[actor])).not.toContain(statement);
    expect(r.context(r.ids[actor])).not.toContain(statement);
  }
  const scenes = JSON.stringify(r.scenes());
  expect(scenes).not.toContain(statement);
  expect(scenes).not.toContain("private-reader-seed-not-a-scene");
  expect(scenes).not.toContain(clue);
});

test("even a colocated witness does not acquire the final displayed digits from someone else's silent reading", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world;
  // Stop before optics; the second witness must travel through real doorways.
  runEscapeRoomFixture(r, { stopAfter: "drained" });
  d.move("Sera", "Archive"); const alignment = d.read("Sera", "Archive diagram").match(/\b(amber|cobalt|violet)\b/)![1];
  d.act("Sera", { type: "pickup", target: "Copper coil" }); d.act("Sera", { type: "pickup", target: "Glass prism" });
  d.move("Sera", "Workshop"); d.interact("Sera", "Generator", "install"); d.interact("Ivo", "Power router", "route optics");
  for (const actor of ["Mara", "Sera"] as const) { d.move(actor, "Atrium"); d.move(actor, "Gallery"); }
  d.interact("Sera", "Optical bench", "install"); d.interact("Sera", "Optical bench", `align ${alignment}`);
  const result = d.read("Sera", "Optical bench"), code = result.match(/\b\d{4}\b/)![0];
  const publicScene = JSON.stringify(r.scenes());
  expect(publicScene).not.toContain(code);
  expect(ObjectState.current[r.ids.bench]).not.toContain(code);
  for (const actor of ["Mara", "Ivo"] as const) {
    expect(JSON.stringify(getWorkingMemory(w, r.ids[actor]))).not.toContain(`exit code: ${code}`);
    expect(JSON.stringify(getAgentMemory(w, r.ids[actor]))).not.toContain(`exit code: ${code}`);
    expect(buildAgentContext(w, r.ids[actor])).not.toContain(`exit code: ${code}`);
  }
  // The witness can choose to read for herself; proximity is not that choice.
  expect(d.read("Mara", "Optical bench")).toContain(`exit code: ${code}`);
});

test("separate clue readers can pass attributed knowledge through actual local dialogue without transferring private reads", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world;
  d.move("Mara", "Gallery");
  const prefix = d.read("Mara", "Gallery plaque").match(/\b(\d{2})\b/)![1];
  d.move("Sera", "Workshop");
  const suffix = d.read("Sera", "Workshop notebook").match(/\b(\d{2})\b/)![1];
  const readerReceiptIds = [r.ids.Mara, r.ids.Sera].flatMap(eid => getWorkingMemory(w, eid).receipts
    .filter(receipt => /digits are/.test(receipt.summary)).map(receipt => receipt.id));
  expect(getWorkingMemory(w, r.ids.Ivo).receipts.some(receipt => readerReceiptIds.includes(receipt.id))).toBe(false);
  d.move("Mara", "Atrium"); d.move("Sera", "Atrium");
  d.act("Mara", { type: "speak", target: "Ivo", content: `I read the Gallery plaque: the first pair is ${prefix}.` });
  r.advance(250); // Physical conversational handoff; no second voice at the same instant.
  d.act("Sera", { type: "speak", target: "Ivo", content: `I read the Workshop notebook: the last pair is ${suffix}.` });
  const heard = getSocialDialogue(w, r.ids.Ivo).filter(turn => !turn.own);
  const firstHeard = heard.find(turn => turn.speaker === "Mara")?.content.match(/first pair is (\d{2})/)?.[1];
  const lastHeard = heard.find(turn => turn.speaker === "Sera")?.content.match(/last pair is (\d{2})/)?.[1];
  expect(firstHeard).toBe(prefix); expect(lastHeard).toBe(suffix);
  expect(getWorkingMemory(w, r.ids.Ivo).receipts.some(receipt => readerReceiptIds.includes(receipt.id))).toBe(false);
  d.move("Ivo", "Workshop");
  d.interact("Ivo", "Crank locker", `unlock ${firstHeard}${lastHeard}`);
  expect(r.snapshot().state.lockerOpen).toBe(true);
});

test("mounted parts require their actual possessor and remain physically installed", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world, i = r.ids;
  runEscapeRoomFixture(r, { stopAfter: "locker" });
  d.move("Mara", "Workshop");
  d.interact("Mara", "Drain pump", "install", false);
  expect(getDirectContainer(w, i.crank)).toBe(i.Sera);
  d.act("Mara", { type: "pickup", target: "Pump crank" }, false);
  d.act("Sera", { type: "give", target: "Mara", content: "Pump crank" });
  expect(getDirectContainer(w, i.crank)).toBe(i.Mara);
  d.interact("Sera", "Drain pump", "install", false);
  d.interact("Mara", "Drain pump", "install");
  expect(getDirectContainer(w, i.crank)).toBe(i.pump);
  d.act("Mara", { type: "pickup", target: "Pump crank" }, false);
  expect(getDirectContainer(w, i.crank)).toBe(i.pump);
});

test("routing power away from optics blanks the present display without deleting the actor's real earlier read", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r), w = r.sim.world;
  const report = runEscapeRoomFixture(r, { stopAfter: "optics" });
  const code = report.exitCode!;
  const read = getWorkingMemory(w, r.ids.Sera).receipts.find(receipt => receipt.summary.includes(code));
  expect(read).toBeDefined();
  d.interact("Ivo", "Power router", "route exit");
  expect(ObjectState.current[r.ids.bench]).not.toContain(code);
  const blankRead = d.read("Sera", "Optical bench");
  expect(blankRead).not.toContain(code); // Successfully observing a blank display is not discovering a code.
  expect(blankRead).toMatch(/no legible code/i);
  expect(getWorkingMemory(w, r.ids.Sera).receipts.find(receipt => receipt.id === read!.id)).toEqual(read);
  expect(r.context(r.ids.Sera)).not.toContain(code);
  expect(r.snapshot().state.exitOpen).toBe(false);
});

test("speaking a success claim and opening the door do not satisfy actual evacuation", async () => {
  const r = await create(), d = new EscapeFixtureDriver(r);
  d.act("Mara", { type: "speak", target: "Ivo", content: "We have all escaped. The exit is open and we are in the courtyard." });
  r.advance(1);
  expect(r.snapshot().state).toMatchObject({ exitOpen: false, allEscaped: false });
  const goals = r.characters.flatMap(actor => getRelationTargets(r.sim.world, r.ids[actor], HasGoal));
  expect(goals.some(goal => Goal.status[goal] === "completed")).toBe(false);
  runEscapeRoomFixture(r, { stopAfter: "exit" });
  expect(r.snapshot().actors.every(actor => actor.goalStatus === "completed")).toBe(false);
  d.move("Mara", "Courtyard"); d.move("Ivo", "Courtyard");
  expect(r.snapshot().state.allEscaped).toBe(false);
  expect(r.snapshot().actors.find(actor => actor.name === "Sera")?.goalStatus).not.toBe("completed");
  d.move("Sera", "Courtyard");
  expect(r.snapshot().state.allEscaped).toBe(true);
  for (const actor of r.characters) {
    expect(getRoomForEntity(r.sim.world, r.ids[actor])).toBe(r.ids.outside);
    expect(getWorkingMemory(r.sim.world, r.ids[actor]).receipts.some(receipt => receipt.succeeded === true
      && receipt.provenance === "own_action" && /Courtyard/i.test(receipt.summary))).toBe(true);
  }
  expect(r.snapshot().actors.every(actor => actor.goalStatus === "completed")).toBe(true);
});
