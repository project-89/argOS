import { jest } from "@jest/globals";
import { addEntity, addComponent, removeEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { Agent, Name, Description, Needs, Room, Perception, Goal, GoalInactivityBudget, Plan, ObjectState } from "../../ecs/components";
import { readGoalInactivityBudget, setGoalInactivityBudget } from "../goal-inactivity-budget";
import { HasGoal, HasPerception, HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { withSimulationTask } from "../../runtime/task-scope";
import { createIntentGoal } from "../cognition-system";
import { markStandingIntention } from "../goal-lifecycle";
import { advanceGoalTick, generateAutonomousGoal, generateAspirations, generateDeterministicAspirations, resetAutonomousGoals, shouldGenerateGoal, hasPendingPersonalGoalReview, expireStaleGoals } from "../autonomous-goals";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { addMemory } from "../knowledge-graph";
import { recordPersonalConcern } from "../personal-concerns";
import { workingMemoryEntityRef } from "../working-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";

function fixture() {
  const world = createArgosWorld("autonomy"); world.meta.aiEnabled = true;
  const room = addEntity(world); addComponent(world, room, Room); addComponent(world, room, Name); Name.value[room] = "Hall";
  const agent = addEntity(world);
  for (const component of [Agent, Name, Description, Needs]) addComponent(world, agent, component);
  Name.value[agent] = "Mara"; Description.value[agent] = "A cautious lighthouse keeper";
  Agent.role[agent] = "keeper"; Agent.systemPrompt[agent] = "Curious but cautious."; Agent.active[agent] = true;
  Needs.hunger[agent] = 10; Needs.energy[agent] = 80; Needs.social[agent] = 50; Needs.comfort[agent] = 70;
  setLocatedIn(world, agent, room);
  return { world, agent, room, goals: () => getRelationTargets(world, agent, HasGoal) };
}
const response = { text: JSON.stringify({ goal: "Investigate the noise", motivation: "I heard something unusual", priority: 5, kind: "explore" }) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let previousKeys: Array<[string, string | undefined]>;

beforeEach(() => {
  resetAutonomousGoals();
  previousKeys = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"].map(key => [key, process.env[key]]);
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-no-network";
});
afterEach(() => { jest.useRealTimers(); for (const [key, value] of previousKeys) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

describe("Background autonomous goal validity", () => {
  const personalResponse = { text: JSON.stringify({ goal: "Decide how I want to spend this evening with my friends", motivation: "My plans changed and I want company", priority: 9, kind: "social" }) };
  function important(f: ReturnType<typeof fixture>, receipt = "read:1") {
    workingMemoryEntityRef(f.world, f.agent); startCommittedEvents(f.world);
    recordPersonalConcern(f.world, f.agent, { channel: "message:friend", evidenceIds: [receipt], appraisal: "An important plan changed", significance: "I value time with friends", importance: .9, appraisedAtSimMs: 0 });
  }
  test("an important experience can trigger one background personal review despite routine goals", async () => {
    const f = fixture(); for (let n = 0; n < 4; n++) createIntentGoal(f.world, f.agent, `Routine task ${n}`, 5);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(false); important(f);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
    const provider = jest.fn(async () => personalResponse);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).not.toBeNull();
    expect(f.goals()).toHaveLength(5); expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  test("personal review can decline a new goal without being retriggered by routine room chatter", async () => {
    const f = fixture(); createIntentGoal(f.world, f.agent, "Routine task", 5); important(f);
    const provider = jest.fn(async () => ({ text: '{"goal":null}' }));
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    advanceSimulationTime(f.world, 1, 40_000);
    const pid = addEntity(f.world); addComponent(f.world, pid, Perception); addComponent(f.world, f.agent, HasPerception(pid));
    Perception.type[pid] = "speech"; Perception.content[pid] = "A routine argument continues";
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(true); // Ordinary agenda may be reviewed after its cadence.
    expect(hasPendingPersonalGoalReview(f.world, f.agent)).toBe(false); // The handled concern itself is not replayed.
    important(f, "read:2"); expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
  });
  test("unrelated local churn does not veto a private personal intention or authorize a body action", async () => {
    const f = fixture(); createIntentGoal(f.world, f.agent, "Routine task", 5); important(f);
    const provider = jest.fn(async () => {
      const room = addEntity(f.world); addComponent(f.world, room, Room); setLocatedIn(f.world, f.agent, room);
      return personalResponse;
    });
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).not.toBeNull();
    expect(f.goals()).toHaveLength(2);
  });
  test.each(["new concern", "new goal", "new source"])("personal review rejects %s while in flight", async change => {
    const f = fixture(); createIntentGoal(f.world, f.agent, "Routine task", 5); important(f);
    const provider = jest.fn(async () => {
      if (change === "new concern") important(f, "read:2");
      if (change === "new goal") createIntentGoal(f.world, f.agent, "Another important intention", 9);
      if (change === "new source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
      return personalResponse;
    });
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(f.goals()).toHaveLength(change === "new goal" ? 2 : 1);
  });
  test("personal review cannot smuggle physical completion contracts or executable first actions", async () => {
    const f = fixture(); createIntentGoal(f.world, f.agent, "Routine task", 5); important(f);
    const provider = jest.fn(async () => ({ text: JSON.stringify({ ...JSON.parse(personalResponse.text), firstAction: { type: "move", target: "Elsewhere" } }) }));
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(f.goals()).toHaveLength(1);
  });
  test("the reserved personal-review capacity is bounded", () => {
    const f = fixture(); for (let n = 0; n < 6; n++) createIntentGoal(f.world, f.agent, `Routine task ${n}`, 5);
    important(f); expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
  });
  test("explicit noAI never calls either provider, and aspirations use the deterministic fallback", async () => {
    const f = fixture(); f.world.meta.aiEnabled = false;
    const provider = jest.fn(async () => response);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(await generateAspirations(f.world, f.agent, { generateText: provider as any })).toEqual(generateDeterministicAspirations("keeper"));
    expect(provider).not.toHaveBeenCalled(); expect(f.goals()).toHaveLength(0);
  });

  test("no configured provider key avoids goal generation", async () => {
    const f = fixture(); for (const [key] of previousKeys) delete process.env[key];
    const provider = jest.fn(async () => response);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  test.each(["new goal", "moved", "identity changed", "deactivated", "removed", "new attention", "AI disabled", "visible object removed"])(
    "discards a result after %s without creating another goal", async change => {
      const f = fixture(); const pending = deferred<typeof response>();
      const object = addEntity(f.world); addComponent(f.world, object, Name); Name.value[object] = "Phone"; setLocatedIn(f.world, object, f.room);
      const running = generateAutonomousGoal(f.world, f.agent, { generateText: (async () => pending.promise) as any });
      if (change === "new goal") createIntentGoal(f.world, f.agent, "Escape the fire", 10);
      if (change === "moved") { const room = addEntity(f.world); addComponent(f.world, room, Room); setLocatedIn(f.world, f.agent, room); }
      if (change === "identity changed") Agent.role[f.agent] = "sailor";
      if (change === "deactivated") Agent.active[f.agent] = false;
      if (change === "removed") removeEntity(f.world, f.agent);
      if (change === "new attention") {
        const perception = addEntity(f.world); addComponent(f.world, perception, Perception); addComponent(f.world, f.agent, HasPerception(perception));
        Perception.type[perception] = "danger"; Perception.content[perception] = "Smoke!"; Perception.timestamp[perception] = Date.now();
      }
      if (change === "AI disabled") f.world.meta.aiEnabled = false;
      if (change === "visible object removed") removeEntity(f.world, object);
      pending.resolve(response);
      expect(await running).toBeNull();
      if (change !== "removed") expect(f.goals()).toHaveLength(change === "new goal" ? 1 : 0);
    });

  test("cancellation prevents late goal admission even if the provider resolves", async () => {
    const f = fixture(); const pending = deferred<typeof response>(); const abort = new AbortController();
    const running = withSimulationTask(abort.signal, () => generateAutonomousGoal(f.world, f.agent, { generateText: (async () => pending.promise) as any }));
    abort.abort(); pending.resolve(response);
    expect(await running).toBeNull(); expect(f.goals()).toHaveLength(0);
  });

  test("one actor cannot issue overlapping autonomous requests even after cooldown", async () => {
    const f = fixture(); const pending = deferred<typeof response>(); const provider = jest.fn(async () => pending.promise);
    const running = generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    for (let i = 0; i < 10; i++) advanceGoalTick(f.world);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1); pending.resolve(response); await running;
  });

  test("another world's overlapping entity IDs and ticks do not consume or release this world's cooldown", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const a = fixture(); const b = fixture(); expect(a.agent).toBe(b.agent);
    advanceGoalTick(a.world); advanceGoalTick(b.world);
    const provider = jest.fn(async () => ({ text: "invalid JSON" }));
    await generateAutonomousGoal(a.world, a.agent, { generateText: provider as any });
    expect(shouldGenerateGoal(a.world, a.agent)).toBe(false); expect(shouldGenerateGoal(b.world, b.agent)).toBe(true);
    for (let i = 0; i < 10; i++) advanceGoalTick(b.world);
    expect(shouldGenerateGoal(a.world, a.agent)).toBe(false);
    for (let i = 0; i < 5; i++) advanceGoalTick(a.world);
    jest.setSystemTime(105_000);
    expect(shouldGenerateGoal(a.world, a.agent)).toBe(true);
  });

  test("provider work is bounded and a fresh valid result creates exactly one goal", async () => {
    const f = fixture(); const provider = jest.fn(async (_request: any) => response);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toMatchObject({ description: "Investigate the noise" });
    expect(f.goals()).toHaveLength(1); expect(Goal.status[f.goals()[0]]).toBe("active");
    const request = provider.mock.calls[0][0];
    expect(request).toMatchObject({ maxOutputTokens: 900, maxRetries: 0, providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test("aspirations from an obsolete identity are not returned", async () => {
    const f = fixture(); const pending = deferred<{ text: string }>();
    const running = generateAspirations(f.world, f.agent, { generateText: (async () => pending.promise) as any });
    Agent.role[f.agent] = "captain"; pending.resolve({ text: JSON.stringify({ aspirations: ["Keep the lighthouse lit"] }) });
    expect(await running).toEqual([]);
  });

  test.each(["invalid", "provider failure", "stale discard"])("%s has a five-second wall-clock backoff regardless of tick rate", async outcome => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); const provider = jest.fn(async () => {
      if (outcome === "provider failure") throw new Error("offline");
      if (outcome === "stale discard") { Agent.systemPrompt[f.agent] += " Revised."; return response; }
      return { text: "invalid JSON" };
    });
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    for (let i = 0; i < 1_000; i++) advanceGoalTick(f.world);
    jest.setSystemTime(104_999);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
    jest.setSystemTime(105_000); expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any }); expect(provider).toHaveBeenCalledTimes(2);
  });

  test("successful goal generation does not impose the failure backoff", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); await generateAutonomousGoal(f.world, f.agent, { generateText: (async () => response) as any });
    Goal.status[f.goals()[0]] = "completed";
    for (let i = 0; i < 5; i++) advanceGoalTick(f.world);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
  });

  test("an explicit no-goal result reviews unchanged input after thirty seconds, not every five", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(), provider = jest.fn(async () => ({ text: '{"goal":null}' }));
    expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    expect(f.goals()).toHaveLength(0);
    for (let i = 0; i < 1_000; i++) advanceGoalTick(f.world);
    for (const at of [105_000, 115_000, 129_999]) {
      jest.setSystemTime(at);
      advanceSimulationTime(f.world, f.world.time.tick + 1, at - 100_000 - f.world.time.elapsed);
      expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
      expect(await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any })).toBeNull();
    }
    expect(provider).toHaveBeenCalledTimes(1);
    jest.setSystemTime(130_000); advanceSimulationTime(f.world, f.world.time.tick + 1, 1);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    expect(provider).toHaveBeenCalledTimes(2); expect(f.goals()).toHaveLength(0);
  });

  test.each(["new perception", "visible state", "package context", "goal outcome", "urgent need"])("%s bypasses a successful no-goal quiet review", async change => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); let context = "The relay is repaired. The room is quiet.";
    registerAgentWorldCapabilities(f.world, f.agent, { context: () => context, ready: () => true, busy: () => false, execute: () => false });
    const object = addEntity(f.world); addComponent(f.world, object, Name); addComponent(f.world, object, ObjectState);
    Name.value[object] = "Phone"; ObjectState.current[object] = "silent"; setLocatedIn(f.world, object, f.room);
    const goal = createIntentGoal(f.world, f.agent, "Restore the relay", 7); Goal.status[goal] = "paused";
    const provider = jest.fn(async () => ({ text: '{"goal":null}' }));
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    for (let i = 0; i < 5; i++) advanceGoalTick(f.world);
    jest.setSystemTime(101_000); expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
    if (change === "new perception") {
      const p = addEntity(f.world); addComponent(f.world, p, Perception); addComponent(f.world, f.agent, HasPerception(p));
      Perception.type[p] = "danger"; Perception.source[p] = "smoke"; Perception.content[p] = "There is smoke under the door."; Perception.timestamp[p] = Date.now();
    }
    if (change === "visible state") ObjectState.current[object] = "ringing";
    if (change === "package context") context = "The repaired relay has tripped again.";
    if (change === "goal outcome") Goal.status[goal] = "completed";
    if (change === "urgent need") Needs.energy[f.agent] = 15;
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  test("a duplicate perceptual refresh, wall-clock ticks and fractional need drift do not undo a deliberate no-op", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture();
    const addReminder = () => {
      const p = addEntity(f.world); addComponent(f.world, p, Perception); addComponent(f.world, f.agent, HasPerception(p));
      Perception.type[p] = "speech"; Perception.source[p] = "Ivo"; Perception.content[p] = "The relay is repaired."; Perception.timestamp[p] = Date.now();
    };
    addReminder(); await generateAutonomousGoal(f.world, f.agent, { generateText: (async () => ({ text: '{"goal":null}' })) as any });
    for (let i = 0; i < 10; i++) advanceGoalTick(f.world);
    jest.setSystemTime(110_000); addReminder(); Needs.energy[f.agent] -= 0.1; advanceSimulationTime(f.world, f.world.time.tick + 1, 10_000);
    expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
  });

  test("a stale explicit no-goal response still receives the ordinary failure retry, not a new quiet window", async () => {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(), provider = jest.fn(async () => {
      Agent.systemPrompt[f.agent] += " Changed while deliberating.";
      return { text: '{"goal":null}' };
    });
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    for (let i = 0; i < 5; i++) advanceGoalTick(f.world);
    jest.setSystemTime(104_999); expect(shouldGenerateGoal(f.world, f.agent)).toBe(false);
    jest.setSystemTime(105_000); expect(shouldGenerateGoal(f.world, f.agent)).toBe(true);
  });

  test("background deliberation sees current package facts and completed goals alongside older memory", async () => {
    const f = fixture(); registerAgentWorldCapabilities(f.world, f.agent, {
      context: () => "CURRENT PHYSICAL FACT: the relay is repaired, power is on, and the lamp is lit.", ready: () => true, busy: () => false, execute: () => false,
    });
    const goal = createIntentGoal(f.world, f.agent, "Restore power to the reading lamp", 7); Goal.status[goal] = "completed";
    addMemory(f.world, f.agent, { type: "episodic", content: "Earlier, the relay was broken and the lamp was dark.", importance: 0.9, emotionalValence: -0.2, timestamp: 1 });
    const provider = jest.fn(async (_request: any) => ({ text: '{"goal":null}' }));
    await generateAutonomousGoal(f.world, f.agent, { generateText: provider as any });
    const context = provider.mock.calls[0][0].messages.map((m: any) => m.content).join("\n");
    expect(context).toContain("CURRENT PHYSICAL FACT: the relay is repaired, power is on, and the lamp is lit.");
    expect(context).toContain("completed: Restore power to the reading lamp");
    expect(context).toContain("Earlier, the relay was broken and the lamp was dark.");
  });
});

describe("Goal inactivity expiry", () => {
  function progressingFixture() {
    jest.useFakeTimers(); jest.setSystemTime(100_000);
    const f = fixture(); const goal = createIntentGoal(f.world, f.agent, "Repair the lighthouse", 7);
    const at = (wallMs: number) => { jest.setSystemTime(wallMs);
      advanceSimulationTime(f.world, f.world.time.tick + 1, wallMs - 100_000 - f.world.time.elapsed); };
    return { ...f, goal, at, expire: () => expireStaleGoals(f.world, f.agent, 60_000) };
  }

  test("inactivity does not extinguish an explicit standing desire, but episodic goals still expire", () => {
    const f = progressingFixture();
    const desire = createIntentGoal(f.world, f.agent, "Stay in touch with my friends", 6);
    Goal.kind[desire] = "social"; markStandingIntention(f.world, desire);
    f.at(3_700_000);
    expect(f.expire()).toBe(1); expect(Goal.status[f.goal]).toBe("expired");
    expect(Goal.status[desire]).toBe("active"); expect(Goal.progress[desire]).toBe(0);
    Goal.status[desire] = "retired";
    expect(f.expire()).toBe(0); expect(Goal.status[desire]).toBe("retired");
  });

  test("goal progress renews the inactivity lifetime, but a subsequent stall expires", () => {
    const f = progressingFixture(); expect(f.expire()).toBe(0);
    f.at(159_000); Goal.progress[f.goal] = 10; expect(f.expire()).toBe(0);
    f.at(218_000); Goal.progress[f.goal] = 20; expect(f.expire()).toBe(0);
    f.at(279_000); expect(f.expire()).toBe(1); expect(Goal.status[f.goal]).toBe("expired");
  });

  test("an explicit ECS inactivity budget applies to ordinary goals without renewing activity evidence", () => {
    const f = progressingFixture(); setGoalInactivityBudget(f.world, f.goal, 180_000);
    expect(f.expire()).toBe(0);
    f.at(161_000); expect(f.expire()).toBe(0);
    f.at(280_000); expect(f.expire()).toBe(0);
    f.at(280_001); expect(f.expire()).toBe(1);
    expect(Goal.progress[f.goal]).toBe(0);
  });

  test.each([undefined, 0, -1, NaN, Infinity, "180000"])("invalid/missing inactivity budget %s retains the default", timeout => {
    const f = progressingFixture(); setGoalInactivityBudget(f.world, f.goal, 180_000);
    GoalInactivityBudget.timeoutMs[f.goal] = timeout as number;
    f.at(161_000); expect(f.expire()).toBe(1);
  });

  test.each(["paused", "retired", "completed", "failed"])("an authored budget cannot reactivate %s work", status => {
    const f = progressingFixture(); setGoalInactivityBudget(f.world, f.goal, 180_000); Goal.status[f.goal] = status;
    f.at(161_000); expect(f.expire()).toBe(0); expect(Goal.status[f.goal]).toBe(status);
  });

  test.each(["createdAt", "kind", "paramsJson", "successJson"] as const)("changing %s invalidates the old budget even with a stale cached signature", field => {
    const f = progressingFixture(); setGoalInactivityBudget(f.world, f.goal, 180_000);
    const previousSignature = Goal.signature[f.goal];
    if (field === "createdAt") Goal.createdAt[f.goal] += 1;
    else Goal[field][f.goal] = `${Goal[field][f.goal]} changed`;
    expect(Goal.signature[f.goal]).toBe(previousSignature);
    expect(readGoalInactivityBudget(f.world, f.goal, 60_000)).toBe(60_000);
  });

  test("an explicit short budget is honored; reading does not renew it or alter the goal", () => {
    const f = progressingFixture(); setGoalInactivityBudget(f.world, f.goal, 10_000);
    Goal.priority[f.goal] = 9;
    const before = GoalInactivityBudget.goalIdentity[f.goal];
    expect(readGoalInactivityBudget(f.world, f.goal, 60_000)).toBe(10_000);
    expect(GoalInactivityBudget.goalIdentity[f.goal]).toBe(before);
    f.at(110_001); expect(f.expire()).toBe(1);
  });

  test("a new goal does not inherit policy data from an unowned reused SoA slot", () => {
    const f = progressingFixture();
    GoalInactivityBudget.timeoutMs[f.goal] = 180_000;
    GoalInactivityBudget.goalIdentity[f.goal] = JSON.stringify([Goal.createdAt[f.goal], Goal.description[f.goal], Goal.kind[f.goal], Goal.paramsJson[f.goal], Goal.successJson[f.goal]]);
    expect(readGoalInactivityBudget(f.world, f.goal, 60_000)).toBe(60_000);
  });

  test("old zero-progress goals still expire on the first observation", () => {
    const f = progressingFixture(); Goal.createdAt[f.goal] = 1;
    expect(f.expire()).toBe(1);
  });

  test("restored nonzero progress gets one bounded observation window when its age is unknown", () => {
    const f = progressingFixture(); Goal.createdAt[f.goal] = 1; Goal.progress[f.goal] = 40;
    expect(f.expire()).toBe(0);
    f.at(161_000); expect(f.expire()).toBe(1);
  });

  test("recent owned plan-step evidence preserves a restored goal and subsequent steps renew it", () => {
    const f = progressingFixture(); Goal.createdAt[f.goal] = 1;
    const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, f.agent, HasPlan(plan));
    Plan.goalEid[plan] = f.goal; Plan.status[plan] = "active"; Plan.currentStep[plan] = 1; Plan.lastUpdated[plan] = 99_000;
    expect(f.expire()).toBe(0);
    f.at(158_000); Plan.currentStep[plan] = 2; Plan.lastUpdated[plan] = 158_000; expect(f.expire()).toBe(0);
    f.at(217_000); expect(f.expire()).toBe(0);
    f.at(219_000); expect(f.expire()).toBe(1);
  });

  test("merely touching plan metadata without advancing a step does not keep a goal alive", () => {
    const f = progressingFixture(); const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, f.agent, HasPlan(plan));
    Plan.goalEid[plan] = f.goal; Plan.status[plan] = "active"; Plan.currentStep[plan] = 1; Plan.lastUpdated[plan] = 100_000;
    expect(f.expire()).toBe(0);
    f.at(150_000); Plan.lastUpdated[plan] = 150_000; expect(f.expire()).toBe(0);
    f.at(161_000); expect(f.expire()).toBe(1);
  });

  test("unowned plan progress is not evidence for extending a goal's lifetime", () => {
    const f = progressingFixture(); Goal.createdAt[f.goal] = 1;
    const plan = addEntity(f.world); addComponent(f.world, plan, Plan);
    Plan.goalEid[plan] = f.goal; Plan.status[plan] = "active"; Plan.currentStep[plan] = 2; Plan.lastUpdated[plan] = 100_000;
    expect(f.expire()).toBe(1);
  });
});
