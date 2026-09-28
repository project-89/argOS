import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { Description, Name, ObjectState } = await import("../../ecs/components");
const { getRoomForEntity } = await import("../../ecs/location");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { drainPendingStimuli, peekPendingStimuli } = await import("../../cognition/stimulus-queue");
const { createSpatialNarrativeEvents, parseNarrativeEventCommand } = await import("../spatial-narrative-events");
const { getNarrativeHost } = await import("../../god/narrative-authority");
const { createSpiritRegistry, createSpirit, setGodAgent, getMessagesForGodAI } = await import("../../spirits/spirit-registry");
const { runSpiritCognition } = await import("../../spirits/spirit-cognition");
const { publishNarratorProse } = await import("../../spirits/narrator-spirit");
const { createGodAgent } = await import("../../god/god-agent");
const { initializeGodAutopilot, enqueueSpiritMessages, runGodAutopilotCycle } = await import("../../god/god-autopilot");
const { buildSpiritGrowthTools } = await import("../../god/spirit-authority");
const { SpatialDemo } = await import("../spatial-demo");
const { getSpiritSystemState } = await import("../../spirits/spirit-system");

beforeEach(() => {
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Narrative events are tested offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

function fixture(options: { limits?: { maxEvents: number; cooldownMs: number } } = {}) {
  const world = createArgosWorld("Saltmere events"); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 1000);
  const square = createRoomEntity(world, { name: "Square" }), house = createRoomEntity(world, { name: "Rook House" });
  const inside = createAgentEntity(world, { name: "Ada", role: "repairer", systemPrompt: "Ada.", roomId: house });
  const outside = createAgentEntity(world, { name: "Eli", role: "newcomer", systemPrompt: "Eli.", roomId: square });
  const lamp = createObjectEntity(world, { name: "Rook House lamp", description: "A reading lamp.", roomId: house });
  ObjectState.current[lamp] = "normal";
  const receipts: any[] = [], texts: Array<[number, string, string]> = [], placed: number[] = [];
  const events = createSpatialNarrativeEvents({ world, running: () => true, limits: options.limits,
    rooms: [{ id: square, key: workingMemoryEntityRef(world, square)!.key, outdoor: true }, { id: house, key: workingMemoryEntityRef(world, house)!.key, outdoor: false }],
    lamps: [{ id: lamp, key: workingMemoryEntityRef(world, lamp)!.key }],
    placeProp: (roomId, spec) => { const id = createObjectEntity(world, { name: spec.name, description: spec.description, roomId }); placed.push(id); return id; },
    sendPhoneText: (actor, text, from) => { texts.push([actor, text, from]); return true; },
    record: receipt => receipts.push(receipt) });
  return { world, square, house, inside, outside, lamp, events, receipts, texts, placed };
}
const heard = (actor: number, world: any) => peekPendingStimuli(actor, world).map(row => `${row.modality}:${row.content}`);

test("a sound is a real perception for those who could hear it, with a public receipt", () => {
  const f = fixture();
  const receipt = f.events.stage({ operation: "sound", place: "Square", sound: "three slow knocks from the direction of the water" });
  expect(receipt).toMatchObject({ status: "applied", operation: "sound", roomId: f.square, origin: "narrator" });
  expect(heard(f.outside, f.world)).toEqual(["auditory:You hear three slow knocks from the direction of the water."]);
  expect(heard(f.inside, f.world)).toEqual(["auditory:Faintly, from Square, you hear three slow knocks from the direction of the water."]);
  expect(f.receipts).toEqual([receipt]);
  expect(receipt.publicDetail).toContain("three slow knocks");
});

test("an indoor sound is heard only inside", () => {
  const f = fixture();
  expect(f.events.stage({ operation: "sound", place: "Rook House", sound: "three knocks at the door" }, "god").status).toBe("applied");
  expect(heard(f.inside, f.world)).toEqual(["auditory:You hear three knocks at the door."]);
  expect(heard(f.outside, f.world)).toEqual([]);
});

test("an arrival is a real, inspectable prop; its writing stays private to whoever reads it", () => {
  const f = fixture();
  const receipt = f.events.stage(JSON.stringify({ operation: "arrival", place: "Rook House", object: "Damp envelope",
    description: "A damp envelope, pushed under the door.", text: "ASK LEON WHAT THE SEA WAS PAID", sound: "a soft scrape at the door" }));
  expect(receipt).toMatchObject({ status: "applied", roomId: f.house, entityId: f.placed[0] });
  const prop = f.placed[0];
  expect(Name.value[prop]).toBe("Damp envelope"); expect(getRoomForEntity(f.world, prop)).toBe(f.house);
  expect(Description.value[prop]).toBe("A damp envelope, pushed under the door. There is writing on it.");
  expect(Description.value[prop]).not.toContain("ASK LEON");
  expect(receipt.publicDetail).not.toContain("ASK LEON"); expect(receipt.detail).toContain("ASK LEON"); // author-only
  expect(heard(f.inside, f.world)).toEqual(expect.arrayContaining(["auditory:You hear a soft scrape at the door."]));
  // A duplicate name is refused rather than shadowing an existing thing.
  f.world.time.elapsed += 30_000;
  expect(f.events.stage({ operation: "arrival", place: "Square", object: "Damp envelope", description: "Another damp envelope." }).status).toBe("rejected");
});

test("lights flicker or go out, and come back on by themselves", () => {
  const f = fixture();
  expect(f.events.stage({ operation: "lights", place: "Square", effect: "out" }).status).toBe("rejected"); // no lamp there
  const out = f.events.stage({ operation: "lights", place: "Rook House", effect: "out" });
  expect(out.status).toBe("applied"); expect(ObjectState.current[f.lamp]).toBe("unlit");
  expect(heard(f.inside, f.world)).toEqual(["visual:Rook House lamp flickers and goes out. The room drops into shadow."]);
  f.world.time.elapsed += 46_000; f.events.tick();
  expect(ObjectState.current[f.lamp]).toBe("normal"); expect(Description.value[f.lamp]).toBe("A reading lamp.");
  expect(f.receipts.at(-1)).toMatchObject({ status: "applied", detail: "Rook House lamp came back on by itself." });
});

test("a text from an unknown number lands on the phone; viewers see only that it buzzed", () => {
  const f = fixture();
  const receipt = f.events.stage({ operation: "phone_message", resident: "Ada", text: "Three knocks. Count them." });
  expect(receipt.status).toBe("applied");
  expect(f.texts).toEqual([[f.inside, "Three knocks. Count them.", "Unknown number"]]);
  expect(receipt.publicDetail).toBe("Ada's phone buzzes with a new message."); expect(receipt.publicDetail).not.toContain("Count them");
  f.world.time.elapsed += 30_000;
  expect(f.events.stage({ operation: "phone_message", resident: "Nobody", text: "Hello" }).status).toBe("rejected");
});

test("budget and cooldown: one event per 20s of world time, a bounded session total; invalid targets cost nothing", () => {
  const f = fixture({ limits: { maxEvents: 2, cooldownMs: 20_000 } });
  expect(f.events.stage({ operation: "sound", place: "Harbour", sound: "a bell" }).status).toBe("rejected");
  expect(f.events.stage({ operation: "sound", place: "Square", sound: "a bell from the water" }).status).toBe("applied");
  const early = f.events.stage({ operation: "sound", place: "Square", sound: "a second bell" });
  expect(early).toMatchObject({ status: "rejected" }); expect(early.detail).toContain("21000ms");
  f.world.time.elapsed += 20_000;
  expect(f.events.stage({ operation: "sound", place: "Square", sound: "a second bell" }).status).toBe("applied");
  f.world.time.elapsed += 60_000;
  expect(f.events.stage({ operation: "sound", place: "Square", sound: "a third bell" }).detail).toContain("budget is spent");
  expect(f.events.view()).toMatchObject({ events: 2, remainingEvents: 0 });
});

test("a stopped source or closed host changes nothing", () => {
  const f = fixture();
  stopCommittedEvents(f.world);
  expect(f.events.stage({ operation: "sound", place: "Square", sound: "a bell" }).status).toBe("rejected");
  expect(getNarrativeHost(f.world)).toBeUndefined(); expect(drainPendingStimuli()).toEqual([]);
});

test.each([["prose", "Make it rain"], ["unknown", { operation: "spawn", place: "Square" }], ["short", { operation: "sound", place: "Square", sound: "x" }],
  ["effect", { operation: "lights", place: "Square", effect: "explode" }]])("the catalogue rejects %s commands", (_kind, input) => {
  expect(parseNarrativeEventCommand(input)).toBeUndefined();
});

function narratorFixture() {
  const f = fixture(), entities = createEntityRegistry(), spirits = createSpiritRegistry(f.world);
  const narrator = createSpirit(spirits, { name: "The Narrator", domain: "narrative", rank: "archangel", model: "flash",
    systemPrompt: "Tell the story.", observationInterval: 1000, canInjectEvents: true });
  const other = createSpirit(spirits, { name: "Another voice", domain: "narrative", rank: "archangel", model: "flash",
    systemPrompt: "Tell the story.", observationInterval: 1000, canInjectEvents: true });
  f.events.grantNarrator(narrator);
  return { ...f, entities, spirits, narrator, other, run: (spirit = narrator) => runSpiritCognition(spirit, f.world, entities, spirits) };
}

test("the Narrator's worldEvent really happens, even though the world moved on during inference", async () => {
  const f = narratorFixture();
  let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run();
  expect(generate.mock.calls[0][0].prompt).toContain('{"operation":"sound","place":"<place>"');
  ObjectState.current[f.lamp] = "dusty"; f.world.time.elapsed += 5000; // unrelated change while thinking
  release({ text: JSON.stringify({ worldEvent: { operation: "sound", place: "Rook House", sound: "three knocks at the door" } }) });
  const output = await pending;
  expect(output.interventions[0]).toMatchObject({ type: "world_effect", result: "applied" });
  expect(heard(f.inside, f.world)).toEqual(["auditory:You hear three knocks at the door."]);
  expect(f.narrator.narrativeState!.ledger!.moves.at(-1)).toMatchObject({ kind: "event:sound", target: "Rook House", result: expect.stringContaining("applied") });
});

test("one world event per review; other spirits hold no event grant", async () => {
  const f = narratorFixture();
  generate.mockResolvedValueOnce({ text: JSON.stringify({
    intervention: { needed: true, type: "world_effect", targetType: "room", target: "Square", content: { operation: "sound", place: "Square", sound: "gulls go silent" } },
    worldEvent: { operation: "lights", place: "Rook House", effect: "flicker" } }) });
  const output = await f.run();
  expect(output.interventions.map(row => row.result)).toEqual(["applied", "rejected_one_event_per_review"]);
  generate.mockResolvedValueOnce({ text: JSON.stringify({ worldEvent: { operation: "sound", place: "Square", sound: "a bell" } }) });
  expect((await f.run(f.other)).interventions[0].result).toBe("rejected_no_event_grant");
  expect(f.events.view().events).toBe(1);
});

test("a Narrator request reaches God's autopilot, which stages the event with its own tool", async () => {
  const f = narratorFixture(), god = createGodAgent(f.world, { name: "God", worldName: "Saltmere events", narrative: "" });
  setGodAgent(f.spirits, god.eid); initializeGodAutopilot(god, { minRunIntervalMs: 0, minPriority: "normal" });
  generate.mockResolvedValueOnce({ text: JSON.stringify({ requests: [{ type: "create_event", target: "Rook House",
    action: "Three knocks at Rook House while Ada is alone", reason: "Ada's fear is the thread" }] }) });
  await f.run();
  const messages = getMessagesForGodAI(f.spirits);
  expect(messages).toEqual([expect.objectContaining({ priority: "high", data: expect.objectContaining({ source: "narrative_directive", directiveType: "create_event" }) })]);
  enqueueSpiritMessages(god, messages, () => "The Narrator");
  generate.mockImplementationOnce(async input => {
    expect(input.system).toContain("turn good requests into world");
    expect(JSON.stringify(input.messages)).toContain("The Narrator is asking you to make something happen");
    expect(JSON.stringify(input.messages)).toContain("Three knocks at Rook House while Ada is alone");
    expect(input.tools.createRoom).toBeUndefined();
    const output = await input.tools.stageNarrativeEvent.execute({ operation: "sound", place: "Rook House", sound: "three knocks at the door" }, {});
    return { text: "Three knocks at Rook House.", steps: [{ toolCalls: [{ toolCallId: "k", toolName: "stageNarrativeEvent", input: {} }], toolResults: [{ toolCallId: "k", output }] }] };
  });
  const result = await runGodAutopilotCycle(god);
  expect(result).toMatchObject({ ran: true, executed: true, messagesIncluded: 1 });
  expect(f.receipts.at(-1)).toMatchObject({ status: "applied", origin: "god", operation: "sound" });
  expect(heard(f.inside, f.world)).toEqual(["auditory:You hear three knocks at the door."]);
});

test("God's spirit toolset gains acting tools only where the world has hosts for them", () => {
  const f = fixture(), tools = buildSpiritGrowthTools(f.world, 0, {}, () => true);
  expect(Object.keys(tools).sort()).toEqual(["approveProposal", "getSpiritProposals", "placeStoryProp", "rejectProposal", "stageNarrativeEvent"]);
  f.events.close();
  expect(Object.keys(buildSpiritGrowthTools(f.world, 0, {}, () => true)).sort()).toEqual(["approveProposal", "getSpiritProposals", "rejectProposal"]);
});

test("Saltmere: story objects, phone texts and the story feed work in the real spatial world", async () => {
  const demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, automaticClock: false, seconds: 120 });
  try {
    await demo.start();
    const events = demo.narrativeEvents!;
    const arrival = events.stage({ operation: "arrival", place: "Lantern House", object: "Salt-stained note",
      description: "A salt-stained note, folded twice.", text: "He let them go out." }, "god");
    expect(arrival.status).toBe("applied");
    const note = demo.snapshot().entities.find(entity => entity.name === "Salt-stained note")!;
    expect(note).toMatchObject({ kind: "prop", asset: "paper", roomId: arrival.roomId });
    expect(demo.snapshot().townLife!.changes).toEqual(expect.arrayContaining([expect.objectContaining({ spirit: "God", status: "applied", summary: "Salt-stained note is now in Lantern House." })]));
    demo.advance(21_000);
    expect(events.stage({ operation: "phone_message", resident: "Mara", text: "Ask him about the cargo." }).status).toBe("applied");
    const mara = demo.snapshot().actors.find(actor => actor.name === "Mara")!;
    expect(mara.messages.at(-1)).toMatchObject({ from: "Unknown number", text: "Ask him about the cargo.", status: "delivered" });
    publishNarratorProse(demo.sim.world, { sourceId: demo.sourceId, atSimMs: demo.atSimMs, spirit: "The Narrator", text: "Mara's phone lights up on the table." });
    publishNarratorProse(demo.sim.world, { sourceId: "another-source", atSimMs: 0, spirit: "The Narrator", text: "Not this world." });
    expect(demo.snapshot().storyFeed).toEqual([expect.objectContaining({ text: "Mara's phone lights up on the table.", spirit: "The Narrator" })]);
    // Presentation only: prose never enters a resident's pending perceptions.
    for (const id of demo.actors) expect(JSON.stringify(peekPendingStimuli(id, demo.sim.world))).not.toContain("lights up on the table");
  } finally { demo.stop(); }
});

test("Saltmere's live-ready Narrator holds the event grant and its opening prompt stays compact", async () => {
  const demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: true, automaticClock: false, seconds: 60 });
  try {
    const state = getSpiritSystemState(demo.sim.world)!;
    const narrator = [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator")!;
    expect(getNarrativeHost(demo.sim.world)!.narrator).toBe(narrator);
    generate.mockResolvedValue({ text: "{}" });
    await runSpiritCognition(narrator, demo.sim.world, demo.sim.god.registry, state.registry, [], state.globalContext);
    const { system, prompt } = generate.mock.calls.at(-1)![0];
    expect(system).toContain("What the Sea Was Paid");
    expect(prompt).toContain("=== THE CAST — author's eyes only ===");
    expect(prompt).toContain("phone_message");
    expect(system.length + prompt.length).toBeLessThan(32_000); // ≈ 8k tokens
  } finally { demo.stop(); }
});
