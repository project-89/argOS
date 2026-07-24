import "dotenv/config";

import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Name, WorldClock, WorldEvent } from "../../ecs/components";
import { query } from "bitecs";
import { registerEntity } from "../cognition-system";
import {
  createWorldClock,
  advanceWorldClock,
  getCurrentPeriod,
  getCurrentDay,
  getClockState,
  createWorldEvent,
  getActiveWorldEvents,
  expireWorldEvents,
  formatWorldTimeForContext,
  getGoalBiases,
  PERIODS,
} from "../../systems/world-clock";
import {
  setAgentBehaviorPolicy,
  evaluateBehaviorPolicy,
  clearPolicyEvalHistory,
  validateBehaviorNode,
  type BehaviorNode,
} from "../behavior-policy";

function makeWorld() {
  const world = createArgosWorld("ClockTest") as any;
  initializePrefabs(world);
  return world;
}

describe("World Clock", () => {
  test("creates a clock entity with correct defaults", () => {
    const world = makeWorld();
    const clockEid = createWorldClock(world);

    expect(WorldClock.period[clockEid]).toBe("morning");
    expect(WorldClock.day[clockEid]).toBe(1);
    expect(WorldClock.tick[clockEid]).toBe(0);
    expect(WorldClock.ticksPerPeriod[clockEid]).toBe(20);
  });

  test("advances tick within a period", () => {
    const world = makeWorld();
    createWorldClock(world, { ticksPerPeriod: 10 });

    const changed = advanceWorldClock(world);
    expect(changed).toBeNull(); // No period change
    expect(getCurrentPeriod(world)).toBe("morning");

    const state = getClockState(world);
    expect(state.tickInPeriod).toBe(1);
    expect(state.totalTicks).toBe(1);
  });

  test("transitions through all periods", () => {
    const world = makeWorld();
    createWorldClock(world, { ticksPerPeriod: 5 });

    // Advance through morning (5 ticks)
    for (let i = 0; i < 4; i++) advanceWorldClock(world);
    expect(getCurrentPeriod(world)).toBe("morning");

    const changed = advanceWorldClock(world); // Tick 5 → transition
    expect(changed).toBe("midday");
    expect(getCurrentPeriod(world)).toBe("midday");

    // Advance through midday (5 ticks)
    for (let i = 0; i < 5; i++) advanceWorldClock(world);
    expect(getCurrentPeriod(world)).toBe("evening");

    // Advance through evening (5 ticks)
    for (let i = 0; i < 5; i++) advanceWorldClock(world);
    expect(getCurrentPeriod(world)).toBe("night");

    // Advance through night → new day
    for (let i = 0; i < 5; i++) advanceWorldClock(world);
    expect(getCurrentPeriod(world)).toBe("morning");
    expect(getCurrentDay(world)).toBe(2);
  });

  test("custom start period and day", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "evening", startDay: 3 });

    expect(getCurrentPeriod(world)).toBe("evening");
    expect(getCurrentDay(world)).toBe(3);
  });

  test("returns morning when no clock exists", () => {
    const world = makeWorld();
    expect(getCurrentPeriod(world)).toBe("morning");
    expect(getCurrentDay(world)).toBe(1);
  });
});

describe("World Events", () => {
  test("creates and queries events", () => {
    const world = makeWorld();
    createWorldClock(world);

    const festivalEid = createWorldEvent(world, {
      name: "Harvest Festival",
      eventType: "festival",
      description: "The village celebrates the harvest with music and dancing.",
      priority: 70,
      affectsGoals: { social: 3, craft: -1 },
    });

    const events = getActiveWorldEvents(world);
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("Harvest Festival");
    expect(events[0].eventType).toBe("festival");
    expect(events[0].priority).toBe(70);
    expect(events[0].affectsGoals.social).toBe(3);
  });

  test("events sorted by priority", () => {
    const world = makeWorld();
    createWorldClock(world);

    createWorldEvent(world, { name: "Rain", eventType: "weather", description: "Light rain.", priority: 20 });
    createWorldEvent(world, { name: "Festival", eventType: "festival", description: "Party!", priority: 80 });
    createWorldEvent(world, { name: "Market Day", eventType: "market", description: "Trading.", priority: 50 });

    const events = getActiveWorldEvents(world);
    expect(events[0].name).toBe("Festival");
    expect(events[1].name).toBe("Market Day");
    expect(events[2].name).toBe("Rain");
  });

  test("expires events after duration", () => {
    const world = makeWorld();
    createWorldClock(world, { ticksPerPeriod: 5 });

    createWorldEvent(world, { name: "Storm", eventType: "weather", description: "Thunder!", duration: 3 });

    expect(getActiveWorldEvents(world).length).toBe(1);

    // Advance past duration
    for (let i = 0; i < 4; i++) advanceWorldClock(world);
    const expired = expireWorldEvents(world);

    expect(expired).toBe(1);
    expect(getActiveWorldEvents(world).length).toBe(0);
  });

  test("permanent events (duration 0) don't expire", () => {
    const world = makeWorld();
    createWorldClock(world, { ticksPerPeriod: 5 });

    createWorldEvent(world, { name: "Plague", eventType: "crisis", description: "Ongoing plague.", duration: 0 });

    for (let i = 0; i < 20; i++) advanceWorldClock(world);
    expireWorldEvents(world);

    expect(getActiveWorldEvents(world).length).toBe(1);
  });
});

describe("Goal Biases", () => {
  test("morning biases toward work", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "morning" });

    const biases = getGoalBiases(world);
    expect(biases.craft).toBeGreaterThan(0);
    expect(biases.improve).toBeGreaterThan(0);
  });

  test("evening biases toward social", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "evening" });

    const biases = getGoalBiases(world);
    expect(biases.social).toBeGreaterThan(0);
    expect(biases.social).toBeGreaterThanOrEqual(2);
  });

  test("events add to biases", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "morning" });

    // Morning: social is -1
    const baseBiases = getGoalBiases(world);
    const baseSocial = baseBiases.social || 0;

    // Add festival: social +3
    createWorldEvent(world, {
      name: "Festival",
      eventType: "festival",
      description: "Party!",
      affectsGoals: { social: 3 },
    });

    const festivalBiases = getGoalBiases(world);
    expect(festivalBiases.social).toBe(baseSocial + 3);
  });
});

describe("Context Formatting", () => {
  test("formats time and events for agent context", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "evening" });

    createWorldEvent(world, {
      name: "Harvest Festival",
      eventType: "festival",
      description: "The village celebrates!",
      location: "Tavern",
    });

    const context = formatWorldTimeForContext(world);
    expect(context).toContain("EVENING");
    expect(context).toContain("Day 1");
    expect(context).toContain("socialize");
    expect(context).toContain("Harvest Festival");
    expect(context).toContain("Tavern");
  });
});

describe("BT Conditions: time_is and has_world_event", () => {
  test("time_is condition matches current period", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "evening" });

    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    // Tree: if evening → speak, else → observe
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "sequence", children: [
          { type: "condition", op: { type: "time_is", period: "evening" } },
          { type: "action", action: { type: "speak", content: "Good evening!" } },
        ]},
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("speak"); // Evening matches!
    }
  });

  test("time_is condition fails when period doesn't match", () => {
    const world = makeWorld();
    createWorldClock(world, { startPeriod: "morning" });

    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "sequence", children: [
          { type: "condition", op: { type: "time_is", period: "evening" } },
          { type: "action", action: { type: "speak", content: "Good evening!" } },
        ]},
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    const result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") {
      expect(result.action.type).toBe("observe"); // Morning ≠ evening → fallback
    }
  });

  test("has_world_event condition detects active events", () => {
    const world = makeWorld();
    createWorldClock(world);

    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");
    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    // No event yet
    const tree: BehaviorNode = {
      type: "selector",
      children: [
        { type: "sequence", children: [
          { type: "condition", op: { type: "has_world_event", eventType: "festival" } },
          { type: "action", action: { type: "speak", content: "Let's celebrate!" } },
        ]},
        { type: "action", action: { type: "observe" } },
      ],
    };

    setAgentBehaviorPolicy(world, agent, tree, true);
    clearPolicyEvalHistory(agent);

    let result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") expect(result.action.type).toBe("observe"); // No festival

    // Add festival
    createWorldEvent(world, { name: "Party", eventType: "festival", description: "Party!", priority: 80 });
    clearPolicyEvalHistory(agent);

    result = evaluateBehaviorPolicy(world, agent);
    expect(result.kind).toBe("action");
    if (result.kind === "action") expect(result.action.type).toBe("speak"); // Festival detected!
  });

  test("validates time_is and has_world_event nodes", () => {
    expect(validateBehaviorNode({
      type: "condition", op: { type: "time_is", period: "morning" },
    }).ok).toBe(true);

    expect(validateBehaviorNode({
      type: "condition", op: { type: "time_is", period: "" },
    }).ok).toBe(false);

    expect(validateBehaviorNode({
      type: "condition", op: { type: "has_world_event", eventType: "festival" },
    }).ok).toBe(true);

    expect(validateBehaviorNode({
      type: "condition", op: { type: "has_world_event" } as any,
    }).ok).toBe(false);
  });
});
