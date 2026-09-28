import { jest } from "@jest/globals";
import type { OfficeProcessJob } from "../../office-tools/async-jobs";
const incoming: OfficeProcessJob[] = [];
const actualJobs = await import("../../office-tools/async-jobs");
jest.unstable_mockModule("../../office-tools/async-jobs", () => ({ ...actualJobs, drainCompletedOfficeJobs: () => incoming.splice(0) }));

const { addComponent, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { Goal, LastAction, LastToolResult, PendingToolJob, Plan, ToolResult } = await import("../../ecs/components");
const { HasToolResult } = await import("../../ecs/relations");
const { createSystemRegistry, registerSystem, runSystems } = await import("../../ecs/dynamic-systems");
const { createGoalEvaluationSystem } = await import("../builtin-systems");
const { createOfficeToolJobSystem } = await import("../office-tool-job-system");
const { createPlanEntity } = await import("../../cognition/planning-system");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { setGoalContract } = await import("../../cognition/goal-contract");
const { registerAsyncAction, takeAsyncAction } = await import("../../cognition/async-action-evidence");
const { recordCommittedSpeech } = await import("../../cognition/social-memory");
const { applyCoordinationReviews, captureCoordinationAction, captureCoordinationWork, getCoordinationMemory } = await import("../../cognition/coordination-memory");
let sequence = 0;

function fixture() {
    const world = createArgosWorld("Office async evidence"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Workshop" });
    const actor = createAgentEntity(world, { name: "Mara", role: "keeper", systemPrompt: "Test", roomId: room });
    const device = createObjectEntity(world, { name: "Workstation", roomId: room });
    const registry = createSystemRegistry();
    const office = createOfficeToolJobSystem(); office.frequency = 0; registerSystem(registry, office);
    const evaluator = createGoalEvaluationSystem(); evaluator.frequency = 0; registerSystem(registry, evaluator);
    function plan(command = "node old.cjs", priority = 5, description = "Verify the command passes") {
        const goal = createIntentGoal(world, actor, `Run ${command}`, priority);
        setGoalContract(world, goal, { version: 1, kind: "use_affordance", params: {}, success: { type: "did_interact", targetName: "Workstation", affordance: "run_command" } });
        const action = { type: "interact" as const, target: "Workstation", content: `run_command ${command}` };
        const id = createPlanEntity(world, actor, goal, { goalDescription: `Run ${command}`, estimatedCompletion: "short", potentialObstacles: [], steps: [
            { description, actionType: "interact", target: action.target, content: action.content }, { description: "Observe afterward", actionType: "observe", target: "Workshop" },
        ] });
        return { goal, id, action, command };
    }
    function dispatch(p: ReturnType<typeof plan>, ok = true, registered = true, coordinated = false) {
        const jobId = `office-evidence-${++sequence}`;
        const ref = coordinated ? captureCoordinationWork(world, actor, getCoordinationMemory(world, actor).items.find(item => item.own)!.id) : undefined;
        const coordination = ref ? captureCoordinationAction(world, actor, ref, p.action) : undefined;
        if (registered) registerAsyncAction(world, jobId, { actorEid: actor, action: p.action, goalEid: p.goal, plan: { planEid: p.id, goalEid: p.goal, currentStep: 0 },
            coordination });
        addComponent(world, actor, PendingToolJob); PendingToolJob.jobId[actor] = jobId; PendingToolJob.command[actor] = p.command;
        addComponent(world, actor, LastAction); LastAction.type[actor] = "interact"; LastAction.target[actor] = "Workstation"; LastAction.content[actor] = p.action.content; LastAction.success[actor] = false; LastAction.timestamp[actor] = Date.now();
        const job: OfficeProcessJob = { jobId, actorEid: actor, deviceEid: device, toolId: "terminal.run", command: "node helper.cjs", cwd: ".", startedAt: Date.now(), status: "completed",
            result: { ok, summary: ok ? "Completed" : "Failed", stdout: "Evidence", stderr: "", exitCode: ok ? 0 : 1 } };
        return job;
    }
    function poll() { runSystems(world, registry, ++sequence, 1000); }
    return { world, actor, device, registry, plan, dispatch, poll };
}
beforeEach(() => { incoming.splice(0); });

test("registered completion produces canonical successful action and typed goal evidence only after completion", () => {
    const f = fixture(); const p = f.plan(); const job = f.dispatch(p);
    expect(LastAction.success[f.actor]).toBe(false); expect(Goal.status[p.goal]).toBe("active");
    incoming.push(job); f.poll();
    expect(LastAction.success[f.actor]).toBe(true); expect(LastAction.content[f.actor]).toBe(p.action.content);
    expect(Goal.status[p.goal]).toBe("completed"); expect(Plan.currentStep[p.id]).toBe(1);
    const evidence = getRelationTargets(f.world, f.actor, HasToolResult)[0];
    expect(ToolResult.goalEid[evidence]).toBe(p.goal); expect(ToolResult.command[evidence]).toBe(p.command);
});

test("completion advances its issuing plan, not a newer higher-priority plan with the same tool", () => {
    const f = fixture(); const old = f.plan("node old.cjs", 5); const job = f.dispatch(old);
    const urgent = f.plan("node urgent.cjs", 10);
    incoming.push(job); f.poll();
    expect(Plan.currentStep[old.id]).toBe(1); expect(Plan.currentStep[urgent.id]).toBe(0);
    const evidence = getRelationTargets(f.world, f.actor, HasToolResult)[0];
    expect(ToolResult.goalEid[evidence]).toBe(old.goal);
});

test("completion cannot advance a replacement plan even when its first command is identical", () => {
    const f = fixture(); const old = f.plan(); const job = f.dispatch(old); Plan.status[old.id] = "failed";
    const replacement = createPlanEntity(f.world, f.actor, old.goal, { goalDescription: "Replacement", estimatedCompletion: "short", potentialObstacles: [], steps: [
        { description: "Retry", actionType: "interact", target: old.action.target, content: old.action.content }, { description: "Observe", actionType: "observe", target: "Workshop" },
    ] });
    incoming.push(job); f.poll();
    expect(Plan.currentStep[replacement]).toBe(0);
});

test("unregistered jobs expose tool output without inventing an issuing goal or plan", () => {
    const f = fixture(); const p = f.plan(); incoming.push(f.dispatch(p, true, false)); f.poll();
    expect(LastToolResult.ok[f.actor]).toBe(true); expect(LastAction.success[f.actor]).toBe(false);
    expect(Plan.currentStep[p.id]).toBe(0); expect(Goal.status[p.goal]).toBe("active");
    const evidence = getRelationTargets(f.world, f.actor, HasToolResult)[0]; expect(ToolResult.goalEid[evidence]).toBe(-1);
});

test("an explicit diagnostic failure may advance its captured step but never creates success evidence", () => {
    const f = fixture(); const p = f.plan("node ci.cjs", 5, "Reproduce the failing test"); incoming.push(f.dispatch(p, false)); f.poll();
    expect(Plan.currentStep[p.id]).toBe(1); expect(LastAction.success[f.actor]).toBe(false); expect(Goal.status[p.goal]).toBe("active");
});

test("verification failure does not advance, and repeated failure invalidates only the issuing plan", () => {
    const f = fixture(); const p = f.plan(); incoming.push(f.dispatch(p, false)); f.poll();
    expect(Plan.currentStep[p.id]).toBe(0); expect(LastAction.success[f.actor]).toBe(false);
    const urgent = f.plan("node urgent.cjs", 10);
    incoming.push(f.dispatch(p, false)); f.poll();
    expect(Plan.status[p.id]).toBe("failed"); expect(Plan.status[urgent.id]).toBe("active");
});

test("registration is copied, first-issuance wins, and consumption is world-scoped and once-only", () => {
    const f = fixture(); const other = fixture(); const p = f.plan(); const jobId = `copy-${++sequence}`;
    const source = { actorEid: f.actor, action: { ...p.action }, goalEid: p.goal, plan: { planEid: p.id, goalEid: p.goal, currentStep: 0 } };
    expect(registerAsyncAction(f.world, jobId, source)).toBe(true); source.action.content = "CHANGED"; source.plan.currentStep = 99;
    expect(registerAsyncAction(other.world, jobId, source)).toBe(false); expect(takeAsyncAction(other.world, jobId)).toBeUndefined();
    expect(takeAsyncAction(f.world, jobId)).toMatchObject({ action: p.action, plan: { currentStep: 0 } });
    expect(takeAsyncAction(f.world, jobId)).toBeUndefined();
});

test("a different world's poll buffers a registered completion until its owner polls", () => {
    const owner = fixture(); const other = fixture(); const p = owner.plan(); incoming.push(owner.dispatch(p));
    other.poll(); expect(Plan.currentStep[p.id]).toBe(0);
    owner.poll(); expect(Plan.currentStep[p.id]).toBe(1);
    expect(getRelationTargets(other.world, other.actor, HasToolResult)).toHaveLength(0);
});

test("duplicate job completion is not re-applied to a subsequent plan step", () => {
    const f = fixture(); const p = f.plan(); const job = f.dispatch(p); incoming.push(job, job); f.poll();
    expect(Plan.currentStep[p.id]).toBe(1); expect(getRelationTargets(f.world, f.actor, HasToolResult)).toHaveLength(1);
});

test.each([true, false])("coordination for a background tool follows the captured job outcome (success=%s)", ok => {
    const f = fixture(), p = f.plan();
    const speech = recordCommittedSpeech(f.world, f.actor, "I will check the build and report back.")!;
    applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: speech.id, task: "Check the build", goalId: p.goal }]);
    const job = f.dispatch(p, ok, true, true);
    expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe("not_started");
    // A new priority does not steal this job's progress or failure.
    f.plan("node urgent.cjs", 10);
    incoming.push(job); f.poll();
    expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe(ok ? "in_progress" : "blocked");
    const after = getCoordinationMemory(f.world, f.actor);
    incoming.push(job); f.poll();
    expect(getCoordinationMemory(f.world, f.actor)).toEqual(after);
});
