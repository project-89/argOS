import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../phone-client.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../phone-demo.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../phone-demo.css", import.meta.url), "utf8");
const server = readFileSync(new URL("../../run-phone-demo.ts", import.meta.url), "utf8");

test("simulation-only validation rejects H3 before cognition preparation or allocation", () => {
  expect(server).toContain('process.env.ARGOS_DEMO_SIMULATION_ONLY === "1"');
  expect(server).toContain('videoAvailable: !simulationOnly && Boolean(process.env.FAL_KEY)');
  expect(server.indexOf('if (render && simulationOnly)')).toBeLessThan(server.indexOf('await demo.prepareOpening()'));
});

test("recording uses cloned incoming media, never the UI canvas", () => {
  expect(client).toContain("new MediaStream(incoming.getTracks().map(track => track.clone()))");
  expect(client).not.toContain("captureStream");
  expect(client).not.toContain("drawImage");
  expect(client).not.toContain("PHONE SCREEN · EXACT ECS TEXT");
});

test("the raw player replaces the diagram and can replay its saved recording", () => {
  expect(html).toContain('aria-label="Raw H3 video"');
  expect(client).toContain("canvas.hidden = withVideo");
  expect(client).toContain("video.hidden = !withVideo");
  expect(client).toContain("video.src = link.href");
  expect(client).toContain("video.controls = true");
  expect(client).toContain("playbackZero = -recordingStart");
  expect(css).toContain("[hidden] { display: none !important; }");
});

test("transport flow and display truth use separate clocks with frame-accurate sampling", () => {
  expect(client).toContain("new PhonePromptFlow()");
  expect(client).toContain("promptFlow.settle(message)");
  expect(client).toContain("promptFlow.markAvailable(frontier)");
  expect(client).toContain("promptFlow.markDisplayed(chunk)");
  expect(client).toContain("presentationAtPlayback(state?.camera.shots || []");
  expect(client).toContain("requestVideoFrameCallback");
  expect(client).toContain("metadata.mediaTime");
  expect(client).toContain('recordSync("segment_displayed"');
  expect(client).toContain("displayTracker.crossed(timeline.snapshot(), playhead)");
  expect(client).toContain("settledVersion: promptFlow.snapshot().settled");
  expect(client).not.toContain("renderedVersion = Math.max");
});

test("continuation sends commit only after transport success and raw recording survives server failures", () => {
  const nextRequest = client.indexOf('const next = await request("/next"');
  const transportSend = client.indexOf("sendPromptTransaction(promptFlow, next.prompt_version", nextRequest);
  const sentTelemetry = client.indexOf('recordSync("prompt_sent", next)', transportSend);
  expect(transportSend).toBeGreaterThan(nextRequest);
  expect(sentTelemetry).toBeGreaterThan(transportSend);
  expect(client).toContain('recordSync("prompt_send_failed", next)');
  expect(client).toContain('stop("prompt-send-error")');

  const stop = client.indexOf('async function stop(reason = "manual")');
  const localUrl = client.indexOf("URL.createObjectURL(nextBlob)", stop);
  const boundedBlob = client.indexOf("Promise.race([recordingFinished", localUrl);
  const exposeBlob = client.indexOf("exposeLocalRecording(blob)", boundedBlob);
  const serverStop = client.indexOf('bestEffortRequest("/stop"', stop);
  const serverPlayback = client.indexOf('bestEffortRequest("/playback"', stop);
  const serverRecording = client.indexOf('fetch("/recording"', stop);
  expect(localUrl).toBeGreaterThan(stop);
  expect(boundedBlob).toBeGreaterThan(localUrl);
  expect(exposeBlob).toBeGreaterThan(boundedBlob);
  expect(serverStop).toBeGreaterThan(exposeBlob);
  expect(serverPlayback).toBeGreaterThan(serverStop);
  expect(serverRecording).toBeGreaterThan(serverPlayback);
  expect(client).toContain('bestEffortRequest("/stop", {}, 15000)');
  expect(client).toContain('}, 15000);');
  expect(client).toContain("RECORDING_FINALIZE_TIMEOUT_MS = 5000");
  expect(client).toContain("recordingFinished.then(lateBlob");
  expect(client).toContain("raw recording ready to download; server persistence incomplete");
});

test("continuation delivery has bounded recovery and explicit rejection semantics", () => {
  expect(client).toContain("new PhonePromptDeliveryTracker()");
  expect(client).toContain('message.type === "prompt_pending"');
  expect(client).toContain("promptDelivery.markPending(message.prompt_version");
  expect(client).toContain('deliveryState === "receipt-timeout"');
  expect(client).toContain('deliveryState === "settlement-timeout"');
  expect(client).not.toContain("prompt_retry_sent");
  expect(client).not.toContain("prompt_retry_failed");
  expect(client).toContain('recordSync("prompt_rejection_terminal"');
  expect(client).toContain('stop("prompt-rejected")');
  expect(client).toContain('recordSync("configure_fallback_send_failed"');
});

test("explicit chunks are capability-probed and playable duration/telemetry are ready-anchored", () => {
  expect(server).toContain("process.env.ARGOS_DIRECTOR_CHUNK_SECONDS ?? 10");
  expect(server).toContain("chunk_duration: directorChunkSeconds");
  expect(client).toContain('configureState = "probing-explicit-duration"');
  expect(client).toContain("isChunkDurationConfigureRejection(message)");
  expect(client).toContain("delete fallbackConfigure.chunk_duration");
  expect(client).toContain('message.type === "configured"');
  expect(client).toContain('typeof message.chunk_duration === "number"');
  expect(client).toContain("renderHorizonFromChunk(renderHorizonMs, message)");
  expect(client).toContain("message.continuation_playback_seconds");
  expect(client).toContain("renderHorizonMs = initial.renderHorizonMs");
  expect(server).toContain("renderHorizonMs: initialRenderHorizonMs");
  expect(client).toContain("renderHorizonMs });");
  expect(server).toContain("demo.setProjectionHorizonMs(renderHorizonMs)");
  const readyRoute = server.indexOf('app.post("/ready"');
  expect(server.indexOf("deadline = setTimeout", readyRoute)).toBeGreaterThan(readyRoute);
  const readyRequest = client.indexOf('request("/ready", {})');
  expect(client.indexOf('hardStop = setTimeout(() => stop("duration-limit")', readyRequest)).toBeGreaterThan(readyRequest);
  expect(client).toContain("transportBeganWallMs, telemetry: syncTelemetry");
  expect(client).toContain("const promptCapturedWalls = new Map()");
  expect(client).toContain("Date.now() - sourceCapturedWallMs");
  expect(server).toContain("sourceCapturedWallMs:");
  expect(server).toContain("telemetry: z.array(telemetrySchema).max(2048)");
  expect(server).toContain('app.use("/playback", express.json({ limit: "512kb" }))');
  expect(server.indexOf('app.use("/playback"')).toBeGreaterThan(server.indexOf('x-argos-token'));
  expect(server).toContain("sourceToDisplayMs:");
  expect(server).toContain("recordingEnd < parsed.data.recordingStart");
});

test("phone text is opt-out UI text, never HTML or part of raw recording", () => {
  expect(html).toContain('id="show-phone-text" type="checkbox" checked');
  expect(html).toContain('id="phone-overlay"');
  expect(client).toContain('$("phone-text").textContent = screen?.body || ""');
  expect(client).not.toContain("innerHTML");
  expect(client).toContain('const view = render ? film.presentation : state');
  expect(client).toContain('audienceMessages(state.messages, view)');
  expect(html).toContain("not synchronized to the film");
});

test("watch-first layout puts one current thought and world state directly beneath the film", () => {
  expect(html.indexOf('id="source"')).toBeLessThan(html.indexOf('id="current-thought"'));
  expect(html.indexOf('id="current-thought"')).toBeLessThan(html.indexOf('id="facts"'));
  expect(html.indexOf('id="facts"')).toBeLessThan(html.indexOf('<aside id="drawer"'));
  expect(html).toContain('<details id="thought-history">');
  expect(html).not.toContain('class="intro"');
  expect(client).toContain("const thought = currentThought(view)");
  expect(client).toContain('$("current-thought").textContent = thought');
});

test("drawer and fullscreen controls preserve the scene's thought/state, not just raw video", () => {
  expect(client).toContain('$("experience").classList.toggle("drawer-closed")');
  expect(client).toContain('$("experience").requestFullscreen()');
  expect(html).toContain('aria-controls="drawer" aria-expanded="true"');
  expect(html.indexOf('id="message-form"')).toBeLessThan(html.indexOf('id="thought-form"'));
  expect(css).toContain(".experience.drawer-closed .drawer { display:none; }");
  expect(css).toContain("@media (max-width:700px)");
});
