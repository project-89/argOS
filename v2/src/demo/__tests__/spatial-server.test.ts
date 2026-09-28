import { jest } from "@jest/globals";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialDemoApp } from "../spatial-server";
import { getDirectContainer } from "../../ecs/location";
import { getCommittedEvents } from "../../runtime/committed-events";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
type Receiver = Awaited<ReturnType<typeof createSpatialDemoApp>>;
const active: Array<{ demo: SpatialDemo; receiver?: Receiver; server?: Server }> = [];
function request(server: Server, path: string, body?: unknown, options: { authenticated?: boolean; headers?: Record<string,string>; raw?: string } = {}) {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Test server has no local port");
  return new Promise<{ status: number; text: string; bytes: Buffer; headers: IncomingHttpHeaders; json: () => any }>((resolve,reject) => {
    const bytes = options.raw === undefined ? body === undefined ? undefined : Buffer.from(JSON.stringify(body)) : Buffer.from(options.raw);
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: bytes ? "POST" : "GET", headers: {
      ...(options.authenticated === false ? {} : { authorization: `Bearer ${token}` }),
      ...(bytes ? { "content-type": "application/json", "content-length": String(bytes.length) } : {}), ...options.headers,
    } },res => {
      const chunks: Buffer[] = []; res.on("data",data => chunks.push(data));
      res.on("end",() => { const bytes = Buffer.concat(chunks), text = bytes.toString(); resolve({ status: res.statusCode!, text, bytes, headers: res.headers, json: () => JSON.parse(text) }); });
    });
    req.setTimeout(5000,() => req.destroy(new Error("Local test request timed out")));
    req.on("error",reject); req.end(bytes);
  });
}
async function fixture(blackout = false, evolving = false, development = false) {
  const directory = await mkdtemp(join(tmpdir(),"argos-spatial-server-test-"));
  const demo = await SpatialDemo.create({ live: false, automaticClock: false, ...(blackout ? { scenario: "blackout" as const } : {}),
    ...(evolving ? { scenario: "town" as const, evolving: true } : {}),
    ...(development ? { development: { directory: join(directory, "development") } } : {}) }), entry: typeof active[number] = { demo }; active.push(entry);
  const receiver = await createSpatialDemoApp({ demo, token, directory }); entry.receiver = receiver;
  const server = receiver.app.listen(0,"127.0.0.1"); entry.server = server;
  await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  return { demo, receiver, server, directory };
}
beforeEach(() => { jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No AI or remote calls in spatial server tests")); });
afterEach(async () => {
  for (const { demo, receiver, server } of active.splice(0)) {
    if (receiver) await receiver.stop(); else demo.stop();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

test("God operator surface is private, authenticated, bounded and explicitly enabled", async () => {
  const { demo, server } = await fixture(false, true, true);
  const body = { requestId: "8b4257ba-ffb1-421c-99c5-78d0d987b720", text: "Make it rain" };
  expect((await request(server, "/api/god-command", body, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/api/god-command", body, { headers: { origin: "https://elsewhere.test" } })).status).toBe(403);
  expect((await request(server, "/api/god-command", body)).status).toBe(400); // Not started.
  await demo.start();
  expect((await request(server, "/api/god-command", { ...body, text: "x".repeat(2001) })).status).toBe(400);
  expect((await request(server, "/api/god-command", { ...body, authority: "full" })).status).toBe(400);
  expect((await request(server, "/api/god-command", { ...body, requestId: "reused source" })).status).toBe(400);
  expect((await request(server, "/api/state")).json().development.enabled).toBe(true);
  const scene = (await request(server, "/api/scene")).json();
  expect(scene.development).toBeUndefined(); expect(scene.actors).toBeUndefined();
  expect(demo.snapshot().development!.messages).toEqual([]);
});

test("public renderer receives committed weather but not spirit deliberations or proposals", async () => {
  const { demo, server } = await fixture(false, true);
  await demo.start();
  expect(demo.townLife!.weather.set("rain", demo.byId.get("common-square")!).status).toBe("applied");
  const operator = (await request(server, "/api/state")).json(), publicScene = (await request(server, "/api/scene")).json();
  expect(operator.townLife.changes).toHaveLength(1);
  expect(publicScene.weather).toEqual(operator.weather);
  expect(publicScene.weather.condition).toBe("rain");
  for (const key of ["townLife", "actors", "events", "worldControl"]) expect(publicScene[key]).toBeUndefined();
  expect(JSON.stringify(publicScene)).not.toContain("The Narrator");
});

test("operator API requires a session token, loopback Host and matching Origin", async () => {
  const { demo, server } = await fixture();
  expect((await request(server,"/api/state",undefined,{ authenticated:false })).status).toBe(403);
  expect((await request(server,"/api/state",undefined,{ headers:{ authorization:"Bearer wrong" } })).status).toBe(403);
  expect((await request(server,"/api/start",{},{ authenticated:false })).status).toBe(403);
  expect((await request(server,"/api/state",undefined,{ headers:{ host:"attacker.example" } })).status).toBe(403);
  expect((await request(server,"/api/state",undefined,{ headers:{ origin:"https://attacker.example" } })).status).toBe(403);
  const port = (server.address() as { port:number }).port;
  const valid = await request(server,"/api/state",undefined,{ headers:{ origin:`http://127.0.0.1:${port}` } });
  expect(valid.status).toBe(200); expect(valid.json().status).toBe("ready"); expect(demo.running).toBe(false);
  expect(valid.headers["cache-control"]).toBe("no-store"); expect(valid.headers["x-content-type-options"]).toBe("nosniff");
});

test("house-spirit route is authenticated, strict, bounded and absent from public scene", async () => {
  const { demo, server } = await fixture(true);
  expect((await request(server, "/api/world-command", { text: "Open the supplies box" }, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/api/world-command", { text: "Open the supplies box" })).status).toBe(400);
  await request(server, "/api/start", {});
  expect((await request(server, "/api/world-command", { text: "Open the supplies box", patch: {} })).status).toBe(400);
  const result = await request(server, "/api/world-command", { text: "Open the supplies box" });
  expect(result.json()).toMatchObject({ status: "applied", operation: "box_open", atSimMs: 0 });
  expect((await request(server, "/api/world-command", { text: "Restore power" })).json().status).toBe("rejected");
  expect(demo.snapshot().scenario?.power).toBe("off");
  const scene = (await request(server, "/api/scene")).json();
  expect(scene).not.toHaveProperty("worldControl"); expect(scene).not.toHaveProperty("events");
  expect((await request(server, "/api/state")).json().worldControl.available).toBe(true);
  await request(server, "/api/stop", {});
  expect((await request(server, "/api/world-command", { text: "Close the supplies box" })).status).toBe(400);
});

test("scene transport omits operator minds, events and texts while private state retains them", async () => {
  const { demo, server } = await fixture(); await request(server,"/api/start",{});
  const mara = demo.snapshot().actors.find(a => a.name === "Mara")!;
  expect((await request(server,"/api/message",{ actorKey:mara.key, text:"PRIVATE_SMS_SERVER_2718" })).status).toBe(200);
  expect((await request(server,"/api/command",{ actorKey:mara.key, text:"PRIVATE_THOUGHT_SERVER_2718" })).status).toBe(200);
  const state = await request(server,"/api/state"), scene = await request(server,"/api/scene");
  expect(state.text).toContain("PRIVATE_SMS_SERVER_2718"); expect(state.json().actors).toHaveLength(2);
  expect(scene.status).toBe(200); expect(scene.json()).not.toHaveProperty("actors"); expect(scene.json()).not.toHaveProperty("events");
  expect(scene.json()).not.toHaveProperty("messages"); expect(scene.text).not.toContain("PRIVATE_"); expect(scene.text).not.toContain("Alex stayed up late");
  expect(scene.json().cues).toEqual([expect.objectContaining({ kind:"sound", text:"bzzzt bzzzt" })]);
  expect(state.json().actors[0].focus).toBeDefined();
  expect(scene.text).not.toContain(state.json().actors[0].focus.description);
  expect(scene.text).not.toContain('"goals"'); expect(scene.text).not.toContain('"focus"');
});

test("unknown fields, browser positions and malformed input cannot mutate the world", async () => {
  const { demo, server } = await fixture(); await request(server,"/api/start",{});
  const before = demo.snapshot(), mara = before.actors.find(a => a.name === "Mara")!;
  const invalid = [
    ["/api/start",{ x:99 }], ["/api/stop",{ acknowledge:true }], ["/api/grow",{ blueprint:{ id:"invented" } }],
    ["/api/action",{ actorKey:mara.key, type:"move", position:{ x:99,z:99 } }],
    ["/api/action",{ actorKey:mara.key, type:"teleport" }], ["/api/action",{ actorKey:mara.key, type:"move", targetKey:"stale-identity" }],
    ["/api/message",{ actorKey:mara.key, text:"hello", from:"forged authority" }],
    ["/api/command",{ actorKey:mara.key, text:"hello", executionId:"invented" }],
  ] as const;
  for (const [path,body] of invalid) expect((await request(server,path,body)).status).toBe(400);
  expect((await request(server,"/api/action",undefined,{ raw:"{invalid" })).status).toBe(400);
  expect((await request(server,"/api/message",{ actorKey:mara.key,text:"x".repeat(9000) })).status).toBe(400);
  const after = demo.snapshot(); expect(after.entities).toEqual(before.entities); expect(after.rooms).toEqual(before.rooms);
  expect(after.actors).toEqual(before.actors); expect(after.running).toBe(true); expect(after.growth.status).toBe("available");
});

test("valid operator actions use server-owned timed execution and bounded growth", async () => {
  const { demo, server } = await fixture();
  expect((await request(server,"/api/grow",{})).status).toBe(400);
  expect((await request(server,"/api/start",{})).status).toBe(200);
  const state = demo.snapshot(), mara = state.actors.find(a => a.name === "Mara")!, phone = state.entities.find(e => e.id === demo.byId.get("maras-phone"))!;
  const response = await request(server,"/api/action",{ actorKey:mara.key,type:"pickup",targetKey:phone.key });
  expect(response.status).toBe(200); expect(response.json()).toEqual({ accepted:true });
  expect(getDirectContainer(demo.sim.world,phone.id)).not.toBe(mara.id);
  demo.advance(6000); expect(getDirectContainer(demo.sim.world,phone.id)).toBe(mara.id);
  expect((await request(server,"/api/grow",{})).json()).toEqual({ built:true,added:true });
  expect((await request(server,"/api/grow",{})).json()).toEqual({ built:true,added:false });
  expect(demo.snapshot().rooms.some(r => r.name === "Corner Cafe")).toBe(true);
  expect(demo.snapshot().limits.autonomousGrowth).toBe(false);
});

test("stop saves native world and session, cancels work and is terminal and idempotent", async () => {
  const { demo, server, directory } = await fixture(); await request(server,"/api/start",{});
  const state = demo.snapshot(), mara = state.actors.find(a => a.name === "Mara")!, phone = state.entities.find(e => e.id === demo.byId.get("maras-phone"))!;
  await request(server,"/api/message",{ actorKey:mara.key,text:"Saved private message" });
  await request(server,"/api/action",{ actorKey:mara.key,type:"pickup",targetKey:phone.key }); demo.advance(100);
  const stopped = await request(server,"/api/stop",{});
  expect(stopped.status).toBe(200); expect(stopped.json()).toMatchObject({ status:"stopped",running:false });
  expect(getDirectContainer(demo.sim.world,phone.id)).not.toBe(mara.id); expect(getCommittedEvents(demo.sim.world).stopped).toBe(true);
  const saved = JSON.parse(await readFile(join(directory,"session.json"),"utf8")), worldText = await readFile(join(directory,"world.json"),"utf8");
  expect(saved.status).toBe("stopped"); expect(saved.actors.find((a: { id:number }) => a.id === mara.id).messages[0].text).toBe("Saved private message");
  expect(JSON.parse(worldText)).toBeTruthy(); expect(worldText).not.toContain(token);
  expect((await request(server,"/api/stop",{})).status).toBe(200);
  expect((await request(server,"/api/start",{})).status).toBe(400);
  expect((await request(server,"/api/grow",{})).status).toBe(400);
  expect((await request(server,"/api/message",{ actorKey:mara.key,text:"too late" })).status).toBe(400);
  expect(() => demo.advance(100)).toThrow();
});

test("public client and licensed assets contain no session token or world-private data", async () => {
  const { demo, server } = await fixture(); await request(server,"/api/start",{});
  await request(server,"/api/message",{ actorKey:demo.snapshot().actors[0].key,text:"PRIVATE_ASSET_CHECK_1618" });
  for (const path of ["/","/client.js","/styles.css","/assets/manifest.json","/assets/furniture/LICENSE.txt","/assets/characters/character-a.glb"]) {
    const result = await request(server,path,undefined,{ authenticated:false });
    expect(result.status).toBe(200); expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.text).not.toContain(token); expect(result.text).not.toContain("PRIVATE_ASSET_CHECK_1618");
    expect(result.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  }
  expect((await request(server,"/assets/.env",undefined,{ authenticated:false })).status).not.toBe(200);
  expect((await request(server,"/world.json",undefined,{ authenticated:false })).status).not.toBe(200);
});
