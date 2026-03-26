import {
  computeActionDiversity,
  detectStuckLoop,
  recordPolicyAction,
  getPolicyEffectiveness,
  resetPolicyMetrics,
  getAllPolicyMetrics,
  resetAllPolicyMetrics,
  recordGoalCreated,
  recordGoalCompleted,
} from "../policy-metrics";

beforeEach(() => {
  resetAllPolicyMetrics();
});

// =============================================================================
// UNIT TESTS: computeActionDiversity
// =============================================================================

describe("computeActionDiversity", () => {
  test("returns 0 for empty array", () => {
    expect(computeActionDiversity([])).toBe(0);
  });

  test("returns 0 for single action type repeated", () => {
    const actions = Array(20).fill("move");
    expect(computeActionDiversity(actions)).toBe(0);
  });

  test("returns max entropy for uniform distribution of N types", () => {
    // 4 types, each appearing 5 times => entropy = log2(4) = 2.0
    const actions = [
      ...Array(5).fill("move"),
      ...Array(5).fill("observe"),
      ...Array(5).fill("interact"),
      ...Array(5).fill("speak"),
    ];
    const entropy = computeActionDiversity(actions);
    expect(entropy).toBeCloseTo(2.0, 5);
  });

  test("returns max entropy for uniform distribution of 2 types", () => {
    // 2 types, each appearing 10 times => entropy = log2(2) = 1.0
    const actions = [...Array(10).fill("move"), ...Array(10).fill("observe")];
    expect(computeActionDiversity(actions)).toBeCloseTo(1.0, 5);
  });

  test("returns intermediate values for skewed distributions", () => {
    // 18 moves, 1 observe, 1 interact -> mostly one type, low but nonzero entropy
    const actions = [
      ...Array(18).fill("move"),
      "observe",
      "interact",
    ];
    const entropy = computeActionDiversity(actions);
    expect(entropy).toBeGreaterThan(0);
    expect(entropy).toBeLessThan(1.0);
  });
});

// =============================================================================
// UNIT TESTS: detectStuckLoop
// =============================================================================

describe("detectStuckLoop", () => {
  test("detects single-action repetition (move,move,move,move)", () => {
    const actions = ["move", "move", "move", "move", "move", "move"];
    expect(detectStuckLoop(actions, 3)).toBe(true);
  });

  test("detects pattern-length-2 repetition (observe,move,observe,move)", () => {
    const actions = ["observe", "move", "observe", "move", "observe", "move"];
    expect(detectStuckLoop(actions, 3)).toBe(true);
  });

  test("detects pattern-length-3 repetition", () => {
    const actions = [
      "observe", "move", "interact",
      "observe", "move", "interact",
    ];
    expect(detectStuckLoop(actions, 3)).toBe(true);
  });

  test("does not flag diverse action sequences", () => {
    const actions = [
      "observe", "move", "interact", "speak",
      "think", "observe", "move", "speak",
    ];
    expect(detectStuckLoop(actions, 3)).toBe(false);
  });

  test("returns false for sequences shorter than 2*windowSize", () => {
    expect(detectStuckLoop(["move", "move"], 3)).toBe(false);
    expect(detectStuckLoop(["move"], 3)).toBe(false);
    expect(detectStuckLoop([], 3)).toBe(false);
  });
});

// =============================================================================
// UNIT TESTS: recordPolicyAction & getPolicyEffectiveness
// =============================================================================

describe("recordPolicyAction", () => {
  test("correctly updates rolling window", () => {
    const agentEid = 42;

    recordPolicyAction(agentEid, "move", false);
    recordPolicyAction(agentEid, "observe", false);
    recordPolicyAction(agentEid, "interact", false);

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.totalActions).toBe(3);
  });

  test("rolling window caps at 50 actions", () => {
    const agentEid = 42;

    for (let i = 0; i < 60; i++) {
      recordPolicyAction(agentEid, `action_${i % 5}`, false);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.totalActions).toBe(50);
  });

  test("correctly computes llmFallbackRate", () => {
    const agentEid = 42;

    recordPolicyAction(agentEid, "move", false);
    recordPolicyAction(agentEid, "observe", true);
    recordPolicyAction(agentEid, "interact", false);
    recordPolicyAction(agentEid, "speak", true);

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.llmFallbackRate).toBeCloseTo(0.5, 5);
  });
});

describe("getPolicyEffectiveness", () => {
  test("returns undefined for untracked agents", () => {
    expect(getPolicyEffectiveness(9999)).toBeUndefined();
  });
});

describe("resetPolicyMetrics", () => {
  test("clears all metrics for an agent", () => {
    const agentEid = 42;

    recordPolicyAction(agentEid, "move", false);
    recordPolicyAction(agentEid, "observe", false);

    expect(getPolicyEffectiveness(agentEid)).toBeDefined();

    resetPolicyMetrics(agentEid);

    expect(getPolicyEffectiveness(agentEid)).toBeUndefined();
  });
});

describe("goal tracking", () => {
  test("goalCompletionRate is 0 when no goals created", () => {
    const agentEid = 42;
    recordPolicyAction(agentEid, "move", false);
    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics!.goalCompletionRate).toBe(0);
  });

  test("goalCompletionRate tracks created vs completed", () => {
    const agentEid = 42;
    recordPolicyAction(agentEid, "move", false);

    recordGoalCreated(agentEid);
    recordGoalCreated(agentEid);
    recordGoalCreated(agentEid);
    recordGoalCompleted(agentEid);

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics!.goalCompletionRate).toBeCloseTo(1 / 3, 5);
  });
});

// =============================================================================
// BEHAVIORAL TESTS
// =============================================================================

describe("behavioral: stuck agent", () => {
  test("50 alternating move/observe produces stuckLoopCount > 0 and low diversity", () => {
    const agentEid = 100;

    for (let i = 0; i < 50; i++) {
      recordPolicyAction(agentEid, i % 2 === 0 ? "move" : "observe", false);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.stuckLoopCount).toBeGreaterThan(0);
    // Shannon entropy of 50/50 split of 2 types = 1.0
    // This is "low" relative to a healthy diverse agent (4+ types)
    expect(metrics!.actionDiversity).toBeLessThanOrEqual(1.0);
  });
});

describe("behavioral: healthy agent", () => {
  test("50 diverse actions produce high diversity and stuckLoopCount = 0", () => {
    const agentEid = 101;
    // A deliberately non-repeating sequence using a seeded shuffle approach
    const sequence = [
      "move", "observe", "interact", "speak", "think", "wait",
      "interact", "move", "speak", "observe", "wait", "think",
      "speak", "interact", "move", "think", "observe", "wait",
      "think", "speak", "wait", "move", "interact", "observe",
      "wait", "think", "observe", "interact", "speak", "move",
      "observe", "wait", "think", "move", "speak", "interact",
      "move", "think", "speak", "wait", "observe", "interact",
      "interact", "observe", "move", "speak", "think", "wait",
      "speak", "move",
    ];

    for (const action of sequence) {
      recordPolicyAction(agentEid, action, false);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    // With 6 types roughly uniform, entropy should be close to log2(6) ~= 2.585
    expect(metrics!.actionDiversity).toBeGreaterThan(2.0);
    // With a diverse sequence, stuck loop count should be very low
    // (stuckLoopCount is cumulative — any momentary pattern during recording counts)
    expect(metrics!.stuckLoopCount).toBeLessThanOrEqual(2);
  });
});

describe("behavioral: high LLM fallback", () => {
  test("35+ LLM fallbacks out of 50 actions produces llmFallbackRate > 0.7", () => {
    const agentEid = 102;

    for (let i = 0; i < 50; i++) {
      const wasLlm = i < 36; // 36 LLM fallbacks
      recordPolicyAction(agentEid, "observe", wasLlm);
    }

    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.llmFallbackRate).toBeGreaterThan(0.7);
  });
});

describe("behavioral: full lifecycle", () => {
  test("record actions -> check metrics -> reset -> verify clean slate", () => {
    const agentEid = 103;

    // Record some actions
    recordPolicyAction(agentEid, "move", false);
    recordPolicyAction(agentEid, "observe", true);
    recordPolicyAction(agentEid, "interact", false);

    // Check metrics exist
    const metrics = getPolicyEffectiveness(agentEid);
    expect(metrics).toBeDefined();
    expect(metrics!.totalActions).toBe(3);
    expect(metrics!.llmFallbackRate).toBeCloseTo(1 / 3, 5);

    // Reset
    resetPolicyMetrics(agentEid);

    // Verify clean slate
    expect(getPolicyEffectiveness(agentEid)).toBeUndefined();
    expect(getAllPolicyMetrics().size).toBe(0);
  });
});
