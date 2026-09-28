import { jest } from "@jest/globals";
import { build } from "esbuild";
import { Name, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { executeActions } from "../../cognition/cognition-system";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { clearTimedSpeech, getSpeakingActivity, interruptTimedSpeech } from "../../cognition/timed-speech";
import { snapshotCharacterAppearance } from "../character-appearance";
import { attachCommittedSceneSource } from "../committed-scene-source";
import type { SceneSnapshot } from "../scene-snapshot";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
function fixture() {
  const world = createArgosWorld("Renderer-neutral source"); worlds.push(world); initializePrefabs(world);
  world.meta.aiEnabled = false; world.meta.timedActions = true; world.meta.timedSpeech = true;
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "PRIVATE_SYSTEM", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "PRIVATE_REMOTE", roomId: remote });
  const item = createObjectEntity(world, { name: "Spool", roomId: room, portable: true });
  const registry = createSystemRegistry();
  const scenes = (): SceneSnapshot[] => [room, remote].map(id => ({
    sourceId: "authored-surface", sourceTick: world.time.tick, elapsedMs: world.time.elapsed, capturedWallMs: Date.now(),
    room: { id, name: Name.value[id], description: "A public room." },
    actors: [actor, other].filter(eid => getRoomForEntity(world, eid) === id).map(eid => ({
      id: eid, roomId: id, name: Name.value[eid], appearance: snapshotCharacterAppearance(world, eid)!,
    })),
    props: getRoomForEntity(world, item) === id ? [{ id: item, roomId: id, name: "Spool", description: "Brass spool",
      ...(getDirectContainer(world, item) === actor ? { heldBy: actor } : {}) }] : [], events: [],
  }));
  return { world, room, remote, actor, other, item, registry, scenes,
    step: (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} }) };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model or media calls")); });
afterEach(() => {
  for (const world of worlds.splice(0)) { clearTimedSpeech(world); clearSimulationTimeline(world); stopCommittedEvents(world); }
  drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

test("independent pull cursors use sub-second windows; an expired slow reader never stalls source execution", () => {
  const f = fixture(), source = attachCommittedSceneSource(f.world, { captureScenes: f.scenes, historyLimits: { maxCaptures: 3 } });
  executeActions(f.world, [{ eid: f.actor, action: { type: "pickup", target: "Spool" } }], f.registry);
  f.step(250); const first = source.read(0, 250, f.room);
  expect(first.status).toBe("ready"); const firstEvidence = JSON.stringify(first);
  for (let at = 250; at < 2000; at += 250) {
    f.step(250); expect(source.read(at, at + 250, f.room).status).toBe("ready");
  }
  expect(f.world.time.elapsed).toBe(2000); expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(source.read(0, 250, f.room).status).toBe("expired");
  expect(JSON.stringify(first)).toBe(firstEvidence);
  expect(source.status()).toMatchObject({ stopped: false, error: null });
  expect(source.read(2000, 2250, f.room).status).toBe("buffering");
  expect(f.world.time.elapsed).toBe(2000); // Reads cannot manufacture source time.
});

test("the consumer handle exposes no writable tape or execution authority, and detaching it leaves other observers live", () => {
  const f = fixture(), a = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  const b = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  expect(Object.keys(a).sort()).toEqual(["bounds", "read", "readWorld", "sourceId", "status", "stop"]);
  expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.bounds())).toBe(true);
  f.step(250); a.stop(); f.step(250);
  expect(a.bounds()).toMatchObject({ stopped: true, availableEndSimMs: 250 });
  expect(a.read(0, 500, f.room).status).toBe("ended");
  expect(b.read(0, 500, f.room).status).toBe("ready");
  expect(getCommittedEvents(f.world).stopped).toBe(false);
});

test("source stop seals all observations; restart creates a new epoch without appending to old evidence", () => {
  const f = fixture(), old = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  f.step(250); stopCommittedEvents(f.world);
  expect(old.status().stopped).toBe(true);
  expect(() => attachCommittedSceneSource(f.world, { captureScenes: f.scenes })).toThrow(/explicitly start a new epoch/);
  expect(getCommittedEvents(f.world).sourceId).toBe(old.sourceId);
  expect(getCommittedEvents(f.world).stopped).toBe(true);
  startCommittedEvents(f.world);
  const next = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  expect(next.sourceId).not.toBe(old.sourceId);
  f.step(250);
  expect(old.bounds().availableEndSimMs).toBe(250);
  expect(next.read(250, 500, f.room).status).toBe("ready");
  expect(next.read(0, 250, f.room).status).toBe("expired");
});

test("interrupted native speech exports only the actually emitted prefix with stable speaker identity", () => {
  const f = fixture(), source = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  executeActions(f.world, [{ eid: f.actor, action: { type: "speak", content: "one two three four five six" } }], f.registry);
  f.step(1000); const voice = getSpeakingActivity(f.world, f.actor)!;
  expect(voice.spokenText.trim().length).toBeGreaterThan(0); expect(voice.spokenText).not.toContain("six");
  expect(interruptTimedSpeech(f.world, f.actor, "changed intention", { executionId: voice.executionId })).toBe(true);
  f.step(250); const window = source.read(0, 1250, f.room);
  expect(window.status).toBe("ready"); if (window.status !== "ready") throw new Error();
  const spoken = window.window.events.filter(({ event }) => event.text !== undefined);
  expect(spoken.map(({ event }) => event.text).join("")).toBe(voice.spokenText);
  expect(spoken.every(({ event, actor }) => event.actorKey === WorkingMemoryIdentity.id[f.actor]
    && actor?.name === "Ada" && actor.identityKey === event.actorKey)).toBe(true);
  expect(window.window.actions.find(action => action.executionId === voice.executionId)).toMatchObject({ status: "failed", completedAtSimMs: 1000 });
  expect(JSON.stringify(window)).not.toContain("six");
});

test("room-local reads preserve privacy and world reads preserve separate spatial scopes", () => {
  const f = fixture();
  const rich = () => f.scenes().map(scene => ({ ...scene, thoughts: "PRIVATE_THOUGHT", messageBody: "PRIVATE_TEXT",
    actors: scene.actors.map(actor => ({ ...actor, memories: ["PRIVATE_MEMORY"],
      appearance: { ...actor.appearance, possessedItems: [{ eid: 999, name: "HIDDEN_ITEM", description: "Concealed" }] } })) }));
  const source = attachCommittedSceneSource(f.world, { captureScenes: rich });
  f.step(250); const local = source.read(0, 250, f.room), whole = source.readWorld(0, 250);
  expect(local.status).toBe("ready"); expect(whole.status).toBe("ready");
  expect(JSON.stringify(local)).not.toContain('"Bo"');
  expect(JSON.stringify(whole)).not.toMatch(/PRIVATE_|HIDDEN_ITEM/);
  if (whole.status !== "ready") throw new Error();
  expect(whole.window.rooms.map(room => room.roomId)).toEqual([f.room, f.remote]);
  expect(whole.window.states[0].scenes.map(scene => scene.actors.map(actor => actor.name))).toEqual([["Ada"], ["Bo"]]);
});

test("capture failure seals only its observer, retaining failed evidence and leaving native world execution live", () => {
  const f = fixture(); let broken = false;
  const source = attachCommittedSceneSource(f.world, { captureScenes: () => { if (broken) throw new Error("capture broke"); return f.scenes(); } });
  const healthy = attachCommittedSceneSource(f.world, { captureScenes: f.scenes });
  f.step(250); broken = true; f.step(250);
  expect(source.status()).toMatchObject({ stopped: true, error: "capture_failed", errorDetail: "capture broke" });
  expect(source.read(0, 250, f.room).status).toBe("ready");
  expect(source.read(0, 500, f.room).status).toBe("ended");
  expect(healthy.read(0, 500, f.room).status).toBe("ready");
  expect(getCommittedEvents(f.world).stopped).toBe(false); expect(f.world.time.elapsed).toBe(500);
});

test("the neutral source dependency graph contains no H3 transport, camera director or prompt compiler", async () => {
  const compiled = await build({ entryPoints: ["src/rendering/committed-scene-source.ts"], bundle: true,
    platform: "node", format: "esm", packages: "external", write: false, metafile: true });
  const inputs = Object.keys(compiled.metafile!.inputs);
  expect(inputs).toContain("src/rendering/scene-snapshot.ts");
  for (const forbidden of [
    "src/rendering/director-projection.ts", "src/rendering/scene-director.ts", "src/rendering/committed-scene-renderer.ts",
    "src/demo/sitcom-screenplay.ts",
  ]) expect(inputs).not.toContain(forbidden);
  expect(inputs.filter(path => /(?:^|\/)(?:h3-|sitcom-)/.test(path))).toEqual([]);
});
