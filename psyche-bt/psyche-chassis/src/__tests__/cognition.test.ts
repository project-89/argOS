/**
 * Cognition Module Integration Tests
 *
 * Tests the new cognitive capabilities added by the Psyche Chassis:
 *   - BT-native hypothesis management
 *   - Intention generation and lifecycle
 *   - Metacognition (calibration, reflection)
 *   - Heartbeat (proactive loop)
 *   - Context builder (budget-aware assembly)
 *   - Brain stream (multi-surface broadcast)
 */

import { createPersonModel, setEmotionalState, setCurrentTopics, addMemory, addHypothesis } from "../ecs/person-store.js";
import { updateHypothesis, decayHypotheses, getBootstrapObservationPatterns } from "../cognition/hypothesis-bt.js";
import { generateIntention, approveIntention, completeIntention, getBootstrapIntentionPatterns } from "../cognition/intention-bt.js";
import { recordPredictionOutcome, quickReflection, deepReflection, getExplorationRateForDomain } from "../cognition/metacognition.js";
import { heartbeatTick, recordActivity, getAgentState } from "../cognition/heartbeat.js";
import { buildContext } from "../cognition/context-builder.js";
import { snapshotBrainState, registerSurface, unregisterSurface, broadcastBrainState } from "../surfaces/brain-stream.js";
import type { PersonModel } from "../ecs/types.js";

function makeModel(): PersonModel {
  const model = createPersonModel("test-cognitive");
  return model;
}

// =============================================================================
// HYPOTHESIS-BT
// =============================================================================

describe("Hypothesis-BT", () => {
  test("updateHypothesis creates new hypothesis with clamped confidence", () => {
    const model = makeModel();
    expect(model.hypotheses.length).toBe(0);

    updateHypothesis(model, "stress_pattern", 0.08, "Stressed about work deadline");

    expect(model.hypotheses.length).toBe(1);
    // New hypotheses are clamped to min(0.3, delta)
    expect(model.hypotheses[0].confidence).toBeLessThanOrEqual(0.3);
    expect(model.hypotheses[0].domain).toBe("stress_pattern");
    expect(model.hypotheses[0].evidence).toContain("Stressed about work deadline");
  });

  test("updateHypothesis accumulates evidence and confidence", () => {
    const model = makeModel();

    // Multiple observations
    updateHypothesis(model, "stress_work", 0.08, "Evidence 1");
    updateHypothesis(model, "stress_work", 0.08, "Evidence 2");
    updateHypothesis(model, "stress_work", 0.08, "Evidence 3");
    updateHypothesis(model, "stress_work", 0.08, "Evidence 4");

    expect(model.hypotheses.length).toBe(1);
    expect(model.hypotheses[0].evidence.length).toBe(4);
    // Should increase but be capped at 0.9
    expect(model.hypotheses[0].confidence).toBeGreaterThan(0.08);
    expect(model.hypotheses[0].confidence).toBeLessThanOrEqual(0.9);
  });

  test("confidence clamped at 0.6 without 3+ evidence items", () => {
    const model = makeModel();

    // Two high-delta updates
    updateHypothesis(model, "test", 0.10, "Strong evidence 1");
    updateHypothesis(model, "test", 0.10, "Strong evidence 2");

    // Should be capped at 0.6 with < 3 evidence items
    expect(model.hypotheses[0].confidence).toBeLessThanOrEqual(0.6);
    expect(model.hypotheses[0].evidence.length).toBe(2);
  });

  test("decayHypotheses reduces confidence over time", () => {
    const model = makeModel();
    updateHypothesis(model, "old_pattern", 0.10, "Old evidence");

    // Simulate passage of time
    model.hypotheses[0].lastUpdated = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 days ago
    const beforeConf = model.hypotheses[0].confidence;

    decayHypotheses(model, 0.01);

    expect(model.hypotheses[0].confidence).toBeLessThan(beforeConf);
  });

  test("decayHypotheses prunes near-zero hypotheses", () => {
    const model = makeModel();
    updateHypothesis(model, "dying", 0.01, "Weak evidence");
    model.hypotheses[0].confidence = 0.005; // Below prune threshold

    decayHypotheses(model);

    expect(model.hypotheses.length).toBe(0); // Pruned
  });

  test("bootstrap observation patterns are well-formed", () => {
    const patterns = getBootstrapObservationPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    for (const p of patterns) {
      expect(p.id).toBeTruthy();
      expect(p.channel).toBeTruthy();
      expect(p.conditions.length).toBeGreaterThan(0);
      expect(p.targetDomain).toBeTruthy();
    }
  });
});

// =============================================================================
// INTENTION-BT
// =============================================================================

describe("Intention-BT", () => {
  test("generateIntention creates exploratory intention as active", () => {
    const model = makeModel();
    const intention = generateIntention(model, "Research user's industry", "exploratory");

    expect(intention.status).toBe("active"); // Auto-approved
    expect(intention.scope).toBe("short_term");
    expect(model.intentions.length).toBe(1);
  });

  test("generateIntention creates emergent intention as forming", () => {
    const model = makeModel();
    const intention = generateIntention(model, "Draft meeting prep notes", "emergent");

    expect(intention.status).toBe("forming"); // Needs approval
    expect(model.intentions.length).toBe(1);
  });

  test("generateIntention creates explicit intention as forming with immediate scope", () => {
    const model = makeModel();
    const intention = generateIntention(model, "Write that email", "explicit");

    expect(intention.status).toBe("forming");
    expect(intention.scope).toBe("immediate");
  });

  test("approveIntention transitions status to active", () => {
    const model = makeModel();
    const intention = generateIntention(model, "Help with deck", "emergent");

    const result = approveIntention(model, intention.id);

    expect(result).toBe(true);
    expect(model.intentions[0].status).toBe("active");
  });

  test("completeIntention marks done with deliverables", () => {
    const model = makeModel();
    const intention = generateIntention(model, "Draft email", "explicit");
    approveIntention(model, intention.id);

    const result = completeIntention(model, intention.id, ["email_draft.md"]);

    expect(result).toBe(true);
    expect(model.intentions[0].status).toBe("completed");
    expect(model.intentions[0].deliverables).toEqual(["email_draft.md"]);
  });

  test("bootstrap intention patterns are well-formed", () => {
    const patterns = getBootstrapIntentionPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    for (const p of patterns) {
      expect(p.id).toBeTruthy();
      expect(p.conditions.length).toBeGreaterThan(0);
      expect(p.intentionClaim).toBeTruthy();
    }
  });
});

// =============================================================================
// METACOGNITION
// =============================================================================

describe("Metacognition", () => {
  test("recordPredictionOutcome tracks accuracy per domain", () => {
    const model = makeModel();

    recordPredictionOutcome(model, "work_stress", true);
    recordPredictionOutcome(model, "work_stress", true);
    recordPredictionOutcome(model, "work_stress", false);

    const cal = model.calibration.find(c => c.domain === "work_stress");
    expect(cal).toBeDefined();
    expect(cal!.totalPredictions).toBe(3);
    expect(cal!.correctPredictions).toBe(2);
    expect(cal!.accuracy).toBeCloseTo(0.667, 2);
  });

  test("quickReflection identifies strong and weak domains", () => {
    const model = makeModel();

    // Strong domain: 80% accuracy
    for (let i = 0; i < 10; i++) recordPredictionOutcome(model, "strong", i < 8);
    // Weak domain: 20% accuracy
    for (let i = 0; i < 10; i++) recordPredictionOutcome(model, "weak", i < 2);

    const reflection = quickReflection(model);

    expect(reflection.strongDomains).toContain("strong");
    expect(reflection.weakDomains).toContain("weak");
    expect(reflection.cognitiveHealth).toBeGreaterThan(0);
    expect(reflection.cognitiveHealth).toBeLessThanOrEqual(1);
  });

  test("getExplorationRateForDomain adapts to calibration", () => {
    const model = makeModel();

    // Unknown domain → high exploration
    expect(getExplorationRateForDomain(model, "unknown")).toBe(0.3);

    // Well-calibrated domain → low exploration
    for (let i = 0; i < 10; i++) recordPredictionOutcome(model, "known", true);
    expect(getExplorationRateForDomain(model, "known")).toBe(0.05);

    // Poorly-calibrated domain → high exploration
    for (let i = 0; i < 10; i++) recordPredictionOutcome(model, "bad", false);
    expect(getExplorationRateForDomain(model, "bad")).toBe(0.25);
  });

  test("deepReflection includes intention analysis", () => {
    const model = makeModel();

    // Add some intention history
    const i1 = generateIntention(model, "Help with presentation", "emergent");
    completeIntention(model, i1.id, ["slides.pptx"]);
    const i2 = generateIntention(model, "Draft email", "emergent");
    // Leave i2 as abandoned

    const reflection = deepReflection(model);
    expect(reflection.successfulIntentionPatterns).toContain("Help with presentation");
  });
});

// =============================================================================
// HEARTBEAT
// =============================================================================

describe("Heartbeat", () => {
  test("getAgentState returns active after recent message", () => {
    recordActivity();
    expect(getAgentState()).toBe("active");
  });

  test("heartbeatTick detects intention wakeups", async () => {
    const model = makeModel();
    generateIntention(model, "Check in on project", "emergent");

    const result = await heartbeatTick(model);

    expect(result.intentionWakeups.length).toBeGreaterThan(0);
    expect(result.state).toBe("active"); // Just called recordActivity
  });

  test("heartbeatTick runs reflection periodically", async () => {
    const model = makeModel();

    // Run enough ticks to trigger reflection (every 10th)
    let reflectionSeen = false;
    for (let i = 0; i < 11; i++) {
      const result = await heartbeatTick(model);
      if (result.reflection) reflectionSeen = true;
    }

    expect(reflectionSeen).toBe(true);
  });
});

// =============================================================================
// BRAIN STREAM
// =============================================================================

describe("Brain Stream", () => {
  test("snapshotBrainState captures current cognitive state", () => {
    const model = makeModel();
    setEmotionalState(model, "stressed");
    setCurrentTopics(model, ["work", "deadline"]);
    // Need multiple updates to cross the 0.3 confidence filter in snapshotBrainState
    updateHypothesis(model, "work_stress", 0.10, "Deadline pressure 1");
    updateHypothesis(model, "work_stress", 0.10, "Deadline pressure 2");
    updateHypothesis(model, "work_stress", 0.10, "Deadline pressure 3");
    updateHypothesis(model, "work_stress", 0.10, "Deadline pressure 4");

    const state = snapshotBrainState(model);

    expect(state.personId).toBe("test-cognitive");
    expect(state.emotionalState).toBe("stressed");
    expect(state.topics).toEqual(["work", "deadline"]);
    expect(state.hypotheses.length).toBeGreaterThan(0);
  });

  test("broadcastBrainState delivers to registered surfaces", async () => {
    const model = makeModel();
    const received: any[] = [];

    registerSurface({
      id: "test-surface",
      onBrainState: (state) => { received.push(state); },
      onNudge: () => {},
    });

    await broadcastBrainState(model);

    expect(received.length).toBe(1);
    expect(received[0].personId).toBe("test-cognitive");

    unregisterSurface("test-surface");
  });

  test("nudge signal generated for forming intentions", () => {
    const model = makeModel();
    generateIntention(model, "Prepare meeting notes", "emergent");

    const state = snapshotBrainState(model);

    expect(state.nudge).not.toBeNull();
    expect(state.nudge!.type).toBe("intention_ready");
  });
});

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

describe("Context Builder", () => {
  test("buildContext includes hypotheses and memories", () => {
    const model = makeModel();
    updateHypothesis(model, "work_style", 0.10, "Prefers concise communication");
    updateHypothesis(model, "work_style", 0.10, "Prefers concise communication 2");
    updateHypothesis(model, "work_style", 0.10, "Prefers concise communication 3");
    setCurrentTopics(model, ["work"]);
    addMemory(model, {
      type: "summary",
      content: "Discussed work deadline pressure",
      importance: 0.7,
      topics: ["work"],
      connections: [],
      timestamp: Date.now(),
    });

    // Build context without soul file (it won't exist in test env)
    const ctx = buildContext(model, "/nonexistent");

    // Should include hypotheses
    expect(ctx).toContain("Prefers concise communication");
    // Should include memories
    expect(ctx).toContain("work deadline pressure");
  });

  test("buildContext respects token budget", () => {
    const model = makeModel();

    // Add many hypotheses
    for (let i = 0; i < 50; i++) {
      updateHypothesis(model, `domain_${i}`, 0.10, `Hypothesis ${i} content that is quite long`);
    }

    const ctx = buildContext(model, "/nonexistent", {
      maxTokens: 500,
      soulTokens: 0,
      intentionTokens: 100,
      hypothesisTokens: 200,
      memoryTokens: 100,
      conversationTokens: 100,
    });

    // Context should be bounded
    expect(ctx.length).toBeLessThan(500 * 4 + 200); // Generous buffer
  });
});
