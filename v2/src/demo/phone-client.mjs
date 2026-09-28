import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { PhonePlaybackTimeline, PhonePlaybackDisplayTracker, PhonePromptFlow, PhonePromptDeliveryTracker,
    sendPromptTransaction, isChunkDurationConfigureRejection, renderHorizonFromChunk,
    presentationAtPlayback, audienceMessages, capturePresentation, currentThought } from "./phone-presentation";
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const $ = id => document.getElementById(id);
const canvas = $("stage"), ctx = canvas.getContext("2d"), video = $("source");
const headers = { "x-argos-token": token, "Content-Type": "application/json" };
let state, session, started = false, stopping = false, render = false, hardStop, timer;
let recorder, recordingFinished, recordedStream, projecting = false, projectAgain = false;
let playbackZero = 0, playbackStarted = false, recordingStart = 0, recordingEnd = 0, sessionLimitMs = 0;
let frameMediaTime = Number.NaN, framePlaybackOffset = Number.NaN, sourceEpochWallMs = Number.NaN;
let configureState = "not-sent", fallbackConfigure = null;
let renderHorizonMs = 5000;
let serverHorizonSupplied = false;
const RECORDING_FINALIZE_TIMEOUT_MS = 5000;
const timeline = new PhonePlaybackTimeline();
const displayTracker = new PhonePlaybackDisplayTracker();
const promptFlow = new PhonePromptFlow();
const promptDelivery = new PhonePromptDeliveryTracker();
const promptSources = new Map();
const promptCapturedWalls = new Map();
const hasVideoFrameClock = typeof video.requestVideoFrameCallback === "function";
let transportBegan = performance.now(), transportBeganWallMs = Date.now();
const syncTelemetry = [];
let audienceKey = "";
let selected, previous = new Map(), changed = new Map(), chatKey = "", thoughtKey = "";
let componentStructureKey = "", componentCells = new Map(), entityButtons = new Map();
window.argosPhone = { stopped: false, recording: null, state: null, messages: [], syncTelemetry };
async function request(path, body, options = {}) {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: options.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}
const error = e => { $("error").textContent = e.message || String(e); $("error").hidden = false; };
const telemetry = data => { void request("/telemetry", data).catch(() => { }); };
const mediaTime = () => Number.isFinite(frameMediaTime) ? frameMediaTime : Number(video.currentTime) || 0;
const elementPlaybackTime = () => Math.max(0, (Number(video.currentTime) || 0) - playbackZero);
const playbackTime = () => Number.isFinite(frameMediaTime) && Number.isFinite(framePlaybackOffset)
    ? Math.max(0, frameMediaTime + framePlaybackOffset) : elementPlaybackTime();
function recordSync(type, detail = {}) {
    if (syncTelemetry.length >= 2048) return;
    const entry = {
        type,
        atMs: Math.max(0, performance.now() - transportBegan),
        wallMs: Date.now(),
        mediaTime: Math.max(0, mediaTime()),
        playbackTime: playbackStarted ? playbackTime() : 0,
        worldMs: Number.isFinite(state?.elapsedMs) ? state.elapsedMs : 0,
        ...promptFlow.snapshot(),
    };
    const promptVersion = detail.prompt_version ?? detail.promptVersion;
    const inferredSourceMs = promptSources.get(promptVersion);
    const inferredCapturedWallMs = promptCapturedWalls.get(promptVersion);
    const numbers = {
        promptVersion,
        sourceMs: detail.sourceMs ?? inferredSourceMs,
        sourceCapturedWallMs: detail.sourceCapturedWallMs ?? inferredCapturedWallMs,
        chunkIndex: detail.chunk_index,
        playbackSeconds: detail.playback_seconds,
        chunkStartSeconds: detail.chunkStartSeconds,
        requestedDurationSeconds: detail.requested_duration_seconds,
        generationSeconds: detail.generation_seconds,
        bufferDepthSeconds: detail.buffer_depth_seconds,
        chunkDuration: detail.chunk_duration,
        minChunkDuration: detail.min_chunk_duration,
        maxChunkDuration: detail.max_chunk_duration,
        defaultChunkDuration: detail.default_chunk_duration,
        continuationPlaybackSeconds: detail.continuation_playback_seconds,
        schedulingLeadMs: detail.scheduling_lead_ms,
        schedulingSlackMs: detail.scheduling_slack_ms,
        sourceEpochWallMs: detail.sourceEpochWallMs,
        sourceToDisplayMs: detail.sourceToDisplayMs,
        sourceToFilmOffsetMs: detail.sourceToFilmOffsetMs,
        frameCrossingLateMs: detail.frameCrossingLateMs,
    };
    for (const [key, value] of Object.entries(numbers)) if (Number.isFinite(value)) entry[key] = value;
    if (typeof detail.reason === "string") entry.reason = detail.reason.slice(0, 160);
    else if (typeof detail.error === "string") entry.reason = detail.error.slice(0, 160);
    if (typeof detail.code === "string") entry.code = detail.code.slice(0, 80);
    syncTelemetry.push(entry);
}
function recordDisplayedSegments() {
    if (!render || !playbackStarted || stopping) return;
    const playhead = playbackTime();
    for (const chunk of displayTracker.crossed(timeline.snapshot(), playhead)) {
        const sourceMs = promptSources.get(chunk.version);
        const sourceCapturedWallMs = promptCapturedWalls.get(chunk.version);
        // Display truth advances here and nowhere else: this callback is tied to
        // a real video-frame crossing, not early data-channel metadata.
        promptFlow.markDisplayed(chunk);
        window.argosPhone.promptFlow = promptFlow.snapshot();
        recordSync("segment_displayed", {
            chunk_index: chunk.index,
            prompt_version: chunk.version,
            sourceMs,
            sourceCapturedWallMs,
            chunkStartSeconds: chunk.start,
            sourceToDisplayMs: Number.isFinite(sourceCapturedWallMs) ? Date.now() - sourceCapturedWallMs
                : Number.isFinite(sourceMs) && Number.isFinite(sourceEpochWallMs)
                    ? Date.now() - (sourceEpochWallMs + sourceMs) : undefined,
            sourceToFilmOffsetMs: Number.isFinite(sourceMs) ? chunk.start * 1000 - sourceMs : undefined,
            frameCrossingLateMs: Math.max(0, (playhead - chunk.start) * 1000),
        });
    }
}
if (hasVideoFrameClock) {
    const observeFrame = (_now, metadata) => {
        if (Number.isFinite(metadata?.mediaTime)) {
            frameMediaTime = metadata.mediaTime;
            // Calibrate the provider/RTP timestamp once, then advance from exact
            // displayed-frame mediaTime rather than polling video.currentTime.
            if (playbackStarted && !Number.isFinite(framePlaybackOffset))
                framePlaybackOffset = elementPlaybackTime() - metadata.mediaTime;
        }
        recordDisplayedSegments();
        video.requestVideoFrameCallback(observeFrame);
    };
    video.requestVideoFrameCallback(observeFrame);
}
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; if (className)
    e.className = className; return e; };
const sec = ms => `${Math.floor(ms / 1000)}s`;
function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
function text(value, x, y, size = 26, color = "#eceede", weight = 500) { ctx.font = `${weight} ${size}px Arial,sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y); }
function filmShot() {
    if (!render || !playbackStarted) return { shot: null, presentation: null,
        presentationVersion: null, matched: false, projectedTransition: false };
    return presentationAtPlayback(state?.camera.shots || [], timeline.snapshot(), playbackTime());
}
function polygon(points, color) { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#617058"; ctx.lineWidth = 2; ctx.stroke(); }
function diagram() {
    const rooms = [{ name: "Landing", x: 70, y: 400 }, { name: "Bedroom", x: 580, y: 355 }, { name: "Basement", x: 340, y: 610 }];
    for (const r of rooms) {
        polygon([[r.x, r.y], [r.x + 250, r.y - 75], [r.x + 405, r.y + 35], [r.x + 145, r.y + 110]], "#2b3b2e");
        polygon([[r.x, r.y], [r.x, r.y - 85], [r.x + 250, r.y - 160], [r.x + 250, r.y - 75]], "#384b39");
        text(r.name.toUpperCase(), r.x + 70, r.y + 27, 23, "#acbea7", 600);
    }
    let pos = rooms.find(r => r.name === state?.location) || { x: 325, y: 345 };
    const x = pos.x + 175, y = pos.y - 45;
    ctx.beginPath();
    ctx.ellipse(x, y + 30, 25, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0c150cb3";
    ctx.fill();
    rect(x - 10, y - 5, 20, 33, "#d3d990");
    ctx.beginPath();
    ctx.arc(x, y - 16, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#e0c5a5";
    ctx.fill();
    text("MARA", x - 29, y - 40, 18, "#e1edb6", 700);
    const phoneRoom = rooms.find(r => r.name === state?.phone.room);
    if (phoneRoom) {
        rect(phoneRoom.x + 320, phoneRoom.y - 15, 20, 32, state?.phone.battery > 0 ? "#a6d9cb" : "#080f0a");
    }
    text("ECS LOCATION DIAGRAM · NOT GENERATED VIDEO", 40, 756, 21, "#95ab97", 600);
}
function draw() {
    if (!hasVideoFrameClock) recordDisplayedSegments();
    // The canvas is only a simulation-only diagram. Never draw the live video
    // through it: the player and recorder use the incoming media directly.
    if (!render) {
        rect(0, 0, canvas.width, canvas.height, "#1b2a20");
        ctx.save();
        ctx.translate(0, -185);
        diagram();
        ctx.restore();
    }
    const film = filmShot(), { shot, matched } = film;
    const timing = shot ? `Scene state ~${sec(shot.sourceMs)} · ${stopping ? "saved replay" : `world ahead ~${sec(Math.max(0, (state?.elapsedMs || 0) - shot.sourceMs))}`} · ${matched ? "chunk-aligned, not frame-exact" : "holding last mapped scene"}` : render ? "Waiting for video timing · future thoughts hidden" : "Simulation diagram · no video recording";
    if ($("video-timing").textContent !== timing) $("video-timing").textContent = timing;
    renderAudience(film);
    requestAnimationFrame(draw);
}
draw();
function renderInspector() {
    const filter = $("filter").value.toLowerCase(), entities = state?.entities || [];
    if (!entities.some(e => e.id === selected))
        selected = entities.find(e => e.name === "Mara")?.id;
    const visibleEntities = entities.filter(e => `${e.name} ${Object.keys(e.components).join(" ")}`.toLowerCase().includes(filter));
    const visibleIds = new Set(visibleEntities.map(e => e.id));
    for (const [id, button] of entityButtons) if (!visibleIds.has(id)) { button.remove(); entityButtons.delete(id); }
    for (const e of visibleEntities) {
        let button = entityButtons.get(e.id);
        if (!button) {
            button = node("button"); button.onclick = () => { selected = e.id; renderInspector(); };
            entityButtons.set(e.id, button); $("entity-list").append(button);
        }
        const label = `#${e.id} ${e.name}`;
        if (button.textContent !== label) button.textContent = label;
        button.className = e.id === selected ? "selected" : "";
    }
    const entity = entities.find(e => e.id === selected);
    if (!entity)
        return;
    $("selected-title").textContent = `#${entity.id} ${entity.name}`;
    const components = { LocatedIn: { target: entity.container }, ...entity.components };
    const order = Object.entries(components).sort(([a], [b]) => (a === "LocatedIn" ? -2 : a.startsWith("Demo") ? -1 : 0) - (b === "LocatedIn" ? -2 : b.startsWith("Demo") ? -1 : 0));
    const structureKey = JSON.stringify([entity.id, order.map(([name, fields]) => [name, Object.keys(fields)])]);
    if (structureKey !== componentStructureKey) {
        componentStructureKey = structureKey;
        componentCells = new Map();
        $("components").replaceChildren(...order.map(([name, fields]) => {
            const table = node("table");
            table.append(node("caption", name));
            const body = node("tbody");
            const entries = Object.entries(fields);
            if (!entries.length)
                entries.push(["(tag)", true]);
            for (const [field] of entries) {
                const row = node("tr");
                row.append(node("td", field));
                const cell = node("td");
                componentCells.set(`${name}.${field}`, cell);
                row.append(cell);
                body.append(row);
            }
            table.append(body);
            return table;
        }));
    }
    for (const [name, fields] of order) {
        const entries = Object.entries(fields);
        if (!entries.length)
            entries.push(["(tag)", true]);
        for (const [field, value] of entries) {
            const cell = componentCells.get(`${name}.${field}`);
            const content = typeof value === "string" ? value : JSON.stringify(value);
            if (cell.textContent !== content)
                cell.textContent = content;
            cell.className = (changed.get(`${entity.id}.${name}.${field}`) || 0) > performance.now() ? "changed" : "";
        }
    }
}
function renderAudience(film = filmShot()) {
    if (!state) return;
    const shot = film.shot;
    const view = render ? film.presentation : state;
    const visible = audienceMessages(state.messages, view);
    const renderKey = JSON.stringify([render, shot?.version, film.presentationVersion, render ? null : [state.elapsedMs, state.phase, state.decisions,
        state.mara, state.phone, state.door, state.screen, state.thoughts], visible, $("show-phone-text").checked]);
    if (renderKey === audienceKey) return;
    audienceKey = renderKey;
    window.argosPhone.presentation = render ? view : capturePresentation(state);
    window.argosPhone.filmVersion = shot?.version ?? null;
    window.argosPhone.presentationVersion = render ? film.presentationVersion : null;
    $("thinking").textContent = render ? "WITH THE FILM" : "SIMULATION NOW";
    const thought = currentThought(view);
    $("current-thought").textContent = thought ? `“${thought.text}”` : render && !view ? "Waiting for her scene…" : "No thought yet.";
    $("current-thought").className = thought ? "" : "empty";
    $("thought-kind").textContent = thought?.kind === "thought_injected" ? "/ PLANTED IMPULSE" : "/ CURRENT THOUGHT";
    $("thought-time").textContent = thought ? sec(thought.atMs) : "";
    $("world-clock").textContent = view ? `${render ? "IN THIS SCENE" : "WORLD NOW"} / ${sec(view.elapsedMs)}` : "WAITING FOR VIDEO";
    const screen = render && view && $("show-phone-text").checked ? view.screen : null;
    $("phone-overlay").hidden = !screen;
    $("phone-text").textContent = screen?.body || "";
    $("phone-text").title = screen?.body || "";
    const lastReply = [...(view?.messages || [])].reverse().find(m => m.direction === "out");
    $("phone-text-label").textContent = screen?.typing ? "HER PHONE / TYPING · NOT SENT YET" : view?.phase === "sent"
        ? lastReply?.status === "queued" ? "HER PHONE / QUEUED · NOT DELIVERED" : "HER PHONE / SENT" : "HER PHONE / READING";
    const key = JSON.stringify(visible);
    if (key !== chatKey) {
        chatKey = key;
        $("chat").replaceChildren(...visible.map(m => { const bubble = node("div", m.body, `bubble ${m.direction}`); bubble.append(node("small", m.direction === "out" ? `MARA · received ${sec(m.deliveredMs)}` : `YOU · ${m.status}${m.status === "read" ? ` at ${sec(m.readMs)}` : ""}`)); return bubble; }));
        if (!visible.length)
            $("chat").append(node("p", "Her phone is on the upstairs desk. What would you tell her?", "placeholder"));
        $("chat").scrollTop = $("chat").scrollHeight;
    }
    const thoughts = view?.thoughts ?? [];
    const tk = JSON.stringify(thoughts);
    if (tk !== thoughtKey) {
        thoughtKey = tk;
        $("thoughts").replaceChildren(...thoughts.slice(-8).map(t => { const li = node("li", undefined, t.kind === "thought_injected" ? "injected" : ""); li.append(node("small", `${sec(t.atMs)} / ${t.kind === "thought_injected" ? "INJECTED IMPULSE" : "MARA'S THOUGHT"}`), node("span", t.text)); return li; }));
        if (!thoughts.length) $("thoughts").append(node("li", "No thoughts in this scene yet.", "placeholder"));
        $("thoughts").scrollTop = $("thoughts").scrollHeight;
    }
    $("facts").replaceChildren(...(view ? [
        ["Mara", view.location, view.phase.replaceAll("_", " ")],
        ["Phone", view.mara.heldPhone ? "In her hand" : view.phone.location, `${view.phone.battery}% · ${view.phone.online ? "online" : "offline"}`],
        ["She knows", `${view.mara.readCount} read`, `${view.phone.unread} unread`],
        ["Basement", view.door, "Door state"],
    ] : [["Scene state", "Waiting for video", "Live state remains available in the inspector."]]).map(([label, value, detail]) => { const div = node("div", undefined, "fact"); div.append(node("small", label), node("strong", value), node("p", detail)); return div; }));
}
function update() {
    if (!state) return;
    const active = started && !stopping && state.running;
    for (const id of ["send", "inject", "battery", "network", "silent", "move", "stop"])
        $(id).disabled = !active;
    $("message").disabled = stopping;
    $("thought").disabled = stopping;
    $("start").hidden = started;
    $("text-start").hidden = started;
    $("stop").hidden = !started || stopping;
    $("mode").textContent = state.replay ? "SAVED RUN / REAL ECS" : state.fixture ? "DETERMINISTIC TEST POLICY" : "LIVE COGNITION / REAL ECS";
    if ($("runtime-status")) {
        const r = state.runtime;
        $("runtime-status").textContent = r ? `${stopping ? "Saved" : "Live"} Argos world · ${r.stats.agentCount} characters · ${r.stats.roomCount} rooms · ${r.stats.objectCount} objects · ${r.stats.activeGoals} active goals` : "Isolated phone fixture / older recording — not the full living-world runtime.";
        $("runtime-detail").textContent = r ? [
            `God autopilot: ${r.god?.enabled ? "enabled" : "disabled"} · ${r.god?.inbox || 0} reports in inbox`,
            `Narrative: ${r.narrative?.currentAct || "no scaffold"} · ${r.narrative?.tensions?.length || 0} tensions`,
            `Daemons: ${r.daemons.map(d => `${d.name} (${d.whispers} whispers)`).join(", ")}`,
            `Evolution: ${r.evolution.cycles} cycles · ${r.evolution.totals.entitiesCreated} entities created · ${r.evolution.totals.systemsCreated} systems created`,
            `Coding: ${r.coding?.jobs?.map(j => `${j.status}: ${j.systems?.join(", ") || j.id.slice(0, 8)}`).join("; ") || "no jobs yet"}`,
            `System health: ${r.health.filter(s => s.active).length} active · ${r.health.filter(s => s.lastError).length} reporting errors`,
            "This panel shows actual runtime state, not film-synchronized state.",
        ].join("\n") : "";
    }
    $("chat-mode").textContent = stopping ? "REPLAY" : "MESSAGES";
    $("chat-hint").textContent = stopping ? "Recorded conversation. Start a new live run to text her." : "Text her. Watch her choose to answer.";
    $("chat-clock-note").textContent = stopping ? "Replies and thoughts follow the recorded scene." : render ? "Your texts enter the world now. Replies follow the film." : "Live simulation · no video delay.";
    $("battery").textContent = state.phone.battery > 0 ? "Kill battery" : "Charge to 72%";
    $("network").textContent = state.phone.online ? "Disconnect network" : "Reconnect network";
    $("silent").textContent = state.phone.silent ? "Unsilence phone" : "Silence phone";
    $("live-clock").textContent = `${stopping ? "SAVED FINAL ECS" : "LIVE ECS"} / ${sec(state.elapsedMs)}${state.thinking ? " · THINKING" : ""} · ${stopping ? "not the scene's past state" : "may be ahead of film"}`;
    if (state.error) error(state.error);
    renderAudience();
    const next = new Map();
    for (const e of state.entities)
        for (const [name, fields] of Object.entries({ LocatedIn: { target: e.container }, ...e.components }))
            for (const [field, value] of Object.entries(fields)) {
                const k = `${e.id}.${name}.${field}`, v = JSON.stringify(value);
                next.set(k, v);
                if (previous.size && previous.get(k) !== v)
                    changed.set(k, performance.now() + 2200);
            }
    previous = next;
    for (const [key, until] of changed)
        if (until < performance.now())
            changed.delete(key);
    if ($("advanced").open)
        renderInspector();
    $("camera-status").textContent = `${state.camera.pending} queued shots. Current request v${state.camera.issued}. The camera follows committed source states, not current guesses. H3 framing and chunk alignment are best-effort.`;
    $("shots").replaceChildren(...state.camera.shots.map(s => node("li", `v${s.version} · ${sec(s.sourceMs)} · ${s.kind} · ${s.reason}`)));
    $("receipts").replaceChildren(...state.receipts.slice(-30).map(r => node("li", `${sec(r.atMs)} · ${r.kind} · ${r.text} [${r.perceived ? "perceived" : "not perceived"}]`)));
}
async function poll() {
    try {
        state = await request("/state");
        window.argosPhone.state = state;
        if (state.replay) { await loadSavedReplay(); return; }
        update();
        if (!started && !state.videoAvailable)
            $("start").disabled = true;
        if (started && render && !stopping)
            void sendProjection();
        if (started && !state.running && !stopping)
            void stop("server-deadline");
    }
    catch (e) {
        error(e);
    }
    if (!stopping)
        timer = setTimeout(poll, 750);
}
async function loadSavedReplay() {
    started = true; stopping = true; render = true; playbackStarted = true;
    update();
    $("connection").textContent = "Loading saved world…";
    const playback = await request("/replay");
    for (const chunk of playback.chunks) timeline.add({ chunk_index: chunk.index, playback_seconds: chunk.end - chunk.start, prompt_version: chunk.version });
    recordingStart = playback.recordingStart;
    recordingEnd = Number.isFinite(playback.recordingEnd) ? playback.recordingEnd : timeline.frontier()?.end ?? recordingStart;
    playbackZero = -recordingStart;
    const response = await fetch("/replay/video", { headers: { "x-argos-token": token } });
    if (!response.ok) throw new Error("Could not load saved video.");
    const blob = await response.blob(), link = $("download");
    link.href = URL.createObjectURL(blob);
    link.download = `argos-phone-raw.${blob.type.startsWith("video/mp4") ? "mp4" : "webm"}`;
    link.hidden = false;
    canvas.hidden = true; video.hidden = false; frameMediaTime = Number.NaN; framePlaybackOffset = Number.NaN;
    video.src = link.href; video.controls = true; video.autoplay = false; video.pause(); video.load();
    $("message").value = "";
    $("connection").textContent = "Saved world · replay";
    $("limit").textContent = "Read-only replay. No simulation or generation running.";
    $("chat-clock-note").textContent = "Replies and thoughts follow the recorded scene.";
    window.argosPhone.stopped = true;
    update();
}
function configureReplayJump() {
    if (!stopping || !Number.isFinite(video.duration)) return;
    const select = $("replay-jump");
    select.replaceChildren(node("option", "Choose a scene…"));
    select.options[0].value = "";
    for (const chunk of timeline.snapshot()) {
        if (chunk.start - recordingStart >= video.duration) break;
        const shot = state.camera.shots.find(s => s.version === chunk.version);
        if (!shot) continue;
        const option = node("option", `${sec(chunk.start * 1000)} · ${shot.phase.replaceAll("_", " ")} / ${shot.location}`);
        option.value = String(Math.max(0, chunk.start - recordingStart));
        select.append(option);
    }
    select.hidden = false; $("replay-jump-label").hidden = false;
}
video.addEventListener("loadedmetadata", configureReplayJump);
$("replay-jump").onchange = () => { if ($("replay-jump").value !== "") video.currentTime = Number($("replay-jump").value); };
async function sendProjection() {
    if (!session || stopping)
        return;
    if (projecting) { projectAgain = true; return; }
    projecting = true;
    try {
        const deliveryState = promptDelivery.due(performance.now());
        if (deliveryState === "awaiting-receipt" || deliveryState === "awaiting-settlement") return;
        if (deliveryState === "receipt-timeout" || deliveryState === "settlement-timeout") {
            const version = promptDelivery.snapshot().version;
            recordSync(deliveryState === "receipt-timeout" ? "prompt_receipt_timeout" : "prompt_settlement_timeout", {
                prompt_version: version, reason: deliveryState === "receipt-timeout"
                    ? "No pending, applied, rejected, or chunk receipt arrived within 15 seconds."
                    : "A received prompt never became applied, rejected, or represented by a chunk." });
            error(new Error(`Director stalled on prompt v${version}; stopping without reusing its strictly increasing version.`));
            void stop(deliveryState);
            return;
        }
        // Applied/rejected is transport flow-control only. Audience state starts
        // at chunk.prompt_version and can cross a projected cue only with later
        // committed milestone proof in presentationAtPlayback().
        const next = await request("/next", { settledVersion: promptFlow.snapshot().settled, renderHorizonMs });
        if (!stopping && next.prompt_version > promptFlow.snapshot().sent) {
            promptSources.set(next.prompt_version, next.sourceMs);
            promptCapturedWalls.set(next.prompt_version, next.sourceCapturedWallMs);
            const payload = { type: "prompt", prompt: next.prompt, prompt_version: next.prompt_version };
            try {
                // Commit sent state only after the synchronous transport accepts
                // it. The provider forbids same-version resends, so any throw is
                // terminal for this session rather than a guessed retry.
                sendPromptTransaction(promptFlow, next.prompt_version, () => session.send(payload));
                if (!promptDelivery.begin(next.prompt_version, performance.now()))
                    throw new Error("A previous prompt is still awaiting acknowledgement.");
            }
            catch (sendError) {
                promptSources.delete(next.prompt_version);
                promptCapturedWalls.delete(next.prompt_version);
                recordSync("prompt_send_failed", next);
                error(sendError);
                void stop("prompt-send-error");
                return;
            }
            window.argosPhone.promptFlow = promptFlow.snapshot();
            recordSync("prompt_sent", next);
        }
    }
    catch (e) {
        if (!stopping)
            error(e);
    }
    finally {
        projecting = false;
        if (projectAgain && !stopping) { projectAgain = false; void sendProjection(); }
    }
}
function beginRecording() {
    if (!render || recorder || stopping)
        return;
    if (!globalThis.MediaRecorder) {
        error(new Error("Recording unavailable in this browser; the simulation can still run."));
        return;
    }
    const mimeType = ["video/mp4;codecs=avc1.42001E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
        error(new Error("No supported recording format."));
        return;
    }
    const incoming = video.srcObject;
    if (!incoming?.getVideoTracks().some(track => track.readyState === "live")) return;
    // Clone track handles, not pixels: no compositing, cropping or resizing.
    // Stopping these owned handles must not stop playback's original tracks.
    recordedStream = new MediaStream(incoming.getTracks().map(track => track.clone()));
    recordingStart = playbackTime();
    recordingEnd = recordingStart;
    const data = [];
    recorder = new MediaRecorder(recordedStream, { mimeType, videoBitsPerSecond: 3500000 });
    recordingFinished = new Promise(resolve => { recorder.ondataavailable = e => { if (e.data.size)
        data.push(e.data); }; recorder.onstop = () => resolve(new Blob(data, { type: recorder.mimeType })); recorder.onerror = e => { error(e.error || new Error("Recording failed")); resolve(null); }; });
    recorder.start(1000);
    recordSync("recording_started");
    telemetry({ type: "recording_started", mimeType, source: "incoming-media-stream", width: video.videoWidth, height: video.videoHeight });
}
video.addEventListener("playing", () => { if (!playbackStarted) {
    playbackStarted = true;
    playbackZero = Number(video.currentTime) || 0;
    framePlaybackOffset = Number.isFinite(frameMediaTime) ? -frameMediaTime : Number.NaN;
    recordSync("playback_started");
    void request("/ready", {}).then(ready => {
        sourceEpochWallMs = ready.worldClockStartedWallMs;
        recordSync("world_clock_started", { sourceEpochWallMs });
        hardStop = setTimeout(() => stop("duration-limit"), sessionLimitMs);
    }).catch(e => { error(e); void stop("ready-error"); });
} try {
    beginRecording();
}
catch (e) {
    error(e);
} });
async function start(withVideo) {
    if (started)
        return;
    $("error").textContent = "";
    $("error").hidden = true;
    $("start").disabled = true;
    $("text-start").disabled = true;
    $("connection").textContent = "Preparing Mara’s first decision before the camera rolls…";
    try {
        transportBegan = performance.now(); transportBeganWallMs = Date.now(); syncTelemetry.length = 0;
        const initial = await request("/start", { render: withVideo });
        if (Number.isInteger(initial.renderHorizonMs) && initial.renderHorizonMs >= 1000 && initial.renderHorizonMs <= 15000) {
            renderHorizonMs = initial.renderHorizonMs;
            serverHorizonSupplied = true;
        }
        started = true;
        render = withVideo;
        canvas.hidden = withVideo;
        video.hidden = !withVideo;
        $("limit").textContent = `This run stops at ${initial.maxSessionMs / 1000}s.`;
        sessionLimitMs = initial.maxSessionMs;
        if (!withVideo) {
            hardStop = setTimeout(() => stop("duration-limit"), sessionLimitMs);
            $("connection").textContent = "Simulation only · no video-generation spend";
            return;
        }
        $("connection").textContent = "Connecting to H3 Director…";
        const fal = createFalClient({ proxyUrl: "/proxy", fetch: (url, init) => { const h = new Headers(init?.headers); h.set("x-argos-token", token); return fetch(url, { ...init, headers: h }); } });
        session = fal.realtime.open(wma("minimax/h3-max/director"), { receive: ["video", "audio"], negotiationTimeoutMs: 45000,
            onMedia(stream) { frameMediaTime = Number.NaN; framePlaybackOffset = Number.NaN; video.srcObject = stream; recordSync("media_received"); void video.play().catch(error); },
            onData(raw) {
                let message;
                try {
                    message = JSON.parse(raw);
                }
                catch {
                    return;
                }
                window.argosPhone.messages.push(message);
                telemetry(message);
                const providerReason = typeof message.reason === "string" ? message.reason
                    : typeof message.message === "string" ? message.message
                        : typeof message.error === "string" ? message.error : message.error?.message;
                const providerCode = message.code ?? message.error?.code;
                if (["session_info", "configured", "prompt_pending", "prompt_applied", "prompt_rejected", "chunk", "chunk_metrics", "deadline_missed", "stream_exhausted", "invalid_message", "error"].includes(message.type))
                    recordSync(`provider_${message.type}`, { ...message, reason: providerReason, code: providerCode });
                if (message.type === "session_info" && Number.isFinite(message.continuation_playback_seconds))
                    renderHorizonMs = renderHorizonFromChunk(renderHorizonMs, {
                        playback_seconds: message.continuation_playback_seconds,
                    });
                if (message.type === "configured") {
                    // Fal may explicitly report null. Number(null) is 0, which
                    // would create invalid persisted telemetry and hide that the
                    // negotiated duration is unknown.
                    const actual = typeof message.chunk_duration === "number"
                        ? message.chunk_duration : Number.NaN;
                    configureState = Number.isFinite(actual) ? "explicit-duration-accepted" : "unverified";
                    if (Number.isFinite(actual) && !serverHorizonSupplied)
                        renderHorizonMs = renderHorizonFromChunk(renderHorizonMs, { requested_duration_seconds: actual });
                    recordSync("chunk_duration_verified", { chunk_duration: actual,
                        reason: Number.isFinite(actual) ? `Provider configured ${actual}s chunks.` : "Provider did not report its configured chunk duration." });
                }
                if (configureState === "probing-explicit-duration" && isChunkDurationConfigureRejection(message)) {
                    configureState = "fallback-sent";
                    // The published session contract currently declares ten
                    // seconds as the omitted configure default. Chunk metadata
                    // below replaces this estimate with runtime truth.
                    if (!serverHorizonSupplied)
                        renderHorizonMs = renderHorizonFromChunk(renderHorizonMs, { requested_duration_seconds: 10 });
                    try {
                        session.send(fallbackConfigure);
                        recordSync("configure_fallback_sent", { ...fallbackConfigure,
                            reason: providerReason || "5s chunk request was rejected." });
                    }
                    catch (sendError) {
                        recordSync("configure_fallback_send_failed", { reason: String(sendError) });
                        error(sendError);
                        void stop("configure-fallback-send-error");
                    }
                    return;
                }
                const flowBefore = promptFlow.snapshot();
                if (message.type === "prompt_pending" && message.prompt_version === flowBefore.sent &&
                    message.prompt_version > flowBefore.settled) {
                    promptDelivery.markPending(message.prompt_version, performance.now());
                    window.argosPhone.promptDelivery = promptDelivery.snapshot();
                }
                if (message.type === "prompt_rejected" && message.prompt_version === flowBefore.sent &&
                    message.prompt_version > flowBefore.settled && promptFlow.settle(message)) {
                    promptDelivery.settle(message.prompt_version);
                    window.argosPhone.promptFlow = promptFlow.snapshot();
                    recordSync("prompt_rejection_terminal", { ...message, reason: providerReason || "Prompt rejected." });
                    error(new Error(providerReason || `Director rejected prompt v${message.prompt_version}; the run was stopped.`));
                    void stop("prompt-rejected");
                    return;
                }
                if (promptFlow.settle(message)) {
                    promptDelivery.settle(message.prompt_version);
                    window.argosPhone.promptFlow = promptFlow.snapshot();
                    void sendProjection();
                }
                if (message.type === "chunk" && message.prompt_version <= promptFlow.snapshot().sent && timeline.add(message)) {
                    renderHorizonMs = renderHorizonFromChunk(renderHorizonMs, message);
                    window.argosPhone.chunks = timeline.snapshot();
                    const frontier = timeline.frontier();
                    // Compatibility fallback for providers that omit applied/rejected.
                    // Only the gap-free frontier may release transport flow.
                    promptFlow.markAvailable(frontier);
                    if (frontier) {
                        promptDelivery.settle(frontier.version);
                    }
                    window.argosPhone.promptFlow = promptFlow.snapshot();
                    // With a frame clock, only observeFrame may assert display.
                    // The fallback is for browsers that expose no such clock.
                    if (!hasVideoFrameClock) recordDisplayedSegments();
                    void sendProjection();
                }
                if (message.type === "error" || message.type === "invalid_message") {
                    error(new Error(providerReason || "Director error"));
                    void stop("provider-error");
                }
                if (message.type === "stream_exhausted")
                    void stop("stream-exhausted");
            },
            onState(value) { if (!stopping)
                $("connection").textContent = `Director: ${value}`; },
            onError(e) { if (!stopping) {
                error(e);
                void stop("connection-error");
            } },
        });
        fallbackConfigure = { ...initial.configure };
        delete fallbackConfigure.chunk_duration;
        configureState = "probing-explicit-duration";
        promptSources.set(initial.configure.prompt_version, initial.sourceMs);
        promptCapturedWalls.set(initial.configure.prompt_version, initial.sourceCapturedWallMs);
        try {
            sendPromptTransaction(promptFlow, initial.configure.prompt_version, () => session.send(initial.configure));
            if (!promptDelivery.begin(initial.configure.prompt_version, performance.now()))
                throw new Error("Could not begin initial prompt delivery tracking.");
        }
        catch (sendError) {
            promptSources.delete(initial.configure.prompt_version);
            promptCapturedWalls.delete(initial.configure.prompt_version);
            throw sendError;
        }
        window.argosPhone.promptFlow = promptFlow.snapshot();
        recordSync("configure_sent", { ...initial.configure, sourceMs: initial.sourceMs,
            sourceCapturedWallMs: initial.sourceCapturedWallMs });
    }
    catch (e) {
        error(e);
        if (started)
            await stop("startup-error");
        else {
            $("start").disabled = false;
            $("text-start").disabled = false;
        }
    }
}
async function stop(reason = "manual") {
    if (stopping)
        return;
    stopping = true;
    clearTimeout(hardStop);
    clearTimeout(timer);
    if (playbackStarted) recordingEnd = Math.max(recordingStart, playbackTime());
    recordSync("stop_requested", { reason });
    update();
    try {
        session?.send({ type: "stop" });
    }
    catch { }
    if (recorder && recorder.state !== "inactive")
        recorder.stop();
    // Stop recording before closing media, preserving the final dataavailable event.
    const closed = session?.close();
    if (closed)
        void closed.catch(() => { });
    let blob = null, localRecording = false, serverRecording = false, worldSaved = false, playbackSaved = false;
    const persistenceErrors = [];
    const exposeLocalRecording = nextBlob => {
        if (!nextBlob?.size) return false;
        const link = $("download");
        link.href = URL.createObjectURL(nextBlob);
        link.download = `argos-phone-raw.${nextBlob.type.startsWith("video/mp4") ? "mp4" : "webm"}`;
        link.hidden = false;
        video.srcObject = null;
        // Recorded media starts at zero, unlike the live MediaStream clock.
        playbackZero = -recordingStart;
        frameMediaTime = Number.NaN; framePlaybackOffset = Number.NaN;
        video.src = link.href;
        video.controls = true;
        video.autoplay = false;
        video.pause();
        video.load();
        localRecording = true;
        return true;
    };
    // Salvage and expose the browser's raw recording before any server endpoint
    // can reject, time out, or disappear. The download remains usable even when
    // world/playback/upload persistence later fails.
    try {
        if (recordingFinished) {
            const timeoutMarker = Symbol("recording-timeout");
            let recordingTimer;
            const result = await Promise.race([recordingFinished, new Promise(resolve => {
                recordingTimer = setTimeout(() => resolve(timeoutMarker), RECORDING_FINALIZE_TIMEOUT_MS);
            })]);
            clearTimeout(recordingTimer);
            if (result === timeoutMarker) {
                persistenceErrors.push(new Error("Recording finalization is delayed; the download will appear if the browser finishes it."));
                // Do not block world/playback persistence forever. Still salvage
                // a late MediaRecorder result into a local download when it lands.
                void recordingFinished.then(lateBlob => {
                    if (exposeLocalRecording(lateBlob)) {
                        window.argosPhone.recordingDelayed = false;
                        $("connection").textContent = "Stopped · delayed raw recording ready to download";
                    }
                }).catch(error);
                window.argosPhone.recordingDelayed = true;
            }
            else {
                blob = result;
                exposeLocalRecording(blob);
            }
        }
    }
    catch (e) {
        persistenceErrors.push(e);
    }
    const bestEffortRequest = async (path, body, timeoutMs) => {
        try {
            return await request(path, body, { signal: AbortSignal.timeout(timeoutMs) });
        }
        catch (e) {
            persistenceErrors.push(e);
            return null;
        }
    };
    // These are deliberately independent. A failed world snapshot must not
    // suppress playback metadata or the raw-video upload (and vice versa).
    const stoppedState = await bestEffortRequest("/stop", {}, 15000);
    worldSaved = stoppedState !== null;
    const finalState = await bestEffortRequest("/state", undefined, 5000);
    if (finalState) {
        state = finalState;
        window.argosPhone.state = state;
    }
    playbackSaved = await bestEffortRequest("/playback", { chunks: timeline.snapshot(), recordingStart, recordingEnd,
        transportBeganWallMs, telemetry: syncTelemetry }, 15000) !== null;
    if (blob?.size) {
        try {
            const response = await fetch("/recording", { method: "POST", headers: { "x-argos-token": token,
                "Content-Type": blob.type.split(";")[0] }, body: blob, signal: AbortSignal.timeout(30000) });
            if (!response.ok)
                throw new Error(`Server recording save failed (${response.status}); use Download recording.`);
            window.argosPhone.recording = await response.json();
            serverRecording = true;
        }
        catch (e) {
            persistenceErrors.push(e);
        }
    }
    $("connection").textContent = serverRecording && worldSaved && playbackSaved ? "Stopped · recording and world saved"
        : localRecording ? "Stopped · raw recording ready to download; server persistence incomplete"
            : worldSaved && playbackSaved ? "Stopped · world saved, no video recording" : "Stopped · local run ended; server persistence incomplete";
    if (persistenceErrors.length)
        error(persistenceErrors[0]);
    try {
        for (const track of recordedStream?.getTracks() || [])
            track.stop();
        window.argosPhone.stopped = true;
        update();
        telemetry({ type: "local_stopped", reason });
    }
    catch (e) {
        error(e);
    }
}
$("start").onclick = () => start(true);
$("text-start").onclick = () => start(false);
$("stop").onclick = () => stop();
$("message-form").onsubmit = e => { e.preventDefault(); $("send").disabled = true; void request("/control", { action: "message", text: $("message").value }).then(next => { state = next; window.argosPhone.state = state; $("message").value = ""; }).catch(error).finally(update); };
$("thought-form").onsubmit = e => { e.preventDefault(); void request("/control", { action: "thought", text: $("thought").value }).then(() => { $("thought").value = ""; }).catch(error); };
const phone = edit => request("/control", { action: "phone", edit }).catch(error);
$("battery").onclick = () => phone({ battery: state.phone.battery > 0 ? 0 : 72 });
$("network").onclick = () => phone({ online: !state.phone.online });
$("silent").onclick = () => phone({ silent: !state.phone.silent });
$("move").onclick = () => phone({ location: $("phone-location").value });
$("filter").oninput = renderInspector;
$("advanced").ontoggle = () => { if ($("advanced").open)
    renderInspector(); };
$("sound").onclick = () => { video.muted = !video.muted; $("sound").textContent = video.muted ? "Sound off" : "Sound on"; };
$("show-phone-text").onchange = () => renderAudience();
$("drawer-toggle").onclick = () => {
    const closed = $("experience").classList.toggle("drawer-closed");
    $("drawer-toggle").setAttribute("aria-expanded", String(!closed));
    $("drawer-toggle").textContent = closed ? "Show chat ‹" : "Hide chat ›";
};
$("fullscreen").onclick = async () => {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if ($("experience").requestFullscreen) await $("experience").requestFullscreen();
        else throw new Error("Fullscreen isn't supported here. Hide chat to expand the video.");
    } catch (e) { error(e); }
};
document.addEventListener("fullscreenchange", () => $("fullscreen").setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen experience" : "Fullscreen experience"));
window.addEventListener("pagehide", () => { try {
    session?.send({ type: "stop" });
    session?.close();
}
catch { } void fetch("/stop", { method: "POST", headers, body: "{}", keepalive: true }).catch(() => { }); });
void poll();
