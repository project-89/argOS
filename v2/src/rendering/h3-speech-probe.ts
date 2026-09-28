/** Manual isolated speech probes; mode-specific session bounds, no retries/ECS writes. */
import "dotenv/config";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, appendFile, writeFile, readFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { isDirectorProxyTarget } from "./director-projection";
import { speechMatrixConfigs } from "./h3-speech-matrix";
import { continuousSpeechConfigure, continuousSpeechUpdates } from "./h3-continuous-speech-probe";
import { recordedReplay } from "./h3-recorded-replay";
import { scriptComparisonConfigs, positiveEndingConfig, timedEndingConfig } from "./h3-script-comparison";
import { memoryComparisonFromSaved } from "./h3-memory-comparison";
import { speechDensityConfigs, speechDensityProtocol } from "./h3-speech-density";

if (!process.env.FAL_KEY?.trim()) throw new Error("FAL_KEY required");
const matrix = process.argv.includes("--matrix");
const continuous = process.argv.includes("--continuous");
const facingEnding = process.argv.includes("--facing-ending");
const timedEnding = process.argv.includes("--timed-ending") || facingEnding;
const positiveEnding = process.argv.includes("--positive-ending") || timedEnding;
const memoryPath = process.argv.find(a => a.startsWith("--memory-comparison="))?.slice("--memory-comparison=".length);
const densityComparison = process.argv.includes("--density-comparison");
if (densityComparison && (memoryPath || process.argv.includes("--script-comparison") || positiveEnding)) throw new Error("Choose one script experiment");
if (memoryPath && (process.argv.includes("--script-comparison") || positiveEnding)) throw new Error("Choose one script experiment");
const memoryComparison = memoryPath ? memoryComparisonFromSaved((await readFile(resolve(memoryPath),"utf8")).trim().split("\n").map(line=>JSON.parse(line))) : undefined;
const scriptComparison = process.argv.includes("--script-comparison") || positiveEnding || !!memoryComparison || densityComparison;
const replayPath = process.argv.find(a => a.startsWith("--replay="))?.slice("--replay=".length);
if ([matrix,continuous,!!replayPath,scriptComparison].filter(Boolean).length > 1) throw new Error("Choose only one experiment");
const replay = replayPath ? recordedReplay(JSON.parse(await readFile(resolve(replayPath), "utf8"))) : undefined;
const maxSessions = continuous || replay || positiveEnding ? 1 : matrix ? 4 : 2;
const directory = await mkdtemp(resolve(replay ? "recordings/h3-recorded-replay-" : continuous ? "recordings/h3-continuous-speech-" : matrix ? "recordings/h3-speech-matrix-" : "recordings/h3-speech-probe-"));
await chmod(directory, 0o700);
const token = randomBytes(24).toString("hex"), app = express();
const line = "A restaurant where you don't leave your sweet tooth to chance, Jerry!";
const scene = "Painterly 1990s New York apartment kitchen, cream cabinets, cereal boxes, wooden counter and refrigerator. Locked medium close shot of Elaine, a slender woman in her late thirties with long curly dark brown hair, burgundy jacket and black trousers. She is the only visible person. Jerry is offscreen and silent. No cuts, subtitles or UI.";
const delivery = "After a brief pause, she speaks once in clear English with a composed, lightly emphatic delivery, from about 0.3 to 5.6 seconds.";
const ending = "Then she closes her mouth and stays quietly in place through second 10. No additional speech, repeated words or vocal sounds.";
const silence = "Continue the same locked shot and unchanged appearance. Elaine remains quietly in place with her mouth closed for all ten seconds. Jerry remains offscreen and silent. No speech, vocal sounds, music, cuts, subtitles or UI. Quiet room tone only.";
const variants = {
  plain: [ `${scene}\n${delivery} Elaine says: "${line}"\n${ending}\nQuiet room tone only under the voice and afterward. No music.`, silence ],
  structured: [ `integrated_multimodal_description: [Shot 1] ${scene} ${delivery} Elaine (S1) says: <d>[English] ${line}</d> ${ending}\n\noverall_soundscape: Quiet room tone only, without other vocal sounds.\n\nnon_diegetic_music: N/A`,
    `integrated_multimodal_description: [Shot 1] ${silence}\n\noverall_soundscape: Quiet room tone only, without vocal sounds.\n\nnon_diegetic_music: N/A` ],
};
const configs: Record<string, Omit<typeof continuousSpeechConfigure,"seed"> & {seed?:number;script?: Array<{offset: number; prompt: string}>}> = densityComparison ? speechDensityConfigs() : memoryComparison ? memoryComparison.configs : facingEnding ? {facingEnding:timedEndingConfig(true)} : timedEnding ? {timedEnding:timedEndingConfig()} : positiveEnding ? {positiveEnding:positiveEndingConfig()} : scriptComparison ? scriptComparisonConfigs() : replay ? { replay: replay.configure } : continuous ? { continuous: continuousSpeechConfigure } : matrix ? speechMatrixConfigs() : Object.fromEntries(Object.entries(variants).map(([mode, prompts]) => [mode, {
  type: "configure", protocol_version: 1, prompt_version: 1,
  prompt: scene, script: prompts.map((prompt, index) => ({ offset: index * 10, prompt })),
  chunk_duration: 10, resolution: "480p", aspect_ratio: "16:9", memory: 12, seed: 891209,
}]));
await writeFile(resolve(directory, "experiment.json"), JSON.stringify({
  source: scriptComparison ? "h3-script-comparison.ts frozen fixture; no NPCs" : replay ? resolve(replayPath!) : continuous ? "Frozen synthetic dialogue fixture; no live NPC decisions" : "h3-bounded-verification-YYYCNY/screenplay.json version 6", ...(replay ? {updates:replay.updates} : continuous ? { updates: continuousSpeechUpdates } : scriptComparison ? {} : {line}), configs,
  limits: { sessions: maxSessions, perMode: 1, playbackSeconds: scriptComparison ? 60 : replay?.playbackSeconds ?? (continuous ? 30 : matrix ? "one native chunk per mode (5 or 10 seconds)" : 20), wallSeconds: scriptComparison ? 120 : replay ? replay.wallMs/1000 : 70 },
  experiment: positiveEnding ? "Preloaded baseline plus one positive post-line action per beat; compare recordings/h3-speech-probe-RHjtm0/preloaded.mp4. Same six lines, offsets, seed, memory and resolution; one run." : scriptComparison ? "One stationary speaker, six identical unique lines: offset-zero append versus preloaded offsets 0/10/20/30/40/50; memory 12, seed 891209, 480p; no cognition" : replay ? "One unchanged saved real-time screenplay; steady ensemble framing, no simulation calls. Full protocol in replay-protocol.json." : continuous ? "Direct continuous handoff, three alternating lines and one camera change; updates only after their predecessor version has a chunk receipt" : matrix ? "2x2 duration versus delivery path; identical words and natural-pace instruction in every cell" : "compact versus structured",
  caveats: ["One trial per format is exploratory, not a reliability estimate.", "No shared first-frame image; seed and appearance descriptions are matched, not pixel-identical scenes.", "Simplified single shot isolates speech; not an end-to-end simulation acceptance test."],
  ...(densityComparison ? speechDensityProtocol : {}),
  ...(timedEnding ? {experiment:"Preloaded baseline with separate quiet-action beats four seconds after each spoken-line beat. Six unchanged sentences; same premise, seed, memory, resolution and ten-second chunks. One session, no updates."} : {}),
  ...(facingEnding ? {experiment:"One final bounded trial: identical to timed-ending trial except quiet-action beats keep Alex facing the camera, hands resting on the table. One session, no updates, same six speech beats and all configuration."} : {}),
  ...(memoryComparison ? {source:resolve(memoryPath!),experiment:"Saved first 60s; same six native append packets, resolution and pair seed. Only memory differs: 12 versus 1. No NPC calls or automatic retries.",
    updates:memoryComparison.updates,seedOrigin:memoryComparison.seedOrigin} : {}),
}, null, 2), { flag: "wx", mode: 0o600 });
if (replay) await writeFile(resolve(directory,"replay-protocol.json"),JSON.stringify({source:resolve(replayPath!),...replay,
  limits:{sessions:1,retries:0,mediaSeconds:replay.playbackSeconds,wallMs:replay.wallMs},
  noCognition:true,unchangedPublicPrompts:true,seed:"not set, matching production",caution:"Not pixel-identical to prior generation"},null,2),{flag:"wx",mode:0o600});
const bundle = await build({ entryPoints: [fileURLToPath(new URL("h3-speech-probe-client.mjs", import.meta.url))], bundle: true, write: false, platform: "browser", format: "esm" });
app.get("/", (_req, res) => res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Argos speech comparison</title><style>body{background:#101812;color:#f1f0df;font:17px system-ui;padding:24px}video{width:900px;max-width:100%}button{padding:12px;margin:6px}pre{white-space:pre-wrap}</style><h1>H3 speech comparison</h1><p>${memoryComparison ? "Same saved 60-second scene; memory 12 versus 1." : scriptComparison ? "Six fixed text beats over 60 seconds." : "Bounded fixed-script comparison."} ${maxSessions} sessions maximum. No simulation or automatic retries.</p>${Object.keys(configs).map(mode=>`<button data-mode="${mode}" id="${mode}">Run ${mode}</button>`).join("")}<button id="stop">Stop</button><br><video id="video" autoplay muted playsinline controls></video><p id="downloads"></p><pre id="status">Ready</pre><script type="module" src="/client.js"></script>`));
app.get("/client.js", (_req,res) => res.type("js").send(bundle.outputFiles[0].text));
app.use((req,res,next) => {
  const given = Buffer.from(req.get("x-argos-token") ?? ""), expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) { res.sendStatus(403); return; }
  next();
});
const saved = new Set<string>(), started = new Set<string>();
app.post("/recording/:mode", express.raw({ type: ["video/mp4", "video/webm"], limit: replay ? "64mb" : "32mb" }), async (req,res) => {
  const mode = req.params.mode;
  if (!started.has(mode) || saved.has(mode) || !Buffer.isBuffer(req.body) || !req.body.length) { res.sendStatus(409); return; }
  saved.add(mode);
  const path = resolve(directory, `${mode}.${req.is("video/mp4") ? "mp4" : "webm"}`);
  try { await writeFile(path, req.body, { flag: "wx", mode: 0o600 }); res.json({path,bytes:req.body.length}); }
  catch { res.sendStatus(500); }
});
app.use(express.json({ limit: "256kb" }));
app.post("/start/:mode", (req,res) => {
  const mode = req.params.mode;
  if (!Object.hasOwn(configs, mode) || started.has(mode)) { res.sendStatus(409); return; }
  started.add(mode); res.json(scriptComparison ? {configure:configs[mode],wallMs:120000,playbackSeconds:60,scriptComparison:true,
    ...(memoryComparison ? {scriptAppend:true,scriptUpdates:memoryComparison.updates} : {})}
    : replay ? {...replay,continuous:true,replay:true} : { configure: configs[mode], wallMs: 70000, playbackSeconds: continuous ? 30 : matrix ? configs[mode].chunk_duration : 20, continuous });
});
app.post("/evidence", async (req,res) => {
  try { await appendFile(resolve(directory,"transport.jsonl"), JSON.stringify({receivedAt:new Date().toISOString(),...req.body})+"\n", {mode:0o600}); res.sendStatus(204); }
  catch { res.sendStatus(500); }
});
let allocations = 0;
app.post("/proxy", async (req,res) => {
  const target = req.get("x-fal-target-url") ?? "";
  if (!isDirectorProxyTarget(target) || ((target.endsWith("/ice") || target.endsWith("/session")) && req.body.app_id !== "minimax/h3-max/director")) { res.sendStatus(403); return; }
  if (target.endsWith("/session") && ++allocations > Math.min(maxSessions, started.size)) { res.sendStatus(409); return; }
  try {
    const response = await fetch(target, {method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),headers:{Authorization:`Key ${process.env.FAL_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(req.body)});
    res.status(response.status).type("json").send(await response.text());
  } catch { res.sendStatus(502); }
});
const server = app.listen(0,"127.0.0.1", () => {
  const a=server.address(); if(!a || typeof a === "string") throw new Error("No address");
  console.log(`SPEECH_PROBE_READY http://127.0.0.1:${a.port}/#${token}`);
  console.log(`SPEECH_PROBE_EVIDENCE ${directory}`);
});
process.once("SIGINT",()=>server.close());
