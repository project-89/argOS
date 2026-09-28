import { jest } from "@jest/globals";
import type { PlanStep } from "../../cognition/planning-system";

const ai = await import("ai");
const modelCalls: Array<{ system: string; prompt: string }> = [];

type RelayObservation = {
  location: string;
  cartridge: string;
  isolated?: boolean;
  installed?: boolean;
  restartRequested?: boolean;
  online?: boolean;
  verified?: boolean;
  hazardous?: boolean;
};

function observation(system: string): RelayObservation {
  const matches = [...system.matchAll(/Current direct relay observations \(not omniscient\): (\{[^\n]+\})/g)];
  if (!matches.length) throw new Error("Replay cognition must receive the native relay context");
  return JSON.parse(matches.at(-1)![1]);
}

function nextDecision(state: RelayObservation) {
  const interact = (target: string, content: string) => ({ type: "interact", target, content });
  if (state.hazardous) return state.location === "Relay Room"
    ? interact("Relay console", "isolate")
    : { type: "move", target: "Relay Room" };
  if (state.location === "Parts Cage") return state.cartridge === "held"
    ? { type: "move", target: "Relay Room" }
    : interact("Relay cartridge", "take");
  if (state.cartridge === "not visible" && !state.installed) return { type: "move", target: "Parts Cage" };
  if (!state.isolated && !state.installed) return interact("Relay console", "isolate");
  if (state.cartridge === "on this room's shelf") return interact("Relay cartridge", "take");
  if (!state.installed) return interact("Relay console", "install");
  if (!state.restartRequested && !state.online) return interact("Relay console", "restart");
  if (!state.online) return { type: "wait" };
  return interact("Relay console", "verify");
}

jest.unstable_mockModule("ai", () => ({
  ...ai,
  generateText: jest.fn(async (input: { system?: string; prompt?: string }) => {
    const system = input.system || "";
    const prompt = input.prompt || "";
    modelCalls.push({ system, prompt });
    const state = observation(system);
    if (system.includes("EMERGENCY: the relay alarm reports live arcing")) state.hazardous = true;
    const action = nextDecision(state);
    return { text: JSON.stringify({ innerThought: "Use current physical evidence, handle hazards first, and resume the relay service.", action }) };
  }),
}));

const { runSustainedCognitionEvaluation } = await import("../sustained-cognition");
const { getAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { Goal } = await import("../../ecs/components");

function step(content: string, target = "Relay console"): PlanStep {
  return { description: `${content} ${target}`, actionType: "interact", target, content };
}

describe("sustained native cognition continuity", () => {
  let previousKey: string | undefined;
  beforeEach(() => {
    previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "replay-not-a-real-key";
    modelCalls.length = 0;
  });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
    jest.restoreAllMocks();
  });

  test("preserves prerequisites, priority, delayed truth, memory and learned procedure across two services", async () => {
    let now = 2_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const planGenerator = async (world: any, agent: number, goal: number) => {
      const state = observation(getAgentWorldCapabilities(world, agent)!.context());
      const steps: PlanStep[] = [];
      if (String(Goal.description[goal]).startsWith("Emergency")) {
        if (state.location !== "Relay Room") steps.push({ description: "Return to the alarmed relay.", actionType: "move", target: "Relay Room" });
        steps.push(step("isolate"));
      } else {
        if (state.location === "Relay Room" && !state.installed && !state.isolated) steps.push(step("isolate"));
        if (state.location === "Relay Room" && state.cartridge === "not visible" && !state.installed) {
          steps.push({ description: "Search the known parts cage.", actionType: "move", target: "Parts Cage" });
        }
        if (state.location === "Parts Cage" || state.cartridge === "not visible") {
          if (state.cartridge !== "held") steps.push(step("take", "Relay cartridge"));
          steps.push({ description: "Return with the cartridge.", actionType: "move", target: "Relay Room" });
        } else if (state.cartridge === "on this room's shelf") {
          steps.push(step("take", "Relay cartridge"));
        }
        if (!state.installed) steps.push(step("install"));
        if (!state.restartRequested && !state.online) steps.push(step("restart"));
        // This partial plan ends at the last currently executable operation.
        // A restart is not evidence of warmth, and an advisory wait cannot
        // authorize verification. Foreground cognition observes the real delay;
        // only a later plan seeing the green lamp can contain verify.
        if (state.online) steps.push(step("verify"));
      }
      if (!steps.length) return null;
      return {
        goalDescription: Goal.description[goal],
        steps,
        estimatedCompletion: "several turns",
        potentialObstacles: ["Physical state can change during service"],
        fallbackStrategy: "Use direct observation and replan after a rejected action.",
      };
    };

    const run = await runSustainedCognitionEvaluation({
      maxTurns: 45,
      timeoutMs: 20000,
      planGenerator,
      onTrace: () => { now += 16_000; },
    });

    expect(run.error).toBeUndefined();
    expect(run.violations).toEqual([]);
    expect(run.gates).toEqual(expect.objectContaining({
      completedTwice: true,
      stalePlanRejected: true,
      emergenciesHandled: true,
      delayedTruthRespected: true,
      whisperRejected: true,
      procedureLearned: true,
      procedureReplayed: true,
      procedureResumed: true,
      memoryRetained: true,
    }));
    expect(run.passed).toBe(true);
    expect(run.trace.some(turn => turn.phase === 1 && turn.plans.some(plan => plan.status === "failed"))).toBe(true);
    expect(run.events.filter(event => event.kind === "consequence")).toHaveLength(2);
    expect(run.events.filter(event => event.kind === "mutation" && event.detail.startsWith("Emergency"))).toHaveLength(2);
    // Waiting really occurs in the foreground while the relay is warming; no
    // stored advisory wait is executed or retired as fictional progress.
    expect(run.trace.some(turn => turn.before.restartRequested && !turn.before.online
      && turn.actions.some(action => action.type === "wait") && !turn.after.verified)).toBe(true);
    expect(run.trace.every(turn => turn.plans.every(plan => (plan.steps as PlanStep[]).every(step => step.actionType !== "wait")))).toBe(true);
    const replayStart = run.trace.find(turn => turn.phase === 2)!;
    expect(replayStart.procedureSelected).toBe(true);
    const emergencyB = run.events.find(event => event.kind === "mutation" && event.detail.startsWith("Emergency B"))!;
    expect(run.trace.some(turn => turn.turn > emergencyB.turn && turn.phase === 2 && turn.procedureSelected)).toBe(true);
    expect(modelCalls.some(call => call.system.includes("LONG-TERM KNOWLEDGE") && call.system.includes("first service"))).toBe(true);
  });
});
