import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { captureLLMDecision, getCompilationStats, resetCompilerState, resolveDecision } from "../bt-compiler";
import { setAgentBehaviorPolicy } from "../behavior-policy";

beforeEach(() => resetCompilerState());
function fixture() {
    const world = createArgosWorld("Async decision proof"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Workshop" });
    const actor = createAgentEntity(world, { name: "Mara", role: "keeper", systemPrompt: "Test", roomId: room });
    setAgentBehaviorPolicy(world, actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
    return { world, actor };
}
test("an older job's success cannot train or consume a newer different decision", () => {
    const f = fixture();
    const old = { type: "interact", target: "Workstation", content: "run_command node old.cjs" };
    const fresh = { type: "interact", target: "Workstation", content: "run_command node new.cjs" };
    captureLLMDecision(f.world, f.actor, "New work", fresh as any, "run_command");
    resolveDecision(f.world, f.actor, true, old);
    expect(getCompilationStats(f.actor)).toMatchObject({ pendingDecision: true, compiledBranches: 0 });
    resolveDecision(f.world, f.actor, true, fresh);
    expect(getCompilationStats(f.actor)).toMatchObject({ pendingDecision: false, compiledBranches: 1 });
});
test("canonical verb punctuation matches, but substring arguments do not", () => {
    const f = fixture();
    captureLLMDecision(f.world, f.actor, "Run exact command", { type: "interact", target: "Workstation", content: "run_command: node test.cjs --exact" }, "run_command");
    resolveDecision(f.world, f.actor, true, { type: "interact", target: "Workstation", content: "run_command node test.cjs" });
    expect(getCompilationStats(f.actor).pendingDecision).toBe(true);
    resolveDecision(f.world, f.actor, false, { type: "interact", target: "workstation", content: "run_command node test.cjs --exact" });
    expect(getCompilationStats(f.actor)).toMatchObject({ pendingDecision: false, compiledBranches: 0 });
});
