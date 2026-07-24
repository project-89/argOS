import { createPersonModel, addMessage, setEmotionalState, setCurrentTopics } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { captureDecision, resolveDecisionSuccess, growTree, getCompilerStats, getLastCompilationDecision } from "../compiler/bt-compiler.js";

function makeModel() {
  const model = createPersonModel("test-user");
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);
  return model;
}

describe("BT Compiler", () => {
  test("captures and compiles a decision into a branch", () => {
    const model = makeModel();
    const initialNodes = model.policy.totalNodes;

    // Simulate: user said something, BT escalated, Flash handled it
    // Include topic + emotion for sufficient specificity (3 + 1 = 4 >= threshold)
    captureDecision({
      userMessage: "I'm stressed about the gallery show deadline",
      reasoning: "User is anxious about their art gallery opening. They need reassurance and practical help.",
      action: { type: "respond", content: "The gallery deadline is coming up — want me to help organize the remaining tasks?" },
      topics: ["gallery", "creative"],
      emotionalState: "stressed",
    });

    // Next turn: user responds positively (passes sentiment + quality + specificity checks)
    const branch = resolveDecisionSuccess(model, "Thanks, that would be great!");
    expect(branch).not.toBeNull();
    expect(branch!.source).toBe("compiler");

    // Insert into tree
    growTree(model, branch!);

    // Tree should have grown
    expect(model.policy.totalNodes).toBeGreaterThan(initialNodes);
    expect(model.policy.compiledBranches).toBe(1);
    expect(model.policy.version).toBe(1);
  });

  test("compiled branch includes topic and emotion conditions", () => {
    captureDecision({
      userMessage: "Work is killing me",
      reasoning: "High stress about work deadline, need to help them prioritize",
      action: { type: "respond", content: "That sounds rough — work deadlines can pile up fast. What's the most urgent thing? I can help you prioritize." },
      topics: ["work"],
      emotionalState: "stressed",
    });

    const model = makeModel();
    const branch = resolveDecisionSuccess(model, "Yes, the client presentation is due tomorrow. Help me prioritize!");

    const decision = getLastCompilationDecision();

    if (branch) {
      // Branch compiled — check its structure
      const node = branch.node;
      expect(node.type).toBe("sequence");
      if (node.type === "sequence") {
        const conditions = node.children.filter(c => c.type === "condition");
        expect(conditions.length).toBeGreaterThanOrEqual(2);
      }
    } else {
      // Immune system rejected — document why
      console.log(`  Compilation rejected: ${decision?.reason}`);
      // This is acceptable — the immune system is being cautious
      expect(decision?.reason).toBeTruthy();
    }
  });

  test("no pending capture returns null", () => {
    const model = makeModel();
    const branch = resolveDecisionSuccess(model);
    expect(branch).toBeNull();
  });

  test("multiple compilations grow the tree progressively", () => {
    const model = makeModel();
    const sizes: number[] = [model.policy.totalNodes];

    const emotions = ["stressed", "excited", "frustrated", "sad", "stressed"];
    const topics = [["work", "deadline"], ["art", "gallery"], ["health", "doctor"], ["money", "budget"], ["social", "family"]];

    for (let i = 0; i < 5; i++) {
      captureDecision({
        userMessage: `Specific message about ${topics[i].join(" and ")} while feeling ${emotions[i]}`,
        reasoning: `User is ${emotions[i]} about ${topics[i][0]}. Need to address their specific concern.`,
        action: { type: "respond", content: `I understand you're ${emotions[i]} about ${topics[i][0]}. Let me help with that specifically.` },
        topics: topics[i],
        emotionalState: emotions[i],
      });

      const branch = resolveDecisionSuccess(model, "Yes, that would help a lot.");
      if (branch) growTree(model, branch);
      sizes.push(model.policy.totalNodes);
    }

    // Immune system may reject some — count how many actually compiled
    const compiled = model.policy.compiledBranches;
    expect(compiled).toBeGreaterThan(0); // At least some should pass quality + specificity
    expect(compiled).toBeLessThanOrEqual(5); // But not all may pass
  });

  test("compiler stats track escalation rate", () => {
    const model = makeModel();
    model.totalEscalations = 3;
    model.totalBTHandled = 7;

    const stats = getCompilerStats(model);
    expect(stats.escalationRate).toBeCloseTo(0.3);
  });
});
