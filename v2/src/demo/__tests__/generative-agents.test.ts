import { jest } from "@jest/globals";
import { LastAction, ObjectState } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAgentMemory, type AgentAction } from "../../cognition/agent-mind";
import { runCognitionCycle } from "../../cognition/cognition-system";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { getAgentVisibleEntities } from "../../cognition/world-capabilities";
import { snapshotCharacterAppearance } from "../../rendering/character-appearance";
import { GenerativeAgentsTestbed, type TestbedCharacter } from "../generative-agents";
import { completeFixtureHandling } from "./generative-timing";
import { getSocialDialogue } from "../../cognition/social-memory";

async function inHouse(run: (testbed: GenerativeAgentsTestbed) => Promise<void> | void) {
  drainPendingStimuli();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network calls are forbidden in the physical fixture"));
  let testbed: GenerativeAgentsTestbed | undefined;
  try {
    testbed = await GenerativeAgentsTestbed.create({ live: false });
    await testbed.start();
    await run(testbed);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    testbed?.stop();
    fetch.mockRestore();
    drainPendingStimuli();
  }
}

function act(testbed: GenerativeAgentsTestbed, character: TestbedCharacter, action: AgentAction) {
  testbed.dispatch(character, action);
  completeFixtureHandling(testbed, character, action);
  return LastAction.success[testbed.ids[character]];
}

function travel(testbed: GenerativeAgentsTestbed, character: TestbedCharacter, room: string) {
  testbed.dispatch(character, { type: "move", target: room });
  testbed.advance(3000);
}

test("shared repair requires transferring the real key, installing the real fuse safely, and restoring power", async () => {
  await inHouse(testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    act(testbed, "Ivo", { type: "speak", target: "Mara", content: "I have given you the key and repaired the lamp." });
    expect(getDirectContainer(w, i.key)).toBe(i.Ivo);
    expect(testbed.snapshot().lamp).toBe("dark");
    expect(testbed.snapshot().actors.every(actor => actor.goalStatus === "active")).toBe(true);

    travel(testbed, "Mara", "Utility Room");
    expect(act(testbed, "Mara", { type: "interact", target: "Supply cupboard", content: "unlock" })).toBe(false);
    expect(ObjectState.current[i.cupboard]).toBe("locked");
    travel(testbed, "Mara", "Common Room");
    expect(act(testbed, "Ivo", { type: "give", target: "Mara", content: "Brass key" })).toBe(true);
    expect(getDirectContainer(w, i.key)).toBe(i.Mara);

    travel(testbed, "Mara", "Utility Room");
    expect(act(testbed, "Mara", { type: "interact", target: "Supply cupboard", content: "unlock" })).toBe(true);
    expect(getAgentVisibleEntities(w, i.Mara)).toContain(i.fuse);
    expect(act(testbed, "Mara", { type: "pickup", target: "Spare fuse" })).toBe(true);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(act(testbed, "Mara", { type: "interact", target: "Lighting relay", content: "repair" })).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(act(testbed, "Mara", { type: "interact", target: "Isolation switch", content: "switch_off" })).toBe(true);
    expect(act(testbed, "Mara", { type: "interact", target: "Lighting relay", content: "repair" })).toBe(true);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    testbed.advance(1);
    expect(testbed.snapshot()).toMatchObject({ lamp: "dark", circuit: { isolated: true, repaired: true, lit: false } });
    expect(testbed.snapshot().actors.every(actor => actor.goalStatus === "active")).toBe(true);

    expect(act(testbed, "Mara", { type: "interact", target: "Isolation switch", content: "switch_on" })).toBe(true);
    testbed.advance(1);
    expect(testbed.snapshot()).toMatchObject({ lamp: "lit", circuit: { isolated: false, repaired: true, lit: true } });
    expect(testbed.snapshot().actors.every(actor => actor.goalStatus === "completed")).toBe(true);
    expect(getAgentVisibleEntities(w, i.Mara)).not.toContain(i.fuse);
  });
});

test("accepted movement is pending until arrival and cannot perform a simultaneous pickup", async () => {
  await inHouse(testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    testbed.dispatch("Mara", { type: "move", target: "Utility Room" });
    expect(getRoomForEntity(w, i.Mara)).toBe(i.common);
    expect(testbed.activity.phase[i.Mara]).toBe("walking");
    expect(testbed.snapshot().events.filter(event => event.actorId === i.Mara && event.kind === "movement").at(-1)?.status).toBe("pending");
    testbed.dispatch("Mara", { type: "pickup", target: "Yellow raincoat" });
    expect(getDirectContainer(w, i.coat)).toBe(i.common);
    testbed.advance(2999);
    expect(getRoomForEntity(w, i.Mara)).toBe(i.common);
    expect(testbed.scenes().find(scene => scene.room.id === i.common)?.actors.find(actor => actor.id === i.Mara)?.activity?.status).toBe("pending");
    testbed.advance(1);
    expect(getRoomForEntity(w, i.Mara)).toBe(i.utility);
    expect(testbed.activity.phase[i.Mara]).toBe("idle");
    expect(LastAction.type[i.Mara]).toBe("move");
    expect(LastAction.success[i.Mara]).toBe(true);
    expect(testbed.scenes().find(scene => scene.room.id === i.common)?.actors.map(actor => actor.id)).not.toContain(i.Mara);
  });
});

test("pickup rejects another person's inventory, closed cupboard contents, and remote room objects", async () => {
  await inHouse(testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    expect(getAgentVisibleEntities(w, i.Mara)).not.toContain(i.key);
    expect(getAgentVisibleEntities(w, i.Ivo)).toContain(i.key);
    expect(act(testbed, "Mara", { type: "pickup", target: "Brass key" })).toBe(false);
    expect(getDirectContainer(w, i.key)).toBe(i.Ivo);
    expect(act(testbed, "Mara", { type: "pickup", target: "Spare fuse" })).toBe(false);
    travel(testbed, "Mara", "Utility Room");
    expect(getAgentVisibleEntities(w, i.Mara)).not.toContain(i.fuse);
    expect(act(testbed, "Mara", { type: "pickup", target: "Spare fuse" })).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.cupboard);
    expect(act(testbed, "Mara", { type: "pickup", target: "Yellow raincoat" })).toBe(false);
    expect(getDirectContainer(w, i.coat)).toBe(i.common);
    expect(act(testbed, "Mara", { type: "interact", target: "Isolation switch", content: "switch_off" })).toBe(true);
    expect(act(testbed, "Mara", { type: "interact", target: "Lighting relay", content: "repair" })).toBe(false);
    expect(testbed.snapshot().circuit.repaired).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.cupboard);
    expect(act(testbed, "Ivo", { type: "give", target: "Mara", content: "Brass key" })).toBe(false);
    expect(getDirectContainer(w, i.key)).toBe(i.Ivo);
  });
});

test("wearing, removing, and relocating a garment change the physical appearance without changing identity", async () => {
  await inHouse(testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    const initial = snapshotCharacterAppearance(w, i.Mara)!;
    expect(act(testbed, "Mara", { type: "interact", target: "Yellow raincoat", content: "wear" })).toBe(false);
    expect(act(testbed, "Mara", { type: "pickup", target: "Yellow raincoat" })).toBe(true);
    expect(snapshotCharacterAppearance(w, i.Mara)!.visiblyHolding).toBe("");
    expect(act(testbed, "Mara", { type: "interact", target: "Yellow raincoat", content: "wear" })).toBe(true);
    const dressed = snapshotCharacterAppearance(w, i.Mara)!;
    expect(dressed.wornGarments.map(garment => garment.eid)).toEqual([i.coat]);
    expect(dressed.identity).toEqual(initial.identity);
    expect(dressed.clothing).toContain("yellow waxed raincoat");
    expect(dressed.clothing).not.toContain("on the coat peg");
    expect(act(testbed, "Mara", { type: "interact", target: "Yellow raincoat", content: "remove" })).toBe(true);
    expect(getDirectContainer(w, i.coat)).toBe(i.Mara);
    expect(snapshotCharacterAppearance(w, i.Mara)!.wornGarments).toEqual([]);
    expect(act(testbed, "Mara", { type: "interact", target: "Yellow raincoat", content: "wear" })).toBe(true);
    testbed.relocateObject("Yellow raincoat", "Utility Room");
    const moved = snapshotCharacterAppearance(w, i.Mara)!;
    expect(moved.identity).toEqual(initial.identity);
    expect(moved.wornGarments).toEqual([]);
    expect(moved.clothing).not.toContain("yellow waxed raincoat");
    expect(getDirectContainer(w, i.coat)).toBe(i.utility);
    testbed.advance(1);
    const common = testbed.scenes().find(scene => scene.room.id === i.common)!;
    expect(common.actors.find(actor => actor.id === i.Mara)?.appearance.wornGarments).toEqual([]);
    expect(common.props.map(prop => prop.id)).not.toContain(i.coat);
  });
});

test("private thoughts and concealed possessions stay out of other minds and the public camera surface", async () => {
  await inHouse(testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    const secret = "PRIVATE_MARA_MEMORY_7291";
    const privateAction = "PRIVATE_NATIVE_THOUGHT_432";
    testbed.plantThought("Mara", secret);
    testbed.dispatch("Mara", { type: "think", content: privateAction });
    expect(JSON.stringify(getAgentMemory(w, i.Mara))).toContain(secret);
    expect(JSON.stringify(getAgentMemory(w, i.Ivo))).not.toContain(secret);
    expect(JSON.stringify(getAgentMemory(w, i.Sera))).not.toContain(secret);
    expect(testbed.context(i.Ivo)).not.toContain(secret);
    expect(testbed.context(i.Sera)).not.toContain(secret);
    expect(testbed.context(i.Mara)).not.toContain('"name":"Brass key"');
    expect(testbed.context(i.Ivo)).toContain('"name":"Brass key"');
    expect(testbed.context(i.Mara)).not.toContain("Yesterday I put the Spare fuse");
    testbed.advance(1);
    const publicScenes = JSON.stringify(testbed.scenes());
    expect(publicScenes).not.toContain(secret);
    expect(publicScenes).not.toContain(privateAction);
    expect(publicScenes).not.toContain('"name":"Brass key"');
    expect(publicScenes).not.toContain('"name":"Spare fuse"');
    expect(JSON.stringify(testbed.director.snapshot())).not.toContain(secret);
    expect(JSON.stringify(testbed.director.snapshot())).not.toContain(privateAction);
    expect(testbed.director.next().prompt).not.toContain("Brass key");
    expect(testbed.director.next().prompt).not.toContain(secret);
  });
});

test("actual local speech enters the addressed character's perception through native cognition", async () => {
  await inHouse(async testbed => {
    const { ids: i, sim: { world: w } } = testbed;
    const clue = "I put the spare fuse in the supply cupboard yesterday.";
    testbed.dispatch("Mara", { type: "wait" }); // Keep the recipient paused while native stimuli are delivered.
    testbed.dispatch("Sera", { type: "speak", target: "Mara", content: clue });
    // Hearing the complete sentence requires its actual in-world duration.
    testbed.advance(8000);
    await runCognitionCycle(w, testbed.sim.god.systemRegistry, { enablePlanning: false, agentEids: [i.Mara] });
    expect(getSocialDialogue(w, i.Mara).some(turn => turn.content === clue)).toBe(true);
    expect(getAgentMemory(w, i.Mara).perceptions.some(perception => perception.content.includes("heard speech excerpt"))).toBe(true);
    expect(getDirectContainer(w, i.fuse)).toBe(i.cupboard);
    expect(testbed.snapshot().lamp).toBe("dark");
    testbed.advance(1);
    expect(testbed.scenes().flatMap(scene => scene.events).some(event => event.text?.includes("cupboard"))).toBe(true); // Actual spoken slices, not a future/full-script cue.

    travel(testbed, "Sera", "Utility Room");
    const remoteSpeech = "REMOTE_SPEECH_3159";
    testbed.dispatch("Sera", { type: "speak", target: "Mara", content: remoteSpeech });
    testbed.advance(8000);
    const pending = drainPendingStimuli();
    expect(pending.filter(stimulus => stimulus.targetEid === i.Mara).some(stimulus => stimulus.content.includes(remoteSpeech))).toBe(false);
    expect(JSON.stringify(getAgentMemory(w, i.Mara))).not.toContain(remoteSpeech);
  });
});
