import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { Perception, WorkingMemoryIdentity } = await import("../../ecs/components");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { getAgentPerceptions } = await import("../../cognition/agent-mind");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { chronicle } = await import("../../cognition/simulation-chronicle");
const { setWorldSpecification } = await import("../../world/world-specification");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { createDaemonRegistry, createDaemonForAgent, queueNarrativeNudge, runDaemonSystem, buildDaemonPersona,
  readDaemonStoryLedger, buildDaemonWhisperPrompt, INNER_VOICE_INTENSITY } = await import("../agent-daemon");

const past = (background: string, drive: string) => ({ background, drives: [drive], memories: [{ recollection: `${background} I remember it.`,
  emotionalTone: "unease", importance: .9, selfBelief: "I must know", meaning: "Some debts are never paid", cues: ["sea"], period: "long ago", provenance: "authored-history" as const }] });
function fixture() {
  const world = createArgosWorld("Saltmere daemons"); initializePrefabs(world); startCommittedEvents(world);
  setWorldSpecification(world, { version: 1, setting: { name: "Saltmere", genre: "coastal mystery", premise: "Marks are appearing again.", tone: "uneasy warmth" },
    story: { style: "slow pressure" }, inhabitants: [
      { name: "Mara", role: "returning daughter", past: past("MARA_OWN_SECRET: Mother wrote, ask Leon what the sea was paid.", "Learn the truth about my father") },
      { name: "Leon", role: "old clerk", past: past("LEON_PRIVATE_SECRET: I buried the cargo.", "Keep my brother's name clean") },
    ] });
  const room = createRoomEntity(world, { name: "Lantern House" }), cafe = createRoomEntity(world, { name: "The Waking Gull" });
  const mara = createAgentEntity(world, { name: "Mara", role: "returning daughter", systemPrompt: "You are Mara, stubborn and tender.", roomId: room });
  const leon = createAgentEntity(world, { name: "Leon", role: "old clerk", systemPrompt: "You are Leon, careful with words.", roomId: cafe });
  createPersonalIntention(world, mara, "Find out what happened to my father's boat", 7);
  const spirits = createSpiritRegistry(world);
  const narrator = createSpirit(spirits, { name: "The Narrator", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Author", observationInterval: 20_000 })!;
  Object.assign(narrator.narrativeState!, { tension: 0.35, currentPhase: "rising",
    plotThreads: [
      { id: "t1", name: "What the sea was paid", description: "Mara circles Leon's silence about the Marrow Star.", participants: ["Mara", "Leon"], status: "active", tension: .5, events: [], startedAt: 0 },
      { id: "t2", name: "OTHER_THREAD_NOT_MARA", description: "Otis and the collector haggle.", participants: ["Otis"], status: "active", tension: .4, events: [], startedAt: 0 },
    ],
    dramaticQuestions: [{ question: "Will Mara confront Leon before his heart gives out?", participants: ["Mara", "Leon"] }, "Will Otis sell the logbook?"] });
  const registry = createDaemonRegistry(600_000); registry.innerVoice = true;
  const daemon = createDaemonForAgent(registry, world, mara)!; createDaemonForAgent(registry, world, leon);
  for (const d of registry.daemons.values()) d.lastObservation = Date.now();
  advanceSimulationTime(world, 1, 60_000);
  const perceptions = () => getAgentPerceptions(world, mara).map(id => ({ type: Perception.type[id], content: Perception.content[id], intensity: Perception.intensity[id] }));
  return { world, room, mara, leon, spirits, narrator, registry, daemon, perceptions };
}
beforeEach(() => { generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider calls in daemon tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("the whisper prompt carries the person's own life and the Narrator's threads about them, never another resident's secret", () => {
  const f = fixture();
  const persona = buildDaemonPersona(f.world, f.mara), ledger = readDaemonStoryLedger(f.spirits, "Mara")!;
  expect(persona).toMatchObject({ name: "Mara", goals: ["Find out what happened to my father's boat"], drives: expect.arrayContaining(["Learn the truth about my father"]) });
  expect(ledger.threads.map(t => t.name)).toEqual(["What the sea was paid"]);
  expect(ledger.questions).toEqual(["Will Mara confront Leon before his heart gives out?"]);
  const prompt = buildDaemonWhisperPrompt({ persona, ledger, idle: true, recentWhispers: ["You keep looking at the door."] });
  expect(prompt).toContain("You are Mara's daemon"); expect(prompt).toContain("MARA_OWN_SECRET");
  expect(prompt).toContain("Find out what happened to my father's boat"); expect(prompt).toContain("What the sea was paid");
  expect(prompt).toContain("Will Mara confront Leon"); expect(prompt).toContain("Second person, present tense");
  expect(prompt).toContain("Other people's secrets stay theirs"); expect(prompt).toContain("You keep looking at the door.");
  expect(prompt).toContain("waiting and idling");
  expect(prompt).not.toContain("LEON_PRIVATE_SECRET"); expect(prompt).not.toContain("OTHER_THREAD_NOT_MARA"); expect(prompt).not.toContain("Otis");
});

test("each daemon whispers on its own cadence as a private perception of meaningful intensity", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: "\"You could ask Leon tonight. You won't, will you.\"" });
  const result = await runDaemonSystem(f.world, f.registry, f.spirits);
  expect(result.whispers).toBe(2); // Mara and Leon each hear their own voice
  const prompts = generate.mock.calls.map(call => call[0].prompt as string);
  expect(prompts.find(p => p.startsWith("You are Mara's daemon"))).toContain("What the sea was paid");
  expect(prompts.find(p => p.startsWith("You are Leon's daemon"))).toContain("LEON_PRIVATE_SECRET");
  expect(prompts.find(p => p.startsWith("You are Mara's daemon"))).not.toContain("LEON_PRIVATE_SECRET");
  const stimuli = drainPendingStimuli(undefined, f.world).filter(s => s.targetEid === f.mara);
  expect(stimuli).toEqual([expect.objectContaining({ type: "daemon_whisper", modality: "cognitive", source: "inner_voice",
    content: "You could ask Leon tonight. You won't, will you.", intensity: INNER_VOICE_INTENSITY })]);
  expect(INNER_VOICE_INTENSITY).toBeCloseTo(0.6);
  // Transport diagnostics never carry the whisper text.
  const diagnostics = chronicle.getByType("daemon_inner_voice").filter(e => e.data.actorKey === WorkingMemoryIdentity.id[f.mara]);
  expect(diagnostics.at(-1)!.data).toMatchObject({ agent: "Mara", story: true, pulled: false });
  expect(JSON.stringify(diagnostics)).not.toContain("won't, will you");
  // Not again until the cadence elapses in simulated time.
  generate.mockClear();
  expect((await runDaemonSystem(f.world, f.registry, f.spirits)).whispers).toBe(0); expect(generate).not.toHaveBeenCalled();
  advanceSimulationTime(f.world, 2, 60_000); generate.mockResolvedValue({ text: "The letter is still in your coat." });
  expect((await runDaemonSystem(f.world, f.registry, f.spirits)).whispers).toBe(2);
  expect(generate.mock.calls[0][0].prompt).toContain("You could ask Leon tonight"); // told what it already said
});

test("without a model the inner voice is deterministic and drawn only from the person's own goals and drives", async () => {
  const f = fixture(); f.registry.useModel = false;
  await runDaemonSystem(f.world, f.registry, f.spirits);
  expect(generate).not.toHaveBeenCalled();
  const [whisper] = drainPendingStimuli(undefined, f.world).filter(s => s.targetEid === f.mara);
  expect(whisper.content).toMatch(/father's boat|truth about my father|Some debts/i);
  expect(whisper.content).not.toMatch(/Leon|sea was paid|Otis/);
});

test("a Narrator nudge is voiced by the daemon in the person's inner voice, once, with lifecycle receipts", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: "Leon flinched when you said the boat's name. Ask him again." });
  expect(queueNarrativeNudge(f.registry, "Mara", { type: "interact", action: "Ask Leon about the Marrow Star", reason: "The thread needs pressure",
    source: "narrator", priority: "high" }, { world: f.world, agentEid: f.mara })).toBe(true);
  const nudge = f.daemon.pendingNudges[0];
  await runDaemonSystem(f.world, f.registry, f.spirits);
  const pulled = generate.mock.calls.map(c => c[0].prompt as string).find(p => p.startsWith("You are Mara's daemon"))!;
  expect(pulled).toContain("The story is leaning Mara toward this"); expect(pulled).toContain("Ask Leon about the Marrow Star");
  expect(f.perceptions()).toEqual([{ type: "daemon_whisper", content: "Leon flinched when you said the boat's name. Ask him again.", intensity: INNER_VOICE_INTENSITY }]);
  expect(f.daemon.pendingNudges).toEqual([]);
  expect(chronicle.getByType("narrative_nudge_lifecycle").filter(e => e.data.nudgeId === nudge.id).map(e => e.data.stage))
    .toEqual(["queued", "converted", "perception_delivered"]);
  expect(getCommittedEvents(f.world).events).toEqual([]); // a whisper is never a public event
});

test("a voiced nudge falls back to its own wording on provider failure, and is dropped if its scope expires during inference", async () => {
  const f = fixture(); generate.mockRejectedValue(new Error("provider down"));
  queueNarrativeNudge(f.registry, "Mara", { type: "reflect", action: "The box in the Net House", reason: "", source: "narrator", priority: "normal" },
    { world: f.world, agentEid: f.mara });
  await runDaemonSystem(f.world, f.registry, f.spirits);
  expect(f.perceptions()).toEqual([{ type: "daemon_whisper", content: "It keeps coming back to you: The box in the Net House", intensity: INNER_VOICE_INTENSITY }]);
  const g = fixture();
  queueNarrativeNudge(g.registry, "Mara", { type: "reflect", action: "Stale pull", reason: "", source: "narrator", priority: "normal" }, { world: g.world, agentEid: g.mara });
  const nudge = g.daemon.pendingNudges[0];
  generate.mockReset().mockImplementation(async () => { stopCommittedEvents(g.world); startCommittedEvents(g.world); return { text: "Too late" }; });
  await runDaemonSystem(g.world, g.registry, g.spirits);
  expect(g.perceptions()).toEqual([]);
  expect(chronicle.getByType("narrative_nudge_lifecycle").filter(e => e.data.nudgeId === nudge.id).map(e => e.data.stage)).toEqual(["queued", "dropped"]);
});
