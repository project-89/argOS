import { jest } from "@jest/globals";
import { Agent, Goal, LastAction, ObjectState } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { getRelationTargets } from "bitecs";
import { HasGoal } from "../../ecs/relations";
import { getAgentMemory, type AgentAction } from "../../cognition/agent-mind";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { GenerativeAgentsTestbed, type TestbedCharacter } from "../generative-agents";
import { buildAvailableActionsContext } from "../../cognition/action-registry";
import { completeFixtureHandling } from "./generative-timing";

test("the action menu and physical executor share the same adjacent indoor routes", async () => {
  await inChallenge(house => {
    const destinations = () => buildAvailableActionsContext(house.sim.world, house.ids.Mara).availableLocations.map(room => room.name);
    expect(destinations()).toEqual(["Utility Room"]);
    travel(house, "Mara", "Utility Room");
    expect(destinations().sort()).toEqual(["Common Room", "Store Room"]);
    travel(house, "Mara", "Store Room");
    expect(destinations()).toEqual(["Utility Room"]);
  });
});

async function inChallenge(run: (house: GenerativeAgentsTestbed) => void) {
  drainPendingStimuli();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Challenge fixture must not call live models"));
  let house: GenerativeAgentsTestbed | undefined;
  try {
    house = await GenerativeAgentsTestbed.create({ live: false, challenge: true });
    await house.start();
    run(house);
    expect(fetch).not.toHaveBeenCalled();
  } finally { house?.stop(); fetch.mockRestore(); drainPendingStimuli(); }
}

function act(house: GenerativeAgentsTestbed, character: TestbedCharacter, action: AgentAction, success = true) {
  house.dispatch(character, action);
  completeFixtureHandling(house, character, action);
  expect(LastAction.success[house.ids[character]]).toBe(success);
}
function travel(house: GenerativeAgentsTestbed, character: TestbedCharacter, room: string) {
  house.dispatch(character, { type: "move", target: room });
  house.advance(3000);
  expect(LastAction.success[house.ids[character]]).toBe(true);
}
function interact(house: GenerativeAgentsTestbed, character: TestbedCharacter, target: string, content: string, success = true) {
  act(house, character, { type: "interact", target, content }, success);
}
function start(house: GenerativeAgentsTestbed, character: TestbedCharacter, target: string, content: string, phase: string) {
  house.dispatch(character, { type: "interact", target, content });
  expect(house.activity.phase[house.ids[character]]).toBe(phase);
}
/** Authored test inputs exercise consequences; no part of this sequence drives live NPCs. */
function prepare(house: GenerativeAgentsTestbed, dry = true) {
  travel(house, "Ivo", "Utility Room");
  travel(house, "Ivo", "Store Room");
  interact(house, "Ivo", "Supply cupboard", "unlock");
  act(house, "Ivo", { type: "pickup", target: "Spare fuse" });
  interact(house, "Ivo", "Leak valve", "close");
  travel(house, "Ivo", "Utility Room");
  travel(house, "Mara", "Utility Room");
  act(house, "Ivo", { type: "give", target: "Mara", content: "Spare fuse" });
  travel(house, "Sera", "Utility Room");
  travel(house, "Sera", "Store Room");
  act(house, "Sera", { type: "pickup", target: "Cleaning cloth" });
  travel(house, "Sera", "Utility Room");
  if (dry) {
    start(house, "Sera", "Wet floor", "dry", "drying");
    house.advance(5000);
    expect(house.snapshot().challenge?.wet).toBe(false);
  }
}

test("an inactive helper stops supporting the panel immediately, not at its later hold deadline", async () => {
  await inChallenge(house => {
    prepare(house);
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    Agent.active[house.ids.Ivo] = false;
    house.advance(6000);
    expect(house.snapshot().circuit.repaired).toBe(false);
    expect(getDirectContainer(house.sim.world, house.ids.fuse)).toBe(house.ids.Mara);
    expect(LastAction.success[house.ids.Mara]).toBe(false);
    expect(house.snapshot().challenge?.holderId).toBe(-1);
  });
});

test("immediate repair affordances follow real possession and helper readiness, not recalled ownership", async () => {
  await inChallenge(house => {
    const actions = (actor: TestbedCharacter, target: string) => buildAvailableActionsContext(house.sim.world, house.ids[actor])
      .objectAffordances.filter(action => action.action === "interact" && action.target === target).map(action => action.affordanceName);
    prepare(house);
    // Ivo fetched the part, but the committed handoff put it in Mara's hands.
    expect(getDirectContainer(house.sim.world, house.ids.fuse)).toBe(house.ids.Mara);
    expect(actions("Ivo", "Lighting relay")).not.toContain("repair");
    expect(actions("Mara", "Lighting relay")).not.toContain("repair"); // No helper yet.
    expect(actions("Sera", "Isolation switch")).not.toContain("switch_on");
    expect(actions("Ivo", "Access panel")).toContain("hold");
    start(house, "Mara", "Access panel", "hold", "holding_panel");
    expect(actions("Mara", "Lighting relay")).not.toContain("repair"); // Same person cannot do both jobs.
    expect(actions("Mara", "Access panel")).toEqual(["release"]);
    interact(house, "Mara", "Access panel", "release");
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    expect(actions("Mara", "Lighting relay")).toContain("repair");
    expect(actions("Ivo", "Lighting relay")).not.toContain("repair");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    expect(actions("Mara", "Lighting relay")).not.toContain("repair");
    house.advance(6000);
    expect(actions("Mara", "Lighting relay")).not.toContain("repair"); // Installed is not repeatable work.
    expect(actions("Sera", "Isolation switch")).toContain("switch_on");
  });
});

test("challenge is an opt-in three-room world with separate private knowledge and real routes", async () => {
  await inChallenge(house => {
    const { ids: i, sim: { world: w } } = house;
    expect(house.scenes().map(scene => scene.room.name)).toEqual(expect.arrayContaining(["Common Room", "Utility Room", "Store Room"]));
    expect(house.scenes()).toHaveLength(3);
    expect(getRoomForEntity(w, i.cupboard)).toBe(house.challengeIds!.store);
    expect(getDirectContainer(w, i.fuse)).toBe(i.cupboard);
    expect(JSON.stringify(house.scenes())).not.toContain('"name":"Spare fuse"');
    expect(JSON.stringify(house.scenes())).not.toContain('"name":"Brass key"');
    expect(JSON.stringify(getAgentMemory(w, i.Mara))).not.toContain("Leak valve in the Store Room");
    expect(JSON.stringify(getAgentMemory(w, i.Ivo))).not.toContain("I put the Spare fuse in the locked Supply cupboard");
    expect(house.context(i.Mara)).not.toContain("The safety interlock refuses power");
    expect(house.snapshot()).toMatchObject({ lamp: "dark", circuit: { isolated: true, repaired: false }, challenge: { leakActive: true, wet: true, holderId: -1 } });
    act(house, "Mara", { type: "move", target: "Store Room" }, false);
    expect(getRoomForEntity(w, i.Mara)).toBe(i.common);
    for (const name of house.characters) {
      const goals = getRelationTargets(w, i[name], HasGoal);
      expect(goals.some(goal => Goal.kind[goal] === "social")).toBe(true);
      expect(goals.some(goal => Goal.successJson[goal].includes("entity_component_equals"))).toBe(true);
    }
  });
});

test("leak, drying, a distinct physical helper and timed installation gate power restoration", async () => {
  await inChallenge(house => {
    const { ids: i, sim: { world: w } } = house;
    travel(house, "Mara", "Utility Room");
    interact(house, "Mara", "Isolation switch", "switch_on", false);
    interact(house, "Mara", "Access panel", "hold", false);
    interact(house, "Mara", "Wet floor", "dry", false);
    expect(house.snapshot().circuit.isolated).toBe(true);
    travel(house, "Mara", "Common Room");
    prepare(house, false);
    start(house, "Sera", "Wet floor", "dry", "drying");
    house.advance(4999);
    expect(house.snapshot().challenge?.wet).toBe(true);
    interact(house, "Ivo", "Access panel", "hold", false);
    house.advance(1);
    expect(house.snapshot().challenge?.wet).toBe(false);
    interact(house, "Mara", "Lighting relay", "repair", false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);

    start(house, "Mara", "Access panel", "hold", "holding_panel");
    house.dispatch("Mara", { type: "interact", target: "Lighting relay", content: "repair" });
    expect(house.activity.phase[i.Mara]).toBe("holding_panel");
    expect(house.snapshot().circuit.repaired).toBe(false); // A holder cannot perform both jobs.
    interact(house, "Mara", "Access panel", "release");
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    interact(house, "Sera", "Isolation switch", "switch_on", false);
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(5999);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(house.snapshot()).toMatchObject({ lamp: "dark", circuit: { repaired: false }, challenge: { holderId: i.Ivo, repairerId: i.Mara } });
    const utility = house.scenes().find(scene => scene.room.id === i.utility)!;
    expect(utility.actors.find(actor => actor.id === i.Ivo)?.activity?.action).toBe("holding_panel");
    expect(utility.actors.find(actor => actor.id === i.Mara)?.activity?.action).toBe("repairing");
    house.advance(1);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    expect(house.snapshot()).toMatchObject({ lamp: "dark", circuit: { repaired: true, isolated: true }, challenge: { holderId: -1, repairerId: -1 } });
    expect(LastAction.success[i.Ivo]).toBe(true);
    expect(ObjectState.current[house.challengeIds!.panel]).toContain("closed");
    interact(house, "Sera", "Isolation switch", "switch_on");
    house.advance(1);
    expect(house.snapshot().lamp).toBe("lit");
    expect(house.snapshot().actors.every(actor => actor.goalStatus === "completed")).toBe(true);
  });
});

test("released or displaced helpers interrupt installation without consuming the part; a fresh team can retry", async () => {
  await inChallenge(house => {
    prepare(house);
    const { ids: i, sim: { world: w } } = house;
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(2000);
    interact(house, "Ivo", "Access panel", "release");
    expect(house.activity.phase[i.Mara]).toBe("idle");
    expect(LastAction.success[i.Mara]).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(house.snapshot().circuit.repaired).toBe(false);

    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    setLocatedIn(w, i.Ivo, i.common); // An external physical interruption, not a successful journey.
    house.advance(1);
    expect(house.snapshot().challenge?.holderId).toBe(-1);
    expect(house.activity.phase[i.Mara]).toBe("idle");
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(house.snapshot().circuit.repaired).toBe(false);

    travel(house, "Ivo", "Utility Room");
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(6000);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    expect(house.snapshot().circuit.repaired).toBe(true);
    expect(house.snapshot().challenge?.holderId).toBe(-1);
  });
});

test("cloth and part relocation cancel only physically invalid work and preserve retryable inventory", async () => {
  await inChallenge(house => {
    prepare(house, false);
    const { ids: i, sim: { world: w } } = house;
    start(house, "Sera", "Wet floor", "dry", "drying");
    house.advance(2000);
    house.relocateObject("Cleaning cloth", "Store Room");
    expect(house.activity.phase[i.Sera]).toBe("idle");
    expect(house.snapshot().challenge?.wet).toBe(true);
    expect(ObjectState.current[house.challengeIds!.floor]).not.toContain("being dried");
    travel(house, "Sera", "Store Room");
    act(house, "Sera", { type: "pickup", target: "Cleaning cloth" });
    travel(house, "Sera", "Utility Room");
    start(house, "Sera", "Wet floor", "dry", "drying");
    house.advance(5000);
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.relocateObject("Spare fuse", "Store Room");
    expect(house.activity.phase[i.Mara]).toBe("idle");
    expect(house.snapshot().circuit.repaired).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(house.challengeIds!.store);
    interact(house, "Ivo", "Access panel", "release");
    travel(house, "Mara", "Store Room");
    act(house, "Mara", { type: "pickup", target: "Spare fuse" });
    travel(house, "Mara", "Utility Room");
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(6000);
    expect(house.snapshot().circuit.repaired).toBe(true);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
  });
});

test("hold expiry interrupts a late installation, while coarse physical steps preserve earlier completion", async () => {
  await inChallenge(house => {
    prepare(house);
    const { ids: i, sim: { world: w } } = house;
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    house.advance(44_000);
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(1000);
    expect(house.snapshot().challenge?.holderId).toBe(-1);
    expect(house.activity.phase[i.Mara]).toBe("idle");
    expect(house.snapshot().circuit.repaired).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(60_000); // Repair ends at +6s; its helper does not subsequently time out at +45s.
    expect(house.snapshot().circuit.repaired).toBe(true);
    expect(house.snapshot().challenge?.holderId).toBe(-1);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    expect(LastAction.success[i.Ivo]).toBe(true);
    expect(LastAction.success[i.Mara]).toBe(true);
  });
});

test("a reopened leak re-wets the floor and interrupts unsafe work without consuming the part", async () => {
  await inChallenge(house => {
    prepare(house);
    const { ids: i, sim: { world: w } } = house;
    travel(house, "Sera", "Store Room");
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    interact(house, "Sera", "Leak valve", "open");
    house.advance(1);
    expect(house.snapshot()).toMatchObject({ lamp: "dark", circuit: { repaired: false, isolated: true }, challenge: { leakActive: true, wet: true, holderId: -1, repairerId: -1 } });
    expect(house.activity.phase[i.Mara]).toBe("idle");
    expect(house.activity.phase[i.Ivo]).toBe("idle");
    expect(LastAction.success[i.Mara]).toBe(false);
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    interact(house, "Sera", "Leak valve", "close");
    travel(house, "Sera", "Utility Room");
    start(house, "Sera", "Wet floor", "dry", "drying");
    house.advance(5000);
    start(house, "Ivo", "Access panel", "hold", "holding_panel");
    start(house, "Mara", "Lighting relay", "repair", "repairing");
    house.advance(6000);
    interact(house, "Sera", "Isolation switch", "switch_on");
    house.advance(1);
    expect(house.snapshot().lamp).toBe("lit");
  });
});
