import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { SpatialDemo } = await import("../spatial-demo");
const { Name } = await import("../../ecs/components");
const { getNarrativeHistory } = await import("../../cognition/narrative-memory");
const { getCommittedEvents } = await import("../../runtime/committed-events");
const { peekPendingStimuli } = await import("../../cognition/stimulus-queue");
const { interviewSystemPrompt } = await import("../spatial-interview");

let d: import("../spatial-demo").SpatialDemo;
beforeEach(async () => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Interview checks are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  d = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false });
  await d.start();
});
afterEach(() => { d?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const leon = () => d.actors.find(id => Name.value[id] === "Leon")!;
const leonKey = () => d.snapshot().actors.find(a => a.name === "Leon")!.key;

test("mode instructions: a stranger in a quiet moment, or a candid analysis", () => {
  expect(interviewSystemPrompt("CONTEXT", "in_character")).toMatch(/^CONTEXT\n\nTHIS MOMENT: A stranger has found you alone in a quiet moment[\s\S]*lie to protect your secrets/);
  expect(interviewSystemPrompt("CONTEXT", "analysis")).toMatch(/You are in analysis mode[\s\S]*what you are hiding and why[\s\S]*first person, still in your own voice/);
});

test("an in-character interview uses the resident's real private context and keeps a per-session transcript, off the record", async () => {
  generate.mockResolvedValueOnce({ text: '{"reply": "The sea keeps its own books, stranger.", "mood": "guarded"}' })
    .mockResolvedValueOnce({ text: "Nothing I can tell you." });
  const history = getNarrativeHistory(d.sim.world, leon(), { limit: 200 }).length, events = getCommittedEvents(d.sim.world).events.length;
  const first = await d.interview({ actorKey: leonKey(), text: "What happened to the Marrow Star?", mode: "in_character", sessionId: "s-1" });
  expect(first).toEqual({ reply: "The sea keeps its own books, stranger.", mood: "guarded", sessionId: "s-1" });
  const call = generate.mock.calls[0][0];
  expect(call.system).toMatch(/^You are Leon/);
  expect(call.system).toMatch(/WHAT YOU HIDE/); // his own secret is part of his own context
  expect(call.system).toMatch(/A stranger has found you alone/);
  expect(call.tools).toBeUndefined();
  const second = await d.interview({ actorKey: leonKey(), text: "Who paid it?", mode: "in_character", sessionId: "s-1", remember: false });
  expect(second.reply).toBe("Nothing I can tell you.");
  expect(generate.mock.calls[1][0].messages).toEqual([
    { role: "user", content: "What happened to the Marrow Star?" },
    { role: "assistant", content: "The sea keeps its own books, stranger." },
    { role: "user", content: "Who paid it?" }]);
  // Off the record: no memory, no world action, no perception.
  expect(getNarrativeHistory(d.sim.world, leon(), { limit: 200 })).toHaveLength(history);
  expect(getCommittedEvents(d.sim.world).events).toHaveLength(events);
  expect(peekPendingStimuli(leon(), d.sim.world)).toEqual([]);
  // A session belongs to one resident.
  const mara = d.snapshot().actors.find(a => a.name === "Mara")!.key;
  await expect(d.interview({ actorKey: mara, text: "Hello", mode: "in_character", sessionId: "s-1" })).rejects.toThrow(/one resident/);
});

test("analysis works while the world is paused; only an in-character conversation can be remembered, as a private lived experience", async () => {
  d.pause();
  generate.mockResolvedValueOnce({ text: '{"reply": "I told the Three Hooks story so nobody would ask about the cargo.", "mood": "ashamed"}' });
  const analysis = await d.interview({ actorKey: leonKey(), text: "Why did you tell the legend at the inquest?", mode: "analysis", sessionId: "a-1" });
  expect(analysis.reply).toMatch(/cargo/);
  expect(generate.mock.calls[0][0].system).toMatch(/You are in analysis mode/);
  await expect(d.interview({ actorKey: leonKey(), text: "Remember this", mode: "analysis", sessionId: "a-1", remember: true })).rejects.toThrow();
  const before = getNarrativeHistory(d.sim.world, leon(), { limit: 200 }).length;
  generate.mockResolvedValueOnce({ text: '{"reply": "You ask a lot for a stranger.", "mood": "wary"}' });
  const kept = await d.interview({ actorKey: leonKey(), text: "Do you sleep well?", mode: "in_character", sessionId: "c-1", remember: true });
  expect(kept).toMatchObject({ reply: "You ask a lot for a stranger.", remembered: true });
  const after = getNarrativeHistory(d.sim.world, leon(), { limit: 200 });
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)).toMatchObject({ kind: "experience", evidence: [expect.objectContaining({ kind: "dialogue",
    content: expect.stringContaining("Do you sleep well?") })] });
  expect(after.at(-1)!.monologue).toMatch(/A stranger found me alone/);
  expect(d.snapshot().paused).toBe(true);
});
