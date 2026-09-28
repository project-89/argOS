import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";

const request = (source = "The Weaver") => ({ source, instruction: "Build a bounded water mechanic" });
async function fixture(limit?: number, directory?: string) {
  const config = { directory: directory ?? await mkdtemp(join(tmpdir(), "argos-admission-")), maxTotalJobs: limit };
  const builder = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("candidate rejected"));
  const daemon = new CodingDaemon(createArgosWorld("Admission"), createSystemRegistry(), config as CodingDaemonConfig, builder);
  await daemon.initialize();
  return { daemon, config, builder };
}

test("one admission is shared by Weaver, God and direct submissions", async () => {
  const { daemon } = await fixture(1);
  try {
    daemon.enqueue(request());
    expect(() => daemon.enqueue(request("God"))).toThrow(/budget/i);
    expect(daemon.getStatus().jobs).toHaveLength(1);
  } finally { daemon.stop(); await daemon.flush(); }
});

test("exact in-flight duplicates reuse their admission even at the limit", async () => {
  const { daemon } = await fixture(1);
  try {
    const first = daemon.enqueue(request());
    expect(daemon.enqueue(request()).id).toBe(first.id);
    expect(daemon.getStatus().jobs).toHaveLength(1);
  } finally { daemon.stop(); await daemon.flush(); }
});

test("simultaneous admissions reserve the slot before observer callbacks", async () => {
  const { daemon } = await fixture(1); let observerRejection = false;
  daemon.setEventHandler(() => { try { daemon.enqueue(request("observer")); } catch { observerRejection = true; } });
  try {
    const results = await Promise.allSettled(["Weaver", "God", "Tinker"].map(async source => daemon.enqueue(request(source))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(observerRejection).toBe(true);
    expect(daemon.getStatus().jobs).toHaveLength(1);
  } finally { daemon.setEventHandler(() => {}); daemon.stop(); await daemon.flush(); }
});

test("rejection does not refund an admission and restart preserves the spent budget", async () => {
  const { daemon, config, builder } = await fixture(1);
  daemon.enqueue(request()); await daemon.pump(); daemon.commitReady(0); await daemon.flush();
  expect(builder).toHaveBeenCalledTimes(1);
  expect(daemon.getStatus().jobs[0].status).toBe("rejected");
  expect(() => daemon.enqueue(request())).toThrow(/budget/i);
  daemon.stop(); await daemon.flush();
  const restored = (await fixture(1, config.directory)).daemon;
  try { expect(() => restored.enqueue(request("God"))).toThrow(/budget/i); }
  finally { restored.stop(); await restored.flush(); }
});

test("cancelled jobs remain charged after restart", async () => {
  const { daemon, config } = await fixture(1);
  daemon.enqueue(request()); daemon.stop(); await daemon.flush();
  const restored = (await fixture(1, config.directory)).daemon;
  try { expect(() => restored.enqueue(request("God"))).toThrow(/budget/i); }
  finally { restored.stop(); await restored.flush(); }
});

test("incomplete persisted job metadata cannot reopen an already used slot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "argos-admission-"));
  const jobDir = join(directory, "jobs", randomUUID()); await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, "host-job.json"), "{}");
  const { daemon } = await fixture(1, directory);
  try {
    expect(() => daemon.enqueue(request())).toThrow(/budget/i);
    expect(daemon.getStatus().admissionBudget).toEqual({ limit: 1, used: 1, remaining: 0 });
  }
  finally { daemon.stop(); await daemon.flush(); }
});

test("zero budget disables new builds without disabling initialization", async () => {
  const { daemon, builder } = await fixture(0);
  try { expect(() => daemon.enqueue(request())).toThrow(/budget/i); expect(builder).not.toHaveBeenCalled(); }
  finally { daemon.stop(); await daemon.flush(); }
});

test("bounded admission requires restored history before accepting a request", () => {
  const daemon = new CodingDaemon(createArgosWorld("Admission"), createSystemRegistry(), { maxTotalJobs: 1 } as CodingDaemonConfig);
  expect(() => daemon.enqueue(request())).toThrow(/initializ/i);
  daemon.stop();
});

test("a caller cannot mutate the original config to expand the running budget", async () => {
  const { daemon, config } = await fixture(1); config.maxTotalJobs = 2;
  try { daemon.enqueue(request()); expect(() => daemon.enqueue(request("God"))).toThrow(/budget/i); }
  finally { daemon.stop(); await daemon.flush(); }
});

test.each([-1, 1.5, NaN, Infinity])("invalid budget %s is rejected at construction", limit => {
  expect(() => new CodingDaemon(createArgosWorld("Admission"), createSystemRegistry(), { maxTotalJobs: limit } as CodingDaemonConfig)).toThrow(/budget/i);
});

test("omitting the budget retains continuous-world admission", async () => {
  const { daemon } = await fixture();
  try { daemon.enqueue(request()); daemon.enqueue(request("God")); expect(daemon.getStatus().jobs).toHaveLength(2); }
  finally { daemon.stop(); await daemon.flush(); }
});

test("file inbox requests pass through the same exhausted admission gate", async () => {
  const { daemon, config, builder } = await fixture(1);
  try {
    daemon.enqueue(request()); await daemon.pump();
    await writeFile(join(config.directory, "inbox", "next.json"), JSON.stringify(request("file daemon")));
    await daemon.pump();
    expect(builder).toHaveBeenCalledTimes(1);
    expect(daemon.getStatus().jobs).toHaveLength(1);
    expect(daemon.getStatus().admissionBudget.remaining).toBe(0);
  } finally { daemon.stop(); await daemon.flush(); }
});

test("invalid requests consume no admission and stop/start never refunds one", async () => {
  const { daemon } = await fixture(1);
  try {
    expect(() => daemon.enqueue({ source: "operator", instruction: "" })).toThrow();
    expect(daemon.getStatus().admissionBudget.used).toBe(0);
    daemon.enqueue(request()); daemon.stop(); daemon.start();
    expect(() => daemon.enqueue(request("another operator"))).toThrow(/budget/i);
    expect(daemon.getStatus().admissionBudget).toEqual({ limit: 1, used: 1, remaining: 0 });
  } finally { daemon.stop(); await daemon.settle(); await daemon.flush(); }
});
