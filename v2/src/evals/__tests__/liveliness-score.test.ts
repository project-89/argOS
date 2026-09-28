import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyGoalSource,
  countExchanges,
  DEFLATION,
  loadRecording,
  parseFeedEntry,
  renderTable,
  scoreRecording,
  topicEcho,
  type LivelinessEvent,
} from "../liveliness-score";

const dirs: string[] = [];

function fixtureDir(files: Record<string, unknown[] | Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), "liveliness-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const text = Array.isArray(content) ? content.map(row => JSON.stringify(row)).join("\n") + "\n" : JSON.stringify(content);
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const conversation = (t: number, speaker: string, target: string, content: string) => ({
  scope: "process",
  observedAtSimMs: t + 3000,
  entry: { type: "conversation", data: { speaker, target, content, simulation: { startedAtSimMs: t, completedAtSimMs: t + 3000 } } },
});

function fullRecording(extraThoughts: Array<{ actor: string; text: string; atSimMs: number }> = []) {
  return fixtureDir({
    "operator-events.jsonl": [
      { id: 1, atSimMs: 0, kind: "session", text: "Live native Argos cognition started." },
      { id: 2, atSimMs: 1000, kind: "action", text: "Mara: wait · completed" },
      { id: 3, atSimMs: 2000, kind: "action", text: "Leon: rest · completed" },
      { id: 4, atSimMs: 3000, kind: "action", text: "Mara begins move The Net House" },
      { id: 5, atSimMs: 4000, kind: "action", text: "Leon: examine Net House supplies box · completed" },
      { id: 6, atSimMs: 5000, kind: "completed", text: "Mara: You walked to The Net House." },
      { id: 7, atSimMs: 6000, kind: "speech", text: "Mara: Leon, " },
      { id: 8, atSimMs: 9000, kind: "failed", text: "Leon: Movement failed: path_blocked" },
      { id: 9, atSimMs: 50000, kind: "operator", text: "Planted a thought for Mara." },
      { id: 10, atSimMs: 119000, kind: "action", text: "Ada: wait · completed" },
    ],
    "chronicle.jsonl": [
      conversation(6000, "Mara", "Leon", "Leon, why did you lie about the Marrow Star and the storm?"),
      conversation(12000, "Leon", "Mara", "The truth is I never told anyone what the cargo was."),
      conversation(20000, "Mara", "Leon", "Then tell me now, before the sea takes another."),
      conversation(90000, "Ada", "Mara", "It's just old wear, not an omen."),
      { observedAtSimMs: 1500, entry: { type: "llm_decision", data: { agent: "Mara", actionType: "wait" } } },
      { observedAtSimMs: 1600, entry: { type: "autonomous_goal", data: { agent: "Mara", goal: "Learn what the sea was paid", kind: "social" } } },
      { observedAtSimMs: 1700, entry: { type: "autonomous_goal", data: { agent: "Leon", goal: "Eat", kind: "survive" } } },
      { observedAtSimMs: 30000, entry: { type: "goal_completed", data: { agent: "Mara", goal: "Learn", source: "subjective_social_review" } } },
      { observedAtSimMs: 31000, entry: { type: "goal_completed", data: { agent: "Leon", goal: "Eat", source: "native_outcome" } } },
      { observedAtSimMs: 32000, entry: { type: "decision_rejected", data: { agent: "Ada", reason: "invalid_schema" } } },
    ],
    "thoughts.jsonl": [
      { actor: "Leon", text: "If Mara finds the logbook I will have to confess.", atSimMs: 15000 },
      { actor: "Ada", text: "Three knocks again last night. I am afraid.", atSimMs: 16000 },
      ...extraThoughts,
    ],
    "narrator-reviews.jsonl": [
      { atSimMs: 15000, accepted: true, interventionsRequested: 0, interventionResults: [], phase: "exposition", tension: 0.3 },
      { atSimMs: 60000, accepted: true, interventionsRequested: 2, interventionResults: ["applied", "accepted"], phase: "rising", tension: 0.6, prose: [{ text: "Fog came off the water.", shown: true }, "A second line nobody saw."] },
    ],
    "world-changes.jsonl": [
      { id: "narrator-review:15000:3", atSimMs: 15000, spirit: "The Narrator", status: "observed", summary: "Reviewed 3 public receipts; 0 interventions requested." },
      { id: "weather:19:1", atSimMs: 20000, spirit: "God · operator request", status: "applied", summary: "Rain." },
      { id: "sound:1", atSimMs: 61000, spirit: "The Narrator", status: "applied", summary: "Three knocks at Rook House." },
      { id: "story:2", atSimMs: 62000, spirit: "God", status: "applied", summary: "A letter arrives." },
      { id: "proposal:proposal_1:proposed", atSimMs: 70000, spirit: "The Weaver", status: "proposed", summary: "Chair" },
      { id: "build:chair:built", atSimMs: 80000, spirit: "The Weaver", status: "applied", summary: "Chair registered." },
      { id: "review:9", atSimMs: 81000, spirit: "The Weaver", status: "rejected", summary: "needs: stale_observation" },
    ],
    "injections.jsonl": [{ id: "warning", at: 10000, kind: "text", actor: "Mara", text: "This is not Alex.", actualAtSimMs: 10200, origin: "operator", result: {} }],
    "whispers.jsonl": [
      { atSimMs: 40000, actor: "Leon", text: "She already knows.", delivered: true },
      { atSimMs: 41000, actor: "Ada", text: "dropped", delivered: false },
    ],
    "phone-events.jsonl": [{ actor: "Mara", direction: "out", status: "sent", text: "Who is this?", atSimMs: 12000 }],
    "result.json": { simulationMs: 120000, actors: [{ name: "Mara" }, { name: "Leon" }, { name: "Ada" }] },
  });
}

describe("liveliness scorer adapters", () => {
  it("parses operator feed action, speech and operator lines", () => {
    expect(parseFeedEntry({ atSimMs: 5, kind: "action", text: "Ada: examine Net House supplies box · completed" }, "f")[0]).toMatchObject({ actor: "Ada", actionType: "examine", target: "Net House supplies box", success: true });
    expect(parseFeedEntry({ atSimMs: 5, kind: "action", text: "Ivo begins pickup Ivo's phone" }, "f")[0]).toMatchObject({ actor: "Ivo", actionType: "pickup", target: "Ivo's phone" });
    expect(parseFeedEntry({ atSimMs: 5, kind: "speech", text: "Ivo: Hello: there" }, "f")[0]).toMatchObject({ actor: "Ivo", kind: "speech", content: "Hello: there" });
    expect(parseFeedEntry({ atSimMs: 5, kind: "operator", text: "Planted a thought for Mara." }, "f")[0]).toMatchObject({ kind: "whisper", actor: "Mara", source: "operator" });
    expect(parseFeedEntry({ atSimMs: 5, kind: "sound", text: "Mara's phone vibrates." }, "f")).toEqual([]);
  });

  it("classifies goal completion sources", () => {
    expect(classifyGoalSource("subjective_social_review")).toBe("subjective");
    expect(classifyGoalSource("native_outcome")).toBe("native");
    expect(classifyGoalSource("mystery")).toBe("other");
  });

  it("reassembles chunked speech receipts by execution", async () => {
    const chunk = (seq: number, t: number, text?: string, extra: Record<string, unknown> = {}) => ({
      event: { sequence: seq, kind: "speech", action: "speak", status: seq === 1 ? "pending" : "succeeded", executionId: "execution:a", actorName: "Leon", roomName: "Net House", atSimMs: t, startedAtSimMs: 1000, ...(text ? { text } : {}), ...extra },
    });
    const dir = fixtureDir({
      "receipts.jsonl": [
        chunk(1, 1000),
        chunk(3, 1800, "you "),
        chunk(2, 1400, "Ada, "),
        chunk(4, 2200, "knew."),
        chunk(5, 2200, undefined, { completedAtSimMs: 2200 }),
        { event: { sequence: 6, kind: "action", action: "move", status: "succeeded", actorName: "Ada", atSimMs: 3000, targetName: "Common" } },
      ],
    });
    const rec = await loadRecording(dir);
    const speech = rec.events.filter(e => e.kind === "speech");
    expect(speech).toHaveLength(1);
    expect(speech[0]).toMatchObject({ actor: "Leon", content: "Ada, you knew.", room: "Net House", tSimMs: 1000 });
    expect(speech[0].meta?.endMs).toBe(2200);
    expect(rec.sources.actions).toMatch(/receipts/);
  });
});

describe("liveliness scorer metrics", () => {
  it("scores a full recording across actions, speech, drama, goals, narrator and world", async () => {
    const score = await scoreRecording(fullRecording());
    expect(score.coverage).toBe("full");
    expect(score.residents).toBe(3);
    expect(score.simMinutes).toBe(2);
    // Feed actions: wait, rest, move, examine, wait (+4 chronicle speech lines as speak).
    expect(score.actions.histogram).toMatchObject({ wait: 2, rest: 1, move: 1, examine: 1, speak: 4 });
    expect(score.actions.waitRestShare).toBeCloseTo(3 / 9, 3);
    expect(score.actions.decisionHistogram).toEqual({ wait: 1 });
    expect(score.actions.failures).toBe(1);
    // Speech comes from the chronicle (full lines), not the truncated operator chunk.
    expect(score.speech.lines).toBe(4);
    expect(score.speech.distinctLineRatio).toBe(1);
    expect(score.exchanges.turnPairs).toBe(2);
    expect(score.exchanges.distinctPairs).toBe(1);
    expect(score.drama.conflict.total).toBe(1);
    expect(score.drama.disclosure.total).toBe(2);
    expect(score.drama.fear.total).toBeGreaterThanOrEqual(3);
    expect(score.drama.deflation.total).toBe(1);
    expect(score.drama.deflation.examples[0]).toContain("Ada: It's just old wear");
    expect(score.goals).toMatchObject({ created: 2, completed: 2, completedNative: 1, completedSubjective: 1 });
    expect(score.narrator).toMatchObject({ reviews: 2, interventionsRequested: 2, interventionsAccepted: 2, interventionsCommitted: 1, proseProduced: 2, proseShown: 1, tensionStart: 0.3, tensionEnd: 0.6 });
    expect(score.world.committedBy).toMatchObject({ narrator: 1, god: 1, operator: 2 });
    expect(score.world.nonOperatorCommitted).toBe(2);
    expect(score.world).toMatchObject({ builds: 1, buildProposals: 1, whispersDelivered: 1, operatorWhispers: 1, phoneRepliesSent: 1 });
    expect(score.world.rejections).toBeGreaterThanOrEqual(2);
    expect(score.alivenessIndex).toBeGreaterThan(0);
    expect(score.alivenessIndex).toBeLessThanOrEqual(100);
    expect(Object.values(score.composite).every(c => c.available)).toBe(true);
  });

  it("lowers the aliveness index when residents deflate the mystery", async () => {
    const base = await scoreRecording(fullRecording());
    const deflated = await scoreRecording(fullRecording([
      { actor: "Mara", text: "No sense turning an old nick into an omen.", atSimMs: 70000 },
      { actor: "Leon", text: "Just everyday workshop wear, nothing to worry about.", atSimMs: 71000 },
      { actor: "Ada", text: "It is a coincidence, perfectly ordinary.", atSimMs: 72000 },
    ]));
    expect(deflated.drama.deflation.total).toBe(base.drama.deflation.total + 3);
    expect(deflated.composite.deflationPenalty.points).toBeLessThan(base.composite.deflationPenalty.points);
    expect(deflated.alivenessIndex).toBeLessThan(base.alivenessIndex);
  });

  it("scores a spatial session window with wrapped narrator/world shapes absent", async () => {
    const dir = fixtureDir({
      "session.json": {
        atSimMs: 300000,
        actors: [{ name: "Mara", thought: { text: "Something in the fog is counting.", atSimMs: 250000 } }, { name: "Ivo" }],
        events: [
          { id: 1, atSimMs: 200000, kind: "action", text: "Mara: wait · completed" },
          { id: 2, atSimMs: 201000, kind: "speech", text: "Ivo: Mara, did you hear the knocks?" },
          { id: 3, atSimMs: 205000, kind: "speech", text: "Mara: I did, Ivo. Three of them." },
          { id: 4, atSimMs: 206000, kind: "action", text: "Ivo: wait · completed" },
          { id: 5, atSimMs: 260000, kind: "action", text: "Ivo begins move Common" },
        ],
        townLife: {
          changes: [{ id: "narrator-review:210000:9", atSimMs: 210000, spirit: "The Narrator", status: "observed", summary: "Reviewed 9 public receipts; 1 interventions requested (accepted). Story interpretation: rising." }],
          story: { tension: 0.5, phase: "rising", lastReviewAtSimMs: 210000 },
        },
      },
    });
    const score = await scoreRecording(dir);
    expect(score.coverage).toBe("session-window");
    expect(score.simMinutes).toBe(1);
    expect(score.actions.waitRestShare).toBeCloseTo(2 / 5, 3);
    expect(score.speech.lines).toBe(2);
    expect(score.exchanges.turnPairs).toBe(1);
    expect(score.thoughts.count).toBe(1);
    expect(score.narrator).toMatchObject({ reviews: 1, interventionsRequested: 1, interventionsAccepted: 1, interventionsCommitted: 0, tensionEnd: 0.5 });
    expect(score.goals.created).toBeNull();
    expect(score.composite.goals.available).toBe(false);
    expect(renderTable([score])).toContain("ALIVENESS INDEX");
  });

  it("reads wrapped narrator-review and world-change shapes", async () => {
    const dir = fixtureDir({
      "operator-events.jsonl": [{ id: 1, atSimMs: 60000, kind: "action", text: "Tess: wait · completed" }],
      "narrator-reviews.jsonl": [{ capturedAtSimMs: 27500, status: { atSimMs: 27100, accepted: true, interventionsRequested: 1, interventionResults: ["applied"], phase: "rising", tension: 0.35 } }],
      "world-changes.jsonl": [
        { capturedAtSimMs: 27500, change: { id: "weather:17:1", atSimMs: 27100, spirit: "The Narrator", status: "applied", summary: "Rain on the patio." } },
        { capturedAtSimMs: 27500, change: { id: "narrator-review:27100:18", atSimMs: 27100, spirit: "The Narrator", status: "observed", summary: "Reviewed 18 public receipts; 1 interventions requested (applied)." } },
        { capturedAtSimMs: 99000, change: { id: "wetness:x:1", atSimMs: 99000, spirit: "Generated weather system", status: "applied", summary: "Chair looks damp." } },
      ],
    });
    const score = await scoreRecording(dir);
    expect(score.narrator.reviews).toBe(1);
    expect(score.narrator.interventionsCommitted).toBe(1);
    expect(score.world.committedBy).toEqual({ narrator: 1, system: 1 });
    expect(score.world.nonOperatorCommitted).toBe(1);
  });

  it("measures echo chains and reply exchanges", () => {
    const line = (t: number, actor: string, content: string, room = "Cafe"): LivelinessEvent => ({ tSimMs: t, actor, kind: "speech", content, room, source: "test" });
    const echo = [line(0, "A", "Just old marks on the old table."), line(5000, "B", "Old marks on the table, just old."), line(9000, "A", "Just old marks on that table.")];
    const varied = [line(0, "A", "Who carved the hooks into the lid?"), line(5000, "B", "Otis had paint on his knife yesterday."), line(9000, "A", "Then the logbook is gone.")];
    expect(topicEcho(echo)!).toBeGreaterThan(0.5);
    expect(topicEcho(varied)!).toBeLessThan(0.1);
    // Different rooms or > 20 s gaps are not exchanges.
    expect(countExchanges([line(0, "A", "Hi B"), line(3000, "B", "Hi", "Garden")], ["A", "B"]).turnPairs).toBe(0);
    expect(countExchanges([line(0, "A", "Hi B"), line(30000, "B", "Hi")], ["A", "B"]).turnPairs).toBe(0);
    expect(countExchanges([line(0, "A", "Hi B"), line(3000, "B", "Hi A"), line(6000, "C", "Hello")], ["A", "B", "C"])).toEqual({ turnPairs: 1, distinctPairs: 1 });
    expect(DEFLATION.test("hardly an ancient omen")).toBe(true);
    expect(DEFLATION.test("Three knocks at night again.")).toBe(false);
  });
});
