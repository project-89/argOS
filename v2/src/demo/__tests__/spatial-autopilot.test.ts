import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { startCommittedEvents } from "../../runtime/committed-events";
import { FLOOR_SPELL_GAME_MINUTES, SET_ASIDE_GAME_MINUTES, SettlementAutopilot, THINK_GAP_MS } from "../spatial-autopilot";

/** A game minute is a real second here. */
function fixture() {
  const world = createArgosWorld("Saltmere floors"); initializePrefabs(world); world.meta.aiEnabled = false; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Saltmere Common" });
  const otis = createAgentEntity(world, { name: "Otis", role: "fisher", systemPrompt: "A fisher.", roomId: room });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "builder", systemPrompt: "A builder.", roomId: room });
  const clock = { now: 0, night: false, engaged: false };
  const informed: string[] = [];
  const autopilot = new SettlementAutopilot({ world, now: () => clock.now, managed: () => [otis], cuesOf: () => [],
    inform: (_eid, _source, text) => informed.push(text), engaged: () => clock.engaged,
    errandOptions: () => ({ people: [], items: [], places: [] }), onErrand: () => undefined, mindAvailable: () => true, record: () => undefined,
    gameMinutes: m => m * 1000, isNight: () => clock.night, alwaysWakes: (_eid, p) => p.source === "Operator" });
  const say = (source: string, text: string) => autopilot.perceive(otis, { kind: "addressed", source, text: `${source} says to you: "${text}"`, atMs: clock.now });
  const pass = (ms: number, every = 1000, talk?: () => void) => { for (let t = 0; t < ms; t += every) { clock.now += every; talk?.(); autopilot.tick(); } };
  return { autopilot, otis, ivo, clock, informed, say, pass };
}

test("a standoff that never goes quiet is set aside after a spell: back to work, and for a while only the operator is answered", () => {
  const { autopilot, otis, say, pass, informed, clock } = fixture();
  say("Ivo", "What did you carry out of the Net House?");
  expect(autopilot.holds(otis)).toBe(true);
  // Ivo keeps at him every twenty seconds: the floor never goes quiet (45 s), yet after the spell it ends at the next lull.
  const pressing = () => { if (clock.now % 20_000 === 0) say("Ivo", "Answer me."); };
  pass(FLOOR_SPELL_GAME_MINUTES * 1000, 1000, pressing);
  expect(autopilot.holds(otis)).toBe(true); // the spell is up, but Ivo spoke ten seconds ago: answer first
  pass(2000, 1000, pressing);
  expect(autopilot.holds(otis)).toBe(false);
  expect(autopilot.log.at(-1)?.what).toBe("sets it aside for now and goes back to work");
  expect(autopilot.resting(otis)).toBe(true);
  // Set aside: Ivo is not answered, the operator is.
  const told = informed.length;
  say("Ivo", "Don't walk away from me.");
  expect(autopilot.holds(otis)).toBe(false);
  autopilot.summon(otis, "You mean to confront Ivo.");
  expect(autopilot.holds(otis)).toBe(false);
  say("Operator", "Otis, a word?");
  expect(autopilot.holds(otis)).toBe(true);
  expect(informed.length).toBe(told + 1);
});

test("the set-aside spell ends: an hour of work later, being spoken to wakes the mind again", () => {
  const { autopilot, otis, say, pass, clock } = fixture();
  say("Ivo", "A word.");
  pass(FLOOR_SPELL_GAME_MINUTES * 1000 + 3000, 1000, () => { if (clock.now % 20_000 === 0) say("Ivo", "Answer me."); });
  expect(autopilot.resting(otis)).toBe(true);
  pass(SET_ASIDE_GAME_MINUTES * 1000);
  expect(autopilot.resting(otis)).toBe(false);
  say("Ivo", "Now then.");
  expect(autopilot.holds(otis)).toBe(true);
});

test("night ends the floor once they are free of it, and they are left to sleep till dawn", () => {
  const { autopilot, otis, say, pass, clock } = fixture();
  say("Ivo", "Open the tent.");
  expect(autopilot.holds(otis)).toBe(true);
  clock.night = true; clock.engaged = true;
  pass(3000);
  expect(autopilot.holds(otis)).toBe(true); // still mid-line
  clock.engaged = false;
  pass(1000);
  expect(autopilot.holds(otis)).toBe(false);
  expect(autopilot.log.at(-1)?.what).toBe("turns in for the night");
  say("Ivo", "I know you're awake.");
  autopilot.summon(otis, "You mean to hide it.");
  expect(autopilot.holds(otis)).toBe(false);
  clock.night = false;
  pass(1000);
  say("Ivo", "Morning. We're not done.");
  expect(autopilot.holds(otis)).toBe(true);
});

test("a floor with no lull at all is still set aside at twice the spell", () => {
  const { autopilot, otis, say, pass, clock } = fixture();
  say("Ivo", "Open it.");
  pass(2 * FLOOR_SPELL_GAME_MINUTES * 1000 - 5000, 1000, () => { if (clock.now % 5_000 === 0) say("Ivo", "Open it now."); });
  expect(autopilot.holds(otis)).toBe(true);
  pass(6000, 1000, () => { if (clock.now % 5_000 === 0) say("Ivo", "Open it now."); });
  expect(autopilot.holds(otis)).toBe(false);
  expect(autopilot.resting(otis)).toBe(true);
});

test("a woken mind is paced: it answers what is new at once, and does not spin when nothing is", () => {
  const { autopilot, otis, ivo, say, pass } = fixture();
  expect(autopilot.gate.foreground(ivo)).toBe(true); // not on autopilot: unaffected
  expect(autopilot.gate.foreground(otis)).toBe(false); // on autopilot, the habit drives
  say("Ivo", "What did you carry out of the Net House?");
  expect(autopilot.gate.foreground(otis)).toBe(true);
  autopilot.gate.foregroundTurn!(otis); // he answers
  expect(autopilot.gate.foreground(otis)).toBe(false); // nothing new yet: no second thought on top of the first
  pass(THINK_GAP_MS - 1000);
  expect(autopilot.gate.foreground(otis)).toBe(false);
  say("Ivo", "Answer me."); // something new: answered at once
  expect(autopilot.gate.foreground(otis)).toBe(true);
  autopilot.gate.foregroundTurn!(otis);
  pass(THINK_GAP_MS);
  expect(autopilot.gate.foreground(otis)).toBe(true); // a pause: he may think again
});

test("spoken to while working: routine talk is answered in passing (and becomes a habit); what matters looks up; secrets are never habitual", async () => {
  const { HabitBook } = await import("../../cognition/habit-book");
  const { IN_PASSING } = await import("../spatial-autopilot");
  const world = createArgosWorld("Saltmere passing"); initializePrefabs(world); world.meta.aiEnabled = false; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Saltmere Common" });
  const otis = createAgentEntity(world, { name: "Otis", role: "fisher", systemPrompt: "A fisher.", roomId: room });
  let now = 0;
  const appraised: string[] = [], passed: string[] = [], habits = new HabitBook({ minCount: 3, minShare: .8, checkEvery: 99, maxMisses: 2 });
  const autopilot = new SettlementAutopilot({ world, now: () => now, managed: () => [otis], cuesOf: () => ["Net House"],
    inform: () => undefined, engaged: () => false, errandOptions: () => ({ people: [], items: [], places: [] }), onErrand: () => undefined,
    mindAvailable: () => true, record: () => undefined, gameMinutes: m => m * 1000, habits,
    appraise: async (_eid, p) => { appraised.push(p.text); const grave = /box/.test(p.text); return { wake: grave ? .8 : .2, remember: .3, importance: grave ? .9 : .2 }; },
    situationOf: (_eid, p) => /Net House/.test(p.text) ? undefined : `spoken to|by ${p.source}|at Saltmere Common|morning`,
    answerInPassing: (_eid, p) => passed.push(p.text) });
  const say = async (text: string) => {
    now += 5000; autopilot.perceive(otis, { kind: "addressed", source: "Tess", text: `Tess says to you: "${text}"`, atMs: now });
    await new Promise(r => setImmediate(r)); autopilot.tick();
  };
  await say("Morning, love. Good catch?");
  expect(autopilot.holds(otis)).toBe(false); // not woken
  expect(passed).toHaveLength(1);
  await say("Tide's up early."); await say("Bring me two for the pot?");
  expect(habits.of("Otis")).toEqual({ "spoken to|by Tess|at Saltmere Common|morning": IN_PASSING });
  // Now a habit: answered in passing without asking the judge.
  const judged = appraised.length;
  await say("Mind the wet stones.");
  expect(appraised.length).toBe(judged);
  expect(passed).toHaveLength(4);
  expect(autopilot.log.at(-1)?.what).toMatch(/^answers in passing \(by habit\)/);
  // What touches his secret is never met by habit: the judge reads it, and it matters.
  await say("What did you take out of the Net House box?");
  expect(appraised.length).toBe(judged + 1);
  expect(autopilot.holds(otis)).toBe(true);
});

test("background minds run with the floor and for a short digest after, not for the rest of the day", () => {
  const { autopilot, otis, say, pass } = fixture();
  expect(autopilot.gate.background(otis)).toBe(false);
  say("Ivo", "Morning.");
  expect(autopilot.gate.background(otis)).toBe(true);
  pass(50_000); // quiet: the floor is handed back
  expect(autopilot.holds(otis)).toBe(false);
  expect(autopilot.gate.background(otis)).toBe(true); // digesting
  pass(2 * 60_000);
  expect(autopilot.gate.background(otis)).toBe(false);
});

test("a habit-driven resident whose mind is not awake takes its fast step about once a second; awake, every tick", async () => {
  const { setMindGate, fastStepDue } = await import("../../runtime/attention");
  const { advanceSimulationTime } = await import("../../ecs/simulation-time");
  const { AUTOPILOT_FAST_CADENCE_MS } = await import("../spatial-autopilot");
  const { autopilot, otis, ivo, say } = fixture();
  expect(autopilot.gate.fastCadenceMs!(otis)).toBe(AUTOPILOT_FAST_CADENCE_MS);
  expect(autopilot.gate.fastCadenceMs!(ivo)).toBeUndefined(); // not on autopilot: unaffected
  const world = (autopilot as any).host.world;
  setMindGate(world, autopilot.gate);
  let tick = 0;
  const steps = () => { let due = 0; for (let i = 0; i < 20; i++) { advanceSimulationTime(world, ++tick, 100); if (fastStepDue(world, otis)) due++; } return due; };
  expect(steps()).toBe(2); // two seconds of ticks: twice
  say("Ivo", "Otis, a word."); // his mind takes the floor
  expect(autopilot.gate.fastCadenceMs!(otis)).toBeUndefined();
  expect(steps()).toBe(20); // every tick while awake
});
