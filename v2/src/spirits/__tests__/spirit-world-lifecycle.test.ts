import { jest } from "@jest/globals";
import { addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createGodAgentEntity, initializePrefabs } from "../../ecs/prefabs";
import { createEntityRegistry } from "../../ecs/tools";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createSpirit, sendMessage } from "../spirit-registry";
import { initializeSpiritSystem, startSpiritSystem, stopSpiritSystem, getSpiritSystemState,
  setGodAgentCallback, deliverPendingMessagesToGod, tickSpiritSystem } from "../spirit-system";
import { captureGodMessageDelivery } from "../spirit-message-delivery";

function fixture(name: string) {
  const world = createArgosWorld(name);
  // Static SoA is process-global; production multi-world hosts isolate processes.
  // Separate slots here isolate control-plane routing from that distinct limit.
  if (name === "B") for (let n = 0; n < 32; n++) addEntity(world);
  initializePrefabs(world); startCommittedEvents(world);
  const god = createGodAgentEntity(world, { name: "God", worldName: name });
  const state = initializeSpiritSystem(world, { godAgentEid: god, autoCreateNarrator: false });
  const reporter = createSpirit(state.registry, { name: "Reporter", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Observe", observationInterval: Number.MAX_SAFE_INTEGER });
  const send = () => sendMessage(state.registry, reporter.eid, god, "report", name, `${name} observation`);
  return { world, state, god, reporter, send };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("world A lookup/start/stop never selects world B's latest singleton", () => {
  const a = fixture("A"), b = fixture("B");
  expect(getSpiritSystemState(a.world)).toBe(a.state);
  expect(getSpiritSystemState(b.world)).toBe(b.state);
  startSpiritSystem(a.world); startSpiritSystem(b.world);
  stopSpiritSystem(a.world);
  expect(a.state.running).toBe(false); expect(b.state.running).toBe(true);
  stopCommittedEvents(a.world); stopCommittedEvents(b.world);
});

test("tick and God delivery use the caller's world even after another world initializes", async () => {
  const a = fixture("A"), b = fixture("B"), ca = jest.fn(async () => {}), cb = jest.fn(async () => {});
  setGodAgentCallback(ca, a.world); setGodAgentCallback(cb, b.world);
  startSpiritSystem(a.world); startSpiritSystem(b.world);
  const ma = a.send(), mb = b.send();
  await tickSpiritSystem(a.world, createEntityRegistry());
  expect(ca).toHaveBeenCalledWith([ma]); expect(cb).not.toHaveBeenCalled();
  expect(b.state.registry.messageQueue).toContain(mb);
  expect(await deliverPendingMessagesToGod(b.world)).toBe(1);
  expect(cb).toHaveBeenCalledWith([mb]);
  stopCommittedEvents(a.world); stopCommittedEvents(b.world);
});

test("source stop retires only its spirit run and clears action buffers", () => {
  const a = fixture("A"), b = fixture("B"); startSpiritSystem(a.world); startSpiritSystem(b.world);
  a.state.actionBuffer.push({ actor: "Ada", type: "speak", content: "old", timestamp: Date.now() });
  stopCommittedEvents(a.world);
  expect(a.state.running).toBe(false); expect(a.state.actionBuffer).toEqual([]);
  expect(b.state.running).toBe(true);
  stopCommittedEvents(b.world);
});

test("reinitializing a world retires its old state without affecting the other world", () => {
  const a = fixture("A"), b = fixture("B"); startSpiritSystem(a.world); startSpiritSystem(b.world);
  const next = initializeSpiritSystem(a.world, { godAgentEid: a.god, autoCreateNarrator: false });
  expect(a.state.running).toBe(false); expect(next).not.toBe(a.state);
  expect(getSpiritSystemState(a.world)).toBe(next); expect(b.state.running).toBe(true);
  stopCommittedEvents(a.world); stopCommittedEvents(b.world);
});

test("a late God callback settles its captured registry, never delivers to a replacement world", async () => {
  const a = fixture("A"); let release!: () => void;
  const ca = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  setGodAgentCallback(ca, a.world); a.send();
  const pending = deliverPendingMessagesToGod(a.world);
  const b = fixture("B"), cb = jest.fn(async () => {}); setGodAgentCallback(cb, b.world); const mb = b.send();
  stopCommittedEvents(a.world); release(); await pending;
  expect(cb).not.toHaveBeenCalled(); expect(b.state.registry.messageQueue).toContain(mb);
  stopCommittedEvents(b.world);
});

test("first startup preserves fresh queued reports; restart retires old delivery receipts", async () => {
  const f = fixture("A"), callback = jest.fn(async () => {});
  setGodAgentCallback(callback, f.world);
  const first = f.send(); startSpiritSystem(f.world);
  expect(await deliverPendingMessagesToGod(f.world)).toBe(1);
  expect(callback).toHaveBeenCalledWith([first]);
  const old = f.send(), binding = captureGodMessageDelivery(f.world, f.god, old)!;
  expect(binding.current()).toBe(true);
  stopSpiritSystem(f.world); startSpiritSystem(f.world);
  expect(binding.current()).toBe(false);
  expect(await deliverPendingMessagesToGod(f.world)).toBe(0);
  const next = f.send();
  expect(await deliverPendingMessagesToGod(f.world)).toBe(1);
  expect(callback).toHaveBeenLastCalledWith([next]);
  stopCommittedEvents(f.world);
});
