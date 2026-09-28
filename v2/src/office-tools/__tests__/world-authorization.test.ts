import { jest } from "@jest/globals";
import path from "node:path";
import os from "node:os";
const realFs = await import("node:fs");
const realProcesses = await import("node:child_process");
const forbidden = () => { throw new Error("Unexpected host effect in denied-world test"); };
const filesystem = Object.fromEntries(["mkdirSync", "writeFileSync", "readFileSync", "readdirSync", "rmSync"].map(name => [name, jest.fn(forbidden)]));
const spawn = jest.fn(forbidden), spawnSync = jest.fn(forbidden);
jest.unstable_mockModule("node:fs", () => ({ ...realFs, ...filesystem }));
jest.unstable_mockModule("node:child_process", () => ({ ...realProcesses, spawn, spawnSync }));
const { createArgosWorld } = await import("../../ecs/world");
const { registerBuiltinOfficeTools } = await import("../builtin-tools");
const { runOfficeTool, registerOfficeTool, setOfficeToolMode, getOfficeToolMode, setWorldOfficeToolPolicy, isWorldOfficeToolAllowed } = await import("../tool-registry");
const { createSimulation } = await import("../../index");
const { ApartmentSitcom } = await import("../../demo/apartment-sitcom");
const { ObjectManager } = await import("../../world/object-manager");
const { getAvailableAffordances } = await import("../../world/affordance-availability");

const environmentKeys = ["OFFICE_TOOLS_ALLOW_SHELL", "OFFICE_TOOLS_ALLOW_GEMINI_CLI", "OFFICE_TOOLS_DISABLE_SANDBOX", "OFFICE_TOOLS_SANDBOX_BASE_DIR"];
let savedEnvironment: (string | undefined)[], previousMode: ReturnType<typeof getOfficeToolMode>;
let directory: string;
beforeEach(() => {
  previousMode = getOfficeToolMode(); savedEnvironment = environmentKeys.map(key => process.env[key]);
  directory = realFs.mkdtempSync(path.join(os.tmpdir(), "argos-office-authorization-"));
  for (const mock of Object.values(filesystem)) mock.mockReset().mockImplementation(forbidden);
  spawn.mockReset().mockImplementation(forbidden); spawnSync.mockReset().mockImplementation(forbidden);
  setOfficeToolMode("shell"); registerBuiltinOfficeTools();
  process.env.OFFICE_TOOLS_ALLOW_SHELL = "1"; process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI = "1";
  process.env.OFFICE_TOOLS_DISABLE_SANDBOX = "1";
  process.env.OFFICE_TOOLS_SANDBOX_BASE_DIR = directory;
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in office authorization tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); setOfficeToolMode(previousMode);
  environmentKeys.forEach((key, index) => { if (savedEnvironment[index] === undefined) delete process.env[key]; else process.env[key] = savedEnvironment[index]; });
  realFs.rmSync(directory, { recursive: true, force: true });
});
const context = (world = createArgosWorld("Fictional apartment")) => ({ world, actorEid: 1, deviceEid: 2 });

test.each([
  ["workspace.list_dir", { path: "." }], ["workspace.read_file", { path: "notes.txt" }],
  ["workspace.write_file", { path: "notes.txt", content: "unauthorized" }],
  ["workspace.replace_in_file", { path: "notes.txt", find: "a", replace: "b" }],
  ["workspace.init_fixture", { fixtureId: "any" }], ["repo.init", { repoId: "any", fixtureId: "any" }],
  ["terminal.run", { command: "echo forbidden" }], ["gemini.cli", { prompt: "forbidden" }],
])("unconfigured worlds deny %s before filesystem/process activity, even with permissive environment", (toolId, params) => {
  const result = runOfficeTool(toolId as string, params, context());
  expect(result).toMatchObject({ ok: false, exitCode: 126 }); expect(result.summary).toContain("denied for this world");
  for (const mock of Object.values(filesystem)) expect(mock).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled(); expect(spawnSync).not.toHaveBeenCalled();
  expect(realFs.readdirSync(directory)).toEqual([]);
});

test("denial precedes even a custom handler and cannot be bypassed by mutable ECS metadata", () => {
  const ctx = context(), handler = jest.fn(() => ({ ok: true, summary: "invoked" }));
  registerOfficeTool("test.host_effect", handler);
  (ctx.world.meta as any).hostOfficeTools = true;
  expect(runOfficeTool("test.host_effect", {}, ctx).ok).toBe(false); expect(handler).not.toHaveBeenCalled();
  setWorldOfficeToolPolicy(ctx.world, ["test.host_effect"]);
  expect(runOfficeTool("test.host_effect", {}, ctx).ok).toBe(true); expect(handler).toHaveBeenCalledTimes(1);
  setWorldOfficeToolPolicy(ctx.world, false);
  expect(runOfficeTool("test.host_effect", {}, ctx).ok).toBe(false); expect(handler).toHaveBeenCalledTimes(1);
});

test("an explicitly opted-in world can use scoped files while another world and other tools stay denied", () => {
  delete process.env.OFFICE_TOOLS_DISABLE_SANDBOX;
  for (const name of ["mkdirSync", "writeFileSync", "readFileSync", "readdirSync"]) {
    filesystem[name].mockImplementation(((...args: unknown[]) => {
      const target = String(args[0]);
      if (target !== directory && !target.startsWith(directory + path.sep)) throw new Error(`Outside test directory: ${target}`);
      return (realFs as any)[name](...args);
    }) as any);
  }
  const allowed = context(), denied = context(createArgosWorld("Other world"));
  const tools = ["workspace.list_dir", "workspace.write_file", "workspace.read_file"];
  setWorldOfficeToolPolicy(allowed.world, tools); tools.push("terminal.run");
  expect(isWorldOfficeToolAllowed(allowed.world, "terminal.run")).toBe(false);
  expect(runOfficeTool("workspace.write_file", { path: "notes.txt", content: "actual scoped data" }, allowed).ok).toBe(true);
  expect(runOfficeTool("workspace.read_file", { path: "notes.txt" }, allowed).stdout).toBe("actual scoped data");
  expect(runOfficeTool("workspace.list_dir", { path: "." }, allowed).stdout).toContain("notes.txt");
  expect(runOfficeTool("workspace.list_dir", { path: "." }, denied).exitCode).toBe(126);
  expect(runOfficeTool("terminal.run", { command: "echo denied" }, allowed).exitCode).toBe(126);
  expect(spawn).not.toHaveBeenCalled(); expect(spawnSync).not.toHaveBeenCalled();
});

test("authority does not travel with serialized-looking world metadata or matching entity IDs", () => {
  const original = context(), handler = jest.fn(() => ({ ok: true, summary: "invoked" }));
  registerOfficeTool("test.restore", handler); setWorldOfficeToolPolicy(original.world, true);
  const restored = context(createArgosWorld(original.world.meta.name)); restored.world.meta = { ...original.world.meta };
  expect(runOfficeTool("test.restore", {}, restored).exitCode).toBe(126);
  expect(runOfficeTool("test.restore", {}, original).ok).toBe(true);
  expect(handler).toHaveBeenCalledTimes(1);
});

test("library simulations deny by default, support explicit allowlists, and the apartment always denies", async () => {
  const config = { name: "Policy fixture", preset: "minimal" as const, enableAI: false, enableServer: false,
    enableSpirits: false, evolution: false, codingDaemons: false, enableNarrativeEngine: false };
  const denied = await createSimulation(config);
  const allowed = await createSimulation({ ...config, name: "Authorized fixture", hostOfficeTools: ["workspace.list_dir"] });
  const apartment = await ApartmentSitcom.create({ live: false, scenario: "duet" });
  try {
    expect(isWorldOfficeToolAllowed(denied.world, "workspace.list_dir")).toBe(false);
    expect(isWorldOfficeToolAllowed(allowed.world, "workspace.list_dir")).toBe(true);
    expect(isWorldOfficeToolAllowed(allowed.world, "workspace.write_file")).toBe(false);
    expect(isWorldOfficeToolAllowed(apartment.sim.world, "workspace.list_dir")).toBe(false);
    const manager = new ObjectManager(apartment.sim.world);
    const laptop = manager.spawn("laptop", { state: "powered_on", containedIn: apartment.ids.living })!;
    const nativeMenu = () => getAvailableAffordances(apartment.sim.world, apartment.ids.Elaine, laptop).map(a => a.name);
    expect(manager.getAvailableAffordances(laptop)).toContain("check_email");
    expect(manager.getAvailableAffordances(laptop)).not.toContain("run_command");
    expect(nativeMenu()).not.toContain("list_dir");
    setWorldOfficeToolPolicy(apartment.sim.world, ["workspace.list_dir"]);
    expect(nativeMenu()).toContain("list_dir"); expect(nativeMenu()).not.toContain("run_command");
  } finally { denied.stop(); allowed.stop(); apartment.stop(); }
});
