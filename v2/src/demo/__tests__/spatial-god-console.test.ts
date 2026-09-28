import { jest } from "@jest/globals";
import { getRelationTargets, hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialGodConsole, GOD_REQUEST_LIMIT, godRequestSchema } from "../spatial-god-console";
import { ObjectState, PhysicalObject } from "../../ecs/components";
import { SittingOn } from "../../ecs/relations";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { CodingDaemon, type BuildAdmission } from "../../engineering/coding-daemon";
import type { BuildJob } from "../../engineering/contracts";

type Executor = NonNullable<Parameters<typeof createSpatialGodConsole>[0]["execute"]>;
type Control = ReturnType<typeof createSpatialGodConsole>;
let demo: SpatialDemo;
let controls: Control[];
let pending: Array<() => void>;
const id = (n = 1) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("God-console tests are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  controls = []; pending = [];
  demo = await SpatialDemo.create({ scenario: "town", evolving: true, live: false, automaticClock: false });
  await demo.start();
});
afterEach(async () => {
  controls.forEach(control => control.close()); demo?.stop(); pending.forEach(resolve => resolve()); await turn();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});
function control(execute: Executor = async () => ({ text: "The public world has been inspected." })) {
  const bridge = createSpatialGodConsole({ sim: demo.sim, running: () => demo.running, atSimMs: () => demo.atSimMs,
    publicWorld: () => { const view = demo.snapshot(); return { sourceId: view.sourceId, atSimMs: view.atSimMs,
      rooms: view.rooms, entities: view.entities, weather: view.weather }; },
    guidance: () => "Generate public scalar measurements only; preserve private cognition.",
    weather: (condition, roomId) => demo.townLife!.weather.set(condition, roomId), execute });
  controls.push(bridge); return bridge;
}
function deferred() {
  let resolve!: (value: { text: string }) => void;
  const promise = new Promise<{ text: string }>(done => { resolve = done; });
  pending.push(() => resolve({ text: "Late reply must not survive cancellation." }));
  const execute = jest.fn<Executor>(() => promise);
  return { bridge: control(execute), execute, resolve };
}
async function invoke(tools: ReturnType<Control["createTools"]>, name: keyof typeof tools, args: unknown) {
  return (tools[name].execute as (args: unknown, context: unknown) => Promise<any>)(args, {});
}

test("queued UUID acknowledgement is fast, duplicate delivery is single-flight, and completed retry is detached", async () => {
  const f = deferred(), input = { requestId: id(), text: "Inspect the common" };
  const queued = f.bridge.submit(input);
  expect(queued).toEqual({ sourceId: getCommittedEvents(demo.sim.world).sourceId, requestId: id(), status: "queued", atSimMs: 0 });
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.bridge.submit(input)).toEqual(queued);
  expect(f.bridge.view().messages).toHaveLength(1);
  await turn(); expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.bridge.submit(input).status).toBe("working");
  expect(() => f.bridge.submit({ ...input, text: "Different request with same UUID" })).toThrow(/different text/);
  expect(() => f.bridge.submit({ requestId: id(2), text: "Second request" })).toThrow(/previous request/);
  f.resolve({ text: "I inspected it; no changes were requested." }); await turn();
  const completed = f.bridge.submit(input); expect(completed.status).toBe("completed");
  completed.status = "failed";
  const view = f.bridge.view(); view.messages[0].text = "Changed externally";
  expect(f.bridge.submit(input).status).toBe("completed");
  expect(f.bridge.view().messages[0].text).toBe(input.text);
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.bridge.view().busy).toBe(false);
});

test.each([
  { requestId: "not-a-uuid", text: "Inspect" }, { requestId: id(), text: " " },
  { requestId: id(), text: "x".repeat(2001) }, { requestId: id(), text: "Hidden\u0000control" },
  { requestId: id(), text: "Inspect", authority: "full" }, { requestId: id(), text: "Inspect", execute: "injected" },
])("invalid HTTP-shaped request %j cannot broaden authority or consume the queue", input => {
  const c = control(); expect(() => godRequestSchema.parse(input)).toThrow(); expect(() => c.submit(input)).toThrow();
  expect(c.view().messages).toEqual([]); expect(c.view().busy).toBe(false);
});

test("the session request budget counts even inspection-only replies, not duplicate UUID deliveries", async () => {
  const execute = jest.fn<Executor>(async () => ({ text: "No change requested." })), c = control(execute);
  for (let n = 1; n <= GOD_REQUEST_LIMIT; n++) {
    const input = { requestId: id(n), text: `Inspect ${n}` }; c.submit(input); c.submit(input); await turn();
  }
  expect(execute).toHaveBeenCalledTimes(GOD_REQUEST_LIMIT);
  expect(c.view()).toMatchObject({ available: false, busy: false, limits: { maxRequests: GOD_REQUEST_LIMIT } });
  expect(() => c.submit({ requestId: id(GOD_REQUEST_LIMIT + 1), text: "One too many" })).toThrow(/budget/);
  expect(c.submit({ requestId: id(), text: "Inspect 1" }).status).toBe("completed");
});

test.each(["console-close", "world-stop", "source-replacement"])("%s cancels outstanding requests and rejects late tool effects and replies", async change => {
  const f = deferred(), input = { requestId: id(), text: "Wait before changing anything" };
  f.bridge.submit(input); await turn();
  const scope = f.execute.mock.calls[0][1], tools = scope.surface!.tools;
  if (change === "console-close") f.bridge.close();
  if (change === "world-stop") demo.stop();
  if (change === "source-replacement") { stopCommittedEvents(demo.sim.world); startCommittedEvents(demo.sim.world); }
  expect(scope.surface!.signal!.aborted).toBe(true); expect(scope.current!()).toBe(false);
  await expect(tools.setWeather.execute({ condition: "rain", roomId: demo.byId.get("common-square") }, {})).rejects.toThrow(/no longer running/);
  expect(f.bridge.submit(input).status).toBe("cancelled");
  expect(() => f.bridge.submit({ requestId: id(2), text: "Old source new request" })).toThrow(/no longer running/);
  f.resolve({ text: "FALSE late successful reply" }); await turn();
  expect(f.bridge.view()).toMatchObject({ available: false, busy: false });
  expect(f.bridge.view().messages).toEqual([expect.objectContaining({ id: id(), status: "cancelled" })]);
});

test("stopping while still queued never invokes the executor, and constructing for an already stopped source is safe", async () => {
  const execute = jest.fn<Executor>(async () => ({ text: "Must not run" })), first = control(execute);
  first.submit({ requestId: id(), text: "Queued request" }); demo.stop(); await turn();
  expect(execute).not.toHaveBeenCalled(); expect(first.view().messages[0].status).toBe("cancelled");
  let stopped!: Control; expect(() => { stopped = control(execute); }).not.toThrow();
  expect(stopped.view()).toMatchObject({ available: false, busy: false });
  expect(() => stopped.submit({ requestId: id(2), text: "Cannot reopen" })).toThrow();
});

test("inspection exposes only public DTO fields and final text, never private God history, NPC thoughts or phone content", async () => {
  const actor = demo.snapshot().actors[0]; demo.plantThought(actor.key, "PRIVATE_THOUGHT_SENTINEL");
  demo.text(actor.key, "PRIVATE_PHONE_SENTINEL");
  demo.sim.god.conversationHistory.push({ role: "user", content: "PRIVATE_GOD_HISTORY_SENTINEL" });
  let seen: unknown;
  const execute = jest.fn<Executor>(async (prompt, scope) => {
    expect(prompt).not.toMatch(/PRIVATE_/);
    expect(Object.keys(scope.surface!.tools).sort()).toEqual(["addFurnishing", "inspectWorld", "requestMechanic", "setWeather"]);
    seen = await scope.surface!.tools.inspectWorld.execute({}, {});
    return { text: "Public inspection complete.", reasoningText: "PRIVATE_PROVIDER_REASONING_SENTINEL" };
  });
  const c = control(execute); c.submit({ requestId: id(), text: "Inspect without changing residents" }); await turn();
  expect(seen).toMatchObject({ success: true });
  // structuredClone crosses Jest's VM realm: Array.isArray is the appropriate
  // DTO check, unlike an instanceof-based asymmetric Array matcher.
  expect(Array.isArray((seen as any).result.world.rooms)).toBe(true);
  expect(Array.isArray((seen as any).result.world.entities)).toBe(true);
  expect((seen as any).result.world).not.toHaveProperty("actors");
  expect(JSON.stringify(seen)).not.toMatch(/PRIVATE_/);
  expect(JSON.stringify(c.view())).not.toMatch(/PRIVATE_/);
  expect(c.view().messages.at(-1)).toMatchObject({ role: "god", status: "completed", text: "Public inspection complete." });
  expect(demo.snapshot().actors[0].messages.some(message => message.text === "PRIVATE_PHONE_SENTINEL")).toBe(true);
});

test("weather tool returns exact native applied/unchanged/rejected outcomes and retries commit only once", async () => {
  const c = control(), tools = c.createTools(id()), square = demo.byId.get("common-square")!, indoor = demo.byId.get("town-cafe")!;
  const applied = await invoke(tools, "setWeather", { condition: "rain", roomId: square });
  expect(applied.result).toMatchObject({ status: "applied", condition: "rain", roomId: square });
  expect(demo.townLife!.weather.component.condition[square]).toBe("rain");
  expect(await invoke(tools, "setWeather", { condition: "rain", roomId: square })).toEqual(applied);
  expect(demo.townLife!.weather.view().changes).toBe(1);
  const next = c.createTools(id(2));
  expect((await invoke(next, "setWeather", { condition: "rain", roomId: square })).result.status).toBe("unchanged");
  expect((await invoke(next, "setWeather", { condition: "rain", roomId: indoor })).result.status).toBe("rejected");
  expect(demo.townLife!.weather.view().changes).toBe(1);
});

test("furnishing tool adopts one real, reachable seat; duplicate tool invocation creates no second object", async () => {
  const c = control(), tools = c.createTools(id()), before = demo.snapshot().entities.length;
  const args = { siteId: "cafe-extra-seat", roomId: demo.byId.get("town-cafe")!, asset: "chair", name: "Operator catalog chair", description: "A real extra seat." };
  const receipt = await invoke(tools, "addFurnishing", args), eid = receipt.result.entityId;
  expect(receipt).toMatchObject({ success: true, result: { status: "applied", name: args.name } });
  expect(hasComponent(demo.sim.world, eid, PhysicalObject)).toBe(true);
  expect(demo.snapshot().entities.find(row => row.id === eid)).toMatchObject({ asset: "chair", name: args.name, roomId: args.roomId });
  expect(await invoke(tools, "addFurnishing", args)).toEqual(receipt);
  expect(demo.snapshot().entities).toHaveLength(before + 1);
  const tess = demo.snapshot().actors.find(actor => actor.name === "Tess")!;
  expect(demo.spatial.canReach(tess.id, eid)).toBe(true);
  expect(getRelationTargets(demo.sim.world, tess.id, SittingOn)).not.toContain(eid);
  demo.dispatch(tess.key, "interact", demo.snapshot().entities.find(row => row.id === eid)!.key, "sit"); demo.advance(10000);
  expect(getRelationTargets(demo.sim.world, tess.id, SittingOn)).toContain(eid);
  expect(ObjectState.current[eid]).toBe("occupied");
  await expect(invoke(c.createTools(id(2)), "addFurnishing", { ...args, name: "Second chair on used site" })).rejects.toThrow();
  expect(demo.snapshot().entities).toHaveLength(before + 1);
});

test("no installed builder cannot be reported as a queued or active mechanic", async () => {
  const c = control();
  await expect(invoke(c.createTools(id()), "requestMechanic", { instruction: "Track a public moisture scalar" })).rejects.toThrow(/not installed/);
  expect(c.view().jobs).toEqual([]);
});

test("mechanic request passes one source-bound admission to the existing daemon and reports queued, never active", async () => {
  // Construction registers the service but neither initializes a store nor
  // starts its pump. Enqueue is replaced on this instance before it is called.
  const builder = jest.fn<any>(async () => { throw Error("No builder may run in this fixture"); });
  const daemon = new CodingDaemon(demo.sim.world, demo.sim.god.systemRegistry, { maxTotalJobs: 2 }, builder);
  let admission: BuildAdmission | undefined, job!: BuildJob;
  const enqueue = jest.spyOn(daemon, "enqueue").mockImplementation((request, callback, scope) => {
    expect(callback).toBeUndefined(); admission = scope;
    job = { id: id(99), request, status: "queued", directory: "PRIVATE_BUILD_DIRECTORY",
      baseRevision: 0, createdAt: 0, updatedAt: 0 };
    return structuredClone(job);
  });
  const baseStatus = daemon.getStatus();
  jest.spyOn(daemon, "getStatus").mockImplementation(() => ({ ...baseStatus, jobs: job ? [structuredClone(job)] : [] }));
  const c = control(), tools = c.createTools(id());
  const first = await invoke(tools, "requestMechanic", { instruction: "Track a public moisture scalar" });
  expect(first).toMatchObject({ success: true, result: { jobId: id(99), status: "queued", note: expect.stringContaining("not yet active") } });
  expect(await invoke(tools, "requestMechanic", { instruction: "A second builder request in the same turn" })).toEqual(first);
  expect(enqueue).toHaveBeenCalledTimes(1); expect(builder).not.toHaveBeenCalled();
  expect(admission).toMatchObject({ key: `operator:${getCommittedEvents(demo.sim.world).sourceId}:${id()}`, causalKeys: [`operator:${id()}`] });
  expect(admission!.current()).toBe(true);
  expect(job.request.instruction).toContain("Generate public scalar measurements only");
  expect(c.view()).toMatchObject({ limits: { maxBuildJobs: 2 }, jobs: [{ id: id(99), status: "queued", summary: "Spatial God operator" }] });
  expect(JSON.stringify(c.view())).not.toContain("PRIVATE_BUILD_DIRECTORY");
  c.close(); expect(admission!.current()).toBe(false);
  await expect(invoke(tools, "requestMechanic", { instruction: "Try to reuse a stopped admission" })).rejects.toThrow();
  expect(enqueue).toHaveBeenCalledTimes(1); daemon.stop();
});

test("executor failure preserves a previously committed native effect without inventing rollback or success", async () => {
  const square = demo.byId.get("common-square")!;
  const c = control(async (_prompt, scope) => {
    await scope.surface!.tools.setWeather.execute({ condition: "rain", roomId: square }, {});
    throw Error("Offline intentional failure after effect");
  });
  c.submit({ requestId: id(), text: "Change weather then explain" }); await turn();
  expect(c.view().messages[0].status).toBe("failed"); expect(c.view().messages.at(-1)?.status).toBe("failed");
  expect(demo.townLife!.weather.component.condition[square]).toBe("rain");
  expect(c.view().messages.at(-1)?.text).toMatch(/already-confirmed changes/);
  expect(c.view().busy).toBe(false);
});
