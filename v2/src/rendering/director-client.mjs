import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const headers = { "x-argos-token": token, "Content-Type": "application/json" };
const post = (path, data) => fetch(path, { method: "POST", headers, body: JSON.stringify(data) });
const output = document.querySelector("pre");
const video = document.querySelector("video");
const log = (data) => {
  output.textContent = `${JSON.stringify(data)}\n${output.textContent}`.slice(0, 12000);
  void post("/telemetry", data);
};
let session, stopping = false, timer, recorder, recordingFinished;
window.argosDirector = { messages: [], stopped: false, mediaReceived: false, recording: null };
video.addEventListener("playing", () => {
  if (recorder || stopping) return;
  try {
    const mimeType = ["video/mp4;codecs=avc1.42001E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm"]
      .find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("No supported recording format");
    const chunks = [];
    recorder = new MediaRecorder(video.srcObject, { mimeType, videoBitsPerSecond: 2500000 });
    recordingFinished = new Promise(resolve => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => log({ type: "recording_error", message: event.error?.message });
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    });
    recorder.start(1000);
    log({ type: "recording_started", mimeType: recorder.mimeType });
  } catch (error) {
    log({ type: "recording_error", message: error.message });
    void stop("recording-unavailable");
  }
});
async function saveRecording() {
  if (!recordingFinished) return;
  const blob = await recordingFinished;
  if (!blob.size) throw new Error("Recording was empty");
  const extension = blob.type.startsWith("video/mp4") ? "mp4" : "webm";
  const download = document.querySelector("#download");
  download.href = URL.createObjectURL(blob);
  download.download = `argos-director.${extension}`;
  download.hidden = false; // Keep a browser download even if the local server save fails.
  const response = await fetch("/recording", { method: "POST",
    // MediaRecorder includes an unquoted comma-separated codecs parameter. Send only
    // the base MIME type: strict HTTP parsers reject that parameter and skip the body.
    headers: { "x-argos-token": token, "Content-Type": blob.type.split(";")[0] }, body: blob,
    signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Recording save rejected: ${response.status}`);
  window.argosDirector.recording = await response.json();
  log({ type: "recording_saved", ...window.argosDirector.recording });
}
async function stop(reason = "manual") {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  try { session?.send({ type: "stop" }); } catch {}
  // Give the stop control message time to arrive before tearing down WebRTC.
  await new Promise(resolve => setTimeout(resolve, 500));
  if (recorder?.state !== "inactive") recorder?.stop();
  try { await session?.close(); } catch {}
  try { await post("/stop", { reason }); } catch {}
  try { await saveRecording(); }
  catch (error) { log({ type: "recording_save_error", message: error.message }); }
  finally {
    window.argosDirector.stopped = true;
    log({ type: "local_stopped", reason });
  }
}
document.querySelector("#stop").onclick = () => stop();
document.querySelector("#start").onclick = async () => {
  document.querySelector("#start").disabled = true;
  try {
    const response = await post("/start", {});
    if (!response.ok) throw new Error(`Start rejected: ${response.status}`);
    const initial = await response.json();
    const fal = createFalClient({ proxyUrl: "/proxy", fetch: (url, init) => {
      const requestHeaders = new Headers(init?.headers);
      requestHeaders.set("x-argos-token", token);
      return fetch(url, { ...init, headers: requestHeaders });
    } });
    timer = setTimeout(() => stop("hard-duration-limit"), initial.maxSessionMs);
    session = fal.realtime.open(wma("minimax/h3-max/director"), {
      receive: ["video", "audio"], negotiationTimeoutMs: 45000,
      onMedia(stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
        window.argosDirector.mediaReceived = true;
        log({ type: "media_received" });
      },
      onData(raw) {
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        window.argosDirector.messages.push(message);
        log(message);
        if (message.type === "chunk" && !stopping) {
          // One update per generated chunk, not one prompt per fast ECS tick.
          void post("/next", {}).then(r => r.json()).then(next => {
            if (!stopping && next.prompt) session.send(next);
          }).catch(() => stop("projection-failed"));
        }
        if (message.type === "error" || message.type === "stream_exhausted") void stop(message.type);
      },
      onState(state) { log({ type: "connection_state", state }); },
      onError(error) {
        if (stopping) return; // The server closing SCTP in response to stop is expected.
        log({ type: "connection_error", message: error.message }); void stop("connection-error");
      },
    });
    session.send(initial.configure);
  } catch (error) { log({ type: "startup_error", message: error.message }); await stop("startup-error"); }
};
window.addEventListener("pagehide", () => { try { session?.send({ type: "stop" }); session?.close(); } catch {} });
