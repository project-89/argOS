import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { advanceSimulationTimeline, isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { advanceTimedSpeech, beginTimedSpeech, clearTimedSpeech, isSpeaking } from "../timed-speech";
import { registerAgentWorldCapabilities } from "../world-capabilities";

function fixture() {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId: room });
  return { world, room, ada: actor("Ada"), bo: actor("Bo") };
}

test("stopping from one speech completion cannot complete another cancelled voice in the same tick", () => {
  const f = fixture();
  const first = jest.fn(() => clearTimedSpeech(f.world)), second = jest.fn(), cancelled = jest.fn();
  expect(beginTimedSpeech(f.world, f.ada, "Hi", "first", first, () => {})).toBe(true);
  expect(beginTimedSpeech(f.world, f.bo, "Hi", "second", second, cancelled)).toBe(true);
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(first).toHaveBeenCalledTimes(1);
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  expect(isSpeaking(f.world, f.bo)).toBe(false);
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(second).not.toHaveBeenCalled();
});

test("room identity replacement interrupts an utterance even when its numeric room id is unchanged", () => {
  const f = fixture(), finished = jest.fn();
  beginTimedSpeech(f.world, f.ada, "Hi", "room-replacement", finished, () => {});
  WorkingMemoryIdentity.id[f.room] = "a different room lifetime";
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(finished).toHaveBeenCalledTimes(1);
  expect(finished.mock.calls[0][0]).toMatchObject({ success: false });
  expect(isSpeaking(f.world, f.ada)).toBe(false);
});

test("replacing an actor's physical package hides and abandons its old voice before admitting a new one", () => {
  const f = fixture(), obsolete = jest.fn(), cancelled = jest.fn(), current = jest.fn();
  beginTimedSpeech(f.world, f.ada, "Hi", "old-package", obsolete, cancelled);
  const remove = registerAgentWorldCapabilities(f.world, f.ada, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
  });
  try {
    expect(isSpeaking(f.world, f.ada)).toBe(false);
    expect(beginTimedSpeech(f.world, f.ada, "Hi", "new-package", current, () => {})).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
    advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
    expect(obsolete).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  } finally { clearTimedSpeech(f.world); remove(); }
});

test("clearing voices rejects callback-born replacement speech without orphaning a reservation", () => {
  const f = fixture(), replacement = jest.fn(), rejected = jest.fn();
  beginTimedSpeech(f.world, f.ada, "old voice", "old", () => {}, () => {
    rejected(beginTimedSpeech(f.world, f.ada, "new voice", "new", replacement, () => {}));
    clearTimedSpeech(f.world); // nested cancellation is inert
  });
  clearTimedSpeech(f.world);
  expect(rejected).toHaveBeenCalledWith(false);
  expect(isSimulationResourceBusy(f.world, f.ada, "voice")).toBe(false);
  advanceSimulationTimeline(f.world, 5000, { integrate: () => {} });
  expect(replacement).not.toHaveBeenCalled();
  expect(beginTimedSpeech(f.world, f.ada, "Restarted", "after-clear", replacement, () => {})).toBe(true);
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(replacement).toHaveBeenCalledTimes(1);
});

test("clearing inside a committed word callback prevents every unheard suffix", () => {
  const f = fixture(), finished = jest.fn(), abandoned = jest.fn(), heard: string[] = [];
  beginTimedSpeech(f.world, f.ada, "keep this suffix hidden", "partial-stop", finished, abandoned, { fragment: fragment => {
    heard.push(fragment.content); clearTimedSpeech(f.world);
  } });
  advanceSimulationTimeline(f.world, 10_000, { integrate: () => {} });
  expect(heard).toEqual(["keep "]);
  expect(finished).not.toHaveBeenCalled();
  expect(abandoned).toHaveBeenCalledTimes(1);
  expect(isSimulationResourceBusy(f.world, f.ada, "voice")).toBe(false);
});
