import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { startCommittedEvents } from "../../runtime/committed-events";
import { FLOOR_SPELL_GAME_MINUTES, SET_ASIDE_GAME_MINUTES, SettlementAutopilot } from "../spatial-autopilot";

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
