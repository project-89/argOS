import { SitcomPlayback, sitcomAudienceMessages, sitcomFactLines, sitcomFrameAt, sitcomContactLabel, sitcomMessageLabel, sitcomThoughtActor, sitcomThoughtAge } from "../sitcom-presentation";
import type { SitcomFrame } from "../sitcom-report";

const segment = (version: number, start: number, end: number, sourceId = "one-world") => ({ version, sourceId, sourceStartSimMs: start, sourceEndSimMs: end });
function frame(atSimMs: number, thought = "A thought I actually authored"): SitcomFrame {
  return { sourceId: "one-world", atSimMs, tick: 1, running: true, provenance: { cognition: "fixture", h3: false, evolution: false, outsideText: "operator" },
    actors: [{ name: "Elaine", id: 5, room: "Kitchen", latestThought: { text: thought, atSimMs, sequence: 1 }, attention: [], body: null, speaking: false }],
    facts: { cookieContainer: "Orange tin", cookieConsumed: false, cookieConsumedBy: null, tin: "closed", phoneContainer: "Kitchen counter", unread: 1, buzzes: 1 }, phone: [], droppedEvents: 0 };
}
const message = (id: number, direction: string, text: string, status: string, createdMs: number) => ({ id, direction, text, status, createdMs, deliveredMs: status === "delivered" ? createdMs + 200 : -1, readMs: -1, replyTo: -1 });

test("a stalled film preserves pending own messages and hides future replies and drafts", () => {
  const scene=frame(1000),latest=frame(10000);
  latest.phone=[message(1,"in","Hello","read",2000),message(2,"out","On my way","delivered",7000),message(3,"out","Private draft","typing",9000)];
  const before=JSON.stringify(latest);
  expect(sitcomAudienceMessages(latest,scene)).toEqual([expect.objectContaining({id:1,status:"awaiting scene",readMs:-1})]);
  expect(sitcomAudienceMessages(latest,latest).map(m=>m.id)).toEqual([1,2]);
  expect(sitcomAudienceMessages(latest,undefined)).toHaveLength(1);
  expect(sitcomAudienceMessages(latest,scene)).toHaveLength(1); // Film overlay remains source-aligned.
  expect(JSON.stringify(latest)).toBe(before);
});
test("thought age uses the displayed source clock, not wall time or invented fresh monologue", () => {
  expect(sitcomThoughtAge({atSimMs:13000},135500)).toBe("Last articulated thought · 122s ago in scene");
  expect(sitcomThoughtAge({atSimMs:135500},13000)).toBe("No authored thought in this scene");
});

test("actual first/continuation durations explicitly retime committed source windows", () => {
  const t = new SitcomPlayback(); t.register(segment(1, 0, 8500)); t.register(segment(2, 8500, 17000));
  t.add({ chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  t.add({ chunk_index: 1, prompt_version: 2, playback_seconds: 8.5 });
  expect(t.at(5.0625)).toMatchObject({ state: "mapped", sourceMs: 4250, version: 1, sourceRate: 8.5 / 10.125 });
  expect(t.at(10.125)).toMatchObject({ state: "mapped", sourceMs: 8500, version: 2, sourceRate: 1 });
  expect(t.at(18.625)).toMatchObject({ state: "buffering" });
});
test("out of order metadata cannot advance through a missing chunk", () => {
  const t = new SitcomPlayback(); t.register(segment(1, 0, 8500)); t.register(segment(2, 8500, 17000));
  t.add({ chunk_index: 1, prompt_version: 2, playback_seconds: 8.5 }); expect(t.at(0).state).toBe("buffering");
  t.add({ chunk_index: 0, prompt_version: 1, playback_seconds: 8.5 }); expect(t.at(10)).toMatchObject({ sourceMs: 10000 });
  expect(t.add({ chunk_index: 1, prompt_version: 1, playback_seconds: 1 })).toBe(false);
});
test("repeated prompts hold source end and never fabricate new events or rewind time", () => {
  const t = new SitcomPlayback(); t.register(segment(1, 0, 8500)); t.register(segment(2, 8500, 17000));
  for (const [chunk_index, prompt_version] of [[0, 1], [1, 1], [2, 2]]) t.add({ chunk_index, prompt_version, playback_seconds: 8.5 });
  expect(t.at(12)).toMatchObject({ state: "held", sourceMs: 8500, sourceRate: 0 });
  expect(t.at(18)).toMatchObject({ state: "mapped", sourceMs: 9500, version: 2 });
});
test.each([segment(2, 9000, 17500), segment(2, 8500, 17000, "restored-world")])("source gaps and restored identities fail closed", next => {
  const t = new SitcomPlayback(); t.register(segment(1, 0, 8500)); t.register(next);
  t.add({ chunk_index: 0, prompt_version: 1, playback_seconds: 8.5 }); t.add({ chunk_index: 1, prompt_version: 2, playback_seconds: 8.5 });
  expect(t.at(9)).toEqual({ state: "unmapped", reason: "source_discontinuity" });
});
test("unknown versions and invalid payloads never acquire guessed source mapping", () => {
  const t = new SitcomPlayback(); t.add({ chunk_index: 0, prompt_version: 99, playback_seconds: 8.5 });
  expect(t.at(1)).toEqual({ state: "unmapped", reason: "unknown_prompt_version" });
  expect(t.register(segment(1, 5, 4))).toBe(false); expect(t.add({ chunk_index: -1, prompt_version: 1, playback_seconds: 8 })).toBe(false);
  expect(t.add({ chunk_index: 3, prompt_version: 1, playback_seconds: NaN })).toBe(false);
});
test("issued windows are immutable and cannot silently be relabeled", () => {
  const t = new SitcomPlayback(), original = segment(1, 0, 8500); expect(t.register(original)).toBe(true); original.sourceEndSimMs = 9000;
  expect(t.register(original)).toBe(false); const issued = t.issued(); issued[0].sourceEndSimMs = 1; expect(t.issued()[0].sourceEndSimMs).toBe(8500);
});
test("a thought or physical state from the future is not substituted when a prior frame is unavailable", () => {
  const before = frame(1000), after = frame(5000, "I have now read the secret"), revised = frame(1000, "Same-time committed update");
  expect(sitcomFrameAt([after], 2000)).toBeUndefined();
  expect(sitcomFrameAt([before, after], 2000)?.actors[0].latestThought?.text).toBe(before.actors[0].latestThought?.text);
  expect(sitcomFrameAt([after, before, revised], 2000)?.actors[0].latestThought?.text).toBe("Same-time committed update");
});
test("own outside texts appear immediately but remote read status and replies wait for displayed source", () => {
  const old = frame(1000), latest = frame(10000), displayed = frame(6000);
  latest.phone = [message(1, "in", "Who is this?", "read", 2000), message(2, "out", "I can see you too", "delivered", 7000)];
  expect(sitcomAudienceMessages(latest, old)).toEqual([expect.objectContaining({ id: 1, status: "awaiting scene", readMs: -1 })]);
  displayed.phone = [message(1, "in", "Who is this?", "delivered", 2000), message(2, "out", "I can see you too", "queued", 6000)];
  expect(sitcomAudienceMessages(latest, displayed)).toEqual([expect.objectContaining({ id: 1, status: "delivered" })]);
  expect(sitcomAudienceMessages(latest, latest).map(m => m.id)).toEqual([1, 2]);
});
test("world fact labels use committed consumption rather than a stale object location", () => {
  const f = frame(1000); f.facts.cookieConsumed = true; f.facts.cookieConsumedBy = "George";
  expect(sitcomFactLines(f)[0]).toBe("Cookie · eaten by George");
  expect(sitcomFactLines(undefined)).toEqual(["Waiting for a committed scene"]);
});

test("contact routing is immutable message metadata, including legacy unknown senders", () => {
  expect(sitcomContactLabel(undefined)).toBe("Unknown sender");
  expect(sitcomContactLabel({ name: "Alex", relationship: "unknown" })).toBe("Alex");
  expect(sitcomMessageLabel({ direction: "out", contact: { name: "Alex", relationship: "boyfriend" } })).toBe("Elaine → Alex · boyfriend");
  expect(sitcomMessageLabel({ direction: "in" })).toBe("Unknown sender → Elaine");
});

test("contact snapshots do not expose an undelivered reply while source timing catches up", () => {
  const past = frame(1000), current = frame(10000), contact = { name: "Alex", relationship: "boss", context: "A private work question" };
  current.phone = [{ ...message(1, "in", "Call me", "read", 2000), contact }, { ...message(2, "out", "After dinner", "delivered", 7000), contact }];
  const shown = sitcomAudienceMessages(current, past);
  expect(shown).toHaveLength(1); expect(shown[0]).toMatchObject({ status: "awaiting scene", contact });
  expect(sitcomMessageLabel(shown[0])).toBe("Alex · boss → Elaine");
});

test("share composition fallback uses a real actor's thought and keeps a selected thought when one exists", () => {
  const scene = frame(1000), elaine = scene.actors[0];
  const jerry = { ...elaine, id: 2, name: "Jerry" as const, latestThought: { text: "Why is my tin open?", sequence: 2, atSimMs: 2000 } };
  scene.actors.push(jerry);
  expect(sitcomThoughtActor(scene, "Elaine")).toBe(elaine);
  elaine.latestThought = null;
  expect(sitcomThoughtActor(scene, "Elaine")).toBe(jerry);
  expect(sitcomThoughtActor(undefined, "Elaine")).toBeUndefined();
});

test("a 30-minute continuous stream retains its early and late committed mappings", () => {
  const t = new SitcomPlayback();
  for (let index = 0; index < 300; index++) {
    expect(t.register(segment(index + 1, index * 8500, (index + 1) * 8500))).toBe(true);
    expect(t.add({ chunk_index: index, prompt_version: index + 1, playback_seconds: 8.5 })).toBe(true);
  }
  expect(t.at(1799.5)).toMatchObject({ state: "mapped", sourceMs: 1799500 });
  expect(t.at(1)).toMatchObject({ state: "mapped", sourceMs: 1000 });
  expect(t.at(2300)).toMatchObject({ state: "mapped", sourceMs: 2300000 });
});

test("full bounded metadata retention still accepts identical issued windows from state polls", () => {
  const t = new SitcomPlayback();
  for (let index = 0; index < 1024; index++) t.register(segment(index + 1, index * 8500, (index + 1) * 8500));
  expect(t.register(segment(1, 0, 8500))).toBe(true);
  expect(t.register(segment(1025, 1024 * 8500, 1025 * 8500))).toBe(false);
});
