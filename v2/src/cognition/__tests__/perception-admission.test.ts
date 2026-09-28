import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Description, LastAction, Memory, Mind, Name, ObjectState, Perception, Traits } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeActions, runCognitionCycle } from "../cognition-system";
import { buildAgentContext, getAgentPerceptions } from "../agent-mind";
import { getAgentMemories } from "../knowledge-graph";
import { drainPendingStimuli, queueStimulus } from "../stimulus-queue";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { setLocatedIn } from "../../ecs/location";
import { recordCommittedSpeech } from "../social-memory";

function fixture() {
  const world = createArgosWorld("Perception admission"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Private identity", roomId: room });
  addComponent(world, actor, Traits); Traits.active[actor] = JSON.stringify(["blind", "deaf"]);
  return { world, room, actor, registry: createSystemRegistry() };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live perception calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); drainPendingStimuli(); });

test.each([false, true])("cognition filters raw queued inputs before memory and structured Perception (busy=%s)", async busy => {
  jest.useFakeTimers(); jest.setSystemTime(20_000);
  const f = fixture();
  const unregister = busy ? registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => false, busy: () => true, execute: () => false,
  }) : () => {};
  try {
    for (const event of [
      { type: "speech", content: "UNHEARD_SPEECH", source: "Ivo" },
      { type: "movement", content: "UNSEEN_MOVEMENT", source: "Ivo" },
      { type: "tool_result", modality: "auditory" as const, content: "UNHEARD_TOOL_MEMORY", source: "speaker" },
      { type: "tool_result", modality: "cognitive" as const, content: "OWN_TOOL_RESULT", source: "tool", timestamp: 10_000, intensity: 0.3 },
    ]) queueStimulus(f.world, { targetEid: f.actor, ...event });
    await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor], enablePlanning: false, maxAgents: 1, tick: 1 });
    const ids = getAgentPerceptions(f.world, f.actor), content = ids.map(id => Perception.content[id]).join("\n");
    expect(content).not.toMatch(/UNHEARD|UNSEEN/); expect(content).toContain("OWN_TOOL_RESULT");
    const result = ids.find(id => Perception.type[id] === "tool_result")!;
    expect(Perception.timestamp[result]).toBe(10_000); expect(Perception.intensity[result]).toBe(0.3);
    const memories = getAgentMemories(f.world, f.actor);
    expect(memories.map(id => Memory.content[id]).join("\n")).not.toContain("UNHEARD_TOOL_MEMORY");
    const memory = memories.find(id => Memory.content[id].includes("OWN_TOOL_RESULT"))!;
    expect(Memory.timestamp[memory]).toBe(10_000);
  } finally { unregister(); }
});

test("directed speech cannot arouse or redirect an actor who cannot hear it", () => {
  const f = fixture();
  const ivo = createAgentEntity(f.world, { name: "Ivo", role: "resident", systemPrompt: "Ivo", roomId: f.room });
  Mind.focus[f.actor] = "own task"; Mind.arousal[f.actor] = 0.25;
  executeActions(f.world, [{ eid: ivo, action: { type: "speak", target: "Mara", content: "Can you hear me?" } }], f.registry);
  expect(Mind.focus[f.actor]).toBe("own task"); expect(Mind.arousal[f.actor]).toBe(0.25);
  expect(drainPendingStimuli().filter(s => s.targetEid === f.actor)).toEqual([]);
});

test.each(["observe", "examine"])("native %s cannot bypass blindness with cognitive visual feedback", type => {
  const f = fixture(), target = addEntity(f.world);
  addComponent(f.world, target, Name); Name.value[target] = "Lamp";
  addComponent(f.world, target, Description); Description.value[target] = "UNSEEN_RED_GLASS";
  addComponent(f.world, target, ObjectState); ObjectState.current[target] = "UNSEEN_STATE";
  setLocatedIn(f.world, target, f.room);
  executeActions(f.world, [{ eid: f.actor, action: { type: type as "observe", target: "Lamp" } }], f.registry);
  expect(LastAction.success[f.actor]).toBe(false);
  const evidence = [...drainPendingStimuli().map(s => s.content), ...getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id])].join("\n");
  expect(evidence).toContain("unavailable without sight"); expect(evidence).not.toMatch(/UNSEEN_|examine Lamp closely/);
});

test.each(["observe", "interact"])("a custom package cannot intercept a blocked visual inspection (%s)", type => {
  const f = fixture(), execute = jest.fn(() => true);
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, { ready: () => true, busy: () => false, context: () => "", execute });
  try {
    executeActions(f.world, [{ eid: f.actor, action: { type: type as "observe", target: "UNKNOWN_TARGET", content: "examine" } }], f.registry);
    expect(execute).not.toHaveBeenCalled(); expect(LastAction.success[f.actor]).toBe(false);
    const content = getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id]).join("\n");
    expect(content).toContain("unavailable without sight"); expect(content).not.toContain("Visible here:");
  } finally { unregister(); }
});

test("foreground context hides unseen local descriptions, identities and objects but preserves own inventory and heard dialogue", () => {
  const f = fixture(); Traits.active[f.actor] = JSON.stringify(["blind"]);
  Description.value[f.room] = "UNSEEN_ROOM_PROSE";
  const silent = createAgentEntity(f.world, { name: "UNSEEN_PERSON", role: "SECRET_ROLE", systemPrompt: "Private", roomId: f.room });
  const ivo = createAgentEntity(f.world, { name: "Ivo", role: "UNHEARD_PRIVATE_ROLE", systemPrompt: "Private", roomId: f.room });
  const object = addEntity(f.world), held = addEntity(f.world);
  addComponent(f.world, object, Name); Name.value[object] = "UNSEEN_OBJECT"; setLocatedIn(f.world, object, f.room);
  addComponent(f.world, held, Name); Name.value[held] = "KNOWN_KEY"; setLocatedIn(f.world, held, f.actor);
  recordCommittedSpeech(f.world, ivo, "I am beside the door.", "Mara");
  const context = buildAgentContext(f.world, f.actor);
  expect(context).not.toMatch(/UNSEEN_|SECRET_ROLE|UNHEARD_PRIVATE_ROLE/);
  expect(context).toContain("KNOWN_KEY"); expect(context).toContain("I am beside the door.");
  expect(context).toContain("not established through sight");
  expect(context).not.toContain("No one else is present");
  expect(Name.value[silent]).toBe("UNSEEN_PERSON");
});
