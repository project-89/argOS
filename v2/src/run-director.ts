/** Local-only WebRTC receiver. No Argos UI dependency; FAL_KEY stays server-side. */
import "dotenv/config";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createSimulation } from "./index";
import { directorConfigure, isDirectorProxyTarget, projectDirectorScene } from "./rendering/director-projection";
import { installDirectorRecording } from "./rendering/director-recording";

for (const name of ["FAL_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required in .env`);
}
const seed = process.argv.slice(2).join(" ").trim() ||
  "Mara, a lighthouse keeper in a yellow raincoat, tends an old brass beacon on a rainy island. A visitor waits in the kitchen. Keep this a small, grounded world with two rooms, two people, and practical objects.";
const maxSessionMs = Number(process.env.ARGOS_DIRECTOR_SECONDS ?? 60) * 1000;
if (!Number.isFinite(maxSessionMs) || maxSessionMs < 10000 || maxSessionMs > 120000) {
  throw new Error("ARGOS_DIRECTOR_SECONDS must be between 10 and 120 for this smoke runner");
}
const token = randomBytes(24).toString("hex");
const bundle = await build({ entryPoints: [fileURLToPath(new URL("./rendering/director-client.mjs", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm" });
const sim = await createSimulation({ name: "Director Lighthouse", narrative: seed, genesis: { seed },
  enableServer: false, enableSpirits: true, enableNarrativeEngine: true });
const npc = sim.getAgents().find(agent => agent.name === process.env.ARGOS_NPC) ?? sim.getAgents()[0];
if (!npc) throw new Error("Genesis produced no NPC to follow");
const app = express();
app.use(express.json({ limit: "256kb" }));
app.get("/", (_req, res) => res.type("html").send(`<!doctype html><title>Argos Director receiver</title>
  <body style="background:#111;color:#ddd;font:16px monospace"><h1>Argos → H3 Director</h1>
  <p>Local test receiver · 480p · hard stop ${maxSessionMs / 1000}s · one session per launch</p>
  <button id="start">Start bounded stream</button><button id="stop">Stop &amp; save</button>
  <a id="download" hidden style="color:#9df">Download recording</a>
  <video autoplay muted playsinline controls style="display:block;width:80vw"></video><pre></pre>
  <script type="module" src="/client.js"></script></body>`));
app.get("/client.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
app.use((req, res, next) => {
  const supplied = Buffer.from(req.get("x-argos-token") ?? "");
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.sendStatus(403); return; }
  next();
});
let started = false, stopped = false, version = 0, allocated = false;
let deadline: NodeJS.Timeout | undefined;
function stop() { stopped = true; clearTimeout(deadline); sim.stop(); }
function scene() {
  const current = sim.getAgents().find(agent => agent.eid === npc.eid);
  if (!current) throw new Error("Selected NPC no longer exists");
  version++;
  console.log(JSON.stringify({ type: "director_projection", version, sourceTick: sim.tick, npc: current.name, room: current.room }));
  return projectDirectorScene(seed, current, sim.tick);
}
app.post("/start", async (_req, res) => {
  if (started || stopped) { res.sendStatus(409); return; }
  started = true;
  deadline = setTimeout(stop, maxSessionMs + 2000);
  await sim.start();
  res.json({ maxSessionMs, configure: directorConfigure(scene(), version) });
});
app.post("/next", (_req, res) => {
  if (!started || stopped) { res.sendStatus(409); return; }
  res.json({ type: "prompt", prompt: scene(), prompt_version: version });
});
app.post("/telemetry", (req, res) => { console.log(JSON.stringify({ director: req.body })); res.sendStatus(204); });
app.post("/stop", (_req, res) => { stop(); res.sendStatus(204); });
installDirectorRecording(app, () => started && stopped);
app.post("/proxy", async (req, res) => {
  const target = req.get("x-fal-target-url") ?? "";
  if (!started || stopped || !isDirectorProxyTarget(target)) { res.sendStatus(403); return; }
  if (target.endsWith("/ice") || target.endsWith("/session")) {
    if (req.body.app_id !== "minimax/h3-max/director") { res.sendStatus(403); return; }
  }
  if (target.endsWith("/session")) {
    if (allocated) { res.sendStatus(409); return; }
    allocated = true; // Never retry allocation automatically: avoid duplicate billable sessions.
  }
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableEnded) abort.abort(); });
  const timeout = setTimeout(() => abort.abort(), 45000);
  try {
    const upstream = await fetch(target, { method: "POST", redirect: "error", signal: abort.signal,
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    console.log(`[Director proxy] ${new URL(target).pathname}: HTTP ${upstream.status}`);
    res.status(upstream.status).type("json").send(await upstream.text());
  } catch { res.status(502).json({ error: "Director signaling failed" }); }
  finally { clearTimeout(timeout); }
});
const port = Number(process.env.ARGOS_DIRECTOR_PORT ?? 3460);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`DIRECTOR_READY http://127.0.0.1:${port}/#${token}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stop(); server.close(); setTimeout(() => process.exit(0), 1000).unref();
});
