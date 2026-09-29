import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { query, addComponent, addEntity } = await import("bitecs");
const { SpatialDemo } = await import("../../demo/spatial-demo");
const { Goal, Memory, Name, Plan, Position } = await import("../../ecs/components");
const { HasMemory } = await import("../../ecs/relations");
const { getRoomForEntity } = await import("../../ecs/location");
const { setAttentionProvider } = await import("../attention");
const { getCommittedEvents } = await import("../committed-events");
const { installOffstageLife, getOffstageStats, getOffstageLife, offstageForegroundReady, noteForegroundDecisionStarted, runOffstageDriver,
  runOffstageScene, hasDueOffstageScene, parseOffstageScene, trackOffstagePlaces } = await import("../offstage");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { setGoalContract, ensureGoalSignature, goalSignatureId } = await import("../../cognition/goal-contract");
const { createPlanEntity } = await import("../../cognition/planning-system");
const { recordCommittedSpeech, getSocialDialogue } = await import("../../cognition/social-memory");
const { getNarrativeHistory } = await import("../../cognition/narrative-memory");
const { snapshotAffect } = await import("../../cognition/affect-state");
const { recordAttentionSignal } = await import("../../cognition/unresolved-attention");
const { getSpiritSystemState, initializeSpiritSystem, createStandardHierarchy } = await import("../../spirits/spirit-system");
const { getForegroundCognitionReadiness } = await import("../../cognition/idle-cognition");
const { serializeProceduralSkillV1 } = await import("../../cognition/procedural-skills");

type Tier = "presence" | "periphery" | "offstage";
let d: Awaited<ReturnType<typeof SpatialDemo.create>>;
let tiers: Map<number, Tier>;
let deliberating: Set<number>;
beforeEach(async () => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offstage checks are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  d = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false });
  await d.start();
  tiers = new Map(); deliberating = new Set();
  // A deterministic observer: everyone is present unless a test sends them offstage.
  setAttentionProvider(d.sim.world, eid => ({ tier: tiers.get(eid) ?? "presence" }));
});
afterEach(() => { d?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

const w = () => d.sim.world;
const registry = () => d.sim.god.systemRegistry;
const named = (name: string) => d.actors.find(id => Name.value[id] === name)!;
const roomOf = (eid: number) => Name.value[getRoomForEntity(w(), eid)!];
const offstage = (...names: string[]) => { for (const name of names) tiers.set(named(name), "offstage"); };
const install = (config: Record<string, unknown> = {}) => installOffstageLife(w(), { config: { driverIntervalMs: [200, 200], ...config },
  isDeliberating: eid => deliberating.has(eid) });
/** Drive the fast loop: offstage step, then one 100 ms world tick. */
function run(ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) { runOffstageDriver(w(), registry()); d.advance(100); if (until?.()) return i; }
  return ticks;
}
const offstageRows = () => d.snapshot().events.filter(e => e.kind === "offstage").map(e => e.text);
const sceneReply = (value: unknown) => ({ text: JSON.stringify(value) });
function customGoal(eid: number, description: string, progress = 0, priority = 50) {
  const goal = createIntentGoal(w(), eid, description, 9)!;
  Goal.priority[goal] = priority; Goal.progress[goal] = progress;
  return goal;
}

describe("offstage foreground gate", () => {
  test("offstage minds think only once per genuinely new urgent cause; presence minds are unchanged", () => {
    install(); offstage("Mara", "Ivo");
    const mara = named("Mara"), eli = named("Eli");
    expect(offstageForegroundReady(w(), eli)).toBe(true); // presence
    expect(offstageForegroundReady(w(), mara)).toBe(false); // no urgent cause: no cadence loop
    tiers.set(mara, "periphery");
    expect(offstageForegroundReady(w(), mara)).toBe(true); // periphery keeps its own cadence
    tiers.set(mara, "offstage");
    // Another offstage resident addressing her is the scene's business, not a live turn.
    recordCommittedSpeech(w(), named("Ivo"), "Mara, did you hear that knocking?", "Mara");
    expect(offstageForegroundReady(w(), mara)).toBe(false);
    // Someone live (in the observer's world) speaks to her directly: she may think, once.
    tiers.set(named("Ivo"), "periphery");
    expect(offstageForegroundReady(w(), mara)).toBe(true);
    noteForegroundDecisionStarted(w(), mara);
    expect(offstageForegroundReady(w(), mara)).toBe(false);
    expect(getOffstageStats(w())!.offstageForegroundAdmissions).toBe(1);
    tiers.set(named("Ivo"), "offstage");
    // A co-resident's routine act is the scene's business; a knock at the door is a summons.
    recordAttentionSignal(w(), mara, { source: "Ivo", signalKey: "ivo-hides-something", content: "Ivo puts something into the box." });
    expect(offstageForegroundReady(w(), mara)).toBe(false);
    recordAttentionSignal(w(), mara, { source: "Lantern House door", signalKey: "knock-1", content: "Three knocks at the door of Lantern House." });
    expect(offstageForegroundReady(w(), mara)).toBe(true);
    noteForegroundDecisionStarted(w(), mara);
    expect(offstageForegroundReady(w(), mara)).toBe(false);
  });
});

describe("offstage driver", () => {
  test("walks an offstage resident to her scheduled place by real pathfinding, never a live, possessed or deliberating body", () => {
    install(); offstage("Mara", "Ivo", "Leon");
    const mara = named("Mara"), ivo = named("Ivo"), leon = named("Leon"), eli = named("Eli");
    deliberating.add(ivo); d.takeControl(d.snapshot().actors.find(a => a.id === leon)!.key);
    const leonAt = { x: Position.x[leon], y: Position.y[leon] }, eliAt = { x: Position.x[eli], y: Position.y[eli] };
    expect(roomOf(mara)).toBe("Lantern House"); // her evening routine is on the Common
    let maxStep = 0, last = { x: Position.x[mara], y: Position.y[mara] };
    run(900, () => {
      maxStep = Math.max(maxStep, Math.hypot(Position.x[mara] - last.x, Position.y[mara] - last.y)); last = { x: Position.x[mara], y: Position.y[mara] };
      return roomOf(mara) === "Saltmere Common";
    });
    expect(roomOf(mara)).toBe("Saltmere Common");
    expect(maxStep).toBeLessThan(0.5); // walked the route tick by tick, no teleport
    const stats = getOffstageStats(w())!;
    expect(stats.outcomes.schedule.started).toBeGreaterThanOrEqual(1);
    run(400, () => getOffstageStats(w())!.outcomes.schedule.succeeded > 0); // arrival at the room's entry
    expect(getOffstageStats(w())!.outcomes.schedule.succeeded).toBeGreaterThanOrEqual(1);
    const rows = offstageRows();
    expect(rows.some(r => r.startsWith("Mara (offstage, schedule): move Saltmere Common"))).toBe(true);
    for (const who of ["Ivo", "Leon", "Eli"]) expect(rows.some(r => r.startsWith(`${who} (`))).toBe(false);
    expect({ x: Position.x[leon], y: Position.y[leon] }).toEqual(leonAt);
    expect({ x: Position.x[eli], y: Position.y[eli] }).toEqual(eliAt);
  });

  test("a learned macro is preferred over the routine, and a stored plan step over the routine", () => {
    install(); offstage("Mara", "Ivo");
    const mara = named("Mara"), ivo = named("Ivo");
    // Mara has learned how to do this before: a compiled goal macro.
    const goal = customGoal(mara, "Check the nets are hung properly");
    const signature = ensureGoalSignature(w(), goal);
    expect(signature).toBeTruthy();
    const memory = addEntity(w()); addComponent(w(), memory, Memory); addComponent(w(), mara, HasMemory(memory));
    Memory.type[memory] = "procedural"; Memory.importance[memory] = .85; Memory.timestamp[memory] = Date.now();
    Memory.content[memory] = serializeProceduralSkillV1({ kind: "procedure_v1", signature: `goalid:${goalSignatureId(signature!)}|nets`,
      name: "Macro: check the nets", trigger: { affordance: "__goal_macro__" },
      steps: [{ type: "move", target: "The Net House" }, { type: "observe", target: "Net House supplies box" }],
      stats: { successes: 3, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } });
    // Ivo has a stored plan for his top goal.
    const errand = customGoal(ivo, "Return Leon's borrowed book");
    createPlanEntity(w(), ivo, errand, { goalDescription: "Return Leon's borrowed book", steps: [
      { description: "Walk over to Rook House", actionType: "move", target: "Rook House" }] } as any);
    run(10, () => offstageRows().length >= 2);
    const rows = offstageRows();
    expect(rows).toContain("Mara (offstage, learned): move The Net House");
    expect(rows).toContain("Ivo (offstage, plan): move Rook House");
  });
});

describe("offstage scene resolver", () => {
  function lanternScene(extra: Record<string, unknown> = {}) {
    const mara = named("Mara"), ivo = named("Ivo");
    const bench = customGoal(ivo, "Build a bench for the harbour", 80);
    const physical = customGoal(mara, "Be at the Net House");
    setGoalContract(w(), physical, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "The Net House" } });
    return { mara, ivo, bench, physical, reply: sceneReply({
      summary: "Ivo sanded the last slats of his bench while Mara read her mother's letter again and asked him, twice, what he saw at the Net House.",
      dialogue: [
        { speaker: "Mara", target: "Ivo", line: "You were out late on Tuesday. Did you pass the Net House?" },
        { speaker: "Nobody", line: "A voice from nowhere." },
        { speaker: "Ivo", target: "Mara", line: "I was fixing gutters, Mara. Hand me that plane?" },
      ],
      actions: [{ actor: "Ivo", type: "move", target: "Saltmere Common" }],
      goalProgress: [{ actor: "Ivo", goalId: bench, delta: 0.3, note: "Glued and clamped the last slat." },
        { actor: "Mara", goalId: physical, delta: 0.3, note: "Thought about going." }],
      build: [{ actor: "Ivo", goalId: bench, assetId: "harbour-bench", name: "Ivo's harbour bench", description: "A bench of salvaged decking, still smelling of glue." }],
      memories: [{ actor: "Mara", text: "Ivo wouldn't look at me when I asked about Tuesday." },
        { actor: "Ivo", text: "I nearly told her. I finished the bench instead.", feeling: { feeling: "guilty", valence: -0.4, arousal: 0.6 } }],
      ...extra }) };
  }

  test("applies heard dialogue, bounded progress, completion and a build through growth, memories, then real actions", async () => {
    install(); offstage("Mara", "Ivo");
    const { mara, ivo, bench, physical, reply } = lanternScene();
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    expect(hasDueOffstageScene(w())).toBe(false);
    d.advance(60_000); d.advance(30_000); // 90 simulated seconds of unobserved evening
    expect(hasDueOffstageScene(w())).toBe(true);
    generate.mockResolvedValueOnce(reply);
    const result = await runOffstageScene(w());
    expect(result).toMatchObject({ status: "applied", room: "Lantern House" });
    const request = generate.mock.calls[0][0] as any;
    expect(request.messages[0].content).toContain("Ivo"); expect(request.messages[0].content).toContain("Build a bench for the harbour");
    // Dialogue: remembered by both as heard turns; nobody elsewhere heard it.
    expect(getSocialDialogue(w(), mara).map(t => t.content)).toEqual(expect.arrayContaining(["I was fixing gutters, Mara. Hand me that plane?",
      "You were out late on Tuesday. Did you pass the Net House?"]));
    expect(getSocialDialogue(w(), ivo).some(t => !t.own && t.speaker === "Mara")).toBe(true);
    expect(getSocialDialogue(w(), named("Eli"))).toHaveLength(0);
    expect(getCommittedEvents(w()).events.filter(e => e.kind === "speech" && e.text).map(e => e.actorName)).toEqual(["Mara", "Ivo"]);
    // A line answered inside the scene does not wake an offstage mind.
    expect(offstageForegroundReady(w(), mara)).toBe(false);
    // Progress: custom goal advanced (capped by time), completed at 1.0; the physical contract untouched.
    expect(Goal.status[bench]).toBe("completed"); expect(Goal.progress[bench]).toBe(100);
    expect(Goal.progress[physical]).toBe(0); expect(Goal.status[physical]).toBe("active");
    // Build: through the validated growth path, in their room.
    const built = [...query(w(), [Name])].find(id => Name.value[id] === "Ivo's harbour bench");
    expect(built).toBeDefined(); expect(Name.value[getRoomForEntity(w(), built!)!]).toBe("Lantern House");
    const stats = getOffstageStats(w())!;
    expect(stats.builds).toEqual([expect.objectContaining({ actor: "Ivo", status: "built" })]);
    expect(stats.droppedItems).toBeGreaterThanOrEqual(2); // the voice from nowhere, Mara's physical goal
    // Memories and feeling are each participant's own.
    expect(getNarrativeHistory(w(), mara).some(r => r.monologue.includes("wouldn't look at me"))).toBe(true);
    expect(snapshotAffect(w(), ivo)?.feeling).toBe("guilty");
    expect(d.snapshot().events.some(e => e.kind === "scene" && e.text.startsWith("Meanwhile at Lantern House:"))).toBe(true);
    // The scene's action runs through the normal executor as a real walk.
    run(900, () => roomOf(ivo) === "Saltmere Common");
    expect(roomOf(ivo)).toBe("Saltmere Common");
    run(400, () => getOffstageStats(w())!.outcomes.scene.succeeded > 0);
    expect(getOffstageStats(w())!.outcomes.scene).toMatchObject({ started: 1, succeeded: 1 });
    expect(hasDueOffstageScene(w())).toBe(false); // just resolved; the next stretch has not elapsed
  });

  test("progress is capped by elapsed time; a build without completion is refused", async () => {
    install({ sceneIntervalMs: 20_000 }); offstage("Mara", "Ivo");
    const { bench, reply } = lanternScene();
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    d.advance(20_000);
    generate.mockResolvedValueOnce(reply);
    expect(await runOffstageScene(w())).toMatchObject({ status: "applied" });
    expect(Goal.progress[bench]).toBe(85); // 0.15/min × 20 s = +0.05
    expect(Goal.status[bench]).toBe("active");
    expect([...query(w(), [Name])].some(id => Name.value[id] === "Ivo's harbour bench")).toBe(false);
  });

  test("a finished project the catalog cannot hold goes to the Weaver as a note, not a fabricated structure", async () => {
    install(); offstage("Mara", "Ivo");
    const { ivo } = lanternScene();
    const house = customGoal(ivo, "Put up a boathouse for the Common", 90);
    // The spirit hierarchy a live evolving town has (manual sessions start without it).
    initializeSpiritSystem(w(), { godAgentEid: d.sim.god.eid, autoCreateNarrator: false }); createStandardHierarchy(d.sim.god.eid, w());
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    d.advance(60_000);
    generate.mockResolvedValueOnce(sceneReply({ summary: "Ivo and Mara raised the last rafters of the boathouse frame.",
      goalProgress: [{ actor: "Ivo", goalId: house, delta: 0.15, note: "Rafters up." }],
      build: [{ actor: "Ivo", goalId: house, name: "The Common boathouse", description: "A tarred timber boathouse with a green door." }] }));
    expect(await runOffstageScene(w())).toMatchObject({ status: "applied" });
    expect(Goal.status[house]).toBe("completed");
    const registry = getSpiritSystemState(w())!.registry, weaver = registry.spirits.get(registry.byName.get("The Weaver")!)!;
    expect(weaver.inbox.some(m => m.subject.includes("The Common boathouse"))).toBe(true);
    expect(getOffstageStats(w())!.builds).toEqual([expect.objectContaining({ status: "weaver", detail: "sent to the Weaver" })]);
    expect([...query(w(), [Name])].some(id => Name.value[id] === "The Common boathouse")).toBe(false);
  });

  test("malformed output is rejected safely and nothing is partially applied", async () => {
    install(); offstage("Mara", "Ivo");
    const { mara, bench } = lanternScene();
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    d.advance(60_000);
    generate.mockResolvedValueOnce({ text: "The sea was loud tonight." });
    expect(await runOffstageScene(w())).toMatchObject({ status: "rejected" });
    d.advance(60_000);
    generate.mockResolvedValueOnce(sceneReply({ dialogue: [{ speaker: "Mara", line: "No summary, no scene." }], goalProgress: [{ actor: "Ivo", goalId: bench, delta: .3, note: "x" }] }));
    expect(await runOffstageScene(w())).toMatchObject({ status: "rejected" });
    expect(getSocialDialogue(w(), mara)).toHaveLength(0);
    expect(Goal.progress[bench]).toBe(80);
    expect(getOffstageStats(w())!.sceneRejected).toBe(2);
    // Item-level strictness: extra keys and out-of-range deltas drop the item whole.
    const parsed = parseOffstageScene(JSON.stringify({ summary: "ok", goalProgress: [{ actor: "Ivo", goalId: 1, delta: 0.9, note: "too much" }],
      dialogue: [{ speaker: "Ivo", line: "hi", mood: "shy" }, { speaker: "Ivo", line: "fine" }] }), { maxDialogueLines: 6, maxActions: 4 })!;
    expect(parsed.goalProgress).toEqual([]); expect(parsed.dialogue).toEqual([{ speaker: "Ivo", line: "fine" }]); expect(parsed.dropped).toBe(2);
  });

  test("a resident promoted mid-call keeps the memories but not the actions, and promotion wakes their own mind", async () => {
    install(); offstage("Mara", "Ivo");
    const { ivo, reply } = lanternScene();
    runOffstageDriver(w(), registry()); // the fast loop has seen everyone offstage
    d.advance(60_000);
    generate.mockImplementationOnce(async () => { tiers.set(ivo, "presence"); return reply; });
    expect(await runOffstageScene(w())).toMatchObject({ status: "applied" });
    expect(getOffstageLife(w())!.sceneQueue.has(ivo)).toBe(false);
    expect(getNarrativeHistory(w(), ivo).some(r => r.monologue.includes("I nearly told her"))).toBe(true);
    runOffstageDriver(w(), registry());
    expect(getOffstageStats(w())!.promotions).toBe(1);
    expect(getForegroundCognitionReadiness(w(), ivo).wake).toEqual({ cause: "explicit" });
    // The observer leaves: he returns to routine and scenes.
    tiers.set(ivo, "offstage"); runOffstageDriver(w(), registry());
    expect(getOffstageStats(w())!.demotions).toBe(1);
  });

  test("a paused world runs no driver or scene, and a result landing after pause or source stop never applies", async () => {
    install(); offstage("Mara", "Ivo");
    const { mara, reply } = lanternScene();
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    d.advance(60_000);
    d.pause();
    expect(runOffstageDriver(w(), registry())).toBe(0);
    expect(hasDueOffstageScene(w())).toBe(false);
    expect(await runOffstageScene(w())).toMatchObject({ status: "skipped" });
    expect(generate).not.toHaveBeenCalled();
    d.resume();
    generate.mockImplementationOnce(async () => { d.pause(); return reply; });
    expect(await runOffstageScene(w())).toMatchObject({ status: "stale" });
    expect(getSocialDialogue(w(), mara)).toHaveLength(0);
    d.resume();
    expect(hasDueOffstageScene(w())).toBe(true); // the paused stretch was not consumed
    generate.mockImplementationOnce(async () => { d.stop(); return reply; });
    expect(await runOffstageScene(w())).toMatchObject({ status: "stale" });
    expect(getSocialDialogue(w(), mara)).toHaveLength(0);
  });
});

describe("offstage plans get past talk", () => {
  test("inner beats pass on their own; a speak step waits for a scene to have them say it, then the plan moves on", async () => {
    install(); offstage("Mara", "Ivo");
    const mara = named("Mara"), ivo = named("Ivo");
    const goal = customGoal(ivo, "Tell Mara what I saw at the Net House", 0, 90);
    const plan = createPlanEntity(w(), ivo, goal, { goalDescription: "Tell Mara what I saw at the Net House", steps: [
      { description: "Steel myself", actionType: "think", content: "If I don't say it now I never will." },
      { description: "Tell Mara what I saw", actionType: "speak", target: "Mara", content: "I saw Otis at the box." },
      { description: "Walk to Saltmere Common", actionType: "move", target: "Saltmere Common" }] } as any)!;
    // Mara has something to ask him too, so she stays rather than keeping her routine.
    const asking = customGoal(mara, "Ask Ivo about Tuesday", 0, 90);
    const herPlan = createPlanEntity(w(), mara, asking, { goalDescription: "Ask Ivo about Tuesday", steps: [
      { description: "Ask Ivo about Tuesday", actionType: "speak", target: "Ivo", content: "Where were you on Tuesday?" }] } as any)!;
    run(10, () => Plan.currentStep[plan] >= 1);
    // The thought passed; the plan now waits at the speech rather than stalling or skipping it.
    expect(Plan.currentStep[plan]).toBe(1);
    expect(offstageRows().some(row => row.startsWith("Ivo (offstage, plan)"))).toBe(false);
    trackOffstagePlaces(w(), getOffstageLife(w())!);
    d.advance(60_000); d.advance(30_000);
    generate.mockResolvedValueOnce(sceneReply({ summary: "Ivo finally told Mara about Otis and the box.",
      dialogue: [{ speaker: "Ivo", target: "Mara", line: "Mara. I saw Otis at the Net House box two nights ago." }],
      memories: [{ actor: "Ivo", text: "I said it. My hands haven't stopped shaking." }, { actor: "Mara", text: "Ivo knew all along." }] }));
    expect(roomOf(mara)).toBe(roomOf(ivo)); // both held for the talk
    expect(await runOffstageScene(w())).toMatchObject({ status: "applied" });
    expect(Plan.currentStep[plan]).toBe(2);
    expect(String(Plan.status[herPlan])).toBe("active"); // she never got her question in; still waiting to ask
    expect(getSocialDialogue(w(), mara).some(t => t.speaker === "Ivo" && /Otis/.test(t.content))).toBe(true);
    run(10, () => offstageRows().some(row => row === "Ivo (offstage, plan): move Saltmere Common"));
    expect(offstageRows()).toContain("Ivo (offstage, plan): move Saltmere Common");
  });
});
