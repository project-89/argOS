import { jest } from "@jest/globals";
import { createSimulation, type ArgosSimulation } from "../index";
import { consumeSystemErrors } from "../ecs/dynamic-systems";
import { drainPendingStimuli, STIMULUS_QUEUE_LIMITS } from "../cognition/stimulus-queue";

let sim: ArgosSimulation;
beforeEach(async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline library retention test"));
  sim = await createSimulation({ name: "Operational status", enableAI: false, enableSpirits: false,
    enableServer: false, dualLoop: false, preset: "minimal", rooms: [{ name: "Room" }],
    agents: [{ name: "Ada", role: "visitor", startRoom: "Room" }] });
});
afterEach(() => {
  sim?.stop(); drainPendingStimuli();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

test("library reports admission and rejection without claiming delivery", () => {
  expect(sim.stimulate("Ada", "A quiet sound nearby.")).toBe(true);
  expect(sim.getOperationalStatus().stimuli).toMatchObject({ accepted: 1, pending: 1, rejected: 0 });
  expect(sim.stimulate("Ada", "x".repeat(STIMULUS_QUEUE_LIMITS.contentBytes + 1))).toBe(false);
  expect(sim.getOperationalStatus().stimuli).toMatchObject({ accepted: 1, pending: 1, rejected: 1,
    reasons: { content_limit: 1 } });
  sim.stop();
  expect(sim.stimulate("Ada", "This input belongs to a stopped world.")).toBe(false);
  expect(sim.getOperationalStatus().stimuli).toMatchObject({ pending: 0, rejected: 2, discarded: 1 });
});

test("public system-error observations survive tail rotation and independent drains", () => {
  const errors: string[] = [];
  sim.onSystem(event => { if (event.type === "system:error") errors.push(event.error); });
  for (let i = 0; i < 300; i++) sim.god.systemRegistry.errors.push({
    timestamp: i, systemName: "fixture-system", error: `failure ${i}`, errorCount: i + 1,
  });
  expect(errors).toHaveLength(300);
  expect(errors[299]).toBe("failure 299");
  expect(sim.getOperationalStatus().systemDiagnostics.errors).toMatchObject({ total: 300, retained: 256, evicted: 44 });
  consumeSystemErrors(sim.god.systemRegistry);
  sim.god.systemRegistry.errors.push({ timestamp: 301, systemName: "fixture-system", error: "after drain", errorCount: 301 });
  expect(errors).toHaveLength(301);
  expect(errors[300]).toBe("after drain");
  expect(sim.getOperationalStatus().systemDiagnostics.errors).toMatchObject({ total: 301, retained: 1, consumed: 256 });
});
