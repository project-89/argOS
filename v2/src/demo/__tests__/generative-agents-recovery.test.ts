import { jest } from "@jest/globals";
import { LastAction, ObjectState } from "../../ecs/components";
import { getDirectContainer } from "../../ecs/location";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import type { AgentAction } from "../../cognition/agent-mind";
import { GenerativeAgentsTestbed, type TestbedCharacter } from "../generative-agents";
import { completeFixtureHandling } from "./generative-timing";

test("removing the installed fuse darkens the lamp and allows a real recovery with current held props", async () => {
  drainPendingStimuli();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("The physical recovery fixture must not use the network"));
  let testbed: GenerativeAgentsTestbed | undefined;
  try {
    testbed = await GenerativeAgentsTestbed.create({ live: false });
    await testbed.start();
    const house = testbed;
    const { ids: i, sim: { world: w } } = house;
    const act = (character: TestbedCharacter, action: AgentAction) => {
      house.dispatch(character, action);
      completeFixtureHandling(house, character, action);
      expect(LastAction.success[i[character]]).toBe(true);
    };
    const travel = (room: string) => {
      house.dispatch("Mara", { type: "move", target: room });
      house.advance(3000);
      expect(LastAction.success[i.Mara]).toBe(true);
    };
    const props = () => house.scenes().flatMap(scene => scene.props);
    const fuseProps = () => props().filter(prop => prop.id === i.fuse);
    const heldFuseOwners = () => house.scenes().flatMap(scene => scene.actors)
      .filter(actor => actor.appearance.heldItems.some(item => item.eid === i.fuse)).map(actor => actor.id);

    expect(props().some(prop => prop.id === i.key)).toBe(false); // Concealed initial possession.
    act("Ivo", { type: "give", target: "Mara", content: "Brass key" });
    expect(props().filter(prop => prop.id === i.key)).toEqual([
      expect.objectContaining({ id: i.key, roomId: i.common, heldBy: i.Mara }),
    ]);
    travel("Utility Room");
    act("Mara", { type: "interact", target: "Supply cupboard", content: "unlock" });
    act("Mara", { type: "pickup", target: "Spare fuse" });
    expect(fuseProps()).toEqual([expect.objectContaining({ id: i.fuse, roomId: i.utility, heldBy: i.Mara })]);
    expect(heldFuseOwners()).toEqual([i.Mara]);
    act("Mara", { type: "interact", target: "Isolation switch", content: "switch_off" });
    act("Mara", { type: "interact", target: "Lighting relay", content: "repair" });
    act("Mara", { type: "interact", target: "Isolation switch", content: "switch_on" });
    house.advance(1);
    expect(house.snapshot()).toMatchObject({ lamp: "lit", circuit: { repaired: true, lit: true } });
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    expect(fuseProps()).toEqual([]);
    expect(heldFuseOwners()).toEqual([]);

    house.relocateObject("Spare fuse", "Common Room");
    house.advance(1);
    expect(house.snapshot()).toMatchObject({ lamp: "dark", circuit: { repaired: false, lit: false } });
    expect(ObjectState.current[i.relay]).not.toBe("replacement fuse installed");
    expect(fuseProps()).toEqual([expect.objectContaining({ id: i.fuse, roomId: i.common })]);
    expect(fuseProps()[0].heldBy).toBeUndefined();
    expect(heldFuseOwners()).toEqual([]);

    travel("Common Room");
    act("Mara", { type: "pickup", target: "Spare fuse" });
    expect(getDirectContainer(w, i.fuse)).toBe(i.Mara);
    expect(fuseProps()).toEqual([expect.objectContaining({ id: i.fuse, roomId: i.common, heldBy: i.Mara })]);
    expect(heldFuseOwners()).toEqual([i.Mara]);
    travel("Utility Room");
    expect(fuseProps()).toEqual([expect.objectContaining({ id: i.fuse, roomId: i.utility, heldBy: i.Mara })]);
    act("Mara", { type: "interact", target: "Isolation switch", content: "switch_off" });
    act("Mara", { type: "interact", target: "Lighting relay", content: "repair" });
    act("Mara", { type: "interact", target: "Isolation switch", content: "switch_on" });
    house.advance(1);
    expect(getDirectContainer(w, i.fuse)).toBe(i.relay);
    expect(house.snapshot()).toMatchObject({ lamp: "lit", circuit: { repaired: true, lit: true } });
    expect(fuseProps()).toEqual([]);
    expect(heldFuseOwners()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    testbed?.stop();
    fetch.mockRestore();
    drainPendingStimuli();
  }
});
