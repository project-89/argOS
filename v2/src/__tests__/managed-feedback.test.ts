import { jest } from "@jest/globals";
import { mkdtemp, copyFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSimulation, type ArgosSimulation } from "../index";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { getSpiritSystemState } from "../spirits/spirit-system";

test.each([false, true])("library delivers accepted/rejected build reports with broken subscriber=%s", async broken => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-library-feedback-"));
  const executable = path.join(directory, "builder.cjs");
  await copyFile(path.resolve("src/runtime/__tests__/fixtures/managed-builder.cjs"), executable);
  await chmod(executable, 0o700);
  const previousBuilder = process.env.ARGOS_CODEX_BIN;
  const previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No inference in feedback integration"));
  let sim: ArgosSimulation | undefined;
  try {
    process.env.ARGOS_CODEX_BIN = executable;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fixture-no-network";
    sim = await createSimulation({ name: "Managed feedback", enableAI: true, enableServer: false, preset: "minimal",
      enableSpirits: true, godAutopilot: false, evolution: false, enableNarrativeEngine: false,
      generateSchedules: false, codingDaemons: { backend: "codex", directory }, rooms: [{ name: "Study" }], agents: [] });
    const requester = [...getSpiritSystemState()!.registry.spirits.values()].find(spirit => spirit.definition.name === "The Weaver")!;
    expect(requester).toBeDefined();
    const reports: Array<{ jobId: string; status: string }> = [];
    if (broken) sim.onSystem(event => { if (event.type === "system:build") throw new Error("broken UI observer"); });
    sim.onSystem(event => { if (event.type === "system:build") reports.push({ jobId: event.jobId, status: event.status }); });
    const daemon = getCodingDaemon(sim.world)!;
    const accepted = sim.requestSystemBuild({ source: requester.definition.name, instruction: "Install the fixture counter" });
    await daemon.pump(); daemon.commitReady(1);
    expect(sim.getCodingStatus()?.jobs.find(job => job.id === accepted.id)?.status).toBe("active");
    const rejected = sim.requestSystemBuild({ source: requester.definition.name, instruction: "Prove rejection of the wrong rate",
      acceptance: [{ name: "independent required rate", system: "Count", entities: [{ id: 1, components: { HostCounter: { value: 0 } } }], ticks: 1, deltaMs: 1000,
        expect: [{ entity: 1, component: "HostCounter", field: "value", equals: 100 }] }] });
    await daemon.pump();
    expect(sim.getCodingStatus()?.jobs.find(job => job.id === rejected.id)?.status).toBe("rejected");
    for (const [jobId, status] of [[accepted.id, "active"], [rejected.id, "rejected"]]) {
      expect(reports.filter(report => report.jobId === jobId && report.status === status)).toHaveLength(1);
      expect(sim.god.autopilot!.inbox.filter(report => report.data?.jobId === jobId && report.data?.status === status)).toHaveLength(1);
      expect(requester.inbox.filter(report => report.data?.jobId === jobId && report.data?.status === status)).toHaveLength(1);
    }
    expect(sim.god.autopilot!.config.enabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    sim?.stop(); if (sim) await getCodingDaemon(sim.world)?.flush();
    if (previousBuilder === undefined) delete process.env.ARGOS_CODEX_BIN; else process.env.ARGOS_CODEX_BIN = previousBuilder;
    if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
    fetch.mockRestore();
  }
}, 30000);
