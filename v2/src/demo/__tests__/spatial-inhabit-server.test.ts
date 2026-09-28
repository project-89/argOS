import { jest } from "@jest/globals";
import { request as httpRequest, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialDemoApp } from "../spatial-server";

const token = "fedcba9876543210fedcba9876543210fedcba9876543210";
let demo: SpatialDemo, server: Server, stop: () => Promise<void>;
function post(path: string, body?: unknown, authenticated = true) {
  const address = server.address(); if (!address || typeof address === "string") throw Error("no port");
  return new Promise<{ status: number; json: () => any }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: body === undefined && path === "/api/state" ? "GET" : "POST", headers: {
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      ...(bytes ? { "content-type": "application/json", "content-length": String(bytes.length) } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode!, json: () => JSON.parse(text) }); });
    });
    req.on("error", reject); req.end(bytes);
  });
}
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false });
  const receiver = await createSpatialDemoApp({ demo, token, directory: await mkdtemp(join(tmpdir(), "argos-inhabit-")) });
  stop = receiver.stop; server = receiver.app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
});
afterEach(async () => {
  await stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

test("inhabit, pause and interview routes are token-gated and follow the contract shapes", async () => {
  expect((await post("/api/control/visitor", {}, false)).status).toBe(403);
  expect((await post("/api/control/visitor", {})).json()).toEqual({ error: "Start a session first" });
  await demo.start();
  const visitor = await post("/api/control/visitor", { name: "Wren" });
  expect(visitor.status).toBe(200);
  const { actorKey } = visitor.json();
  expect(actorKey).toEqual(expect.any(String));
  expect((await post("/api/control/walk", { dx: 1, dy: 0 })).json()).toEqual({ ok: true });
  expect((await post("/api/control/walk", { dx: 0, dy: 0 })).status).toBe(400);
  expect((await post("/api/control/walk", { x: 1, dy: 2 })).status).toBe(400);
  demo.advance(1500);
  const seat = demo.snapshot().entities.find(e => e.name === "Square seat 1")!.key;
  expect((await post("/api/control/act", { type: "sit", targetKey: seat })).json()).toEqual({ ok: true });
  expect((await post("/api/control/say", { text: "Evening." })).json()).toEqual({ ok: true });
  const state = (await post("/api/state")).json();
  expect(state.paused).toBe(false);
  expect(state.control).toMatchObject({ actorKey, name: "Wren", visitor: true, nearby: expect.any(Array), heard: expect.any(Array) });
  const address = server.address() as { port: number };
  const scene = await new Promise<any>((resolve, reject) => httpRequest({ host: "127.0.0.1", port: address.port, path: "/api/scene",
    headers: { authorization: `Bearer ${token}` } }, res => { let t = ""; res.on("data", c => t += c); res.on("end", () => resolve(JSON.parse(t))); }).on("error", reject).end());
  expect(scene.control).toBeUndefined();
  expect((await post("/api/pause", {})).json()).toEqual({ paused: true });
  expect((await post("/api/state")).json().paused).toBe(true);
  expect((await post("/api/control/walk", { dx: 1, dy: 0 })).json()).toEqual({ ok: false, reason: "paused" });
  expect((await post("/api/resume", {})).json()).toEqual({ paused: false });
  expect((await post("/api/control/release", {})).json()).toEqual({ released: [actorKey] });
  const leon = demo.snapshot().actors.find(a => a.name === "Leon")!.key;
  expect((await post("/api/control/take", { actorKey: leon })).json()).toEqual({ actorKey: leon });
  expect((await post("/api/god/ask", { requestId: "30000000-0000-4000-8000-000000000001", text: "Where is everyone?" })).json())
    .toEqual({ error: "God answers in live sessions" });
  expect((await post("/api/interview", { actorKey: leon, text: "Hi", mode: "gossip", sessionId: "x" })).status).toBe(400);
});
