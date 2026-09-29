import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { mkdtempSync, rmSync, existsSync, readFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { addComponent, addEntity, hasComponent } = await import("bitecs");
const { SpatialDemo } = await import("../../demo/spatial-demo");
const { SALTMERE_SCENARIO_ID } = await import("../../demo/spatial-lovecraft-town");
const { createSimulation } = await import("../../index");
const { Goal, Memory, Name, Plan, ProcedureState } = await import("../../ecs/components");
const { HasMemory } = await import("../../ecs/relations");
const { getRelationTargets } = await import("bitecs");
const { HasPlan } = await import("../../ecs/relations");
const { createIntentGoal, executeActions, advanceAgentPlan } = await import("../../cognition/cognition-system");
const { createPlanEntity } = await import("../../cognition/planning-system");
const { retireGoalPlans } = await import("../../cognition/plan-state");
const { getAgentProceduralSkills, getProcedureOutcomes, selectProceduralAction, serializeProceduralSkillV1 } = await import("../../cognition/procedural-skills");
type Skill = import("../../cognition/procedural-skills").ProceduralSkillV1;
const { abstractProcedure, abstractBehaviorTree, buildNameIndex } = await import("../abstraction");
const { harvestWorldSkills } = await import("../harvest");
const { beginLibraryRun, emptySkillLibrary, loadSkillLibrary, mergeObservations, saveSkillLibrary, selectSkills } = await import("../library");

let demos: Array<Awaited<ReturnType<typeof SpatialDemo.create>>> = [];
let dir: string;
beforeEach(() => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Skill library checks are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  dir = mkdtempSync(join(tmpdir(), "argos-skill-world-"));
});
afterEach(() => {
  for (const d of demos) { try { d.stop(); } catch { /* already stopped */ } }
  demos = [];
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function saltmere(options: Record<string, unknown> = {}) {
  const d = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false, ...options });
  demos.push(d); await d.start();
  return d;
}
const named = (d: Awaited<ReturnType<typeof SpatialDemo.create>>, name: string) => d.actors.find(id => Name.value[id] === name)!;

function remember(world: any, agent: number, skill: Skill) {
  const memory = addEntity(world); addComponent(world, memory, Memory); addComponent(world, agent, HasMemory(memory));
  Memory.type[memory] = "procedural"; Memory.content[memory] = serializeProceduralSkillV1(skill);
  Memory.importance[memory] = .5; Memory.timestamp[memory] = Date.now();
}
const planRecord = (goal: string, steps: Skill["steps"], successes = 1): Skill => ({ kind: "procedure_v1", signature: `plan:${goal.toLowerCase()}|0000`, name: `How I: ${goal}`,
  trigger: { affordance: "__plan_macro__", goal }, steps, stats: { successes, failures: 0, createdAt: 1, lastUsedAt: 1 } });

const BOX_ROUTINE: Skill["steps"] = [
  { type: "move", target: "The Net House" },
  { type: "interact", target: "Net House supplies box", content: "examine" },
  { type: "interact", target: "Net House supplies box", content: "open" },
  { type: "speak", target: "Ivo", content: "Ivo, the Net House supplies box is open — meet me at The Net House." },
];

describe("abstraction: names become queries, placeholders and scope", () => {
  test("a Net House routine becomes a kind of place, a kind of thing and an addressee", async () => {
    const d = await saltmere();
    const mara = named(d, "Mara");
    const result = abstractProcedure(d.sim.world, mara, planRecord("Check the Net House supplies box and sort what is inside", BOX_ROUTINE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.steps).toEqual([
      { type: "move", placeQuery: { place: "room-with", objectType: "chest", kind: "supply-box" } },
      { type: "interact", targetQuery: { objectType: "chest", kind: "supply-box", affordance: "examine" }, content: "examine" },
      { type: "interact", targetQuery: { objectType: "chest", kind: "supply-box", affordance: "open" }, content: "open" },
      { type: "speak", person: { person: "addressee" }, content: "{addressee}, the {object} is open — meet me at {place}." },
    ]);
    expect(result.skill.trigger).toEqual({ type: "goal", goalPattern: ["check", "sort", "inside"], goalExample: "Check the {object} and sort what is inside" });
    expect(result.skill.scope).toBe("general");
    expect(JSON.stringify(result.skill)).not.toMatch(/Net House|Ivo|Mara/);
  });

  test("home and story detection: story objects, scenario verbs and story names scope a skill to Saltmere", async () => {
    const d = await saltmere();
    const otis = named(d, "Otis"), mara = named(d, "Mara");
    // Otis lives in Gull House: going there is going home.
    const home = abstractProcedure(d.sim.world, otis, planRecord("Tidy up and sort the fittings", [
      { type: "move", target: "Gull House" }, { type: "interact", target: "Gull House sea chest", content: "open" }]));
    expect(home.ok && home.skill.steps[0]).toEqual({ type: "move", placeQuery: { place: "home" } });
    expect(home.ok && home.skill.scope).toBe("general");
    const logbook = abstractProcedure(d.sim.world, otis, planRecord("Hide what I took somewhere safe", [
      { type: "interact", target: "Gull House sea chest", content: "open" }, { type: "interact", target: "Marrow Star logbook", content: "read" }]));
    expect(logbook.ok && logbook.skill.scope).toEqual({ scenario: SALTMERE_SCENARIO_ID });
    const story = abstractProcedure(d.sim.world, mara, planRecord("Find out what the sea was paid", [
      { type: "move", target: "The Net House" }, { type: "interact", target: "Net House supplies box", content: "examine" }]));
    expect(story.ok && story.skill.scope).toEqual({ scenario: SALTMERE_SCENARIO_ID });
    // A walk to someone else's house to talk has no portable destination.
    const visit = abstractProcedure(d.sim.world, mara, planRecord("Talk things over properly", [
      { type: "move", target: "Rook House" }, { type: "speak", target: "Leon", content: "Leon, we need to talk." }]));
    expect(visit).toEqual({ ok: false, reason: "non-transferable place Rook House" });
    // A numbered thing that was used up (an eaten pastry) is described by a surviving sibling.
    const eaten = abstractProcedure(d.sim.world, mara, planRecord("Grab something to eat and sit down", [
      { type: "interact", target: "Cafe pastry 9", content: "eat" }, { type: "interact", target: "Cafe seat 1", content: "sit" }]));
    expect(eaten.ok && eaten.skill.steps[0]).toMatchObject({ type: "interact", targetQuery: { objectType: "food_item", kind: "food", affordance: "eat" } });
    expect(abstractProcedure(d.sim.world, mara, planRecord("Grab something to eat and sit down", [
      { type: "interact", target: "Unheard-of thing 3", content: "eat" }, { type: "interact", target: "Cafe seat 1", content: "sit" }])).ok).toBe(false);
  });

  test("behaviour trees: named interactions become trait interactions; named moves are not portable", async () => {
    const d = await saltmere();
    const w = d.sim.world, index = buildNameIndex(w);
    const box = [...index.byName.entries()].find(([name]) => name === "net house supplies box")![1];
    const traits = JSON.parse(String((await import("../../ecs/components")).Traits.active[box] || "[]"));
    const tree = { type: "sequence" as const, children: [{ type: "action" as const, action: { type: "interact" as const, target: "Net House supplies box", content: "open" } }] };
    const result = abstractBehaviorTree(w, "goal:open_box", "Learned from goal: open the Net House supplies box", tree, index);
    if (traits.length) {
      expect(result.ok && result.skill.tree).toEqual({ type: "sequence", children: [{ type: "interact_with_trait", trait: [...traits].sort()[0], affordance: "open", scope: "room" }] });
      expect(result.ok && (result.skill.trigger as { description: string }).description).toBe("Learned from goal: open the {object}");
    } else expect(result.ok).toBe(false);
    expect(abstractBehaviorTree(w, "x", "x", { type: "action", action: { type: "move", target: "Rook House" } }, index).ok).toBe(false);
  });
});

describe("harvest, seed and replay across worlds", () => {
  test("a skill learned on the Net House supplies box replays on a differently named chest in another room", async () => {
    const path = join(dir, "library.json");
    // World A: Mara learned a routine; harvest splits it from her memories.
    const a = await saltmere();
    const mara = named(a, "Mara");
    remember(a.sim.world, mara, planRecord("Check the Net House supplies box and sort what is inside", BOX_ROUTINE));
    const harvested = harvestWorldSkills(a.sim.world, { run: "world-a" });
    const routine = harvested.observations.filter(o => o.abstractSignature.includes("goal:check,inside,sort"));
    expect(routine).toHaveLength(1);
    expect(JSON.stringify(harvested.observations)).not.toMatch(/Ask Leon|father did not die/); // lived memories stay behind
    // Two runs of evidence promote it.
    const library = emptySkillLibrary();
    for (const run of ["world-a", "world-a2"]) { beginLibraryRun(library); mergeObservations(library, routine.map(o => ({ ...o, provenance: { ...o.provenance, run } }))); selectSkills(library); }
    expect(library.entries[0].status).toBe("promoted");
    saveSkillLibrary(path, library);
    a.stop();

    // World B: a fresh Saltmere (no memories) seeded from the library.
    const b = await saltmere({ skillLibrary: { path } });
    const w = b.sim.world, otis = named(b, "Otis");
    const seeded = getAgentProceduralSkills(w, otis).filter(s => s.skill.library);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].skill.signature).toBe(`lib:${library.entries[0].id}`);
    expect(getAgentProceduralSkills(w, otis).some(s => !s.skill.library)).toBe(false);
    // Nothing starts without an intention of the same gist.
    expect(selectProceduralAction(w, otis)?.target).not.toBe("Gull House sea chest");
    const goal = createIntentGoal(w, otis, "Check the Gull House sea chest and sort what is inside", 9)!;
    Goal.priority[goal] = 99;
    // Gull House already has a chest: the place binds to here, the thing to the sea chest.
    expect(selectProceduralAction(w, otis)).toEqual({ type: "interact", target: "Gull House sea chest", content: "examine" });
    const registry = b.sim.god.systemRegistry;
    for (const affordance of ["examine", "open"]) {
      const action = selectProceduralAction(w, otis)!;
      expect(action).toEqual({ type: "interact", target: "Gull House sea chest", content: affordance });
      executeActions(w, [{ eid: otis, action: { ...action } as any }], registry);
      for (let i = 0; i < 400 && (ProcedureState.stepIndex[otis] || 0) <= ["examine", "open"].indexOf(affordance) + 1 && hasComponent(w, otis, ProcedureState); i++) b.advance(100);
    }
    // The remembered words need someone to hear them; nobody is with Otis, so
    // the procedure yields instead of failing, and is set aside after a while.
    expect(selectProceduralAction(w, otis)).toBeNull();
    for (let i = 0; i < 500 && hasComponent(w, otis, ProcedureState); i++) { selectProceduralAction(w, otis); b.advance(100); }
    const use = getProcedureOutcomes(w).find(o => o.agentEid === otis && o.signature.startsWith("lib:"))!;
    expect(use).toMatchObject({ started: 1, completed: 0, failed: 0, abandoned: 1 });
    // Harvest at stop updates the entry's run-time stats (not a new entry).
    b.stop();
    const after = loadSkillLibrary(path);
    const entry = after.entries.find(e => e.id === library.entries[0].id)!;
    expect(after.entries.filter(e => e.trigger.type === "goal")).toHaveLength(1); // a use is not a new skill
    expect(entry.stats.lastUsedRun).toBe(after.runIndex);
    expect(entry.stats.successes).toBe(2 + use.completed);
    expect(entry.provenance.at(-1)).toMatchObject({ source: "seeded-use", resident: "Otis" });
  });
});

describe("offstage replay (the training path)", () => {
  test("the offstage driver runs a carried-over routine and steps past its remembered words", async () => {
    const path = join(dir, "library.json");
    const a = await saltmere();
    remember(a.sim.world, named(a, "Mara"), planRecord("Check the Net House supplies box and sort what is inside", BOX_ROUTINE));
    const library = emptySkillLibrary();
    for (const run of ["r1", "r2"]) {
      beginLibraryRun(library);
      mergeObservations(library, harvestWorldSkills(a.sim.world, { run }).observations.filter(o => o.trigger.type === "goal"));
      selectSkills(library);
    }
    saveSkillLibrary(path, library);
    a.stop();
    const b = await saltmere({ skillLibrary: { path } });
    const w = b.sim.world, otis = named(b, "Otis");
    const { setAttentionProvider } = await import("../../runtime/attention");
    const { installOffstageLife, runOffstageDriver } = await import("../../runtime/offstage");
    installOffstageLife(w, { config: { driverIntervalMs: [200, 200] } });
    setAttentionProvider(w, eid => ({ tier: eid === otis ? "offstage" : "presence" }));
    const goal = createIntentGoal(w, otis, "Check the Gull House sea chest and sort what is inside", 9)!;
    Goal.priority[goal] = 99;
    const done = () => getProcedureOutcomes(w).some(o => o.agentEid === otis && o.signature.startsWith("lib:") && o.completed > 0);
    for (let i = 0; i < 1500 && !done(); i++) { runOffstageDriver(w, b.sim.god.systemRegistry); b.advance(100); }
    const rows = b.snapshot().events.filter(e => e.kind === "offstage").map(e => e.text);
    expect(rows).toContain("Otis (offstage, learned): interact Gull House sea chest (examine)");
    expect(rows).toContain("Otis (offstage, learned): interact Gull House sea chest (open)");
    expect(getProcedureOutcomes(w).find(o => o.agentEid === otis && o.signature.startsWith("lib:"))).toMatchObject({ started: 1, completed: 1, failed: 0 });
    // Completed for this intention: not replayed again for it.
    expect(selectProceduralAction(w, otis)?.target).not.toBe("Gull House sea chest");
    b.stop();
    const entry = loadSkillLibrary(path).entries[0];
    expect(entry.stats).toMatchObject({ successes: 3, attempts: 3, runsSucceeded: 3 });
  });
});

describe("executed plans are kept as procedures", () => {
  test("a plan whose steps all advanced on receipts compiles, even for a custom goal", async () => {
    const d = await saltmere();
    const w = d.sim.world, ivo = named(d, "Ivo");
    const goal = createIntentGoal(w, ivo, "Sort out the supplies at the Net House", 9)!;
    createPlanEntity(w, ivo, goal, { goalDescription: "Sort out the supplies", steps: [
      { description: "Walk to the Net House", actionType: "move", target: "The Net House" },
      { description: "Look over the box", actionType: "interact", target: "Net House supplies box", content: "examine" }] } as any);
    expect(advanceAgentPlan(w, ivo)).toBe(true);
    expect(advanceAgentPlan(w, ivo)).toBe(true);
    const record = getAgentProceduralSkills(w, ivo).find(s => s.skill.trigger.affordance === "__plan_macro__");
    expect(record?.skill).toMatchObject({ trigger: { goal: "Sort out the supplies at the Net House" },
      steps: [{ type: "move", target: "The Net House" }, { type: "observe", target: "Net House supplies box" }] });
    // It is a record of how, not a proof of success: the custom goal stays open.
    expect(Goal.status[goal]).toBe("active");
  });

  test("a goal judged complete mid-plan keeps the executed prefix", async () => {
    const d = await saltmere();
    const w = d.sim.world, tess = named(d, "Tess");
    const goal = createIntentGoal(w, tess, "Make the cafe look busy tonight", 9)!;
    const plan = createPlanEntity(w, tess, goal, { goalDescription: "Busy cafe", steps: [
      { description: "Look at the table", actionType: "interact", target: "Cafe table 1", content: "examine" },
      { description: "Walk the common", actionType: "move", target: "Saltmere Common" },
      { description: "Call people in", actionType: "speak", content: "Tea's on!" }] } as any);
    Plan.currentStep[plan] = 2; // two steps advanced on their receipts
    Goal.status[goal] = "completed"; // e.g. an offstage scene judged it done
    retireGoalPlans(w, goal, getRelationTargets(w, tess, HasPlan));
    expect(Plan.status[plan]).toBe("retired");
    const record = getAgentProceduralSkills(w, tess).find(s => s.skill.trigger.affordance === "__plan_macro__");
    expect(record?.skill.steps).toEqual([{ type: "observe", target: "Cafe table 1" }, { type: "move", target: "Saltmere Common" }]);
  });
});

describe("hooks are off by default", () => {
  test("no library session, harvest or file unless configured", async () => {
    const d = await saltmere();
    expect(d.sim.skillLibrary).toBeUndefined();
    expect(d.sim.harvestSkillLibrary).toBeUndefined();
    const sim = await createSimulation({ name: "plain", enableAI: false, dualLoop: false, agents: [{ name: "Solo", role: "resident", systemPrompt: "x", startRoom: "Hall" }],
      rooms: [{ name: "Hall", description: "A hall." }] });
    expect(sim.skillLibrary).toBeUndefined();
    sim.stop();
    expect(existsSync(join(dir, "library.json"))).toBe(false);
  });

  test("createSimulation seeds and harvests when configured", async () => {
    const path = join(dir, "library.json");
    const sim = await createSimulation({ name: "configured", enableAI: false, dualLoop: false, skillLibrary: { path, run: "unit" },
      agents: [{ name: "Solo", role: "resident", systemPrompt: "x", startRoom: "Hall" }], rooms: [{ name: "Hall", description: "A hall." }] });
    expect(sim.skillLibrary?.seedReport).toMatchObject({ entries: 0, residents: 1 });
    sim.stop();
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ format: "argos-skill-library", runIndex: 1, runs: [{ run: "unit" }] });
  });
});
