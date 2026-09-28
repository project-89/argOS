import type { CharacterAppearanceSnapshot } from "../character-appearance";
import { SceneDirector, projectMultiCharacterScene, snapshotDirectorScene, type SceneActor, type SceneEvent, type SceneSnapshot } from "../scene-director";

test("only an explicit bounded public role crosses the visual snapshot boundary", () => {
  const source = scene();
  const actor = {...source.actors[0], publicRole:"host".repeat(100), role:"PRIVATE_ROLE", backstory:"PRIVATE_PAST"};
  const projected = snapshotDirectorScene({...source,actors:[actor]});
  expect(projected.actors[0].publicRole).toHaveLength(256);
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_ROLE|PRIVATE_PAST/);
  const absent = snapshotDirectorScene({...source,actors:[{...actor,publicRole:undefined}]});
  expect(absent.actors[0].publicRole).toBeUndefined();
});

function appearance(eid: number, name: string): CharacterAppearanceSnapshot {
  return {
    eid, name, identity: { height: "tall", build: "lean", hairColor: "black", hairStyle: "cropped",
      eyeColor: "brown", skinTone: "olive", age: "adult", distinguishing: "freckled face", description: "a freckled adult with cropped black hair" },
    clothing: "linen shirt", accessories: "", wornGarments: [], expression: "attentive", posture: "standing",
    condition: "rain-damp", visiblyHolding: "", possessedItems: [], heldItems: [], description: "public physical description",
  };
}
function actor(id: number, name: string, roomId = 10): SceneActor {
  return { id, roomId, name, appearance: appearance(id, name), position: { x: id, y: 0 } };
}
function scene(elapsedMs = 0, events: SceneEvent[] = []): SceneSnapshot {
  return { sourceId: "storm-house-test", sourceTick: elapsedMs, elapsedMs, capturedWallMs: 1700000000000 + elapsedMs,
    room: { id: 10, name: "Common room", description: "Enclosed room with an iron stove and wooden floor." },
    actors: [actor(1, "Mara"), actor(2, "Rowan"), actor(3, "Ivo")],
    props: [{ id: 11, roomId: 10, name: "Lantern", description: "a copper lantern", state: "unlit" }], events };
}
function speech(id: string, elapsedMs: number, actorId = 1, targetId = 2): SceneEvent {
  return { id, roomId: 10, sourceTick: elapsedMs, elapsedMs, kind: "speech", action: "speak", status: "succeeded",
    actorId, targetId, text: `${actorId} speaks aloud about the rain.` };
}

test("local projection includes every present actor and omits remote entities and private fields", () => {
  const source: any = scene();
  source.actors.push(actor(4, "REMOTE_ACTOR", 20));
  source.props.push({ id: 14, roomId: 20, name: "REMOTE_PROP", description: "off-stage" });
  source.actors[0].thought = "PRIVATE_THOUGHT_1138";
  source.actors[0].appearance.memory = "PRIVATE_MEMORY_1138";
  source.actors[0].appearance.possessedItems.push({ eid: 90, name: "CONCEALED_KEY", description: "SECRET_POCKET_ITEM" });
  source.events = [
    { ...speech("private", 0), kind: "thought", text: "PRIVATE_THOUGHT_1138" },
    { ...speech("message", 0), kind: "message", text: "PRIVATE_MESSAGE_1138" },
    { ...speech("future", 20), text: "FUTURE_SPEECH_1138" },
    { ...speech("remote", 0, 4), roomId: 20, text: "REMOTE_SPEECH_1138" },
  ];
  const director = new SceneDirector();
  const shot = director.observe(source)!;
  expect(shot.kind).toBe("establishing");
  expect(shot.scene.actors.map(a => a.name)).toEqual(["Mara", "Rowan", "Ivo"]);
  for (const value of ["PRIVATE_THOUGHT_1138", "PRIVATE_MEMORY_1138", "PRIVATE_MESSAGE_1138", "CONCEALED_KEY",
    "SECRET_POCKET_ITEM", "FUTURE_SPEECH_1138", "REMOTE_SPEECH_1138", "REMOTE_ACTOR", "REMOTE_PROP"])
    expect(JSON.stringify(shot)).not.toContain(value);
  expect(shot.prompt).toContain("painterly");
  expect(shot.prompt).toContain("read-only camera spirit");
  expect(shot.prompt).toContain("never changes the simulation");
  expect(source.actors[0].thought).toBe("PRIVATE_THOUGHT_1138");
});

test("a local exchange establishes both actors, respects dwell, then reverses over the listener's shoulder", () => {
  const director = new SceneDirector({ minDwellMs: 4000 });
  director.observe(scene());
  const hello = speech("hello", 1000);
  const held = director.observe(scene(1000, [hello]))!;
  expect(held.kind).toBe("establishing");
  expect(held.cut).toBe(false);
  expect(held.prompt).toContain(hello.text!);
  const pair = director.observe(scene(4000, [hello]))!;
  expect(pair.kind).toBe("two_shot");
  expect(pair.framing.subjectIds).toEqual([1, 2]);
  expect(director.observe(scene(5000, [hello]))).toBeNull();
  expect(director.observe(scene(8000, [hello]))).toBeNull();
  const reply = speech("reply", 8100, 2, 1);
  const reverse = director.observe(scene(8100, [hello, reply]))!;
  expect(reverse.kind).toBe("over_the_shoulder");
  expect(reverse.framing).toMatchObject({ subjectIds: [2, 1], foregroundActorId: 1, axis: "established-room-side" });
  expect(reverse.scene.actors).toHaveLength(3);
  expect(director.observe(scene(8500, [hello, reply]))).toBeNull();
});

test("an over-the-shoulder shot cannot keep a departed listener or invent a remote target", () => {
  const director = new SceneDirector({ minDwellMs: 0 });
  director.observe(scene());
  director.observe(scene(100, [speech("a", 100)]));
  expect(director.observe(scene(200, [speech("b", 200, 2, 1)]))!.kind).toBe("over_the_shoulder");
  const changed: any = scene(300, [speech("c", 300, 2, 1)]);
  changed.actors[0].roomId = 20;
  const left = director.observe(changed)!;
  expect(left.kind).toBe("wide");
  expect(left.framing.subjectIds).toEqual([2, 3]);
  expect(left.cue?.targetId).toBeUndefined();
  expect(left.prompt).not.toContain('"name":"Mara"');
  const single = director.observe({ ...changed, sourceTick: 400, elapsedMs: 400 })!;
  expect(single.kind).toBe("close_up");
  expect(single.framing.subjectIds).toEqual([2]);
});

test("wardrobe and condition update immediately without rewriting old snapshots or changing identity", () => {
  const initial: any = scene();
  initial.actors[0].appearance.wornGarments = [{ eid: 91, name: "Blue coat", description: "patched blue coat", slot: "outerwear" }];
  initial.actors[0].appearance.clothing = "linen shirt; patched blue coat";
  const director = new SceneDirector();
  director.observe(initial);
  const first = director.next();
  initial.actors[0].appearance.clothing = "linen shirt";
  initial.actors[0].appearance.wornGarments.length = 0;
  initial.actors[0].appearance.condition = "soaked sleeves";
  initial.elapsedMs = 100;
  initial.sourceTick = 1;
  const changed = director.observe(initial)!;
  expect(changed.cut).toBe(false);
  expect(changed.prompt).toContain("soaked sleeves");
  expect(changed.prompt).not.toContain("Blue coat");
  expect(first.scene.actors[0].appearance.wornGarments[0].name).toBe("Blue coat");
  expect(changed.scene.actors[0].appearance.identity).toEqual(first.scene.actors[0].appearance.identity);
  (changed.scene.actors[0].appearance as any).condition = "MUTATED_DELIVERY";
  expect(director.snapshot().shots.at(-1)!.scene.actors[0].appearance.condition).toBe("soaked sleeves");
});

test("pending and failed prop actions preserve outcomes and never authorize their content as dialogue", () => {
  const director = new SceneDirector({ minDwellMs: 0 });
  director.observe(scene());
  const pending: SceneEvent = { id: "pickup", roomId: 10, actorId: 1, targetId: 11, kind: "action", action: "pickup",
    status: "pending", text: "UNCOMMITTED_SUCCESS_OR_PRIVATE_ACTION_BODY", sourceTick: 1, elapsedMs: 1 };
  const shot = director.observe(scene(1, [pending]))!;
  expect(shot.kind).toBe("prop_insert");
  expect(shot.prompt).toContain('"status":"pending"');
  expect(shot.prompt).toContain("Pending actions have not succeeded");
  expect(shot.prompt).not.toContain("UNCOMMITTED_SUCCESS_OR_PRIVATE_ACTION_BODY");
  const failed = director.observe(scene(2, [{ ...pending, id: "failed", status: "failed", sourceTick: 2, elapsedMs: 2 }]))!;
  expect(failed.prompt).toContain('"status":"failed"');
  expect(failed.scene.props[0].heldBy).toBeUndefined();
  expect(failed.prompt).toContain("No spoken dialogue is authorized");
});

test("one pending projection replaces obsolete prompts while the issued version stays pinned and audit stays bounded", () => {
  const director = new SceneDirector({ historyLimit: 8 });
  director.observe(scene());
  expect(director.next().version).toBe(1);
  for (let index = 1; index <= 140; index++) {
    const changed: any = scene(index * 100);
    changed.actors[0].appearance.condition = `wet patch ${index}`;
    director.observe(changed);
  }
  expect(director.snapshot()).toMatchObject({ issued: 1, pending: 1, pendingVersion: 141,
    metrics: { sourceShots: 141, renderDeckCapacity: 1, renderDeckDepth: 1, inFlight: 1, outstanding: 2,
      supersededShots: 139, retainedHistory: 8, historyLimit: 8 } });
  expect(director.next().version).toBe(1);
  expect(() => director.next(141)).toThrow("never issued");
  const config = director.configure(1);
  expect(config).toMatchObject({ type: "configure", protocol_version: 1, prompt_version: 141, resolution: "480p" });
  expect(config.prompt).toContain("wet patch 140");
  expect(director.snapshot().shots.at(-1)).toMatchObject({ replaces: 140, compactedCount: 139, sourceId: "storm-house-test" });
  director.next(141);
  expect(director.snapshot().metrics.outstanding).toBe(0);
});

test("multi-room arbitration holds its room during dwell and then selects new local speech without merging rooms", () => {
  const director = new SceneDirector({ minDwellMs: 4000 });
  const other = (ms: number, events: SceneEvent[] = []): SceneSnapshot => ({ ...scene(ms),
    room: { id: 20, name: "Kitchen", description: "a kitchen behind a closed door" },
    actors: [actor(4, "Nia", 20)], props: [], events });
  director.observeWorld([scene(), other(0)]);
  expect(director.next().scene.room.id).toBe(10);
  const event = { ...speech("kitchen-speech", 1000, 4, 4), roomId: 20, text: "KITCHEN_ONLY_SPEECH" };
  expect(director.observeWorld([scene(1000), other(1000, [event])])).toBeNull();
  const cut = director.observeWorld([scene(4000), other(4000, [event])])!;
  expect(cut.kind).toBe("establishing");
  expect(cut.scene.room.id).toBe(20);
  expect(cut.scene.actors.map(a => a.name)).toEqual(["Nia"]);
  expect(cut.prompt).toContain("KITCHEN_ONLY_SPEECH");
  expect(cut.prompt).not.toContain('"name":"Mara"');
  expect(() => director.observeWorld([scene(5000), other(5001)])).toThrow("one committed source");
});

test("source identity and monotonic time prevent cross-run or future acknowledgements", () => {
  const director = new SceneDirector();
  expect(() => director.next()).toThrow("Observe");
  director.observe(scene(100));
  expect(() => director.observe({ ...scene(200), sourceId: "another-run" })).toThrow("one source run");
  expect(() => director.observe(scene(99))).toThrow("source clock");
  expect(() => director.next(-1)).toThrow("nonnegative");
  expect(() => snapshotDirectorScene({ ...scene(), sourceTick: NaN })).toThrow("valid committed");
});

test("the standalone prompt projection also filters richer input and rejects unavailable OTS subjects", () => {
  const source: any = scene();
  source.actors[0].appearance.identity.privateMemory = "PRIVATE_STANDALONE_MEMORY";
  source.props[0].hiddenContents = "PRIVATE_STANDALONE_CONTENTS";
  const framing = { kind: "wide" as const, roomId: 10, subjectIds: [1, 2, 3], axis: "established-room-side" as const };
  const prompt = projectMultiCharacterScene(source, framing, { ...speech("future", 1000), text: "FUTURE_STANDALONE_SPEECH" });
  for (const hidden of ["PRIVATE_STANDALONE_MEMORY", "PRIVATE_STANDALONE_CONTENTS", "FUTURE_STANDALONE_SPEECH"])
    expect(prompt).not.toContain(hidden);
  expect(() => projectMultiCharacterScene(source, { ...framing, kind: "over_the_shoulder", subjectIds: [1], foregroundActorId: 1 }, null))
    .toThrow("available local subjects");
  expect(() => projectMultiCharacterScene(source, { ...framing, kind: "over_the_shoulder", subjectIds: [1, 99], foregroundActorId: 99 }, null))
    .toThrow("available local subjects");
});
