import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { SitcomPlayback, sitcomFrameAt, sitcomAudienceMessages, sitcomFactLines, sitcomContactLabel, sitcomMessageLabel, sitcomThoughtActor, sitcomThoughtAge } from "./sitcom-presentation.ts";
import { h3ChunkForPlayback, validateH3ChunkSeconds, confirmH3ChunkSeconds, isH3SetupAcknowledgement, sitcomPromptMessage } from "./sitcom-h3-chunk.ts";
import { confirmDirectorResolution, validateDirectorResolution } from "../rendering/director-projection.ts";
import { installH3PromptInspector } from "./sitcom-prompt-inspector.mjs";

const $ = id => document.getElementById(id), video = $("source"), canvas = $("composition"), ctx = canvas.getContext("2d");
$("drawer").append($("influence-section"));
// The local capability stays in the fragment (never sent as a URL to a server),
// so refreshing this same private receiver can reopen its saved recording.
const token = location.hash.slice(1);
const headers = { "x-argos-token": token, "Content-Type": "application/json" };
$("home").href = `/${location.hash}`;
let accessBlocked = false;
let resetting = false;
class SessionAccessError extends Error {
  constructor() { super("Session access required. Reopen the full private demo link, including the # access token, from SITCOM_DEMO_READY in the server output. A link from another server or session will not work."); }
}
const timeline = new SitcomPlayback(), names = ["Jerry", "George", "Elaine", "Kramer"];
let state, session, started = false, starting = false, render = false, stopping = false, firstFrame = false, ended = false;
let frameTime = NaN, frameOffset = NaN, playbackZero = 0, recordingStart = 0, recordingEnd = 0;
let hardStop, polling, leaseTimer, projecting = false, sentVersion = 0, settledVersion = 0, sentAt = 0;
let scriptQueue = false, admittedVersion = 0, sourceExhausted = false;
let drainEnd, drainTimer, drainLastChunkIndex, unfilmedTail;
let requestedChunkSeconds, chunkDurationConfirmed = false, setupConfirmed = false;
let receivedDimensions = "";
const pendingSent = new Map();
let scene, sourceMs = 0, mapped, lastAudience = "", lastChat = "", rawCapture, shareCapture, replaying = false, replayLoaded = false;
let frameCursor = 0, audienceFrames = [], requestedSeconds = 600, sessionBudgetSeconds = 600, budgetStartedAt = 0;
let rawUpload, shareUpload;
let durationInitialized = false, durationEdited = false;
let presentationCursor = 0, reportingPresentation = false;
let telemetryZero = performance.now();
let contactDirty = false, contactSaving = false, contactInitialized = false, contactRevision = 0;
let appliedContact = { name: "Unknown sender", relationship: "unknown", context: "" };
const relationshipPresets = ["unknown", "friend", "boyfriend", "girlfriend", "partner", "boss", "family", "police"];
const telemetry = [];
window.argosSitcom = { state: undefined, messages: [], chunks: [], status: "ready", stopped: false };
function note(type, extras = {}) { if (telemetry.length < 4096) telemetry.push({ type, atMs: performance.now() - telemetryZero, ...extras }); }
function error(value) { $("error").hidden = false; $("error").textContent = String(value?.message ?? value); note("client_error"); }
async function request(path, body, timeout = 15000) {
  if (!token) throw new SessionAccessError();
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  if (path.startsWith("/state?") && [401, 403].includes(response.status)) throw new SessionAccessError();
  if (!response.ok) { const detail = await response.text(); throw new Error(`${path}: ${response.status} ${detail.slice(0, 220)}`); }
  return response.status === 204 ? null : response.json();
}
function node(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
const promptInspector = installH3PromptInspector(request);
function selectedSeconds() {
  const seconds = Number($("duration").value), limits = state?.durationLimits ?? { min: 10, max: 1800, default: 600 };
  return Number.isFinite(seconds) && seconds >= limits.min && seconds <= limits.max ? seconds : limits.default;
}
function initializeDuration() {
  if (durationInitialized || !state?.durationLimits) return;
  durationInitialized = true;
  if (durationEdited) return;
  const { min, max, default: seconds } = state.durationLimits;
  if (!Number.isFinite(seconds) || seconds < min || seconds > max) return;
  if (![120, 300, 600, 1200, 1800].includes(seconds)) {
    const option = node("option", seconds % 60 === 0 ? `${seconds / 60} min (configured)` : `${seconds} sec (configured)`);
    option.value = String(seconds); $("duration").append(option);
  }
  $("duration").value = String(seconds);
}
function applyBudget(seconds) {
  if (Number.isFinite(seconds) && seconds > 0) sessionBudgetSeconds = Math.min(sessionBudgetSeconds, seconds);
  if (state) { state.maxSessionSeconds = sessionBudgetSeconds; window.argosSitcom.state = state; }
  if ((firstFrame || (started && !render)) && !stopping) {
    clearTimeout(hardStop);
    const remaining = sessionBudgetSeconds * 1000 - (performance.now() - budgetStartedAt);
    hardStop = setTimeout(() => stop("session-duration-limit"), Math.max(0, remaining));
  }
  controls();
}
function startLease() {
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(heartbeat, 10000);
}
async function heartbeat() {
  if (stopping || (!started && !starting)) return;
  try { await request("/heartbeat", {}, 8000); }
  catch (e) { error(new Error(`Viewer connection lost; stopping the session. ${e.message}`)); void stop("viewer-lease-failure"); return; }
  if (!stopping) leaseTimer = setTimeout(heartbeat, 10000);
}
function contactDraft() {
  return { name: $("contact-name").value.trim(), relationship: ($("contact-relationship").value === "custom" ? $("contact-custom").value : $("contact-relationship").value).trim(), context: $("contact-context").value.trim() };
}
function validContact(contact) { return contact.name.length > 0 && contact.name.length <= 60 && contact.relationship.length > 0 && contact.relationship.length <= 40 && contact.context.length <= 300; }
function contactFields(contact) {
  $("contact-name").value = contact.name;
  const preset = relationshipPresets.includes(contact.relationship);
  $("contact-relationship").value = preset ? contact.relationship : "custom";
  $("contact-custom").value = preset ? "" : contact.relationship;
  $("contact-context").value = contact.context ?? "";
  $("contact-custom-field").hidden = preset;
}
function updateContact() {
  const current = state?.latest?.contact ?? { name: "Unknown sender", relationship: "unknown", context: "" };
  const changed = JSON.stringify(current) !== JSON.stringify(appliedContact);
  appliedContact = current;
  if (!contactSaving && !contactDirty && (!contactInitialized || changed)) { contactFields(current); contactInitialized = true; }
  $("contact-current").textContent = sitcomContactLabel(appliedContact);
  $("send").title = `Send as ${sitcomContactLabel(appliedContact)}`;
}
function editContact() {
  contactDirty = true; $("contact-custom-field").hidden = $("contact-relationship").value !== "custom";
  $("contact-status").textContent = `Unapplied changes · texts still use ${sitcomContactLabel(appliedContact)}.`;
  $("contact-status").setAttribute("data-pending", "true"); controls();
}
function playbackTime() {
  if (replaying) return Math.max(0, video.currentTime + recordingStart);
  if (Number.isFinite(frameTime) && Number.isFinite(frameOffset)) return Math.max(0, frameTime + frameOffset);
  return Math.max(0, video.currentTime - playbackZero);
}
function chunksForSave() {
  const saved = []; let start = 0;
  for (const chunk of timeline.snapshot()) {
    if (chunk.chunk_index !== saved.length) break;
    const end = start + chunk.playback_seconds;
    saved.push({ index: chunk.chunk_index, start, end, version: chunk.prompt_version }); start = end;
  }
  return saved;
}
function register(segment) {
  if (!segment || !timeline.register(segment)) throw new Error("Invalid or conflicting committed source segment.");
}
function observeFrame(_now, metadata) {
  frameTime = metadata.mediaTime;
  const dimensions = `${video.videoWidth}x${video.videoHeight}`;
  if (render && video.videoWidth && video.videoHeight && dimensions !== receivedDimensions) {
    receivedDimensions = dimensions;
    note("received_dimensions", { width: video.videoWidth, height: video.videoHeight });
  }
  if (!Number.isFinite(frameOffset) && firstFrame) frameOffset = (video.currentTime - playbackZero) - frameTime;
  video.requestVideoFrameCallback(observeFrame);
}
if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(observeFrame);

function updateAudience() {
  if (!state) return;
  if (render) {
    mapped = timeline.at(playbackTime());
    if (mapped.state === "mapped" || mapped.state === "held") {
      sourceMs = mapped.sourceMs;
      scene = sitcomFrameAt(state.frames ?? [], sourceMs);
    }
    // A metadata underrun holds the last honest audience view, never live state.
    const behind = Math.max(0, ((state.latest?.atSimMs ?? 0) - sourceMs) / 1000);
    $("timing").textContent = (mapped.state === "mapped" ? `Planned scene timing · ${mapped.sourceRate.toFixed(2)}× · H3 acting may differ`
      : mapped.state === "held" ? mapped.reason === "performance_ending_hold" ? "Scene complete · holding its final state" : "Video reused a prompt · thoughts held with that scene"
        : mapped.reason === "provider_chunk_shorter_than_performance" ? "Video too short for issued scene · alignment unavailable"
          : "Buffering video alignment · last known thoughts held")
      + ` · simulation ${behind.toFixed(0)}s ahead`;
    if (state.pacing?.sourcePausedForVideo) $("timing").textContent += " · world paced to its video buffer";
  } else { scene = state.latest; sourceMs = scene?.atSimMs ?? 0; $("timing").textContent = "Live simulation · authored thoughts, not planted instructions"; }
  $("clock").textContent = `SOURCE ${(sourceMs / 1000).toFixed(1)}s`;
  const engine = state.engine;
  if (engine) {
    const growth = engine.evolution, runtime = engine.runtime;
    $("engine-status").replaceChildren(...[
      `${engine.model ?? "Offline physics"} · ${engine.controller} controller · narrative mind ${engine.narrativeMind ? "on" : "off"} · appraisal reconsideration ${engine.experienceReconsideration ? "on" : "off"}`,
      `Configured: ${engine.services.filter(s => s.enabled).map(s => s.id.replace("npc-", "")).join(", ")}`,
      `Character history: ${engine.cookieHistory} · neighborhood ${engine.openNeighborhood ? "open" : "closed"}`,
      growth.enabled ? `World growth enabled · God reviews proposals · ${growth.totals.proposalsExecuted} built · ${growth.totals.proposalFailures} failed · ${growth.running ? "working" : "idle"}` : "World growth disabled",
      runtime ? `Runtime ${runtime.lifecycle} · health ${runtime.health} · ${runtime.pendingTasks} pending · ${runtime.slowTicks} slow ticks` : "World ready · no simulation running yet",
      ...(engine.managedBuilds?.admissionBudget?.limit === 0 ? ["New coding jobs disabled for this interactive session"] : []),
      ...(engine.roomOverviewError ? [`Room overview unavailable: ${engine.roomOverviewError}`] : []),
      ...(engine.rooms ?? []).map(room => `${room.name}: ${room.actors.join(", ") || "no characters"} · ${room.props.join(", ") || "no visible props"}`),
    ].map(line => node("p", line)));
  }
  const selected = $("actor").value;
  const signature = JSON.stringify([scene?.actors, selected, scene?.facts, Math.floor(sourceMs / 1000)]);
  if (signature !== lastAudience) {
    lastAudience = signature; const cards = $("thoughts"); cards.replaceChildren();
    for (const name of state.latest?.scenario?.characters ?? names) {
      const actor = scene?.actors.find(a => a.name === name), thought = actor?.latestThought;
      const card = node("article", "", `thought-card${name === selected ? " focused" : ""}`);
      card.append(node("div", name.toUpperCase(), "name"), node("div", actor ? `${actor.room}${actor.speaking ? " · speaking" : ""}` : "Waiting for the scene", "meta"),
        node("p", thought ? `“${thought.text}”` : "No authored thought yet."), node("div", sitcomThoughtAge(thought, sourceMs), "meta"));
      const prior = new Map();
      for (const frame of audienceFrames) {
        if (frame.atSimMs > sourceMs) continue;
        const item = frame.actors.find(a=>a.name===name)?.latestThought;
        if (item && item.atSimMs <= sourceMs && item.sequence !== thought?.sequence) prior.set(item.sequence,item);
      }
      const history=node("div","","thought-history");
      for(const item of [...prior.values()].sort((a,b)=>b.atSimMs-a.atSimMs).slice(0,2))
        history.append(node("p",`${(item.atSimMs/1000).toFixed(0)}s · ${item.text}`));
      card.append(history);
      cards.append(card);
    }
    $("thoughts").style.gridTemplateColumns = `repeat(${Math.min(4,state.latest?.scenario?.characters?.length ?? 4)},minmax(0,1fr))`;
    const facts = scene?.scenario?.kind === "project89" ? [`Card · ${scene.facts.cookieContainer}`,`Couch drawer · ${scene.facts.tin}`,`Phone · ${scene.facts.phoneContainer}`,`Unread · ${scene.facts.unread}`] : sitcomFactLines(scene);
    $("facts").replaceChildren(...facts.map(line => node("span", line)));
  }
  const messages = sitcomAudienceMessages(state.latest, scene), chatSignature = JSON.stringify(messages);
  if (chatSignature !== lastChat) {
    lastChat = chatSignature; const chat = $("chat"), atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 70;
    chat.replaceChildren();
    for (const message of messages) {
      const reply = message.direction === "out", pending = !reply && !["delivered", "read"].includes(message.status);
      const bubble = node("div", "", `bubble${reply ? " reply" : ""}${pending ? " pending" : ""}`);
      bubble.append(node("div", sitcomMessageLabel(message,state.latest?.scenario?.phoneOwner ?? "Elaine"), "label"), node("div", message.text), node("small", `${pending ? "SENT · ARRIVING IN SCENE" : message.status.toUpperCase()} · SOURCE ${(message.createdMs / 1000).toFixed(1)}s`)); chat.append(bubble);
    }
    if (!messages.length) chat.append(node("p", `${state.latest?.scenario?.phoneOwner ?? "Elaine"}’s phone is on the kitchen counter. What would you say?`, "empty"));
    if (atBottom) chat.scrollTop = chat.scrollHeight;
  }
  window.argosSitcom.presentation = { sourceMs, mapping: mapped, scene };
  $("influence-results").replaceChildren(...(state.influences??[]).map(r=>node("p",`${r.recipient} · ${String(r.status??"queued").toUpperCase()}${r.proposalName ? ` · ${r.proposalName}` : ""}${r.atSimMs>sourceMs ? " · ahead of scene" : ""}: ${r.text}`)));
}
function controls() {
  const active = started && !stopping && !accessBlocked && !state?.stopped && state?.latest?.running !== false;
  const contactLocked = !state || accessBlocked || stopping || state.stopped || starting || contactSaving;
  const limitSeconds = started ? sessionBudgetSeconds : selectedSeconds();
  const limitLabel = limitSeconds % 60 === 0 ? `${limitSeconds / 60}-minute` : `${limitSeconds}-second`;
  $("session-limit").textContent = `${limitLabel} session${started && limitSeconds < requestedSeconds ? " · provider-limited" : ""} · ${started && !render ? "saves world · no video requested" : "saves video and world"}`;
  $("duration").disabled = started || starting || !state || stopping || accessBlocked;
  $("start").hidden = started; $("text-start").hidden = started;
  $("stop").hidden = !started; $("stop").disabled = stopping;
  $("reset").hidden = state?.resetAvailable !== true;
  $("reset").disabled = accessBlocked || resetting || !state?.stopped || window.argosSitcom.status === "saving";
  $("reset").textContent = resetting ? "Preparing new episode…" : "New episode ↻";
  $("send").disabled = !active || contactSaving; $("inject").disabled = !active;
  $("influence-send").disabled = !active || !state?.engine?.evolution?.enabled || (state?.influences?.length??0)>=8;
  $("contact-save").disabled = contactLocked || !contactDirty || !validContact(contactDraft());
  for (const id of ["contact-name", "contact-relationship", "contact-custom", "contact-context"]) $(id).disabled = contactLocked;
  $("mode").textContent = stopping ? "SAVED / REPLAY" : started ? (render ? "ARGOS × H3" : "LIVE COGNITION") : "READY";
  if (!started) { $("start").disabled = accessBlocked || starting || contactSaving || state?.videoAvailable !== true; $("text-start").disabled = accessBlocked || !state || starting || contactSaving; }
  if (accessBlocked) { $("mode").textContent = "ACCESS REQUIRED"; $("connection").textContent = "Open this session’s full private link to connect."; }
}
function recordingDownload(recording, kind) {
  if (!recording?.url || !recording.bytes) return;
  // Same-origin, server-issued capability URLs allow native seeking without
  // downloading an entire extended session into a JavaScript Blob first.
  if (!recording.url.startsWith("/") || recording.url.startsWith("//")) throw new Error("Invalid recording URL.");
  const link = $(`download-${kind}`); link.href = recording.url;
  link.textContent = `${recording.complete === false ? "Partial " : ""}${kind === "raw" ? "Raw video" : "Video + thoughts + phone"} ↓`;
  link.download = `argos-sitcom-${kind}.${recording.mimeType?.startsWith("video/mp4") ? "mp4" : "webm"}`; link.hidden = false;
  if (kind === "raw") { replaying = true; video.srcObject = null; video.src = recording.url; video.controls = true; video.autoplay = false; video.pause(); video.load(); }
}
async function loadReplay() {
  replayLoaded = true; started = true; stopping = true; render = state.render === true;
  requestedSeconds = state.maxSessionSeconds ?? 600; sessionBudgetSeconds = requestedSeconds; controls();
  if (!render) { $("connection").textContent = "Saved simulation · no video was requested"; return; }
  try {
    const saved = await request("/replay"); recordingStart = saved.recordingStart; recordingEnd = saved.recordingEnd;
    for (const chunk of saved.chunks) timeline.add({ chunk_index: chunk.index, playback_seconds: chunk.end - chunk.start, prompt_version: chunk.version });
    const recordings = state.recordings ?? await request("/recordings/status");
    if (!recordings.raw?.url) throw new Error("The saved raw video is not available yet. Reopen this page after recording finishes.");
    render = true; scene = undefined; sourceMs = 0; video.hidden = false; $("standby").hidden = true;
    recordingDownload(recordings.raw, "raw"); $("connection").textContent = "Saved episode · play to follow the source-aligned thoughts";
    // Composition is optional; its absence must not block the raw replay.
    recordingDownload(recordings.composition, "composition");
    window.argosSitcom.status = "replay"; window.argosSitcom.stopped = true;
  } catch (e) { error(e); }
}
async function readState(timeout = 10000) {
  let page;
  do {
    const requestedCursor = frameCursor;
    page = await request(`/state?afterFrame=${requestedCursor}&limit=200`, undefined, timeout);
    if (!Number.isInteger(page.cursor) || !Array.isArray(page.frames) || page.cursor !== requestedCursor + page.frames.length) throw new Error("Invalid audience history cursor.");
    if (page.cursor > frameCursor) {
      const appended = page.frames.slice(Math.max(0, frameCursor - requestedCursor));
      if (audienceFrames.length + appended.length > 30000) throw new Error("Audience history reached its 30,000-frame safety bound; stopping without discarding earlier source alignment.");
      audienceFrames.push(...appended); frameCursor = page.cursor;
    } else if (page.hasMore) throw new Error("Audience history stopped advancing.");
  } while (page.hasMore);
  return { ...page, frames: audienceFrames };
}
async function poll() {
  if (accessBlocked) return;
  try {
    const requestedContactRevision = contactRevision;
    state = await readState();
    // A state request begun before a successful save cannot undo its editor label.
    if (contactRevision !== requestedContactRevision && state?.latest) state = { ...state, latest: { ...state.latest, contact: appliedContact } };
    window.argosSitcom.state = state;
    initializeDuration();
    if (started && !stopping) applyBudget(state.maxSessionSeconds);
    for (const segment of state.segments ?? []) register(segment);
    if (state.replay && !started && !replayLoaded) await loadReplay();
    updateContact(); updateAudience(); controls();
    void promptInspector.refresh();
    if (started && !stopping && render && firstFrame) void reportPresentation();
    if (started && !stopping && render) void sendNext();
    if (started && !stopping && state.stopped) void stop("server-stopped");
  } catch (e) {
    if (e instanceof SessionAccessError) { accessBlocked = true; controls(); }
    if (!stopping) { error(e); if (started) void stop("audience-history-failure"); }
  }
  if (!stopping && !accessBlocked) polling = setTimeout(poll, 500);
}
async function reportPresentation() {
  if (reportingPresentation || stopping || !firstFrame || replaying) return;
  reportingPresentation = true;
  try {
    const receipt = await request("/presentation", { playbackSeconds: playbackTime(),
      chunks: timeline.snapshot().filter(chunk => chunk.chunk_index >= presentationCursor
        && (drainLastChunkIndex === undefined || chunk.chunk_index <= drainLastChunkIndex)).slice(0, 32) });
    if (Number.isInteger(receipt?.receiptCursor)) presentationCursor = Math.max(presentationCursor, receipt.receiptCursor);
    if (state) state.pacing = receipt;
    if (receipt?.failure) throw new Error(`Video cannot cover its issued performance: ${receipt.failure.reason}. Saving without claiming missing words or actions were shown.`);
  } catch (e) { if (!stopping) { error(e); void stop("presentation-receipt-failure"); } }
  finally { reportingPresentation = false; }
}
async function sendNext() {
  if (!session || projecting || stopping || ended || !started || !setupConfirmed) return;
  // Admission may queue a successor only in append mode. It never settles an
  // interval or advances the audience clock. Bound both queue depth and age.
  if (sentVersion > settledVersion && performance.now() - (pendingSent.values().next().value ?? sentAt) > 45000) {
    error(new Error("No chunk represented the pending prompt within 45 seconds.")); void stop("prompt-chunk-timeout"); return;
  }
  if (sourceExhausted) {
    if (settledVersion >= sentVersion) beginDrain("source_ended");
    return;
  }
  if (scriptQueue ? sentVersion > admittedVersion || sentVersion - settledVersion >= 2 : sentVersion > settledVersion) return;
  projecting = true;
  const targetSession = session;
  try {
    const next = await request("/next", { settledVersion, ...(scriptQueue ? { admittedVersion } : {}) });
    if (stopping || ended || session !== targetSession) return;
    if (next.ended) {
      if (next.reason) {
        ended = true;
        note("renderer_source_failed", { reason: `${next.reason}${next.detail ? `: ${next.detail}` : ""}`.slice(0, 300) });
        error(new Error(`Renderer stopped: ${next.reason}${next.detail ? ` — ${next.detail}` : ""}. Stopping video and saving the world; the last prompt will not keep running.`));
        void stop("renderer-source-failure"); return;
      }
      if (next.unfilmedTail) {
        const tail = next.unfilmedTail;
        if (tail.reason !== "incomplete_realtime_tail" || !Number.isFinite(tail.sourceStartSimMs)
          || !Number.isFinite(tail.sourceEndSimMs) || tail.sourceEndSimMs <= tail.sourceStartSimMs)
          throw new Error("Invalid unfilmed source remainder");
        unfilmedTail = tail;
        note("source_tail_unfilmed", { reason: tail.reason, sourceMs: tail.sourceStartSimMs,
          unfilmedEndMs: tail.sourceEndSimMs });
      }
      sourceExhausted = true;
      if (settledVersion >= sentVersion) beginDrain("source_ended");
      return;
    }
    if (!next.segment || next.buffering) return;
    register(next.segment);
    if (next.segment.version <= sentVersion) return;
    const outgoing = sitcomPromptMessage(next.segment, scriptQueue);
    targetSession.send(outgoing);
    promptInspector.capture(outgoing, next.segment);
    sentVersion = next.segment.version; sentAt = performance.now();
    pendingSent.set(sentVersion, sentAt);
    note("prompt_sent", { version: sentVersion, sourceMs: next.segment.sourceStartSimMs, promptCharacters: next.segment.prompt.length });
  } catch (e) { error(e); void stop("prompt-send-failure"); }
  finally { projecting = false; }
}

function wrap(text, x, y, maxWidth, lineHeight, maxLines, color = "#f1f0df") {
  ctx.fillStyle = color; const words = String(text).split(/\s+/); let line = "", count = 0;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(count === maxLines - 1 ? `${line.slice(0, -1)}…` : line, x, y); y += lineHeight; count++;
      if (count >= maxLines) return y; line = words[i];
    } else line = next;
  }
  if (line && count < maxLines) { ctx.fillText(line, x, y); y += lineHeight; } return y;
}
function composition() {
  ctx.fillStyle = "#0c120f"; ctx.fillRect(0, 0, 1280, 720);
  ctx.font = "bold 16px system-ui"; ctx.fillStyle = "#d5e68d"; ctx.fillText("ARGOS / LIVING WORLDS", 24, 30);
  ctx.font = "12px system-ui"; ctx.fillStyle = "#a3b3a5"; ctx.fillText(`${(state?.latest?.scenario?.title ?? "The Last Cookie").toUpperCase()}  ·  AUTONOMOUS NPCs  ·  AI-RENDERED VIDEO`, 310, 30);
  ctx.fillStyle = "#030604"; ctx.fillRect(16, 46, 922, 468);
  if (video.readyState >= 2 && video.videoWidth) {
    const scale = Math.min(922 / video.videoWidth, 468 / video.videoHeight), w = video.videoWidth * scale, h = video.videoHeight * scale;
    ctx.drawImage(video, 16 + (922 - w) / 2, 46 + (468 - h) / 2, w, h);
  }
  const actor = sitcomThoughtActor(scene, $("actor").value), thought = actor?.latestThought;
  ctx.fillStyle = "#17261a"; ctx.fillRect(16, 526, 922, 136);
  ctx.font = "bold 14px system-ui"; ctx.fillStyle = "#d5e68d"; ctx.fillText(`${actor?.name.toUpperCase() ?? "ELAINE"} / LAST ARTICULATED THOUGHT`, 34, 551);
  ctx.font = "12px system-ui"; ctx.fillStyle = "#a3b3a5"; ctx.fillText(thought ? `SOURCE ${(thought.atSimMs / 1000).toFixed(1)}s` : "WAITING FOR A THOUGHT", 755, 551);
  ctx.font = "22px system-ui"; wrap(thought ? `“${thought.text}”` : "No authored thought yet.", 34, 582, 874, 28, 3);
  ctx.font = "11px system-ui"; wrap(sitcomFactLines(scene).join("    /    "), 24, 684, 910, 15, 2, "#a3b3a5");
  ctx.fillStyle = "#152019"; ctx.fillRect(952, 46, 312, 652); ctx.font = "bold 17px system-ui"; ctx.fillStyle = "#f1f0df"; ctx.fillText(`${state?.latest?.scenario?.phoneOwner ?? "Elaine"}’s phone`, 972, 78);
  ctx.font = "11px system-ui"; ctx.fillStyle = "#a3b3a5"; ctx.fillText("TWO WORLDS · ONE CONVERSATION", 972, 100);
  const messages = sitcomAudienceMessages(state?.latest, scene).slice(-4); let y = 128;
  for (const m of messages) {
    const pending = m.direction === "in" && !["delivered", "read"].includes(m.status);
    ctx.globalAlpha = pending ? .55 : 1;
    ctx.fillStyle = pending ? "#141d17" : m.direction === "out" ? "#243629" : "#33462c"; ctx.fillRect(966, y, 282, 124);
    ctx.font = "bold 10px system-ui"; wrap(sitcomMessageLabel(m,state?.latest?.scenario?.phoneOwner ?? "Elaine"), 978, y + 17, 256, 12, 2, "#d5e68d");
    ctx.font = "14px system-ui"; wrap(m.text, 978, y + 43, 256, 18, 3);
    ctx.font = "10px system-ui"; ctx.fillStyle = "#a3b3a5"; ctx.fillText(pending ? "SENT · ARRIVING IN SCENE" : m.status.toUpperCase(), 978, y + 110); y += 132;
    ctx.globalAlpha = 1;
  }
  if (!messages.length) { ctx.font = "16px system-ui"; wrap("A real phone in a simulated world. Text her, and watch her choose.", 972, 155, 260, 24, 4, "#a3b3a5"); }
  ctx.font = "10px system-ui"; ctx.fillStyle = "#a3b3a5"; ctx.fillText(`PLANNED SOURCE ${(sourceMs / 1000).toFixed(1)}s · ACTING UNVERIFIED`, 957, 714);
}
function beginDrain(reason) {
  if (ended || stopping) return;
  ended = true;
  const finalChunk = chunksForSave().at(-1);
  drainEnd = finalChunk?.end; drainLastChunkIndex = finalChunk?.index;
  // Late unsolicited repeats remain in telemetry/saved receipts, but are not
  // admitted as new performances while draining this frozen playback frontier.
  note(reason);
  // A chunk receipt precedes playback. Closing WebRTC here discards its tail.
  // Freeze the target so unsolicited repeats cannot extend the drain forever.
  const remainingMs = Math.max(0, (drainEnd ?? playbackTime()) - playbackTime()) * 1000;
  drainTimer = setTimeout(() => {
    error(new Error("Final video did not finish playing within the bounded drain; saving partial coverage."));
    void stop("final-playback-timeout");
  }, Math.min(45000, remainingMs + 5000));
}
function animate() {
  updateAudience(); composition();
  if (ended && !stopping) {
    if (drainEnd !== undefined && playbackTime() >= drainEnd - 0.06)
      void stop(sourceExhausted && settledVersion >= sentVersion ? "committed-source-drained" : "provider-stream-drained");
  }
  requestAnimationFrame(animate);
}
function recordingMime() {
  if (!globalThis.MediaRecorder) throw new Error("This browser cannot record the stream.");
  const mimeType = ['video/mp4;codecs="avc1.424028,mp4a.40.2"', "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser has no supported video recording codec.");
  return mimeType;
}
async function prepareUpload(kind, mimeType) {
  const prepared = await request(`/recordings/${kind}/start`, { mimeType: mimeType.split(";")[0] });
  if (prepared.nextIndex !== 0 || prepared.bytes !== 0) throw new Error("Recording already contains media; refusing to append a new session.");
  return { kind, mimeType, index: 0, bytes: 0, pendingBytes: 0, chain: Promise.resolve(), failure: null };
}
function failCapture(upload, failure) {
  if (!upload.failure) upload.failure = failure;
  error(new Error(`${upload.kind} recording interrupted: ${failure.message}. Uploaded media remains on disk; stopping the paid session.`));
  void stop("recording-upload-failure");
}
function enqueueCapture(upload, blob) {
  if (!blob?.size || upload.failure) return;
  if (blob.size > 8 * 1024 * 1024 || upload.pendingBytes + blob.size > 32 * 1024 * 1024) {
    failCapture(upload, new Error("The bounded recording upload queue is full")); return;
  }
  const index = upload.index++;
  upload.pendingBytes += blob.size;
  const send = async () => {
    // A duplicate uses the same index and identical bytes. The server verifies
    // its digest, so an uncertain network response cannot duplicate video data.
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (upload.failure) return;
      try {
        const response = await fetch(`/recordings/${upload.kind}/chunks/${index}`, { method: "POST", headers: { "x-argos-token": token, "Content-Type": "application/octet-stream" }, body: blob, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Chunk ${index} save failed (${response.status})`);
        const saved = await response.json();
        if (saved.nextIndex !== index + 1) throw new Error(`Chunk ${index} acknowledgement is out of sequence`);
        upload.bytes += blob.size; return;
      } catch (e) { lastError = e; }
    }
    throw lastError;
  };
  upload.chain = upload.chain.then(send).catch(e => failCapture(upload, e)).finally(() => { upload.pendingBytes -= blob.size; });
}
function capture(stream, bitrate, upload) {
  const recorder = new MediaRecorder(stream, { mimeType: upload.mimeType, videoBitsPerSecond: bitrate });
  let resolve;
  const finished = new Promise(a => { resolve = a; });
  recorder.ondataavailable = e => enqueueCapture(upload, e.data);
  recorder.onstop = () => resolve();
  recorder.onerror = e => { failCapture(upload, e.error ?? new Error("Recording failed")); resolve(); };
  recorder.start(1000); return { recorder, stream, finished, upload };
}
function beginRecording() {
  if (rawCapture || !render || !video.srcObject) return;
  recordingStart = playbackTime();
  const raw = new MediaStream(video.srcObject.getTracks().filter(t => t.readyState === "live").map(t => t.clone()));
  try { rawCapture = capture(raw, 3500000, rawUpload); }
  catch (e) { for (const track of raw.getTracks()) track.stop(); throw e; }
  let composed;
  try {
    composed = canvas.captureStream(24);
    for (const track of video.srcObject.getAudioTracks()) composed.addTrack(track.clone());
    shareCapture = capture(composed, 4500000, shareUpload);
  } catch (e) { for (const track of composed?.getTracks() ?? []) track.stop(); error(new Error(`UI composition unavailable: ${e.message}`)); void stop("composition-start-failure"); }
  note("recording_started");
}
video.addEventListener("playing", () => {
  if (!started || !render || stopping || firstFrame) return;
  firstFrame = true; playbackZero = video.currentTime; frameTime = NaN; frameOffset = NaN;
  budgetStartedAt = performance.now(); applyBudget(state?.maxSessionSeconds);
  void request("/ready", {}).catch(e => { error(e); void stop("ready-error"); });
  try { beginRecording(); } catch (e) { error(e); void stop("recording-start-failure"); }
});
async function start(withVideo) {
  if (started || starting || stopping || accessBlocked || !state || contactSaving) return;
  starting = true; controls();
  $("start").disabled = true; $("text-start").disabled = true; $("connection").textContent = `Starting ${state.latest?.scenario?.characters?.length ?? 4} minds and buffering committed world time…`;
  telemetry.length = 0; telemetryZero = performance.now(); promptInspector.start();
  requestedSeconds = selectedSeconds(); sessionBudgetSeconds = requestedSeconds; startLease();
  try {
    const initial = await request("/start", { render: withVideo, seconds: requestedSeconds }, 60000);
    if (stopping) return;
    started = true; render = withVideo; window.argosSitcom.status = "running";
    scriptQueue = initial.handoff === "script_append";
    requestedChunkSeconds = initial.requestedChunkSeconds === undefined ? undefined : validateH3ChunkSeconds(initial.requestedChunkSeconds);
    if (requestedChunkSeconds !== undefined && !scriptQueue && requestedChunkSeconds !== 10) throw new Error("Direct H3 is calibrated only at 10 seconds");
    state = { ...state, maxSessionSeconds: initial.maxSessionSeconds ?? requestedSeconds };
    budgetStartedAt = performance.now(); applyBudget(state.maxSessionSeconds);
    if (!withVideo) { $("connection").textContent = "Simulation only · no H3 credits"; return; }
    const mimeType = recordingMime();
    [rawUpload, shareUpload] = await Promise.all([prepareUpload("raw", mimeType), prepareUpload("composition", mimeType)]);
    if (stopping) return;
    scene = undefined; sourceMs = 0; lastAudience = ""; lastChat = "";
    register(initial.initialSegment ?? initial.segment); video.hidden = false; $("standby").hidden = true;
    const fal = createFalClient({ proxyUrl: "/proxy", fetch: (url, init) => { const h = new Headers(init?.headers); h.set("x-argos-token", token); return fetch(url, { ...init, headers: h }); } });
    hardStop = setTimeout(() => stop("connection-deadline"), 60000);
    const requestedResolution = validateDirectorResolution(initial.configure.resolution);
    let resolutionConfirmed = false;
    setupConfirmed = false;
    session = fal.realtime.open(wma("minimax/h3-max/director"), { receive: ["video", "audio"], negotiationTimeoutMs: 45000,
      onMedia(stream) {
        if (stopping) { for (const track of stream.getTracks()) track.stop(); return; }
        video.srcObject = stream; void video.play().catch(error);
      },
      onData(raw) {
        if (stopping) return;
        let message; try { message = JSON.parse(raw); } catch { return; }
        if (window.argosSitcom.messages.length < 1024) window.argosSitcom.messages.push(message);
        promptInspector.receipt(message);
        note(`provider_${message.type}`, {
          ...(Number.isInteger(message.prompt_version) && message.prompt_version > 0 ? { version: message.prompt_version } : {}),
          ...(typeof (message.error ?? message.reason) === "string" ? { reason: String(message.error ?? message.reason).slice(0, 300) } : {}),
          ...(Number.isInteger(message.chunk_index) && message.chunk_index >= 0 && message.chunk_index < 1024 ? { chunkIndex: message.chunk_index } : {}),
          ...(Number.isFinite(message.playback_seconds) && message.playback_seconds > 0 && message.playback_seconds <= 30 ? { playbackSeconds: message.playback_seconds } : {}),
          ...(Number.isFinite(message.buffer_depth_seconds) && message.buffer_depth_seconds >= 0 && message.buffer_depth_seconds <= 2000 ? { bufferDepthSeconds: message.buffer_depth_seconds } : {}),
          ...(Number.isFinite(message.generation_seconds) && message.generation_seconds >= 0 && message.generation_seconds <= 300 ? { generationSeconds: message.generation_seconds } : {}),
          ...(Number.isFinite(message.scheduling_lead_ms) && Math.abs(message.scheduling_lead_ms) <= 2000000 ? { schedulingLeadMs: message.scheduling_lead_ms } : {}),
          ...(Number.isInteger(message.script_version) && message.script_version > 0 && message.script_version <= 1024 ? { scriptVersion: message.script_version } : {}),
          ...(Number.isInteger(message.script_offset_seconds) && message.script_offset_seconds >= 0 && message.script_offset_seconds <= 2000 ? { scriptOffsetSeconds: message.script_offset_seconds } : {}),
          ...(Number.isInteger(message.script_origin_chunk_index) && message.script_origin_chunk_index >= 0 && message.script_origin_chunk_index < 1024 ? { scriptOriginChunkIndex: message.script_origin_chunk_index } : {}),
          ...(Number.isInteger(message.script_queued) && message.script_queued >= 0 && message.script_queued <= 64 ? { scriptQueued: message.script_queued } : {}),
        });
        if (message.type === "configured") {
          if (!isH3SetupAcknowledgement(message)) { error(new Error("H3 setup acknowledgement has the wrong version")); void stop("setup-version-mismatch"); return; }
          try { confirmDirectorResolution(message, requestedResolution); resolutionConfirmed = true;
            note("resolution_confirmed", { resolution: requestedResolution }); }
          catch (e) { error(e); void stop("resolution-not-confirmed"); return; }
        }
        if (message.type === "configured" && requestedChunkSeconds !== undefined) {
          try { confirmH3ChunkSeconds(message, requestedChunkSeconds); chunkDurationConfirmed = true;
            note("chunk_duration_confirmed", { playbackSeconds: requestedChunkSeconds }); }
          catch (e) { error(e); void stop("chunk-duration-not-confirmed"); return; }
        }
        if (isH3SetupAcknowledgement(message)) { setupConfirmed = true; void sendNext(); }
        if (message.type === "session_info") {
          if (scriptQueue && (message.scripts !== true || message.script_modes && !message.script_modes.includes("append"))) {
            error(new Error("This H3 session does not advertise native script append support.")); void stop("script-contract-unsupported"); return;
          }
          const providerLimit = Number.isFinite(message.max_session_seconds) && message.max_session_seconds > 0 ? message.max_session_seconds : null;
          applyBudget(providerLimit);
          void request("/session-info", { maxSessionSeconds: providerLimit }).catch(e => { error(e); void stop("session-info-failure"); });
        }
        let playbackChunk;
        if (message.type === "chunk") {
          try {
            if (!resolutionConfirmed) throw new Error("H3 sent a chunk before confirming resolution");
            if (requestedChunkSeconds !== undefined && !chunkDurationConfirmed) throw new Error("H3 sent media before confirming the requested duration");
            playbackChunk = h3ChunkForPlayback(message, scriptQueue, timeline.issued().filter(s => s.version <= sentVersion).map(s => s.version), requestedChunkSeconds);
          }
          catch (e) { error(e); void stop(scriptQueue ? "script-contract-mismatch" : "prompt-contract-mismatch"); return; }
        }
        if (playbackChunk && timeline.add(playbackChunk)) {
          window.argosSitcom.chunks = timeline.snapshot();
          // Only a contiguous media frontier may release the next source window.
          const frontier = chunksForSave().at(-1);
          if (frontier && frontier.version <= sentVersion) settledVersion = Math.max(settledVersion, frontier.version);
          for (const version of pendingSent.keys()) if (version <= settledVersion) pendingSent.delete(version);
          admittedVersion = Math.max(admittedVersion, settledVersion);
          void sendNext();
        }
        if (scriptQueue && message.type === "prompt_applied" && message.script_beats === 1
          && message.prompt_version === admittedVersion + 1 && message.prompt_version <= sentVersion
          && (message.prompt_version === 1 || message.script_mode === "append")) {
          admittedVersion = message.prompt_version;
          note("script_admitted", { version: admittedVersion });
          void sendNext();
        }
        if (["prompt_rejected", "error", "invalid_message"].includes(message.type)) {
          error(new Error(message.error ?? message.reason ?? message.message ?? `Director ${message.type}`)); void stop(`provider-${message.type}`);
        }
        if (message.type === "stream_exhausted") {
          // Generation can end while its last valid media is still buffered.
          if (firstFrame && chunksForSave().length) beginDrain("provider_exhausted_draining");
          else void stop("stream-exhausted-before-media");
        }
      },
      onState(value) { if (!stopping) $("connection").textContent = `H3 · ${value}`; },
      onError(e) { if (!stopping) {
        error(e);
        // Preserve the error, but let already buffered final frames play. The
        // drain watchdog and original spending deadline still bound this wait.
        if (drainEnd === undefined) void stop("connection-error");
        else note("connection_error_during_drain");
      } },
    });
    // Default stays schema-compatible. Only the explicitly requested comparison
    // sends the product-page/example knob, and requires a matching receipt.
    const configure = { ...initial.configure }; delete configure.chunk_duration; delete configure.duration; delete configure.max_session_seconds;
    if (requestedChunkSeconds !== undefined) configure.chunk_duration = requestedChunkSeconds;
    session.send(configure); sentVersion = configure.prompt_version; sentAt = performance.now();
    promptInspector.capture(configure, initial.initialSegment);
    pendingSent.set(sentVersion, sentAt);
    note("configure_sent", { version: sentVersion, promptCharacters: configure.prompt.length });
  } catch (e) {
    error(e);
    await stop("startup-error");
  } finally { starting = false; controls(); }
}
async function finishCapture(item) {
  if (!item) return null;
  if (item.recorder.state !== "inactive") item.recorder.stop();
  let timer;
  const finalize = async () => {
    await item.finished; await item.upload.chain;
    if (item.upload.failure) throw item.upload.failure;
    const saved = await request(`/recordings/${item.upload.kind}/finish`, { chunks: item.upload.index });
    if (saved.complete !== true) throw new Error(`${item.upload.kind} recording did not finalize`);
    recordingDownload(saved, item.upload.kind); return saved;
  };
  try {
    return await Promise.race([finalize(), new Promise((_resolve, reject) => { timer = setTimeout(() => {
      item.upload.failure = new Error(`${item.upload.kind} recording finalization timed out; uploaded partial media is retained`);
      reject(item.upload.failure);
    }, 45000); })]);
  } finally { clearTimeout(timer); for (const track of item.stream.getTracks()) track.stop(); }
}
async function stop(reason = "manual") {
  if (stopping) return;
  stopping = true; clearTimeout(hardStop); clearTimeout(polling); clearTimeout(leaseTimer); clearTimeout(drainTimer); recordingEnd = Math.max(recordingStart, playbackTime());
  note("stop_requested"); controls(); window.argosSitcom.status = "saving";
  try { session?.send({ type: "stop" }); } catch { }
  const captures = Promise.allSettled([finishCapture(rawCapture), finishCapture(shareCapture)]);
  try { const closing = session?.close(); if (closing) void closing.catch(() => {}); } catch { }
  const failures = [];
  try { await request("/stop", { reason }); } catch (e) { failures.push(e); }
  const recordings = await captures;
  const raw = recordings[0].status === "fulfilled" ? recordings[0].value : null;
  const share = recordings[1].status === "fulfilled" ? recordings[1].value : null;
  for (const result of recordings) if (result.status === "rejected") failures.push(result.reason);
  const persistence = await Promise.allSettled([
    request("/playback", { chunks: chunksForSave(), recordingStart, recordingEnd, telemetry }),
    request("/recordings/status"), readState(5000),
  ]);
  window.argosSitcom.recording = raw; window.argosSitcom.composition = share;
  if (persistence[1].status === "fulfilled") {
    const available = persistence[1].value;
    // Even after a failed finalization, already uploaded bytes remain reachable.
    if (!raw) recordingDownload(available?.raw, "raw");
    if (!share) recordingDownload(available?.composition, "composition");
    const partials = [available?.raw, available?.composition].filter(r => r && r.complete === false && r.partialPath);
    if (partials.length) {
      $("recording-recovery").hidden = false;
      $("recording-recovery").textContent = `Incomplete media retained locally for recovery (playability not guaranteed): ${partials.map(r => `${r.kind}: ${r.partialPath}`).join(" · ")}`;
    }
  }
  if (persistence[2].status === "fulfilled") { state = persistence[2].value; window.argosSitcom.state = state; }
  for (const result of persistence) if (result.status === "rejected") failures.push(result.reason);
  if (["client_disconnected", "storage_failure", "recording_failure", "startup_failure", "startup_timeout"].includes(state?.stopReason))
    failures.push(new Error(`Server stopped the session: ${state.stopReason.replaceAll("_", " ")}. Uploaded media is retained.`));
  $("connection").textContent = failures.length ? "Stopped · uploaded media retained; some saves incomplete"
    : raw && share ? "Stopped · raw video, shareable video, and world saved"
      : raw ? "Stopped · raw video and world saved" : "Stopped · world saved; no video recorded";
  if (unfilmedTail) $("connection").textContent += ` · ${((unfilmedTail.sourceEndSimMs - unfilmedTail.sourceStartSimMs) / 1000).toFixed(3)}s of final world time saved but not filmed`;
  if (failures.length) error(failures[0]);
  window.argosSitcom.stopped = true; window.argosSitcom.status = "stopped"; controls();
}
$("start").onclick = () => start(true); $("text-start").onclick = () => start(false); $("stop").onclick = () => stop();
$("reset").onclick = async () => {
  if (accessBlocked || resetting || !state?.stopped || state.resetAvailable !== true || window.argosSitcom.status === "saving") return;
  resetting = true; controls(); $("error").hidden = true;
  try {
    const result = await request("/reset", {}, 45000), url = new URL(result.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/"
      || url.username || url.password || url.search || !/^#[a-f0-9]{48}$/.test(url.hash)) throw new Error("Invalid new episode link");
    location.assign(url.href);
  } catch (e) { resetting = false; error(e); controls(); }
};
$("duration").addEventListener("change", () => { durationEdited = true; controls(); });
for (const id of ["contact-name", "contact-custom", "contact-context"]) $(id).addEventListener("input", editContact);
$("contact-relationship").addEventListener("change", editContact);
$("contact-form").onsubmit = async e => {
  e.preventDefault(); const contact = contactDraft();
  if (accessBlocked || !state || contactSaving || starting || stopping || state?.stopped || !validContact(contact)) return;
  contactSaving = true; $("contact-status").textContent = "Applying contact…"; controls();
  try {
    const result = await request("/contact", contact);
    appliedContact = result?.contact ?? contact; contactRevision++;
    if (state?.latest) state = { ...state, latest: { ...state.latest, contact: appliedContact } };
    contactDirty = false; contactInitialized = true; contactFields(appliedContact); updateContact();
    $("contact-status").textContent = `Applied · ${sitcomContactLabel(appliedContact)}. Earlier messages keep their original contact.`;
    $("contact-status").setAttribute("data-pending", "false");
  } catch (e) { $("contact-status").textContent = "Contact not applied. Your previous contact is unchanged."; error(e); }
  finally { contactSaving = false; controls(); }
};
$("message-form").onsubmit = async e => {
  e.preventDefault(); const text = $("message").value.trim();
  if (accessBlocked || !text || !started || starting || stopping || state?.stopped || contactSaving) return;
  $("send").disabled = true;
  try { await request("/control", { type: "message", text }); $("message").value = ""; } catch (e) { error(e); } finally { controls(); }
};
$("thought-form").onsubmit = async e => {
  e.preventDefault(); const text = $("thought").value.trim(), actor = $("actor").value; if (accessBlocked || !text || !started || starting || stopping || state?.stopped) return; $("inject").disabled = true;
  try { await request("/control", { type: "thought", actor, text }); $("thought").value = ""; $("whisper-status").textContent = `Whispered to ${actor}. Their next authored thought is their own choice.`; } catch (e) { error(e); } finally { controls(); }
};
$("influence-form").onsubmit = async e => {
  e.preventDefault(); const text=$("influence").value.trim();
  if(!text || $("influence-send").disabled)return;
  $("influence-send").disabled=true;
  try{await request("/control",{type:"influence",text});$("influence").value="";}catch(e){error(e);}finally{controls();}
};
$("sound").onclick = () => { video.muted = !video.muted; $("sound").textContent = video.muted ? "Sound off" : "Sound on"; };
$("drawer-toggle").onclick = () => { const hidden = $("experience").classList.toggle("drawer-closed"); $("drawer-toggle").textContent = hidden ? "Show chat ‹" : "Hide chat ›"; $("drawer-toggle").setAttribute("aria-expanded", String(!hidden)); };
$("fullscreen").onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("experience").requestFullscreen(); } catch (e) { error(e); } };
window.addEventListener("pagehide", () => { try { session?.send({ type: "stop" }); session?.close(); } catch { } if ((started || starting) && !stopping) void fetch("/stop", { method: "POST", headers, body: "{}", keepalive: true }).catch(() => {}); });
// Pasting the correct fragment into an already open idle page does not normally
// reload JavaScript. Reload to bind every API/media request to that same session.
window.addEventListener("hashchange", () => { if (!started && !starting && location.hash.slice(1) !== token) location.reload(); });
void poll(); requestAnimationFrame(animate);
