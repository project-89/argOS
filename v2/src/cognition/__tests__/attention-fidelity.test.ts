import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { agentThink } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { recordCommittedSpeech, getSocialDialogue } = await import("../social-memory");
const { clearTimedSpeech } = await import("../timed-speech");
const { advanceSimulationTimeline, clearSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { setAttentionProvider, readAttention, foregroundPriorityFor, backgroundPriorityFor, attentionCadenceOpen, ATTENTION_CADENCE_MS } = await import("../../runtime/attention");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");

const worlds: ReturnType<typeof createArgosWorld>[] = [];
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Attention tests stay offline"));
});
afterEach(() => {
  for (const world of worlds.splice(0)) { clearTimedSpeech(world); clearSimulationTimeline(world); stopCommittedEvents(world); }
  drainPendingStimuli(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});
function fixture(fastReplies = true) {
  const world = createArgosWorld("Attention"); initializePrefabs(world); worlds.push(world); startCommittedEvents(world);
  world.meta.aiEnabled = true; world.meta.fastReplies = fastReplies;
  const room = createRoomEntity(world, { name: "Hall" });
  const ada = createAgentEntity(world, { name: "Ada", role: "repairer", systemPrompt: "You are Ada. Blunt, exact, privately frightened of knocks at night.", roomId: room });
  const wren = createAgentEntity(world, { name: "Wren", role: "visitor", systemPrompt: "A stranger.", roomId: room });
  return { world, room, ada, wren, registry: createSystemRegistry() };
}
const reply = (content: string) => ({ text: JSON.stringify({ control: { version: 2, purpose: "Answer the stranger", goalId: null, localDependencies: [] },
  action: { type: "speak", target: "Wren", content }, innerThought: "Who is this?" }) });

describe("observer attention", () => {
  test("without a provider everyone is present; priorities are unchanged", () => {
    const f = fixture();
    expect(readAttention(f.world, f.ada)).toEqual({ tier: "presence" });
    expect(foregroundPriorityFor(f.world, f.ada)).toBe("high");
    expect(backgroundPriorityFor(f.world, f.ada, "high")).toBe("high");
    expect(attentionCadenceOpen(f.world, f.ada, new Map([[f.ada, 0]]), false)).toBe(true);
  });
  test("addressed first, then presence, periphery, offstage; offstage minds decide less often", () => {
    const f = fixture(), tiers = new Map<number, any>();
    setAttentionProvider(f.world, eid => tiers.get(eid) ?? { tier: "presence" });
    tiers.set(f.ada, { tier: "offstage" });
    expect(foregroundPriorityFor(f.world, f.ada)).toBe("low");
    expect(backgroundPriorityFor(f.world, f.ada, "high")).toBe("low");
    const last = new Map([[f.ada, 0]]);
    advanceSimulationTime(f.world, 1, ATTENTION_CADENCE_MS.offstage - 100);
    expect(attentionCadenceOpen(f.world, f.ada, last, false)).toBe(false);
    expect(attentionCadenceOpen(f.world, f.ada, last, true)).toBe(true); // something demands attention
    tiers.set(f.ada, { tier: "periphery" });
    expect(foregroundPriorityFor(f.world, f.ada)).toBe("normal");
    tiers.set(f.ada, { tier: "presence", addressedByObserver: true });
    expect(foregroundPriorityFor(f.world, f.ada)).toBe("critical");
  });
});

describe("fast reply to direct address", () => {
  test("someone spoken to directly answers from a lean conversational prompt, through normal admission", async () => {
    const f = fixture();
    recordCommittedSpeech(f.world, f.wren, "Hello there. I'm new in town — what's your name?", "Ada");
    generate.mockResolvedValueOnce(reply("Ada. And you're standing in my light."));
    const action = await agentThink(f.world, f.ada);
    const request = generate.mock.calls[0][0];
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain('Wren just said to you: "Hello there. I\'m new in town — what\'s your name?"');
    expect(prompt).not.toContain("It's your move");
    expect(request.system).toContain("WHO YOU ARE:");
    expect(request.system).toContain("privately frightened of knocks");
    expect(request.system.length).toBeLessThan(8000);
    expect(action).toMatchObject({ type: "speak", target: "Wren", content: "Ada. And you're standing in my light." });
  });
  test("once answered, or when the world has not opted in, decisions use the full prompt", async () => {
    const f = fixture(false);
    recordCommittedSpeech(f.world, f.wren, "Hello?", "Ada");
    generate.mockResolvedValueOnce(reply("What?"));
    await agentThink(f.world, f.ada);
    expect(generate.mock.calls[0][0].messages[0].content).toContain("It's your move");

    const g = fixture();
    recordCommittedSpeech(g.world, g.wren, "Hello?", "Ada");
    recordCommittedSpeech(g.world, g.ada, "Yes?", "Wren", Date.now() + 1);
    advanceSimulationTimeline(g.world, 100, { integrate: () => {} });
    expect(getSocialDialogue(g.world, g.ada).some(t => t.own)).toBe(true);
    generate.mockResolvedValueOnce(reply("Still here."));
    await agentThink(g.world, g.ada);
    expect(generate.mock.calls[1][0].messages[0].content).toContain("It's your move");
  });
});
