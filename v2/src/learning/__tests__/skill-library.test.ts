import { jest } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginLibraryRun, emptySkillLibrary, libraryEntryId, loadSkillLibrary, mergeObservations, saveSkillLibrary, seedableEntries,
  selectSkills, DEFAULT_SELECTION_POLICY, type SkillObservation,
} from "../library";
import { goalKeywords, goalPatternMatches } from "../abstraction";
import { describeTrainingPlan, parseTrainingArgs, runTrainingCli } from "../train-skills";

/** Distinct step shapes per fixture skill (same shapes + similar intentions would fold). */
const sig = (steps: string) => `procedure|goal:check,sort|${steps}`;
const obs = (signature: string, successes: number, attempts: number, extra: Partial<SkillObservation> = {}): SkillObservation => ({
  kind: "procedure", name: `How to: ${signature}`, abstractSignature: sig(signature),
  trigger: { type: "goal", goalPattern: ["check", "sort"], goalExample: "check the {object} and sort it" },
  steps: [{ type: "interact", targetQuery: { objectType: "chest", affordance: "examine" }, content: "examine" }],
  scope: "general", attempts, successes, provenance: { run: "r", resident: "Mara", source: "learned" }, ...extra,
});

describe("skill library: merge and select", () => {
  test("promotion needs successes across distinct runs at a good rate", () => {
    const lib = emptySkillLibrary();
    beginLibraryRun(lib);
    // Two successes in ONE run are not enough.
    mergeObservations(lib, [obs("a", 1, 1), obs("a", 1, 1, { provenance: { run: "r1", resident: "Ivo", source: "learned" } })]);
    let report = selectSkills(lib);
    const a = lib.entries.find(e => e.id === libraryEntryId(sig("a")))!;
    expect(a.stats).toMatchObject({ successes: 2, attempts: 2, runsSeen: 1, runsSucceeded: 1 });
    expect(a.status).toBe("candidate");
    expect(report.promoted).toEqual([]);
    beginLibraryRun(lib);
    mergeObservations(lib, [obs("a", 1, 1)]);
    report = selectSkills(lib);
    expect(report.promoted).toEqual([a.id]);
    expect(a.status).toBe("promoted");
    expect(a.provenance.map(p => p.resident)).toEqual(["Mara", "Ivo", "Mara"]);
  });

  test("a poor success rate stays a candidate; a promoted skill that keeps failing is retired", () => {
    const lib = emptySkillLibrary();
    for (let run = 0; run < 2; run++) { beginLibraryRun(lib); mergeObservations(lib, [obs("flaky", 1, 3)]); selectSkills(lib); }
    expect(lib.entries[0].status).toBe("candidate");
    const good = emptySkillLibrary();
    for (let run = 0; run < 2; run++) { beginLibraryRun(good); mergeObservations(good, [obs("good", 1, 1)]); selectSkills(good); }
    expect(good.entries[0].status).toBe("promoted");
    beginLibraryRun(good);
    mergeObservations(good, [{ ...obs("good", 0, 6), entryId: good.entries[0].id, provenance: { run: "r3", source: "seeded-use" } }]);
    const report = selectSkills(good);
    expect(report.retired).toEqual([good.entries[0].id]);
    expect(good.entries[0].stats.lastUsedRun).toBe(3);
  });

  test("unseen candidates retire, retired entries are pruned, and the cap keeps the strongest", () => {
    const lib = emptySkillLibrary();
    beginLibraryRun(lib);
    mergeObservations(lib, [obs("stale", 1, 1), obs("fresh", 1, 1)]);
    for (let run = 0; run < DEFAULT_SELECTION_POLICY.retireUnseenRuns; run++) {
      beginLibraryRun(lib); mergeObservations(lib, [obs("fresh", 1, 1)]); selectSkills(lib);
    }
    expect(lib.entries.find(e => e.name === "How to: stale")!.status).toBe("retired");
    expect(lib.entries.find(e => e.name === "How to: fresh")!.status).toBe("promoted");
    for (let run = 0; run < DEFAULT_SELECTION_POLICY.pruneRetiredAfterRuns; run++) { beginLibraryRun(lib); selectSkills(lib); }
    expect(lib.entries.map(e => e.name.slice(8))).toEqual(["fresh"]);

    const capped = emptySkillLibrary();
    beginLibraryRun(capped);
    mergeObservations(capped, [obs("weak", 0, 4), obs("strong", 3, 3), obs("middle", 1, 2)]);
    const report = selectSkills(capped, { ...DEFAULT_SELECTION_POLICY, maxEntries: 2 });
    expect(capped.entries.map(e => e.name.slice(8)).sort()).toEqual(["middle", "strong"]);
    expect(report.capped).toEqual([libraryEntryId(sig("weak"))]);
  });

  test("a seeded use of a pruned entry never resurrects it; a working retired skill returns as a candidate", () => {
    const lib = emptySkillLibrary();
    beginLibraryRun(lib);
    const report = mergeObservations(lib, [{ ...obs("gone", 1, 1), entryId: "sk-missing", provenance: { run: "r", source: "seeded-use" } }]);
    expect(report.ignored).toBe(1);
    expect(lib.entries).toEqual([]);
    mergeObservations(lib, [obs("back", 0, 1)]);
    lib.entries[0].status = "retired"; lib.entries[0].retiredAtRun = 1;
    beginLibraryRun(lib); mergeObservations(lib, [obs("back", 1, 1)]);
    expect(lib.entries[0].status).toBe("candidate");
  });

  test("scope: story-bound evidence narrows a general skill; seeding filters by scenario and status", () => {
    const lib = emptySkillLibrary();
    beginLibraryRun(lib);
    mergeObservations(lib, [obs("g", 2, 2), obs("s", 2, 2, { scope: { scenario: "saltmere" } }), obs("t", 1, 1)]);
    for (const entry of lib.entries) if (entry.name !== "How to: t") entry.status = "promoted";
    const ids = (list: ReturnType<typeof seedableEntries>) => list.map(e => e.name.slice(8)).sort();
    expect(ids(seedableEntries(lib, {}))).toEqual(["g"]);
    expect(ids(seedableEntries(lib, { scenarioId: "saltmere" }))).toEqual(["g", "s"]);
    expect(ids(seedableEntries(lib, { scenarioId: "other", includeCandidates: true }))).toEqual(["g", "t"]);
    beginLibraryRun(lib);
    mergeObservations(lib, [obs("g", 1, 1, { scope: { scenario: "saltmere" } })]);
    expect(lib.entries.find(e => e.name === "How to: g")!.scope).toEqual({ scenario: "saltmere" });
  });
});

describe("skill library: file format", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "argos-skills-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("atomic, human-readable write and exact read round trip; missing file is empty; malformed is an error", () => {
    const path = join(dir, "nested", "library.json");
    expect(loadSkillLibrary(path).entries).toEqual([]);
    const lib = emptySkillLibrary();
    beginLibraryRun(lib); mergeObservations(lib, [obs("a", 1, 1)]); selectSkills(lib);
    saveSkillLibrary(path, lib);
    expect(readdirSync(join(dir, "nested"))).toEqual(["library.json"]); // no temp file left behind
    const text = readFileSync(path, "utf8");
    expect(text).toContain('\n  "format": "argos-skill-library"');
    expect(loadSkillLibrary(path)).toEqual(lib);
    writeFileSync(path, JSON.stringify({ format: "something-else" }));
    expect(() => loadSkillLibrary(path)).toThrow(/format/);
    writeFileSync(path, JSON.stringify({ ...lib, version: 99 }));
    expect(() => loadSkillLibrary(path)).toThrow(/version/);
  });
});

describe("goal patterns", () => {
  test("keywords ignore placeholders and stopwords; matching needs the same gist", () => {
    const pattern = goalKeywords("Check the {object} and sort what is inside");
    expect(pattern).toEqual(["check", "sort", "inside"]);
    expect(goalPatternMatches(pattern, goalKeywords("Check the {object} at {place} and sort what's inside it"))).toBe(true);
    expect(goalPatternMatches(pattern, goalKeywords("Ask {person} what the sea was paid"))).toBe(false);
    expect(goalPatternMatches(["check"], goalKeywords("check the weather forecast for tomorrow evening"))).toBe(false);
    // A reworded intention with the same core still matches a narrowed pattern.
    expect(goalPatternMatches(["paint", "shed", "hook"], goalKeywords("Go to {place} to get {person}'s pale paint from the shed before anyone sees the hooks"))).toBe(true);
  });

  test("near-duplicates: same steps and a reworded intention fold into one skill with a narrowed pattern", () => {
    // The two entries the first live training check actually produced (Bea, runs 1 and 2).
    const steps = "move(home)>observe(current)";
    const scope = { scenario: "saltmere" };
    const bea = (pattern: string[], example: string, run: string): SkillObservation => ({
      kind: "procedure", name: `How to: ${example}`, abstractSignature: `procedure|goal:${[...pattern].sort().join(",")}|${steps}`,
      trigger: { type: "goal", goalPattern: pattern, goalExample: example },
      steps: [{ type: "move", placeQuery: { place: "home" } }, { type: "observe", placeQuery: { place: "current" } }],
      scope, attempts: 1, successes: 1, provenance: { run, resident: "Bea", source: "learned" } });
    const lib = emptySkillLibrary();
    beginLibraryRun(lib);
    mergeObservations(lib, [bea(["paint", "shed", "cover", "hook", "pot", "dark"], "Find {person}'s paint in the {place} shed to cover the hooks on the pot before dark", "r1")]);
    selectSkills(lib);
    const id = lib.entries[0].id;
    beginLibraryRun(lib);
    const report = mergeObservations(lib, [bea(["pale", "paint", "shed", "anyone", "see", "hook"], "Go to {place} to get {person}'s pale paint from the shed before anyone sees the hooks", "r2")]);
    const selected = selectSkills(lib);
    expect(report.generalized).toEqual([id]);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0].id).toBe(id); // stable for seeded memories
    expect(lib.entries[0].trigger).toMatchObject({ goalPattern: ["paint", "shed", "hook"] });
    expect(lib.entries[0].abstractSignature).toBe(`procedure|goal:hook,paint,shed|${steps}`);
    expect(selected.promoted).toEqual([id]);
    // Different steps or too little in common stay separate skills.
    beginLibraryRun(lib);
    const other = mergeObservations(lib, [bea(["paint", "fence", "garden"], "Paint the fence in the garden", "r3")]);
    expect(other.newEntries).toHaveLength(1);
  });
});

describe("training command", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "argos-train-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("refuses to spend without --live: prints the plan, calls no model, writes no library", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const lines: string[] = [];
    const path = join(dir, "library.json");
    const code = await runTrainingCli(["--runs", "2", "--seconds", "240", "--library", path], { out: line => lines.push(line) });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/2 sequential Saltmere session\(s\) × 240 s/);
    expect(lines.join("\n")).toMatch(/Refusing to spend/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
    fetchSpy.mockRestore();
  });

  test("bounds runs and seconds", async () => {
    expect(() => parseTrainingArgs(["--runs", "11"])).toThrow(/runs/);
    expect(() => parseTrainingArgs(["--seconds", "901"])).toThrow(/seconds/);
    expect(() => parseTrainingArgs(["--scenario", "blackout"])).toThrow(/Saltmere/);
    const lines: string[] = [];
    expect(await runTrainingCli(["--runs", "0", "--live"], { out: line => lines.push(line) })).toBe(2);
    const args = parseTrainingArgs(["--runs", "3", "--seconds", "60", "--library", join(dir, "x.json"), "--no-trial"]);
    expect(args).toMatchObject({ runs: 3, seconds: 60, live: false, trial: false });
    expect(describeTrainingPlan(args)).toMatch(/missing \(will be created\)/);
  });
});
