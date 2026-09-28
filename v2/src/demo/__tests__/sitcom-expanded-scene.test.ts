import { jest } from "@jest/globals";
import { getRoomForEntity } from "../../ecs/location";
import { ObjectState } from "../../ecs/components";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector, type SitcomRenderSegment } from "../sitcom-director";
import { buildSitcomPerformance } from "../sitcom-performance";
import type { ScreenBeat } from "../sitcom-screenplay";

let t: ApartmentSitcom, d: SitcomDirector;
beforeEach(async () => {
  drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Expanded scenes are offline"));
  t = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null });
  d = new SitcomDirector(t, { scheduling: "performance" }); await t.start();
});
afterEach(() => { d?.stop(); t?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
function drain() {
  t.stop(); const segments: SitcomRenderSegment[] = [];
  for (let index = 0; index < 100; index++) {
    const result = d.next(segments.at(-1)?.version);
    if ("segment" in result) { segments.push(result.segment); continue; }
    expect(result).toEqual({ ended: true }); return segments;
  }
  throw new Error("Camera did not finish bounded recording");
}
function move(name: "Jerry" | "Elaine", target: string) { t.dispatch(name, { type: "move", target }); t.advance(3000); }

test("all four initially authored places enter one camera without forcing an interior onto the actual Street", () => {
  expect(t.scenes().map(scene => scene.room.name).sort()).toEqual(["Hallway", "Kitchen", "Living Room", "Street"]);
  t.advance(10_125); move("Elaine", "Hallway"); move("Elaine", "Street"); t.advance(5000);
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.street);
  const segments = drain(), prompt = segments.map(segment => segment.prompt).join("\n");
  expect(segments[0].prompt).toContain('SET "Hallway"'); expect(segments[0].prompt).toContain('SET "Street"');
  expect(prompt).toContain('"Elaine" enters "Hallway" from "Living Room"');
  expect(prompt).toContain('"Elaine" enters "Street" from "Hallway"');
  expect(prompt).toContain("EXTERIOR New York sidewalk"); expect(prompt).not.toContain("INTERIOR view");
  expect(Math.max(...segments.map(s => s.prompt.length))).toBeLessThanOrEqual(12_000);
});

test("real pour and drink remain whole, visible gestures with the exact held mug's fill-state changes", () => {
  move("Jerry", "Kitchen"); t.dispatch("Jerry", { type: "pickup", target: "Blue mug" }); t.advance(800);
  t.advance(5700); // A pour spans the nominal opening boundary at10.125s.
  t.dispatch("Jerry", { type: "interact", target: "Coffee pot", content: "pour" }); t.advance(1000);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4); expect(t.cup.filled[t.ids.blueMug]).toBe(false);
  t.advance(1000); expect(t.coffee.portions[t.ids.coffee]).toBe(3); expect(t.cup.filled[t.ids.blueMug]).toBe(true);
  t.dispatch("Jerry", { type: "interact", target: "Blue mug", content: "drink" }); t.advance(3000);
  expect(ObjectState.current[t.ids.blueMug]).toBe("empty"); expect(t.cup.drinks[t.ids.blueMug]).toBe(1);
  t.advance(8000); const segments = drain(), prompt = segments.map(segment => segment.prompt).join("\n");
  const gestures = segments.flatMap(segment => segment.script.beats.filter(beat => beat.kind === "action" && ["pouring", "drinking"].includes(beat.operation ?? "")
    && (beat.endSimMs ?? beat.atSimMs) > beat.atSimMs).map(beat => ({ segment, beat })));
  expect(gestures).toHaveLength(2);
  expect(gestures.map(({ beat }) => [beat.operation, beat.atSimMs, beat.endSimMs])).toEqual([["pouring", 9500, 11500], ["drinking", 11500, 14500]]);
  for (const { segment, beat } of gestures) {
    expect(beat.atSimMs).toBeGreaterThanOrEqual(segment.sourceStartSimMs);
    expect(beat.endSimMs!).toBeLessThanOrEqual(segment.sourceEndSimMs);
    const index = segment.script.beats.indexOf(beat), cue = segment.script.performance.cues.find(c => c.beat === index)!;
    expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(1800 - .001);
    expect(segment.script.performance.shots.some(shot => shot.beat === index && shot.kind === "object_hands")).toBe(true);
  }
  expect(prompt).toContain('pours one portion from "Coffee pot" into "Blue mug"');
  expect(prompt).toContain('raises "Blue mug" to their lips and drinks');
  expect(prompt).toContain("filled with coffee"); expect(prompt).toContain('"empty"');
  const stateChanges = segments.flatMap(segment => segment.script.beats).filter(beat => beat.kind === "state" && beat.direction.includes('"Blue mug"'));
  expect(stateChanges.some(beat => beat.atSimMs === 11500 && beat.direction.includes('visible state: "filled with coffee"'))).toBe(true);
  expect(stateChanges.some(beat => beat.atSimMs === 14500 && beat.direction.includes('visible state: "empty"'))).toBe(true);
  expect(prompt).not.toContain("says exactly once");
});

test("phone vibrations and actual reading remain filmable after the holder walks into the Hallway", () => {
  move("Elaine", "Kitchen"); t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  move("Elaine", "Living Room"); move("Elaine", "Hallway");
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.hallway);
  t.text("PRIVATE_HALLWAY_BODY"); t.advance(200);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200); t.advance(10_000);
  const segments = drain(), beats = segments.flatMap(s => s.script.beats), prompt = segments.map(s => s.prompt).join("\n");
  expect(beats.some(b => b.kind === "sound" && b.roomId === t.ids.hallway)).toBe(true);
  expect(beats.some(b => b.operation === "reading" && b.roomId === t.ids.hallway && (b.endSimMs ?? b.atSimMs) > b.atSimMs)).toBe(true);
  expect(prompt).toContain('phone vibration in "Hallway"'); expect(prompt).toContain('in "Elaine"\'s hands');
  expect(prompt).not.toContain("PRIVATE_HALLWAY_BODY");
});

test.each(["pouring", "drinking"])("%s cannot vanish behind another character's dialogue", operation => {
  const speech: ScreenBeat = { kind: "speech", atSimMs: 0, endSimMs: 5000, actorId: 1, text: "You can take your time.", direction: "Exact speech", evidence: [1] };
  const physical: ScreenBeat = { kind: "action", atSimMs: 1200, endSimMs: 3200, actorId: 2, operation, direction: "Actual physical gesture", evidence: [2] };
  const result = buildSitcomPerformance([speech, physical], 0, 8500, 8500);
  expect(result.shots.some(shot => shot.beat === 1 && shot.kind === "object_hands")).toBe(true);
  expect(() => buildSitcomPerformance([physical, { ...physical, actorId: 3, evidence: [3] }], 0, 8500, 8500)).toThrow(/Overlapping essential physical gestures/);
});
