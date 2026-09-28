import { jest } from "@jest/globals";
import { Name, ObjectState, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { getCommittedEvents, publishCommittedEvent, startCommittedEvents, stopCommittedEvents, subscribeCommittedEvents } from "../../runtime/committed-events";
import { executeActions } from "../../cognition/cognition-system";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { snapshotCharacterAppearance } from "../character-appearance";
import { attachCommittedSceneRenderer } from "../attach-committed-renderer";
import { SourcePlaybackTimeline } from "../source-playback-timeline";
import type { SceneSnapshot } from "../scene-director";

function fixture() {
  const world = createArgosWorld("Actual renderer source"); world.meta.aiEnabled = false; world.meta.timedActions = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "PRIVATE_SYSTEM_PROMPT", roomId: room });
  const item = createObjectEntity(world, { name: "Brass spool", roomId: room, portable: true });
  const registry = createSystemRegistry();
  const scenes = (): SceneSnapshot[] => [{ sourceId: "package-source", sourceTick: world.time.tick, elapsedMs: world.time.elapsed,
    capturedWallMs: Date.now(), room: { id: room, name: Name.value[room], description: "A sheltered workshop." },
    actors: [{ id: actor, roomId: room, name: Name.value[actor], appearance: snapshotCharacterAppearance(world, actor)! }],
    props: [{ id: item, roomId: room, name: Name.value[item], description: "Brass spool",
      state: getDirectContainer(world, item) === actor ? "held" : "on floor", ...(getDirectContainer(world, item) === actor ? { heldBy: actor } : {}) }], events: [] }];
  return { world, room, actor, item, registry, scenes,
    step: (delta: number) => advanceSimulationTimeline(world, delta, { integrate: () => {} }) };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid renderer/model calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("native dispatch → exact physics boundary → H3 envelope → provider chunk maps the actual source", () => {
  const f = fixture(), attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 1000, captureScenes: f.scenes });
  expect(attached.renderer.next().status).toBe("buffering");
  executeActions(f.world, [{ eid: f.actor, action: { type: "pickup", target: "Brass spool" } }], f.registry);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
  f.step(1000); expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(attached.status().error).toBeNull();
  const result = attached.renderer.configure(); expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error();
  expect(result.configure.type).toBe("configure"); expect(result.configure.prompt_version).toBe(1);
  expect(result.segment.window.actions).toHaveLength(1);
  expect(result.segment.window.actions[0]).toMatchObject({ action: "pickup", startedAtSimMs: 0, completedAtSimMs: 800, status: "succeeded" });
  expect(result.segment.window.events.map(e => e.event.sequence)).toEqual([1, 2]);
  expect(result.segment.prompt).not.toContain("PRIVATE_SYSTEM_PROMPT");
  const playback = new SourcePlaybackTimeline(); playback.register(result.segment); playback.add({ chunk_index: 0, playback_seconds: 1, prompt_version: 1 });
  expect(playback.at(.799)).toMatchObject({ status: "mapped", sourceSimMs: 799, scene: { props: [{ state: "on floor" }] } });
  expect(playback.at(.8)).toMatchObject({ status: "mapped", sourceSimMs: 800, scene: { props: [{ state: "held" }] } });
  attached.stop(); clearSimulationTimeline(f.world);
});
test("actual native speech is sliced across source windows without prematurely completing the utterance", () => {
  const f = fixture(); f.world.meta.timedSpeech = true;
  const attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 8000, captureScenes: f.scenes });
  const words = Array.from({ length: 50 }, (_, i) => `token${String(i + 1).padStart(2, "0")}`);
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: words.join(" ") } }], f.registry);
  const heard: string[] = [], eventIds = new Set<string>();
  for (let index = 0; index < 3; index++) {
    f.step(8000); const result = attached.renderer.next();
    expect(attached.status().error).toBeNull(); expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error();
    expect(result.segment.window.actions).toHaveLength(1);
    expect(result.segment.window.actions[0].status).toBe(index === 2 ? "succeeded" : "pending");
    if (index < 2) expect(result.segment.window.actions[0]).not.toHaveProperty("completedAtSimMs");
    else expect(result.segment.window.actions[0].completedAtSimMs).toBe(20_300);
    for (const { event } of result.segment.window.events) {
      expect(eventIds.has(event.id)).toBe(false); eventIds.add(event.id);
      if (event.text) { heard.push(event.text.trim()); expect(event.interval).not.toHaveProperty("completedAtSimMs"); }
    }
    expect(heard).toEqual(words.slice(0, heard.length));
    if (index < 2) expect(result.segment.prompt).not.toContain("token50");
    attached.renderer.settle(result.segment.version, true);
  }
  expect(heard).toEqual(words);
  attached.stop(); clearSimulationTimeline(f.world);
});
test("source stop seals the attached tape and explicit restart makes a distinct epoch", () => {
  const f = fixture(), attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 1000, captureScenes: f.scenes });
  f.step(1000); const previous = attached.sourceId; stopCommittedEvents(f.world);
  expect(attached.status().stopped).toBe(true); expect(attached.renderer.history.assemble(1000, 2000, f.room).status).toBe("ended");
  const fresh = startCommittedEvents(f.world); expect(fresh).not.toBe(previous);
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
  f.step(1000); expect(attached.renderer.history.bounds().availableEndSimMs).toBe(1000);
  clearSimulationTimeline(f.world);
});
test.each([{ deltas: [4000] }, { deltas: [1000, 3000] }])("single-room capture preserves the actual departure interval with stepping $deltas", ({ deltas }) => {
  const f = fixture(); createRoomEntity(f.world, { name: "Remote kitchen" });
  const local = () => f.scenes().map(scene => ({ ...scene,
    actors: getRoomForEntity(f.world, f.actor) === f.room ? scene.actors : [] }));
  const attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 4000, captureScenes: local });
  executeActions(f.world, [{ eid: f.actor, action: { type: "move", target: "Remote kitchen" } }], f.registry);
  for (const delta of deltas) f.step(delta);
  const result = attached.renderer.next(); expect(attached.status().error).toBeNull();
  expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error();
  expect(result.segment.window.actions).toHaveLength(1);
  expect(result.segment.window.actions[0]).toMatchObject({ action: "move", startedAtSimMs: 0, visibleEndSimMs: 3000, status: "out_of_view" });
  expect(result.segment.window.actions[0]).not.toHaveProperty("completedAtSimMs"); // remote success stays remote
  expect(result.segment.prompt).not.toContain("Remote kitchen");
  expect(result.segment.window.events.map(e => e.event.status)).toEqual(["pending"]);
  attached.stop(); clearSimulationTimeline(f.world);
});
test("public event publication copies an allowlist, rejects private/future speech, and isolates listeners", () => {
  const f = fixture(); const observer = jest.fn(() => { throw new Error("UI observer failed"); }); subscribeCommittedEvents(f.world, observer);
  const base = { executionId: "work:1", kind: "action" as const, actorId: f.actor, roomId: f.room, action: "pickup", status: "pending" as const, startedAtSimMs: 0 };
  const event = publishCommittedEvent(f.world, { ...base, thoughts: "PRIVATE", expectedEndSimMs: 500 } as any);
  expect(observer).toHaveBeenCalledTimes(1); expect(Object.isFrozen(event)).toBe(true); expect(JSON.stringify(event)).not.toContain("PRIVATE");
  expect(() => publishCommittedEvent(f.world, { ...base, action: "read_message", text: "PRIVATE_MESSAGE" })).toThrow();
  expect(() => publishCommittedEvent(f.world, { ...base, kind: "speech", action: "speak", text: "FUTURE_WORDS" })).toThrow();
  expect(() => publishCommittedEvent(f.world, { ...base, completedAtSimMs: 1000 })).toThrow();
  expect(getCommittedEvents(f.world).events).toHaveLength(1);
});
test("recycled actor identity cannot relabel a historical event as a new person", () => {
  const f = fixture(), attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 1000, captureScenes: f.scenes });
  const published = publishCommittedEvent(f.world, { executionId: "old-voice", kind: "speech", actorId: f.actor, roomId: f.room,
    action: "speak", status: "succeeded", text: "OLD_PERSON_WORDS" });
  WorkingMemoryIdentity.id[f.actor] = "replacement:actor"; Name.value[f.actor] = "Replacement";
  f.step(1000); const result = attached.renderer.next(); expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error();
  expect(result.segment.window.events).toHaveLength(1);
  expect(result.segment.window.events[0]).toMatchObject({ event: { text: "OLD_PERSON_WORDS", actorKey: published.actorKey },
    actor: { id: f.actor, name: "Ada", identityKey: published.actorKey } });
  expect(result.segment.prompt).toContain('"actorAtEvent":{"id":' + f.actor + ',"identityKey":"' + published.actorKey + '","name":"Ada"}');
  expect(published.actorKey).not.toBe(WorkingMemoryIdentity.id[f.actor]);
  expect(result.segment.window.states[0].scene.actors[0].name).toBe("Ada");
  attached.stop(); clearSimulationTimeline(f.world);
});
test("a reused room ID cannot splice a different room lifetime into a continuous source interval", () => {
  const f = fixture(), attached = attachCommittedSceneRenderer(f.world, { roomId: f.room, windowMs: 1000, captureScenes: f.scenes });
  publishCommittedEvent(f.world, { executionId: "old-room-event", kind: "speech", actorId: f.actor, roomId: f.room,
    action: "speak", status: "succeeded", text: "Words in the original workshop" });
  WorkingMemoryIdentity.id[f.room] = "replacement:room"; Name.value[f.room] = "Different room";
  f.step(1000);
  expect(attached.status().error).toBeNull();
  expect(attached.renderer.next().status).toBe("room_unavailable");
  expect(attached.renderer.history.checkpoint().captures[0].scenes[0].room.name).toBe("Workshop");
  attached.stop(); clearSimulationTimeline(f.world);
});
