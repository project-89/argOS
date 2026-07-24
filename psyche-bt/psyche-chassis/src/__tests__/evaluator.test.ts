import { evaluateBT, countNodes, insertBranch } from "../bt/evaluator.js";
import { createPersonModel, addHypothesis, setEmotionalState, setCurrentTopics, addMessage } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import type { BehaviorNode } from "../bt/types.js";

function makeModel() {
  return createPersonModel("test-user");
}

describe("BT Evaluator", () => {
  test("simple action node returns action", async () => {
    const tree: BehaviorNode = {
      type: "action",
      action: { type: "respond", content: "Hello!" },
    };
    const result = await evaluateBT(tree, makeModel());
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.content).toBe("Hello!");
    }
  });

  test("selector returns first matching child", async () => {
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "noop" },
        { type: "action", action: { type: "respond", content: "Second" } },
        { type: "action", action: { type: "respond", content: "Third" } },
      ],
    };
    const result = await evaluateBT(tree, makeModel());
    expect(result.kind).toBe("action");
    if (result.kind === "action") expect(result.action.content).toBe("Second");
  });

  test("sequence requires all conditions to pass", async () => {
    const model = makeModel();
    setEmotionalState(model, "stressed");
    setCurrentTopics(model, ["work"]);

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "person_state", state: "stressed" } },
        { type: "condition", op: { type: "person_topic", topic: "work" } },
        { type: "action", action: { type: "respond", content: "I hear you about work stress." } },
      ],
    };

    const result = await evaluateBT(tree, model);
    expect(result.kind).toBe("action");
    if (result.kind === "action") expect(result.action.content).toContain("work stress");
  });

  test("sequence fails if any condition fails", async () => {
    const model = makeModel();
    setEmotionalState(model, "neutral"); // NOT stressed

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "person_state", state: "stressed" } },
        { type: "action", action: { type: "respond", content: "Shouldn't reach this" } },
      ],
    };

    const result = await evaluateBT(tree, model);
    expect(result.kind).toBe("none");
  });

  test("llm_escalate returns escalation signal", async () => {
    const tree: BehaviorNode = { type: "llm_escalate" };
    const result = await evaluateBT(tree, makeModel());
    expect(result.kind).toBe("escalate");
  });

  test("template_response returns template", async () => {
    const tree: BehaviorNode = {
      type: "template_response",
      template: "How's {project} going?",
      variables: ["project"],
    };
    const result = await evaluateBT(tree, makeModel());
    expect(result.kind).toBe("template");
    if (result.kind === "template") {
      expect(result.template).toContain("{project}");
    }
  });

  test("hypothesis_above condition checks confidence", async () => {
    const model = makeModel();
    addHypothesis(model, {
      domain: "humor",
      content: "Likes dry humor",
      confidence: 0.8,
      evidence: [],
      lastUpdated: Date.now(),
      source: "observation",
    });

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "hypothesis_above", domain: "humor", confidence: 0.7 } },
        { type: "action", action: { type: "respond", content: "Humor detected" } },
      ],
    };

    const result = await evaluateBT(tree, model);
    expect(result.kind).toBe("action");
  });

  test("hypothesis_above fails when confidence too low", async () => {
    const model = makeModel();
    addHypothesis(model, {
      domain: "humor",
      content: "Maybe likes humor",
      confidence: 0.3,
      evidence: [],
      lastUpdated: Date.now(),
      source: "observation",
    });

    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "hypothesis_above", domain: "humor", confidence: 0.7 } },
        { type: "action", action: { type: "respond", content: "Shouldn't fire" } },
      ],
    };

    const result = await evaluateBT(tree, model);
    expect(result.kind).toBe("none");
  });

  test("message_is_question detects questions", async () => {
    const tree: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "message_is_question" } },
        { type: "action", action: { type: "respond", content: "Good question!" } },
      ],
    };

    const result1 = await evaluateBT(tree, makeModel(), "What time is the meeting?");
    expect(result1.kind).toBe("action");

    const result2 = await evaluateBT(tree, makeModel(), "The meeting is at 3.");
    expect(result2.kind).toBe("none");
  });

  test("bootstrap tree escalates for new user", async () => {
    const model = makeModel();
    model.policy.tree = createBootstrapTree();

    // New user, no state — should escalate
    const result = await evaluateBT(model.policy.tree, model, "Hey, how's it going?");
    expect(result.kind).toBe("escalate");
  });

  test("bootstrap tree handles stressed user", async () => {
    const model = makeModel();
    model.policy.tree = createBootstrapTree();
    setEmotionalState(model, "stressed");

    const result = await evaluateBT(model.policy.tree, model, "I'm so overwhelmed");
    // Should match the stress handler
    expect(result.kind).toBe("template");
  });
});

describe("Tree Utilities", () => {
  test("countNodes counts correctly", () => {
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "sequence", children: [
          { type: "condition", op: { type: "always" } },
          { type: "action", action: { type: "respond", content: "hi" } },
        ]},
        { type: "llm_escalate" },
      ],
    };
    expect(countNodes(tree)).toBe(5);
  });

  test("insertBranch adds before llm_escalate", () => {
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "action", action: { type: "respond", content: "first" } },
        { type: "llm_escalate" },
      ],
    };
    const branch: BehaviorNode = {
      type: "action", action: { type: "respond", content: "inserted" },
    };
    const result = insertBranch(tree, branch);
    expect(result.type).toBe("selector");
    if (result.type === "selector") {
      expect(result.children.length).toBe(3);
      expect(result.children[1]).toEqual(branch);
      expect(result.children[2].type).toBe("llm_escalate");
    }
  });
});
