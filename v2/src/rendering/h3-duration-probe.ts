/** Isolated, manual opt-in transport probe. No ECS, NPC inference or auto-retry. */
import "dotenv/config";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { isDirectorProxyTarget } from "./director-projection";

if (!process.env.FAL_KEY?.trim()) throw new Error("FAL_KEY required");
const directory = await mkdtemp(resolve("recordings/h3-duration-probe-"));
const token = randomBytes(24).toString("hex"), app = express();
let allocations = 0;
const bundle = await build({ entryPoints: [fileURLToPath(new URL("h3-duration-probe-client.mjs", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm" });
app.use(express.json({ limit: "128kb" }));
app.get("/", (_req, res) => res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>H3 duration probe</title>
<h1>Bounded H3 duration probe</h1><p>Each test: maximum 45 seconds. At most two sessions. No NPC simulation.</p>
<button id="prompt">Test prompt duration change</button><button id="configure">Test reconfigure duration change</button>
<button id="stop">Stop</button><video id="video" autoplay muted playsinline style="width:640px;max-width:100%"></video>
<pre id="status">Ready</pre><script type="module" src="/client.js"></script>`));
app.get("/client.js", (_req,res) => res.type("js").send(bundle.outputFiles[0].text));
app.use((req,res,next) => {
  const given = Buffer.from(req.get("x-argos-token") ?? ""), expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) { res.sendStatus(403); return; }
  next();
});
app.post("/evidence", async (req,res) => {
  try { await appendFile(resolve(directory,"transport.jsonl"), JSON.stringify({ receivedAt: new Date().toISOString(), ...req.body })+"\n"); res.sendStatus(204); }
  catch { res.sendStatus(500); }
});
app.post("/proxy", async (req,res) => {
  const target = req.get("x-fal-target-url") ?? "";
  if (!isDirectorProxyTarget(target) || (target.endsWith("/ice") || target.endsWith("/session"))
    && req.body.app_id !== "minimax/h3-max/director") { res.sendStatus(403); return; }
  if (target.endsWith("/session") && ++allocations > 2) { res.sendStatus(409); return; }
  try {
    const response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    res.status(response.status).type("json").send(await response.text());
  } catch { res.sendStatus(502); }
});
const server = app.listen(0,"127.0.0.1", () => {
  const a = server.address(); if (!a || typeof a === "string") throw new Error("No address");
  console.log(`PROBE_READY http://127.0.0.1:${a.port}/#${token}`); console.log(`PROBE_EVIDENCE ${directory}`);
});
process.once("SIGINT", () => server.close());
