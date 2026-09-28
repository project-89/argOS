import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { Appearance, ObjectState, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { createObjectEntity } from "../../ecs/prefabs";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { CommittedSceneHistory } from "../../rendering/committed-scene-history";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector, type SitcomDirectorResult, type SitcomRenderSegment } from "../sitcom-director";

let apartment: ApartmentSitcom | undefined, director: SitcomDirector | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Director tests are offline")); });
afterEach(() => {
  director?.stop(); apartment?.stop(); director = undefined; apartment = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function fixture(windowMs?: number) {
  apartment = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null });
  director = new SitcomDirector(apartment, { windowMs, ...(windowMs && windowMs < 5000 ? { wholeUtterances: false } : {}) });
  return { t: apartment, d: director };
}
function segment(result: SitcomDirectorResult): SitcomRenderSegment {
  if (!("segment" in result)) throw new Error(`Expected a lived segment: ${JSON.stringify(result)}`);
  return result.segment;
}

test("open-plan phone sound is audible offscreen without revealing private device data or moving the camera",async()=>{
  apartment=await ApartmentSitcom.create({live:false,outsideTextAtMs:null});const t=apartment;
  director=new SitcomDirector(t,{scheduling:"realtime",promptStyle:"direct"});
  await t.start();t.text("PRIVATE AUDIO CONTENT");t.advance(10125);
  const script=segment(director.next()).script;
  expect(script.prompt).toContain('audible from offscreen in "Kitchen"');
  expect(script.prompt).not.toContain("PRIVATE AUDIO CONTENT");
  for(const [i,beat]of script.beats.entries())if(beat.kind==="sound") {
    expect(beat.audibleRoomIds).toEqual(expect.arrayContaining([t.ids.kitchen,t.ids.living]));
    expect(script.performance.coverage).toContainEqual({beat:i,disposition:"prompted"});
  }
  expect(script.directedIntervals?.every(i=>i.roomId===t.ids.living)).toBe(true);
  const sounds=director.checkpoint().sounds;expect(JSON.stringify(sounds)).not.toContain("PRIVATE AUDIO CONTENT");
  expect(sounds[0].audibleRoomIds).toContain(t.ids.living);
});

test("realtime director uses exact contiguous clocks, retains off-camera evidence and buffers instead of stretching a tail",async()=>{
  apartment=await ApartmentSitcom.create({live:false,outsideTextAtMs:null});
  const t=apartment;director=new SitcomDirector(t,{scheduling:"realtime",promptStyle:"direct"});const d=director;
  await t.start();t.advance(10124);expect(d.next()).toEqual({buffering:true});
  t.advance(1);const first=segment(d.next());
  expect(first.performance).toMatchObject({clock:"realtime",durationMs:10125,sourceMap:[{mediaMs:0,sourceMs:0},{mediaMs:10125,sourceMs:10125}]});
  expect(first.prompt).not.toContain('SET "Street"');
  expect(d.next()).toEqual({segment:first});
  t.advance(8500);const next=segment(d.next(first.version));
  expect(next.sourceStartSimMs).toBe(10125);expect(next.sourceEndSimMs).toBe(18625);
  expect(next.performance!.sourceMap).toEqual([{mediaMs:0,sourceMs:10125},{mediaMs:8500,sourceMs:18625}]);
  t.advance(2000);expect(d.next(next.version)).toEqual({buffering:true});t.stop();
  const ended = d.next();
  expect(ended).toMatchObject({ended:true,unfilmedTail:{reason:"incomplete_realtime_tail",sourceStartSimMs:18625,sourceEndSimMs:20625}});
  expect(ended).not.toHaveProperty("reason");
  expect(d.next()).toEqual(ended);
  expect(d.status()).toMatchObject({sourceCursorSimMs:18625,unfilmedTail:{sourceEndSimMs:20625}});
  expect(d.snapshot()).toHaveLength(2);
});

test("native parallel-room speech stays in the realtime evidence ledger without becoming a word queue",async()=>{
  apartment=await ApartmentSitcom.create({live:false,outsideTextAtMs:null});const t=apartment;
  director=new SitcomDirector(t,{scheduling:"realtime",promptStyle:"direct"});const d=director;
  await t.start();t.dispatch("George",{type:"move",target:"Kitchen"});t.advance(3000);
  t.dispatch("George",{type:"speak",content:"The kitchen cookie belongs to me."});
  t.dispatch("Jerry",{type:"speak",content:"We can discuss dinner in this room."});
  t.advance(10000);const first=segment(d.next());
  const words=first.script.beats.filter(b=>b.kind==="speech");
  expect(words.some(b=>b.actorName==="George")).toBe(true);expect(words.some(b=>b.actorName==="Jerry")).toBe(true);
  const george=first.script.beats.findIndex(b=>b.kind==="speech"&&b.actorName==="George");
  expect(first.script.performance.coverage).toContainEqual({beat:george,disposition:"off_camera"});
  expect(first.prompt).not.toContain("The kitchen cookie belongs to me.");
  expect(first.prompt).toContain("We can discuss dinner in this room.");
  expect(first.sourceEndSimMs).toBe(10125);expect(first.script.performance.endingSilenceMs).toBe(0);
});

test("local renderer checkpoint retains already issued public sounds and restorable scene evidence", async () => {
  const {t,d}=await fixture(); await t.start(); t.text("PRIVATE_CHECKPOINT_MESSAGE"); t.advance(12000);
  const first=segment(d.next()); t.advance(12000); d.next(first.version); t.stop();
  const checkpoint=d.checkpoint();
  expect(checkpoint.sounds.some(s=>s.atSimMs<first.sourceEndSimMs)).toBe(true);
  expect(JSON.stringify(checkpoint)).not.toContain("PRIVATE_CHECKPOINT_MESSAGE");
  const restored=CommittedSceneHistory.restore(checkpoint.history);
  expect(restored.bounds().sourceId).toBe(d.status().sourceId);
  expect(restored.bounds().availableStartSimMs).toBe(0);
});

test("stopped document reading closes its interval and permits the sealed final cut", async () => {
  apartment = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" });
  const t = apartment;
  director = new SitcomDirector(t);
  const d = director;
  await t.start(); t.advance(119000);
  let version = 0;
  for (let i = 0; i < 30; i++) {
    const next = d.next(version); if (!("segment" in next)) break; version = next.segment.version;
  }
  t.dispatch("Jerry", { type: "interact", target: "Evening notes", content: "read_document" });
  const pending = getCommittedEvents(t.sim.world).events.at(-1)!;
  expect(pending).toMatchObject({ operation: "reading", status: "pending", atSimMs: 119000, expectedEndSimMs: 120200 });
  t.advance(1000); t.stop();
  expect(getCommittedEvents(t.sim.world).events.filter(e => e.executionId === pending.executionId).map(e => e.status)).toEqual(["pending", "failed"]);
  for (let i = 0; i < 30; i++) {
    const next = d.next(version);
    if (!("segment" in next)) { expect(next).toMatchObject({ ended: true }); break; }
    version = next.segment.version;
  }
  expect(d.status().reason).toBeNull();
  expect(d.status().sourceCursorSimMs).toBe(120000);
});

test("a pre-start director budgets the full 10.125-second opening before issuing it", async () => {
  const { t, d } = await fixture();
  expect(d.next()).toEqual({ buffering: true }); await t.start();
  t.advance(10124); expect(d.next()).toEqual({ buffering: true });
  t.advance(1); const first = segment(d.next());
  expect(first).toMatchObject({ version: 1, sourceId: getCommittedEvents(t.sim.world).sourceId, sourceStartSimMs: 0, sourceEndSimMs: 10125,
    performance: { durationMs: 10125 } });
  expect(first.prompt.length).toBeLessThanOrEqual(50_000);
  for (const name of t.characters) expect(first.prompt).toContain(`CAST "${name}"`);
  expect(first.prompt).toContain('SET "Living Room"'); expect(first.prompt).toContain('SET "Kitchen"');
  expect(first.prompt).not.toContain('Last black-and-white cookie');
  expect(first.prompt.length).toBeLessThan(6000);
});

test("one outstanding segment requires its exact acknowledgement; repeated or unknown versions cannot skip lived time", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(18_625);
  const first = segment(d.next());
  expect(d.next()).toEqual({ segment: first }); expect(d.next(999)).toEqual({ segment: first });
  const second = segment(d.next(first.version));
  expect(second).toMatchObject({ version: 2, sourceStartSimMs: 10125, sourceEndSimMs: 18625, performance: { durationMs: 8500 } });
  expect(d.next(first.version)).toEqual({ segment: second });
  expect(d.next(second.version)).toEqual({ buffering: true });
  const issued = d.snapshot();
  expect(issued).toHaveLength(2); expect(Object.isFrozen(issued)).toBe(true); expect(Object.isFrozen(issued[0])).toBe(true);
  expect(issued[0]).not.toHaveProperty("prompt");
  expect(Object.isFrozen(first)).toBe(true);
});

test("an earlier requested clip uses its historical room/phone state, never Elaine's later arrival or pickup", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(10125);
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  const early = segment(d.next());
  expect(early.prompt).toContain('"Elaine" in "Living Room"');
  expect(early.prompt).toContain('at Kitchen counter in Kitchen');
  expect(early.script.beats).toHaveLength(0);
  const frozenPrompt = early.prompt;
  t.advance(4700); const later = segment(d.next(early.version));
  expect(later.prompt).toContain('"Elaine" enters "Kitchen" from "Living Room"');
  expect(later.prompt).toContain('pick up "Elaine\'s phone" from "Kitchen counter"');
  expect(later.prompt).not.toContain('"Kitchen counter" is no longer visible');
  expect(early.prompt).toBe(frozenPrompt);
});

test("progressive speech is partitioned into exact half-open windows with no future words or duplicate dialogue", async () => {
  const { t, d } = await fixture(1000); await t.start();
  t.dispatch("Jerry", { type: "speak", content: "one two SECRETSUFFIX ending" }); t.advance(3000);
  const first = segment(d.next()), second = segment(d.next(first.version)), third = segment(d.next(second.version));
  const words = (value: SitcomRenderSegment) => value.script.beats.filter(b => b.kind === "speech").map(b => b.text);
  expect(words(first)).toEqual(["one"]); expect(first.prompt).not.toContain("SECRETSUFFIX");
  expect(words(second)).toEqual(["two SECRETSUFFIX ending"]); expect(words(third)).toEqual([]);
  const speech = first.script.beats.find(b => b.kind === "speech")!;
  expect(speech.actorId).toBe(t.ids.Jerry); expect(speech.direction).toContain('"Jerry"'); expect(speech.evidence.length).toBeGreaterThan(0);
  expect(first.prompt).not.toContain("expectedEndSimMs");
});

test("only actually emitted typed phone sounds enter their own windows; message bodies and thoughts remain private", async () => {
  const { t, d } = await fixture(1000); await t.start();
  t.plantThought("Elaine", "PRIVATE_THOUGHT_NEVER_RENDER");
  t.text("PRIVATE_MESSAGE_NEVER_RENDER"); t.advance(1000);
  const first = segment(d.next());
  expect(first.script.beats.filter(b => b.kind === "sound")).toEqual([expect.objectContaining({ atSimMs: 200, roomId: t.ids.kitchen })]);
  expect(first.prompt).toContain('at "Kitchen counter"'); expect(first.prompt).toContain("One double phone vibration");
  expect(first.prompt).not.toContain("PRIVATE_THOUGHT_NEVER_RENDER"); expect(first.prompt).not.toContain("PRIVATE_MESSAGE_NEVER_RENDER");
  t.advance(1000); const second = segment(d.next(first.version)); expect(second.script.beats.filter(b => b.kind === "sound")).toEqual([]);
});

test("a lived phone interaction reaches the camera as reading and typing, never undifferentiated inspecting", async () => {
  const { t, d } = await fixture(1000); await t.start(); const id = t.text("PRIVATE_PHONE_BODY");
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(400); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "PRIVATE_REPLY_BODY" })}` });
  t.advance(400); t.advance(1200); t.advance(400);
  const issued: SitcomRenderSegment[] = [];
  for (let i = 0; i < 7; i++) issued.push(segment(d.next(issued.at(-1)?.version)));
  const directions = issued.flatMap(s => s.script.beats).filter(b => b.kind === "action").map(b => b.direction).join("\n");
  expect(directions).toContain('reads "Elaine\'s phone" silently'); expect(directions).toContain("show finger movement on its input surface");
  expect(directions).toContain("finishes reading"); expect(directions).toContain("finishes typing");
  const interactions = issued.flatMap(s => s.script.beats).filter(b => ["reading", "typing"].includes(b.operation ?? "") && b.endSimMs! > b.atSimMs);
  expect(interactions.length).toBeGreaterThan(2); // Includes continuation windows with no new start event.
  expect(interactions.every(b => b.targetVisual?.name === "Elaine's phone")).toBe(true);
  for (const value of issued) for (const secret of ["PRIVATE_PHONE_BODY", "PRIVATE_REPLY_BODY", "replyTo"])
    expect(value.prompt).not.toContain(secret);
});

test("a four-minute busy apartment renders every source interval through phone pickup, read, reply and dialogue", async () => {
  const { t, d } = await fixture(); await t.start();
  let last: SitcomRenderSegment | undefined;
  const scripts: SitcomRenderSegment[] = [];
  let message: number | undefined;
  for (let tick = 0; tick < 480; tick++) {
    const ms = t.elapsedMs;
    if (ms === 25000) message = t.text("PRIVATE_STRESS_MESSAGE");
    if (ms === 35000) t.dispatch("Elaine", { type: "move", target: "Kitchen" });
    if (ms === 39000) t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" });
    if (ms === 42500) t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
    if (ms === 47000) t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: message, text: "PRIVATE_STRESS_REPLY" })}` });
    if (tick % 20 === 0) t.dispatch(tick % 40 === 0 ? "Jerry" : "George", { type: "speak", content: `We can discuss item ${tick} after you put that down.` });
    t.advance(500);
    // Like the real transport, the camera trails the world. No AI/provider calls.
    if (tick % 34 === 33) {
      const next = d.next(last?.version);
      if (!("segment" in next)) throw new Error(JSON.stringify({ next, diagnostics: d.status() }));
      last = next.segment; scripts.push(last);
    }
  }
  t.stop();
  while (true) {
    const next = d.next(last?.version);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    last = next.segment; scripts.push(last);
  }
  expect(scripts.length).toBeGreaterThanOrEqual(16);
  expect(scripts.at(-1)!.sourceEndSimMs).toBeGreaterThanOrEqual(225000);
  scripts.forEach((s, i) => expect(s.sourceStartSimMs).toBe(i ? scripts[i - 1].sourceEndSimMs : 0));
  expect(Math.max(...scripts.map(s => s.prompt.length))).toBeLessThan(12000);
  expect(scripts.map(s => s.prompt).join("\n")).not.toContain("PRIVATE_STRESS");
  expect(scripts.some(s => s.prompt.includes("show finger movement on its input surface"))).toBe(true);
  const speech = scripts.flatMap(s => s.script.beats).filter(b => b.kind === "speech");
  const evidence = speech.flatMap(b => b.evidence); expect(new Set(evidence).size).toBe(evidence.length);
});

test("a sealed simulation drains complete lived windows and ends without synthesizing a partial final clip", async () => {
  const { t, d } = await fixture(1000); await t.start(); t.advance(2500); t.stop();
  const first = segment(d.next()), second = segment(d.next(first.version));
  expect(second.sourceEndSimMs).toBe(2000); expect(d.next(second.version)).toEqual({ ended: true });
  expect(d.next()).toEqual({ ended: true }); expect(d.snapshot()).toHaveLength(2);
});

test("an explicit director stop prevents issuance even while its simulation remains live", async () => {
  const { t, d } = await fixture(1000); await t.start(); t.advance(1000); d.stop();
  expect(d.next()).toEqual({ ended: true }); expect(t.running).toBe(true); t.advance(1000);
});

test("a replaced public source cannot serve an outstanding old-source segment", async () => {
  const { t, d } = await fixture(1000); await t.start(); t.advance(1000);
  const first = segment(d.next()); stopCommittedEvents(t.sim.world); startCommittedEvents(t.sim.world);
  expect(d.next()).toEqual({ ended: true, reason: "source_changed" }); expect(d.snapshot()[0].sourceId).toBe(first.sourceId);
});

test("room identity replacement ends the camera interval instead of joining unrelated room lifetimes", async () => {
  const { t, d } = await fixture(1000); await t.start();
  // Physical public identity assignment is explicit in this adversarial edit.
  t.dispatch("Jerry", { type: "speak", content: "Hello" }); t.advance(500);
  WorkingMemoryIdentity.id[t.ids.living] = "another-room-lifetime"; t.advance(500);
  const result = d.next(); expect(result).toHaveProperty("ended", true);
});

test("invalid window sizes fail before attaching or advancing a world", async () => {
  const { t, d } = await fixture(); d.stop();
  for (const windowMs of [0, -1, NaN, Infinity, 30_001]) expect(() => new SitcomDirector(t, { windowMs })).toThrow();
  expect(t.elapsedMs).toBe(0);
});

test("a full 30-minute apartment backlog drains from its opening without losing immutable source windows or leaking texts", async () => {
  const { t, d } = await fixture(); await t.start(); t.text("PRIVATE_LONG_RUN_MESSAGE");
  for (let tick = 0; tick < 21; tick++) t.advance(500);
  const first = segment(d.next()), openingPrompt = first.prompt;
  for (let tick = 21; tick < 3600; tick++) t.advance(500);
  t.stop();
  expect(t.elapsedMs).toBe(1_800_000);
  expect(d.next()).toEqual({ segment: first }); expect(first.prompt).toBe(openingPrompt);
  let current = first, count = 1;
  while (true) {
    const next = d.next(current.version);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    expect(next.segment.sourceStartSimMs).toBe(current.sourceEndSimMs);
    expect(next.segment.prompt).not.toContain("PRIVATE_LONG_RUN_MESSAGE");
    current = next.segment; count++;
  }
  expect(count).toBe(1 + Math.floor((1_800_000 - 10125) / 8500));
  expect(d.snapshot()).toHaveLength(count); expect(current.sourceEndSimMs).toBe(1_795_125);
});

test("configured retention loss still ends the director instead of skipping a backlog", async () => {
  const { t, d } = await fixture(); d.stop();
  director = new SitcomDirector(t, { historyLimits: { maxCaptures: 2 } });
  await t.start(); t.advance(500); t.advance(8500);
  expect(director.next()).toEqual({ ended: true, reason: "expired" });
  expect(director.snapshot()).toEqual([]);
});

test("an opening thought-to-speech wait is not emitted as a two-second empty ten-second video", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(2000);
  t.dispatch("Jerry", { type: "speak", content: "So, I notice the bakery bag is empty, Elaine." });
  expect(d.next()).toEqual({ buffering: true }); t.advance(8500);
  const first = segment(d.next());
  expect(first.sourceStartSimMs).toBe(0); expect(first.sourceEndSimMs).toBeGreaterThanOrEqual(6260);
  expect(first.script.beats.some(b => b.kind === "speech")).toBe(true);
  expect(first.prompt).toContain("exactly 10.125 seconds of VIDEO");
  expect(first.performance?.durationMs).toBe(10125);
});

test("a media overflow splits at complete utterance boundaries, never across two chunks of words", async () => {
  const { t, d } = await fixture(); await t.start();
  const firstWords = "Just admit it George you took one look at that cookie and could not resist";
  t.dispatch("Elaine", { type: "speak", content: firstWords }); t.advance(7500);
  const secondWords = "You are fighting two battles here George her anger and his crumbs";
  t.dispatch("Jerry", { type: "speak", content: secondWords }); t.advance(12500);
  const first = segment(d.next()), next = segment(d.next(first.version));
  expect(first.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual([firstWords]);
  expect(next.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual([secondWords]);
  expect(next.sourceStartSimMs).toBe(first.sourceEndSimMs);
  for (const s of [first, next]) expect(s.script.performance.cues.every(c => c.endMs <= s.script.performance.durationMs - 500 + .001)).toBe(true);
});

test("an indivisible utterance too long for one media segment fails without advancing or omitting it", async () => {
  const { t, d } = await fixture(); await t.start();
  t.dispatch("Jerry", { type: "speak", content: Array(26).fill("word").join(" ") }); t.advance(25000);
  expect(d.next()).toMatchObject({ ended: true, reason: "performance_overflow" });
  expect(d.snapshot()).toHaveLength(0); expect(d.status().sourceCursorSimMs).toBe(0);
  expect(t.running).toBe(true);
});

test("5s performance fallback covers a punctuation-sparse line overlapping a phone read without losing words or splitting the gesture", async () => {
  const { t, d } = await fixture(); d.stop(); await t.start();
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.text("PRIVATE_BOUNDARY_MESSAGE"); t.advance(2000);
  director = new SitcomDirector(t, { scheduling: "performance", windowMs: 5000, openingMediaMs: 5000, continuationMediaMs: 5000 });
  const line = "Eight o'clock? That gives you plenty of time to savor the spoils of victory.";
  t.dispatch("Jerry", { type: "speak", content: line }); t.advance(3000);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(18000); t.stop();
  const scripts: SitcomRenderSegment[] = []; let version = 0;
  for (let i = 0; i < 10; i++) {
    const next = director.next(version);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    scripts.push(next.segment); version = next.segment.version;
  }
  const speech = scripts.flatMap(s => s.script.beats.filter(b => b.kind === "speech"));
  expect(speech.map(b => b.text).join(" ")).toBe(line);
  expect(speech.some(b => b.speechSlice?.ends === "word_boundary")).toBe(true);
  const evidence = speech.flatMap(b => [...b.evidence]);
  expect(new Set(evidence).size).toBe(evidence.length);
  expect(evidence.sort((a,b) => a-b)).toEqual(getCommittedEvents(t.sim.world).events
    .filter(e => e.kind === "speech" && e.status === "succeeded" && e.text).map(e => e.sequence).sort((a,b) => a-b));
  const reads = scripts.flatMap(s => s.script.beats.filter(b => b.operation === "reading" && b.endSimMs !== undefined));
  expect(reads).toHaveLength(1);
  for (const s of scripts) {
    expect(s.prompt).not.toContain("PRIVATE_BOUNDARY_MESSAGE");
    expect(s.performance?.durationMs).toBe(5000);
    for (const cue of s.script.performance.cues) {
      const b = s.script.beats[cue.beat];
      if (b.kind === "speech") expect(cue.endMs - cue.startMs + .001)
        .toBeGreaterThanOrEqual(Math.max(700, b.text!.split(/\s+/u).length / 2.5 * 1000 + 200));
      if (b.operation === "reading" && b.endSimMs !== undefined) expect(cue.endMs - cue.startMs + .001).toBeGreaterThanOrEqual(1800);
    }
  }
});

test("a live one-word opening prefix does not consume a full 5s packet", async () => {
  const { t, d } = await fixture(); d.stop(); await t.start();
  director = new SitcomDirector(t, { scheduling: "performance", windowMs: 5000, openingMediaMs: 5000, continuationMediaMs: 5000 });
  t.advance(4500); t.dispatch("Jerry", { type: "speak", content: "So, what's the grand itinerary with Alex tonight?" }); t.advance(500);
  expect(director.next()).toEqual({ buffering: true });
  expect(director.snapshot()).toHaveLength(0);
  t.advance(4500);
  const first = segment(director.next());
  expect(first.script.beats.filter(b => b.kind === "speech").map(b => b.text)).not.toEqual(["So,"]);
});

test("a short sealed tail still covers its completed last line rather than silently ending before it", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(10125); const opening = segment(d.next());
  t.dispatch("Jerry", { type: "speak", content: "I heard you." }); t.advance(2500); t.stop();
  const tail = segment(d.next(opening.version));
  expect(tail.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual(["I heard you."]);
  expect(d.next(tail.version)).toEqual({ ended: true });
});

test("a phone read crossing the nominal cut gets one complete visible insert, never two partial reads", async () => {
  const { t, d } = await fixture(); await t.start(); t.text("PRIVATE_BOUNDARY_MESSAGE");
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800); t.advance(5700);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
  t.advance(1200); t.advance(500);
  const first = segment(d.next());
  expect(first.sourceEndSimMs).toBeGreaterThan(10700);
  const reads = first.script.beats.filter(b => b.operation === "reading" && b.endSimMs !== undefined);
  expect(reads).toHaveLength(1); expect(reads[0]).toMatchObject({ atSimMs: 9500, endSimMs: 10700 });
  const cue = first.script.performance.cues[first.script.beats.indexOf(reads[0])];
  expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(1800 - .001);
  t.advance(9000); const next = segment(d.next(first.version));
  expect(next.script.beats.filter(b => b.operation === "reading")).toHaveLength(0);
});

test("performance scheduling records an incidental final prop delta without manufacturing another full video chunk", async () => {
  const { t, d } = await fixture(); d.stop(); director = new SitcomDirector(t, { scheduling: "performance" });
  await t.start(); t.advance(10125); const first = segment(director.next());
  ObjectState.current[t.ids.counter] = "dusty"; t.advance(620); t.stop();
  expect(director.next(first.version)).toEqual({ ended: true });
  expect(director.snapshot()).toHaveLength(1);
  expect(director.status()).toMatchObject({ sourceCursorSimMs: 10745, unfilmedTail: {
    sourceStartSimMs: 10125, sourceEndSimMs: 10745, reason: "incidental_continuity_only",
  } });
  expect(director.status().unfilmedTail!.evidence.length).toBeGreaterThan(0);
  expect(ObjectState.current[t.ids.counter]).toBe("dusty");
});

test("Tr9yXl's95s twenty-word speech uses explicit committed clause continuations when the whole turn cannot fit8.5s", async () => {
  const { t, d } = await fixture(); d.stop(); await t.start(); t.advance(84875);
  director = new SitcomDirector(t, { scheduling: "performance" }); t.advance(10125);
  const opening = segment(director.next()); expect(opening.sourceEndSimMs).toBe(95000);
  const elaine = "So what do I do? Do I text him back, or do I give him the absolute, stone-cold silent treatment?";
  const jerry = "You can't text back. A reply validates the eviction; silence is the only dignity left.";
  t.dispatch("Elaine", { type: "speak", content: elaine }); t.advance(8500);
  const first = segment(director.next(opening.version));
  const slice = first.script.beats.find(b => b.kind === "speech")!;
  expect(slice.speechSlice).toMatchObject({ starts: "new_utterance", ends: "phrase_boundary" });
  expect(slice.text).toMatch(/[?;,]$/); expect(first.prompt).not.toContain("silent treatment?");
  expect(first.prompt).toContain("utterance is not declared complete");
  t.advance(2500); t.dispatch("Jerry", { type: "speak", content: jerry }); t.advance(14000); t.stop();
  const scripts = [first]; let settled = first.version;
  for (let count = 0; count < 8; count++) {
    const next = director.next(settled);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    scripts.push(next.segment); settled = next.segment.version;
  }
  const speech = scripts.flatMap(s => s.script.beats.filter(b => b.kind === "speech"));
  expect(speech.map(b => b.text).join(" ")).toBe(`${elaine} ${jerry}`);
  const resumed = speech.filter(b => b.executionId === slice.executionId).slice(1);
  expect(resumed[0].speechSlice?.starts).toBe("resumes_utterance");
  expect(resumed.at(-1)?.speechSlice?.ends).toBe("utterance_complete");
  const evidence = speech.flatMap(b => [...b.evidence]); expect(new Set(evidence).size).toBe(evidence.length);
  const committed = getCommittedEvents(t.sim.world).events.filter(e => e.kind === "speech" && e.text && e.status === "succeeded");
  expect(evidence.sort((a, b) => a - b)).toEqual(committed.map(e => e.sequence).sort((a, b) => a - b));
  expect(scripts.every(s => s.script.performance.cues.every(c => c.endMs <= s.script.performance.durationMs - 500 + .001))).toBe(true);
});

test("l3KteW short replies pack into ending slack without repeating words, accelerating speech or inventing a turn ending", async () => {
  apartment = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" });
  const t = apartment; await t.start(); t.advance(32000);
  director = new SitcomDirector(t, { scheduling: "performance", openingMediaMs: 8500 });
  const lines = [
    "Well, there is no itinerary. He just canceled out of nowhere!",
    "Canceled? Just like that, out of the blue?",
    "Out of the blue! And then he says, 'Please don't leave Jerry's yet'!",
  ];
  t.dispatch("Elaine", { type: "speak", content: lines[0] }); t.advance(7000);
  t.dispatch("Jerry", { type: "speak", content: lines[1] }); t.advance(5500);
  t.dispatch("Elaine", { type: "speak", content: lines[2] }); t.advance(7500); t.stop();
  const scripts: SitcomRenderSegment[] = []; let version = 0;
  for (let i = 0; i < 6; i++) {
    const next = director.next(version);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    scripts.push(next.segment); version = next.segment.version;
  }
  // These same three lines occupied three 8.5s packets in the saved run.
  expect(scripts).toHaveLength(2);
  const speech = scripts.flatMap(s => s.script.beats.filter(b => b.kind === "speech"));
  expect(speech.map(b => b.text).join(" ")).toBe(lines.join(" "));
  expect(speech.some(b => b.speechSlice?.ends === "phrase_boundary")).toBe(true);
  expect(speech.some(b => b.speechSlice?.starts === "resumes_utterance")).toBe(true);
  const evidence = speech.flatMap(b => [...b.evidence]);
  expect(new Set(evidence).size).toBe(evidence.length);
  expect(evidence.sort((a, b) => a - b)).toEqual(getCommittedEvents(t.sim.world).events
    .filter(e => e.kind === "speech" && e.status === "succeeded" && e.text).map(e => e.sequence).sort((a, b) => a - b));
  for (const { script } of scripts) {
    expect(script.performance.endingSilenceMs).toBeGreaterThanOrEqual(499.999);
    for (const cue of script.performance.cues) {
      const beat = script.beats[cue.beat];
      if (beat.kind === "speech") expect(cue.endMs - cue.startMs + .001)
        .toBeGreaterThanOrEqual(Math.max(700, beat.text!.trim().split(/\s+/u).length / 2.5 * 1000 + 200));
    }
  }
});

test("axS1ql native typing completion in a sentence pause is automatically selected without dropping dialogue or the phone action", async () => {
  const { t, d } = await fixture(); d.stop(); await t.start();
  t.dispatch("Elaine", { type: "move", target: "Kitchen" });
  t.dispatch("Jerry", { type: "move", target: "Kitchen" }); t.advance(3000);
  const firstText = t.text("PRIVATE_FIRST_MESSAGE");
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
  t.advance(23000); t.text("PRIVATE_SECOND_MESSAGE"); t.advance(6199);
  // Attach immediately before the recorded 34.2s buzz; a prefix ending at the
  // 35s speech start is shorter than the director's minimum candidate interval.
  director = new SitcomDirector(t, { scheduling: "performance", openingMediaMs: 8500 });
  t.advance(801);
  const jerry = "A text? Two years and he couldn't even bother with a phone call?";
  const elaine = "Not even a phone call! Fourteen words, Jerry. Fourteen words to end two years!";
  t.dispatch("Jerry", { type: "speak", content: jerry }); t.advance(4500);
  const privateReply = "After two years you do this over a text?! No way. You owe me an explanation in person. Where are you?";
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: firstText, text: privateReply })}` });
  t.advance(3199); const first = segment(director.next());
  expect(first.sourceEndSimMs).toBe(36220.001);
  const frozenFirst = JSON.stringify(first);
  t.advance(801); t.dispatch("Elaine", { type: "speak", content: elaine }); t.advance(13000);
  const second = segment(director.next(first.version));
  expect(second.sourceEndSimMs).toBe(46065.001);
  expect(second.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual([
    "Two years and he couldn't even bother with a phone call?", "Not even a phone call!" ]);
  expect(second.script.beats.find(b => b.operation === "typing" && b.endSimMs !== undefined))
    .toMatchObject({ atSimMs: 39500, endSimMs: 46065 });
  t.stop(); const scripts = [first, second]; let settled = second.version;
  for (let count = 0; count < 8; count++) {
    const next = director.next(settled);
    if (!("segment" in next)) { expect(next).toEqual({ ended: true }); break; }
    scripts.push(next.segment); settled = next.segment.version;
  }
  const speech = scripts.flatMap(s => s.script.beats.filter(b => b.kind === "speech"));
  expect(speech.map(b => b.text).join(" ")).toBe(`${jerry} ${elaine}`);
  const expected = getCommittedEvents(t.sim.world).events.filter(e => e.kind === "speech" && e.text && e.status === "succeeded");
  const evidence = speech.flatMap(b => [...b.evidence]);
  expect(evidence).toEqual(expected.map(e => e.sequence)); expect(new Set(evidence).size).toBe(evidence.length);
  const typings = scripts.flatMap(s => s.script.beats.filter(b => b.operation === "typing" && b.endSimMs !== undefined));
  expect(typings).toHaveLength(1);
  const nativeTyping = getCommittedEvents(t.sim.world).events.filter(e => e.operation === "typing");
  expect(typings[0].evidence).toEqual(nativeTyping.map(e => e.sequence));
  for (const script of scripts) {
    expect(script.prompt).not.toContain(privateReply);
    expect(script.prompt).not.toContain("PRIVATE_FIRST_MESSAGE"); expect(script.prompt).not.toContain("PRIVATE_SECOND_MESSAGE");
    expect(script.script.performance.cues.every(c => c.endMs <= 8000 + .001)).toBe(true);
  }
  expect(JSON.stringify(first)).toBe(frozenFirst);
});

test.each(["pickup", "reading", "typing"] as const)("a final %s remains mandatory even beside unheld prop state changes", async operation => {
  const { t, d } = await fixture(); d.stop(); await t.start();
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  const id = t.text("PRIVATE_CRITICAL_PHONE_MESSAGE");
  if (operation !== "pickup") { t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800); }
  if (operation === "typing") { t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200); }
  director = new SitcomDirector(t, { scheduling: "performance" }); t.advance(10125);
  const first = segment(director.next());
  if (operation === "pickup") t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" });
  else t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: operation === "reading" ? "read_phone"
    : `reply ${JSON.stringify({ replyTo: id, text: "PRIVATE_REPLY" })}` });
  t.advance(operation === "pickup" ? 800 : operation === "reading" ? 1200 : 3000);
  ObjectState.current[t.ids.counter] = "dusty"; t.stop();
  const tail = segment(director.next(first.version));
  expect(tail.script.beats.some(b => b.kind === "action" && b.operation === operation)).toBe(true);
  expect(tail.prompt).not.toContain("PRIVATE_"); expect(director.status().unfilmedTail).toBeNull();
});

test("removing an unheld object is still a mandatory change, not a disposable continuity tail", async () => {
  const { t, d } = await fixture(); d.stop(); await t.start();
  director = new SitcomDirector(t, { scheduling: "performance" }); t.advance(10125);
  const first = segment(director.next()); removeEntity(t.sim.world, t.ids.counter); t.advance(620); t.stop();
  const tail = segment(director.next(first.version));
  expect(tail.script.beats.some(b => b.direction.includes("no longer visible") && b.depiction === "required")).toBe(true);
  expect(director.status().unfilmedTail).toBeNull();
});

test("stopping exactly when a phone read completes retains its final receipt and full gesture", async () => {
  const { t, d } = await fixture(); await t.start(); t.text("PRIVATE_FINAL_READ");
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800); t.advance(6325);
  const opening = segment(d.next());
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200); t.stop();
  const tail = segment(d.next(opening.version));
  expect(tail.sourceEndSimMs).toBe(11325);
  expect(tail.script.beats.some(b => b.operation === "reading" && b.endSimMs === 11325)).toBe(true);
  expect(tail.prompt).toContain("finishes reading"); expect(tail.prompt).not.toContain("PRIVATE_FINAL_READ");
  expect(d.next(tail.version)).toEqual({ ended: true });
});

test("a short point-state-only prefix waits for the following whole line instead of becoming an8.5second blank clip", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(10125); const opening = segment(d.next());
  Appearance.expression[t.ids.Elaine] = "concerned"; t.advance(3875);
  const words = "I thought we had plans for tonight but now I am really not sure";
  t.dispatch("Elaine", { type: "speak", content: words }); t.advance(4625);
  expect(d.next(opening.version)).toEqual({ buffering: true });
  expect(d.snapshot()).toHaveLength(1);
  t.advance(2500); const scene = segment(d.next());
  expect(scene.sourceStartSimMs).toBe(10125);
  expect(scene.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual([words]);
  expect(scene.prompt).toContain("concerned");
  expect(scene.script.performance.durationMs).toBe(8500);
  expect(scene.script.performance.endingSilenceMs).toBeLessThan(2500);
});

test("source stop captures the final interrupted utterance receipt and only its actually heard words", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(10125);
  const opening = segment(d.next());
  t.dispatch("Jerry", { type: "speak", content: "Did he give any explanation at all or was that literally the entire MISSING_END" });
  t.advance(2500); t.stop();
  const committed = getCommittedEvents(t.sim.world);
  const expected = committed.events.filter(e => e.kind === "speech" && e.text).map(e => e.text).join("").trim();
  const terminal = committed.events.at(-1)!;
  expect(terminal).toMatchObject({ action: "speak", status: "failed", completedAtSimMs: 12625 });
  expect(d.status().eventCursor).toBe(terminal.sequence);
  const tail = segment(d.next(opening.version)), lines = tail.script.beats.filter(b => b.kind === "speech");
  expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({ text: expected, interrupted: true });
  expect(tail.prompt).toContain("This speech is interrupted"); expect(tail.prompt).not.toContain("MISSING_END");
  expect(tail.sourceEndSimMs).toBe(12625); expect(d.next(tail.version)).toEqual({ ended: true });
});

test("world-grown ambient stimuli never become visual props or state-change instructions", async () => {
  const { t, d } = await fixture(); await t.start(); t.advance(10125); const opening = segment(d.next());
  const source = createObjectEntity(t.sim.world, { name: "Coffee aroma", roomId: t.ids.kitchen });
  addComponent(t.sim.world, source, Traits); Traits.active[source] = JSON.stringify(["ambient", "stimulus_source"]);
  const lamp = createObjectEntity(t.sim.world, { name: "ambient_sound_lamp", roomId: t.ids.kitchen });
  addComponent(t.sim.world, lamp, Traits); Traits.active[lamp] = JSON.stringify(["lightSource", "stimulus_source"]);
  t.advance(500); t.advance(8000); const next = segment(d.next(opening.version));
  expect(t.scenes().flatMap(s => s.props).map(p => p.id)).not.toContain(source);
  expect(next.prompt).not.toContain("Coffee aroma"); expect(next.prompt).toContain("ambient_sound_lamp");
});
