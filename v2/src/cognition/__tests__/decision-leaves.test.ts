import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { configureDecisionLeaves, decideNow, decisionPrompt, getDecisionLog, getDecisionStats, parseDecision, requestDecision, settleDecisions,
  type DecisionGenerator } from "../decision-leaves";
import { evaluateBehaviorPolicy, setAgentBehaviorPolicy, validateBehaviorNode, type BehaviorNode } from "../behavior-policy";
import { recordCommittedSpeech } from "../social-memory";
import { setAttentionProvider } from "../../runtime/attention";
import { distillPickRule } from "../../learning/slot-rules";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
afterEach(() => { for (const w of worlds.splice(0)) stopCommittedEvents(w); jest.restoreAllMocks(); });

function fixture(answer: (prompt: string) => string) {
  const world = createArgosWorld("Leaves"); initializePrefabs(world); worlds.push(world); startCommittedEvents(world);
  world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Hall" });
  const ada = createAgentEntity(world, { name: "Ada", role: "repairer", systemPrompt: "You are Ada. Blunt, exact, privately frightened of knocks at night.", roomId: room });
  const wren = createAgentEntity(world, { name: "Wren", role: "visitor", systemPrompt: "A stranger.", roomId: room });
  const otis = createAgentEntity(world, { name: "Otis", role: "fisherman", systemPrompt: "Otis.", roomId: room });
  const calls: Array<{ system: string; prompt: string; maxOutputTokens: number }> = [];
  const generate: DecisionGenerator = async input => { calls.push(input); return { text: answer(input.prompt), usage: { inputTokens: 300, outputTokens: 12 } }; };
  configureDecisionLeaves(world, { generate });
  return { world, room, ada, wren, otis, calls };
}

describe("decision leaves", () => {
  test("parse only closed answers: an index in range, a boolean, a line (or silence when allowed)", () => {
    expect(parseDecision({ kind: "pick", question: "?", options: ["a", "b"] }, '{"choice": 1}')).toEqual({ kind: "pick", index: 1, source: "model" });
    expect(parseDecision({ kind: "pick", question: "?", options: ["a", "b"] }, '{"choice": 2}')).toBeNull();
    expect(parseDecision({ kind: "yes_no", question: "?" }, '{"yes": false}')).toEqual({ kind: "yes_no", yes: false, source: "model" });
    expect(parseDecision({ kind: "say", gist: "hi" }, '{"line": null}')).toBeNull();
    expect(parseDecision({ kind: "say", gist: "hi", allowSilence: true }, '{"line": null}')).toEqual({ kind: "say", line: null, source: "model" });
    expect(parseDecision({ kind: "say", gist: "hi" }, '{"line": "  Hello   there. "}')).toMatchObject({ line: "Hello there." });
  });

  test("a say prompt is small, in the persona, and carries what was just said", () => {
    const f = fixture(() => "{}");
    recordCommittedSpeech(f.world, f.wren, "Is the lamp fixed yet?", "Ada");
    const { system, prompt, maxOutputTokens } = decisionPrompt(f.world, f.ada, { kind: "say", gist: "the lamp needs a part from the box", to: "Wren" });
    expect(system).toContain("privately frightened of knocks");
    expect(prompt).toContain('Wren (to you): "Is the lamp fixed yet?"');
    expect(prompt).toContain("the lamp needs a part from the box");
    expect((system + prompt).length).toBeLessThan(2500);
    expect(maxOutputTokens).toBeLessThanOrEqual(200);
  });

  test("polling starts one question, reports pending, then hands the answer over once", async () => {
    const f = fixture(() => '{"choice": 1}');
    const request = { kind: "pick" as const, question: "Who do you ask?", options: ["Wren", "Otis"] };
    expect(requestDecision(f.world, f.ada, "slot", request)).toEqual({ status: "pending" });
    expect(requestDecision(f.world, f.ada, "slot", request)).toEqual({ status: "pending" });
    await settleDecisions(f.world);
    expect(requestDecision(f.world, f.ada, "slot", request)).toEqual({ status: "ready", answer: { kind: "pick", index: 1, source: "model" } });
    expect(f.calls).toHaveLength(1);
    expect(getDecisionStats(f.world)).toMatchObject({ calls: 1, model: 1, tokensIn: 300, tokensOut: 12 });
    expect(getDecisionLog(f.world).at(-1)).toMatchObject({ actor: "Ada", slot: "slot", index: 1, source: "model" });
  });

  test("without a model, over budget, or for offstage words, the plain answer stands and nothing is called", async () => {
    const f = fixture(() => '{"yes": false}');
    f.world.meta.aiEnabled = false;
    expect(requestDecision(f.world, f.ada, "a", { kind: "yes_no", question: "?" })).toMatchObject({ status: "ready", answer: { yes: true, source: "fallback" } });
    f.world.meta.aiEnabled = true;
    setAttentionProvider(f.world, () => ({ tier: "offstage" }));
    expect(requestDecision(f.world, f.ada, "b", { kind: "say", gist: "the box" })).toMatchObject({ status: "ready", answer: { line: "the box", source: "fallback" } });
    setAttentionProvider(f.world, undefined);
    configureDecisionLeaves(f.world, { maxPerMinute: 0 });
    expect(await decideNow(f.world, f.ada, "c", { kind: "yes_no", question: "?" })).toMatchObject({ source: "fallback" });
    expect(f.calls).toHaveLength(0);
  });

  test("a failing or malformed model answer falls back instead of throwing", async () => {
    const f = fixture(() => "no json here");
    expect(await decideNow(f.world, f.ada, "x", { kind: "say", gist: "It was Otis." })).toEqual({ kind: "say", line: "It was Otis.", source: "fallback" });
    configureDecisionLeaves(f.world, { generate: async () => { throw new Error("provider down"); } });
    expect(await decideNow(f.world, f.ada, "y", { kind: "pick", question: "?", options: ["a", "b"] })).toEqual({ kind: "pick", index: 0, source: "fallback" });
  });
});

describe("behaviour-tree decision nodes", () => {
  test("the nodes validate, and bad ones are refused", () => {
    expect(validateBehaviorNode({ type: "llm_ask", question: "Is it safe?", yes: { type: "noop" }, no: { type: "wander" } }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "llm_pick", question: "Who?", from: "people_here", act: "speak", content: "{person}, a word?" }).ok).toBe(true);
    expect(validateBehaviorNode({ type: "llm_pick", question: "Who?", from: "things_here", act: "speak", content: "hi" }).ok).toBe(false);
    expect(validateBehaviorNode({ type: "llm_say", gist: "" }).ok).toBe(false);
  });

  test("ask branches on the answer; while it thinks the tree holds instead of falling through", async () => {
    const f = fixture(() => '{"yes": false}');
    const tree: BehaviorNode = { type: "selector", children: [
      { type: "llm_ask", question: "Do you dare open the box tonight?", yes: { type: "action", action: { type: "think", content: "yes" } },
        no: { type: "action", action: { type: "think", content: "not tonight" } } },
      { type: "action", action: { type: "observe", target: "Hall" } }] };
    setAgentBehaviorPolicy(f.world, f.ada, tree);
    expect(evaluateBehaviorPolicy(f.world, f.ada).kind).toBe("pending");
    await settleDecisions(f.world);
    expect(evaluateBehaviorPolicy(f.world, f.ada)).toMatchObject({ kind: "action", action: { type: "think", content: "not tonight" } });
    expect(f.calls[0].prompt).toContain("Do you dare open the box tonight?");
  });

  test("pick chooses among the people here, then the line is said to them in the moment", async () => {
    const f = fixture(prompt => prompt.includes('"choice"') ? '{"choice": 1}' : '{"line": "Otis. Tuesday night — where were you?"}');
    setAgentBehaviorPolicy(f.world, f.ada, { type: "llm_pick", question: "Who do you corner about Tuesday?", from: "people_here", act: "speak", content: "{person}, where were you on Tuesday?" });
    expect(evaluateBehaviorPolicy(f.world, f.ada).kind).toBe("pending");
    await settleDecisions(f.world);
    expect(evaluateBehaviorPolicy(f.world, f.ada).kind).toBe("pending"); // picked; now wording the line
    await settleDecisions(f.world);
    const result = evaluateBehaviorPolicy(f.world, f.ada);
    const picked = (f.calls[0].prompt.match(/1\. (\w+)/) ?? [])[1];
    expect(result).toMatchObject({ kind: "action", action: { type: "speak", target: picked, content: "Otis. Tuesday night — where were you?" } });
    expect(f.calls[1].prompt).toContain(`${picked}, where were you on Tuesday?`);
    const pick = getDecisionLog(f.world).find(row => row.kind === "pick")!;
    expect(pick.options).toHaveLength(2);
    expect(pick.features?.filter(x => x.nearest)).toHaveLength(1);
  });

  test("with one thing to choose from there is no question", async () => {
    const f = fixture(() => '{"choice": 0}');
    createObjectEntity(f.world, { name: "Supplies box", roomId: f.room });
    setAgentBehaviorPolicy(f.world, f.ada, { type: "llm_pick", question: "What do you look at?", from: "things_here", act: "observe" });
    const first = evaluateBehaviorPolicy(f.world, f.ada);
    // One candidate needs no question.
    expect(first).toMatchObject({ kind: "action", action: { type: "observe", target: "Supplies box" } });
    expect(f.calls).toHaveLength(0);
  });
});

describe("slot hardening", () => {
  const choice = (index: number, features: Array<Record<string, boolean>>) => ({ index, features });
  test("a slot whose choices always follow one plain rule becomes that rule; varied or thin evidence does not", () => {
    const partner = [choice(1, [{ nearest: true }, { partner: true }]), choice(0, [{ partner: true, nearest: true }, {}]),
      choice(2, [{ nearest: true }, { liked: true }, { partner: true }])];
    expect(distillPickRule(partner)).toBeUndefined(); // too few
    expect(distillPickRule([...partner, ...partner])).toBe("partner");
    const varied = [...partner, ...partner, choice(0, [{ nearest: true }, { partner: true }])];
    expect(distillPickRule(varied)).toBeUndefined();
  });
});
