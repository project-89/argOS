import { jest } from "@jest/globals";
import { LastAction } from "../../ecs/components";
import { getDirectContainer } from "../../ecs/location";
import { addPerception, buildAgentContext, getAgentMemory, type AgentAction } from "../../cognition/agent-mind";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { getWorkingMemory, formatWorkingMemoryContext } from "../../cognition/working-memory";
import { captureWorkingMemoryObservation } from "../../cognition/working-memory-observation";
import { GenerativeAgentsTestbed, type TestbedCharacter } from "../generative-agents";
import { completeFixtureHandling } from "./generative-timing";

async function inChallenge(run: (house: GenerativeAgentsTestbed) => void) {
  drainPendingStimuli();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Working-memory challenge fixtures must stay offline"));
  let house: GenerativeAgentsTestbed | undefined;
  try {
    house = await GenerativeAgentsTestbed.create({ live: false, challenge: true });
    await house.start();
    run(house);
    expect(fetch).not.toHaveBeenCalled();
  } finally { house?.stop(); fetch.mockRestore(); drainPendingStimuli(); }
}

function act(house: GenerativeAgentsTestbed, actor: TestbedCharacter, action: AgentAction) {
  house.dispatch(actor, action);
  completeFixtureHandling(house, actor, action);
  expect(LastAction.success[house.ids[actor]]).toBe(true);
}
function travel(house: GenerativeAgentsTestbed, actor: TestbedCharacter, room: string) {
  house.dispatch(actor, { type: "move", target: room }); house.advance(3000);
  expect(LastAction.success[house.ids[actor]]).toBe(true);
}
function setupHandoff(house: GenerativeAgentsTestbed) {
  travel(house, "Ivo", "Utility Room"); travel(house, "Ivo", "Store Room");
  act(house, "Ivo", { type: "interact", target: "Supply cupboard", content: "unlock" });
  act(house, "Ivo", { type: "pickup", target: "Spare fuse" });
  act(house, "Ivo", { type: "interact", target: "Leak valve", content: "close" });
  travel(house, "Sera", "Utility Room"); travel(house, "Sera", "Store Room");
  act(house, "Sera", { type: "pickup", target: "Cleaning cloth" });
  travel(house, "Sera", "Utility Room");
  house.dispatch("Sera", { type: "interact", target: "Wet floor", content: "dry" }); house.advance(5000);
  expect(house.snapshot().challenge?.wet).toBe(false);
  travel(house, "Mara", "Utility Room");
  house.dispatch("Mara", { type: "interact", target: "Access panel", content: "hold" });
  expect(house.activity.phase[house.ids.Mara]).toBe("holding_panel");
  travel(house, "Ivo", "Utility Room");
  act(house, "Ivo", { type: "give", target: "Mara", content: "Spare fuse" });
  expect(getDirectContainer(house.sim.world, house.ids.fuse)).toBe(house.ids.Mara);
}
function location(house: GenerativeAgentsTestbed, actor: TestbedCharacter) {
  return getWorkingMemory(house.sim.world, house.ids[actor]).facts.find(fact => fact.subjectLabel === "Spare fuse" && fact.predicate === "location");
}

test("a committed handoff remains in the giver, busy recipient and local witness's working account after sensory turnover", async () => {
  await inChallenge(house => {
    setupHandoff(house);
    const { world } = house.sim;
    for (const actor of house.characters) {
      expect(location(house, actor)).toMatchObject({ valueLabel: "Mara" });
      const before = location(house, actor);
      for (let n = 0; n < 60; n++) addPerception(world, house.ids[actor], {
        type: "visual", source: "room sight", content: `A routine view of the room, ${n}.`,
      });
      expect(getAgentMemory(world, house.ids[actor]).perceptions.length).toBeLessThanOrEqual(20);
      expect(location(house, actor)).toEqual(before);
      const working = formatWorkingMemoryContext(world, house.ids[actor]);
      expect(working).toContain("Spare fuse");
      expect(working).toContain("Mara");
      expect(buildAgentContext(world, house.ids[actor])).toContain("WHAT YOU'VE SEEN AND DONE");
    }
    expect(house.activity.phase[house.ids.Mara]).toBe("holding_panel");
  });
});

test("an unseen edit stays unknown through context reads; returning and seeing the item supersedes its remembered holder", async () => {
  await inChallenge(house => {
    setupHandoff(house);
    const { world } = house.sim;
    travel(house, "Ivo", "Common Room");
    const before = getWorkingMemory(world, house.ids.Ivo);
    house.relocateObject("Spare fuse", "Store Room");
    for (let n = 0; n < 25; n++) {
      formatWorkingMemoryContext(world, house.ids.Ivo);
      buildAgentContext(world, house.ids.Ivo);
      house.context(house.ids.Ivo);
    }
    expect(getWorkingMemory(world, house.ids.Ivo)).toEqual(before);
    expect(location(house, "Ivo")).toMatchObject({ valueLabel: "Mara" });
    captureWorkingMemoryObservation(world, house.ids.Ivo); // Only the Common Room is seen.
    expect(location(house, "Ivo")).toMatchObject({ valueLabel: "Mara" });
    travel(house, "Ivo", "Utility Room"); travel(house, "Ivo", "Store Room");
    captureWorkingMemoryObservation(world, house.ids.Ivo); // This is actual new local evidence.
    expect(location(house, "Ivo")).toMatchObject({ valueLabel: "Store Room" });
    expect(location(house, "Ivo")?.sourceId).not.toBe(before.facts.find(fact => fact.subjectLabel === "Spare fuse" && fact.predicate === "location")?.sourceId);
    expect(getDirectContainer(world, house.ids.fuse)).toBe(house.challengeIds!.store);
  });
});

test("deferred installation updates remembered containment only after the real part commits to the relay", async () => {
  await inChallenge(house => {
    setupHandoff(house);
    const { world } = house.sim;
    act(house, "Mara", { type: "interact", target: "Access panel", content: "release" });
    house.dispatch("Ivo", { type: "interact", target: "Access panel", content: "hold" });
    house.dispatch("Mara", { type: "interact", target: "Lighting relay", content: "repair" });
    expect(house.activity.phase[house.ids.Mara]).toBe("repairing");
    house.advance(5999);
    expect(getDirectContainer(world, house.ids.fuse)).toBe(house.ids.Mara);
    for (const actor of house.characters) expect(location(house, actor)).toMatchObject({ valueLabel: "Mara" });
    house.advance(1);
    expect(getDirectContainer(world, house.ids.fuse)).toBe(house.ids.relay);
    for (const actor of house.characters) expect(location(house, actor)).toMatchObject({ valueLabel: "Lighting relay" });
    expect(getWorkingMemory(world, house.ids.Mara).receipts.some(receipt => receipt.kind === "action"
      && receipt.succeeded && receipt.summary.includes("installed"))).toBe(true);
  });
});
