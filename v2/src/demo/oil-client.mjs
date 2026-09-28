import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const $ = id => document.getElementById(id);
const canvas = $("stage"), ctx = canvas.getContext("2d"), video = $("source");
const W = canvas.width, H = canvas.height;
let state, session, started = false, stopping = false, render = false, hardStop, timer;
let recorder, recordingFinished, recordingStart, lastVersion = 0, projecting = false;
let playbackZero = 0, playbackStarted = false, chunkEnd = 0, chunks = [], lastSpeech = "";
window.argosDemo = { stopped: false, recording: null, state: null, messages: [] };
const headers = { "x-argos-token": token, "Content-Type": "application/json" };
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const error = e => { $("error").textContent = e.message || String(e); };
const telemetry = data => { void request("/telemetry", data).catch(() => {}); };

function text(content, x, y, size, color = "#f0f1e6", weight = 500) {
  ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillStyle = color; ctx.fillText(content, x, y);
}
function wrapped(content, x, y, width, size, color, maxLines = 3, lineHeight = size * 1.2) {
  ctx.font = `500 ${size}px Arial, sans-serif`;
  const words = String(content || "").split(/\s+/); let line = "", lines = [];
  for (const word of words) { if (ctx.measureText(`${line} ${word}`).width > width && line) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((line, i) => text(i === maxLines - 1 && lines.length > maxLines ? `${line.slice(0, -3)}…` : line, x, y + i * lineHeight, size, color));
}
function rect(x, y, width, height, color) { ctx.fillStyle = color; ctx.fillRect(x, y, width, height); }
function label(content, x, y, color = "#a6b3aa") { text(content, x, y, 23, color, 700); }
function filmStatus() {
  if (!render) return { label: "SIMULATION VIEW · NO GENERATED VIDEO", lag: null };
  if (!playbackStarted) return { label: "CONNECTING TO H3 DIRECTOR…", lag: null };
  const elapsed = Math.max(0, video.currentTime - playbackZero);
  const chunk = chunks.find(c => elapsed >= c.start && elapsed < c.end) || chunks.at(-1);
  const source = state?.renderVersions?.[chunk?.version];
  return { label: `H3 DIRECTOR · ${source?.location?.toUpperCase() || "LIVE VIDEO"}`,
    lag: source ? Math.max(0, Math.round((state.elapsedMs - source.sourceMs) / 1000)) : null };
}
function draw() {
  rect(0, 0, W, H, "#101714");
  label("ARGOS / LIVING WORLDS", 44, 49, "#dce89c");
  text(state?.fixture ? "TEST POLICY" : "LIVE ECS + NPC", 793, 49, 23, state?.fixture ? "#f3ac93" : "#a0b4a5", 600);
  const missing = state?.phase === "discovered";
  const divergence = state?.divergence;
  const title = divergence ? "YOU CHANGED HER WORLD." : missing ? "NOW SHE KNOWS." : state?.world.beacon === "lit" ? "SHE FOUND IT. THE LIGHT LIVES." : "SHE THINKS IT’S STILL THERE.";
  text(title, 44, 112, title.length > 31 ? 47 : 55, "#f0f1e6", 750);
  text(divergence ? "Her memory has not changed. Watch what happens." : missing ? "An empty shelf. A memory that no longer fits." : "Plant a thought. Change the facts. Let her find out.", 46, 151, 26, "#9aac9f");
  const vy = 180, vh = 608;
  rect(0, vy, W, vh, "#1b2922");
  if (video.videoWidth && render) {
    const scale = Math.max(W / video.videoWidth, vh / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    ctx.save(); ctx.beginPath(); ctx.rect(0, vy, W, vh); ctx.clip();
    ctx.drawImage(video, (W - dw) / 2, vy + (vh - dh) / 2, dw, dh); ctx.restore();
  } else {
    text("THE LIGHTHOUSE", 60, vy + 120, 30, "#829888", 600);
    const nodes = [{ x: 185, name: "BEACON" }, { x: 540, name: "STAIRS" }, { x: 895, name: "KITCHEN" }];
    rect(185, vy + 260, 710, 4, "#48594b");
    for (const n of nodes) {
      ctx.beginPath(); ctx.arc(n.x, vy + 262, 62, 0, Math.PI * 2); ctx.fillStyle = "#293b2e"; ctx.fill();
      text(n.name, n.x - ctx.measureText(n.name).width / 2, vy + 374, 27, "#b5c3b7", 600);
    }
    const walking = state?.phase === "walking";
    const x = walking ? (state.destination === "Kitchen" ? 185 + state.progress * 710 : 895 - state.progress * 710) : state?.location === "Kitchen" ? 895 : state?.location === "Spiral stairs" ? 540 : 185;
    ctx.beginPath(); ctx.arc(x, vy + 262, 25, 0, Math.PI * 2); ctx.fillStyle = "#e9dc7c"; ctx.fill();
    text("MARA", x - 39, vy + 217, 23, "#efe6ad", 650);
    text(render ? "Waiting for the first video frame…" : "Actual entity locations · not a video-model preview", 60, vy + 522, 27, "#b0c3b2");
  }
  const fs = filmStatus();
  rect(25, vy + 22, 710, 44, "#101714d9");
  text(fs.label, 41, vy + 51, 21, "#e6ecdf", 650);
  if (fs.lag !== null) { rect(757, vy + 22, 298, 44, "#101714d9"); text(`WORLD AHEAD ~${fs.lag}s`, 772, vy + 51, 20, "#e6ecdf", 600); }
  if (state?.mara.speech) {
    rect(25, vy + 449, 1030, 137, "#0a100ce6");
    label("MARA · SIMULATION TRANSCRIPT", 44, vy + 482, "#dce89c");
    wrapped(`“${state.mara.speech}”`, 44, vy + 525, 980, 32, "#f7f6eb", 2, 37);
  } else if (divergence) {
    rect(25, vy + 488, 1030, 97, "#492219ec");
    text("WORLD EDIT: THE OIL IS GONE.", 48, vy + 548, 43, "#ffe1c6", 700);
  }
  const cy = 813, cw = 483;
  rect(35, cy, cw, 201, divergence ? "#3d2822" : "#202e25");
  rect(540, cy, cw + 22, 201, "#263327");
  label("WORLD FACT · NOW", 58, cy + 39, divergence ? "#f0ad95" : "#a9bcae");
  label("MARA’S BELIEF", 564, cy + 39, "#d7df98");
  const oil = state?.world.oil;
  const worldText = oil === "removed" ? "OIL: REMOVED" : oil === "elsewhere" ? "OIL: MOVED" : oil === "carried" ? "OIL: IN HAND" : oil === "used" ? "BEACON: LIT" : "OIL: ON SHELF";
  text(worldText, 58, cy + 103, 42, divergence ? "#ffc1a9" : "#ebefdf", 750);
  const belief = state?.mara.oilBelief;
  const beliefText = belief === "missing" ? "“IT’S NOT HERE.”" : belief === "carried" ? "“I HAVE IT.”" : belief === "here" ? "“I SEE IT HERE.”" : belief === "used" ? "“THE LIGHT IS ON.”" : "“ON THE SHELF.”";
  text(beliefText, 564, cy + 103, beliefText.length > 17 ? 37 : 42, "#e7eda9", 750);
  text(oil === "removed" ? "Entity deleted from the ECS" : oil === "elsewhere" ? "Containment changed in the ECS" : oil === "used" ? "Refueling succeeded" : "Read directly from world state", 58, cy + 157, 22, "#bcc5b7");
  text(belief === "missing" ? "Updated only after local observation" : divergence ? "She did not witness your change" : "Her last observation, not omniscience", 564, cy + 157, 22, "#bcc5b7");
  const lineY = 1058;
  label("CURRENT ACTION", 44, lineY, "#8da693");
  text(state?.mara.action || "Waiting at the beacon", 44, lineY + 45, 34, "#e0e8d9", 550);
  rect(44, 1126, 992, 3, "#35463a");
  const sequence = state?.receipts?.filter(r => ["thought_injected", "departed", "oil_removed", "world_edited", "absence_discovered", "oil_found", "mara_spoke", "beacon_lit"].includes(r.kind)).slice(-2) || [];
  sequence.forEach((r, i) => {
    text(`${String(Math.floor(r.atMs / 1000)).padStart(2, "0")}s`, 44, 1170 + i * 49, 24, "#859c8c", 600);
    wrapped(r.text, 113, 1170 + i * 49, 908, 25, r.kind === "oil_removed" ? "#ffbba1" : "#d3ddce", 1);
  });
  label(divergence ? "THE WORLD CHANGED. HER MEMORY DIDN’T." : "MEMORY → EXPECTATION → DISCOVERY", 44, 1296, divergence ? "#efb09a" : "#aebe88");
  text(`${String(Math.floor((state?.elapsedMs || 0) / 1000)).padStart(2, "0")}s`, 965, 1296, 27, "#a4b69f", 650);
  requestAnimationFrame(draw);
}
draw();

function updateControls() {
  const active = started && !stopping && state?.running;
  for (const id of ["inject", "talk-submit", "edit-submit", "stop"]) $(id).disabled = !active;
  $("edit-submit").disabled = !active || state?.editing;
  $("edit-submit").textContent = state?.editing ? "Editing the ECS…" : "Send to world agent →";
  $("remove").disabled = !active || !state?.canRemove;
  $("remove-hint").textContent = state?.divergence ? "Removed. She still believes it’s there." : state?.canRemove ? "She’s on the stairs. Now is your moment." : "Available while she’s walking to the kitchen.";
  $("reply").textContent = state?.mara.speech || (state?.thinking ? "Mara is thinking…" : "Her reply will appear here.");
  $("edit-result").textContent = state?.editorError || state?.editorSummary || "";
  if (state?.error) $("error").textContent = state.error;
  $("entities").replaceChildren(...(state?.entities || []).map(e => {
    const div = document.createElement("div"); div.className = "entity";
    const title = document.createElement("strong"); title.textContent = e.name;
    const detail = document.createElement("small"); detail.textContent = `${e.location || "room root"} · ${e.state}${e.description ? ` · ${e.description}` : ""}${e.ambience ? ` · ${e.ambience}` : ""}${Object.keys(e.properties || {}).length ? ` · ${JSON.stringify(e.properties)}` : ""}`;
    div.append(title, detail); return div;
  }));
  $("receipts").textContent = (state?.receipts || []).slice(-16).map(r => `${r.sequence}. ${r.text} [${r.perceived ? "Mara perceived" : "not perceived"}]`).join("\n");
}
async function poll() {
  try {
    state = await request("/state"); window.argosDemo.state = state; updateControls();
    if (!started && !state.videoAvailable) { $("start").disabled = true; $("connection").textContent = "Video needs FAL_KEY; simulation is available."; }
    if (started && render && !stopping) void sendProjection();
    if (started && !state.running && !stopping) void stop("server-deadline");
  } catch (e) { error(e); }
  if (!stopping) timer = setTimeout(poll, 750);
}
void poll();
async function sendProjection() {
  if (projecting || !session || stopping) return;
  projecting = true;
  try {
    const next = await request("/next", {});
    if (!stopping && next.prompt_version > lastVersion) {
      session.send({ type: "prompt", prompt: next.prompt, prompt_version: next.prompt_version });
      lastVersion = next.prompt_version;
    }
  } catch (e) { if (!stopping) error(e); }
  finally { projecting = false; }
}
function beginRecording() {
  if (recorder || stopping) return;
  const mimeType = ["video/mp4;codecs=avc1.42001E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot record the demo.");
  const stream = canvas.captureStream(24);
  for (const track of video.srcObject?.getAudioTracks() || []) stream.addTrack(track);
  const data = [];
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
  recordingFinished = new Promise(resolve => {
    recorder.ondataavailable = e => { if (e.data.size) data.push(e.data); };
    recorder.onstop = () => resolve(new Blob(data, { type: recorder.mimeType }));
    recorder.onerror = e => error(e.error || new Error("Recording failed"));
  });
  recorder.start(1000); recordingStart = performance.now();
  telemetry({ type: "recording_started", mimeType, composition: "1080x1350" });
}
video.addEventListener("playing", () => {
  if (!playbackStarted) { playbackStarted = true; playbackZero = video.currentTime; }
  try { beginRecording(); } catch (e) { error(e); void stop("recording-error"); }
});
async function start(withVideo) {
  if (started) return;
  $("error").textContent = ""; $("start").disabled = true; $("text-start").disabled = true;
  try {
    const initial = await request("/start", { render: withVideo });
    started = true; render = withVideo;
    hardStop = setTimeout(() => stop("duration-limit"), initial.maxSessionMs);
    if (!withVideo) { $("connection").textContent = "Simulation only · no video-generation spend"; beginRecording(); return; }
    $("connection").textContent = "Connecting to H3 Director…";
    const fal = createFalClient({ proxyUrl: "/proxy", fetch: (url, init) => {
      const h = new Headers(init?.headers); h.set("x-argos-token", token); return fetch(url, { ...init, headers: h });
    } });
    session = fal.realtime.open(wma("minimax/h3-max/director"), {
      receive: ["video", "audio"], negotiationTimeoutMs: 45000,
      onMedia(stream) { video.srcObject = stream; void video.play().catch(error); },
      onData(raw) {
        let message; try { message = JSON.parse(raw); } catch { return; }
        window.argosDemo.messages.push(message); telemetry(message);
        if (message.type === "chunk") {
          chunks.push({ start: chunkEnd, end: chunkEnd + message.playback_seconds, version: message.prompt_version });
          chunkEnd += message.playback_seconds;
          void sendProjection();
        }
        if (message.type === "error" || message.type === "stream_exhausted") void stop(message.type);
      },
      onState(value) { if (!stopping) $("connection").textContent = `Director: ${value}`; },
      onError(e) { if (!stopping) { error(e); void stop("connection-error"); } },
    });
    session.send(initial.configure); lastVersion = initial.configure.prompt_version;
  } catch (e) { error(e); if (started) await stop("startup-error"); else { $("start").disabled = false; $("text-start").disabled = false; } }
}
async function stop(reason = "manual") {
  if (stopping) return; stopping = true; clearTimeout(hardStop); clearTimeout(timer);
  try { session?.send({ type: "stop" }); } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
  if (recorder?.state !== "inactive") recorder?.stop();
  try { await session?.close(); } catch {}
  try {
    await request("/stop", {});
    if (recordingFinished) {
      const blob = await recordingFinished;
      if (!blob.size) throw new Error("The recording was empty");
      const link = $("download"); link.href = URL.createObjectURL(blob); link.download = `argos-change-her-world.${blob.type.startsWith("video/mp4") ? "mp4" : "webm"}`; link.hidden = false;
      const response = await fetch("/recording", { method: "POST", headers: { "x-argos-token": token, "Content-Type": blob.type.split(";")[0] }, body: blob, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Save failed (${response.status}); use Download this run`);
      window.argosDemo.recording = await response.json();
    }
    $("connection").textContent = "Stopped · video and world saved";
  } catch (e) { error(e); }
  finally { window.argosDemo.stopped = true; updateControls(); telemetry({ type: "local_stopped", reason, recordedMs: recordingStart ? performance.now() - recordingStart : 0 }); }
}
$("start").onclick = () => start(true);
$("text-start").onclick = () => start(false);
$("stop").onclick = () => stop();
$("inject").onclick = () => request("/control", { action: "thought", text: $("thought").value }).catch(error);
$("remove").onclick = () => request("/control", { action: "remove-oil" }).catch(error);
$("talk-form").onsubmit = e => { e.preventDefault(); void request("/control", { action: "talk", text: $("message").value }).then(() => { $("message").value = ""; }).catch(error); };
$("edit-form").onsubmit = e => { e.preventDefault(); $("edit-submit").disabled = true; void request("/edit-world", { instruction: $("edit").value }).catch(error); };
$("sound").onclick = () => { video.muted = !video.muted; $("sound").textContent = video.muted ? "Enable sound" : "Mute sound"; };
window.addEventListener("pagehide", () => { try { session?.send({ type: "stop" }); session?.close(); } catch {} });
