/** Offline contract test: the model's authored tool choices are scripted here.
 * This proves genre-neutral library wiring, not live generation quality. */
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));

const { query } = await import("bitecs");
const { createSimulationFromPrompt } = await import("../index");
const { Agent, Name, Room, PhysicalObject } = await import("../ecs/components");
const { getRoomForEntity } = await import("../ecs/location");
const { getCoreDrives } = await import("../cognition/goal-learning");
const { getIdentityAnchors } = await import("../cognition/narrative-memory");
const { buildAgentContext } = await import("../cognition/agent-mind");
const { getStoryScaffold } = await import("../nle/story-scaffold");
const { getWorldSpecification, getWorldAuthoringContext } = await import("../world/world-specification");

const styles = [
  { genre: "coastal mystery", seed: "A fogbound fishing village with a missing lighthouse keeper.",
    room: "Net loft", other: "Harbour", actor: "Esme", role: "net mender", prop: "Salt-stained ledger",
    drive: "Protect my neighbours without concealing the truth", memory: "PRIVATE_PAST: My brother returned in a storm because I kept the light burning." },
  { genre: "domestic comedy", seed: "An affectionate comedy about neighbours preparing a disastrous communal dinner.",
    room: "Shared kitchen", other: "Courtyard", actor: "Dev", role: "amateur cook", prop: "Recipe notebook",
    drive: "Make people feel welcome even when I make mistakes", memory: "PRIVATE_PAST: My grandmother welcomed the whole street to our tiny kitchen." },
  { genre: "orbital survival", seed: "An orbital greenhouse crew must preserve life while an aging station fails.",
    room: "Greenhouse", other: "Airlock", actor: "Rin", role: "botanist", prop: "Seed tray",
    drive: "Keep living things alive without sacrificing my crew", memory: "PRIVATE_PAST: I grew the first flower my younger sister ever saw." },
];
let oldKey: string | undefined;
let simulation: Awaited<ReturnType<typeof createSimulationFromPrompt>> | undefined;

beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-fixture-not-a-key";
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline genesis contract test"));
});
afterEach(async () => {
  simulation?.stop();
  await simulation?.drainPendingOperations(1000);
  simulation = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(styles)("$genre uses the same God authoring path with private character history", async style => {
  const authoredCalls: string[] = [];
  generate.mockImplementation(async input => {
    if (input.tools) {
      expect(JSON.stringify(input.messages)).toContain(style.seed);
      const calls: any[] = [], results: any[] = [];
      const call = async (toolName: string, parameters: any) => {
        const id = `authored:${calls.length}`;
        const output = await input.tools[toolName].execute(parameters, {});
        expect(output.success).toBe(true);
        authoredCalls.push(toolName);
        calls.push({ toolName, toolCallId: id, input: parameters });
        results.push({ toolCallId: id, output });
      };
      await call("createRoom", { name: style.room, description: `A lived-in ${style.room.toLowerCase()}.` });
      await call("createRoom", { name: style.other });
      await call("createAgent", { name: style.actor, role: style.role, roomName: style.room,
        systemPrompt: "Choose according to your own concerns and what you actually perceive.",
        past: { background: `I have lived and worked in this ${style.genre} setting for years.`, drives: [style.drive],
          memories: [{ period: "Years ago", recollection: style.memory, emotionalTone: "affection", importance: .8,
            meaning: "Care takes practical effort", selfBelief: "I can help without controlling others", cues: ["family", "care"],
            provenance: "authored-history" }] } });
      await call("createAgent", { name: "Neighbour", role: "visitor", roomName: style.room,
        systemPrompt: "You have your own limited knowledge." });
      await call("createObject", { name: style.prop, roomName: style.room, traits: ["examinable"] });
      return { text: "Authored fixture", steps: [{ toolCalls: calls, toolResults: results }] };
    }
    if (input.messages?.some((message: any) => String(message.content).includes("master storyteller"))) {
      expect(JSON.stringify(input.messages)).toContain(style.seed);
      return { text: JSON.stringify({ tensions: [{ id: "unfinished", description: style.seed, involvedNpcs: [style.actor], beats: [] }],
        npcRoles: [{ name: style.actor, role: "protagonist", secrets: ["SPECULATIVE_SECRET_NOT_OWNED"], hiddenMotivation: "Advisory only" }] }) };
    }
    // The real God tool also requests aspirations asynchronously. No network.
    return { text: '{"aspirations":[]}' };
  });

  simulation = await createSimulationFromPrompt(style.seed, { enableSpirits: false, evolution: false,
    codingDaemons: false, enableServer: false, narrativeMind: true, experienceReconsideration: true });
  const world = simulation.world;
  const actors = [...query(world, [Agent])];
  const actor = actors.find(id => Name.value[id] === style.actor)!;
  const peer = actors.find(id => Name.value[id] === "Neighbour")!;
  expect(authoredCalls).toEqual(["createRoom", "createRoom", "createAgent", "createAgent", "createObject"]);
  expect([...query(world, [Room])]).toHaveLength(2);
  expect([...query(world, [PhysicalObject])].map(id => Name.value[id])).toContain(style.prop);
  expect(Name.value[getRoomForEntity(world, actor)!]).toBe(style.room);
  expect(getCoreDrives(world, actor)).toEqual([style.drive]);
  expect(getIdentityAnchors(world, actor)[0].monologue).toContain(style.memory);
  expect(buildAgentContext(world, actor)).toContain(style.memory);
  expect(buildAgentContext(world, peer)).not.toContain("PRIVATE_PAST");
  expect(buildAgentContext(world, actor)).not.toContain("SPECULATIVE_SECRET_NOT_OWNED");
  expect(getStoryScaffold(world)?.seed).toBe(style.seed);
  expect(getStoryScaffold(world)?.npcRoles[0].secrets).toEqual(["SPECULATIVE_SECRET_NOT_OWNED"]);
  expect(simulation.getRuntimeServices().find(service => service.id === "npc-cognition")?.enabled).toBe(true);
  expect(simulation.running).toBe(false);
});

test("genesis rejects empty prose instead of presenting it as a constructed world", async () => {
  generate.mockResolvedValue({ text: "A beautiful imaginary world exists.", steps: [] });
  await expect(createSimulationFromPrompt("An empty stage", { enableSpirits: false, evolution: false,
    codingDaemons: false, enableNarrativeEngine: false, enableServer: false }))
    .rejects.toThrow(/world-integrity gate: 0 agents, 0 rooms, 0 objects/);
});

test.each(styles)("$genre shared specification reaches God and scaffold and privately seeds the named actor", async style => {
  let godCalls = 0, scaffoldCalls = 0;
  const past = { background: `PRIVATE_PAST: I have lived in ${style.room} for years.`, drives: [style.drive],
    memories: [{ period: "Years ago", recollection: style.memory, emotionalTone: "affection", importance: .8,
      meaning: "Care takes practical effort", selfBelief: "I can help without controlling others", cues: ["family"],
      provenance: "authored-history" as const }] };
  generate.mockImplementation(async input => {
    if (input.tools) {
      godCalls++;
      const prompt = JSON.stringify({ system: input.system, messages: input.messages });
      expect(prompt).toContain(style.genre); expect(prompt).toContain(style.memory);
      expect(prompt).toContain("STYLE_GUIDANCE"); expect(prompt).toContain("OBSERVED_DISCOVERY");
      const results: any[] = [];
      for (const [toolName, parameters] of [
        ["createRoom", { name: style.room }],
        // God omits past: existing NPC creation uses the exact named private seed.
        ["createAgent", { name: style.actor, role: style.role, roomName: style.room, systemPrompt: "Choose freely." }],
        ["createAgent", { name: "Neighbour", role: "visitor", roomName: style.room, systemPrompt: "You have your own concerns." }],
        ["createObject", { name: style.prop, roomName: style.room, traits: ["examinable"] }],
      ] as const) {
        const output = await input.tools[toolName].execute(parameters, {});
        expect(output.success).toBe(true); results.push({ toolCallId: `seed:${results.length}`, output });
      }
      return { text: "Created", steps: [{ toolCalls: [], toolResults: results }] };
    }
    if (input.messages?.some((message: any) => String(message.content).includes("master storyteller"))) {
      scaffoldCalls++;
      const prompt = JSON.stringify(input.messages);
      expect(prompt).toContain("STYLE_GUIDANCE"); expect(prompt).toContain(style.genre);
      expect(prompt).not.toContain("PRIVATE_PAST");
      return { text: JSON.stringify({ tensions: [], npcRoles: [] }) };
    }
    return { text: '{"aspirations":[]}' };
  });
  simulation = await createSimulationFromPrompt(style.seed, { enableSpirits: false,
    worldSpecification: { version: 1, setting: { name: style.room, genre: style.genre, premise: style.seed, tone: "grounded" },
      story: { style: "STYLE_GUIDANCE: motives create possibilities, not commanded reactions" },
      inhabitants: [{ name: style.actor, role: style.role, startRoom: style.room, past }],
      discovery: ["OBSERVED_DISCOVERY: clues must actually be encountered"], opportunities: ["An optional place to rest"],
    } });
  expect(godCalls).toBe(1); expect(scaffoldCalls).toBe(1);
  expect(simulation.world.meta).toMatchObject({ narrativeMind: true, experienceReconsideration: true, timedActions: true, timedSpeech: true });
  expect(simulation.getCodingStatus()).toBeNull(); expect(simulation.getEvolutionStatus().enabled).toBe(false);
  expect(simulation.getWorldConstructionStatus().limit).toBe(200);
  expect(getWorldSpecification(simulation.world)?.setting.genre).toBe(style.genre);
  expect(getWorldAuthoringContext(simulation.world)).not.toContain("PRIVATE_PAST");
  const actors = [...query(simulation.world, [Agent])];
  const actor = actors.find(id => Name.value[id] === style.actor)!, peer = actors.find(id => Name.value[id] === "Neighbour")!;
  expect(getCoreDrives(simulation.world, actor)).toEqual([style.drive]);
  expect(getIdentityAnchors(simulation.world, actor)[0].monologue).toContain(style.memory);
  expect(buildAgentContext(simulation.world, peer)).not.toContain("PRIVATE_PAST");
  expect(buildAgentContext(simulation.world, actor)).not.toContain("OBSERVED_DISCOVERY");
});
