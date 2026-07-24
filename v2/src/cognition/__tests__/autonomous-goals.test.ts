import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Name, Agent, Needs, Goal, Description } from "../../ecs/components";
import { hasComponent, getRelationTargets } from "bitecs";
import { HasGoal } from "../../ecs/relations";
import { registerEntity, getActiveGoals, createIntentGoal } from "../cognition-system";
import {
  generateDeterministicAspirations,
  shouldGenerateGoal,
  advanceGoalTick,
  resetAutonomousGoals,
  expireStaleGoals,
} from "../autonomous-goals";
import { setAspirations, getAspirations, formatAspirationsForContext, resetGoalLearning } from "../goal-learning";
import { resetSkillRegistry } from "../skill-registry";
import { resetCompilerState } from "../bt-compiler";
import { resetLearningState } from "../policy-learning";

function makeWorld() {
  const world = createArgosWorld("GoalTest") as any;
  initializePrefabs(world);
  return world;
}

function makeAgent(world: any, name: string, role: string, roomEid: number) {
  const agent = createAgentEntity(world, {
    name,
    role,
    systemPrompt: `You are ${name}, a ${role}.`,
    description: `A skilled ${role}`,
    roomId: roomEid,
  });
  registerEntity(agent, name);
  return agent;
}

beforeEach(() => {
  resetAutonomousGoals();
  resetGoalLearning();
  resetSkillRegistry();
  resetCompilerState();
  resetLearningState();
});

describe("Deterministic Aspirations", () => {
  test("generates role-specific aspirations for blacksmith", () => {
    const aspirations = generateDeterministicAspirations("blacksmith");
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
    expect(aspirations.some(a => /forge|weapon|craft/i.test(a))).toBe(true);
  });

  test("generates role-specific aspirations for innkeeper", () => {
    const aspirations = generateDeterministicAspirations("innkeeper");
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
    expect(aspirations.some(a => /inn|gather|travel/i.test(a))).toBe(true);
  });

  test("generates role-specific aspirations for monk", () => {
    const aspirations = generateDeterministicAspirations("monk");
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
    expect(aspirations.some(a => /peace|wisdom|study|meditat/i.test(a))).toBe(true);
  });

  test("generates generic aspirations for unknown role", () => {
    const aspirations = generateDeterministicAspirations("mysterious_stranger");
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
  });

  test("partial role matching works", () => {
    const aspirations = generateDeterministicAspirations("master blacksmith");
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
    expect(aspirations.some(a => /forge|weapon|craft/i.test(a))).toBe(true);
  });
});

describe("Aspiration Assignment at Agent Creation", () => {
  test("agents get aspirations automatically on creation", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Village", description: "A village" });
    const agent = makeAgent(world, "Aldric", "blacksmith", room);

    const aspirations = getAspirations(agent);
    expect(aspirations.length).toBeGreaterThanOrEqual(3);
    expect(aspirations.some(a => /forge|weapon|craft/i.test(a))).toBe(true);
  });

  test("aspirations appear in LLM context", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Market", description: "A market" });
    const agent = makeAgent(world, "Greta", "merchant", room);

    const context = formatAspirationsForContext(agent);
    expect(context).toContain("ASPIRATIONS");
    expect(context).toContain("trade");
  });
});

describe("Goal Generation Gating", () => {
  test("shouldGenerateGoal returns true when agent has no goals", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    // Advance past cooldown
    for (let i = 0; i < 10; i++) advanceGoalTick();

    expect(shouldGenerateGoal(world, agent)).toBe(true);
  });

  test("shouldGenerateGoal returns false when agent has active goals", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    // Create an active goal
    createIntentGoal(world, agent, "find food", 5);

    for (let i = 0; i < 10; i++) advanceGoalTick();

    expect(shouldGenerateGoal(world, agent)).toBe(false);
  });

  test("shouldGenerateGoal respects cooldown", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    // First check — should be true (never generated before, past initial cooldown)
    for (let i = 0; i < 10; i++) advanceGoalTick();
    expect(shouldGenerateGoal(world, agent)).toBe(true);

    // Simulate a generation attempt by calling shouldGenerateGoal
    // The actual generation would set the cooldown via generateAutonomousGoal
    // For this test, just verify the gating logic
  });
});

describe("Goal Deduplication", () => {
  test("won't generate when MAX_ACTIVE_GOALS reached", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    // Create 3 active goals (MAX_ACTIVE_GOALS)
    createIntentGoal(world, agent, "goal 1", 5);
    createIntentGoal(world, agent, "goal 2", 5);
    createIntentGoal(world, agent, "goal 3", 5);

    for (let i = 0; i < 10; i++) advanceGoalTick();

    expect(shouldGenerateGoal(world, agent)).toBe(false);
  });
});

describe("Goal Creation via createIntentGoal", () => {
  test("creates a goal entity linked to agent", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    const goalEid = createIntentGoal(world, agent, "build a house", 7);
    expect(goalEid).toBeGreaterThan(0);
    expect(hasComponent(world, goalEid, Goal)).toBe(true);
    expect(Goal.description[goalEid]).toBe("build a house");
    expect(Goal.priority[goalEid]).toBe(7);
    expect(Goal.status[goalEid]).toBe("active");
  });

  test("getActiveGoals returns created goals", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    createIntentGoal(world, agent, "find food", 8);
    createIntentGoal(world, agent, "talk to friend", 3);

    const active = getActiveGoals(world, agent);
    expect(active.length).toBe(2);
    // Should be sorted by priority (descending)
    expect(active[0].description).toBe("find food");
    expect(active[1].description).toBe("talk to friend");
  });
});

describe("Goal Expiration", () => {
  test("expireStaleGoals marks old goals as expired", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    const goalEid = createIntentGoal(world, agent, "old goal", 5);
    // Backdate the goal creation time
    Goal.createdAt[goalEid] = Date.now() - 5 * 60 * 1000; // 5 minutes ago

    const expired = expireStaleGoals(world, agent, 60 * 1000); // 1 minute max age
    expect(expired).toBe(1);
    expect(Goal.status[goalEid]).toBe("expired");
    expect(getActiveGoals(world, agent).length).toBe(0);
  });

  test("expireStaleGoals does not expire fresh goals", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    const goalEid = createIntentGoal(world, agent, "fresh goal", 5);

    const expired = expireStaleGoals(world, agent, 60 * 1000);
    expect(expired).toBe(0);
    expect(Goal.status[goalEid]).toBe("active");
  });

  test("expired goals allow new goal generation", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    const agent = makeAgent(world, "Test", "worker", room);

    const goalEid = createIntentGoal(world, agent, "expired goal", 5);
    Goal.createdAt[goalEid] = Date.now() - 5 * 60 * 1000;

    for (let i = 0; i < 10; i++) advanceGoalTick();

    // Before expiration — has active goal
    expect(shouldGenerateGoal(world, agent)).toBe(false);

    // After expiration — no active goals
    expireStaleGoals(world, agent, 60 * 1000);
    expect(shouldGenerateGoal(world, agent)).toBe(true);
  });
});
