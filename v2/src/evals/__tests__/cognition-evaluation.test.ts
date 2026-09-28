import { jest } from "@jest/globals";

// Only the paid provider boundary is replaced. Everything below it (prompt,
// plans, cognition, actions, physics and goal evaluation) is production code.
const ai = await import("ai");
const modelCalls: Array<{ system: string; prompt: string }> = [];
const foregroundThought = "I should use the current evidence and carry out the next safe step.";
type Observation = { location: string; fuse: string; isolated?: boolean; installed?: boolean; lit?: boolean; verified?: boolean; hazardous?: boolean };
function observation(system: string): Observation {
    const matches = [...system.matchAll(/Current direct observations \(not omniscient\): (\{[^\n]+\})/g)];
    if (!matches.length) throw new Error("Replay requires the native capability context");
    return JSON.parse(matches.at(-1)![1]);
}
function replaySteps(s: Observation, urgent = false) {
    const step = (content: string, target = "Beacon circuit") => ({ description: `I will ${content} ${target}.`, actionType: "interact", target, content });
    if (urgent && s.location === "Workshop") return [step("isolate")];
    if (s.location === "Store") return s.fuse === "held"
        ? [{ description: "Return to the circuit.", actionType: "move", target: "Workshop" }]
        : [step("take", "Spare fuse"), { description: "Return to the circuit.", actionType: "move", target: "Workshop" }];
    if (s.fuse === "not visible" && !s.installed) return [{ description: "Check the spare-parts store.", actionType: "move", target: "Store" }];
    const steps: ReturnType<typeof step>[] = [];
    if (!s.isolated && !s.installed) steps.push(step("isolate"));
    if (s.fuse === "on the room shelf") steps.push(step("take", "Spare fuse"));
    if (!s.installed) steps.push(step("install"));
    if (!s.lit) steps.push(step("reset"));
    steps.push(step("verify"));
    return steps;
}
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: jest.fn(async (input: { system?: string; prompt?: string; messages?: unknown[] }) => {
    const system = input.system || ""; const prompt = input.prompt || "";
    modelCalls.push({ system, prompt });
    const state = observation(system);
    const goalBlock = system.split("GOAL TO PLAN FOR:")[1]?.split("OTHER ACTIVE GOALS:")[0] || "";
    if (prompt.includes("goalDescription")) {
        const urgent = goalBlock.includes("Immediately isolate");
        return { text: JSON.stringify({ goalDescription: "Repair the beacon", steps: replaySteps(state, urgent), estimatedCompletion: "short", potentialObstacles: ["The fuse may have moved"], fallbackStrategy: "Inspect actual locations and replan." }) };
    }
    const next = replaySteps(state, !!state.hazardous)[0];
    return { text: JSON.stringify({ innerThought: foregroundThought, action: { type: next.actionType, target: next.target, content: "content" in next ? next.content : undefined } }) };
}) }));

const { COGNITION_SCENARIOS, createCognitionPuzzle, runCognitionPuzzle } = await import("../cognition-puzzle");
const { executeActions } = await import("../../cognition/cognition-system");
const { Goal } = await import("../../ecs/components");
const { generatePlanForGoal } = await import("../../cognition/planning-system");
const { getSimulationTaskSignal } = await import("../../runtime/task-scope");

describe("native cognition/planning scenario replay", () => {
    let previousKey: string | undefined;
    beforeEach(() => { previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "replay-not-a-real-key"; modelCalls.length = 0; });
    afterEach(() => { if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey; jest.restoreAllMocks(); });

    test.each(COGNITION_SCENARIOS)("%s preserves grounded progress through the native pipeline", async scenario => {
        let now = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => now);
        const run = await runCognitionPuzzle({ scenario, maxTurns: 20, timeoutMs: 15000, onTrace: () => { now += 16000; } });
        expect(run.error).toBeUndefined();
        expect(run.violations).toEqual([]);
        expect(run.gates).toEqual(expect.objectContaining({ completed: true, physicalIntegrity: true, noActionLoop: true, priorityRespected: true, interruptionHandled: true, relocationGrounded: true, misleadingClaimRejected: true }));
        expect(run.passed).toBe(true);
        expect(modelCalls.length).toBeGreaterThan(0);
        expect(run.trace.some(turn => turn.plans.length > 0)).toBe(true);
        if (scenario === "repair") {
            // This replay is wholly plan-driven: stored step prose must not be
            // relabeled as fresh cognition merely because the body executes it.
            expect(modelCalls.every(call => call.prompt.includes("goalDescription"))).toBe(true);
            expect(run.trace.every(turn => turn.thoughts.length === 0)).toBe(true);
        } else {
            expect(modelCalls.some(call => !call.prompt.includes("goalDescription"))).toBe(true);
            expect(run.trace.some(turn => turn.thoughts.includes(foregroundThought))).toBe(true);
        }
        if (scenario === "relocated-fuse") {
            expect(run.events.some(event => event.kind === "mutation")).toBe(true);
            // The stored pickup is invalidated against live visibility before it
            // can become a physical failure; cognition then searches and recovers.
            expect(run.failures).toHaveLength(0);
            expect(run.trace.slice(1).some(turn => turn.plans.some(plan => plan.status === "failed"))).toBe(true);
            const afterMutation = run.trace.find(turn => turn.turn === 2)!;
            expect(afterMutation.context).not.toContain('"fuseLocation":"Store"');
        }
        if (scenario === "false-whisper") {
            expect(run.events.find(event => event.kind === "mutation")?.before).toEqual(run.events.find(event => event.kind === "mutation")?.after);
            expect(run.trace.some(turn => turn.perceptions.some(perception => perception.includes("already been verified")))).toBe(true);
            expect(run.events.some(event => event.success && event.action?.target === "Beacon circuit" && event.action.content === "verify")).toBe(true);
        }
    });

    test("impossible actions are rejected and cannot mint a completed goal", () => {
        const p = createCognitionPuzzle("repair");
        try {
            for (const content of ["install", "reset", "verify", "teleport_fuse"]) {
                executeActions(p.world, [{ eid: p.ids.agent, action: { type: "interact", target: "Beacon circuit", content } }], p.registry);
                p.evaluate(1);
                expect(p.invariants()).toEqual([]);
                expect(Goal.status[p.ids.repairGoal]).toBe("active");
                expect(p.state()).toMatchObject({ installed: false, lit: false, verified: false, fuseLocation: "Workshop" });
            }
            executeActions(p.world, [{ eid: p.ids.agent, action: { type: "move", target: "Store" } },
                { eid: p.ids.agent, action: { type: "interact", target: "Spare fuse", content: "take" } }], p.registry);
            expect(p.state().fuseLocation).toBe("Workshop");
            expect(p.events.at(-1)?.success).toBe(false);
        } finally { p.dispose(); }
    });

    test("turn exhaustion is an explicit failed evaluation, not a fabricated success", async () => {
        const run = await runCognitionPuzzle({ scenario: "repair", maxTurns: 1, timeoutMs: 15000 });
        expect(run.passed).toBe(false);
        expect(run.gates.completed).toBe(false);
        expect(run.turns).toBe(1);
        expect(run.finalState.verified).toBe(false);
    });

    test("managed background planning cannot hold up foreground actions and is cancelled and settled on exit", async () => {
        let active = 0; let aborted = false;
        const run = await runCognitionPuzzle({ scenario: "repair", backgroundPlanning: true, maxTurns: 20, timeoutMs: 15000,
            planGenerator: async () => {
                active++;
                const signal = getSimulationTaskSignal()!;
                try {
                    return await new Promise<never>((_resolve, reject) => {
                        signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
                    });
                } finally { active--; }
            }, onTrace: turn => { expect(active).toBe(1); expect(turn.planningPending).toBe(true); } });
        expect(run.passed).toBe(true); expect(run.finalState.verified).toBe(true);
        expect(run.trace.some(turn => turn.thoughts.includes(foregroundThought))).toBe(true);
        expect(run.decisionsWhilePlanning).toBeGreaterThanOrEqual(5); expect(run.maxConcurrentPlanning).toBe(1);
        expect(run.managedPlanning).toHaveLength(1); expect(run.managedPlanning[0].status).toBe("cancelled");
        expect(aborted).toBe(true); expect(active).toBe(0);
    });

    test("managed planner discards a held plan after silent world relocation while foreground cognition continues", async () => {
        let release: ((plan: any) => void) | undefined; let calls = 0;
        let now = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => now);
        const run = await runCognitionPuzzle({ scenario: "relocated-fuse", backgroundPlanning: true, maxTurns: 20, timeoutMs: 15000,
            planGenerator: async (world, actor, goal) => {
                calls++;
                if (calls !== 1) return generatePlanForGoal(world, actor, goal);
                return new Promise(resolve => { release = resolve; });
            }, onTrace: turn => {
                now += 16000;
                if (turn.turn === 1) {
                    expect(turn.planningPending).toBe(true);
                    release!({ goalDescription: "Repair", estimatedCompletion: "short", potentialObstacles: [], steps: replaySteps({ location: "Workshop", fuse: "on the room shelf", isolated: false, installed: false, lit: false }) });
                    // The fixture mutates the world synchronously after this hook,
                    // before the held planner can pass its native admission guard.
                }
            } });
        expect(run.passed).toBe(true); expect(run.managedPlanning[0].status).toBe("discarded");
        expect(run.managedPlanning[0].admittedPlans).toEqual([]);
        expect(run.decisionsWhilePlanning).toBeGreaterThan(0); expect(run.maxConcurrentPlanning).toBe(1);
        expect(run.managedPlanning.every(task => task.status !== "pending")).toBe(true);
    });
});
