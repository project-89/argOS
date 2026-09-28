import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, LastAction, Plan, SocialMemory, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { getDirectContainer } from "../../ecs/location";
import { advanceSimulationTimeline, clearSimulationTimeline, isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents, subscribeCommittedEvents } from "../../runtime/committed-events";
import { executeActions } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { clearTimedSpeech, estimateSpeechDurationMs, getSpeakingActivity, interruptTimedSpeech } from "../timed-speech";
import { getSocialDialogue } from "../social-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Speech boundary tests are offline")); });
afterEach(() => {
  for (const world of worlds.splice(0)) { clearTimedSpeech(world); clearSimulationTimeline(world); stopCommittedEvents(world); }
  drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); worlds.push(world);
  world.meta.aiEnabled = false; world.meta.timedSpeech = true; world.meta.timedActions = true;
  const registry = createSystemRegistry(), room = createRoomEntity(world, { name: "Hall" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId: room });
  const ada = actor("Ada"), bo = actor("Bo");
  const key = createObjectEntity(world, { name: "Key", roomId: room, portable: true, traits: ["takeable"] });
  const advance = (delta: number) => advanceSimulationTimeline(world, delta, { integrate: () => {} });
  // These are the library's actual stop primitives, without unrelated runtime
  // timers. Crucially stop does not destroy the actors or their saved state.
  const stop = () => { clearTimedSpeech(world); clearSimulationTimeline(world); stopCommittedEvents(world); };
  return { world, registry, room, ada, bo, key, advance, stop };
}

test.each(["stop", "restart", "actor removal", "actor replacement", "package replacement", "interruption", "completion"] as const)(
  "a pending speech observer's %s cannot be overwritten by stale admission bookkeeping", mutation => {
    const f = fixture(), content = "The key is blue.";
    addComponent(f.world, f.ada, LastAction);
    LastAction.type[f.ada] = "observe"; LastAction.content[f.ada] = "previous committed action";
    LastAction.success[f.ada] = true; LastAction.timestamp[f.ada] = 123;
    const hooks: Array<{ content: string | undefined; success: boolean; pending: boolean }> = [];
    const capability = () => ({ context: () => "", ready: () => true, busy: () => false, execute: () => false,
      afterAction: (action: { content?: string }, success: boolean, pending: boolean) => { hooks.push({ content: action.content, success, pending }); } });
    let removePackage = registerAgentWorldCapabilities(f.world, f.ada, capability());
    const snapshot = () => ({ hasLastAction: hasComponent(f.world, f.ada, LastAction), type: LastAction.type[f.ada],
      content: LastAction.content[f.ada], success: LastAction.success[f.ada], timestamp: LastAction.timestamp[f.ada],
      workingRevision: WorkingMemory.revision[f.ada], hooks: hooks.map(hook => ({ ...hook })) });
    let atBoundary: ReturnType<typeof snapshot> | undefined;
    const remove = subscribeCommittedEvents(f.world, event => {
      if (event.kind !== "speech" || event.status !== "pending") return;
      switch (mutation) {
        case "stop": f.stop(); break;
        case "restart": f.stop(); startCommittedEvents(f.world); break;
        case "actor removal": removeEntity(f.world, f.ada); break;
        case "actor replacement": WorkingMemoryIdentity.id[f.ada] = "replacement actor lifetime"; break;
        case "package replacement": removePackage(); removePackage = registerAgentWorldCapabilities(f.world, f.ada, capability()); break;
        case "interruption": interruptTimedSpeech(f.world, f.ada, "operator interruption", { executionId: event.executionId }); break;
        case "completion": f.advance(estimateSpeechDurationMs(content)); break;
      }
      atBoundary = snapshot();
    });
    try {
      executeActions(f.world, [{ eid: f.ada, action: { type: "speak", target: "Bo", content } }], f.registry);
      expect(atBoundary).toBeDefined();
      expect(snapshot()).toEqual(atBoundary);
      expect(hooks.some(hook => hook.pending)).toBe(false);
      if (mutation === "completion") expect(hooks).toEqual([{ content, success: true, pending: false }]);
      else if (mutation === "interruption") expect(hooks).toEqual([{ content: "", success: false, pending: false }]);
      else expect(hooks).toEqual([]);
    } finally { remove(); removePackage(); }
  });

test("a stop triggered by self-interruption's terminal event cannot resurrect its proposed body continuation", () => {
  const f = fixture();
  executeActions(f.world, [{ eid: f.ada, action: { type: "speak", target: "Bo", content: "one two three four" } }], f.registry);
  f.advance(700);
  const executionId = getSpeakingActivity(f.world, f.ada)!.executionId;
  const remove = subscribeCommittedEvents(f.world, event => {
    if (event.executionId === executionId && event.status === "failed" && event.completedAtSimMs !== undefined) f.stop();
  });
  try {
    executeActions(f.world, [{ eid: f.ada, action: { type: "pickup", target: "Key", stopSpeechId: executionId } }], f.registry);
    expect(getCommittedEvents(f.world).stopped).toBe(true);
    expect(isSimulationResourceBusy(f.world, f.ada, "body")).toBe(false);
    expect(getSpeakingActivity(f.world, f.ada)).toBeUndefined();
    f.advance(10_000); // A fresh frame must not discover a callback born after stop.
    expect(getDirectContainer(f.world, f.key)).toBe(f.room);
    expect(getSocialDialogue(f.world, f.bo)).toHaveLength(0);
  } finally { remove(); }
});

test("speech terminal observers see settled dialogue and plan receipts; stopping there causes no post-stop completion writes", () => {
  const f = fixture(), content = "The key is blue.";
  const goal = addEntity(f.world); addComponent(f.world, goal, Goal); addComponent(f.world, f.ada, HasGoal(goal));
  Goal.description[goal] = "Tell Bo about the key"; Goal.status[goal] = "active"; Goal.priority[goal] = 10;
  Goal.progress[goal] = 0; Goal.createdAt[goal] = Date.now(); Goal.deadline[goal] = 0;
  const plan = createPlanEntity(f.world, f.ada, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Tell Bo", actionType: "speak", target: "Bo", content }, { description: "Pause", actionType: "wait" }] });
  const afterActions: Array<{ content: string | undefined; success: boolean; pending: boolean }> = [];
  const removePackage = registerAgentWorldCapabilities(f.world, f.ada, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    afterAction: (action, success, pending) => { if (action.type === "speak") afterActions.push({ content: action.content, success, pending }); } });
  const settled = () => ({ dialogue: getSocialDialogue(f.world, f.bo).map(turn => turn.content), planStep: Plan.currentStep[plan],
    actionSuccess: LastAction.success[f.ada], ownSocialRevision: SocialMemory.revision[f.ada],
    workingRevision: WorkingMemory.revision[f.ada], completionHooks: afterActions.filter(action => !action.pending).length });
  let seenAtTerminal: ReturnType<typeof settled> | undefined;
  const remove = subscribeCommittedEvents(f.world, event => {
    if (event.kind === "speech" && event.status === "succeeded" && event.completedAtSimMs !== undefined) {
      seenAtTerminal = settled(); f.stop();
    }
  });
  try {
    executeActions(f.world, [{ eid: f.ada, action: { type: "speak", target: "Bo", content } }], f.registry);
    expect(afterActions).toEqual([{ content: "", success: false, pending: true }]);
    f.advance(estimateSpeechDurationMs(content));
    expect(seenAtTerminal).toMatchObject({ dialogue: [content], planStep: 1, actionSuccess: true, completionHooks: 1 });
    expect(settled()).toEqual(seenAtTerminal);
    expect(afterActions.filter(action => !action.pending)).toEqual([{ content, success: true, pending: false }]);
    expect(getCommittedEvents(f.world).stopped).toBe(true);
  } finally { remove(); removePackage(); }
});
