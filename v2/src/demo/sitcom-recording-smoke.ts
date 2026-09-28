/** Local browser smoke test for the production recording client and receiver.
 * Run: npx tsx src/demo/sitcom-recording-smoke.ts
 * This is synthetic media and offline ECS state, not an H3/NPC demonstration.
 * No model key or provider connection is used, even if keys exist in the shell.
 */
import express from "express";
import { build } from "esbuild";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApartmentSitcom } from "./apartment-sitcom";
import { createSitcomDemoApp } from "./sitcom-server";

// Defense in depth: offline simulation must never reach a paid model, and the
// receiver's provider proxy is also overridden below before it can be routed.
globalThis.fetch = async () => { throw new Error("External requests are disabled in the offline recording smoke test"); };

const providerShim = String.raw`
let audioContext;
document.addEventListener("click", () => {
  try {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AudioContext && !audioContext) audioContext = new AudioContext();
    void audioContext?.resume().catch(() => {});
  } catch {}
}, { capture: true, once: true });
window.argosRecordingSmoke = { synthetic: true, paidRequests: 0, configured: false, stopped: false, frames: 0, audio: false };
export const wma = name => name;
export const createFalClient = () => ({ realtime: { open(_model, callbacks) {
  let running = false, configured = false, stream, oscillator, animation, watchdog;
  const emit = value => callbacks.onData?.(JSON.stringify(value));
  const finish = () => {
    if (!running) return;
    running = false; cancelAnimationFrame(animation); clearTimeout(watchdog);
    try { oscillator?.stop(); } catch {}
    for (const track of stream?.getTracks() ?? []) track.stop();
    void audioContext?.close().catch(() => {});
    window.argosRecordingSmoke.stopped = true;
    callbacks.onState?.("offline fixture stopped");
  };
  return {
    send(message) {
      if (message.type === "stop") { finish(); return; }
      if (message.type === "prompt") return;
      if (message.type !== "configure" || configured) return;
      configured = true; running = true;
      window.argosRecordingSmoke.configured = true;
      const canvas = document.createElement("canvas"); canvas.width = 832; canvas.height = 480;
      const ctx = canvas.getContext("2d"), zero = performance.now();
      const draw = () => {
        if (!running) return;
        const seconds = (performance.now() - zero) / 1000;
        ctx.fillStyle = "#10231c"; ctx.fillRect(0, 0, 832, 480);
        ctx.fillStyle = "#d5e68d"; ctx.font = "bold 30px system-ui";
        ctx.fillText("OFFLINE RECORDING TEST", 38, 65);
        ctx.fillStyle = "#ffbc74"; ctx.fillText("NO H3 · SYNTHETIC MEDIA", 38, 109);
        ctx.fillStyle = "#e9f1e6"; ctx.font = "20px system-ui";
        ctx.fillText("Production client → native MediaRecorder → chunk uploads", 38, 151);
        ctx.fillStyle = "#293d32"; ctx.fillRect(38, 190, 756, 172);
        ctx.fillStyle = "#80ddbf";
        ctx.beginPath(); ctx.arc(115 + (seconds * 83) % 600, 277 + Math.sin(seconds * 2) * 43, 35, 0, Math.PI * 2); ctx.fill();
        ctx.font = "bold 24px monospace"; ctx.fillStyle = "#e9f1e6";
        ctx.fillText(seconds.toFixed(2) + "s  / frame " + window.argosRecordingSmoke.frames++, 38, 414);
        ctx.font = "15px system-ui"; ctx.fillStyle = "#abc1b0";
        ctx.fillText("Fixture pixels only. Recording outputs must never be presented as model-generated.", 38, 451);
        animation = requestAnimationFrame(draw);
      };
      draw(); stream = canvas.captureStream(24);
      try {
        if (audioContext?.state === "running") {
          const destination = audioContext.createMediaStreamDestination(), gain = audioContext.createGain();
          gain.gain.value = 0.025;
          oscillator = audioContext.createOscillator(); oscillator.frequency.value = 440;
          oscillator.connect(gain); gain.connect(destination); oscillator.start();
          for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
          window.argosRecordingSmoke.audio = true;
        }
      } catch {}
      callbacks.onState?.("OFFLINE fixture · no H3 connection");
      emit({ type: "session_info", max_session_seconds: null, playback_fps: 24 });
      emit({ type: "chunk", chunk_index: 0, prompt_version: message.prompt_version, playback_seconds: 10, generation_seconds: 0 });
      callbacks.onMedia?.(stream);
      // Independent fixture guard. The real receiver/client own their normal
      // 10-second budgets, lease, Stop, recorder finalization and persistence.
      watchdog = setTimeout(finish, 20000);
    },
    async close() { finish(); },
  };
} } });
`;

const port = Number(process.env.ARGOS_SMOKE_PORT ?? 3468);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("ARGOS_SMOKE_PORT must be a local unprivileged port");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "OFFLINE-recording-smoke-"));
const token = randomBytes(24).toString("hex");
const testbed = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null });
const receiver = await createSitcomDemoApp({ testbed, directory, token, seconds: 10, allowVideo: true });
const compiled = await build({ entryPoints: [fileURLToPath(new URL("sitcom-client.mjs", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm", plugins: [{ name: "offline-synthetic-director", setup(plugin) {
    plugin.onResolve({ filter: /^@fal-ai\/client(?:\/realtime)?$/ }, () => ({ path: "offline-provider", namespace: "offline-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "offline-fixture" }, () => ({ contents: providerShim, loader: "js" }));
  } }] });
const app = express();
app.use((_req, res, next) => {
  res.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:");
  next();
});
app.all("/proxy", (_req, res) => res.status(503).json({ error: "NO H3: provider access is disabled in this offline recording smoke test" }));
app.get("/client.js", (_req, res) => res.type("js").send(compiled.outputFiles[0].text));
app.use(receiver.app);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`OFFLINE_RECORDING_SMOKE_READY http://127.0.0.1:${port}/#${token}`);
  console.log(`OFFLINE_RECORDING_SMOKE_DIRECTORY ${directory}`);
  console.log("NO H3 / NO LLM / SYNTHETIC MEDIA ONLY. Click Go live for the native-browser recording smoke test.");
});
server.once("error", error => { console.error(error); void receiver.stop("smoke-server-error").finally(() => { process.exitCode = 1; }); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void receiver.stop("smoke-shutdown").finally(() => server.close());
  setTimeout(() => process.exit(0), 5000).unref();
});
