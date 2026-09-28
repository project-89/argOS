import express from "express";
import { AsyncResource } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { SpatialDemo } from "./spatial-demo";
import { serializeWorld } from "../persistence/world-persistence";

/** Local operator surface. No renderer callbacks can acknowledge native actions. */
export async function createSpatialDemoApp(options: { demo: SpatialDemo; token: string; directory: string }) {
  if (!/^[a-f0-9]{48,128}$/.test(options.token)) throw new Error("A fresh session token is required");
  const { demo } = options, app = express();
  // The inspection host outlives a bounded simulation task. Only observation
  // and persistence use this context; mutation endpoints retain their caller's
  // task signal and all normal native admission checks.
  const snapshot = AsyncResource.bind(() => demo.snapshot());
  const assetRoot = fileURLToPath(new URL("./spatial-client/", import.meta.url));
  const bundle = await build({ entryPoints: [resolve(assetRoot, "client.mjs")], bundle: true,
    platform: "browser", format: "esm", write: false, sourcemap: false, logLevel: "silent" });
  app.disable("x-powered-by");
  app.use((req: any, res: any, next: any) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) return res.status(403).json({ error: "Loopback host required" });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: "Same-origin requests required" });
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.get("/", (_req: any, res: any) => res.sendFile(resolve(assetRoot, "index.html")));
  app.get("/client.js", (_req: any, res: any) => res.type("text/javascript").send(bundle.outputFiles[0].text));
  app.get("/styles.css", (_req: any, res: any) => res.sendFile(resolve(assetRoot, "styles.css")));
  app.use("/assets", express.static(resolve(assetRoot, "assets"), { dotfiles: "deny", index: false }));
  app.use("/api", (req: any, res: any, next: any) => {
    const supplied = Buffer.from(String(req.headers.authorization ?? ""));
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(403).json({ error: "Open the full private session link, including its #token." });
    next();
  }, express.json({ limit: "8kb", strict: true }));
  const actorKey = z.string().min(1).max(180);
  const text = z.string().trim().min(1).max(500).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
  const message = z.object({ actorKey, text }).strict();
  const action = z.object({ actorKey, type: z.enum(["move", "pickup", "drop", "interact", "observe", "speak", "wait"]),
    targetKey: actorKey.optional(), content: text.optional() }).strict();
  const endpoint = (fn: (body: unknown) => unknown) => async (req: any, res: any) => {
    try { res.json(await fn(req.body)); }
    catch (error) { res.status(400).json({ error: error instanceof z.ZodError ? "Invalid request" : error instanceof Error ? error.message : "Request rejected" }); }
  };
  app.get("/api/state", (_req: any, res: any) => res.json(snapshot()));
  app.get("/api/scene", (_req: any, res: any) => {
    const { actors: _privateActors, events: _operatorEvents, worldControl: _operatorControl, townLife: _operatorLife, development: _operatorDevelopment, control: _operatorControlledBody, ...scene } = snapshot(); res.json(scene);
  });
  app.post("/api/start", endpoint(async body => { z.object({}).strict().parse(body); await demo.start(); return demo.snapshot(); }));
  let saved: Promise<void> | undefined;
  const persistStoppedWorld = AsyncResource.bind(async () => {
    await mkdir(options.directory, { recursive: true });
    await writeFile(resolve(options.directory, "session.json"), JSON.stringify(snapshot(), null, 2));
    await writeFile(resolve(options.directory, "world.json"), JSON.stringify(serializeWorld(demo.sim.world, demo.sim.god.systemRegistry), null, 2));
  });
  const stop = () => {
    if (saved) return saved;
    demo.stop();
    saved = persistStoppedWorld();
    return saved;
  };
  app.post("/api/stop", endpoint(async body => { z.object({}).strict().parse(body); await stop(); return demo.snapshot(); }));
  app.post("/api/message", endpoint(body => { const value = message.parse(body); return { id: demo.text(value.actorKey, value.text) }; }));
  app.post("/api/command", endpoint(body => { const value = message.parse(body); demo.plantThought(value.actorKey, value.text); return { accepted: true }; }));
  app.post("/api/world-command", endpoint(body => { const value = z.object({ text }).strict().parse(body); return demo.worldCommand(value.text); }));
  app.post("/api/god-command", endpoint(body => demo.godCommand(body)));
  app.post("/api/action", endpoint(body => { const value = action.parse(body); demo.dispatch(value.actorKey, value.type, value.targetKey, value.content); return { accepted: true }; }));
  app.post("/api/grow", endpoint(body => { z.object({}).strict().parse(body); return demo.grow(); }));
  // Inhabit / pause / God / interview (INHABIT-CONTRACT.md). Operator-only, token-gated like every /api route.
  const empty = (body: unknown) => z.object({}).strict().parse(body ?? {});
  app.post("/api/control/visitor", endpoint(body => demo.spawnVisitor(body ?? {})));
  app.post("/api/control/take", endpoint(body => demo.takeControl(body)));
  app.post("/api/control/release", endpoint(body => { empty(body); return demo.releaseControl(); }));
  app.post("/api/control/walk", endpoint(body => demo.walk(body)));
  app.post("/api/control/act", endpoint(body => demo.act(body)));
  app.post("/api/control/say", endpoint(body => demo.say(body)));
  app.post("/api/pause", endpoint(body => { empty(body); return demo.pause(); }));
  app.post("/api/resume", endpoint(body => { empty(body); return demo.resume(); }));
  app.post("/api/god/ask", endpoint(body => demo.askGod(body)));
  app.post("/api/interview", endpoint(body => demo.interview(body)));
  (await import("../voice/routes")).mountVoiceRoutes(app, { demo, token: options.token }); // /api/voice/* (Gemini TTS/STT; 503 without a key)
  app.use((error: unknown, _req: any, res: any, _next: any) => res.status(400).json({ error: "Malformed or oversized request" }));
  const remove = demo.onStop(() => { queueMicrotask(() => { void stop().catch(error => console.error("[SpatialDemo] Save failed", error)); }); });
  return { app, stop: async () => { remove(); await stop(); } };
}
