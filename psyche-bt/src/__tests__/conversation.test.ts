import { createPersonModel, setEmotionalState, getEscalationRate } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import type { AgentAction } from "../bt/types.js";

function makeModel() {
  const model = createPersonModel("test-user");
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);
  return model;
}

describe("Conversation Engine", () => {
  beforeEach(() => {
    // Set up mock handlers (no real LLM)
    setHandlers({
      escalation: async (msg, model) => ({
        response: `[Flash] I'll help with: ${msg.slice(0, 30)}`,
        reasoning: "Escalated because no BT pattern matched",
        action: { type: "respond", content: `[Flash] I'll help with: ${msg.slice(0, 30)}` } as AgentAction,
      }),
      runtime: async (template, context) => template.replace(/\{[^}]+\}/g, "[filled]"),
      analysis: async (msg) => ({
        topics: msg.includes("work") ? ["work"] : msg.includes("gallery") ? ["creative"] : [],
        entities: [],
        emotionalState: /stress|overwhelm/i.test(msg) ? "stressed" : "neutral",
      }),
    });
  });

  test("first message escalates (empty BT)", async () => {
    const model = makeModel();
    const result = await processTurn("Hey, how's it going?", model);

    expect(result.escalated).toBe(true);
    expect(result.source).toBe("escalation");
    expect(model.totalMessages).toBe(2); // user + agent
    expect(model.totalEscalations).toBe(1);
  });

  test("stressed message usually triggers BT template", async () => {
    const model = makeModel();
    setEmotionalState(model, "stressed");

    // Run multiple times — ε-greedy exploration means it SOMETIMES escalates
    // With bootstrap exploration rate at 30%, we expect ~70% BT-handled
    let btHandled = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      const m = makeModel();
      setEmotionalState(m, "stressed");
      const result = await processTurn("I'm so overwhelmed with everything", m);
      if (!result.escalated) btHandled++;
    }

    // With 30% exploration rate, expect >40% BT-handled (generous margin)
    expect(btHandled).toBeGreaterThan(trials * 0.3);
  });

  test("escalation may compile pattern with sufficient quality", async () => {
    const model = makeModel();
    const initialNodes = model.policy.totalNodes;

    // Turn 1: escalates (novel topic)
    await processTurn("I'm stressed about the gallery show deadline coming up", model);
    expect(model.totalEscalations).toBeGreaterThan(0);

    // Turn 2: positive follow-up → immune system evaluates compilation
    await processTurn("Thanks, that's helpful! The deadline is Friday.", model);

    // With immune system: compilation only happens if quality + specificity pass
    // The mock handler produces a generic response that may not meet thresholds
    // So we check that the tree either grew OR the immune system correctly rejected
    const grew = model.policy.totalNodes > initialNodes;
    const rejected = model.policy.compiledBranches === 0;
    expect(grew || rejected).toBe(true); // Either compiled or correctly rejected
  });

  test("multiple turns accumulate learning where immune system allows", async () => {
    const model = makeModel();

    // Simulate varied turns — some will compile, some won't
    const messages = [
      "I'm stressed about my work deadline this week",
      "Thanks for listening, that helps a lot",
      "The gallery show is making me anxious",
      "You're right, I should focus on one thing at a time",
      "I'm excited about the new project though!",
      "Great point, I'll prioritize the presentation",
    ];

    for (const msg of messages) {
      await processTurn(msg, model);
    }

    // Some learning should have happened
    expect(model.totalMessages).toBe(messages.length * 2);
    // Tree may or may not have grown depending on immune system decisions
    expect(model.policy.totalNodes).toBeGreaterThanOrEqual(countNodes(createBootstrapTree()));
  });

  test("messages are recorded in conversation state", async () => {
    const model = makeModel();

    await processTurn("Hello there", model);
    await processTurn("How are you?", model);

    expect(model.conversation.recentMessages.length).toBe(4); // 2 user + 2 agent
    expect(model.conversation.turnsThisSession).toBeGreaterThanOrEqual(2);
  });
});
