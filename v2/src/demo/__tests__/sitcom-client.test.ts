import { jest } from "@jest/globals";
import { build } from "esbuild";
import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

let bundle: string, clientSource: string;
beforeAll(async () => {
  clientSource = await readFile(new URL("../sitcom-client.mjs", import.meta.url), "utf8");
  const result = await build({ entryPoints: [fileURLToPath(new URL("../sitcom-client.mjs", import.meta.url))], bundle: true, write: false, format: "iife", platform: "browser",
    plugins: [{ name: "offline-director", setup(plugin) {
      plugin.onResolve({ filter: /^@fal-ai\/client/ }, () => ({ path: "stub", namespace: "offline" }));
      plugin.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "export const createFalClient = () => globalThis.mockFal; export const wma = name => name;" }));
    } }] }); bundle = result.outputFiles[0].text;
});
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); await new Promise<void>(resolve => setImmediate(resolve)); };
function harness({ replay = false, defaultSeconds = 600, hash = "#not-a-real-key-local-test-token", stateStatus = 200, scriptQueue = false,
  requestedChunkSeconds = undefined as number | undefined, autoConfirmResolution = true, promptLogStatus = 204 } = {}) {
  class Track {
    kind: string; readyState = "live"; cloned = false;
    constructor(kind: string) { this.kind = kind; }
    clone() { const track = new Track(this.kind); track.cloned = true; return track; }
    stop() { this.readyState = "ended"; }
  }
  class Stream {
    constructor(public tracks: Track[] = []) {}
    getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
    addTrack(track: Track) { this.tracks.push(track); }
  }
  const canvasStream = new Stream([new Track("video")]);
  const canvasContext = { fillRect() {}, fillText() {}, drawImage() {}, measureText: (text: string) => ({ width: text.length * 5 }) };
  class Element {
    style: Record<string,string> = {};
    open = false; checked = false;
    value = ""; textContent = ""; hidden = false; disabled = false; children: unknown[] = []; listeners: Record<string, Function> = {};
    className = ""; href = ""; src = ""; srcObject: Stream | null = null; currentTime = 0; videoWidth = 832; videoHeight = 480; readyState = 2;
    muted = true; scrollTop = 0; scrollHeight = 0; clientHeight = 400; onclick?: () => Promise<void>; onsubmit?: (e: unknown) => Promise<void>;
    classList = { toggle: () => false }; setAttribute() {} replaceChildren(...children: unknown[]) { this.children = children; } append(...children: unknown[]) { this.children.push(...children); }
    addEventListener(name: string, listener: Function) { this.listeners[name] = listener; } getContext() { return canvasContext; }
    requestVideoFrameCallback() {} play() { return Promise.resolve(); } pause() {} load() {} captureStream() { return canvasStream; }
  }
  const elements = new Map<string, Element>(), el = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  el("actor").value = "Elaine"; el("duration").value = "600";
  const captures: Stream[] = [], recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported() { return true; } state = "inactive"; mimeType = "video/webm"; ondataavailable?: Function; onstop?: Function;
    constructor(public stream: Stream) { captures.push(stream); recorders.push(this); } start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["fixture-media"], { type: this.mimeType }) }); this.onstop?.(); }
  }
  const segment = (version: number) => ({ version, sourceId: "fixture", sourceStartSimMs: (version - 1) * 8500, sourceEndSimMs: version * 8500, prompt: "Public committed scene" });
  const frame = { sourceId: "fixture", atSimMs: 0, running: true, actors: [], facts: {}, phone: [] as any[], contact: { name: "Unknown sender", relationship: "unknown", context: "" } };
  const state = { started: false, prepared: false, stopped: replay, render: replay, replay, videoAvailable: true,
    resetAvailable: true, durationLimits: { min: 10, max: 1800, default: defaultSeconds }, maxSessionSeconds: defaultSeconds, latest: frame, frames: [frame], segments: replay ? [segment(1)] : [] };
  const requests: Array<{ path: string; body: any; headers: Record<string, string> }> = [], sent: any[] = [];
  let callbacks: any, nextResolve: ((response: Response) => void) | undefined, deferNext = false, rejectContact = false;
  let deferState = false, stateResolve: (() => void) | undefined, deferContact = false, contactResolve: (() => void) | undefined;
  let rejectHeartbeat = false, failChunkCount = 0, rejectFinish = "", holdChunks = false, badCursor = false;
  let resetUrl = `http://127.0.0.1:3470/#${"b".repeat(48)}`, rejectReset = false;
  let presentationCursor = 0, failPresentation = false;
  let nextResult: unknown;
  const pendingChunks: Array<() => void> = [];
  const saved: Record<string, any> = {};
  const recording = (kind: string, complete = false) => ({ kind, nextIndex: 0, path: `${kind}.webm`, bytes: replay ? 11 : 0,
    mimeType: "video/webm", ...(complete ? { url: `/recordings/${kind}/media?cap=fixture-media-capability` } : { partialPath: `/tmp/fixture/${kind}.webm.part` }), complete });
  if (replay) { saved.raw = recording("raw", true); saved.composition = recording("composition", true); }
  const session = { send: (message: unknown) => sent.push(message), close: () => Promise.resolve() };
  const open = jest.fn((_model: unknown, opts: unknown) => { callbacks = opts; return session; });
  const fetch = jest.fn(async (path: string, init: any = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; requests.push({ path, body, headers: init.headers });
    if (path === "/prompts") return body ? new Response(null, { status: promptLogStatus }) : Response.json({ scope: "Offline public prompts", entries: [] });
    if (path.startsWith("/state?")) {
      if (stateStatus !== 200) return new Response("Forbidden", { status: stateStatus });
      const after = Number(new URL(path, "http://fixture").searchParams.get("afterFrame")), frames = state.frames.slice(after, after + 200);
      const response = Response.json({ ...state, frames, cursor: after + frames.length + (badCursor ? 1 : 0), hasMore: after + frames.length < state.frames.length });
      if (deferState) { deferState = false; return new Promise<Response>(resolve => { stateResolve = () => resolve(response); }); }
      return response;
    }
    if (path === "/start") { state.maxSessionSeconds = body.seconds; return Response.json({ maxSessionSeconds: body.seconds, initialSegment: segment(1),
      ...(requestedChunkSeconds === undefined ? {} : { requestedChunkSeconds }),
      handoff: scriptQueue ? "script_append" : "chunk_ack", configure: { type: "configure", resolution: "480p", prompt: "Public committed scene", prompt_version: 1,
        ...(scriptQueue ? { script: [{ offset: 0, prompt: "Public committed scene" }] } : {}) } }); }
    if (path === "/next") {
      if (nextResult) return Response.json(nextResult);
      if (deferNext) return new Promise<Response>(resolve => { nextResolve = resolve; });
      return Response.json({ segment: segment((body.admittedVersion ?? body.settledVersion) + 1) });
    }
    if (path === "/ready") return Response.json({ atSimMs: 8500 });
    if (path === "/presentation") {
      for (const chunk of body.chunks) if (chunk.chunk_index === presentationCursor) presentationCursor++;
      return Response.json({ receiptCursor: presentationCursor, sourcePausedForVideo: false,
        ...(failPresentation ? { failure: { reason: "provider_chunk_shorter_than_performance" } } : {}) });
    }
    if (path === "/contact") {
      if (rejectContact) return Response.json({ error: "Invalid contact" }, { status: 400 });
      if (deferContact) return new Promise<Response>(resolve => { contactResolve = () => { state.latest.contact = { ...body }; resolve(Response.json({ contact: state.latest.contact })); }; });
      state.latest.contact = { ...body }; return Response.json({ contact: state.latest.contact });
    }
    if (path === "/control") return new Response(null, { status: 204 });
    if (path === "/heartbeat") return new Response(null, { status: rejectHeartbeat ? 503 : 204 });
    if (path === "/session-info") { if (body.maxSessionSeconds != null) state.maxSessionSeconds = Math.min(state.maxSessionSeconds, body.maxSessionSeconds); return new Response(null, { status: 204 }); }
    if (path === "/stop") { state.stopped = true; return new Response(null, { status: 204 }); }
    if (path === "/reset") return rejectReset ? Response.json({ error: "Fixture restart failure" }, { status: 503 }) : Response.json({ url: resetUrl });
    if (path === "/playback") return new Response(null, { status: 204 });
    if (path === "/recordings/status") return Response.json(saved);
    const upload = path.match(/^\/recordings\/(raw|composition)\/(start|finish|chunks\/(\d+))$/);
    if (upload) {
      const [, kind, op, index] = upload;
      if (op === "start") { saved[kind] = recording(kind); return Response.json(saved[kind]); }
      if (op === "finish") {
        if (rejectFinish === kind) return Response.json({ error: "Fixture disk finish failure" }, { status: 503 });
        saved[kind].complete = true; saved[kind].url = `/recordings/${kind}/media?cap=fixture-media-capability`; return Response.json(saved[kind]);
      }
      if (failChunkCount > 0) { failChunkCount--; return Response.json({ error: "Fixture chunk failure" }, { status: 503 }); }
      const acknowledge = () => { if (Number(index) === saved[kind].nextIndex) { saved[kind].nextIndex++; saved[kind].bytes += body.size; } return Response.json(saved[kind]); };
      if (holdChunks) return new Promise<Response>(resolve => pendingChunks.push(() => resolve(acknowledge())));
      return acknowledge();
    }
    if (path === "/replay") return Response.json({ recordingStart: 0, recordingEnd: 10, chunks: [{ index: 0, start: 0, end: 10, version: 1 }] });
    if (["/media/raw", "/media/composition"].includes(path)) return new Response(new Blob(["saved-media"], { type: "video/webm" }));
    throw new Error(`Unexpected offline client request: ${path}`);
  });
  const timers = new Map<number, { fn: Function; due: number; delay: number }>(); let timer = 0, now = 700000;
  const windowListeners: Record<string, Function> = {};
  const context: any = { document: { getElementById: el, createElement: () => new Element() }, location: { hash, reload: jest.fn(), assign: jest.fn() },
    performance: { now: () => now }, Headers, Response, Blob, URL, AbortSignal, fetch,
    MediaStream: Stream, MediaRecorder: Recorder, mockFal: { realtime: { open } },
    setTimeout: (fn: Function, delay: number) => { timers.set(++timer, { fn, due: now + delay, delay }); return timer; }, clearTimeout: (id: number) => timers.delete(id),
    requestAnimationFrame: (fn: Function) => { windowListeners.animation = fn; }, addEventListener: (name: string, listener: Function) => { windowListeners[name] = listener; } };
  context.window = context; new Script(bundle).runInContext(createContext(context));
  return { el, sent, requests, open, captures, recorders, canvasStream, state, context, Stream, Track, timers, saved, windowListeners,
    start: async () => { await flush(); await el("start").onclick!(); await flush();
      if (callbacks && autoConfirmResolution && requestedChunkSeconds === undefined) {
        callbacks.onData(JSON.stringify({type:"configured",resolution:"480p"})); await flush();
      } },
    simulation: async () => { await flush(); await el("text-start").onclick!(); await flush(); },
    data: async (message: unknown) => { callbacks.onData(JSON.stringify(message)); await flush(); },
    connectionError: async () => { callbacks.onError(new Error("Fixture peer closed")); await flush(); },
    paint: async (seconds: number) => { el("source").currentTime = seconds; windowListeners.animation(); await flush(); },
    media: async () => { const stream = new Stream([new Track("video"), new Track("audio")]); callbacks.onMedia(stream); el("source").listeners.playing(); await flush(); return stream; },
    deferNext: () => { deferNext = true; }, resolveNext: () => nextResolve!(Response.json({ segment: segment(3) })),
    nextResult: (result: unknown) => { nextResult = result; },
    stop: async () => { await el("stop").onclick!(); await flush(); }, setNow: (value: number) => { now = value; },
    poll: async () => { const entry = [...timers].find(([, item]) => item.fn.name === "poll"); if (!entry) throw new Error("No polling timer"); timers.delete(entry[0]); await entry[1].fn(); await flush(); },
    advance: async (ms: number) => { const target = now + ms; for (let n = 0; n < 4000; n++) {
      const entry = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) { now = target; return; } now = entry[1].due; timers.delete(entry[0]); await entry[1].fn(); await flush();
    } throw new Error("Fixture timer overflow"); },
    input: (id: string, value: string) => { el(id).value = value; el(id).listeners[id === "contact-relationship" || id === "duration" ? "change" : "input"]?.(); },
    saveContact: async () => { await el("contact-form").onsubmit!({ preventDefault() {} }); await flush(); },
    rejectContact: () => { rejectContact = true; },
    reset: async () => { await el("reset").onclick!(); await flush(); },
    rejectReset: () => { rejectReset = true; }, resetUrl: (url: string) => { resetUrl = url; },
    rejectHeartbeat: () => { rejectHeartbeat = true; }, failChunks: (count: number) => { failChunkCount = count; },
    failPresentation: () => { failPresentation = true; },
    badCursor: () => { badCursor = true; },
    rejectFinish: (kind: string) => { rejectFinish = kind; }, holdChunks: () => { holdChunks = true; },
    releaseChunks: () => { holdChunks = false; for (const release of pendingChunks.splice(0)) release(); },
    deferState: () => { deferState = true; }, resolveState: () => stateResolve!(),
    deferContact: () => { deferContact = true; }, resolveContact: () => contactResolve!(),
    sendText: async () => { el("message").value = "Can you hear me?"; await el("message-form").onsubmit!({ preventDefault() {} }); await flush(); } };
}

test("live playback sends bounded chunk deltas and actual media time, never an invented source frontier", async () => {
  const h = harness(); await h.start(); await h.media();
  await h.data({ type: "chunk", chunk_index: 0, playback_seconds: 10.125, prompt_version: 1 });
  h.el("source").currentTime = 2; await h.poll();
  const first = h.requests.filter(r => r.path === "/presentation").at(-1)!;
  expect(first.body).toEqual({ playbackSeconds: 2, chunks: [{ chunk_index: 0, playback_seconds: 10.125, prompt_version: 1 }] });
  h.el("source").currentTime = 3; await h.poll();
  expect(h.requests.filter(r => r.path === "/presentation").at(-1)!.body).toEqual({ playbackSeconds: 3, chunks: [] });
  h.failPresentation(); await h.poll();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("presentation-receipt-failure");
  expect(h.el("error").textContent).toContain("missing words or actions");
});

test("prompt inspector captures exact configure and append payloads without sending any extra H3 directions", async () => {
  const h = harness({ scriptQueue: true }); await h.start();
  await h.data({ type: "prompt_applied", script_beats: 1, prompt_version: 1 });
  const log = h.requests.filter(r => r.path === "/prompts" && r.body).map(r => r.body);
  expect(log.map(entry => entry.message)).toEqual(h.sent.filter(message => ["configure", "prompt"].includes(message.type)));
  expect(log).toHaveLength(2); expect(log.map(entry => entry.id)).toEqual([1, 2]);
  expect(log.every(entry => Number.isFinite(entry.atMs))).toBe(true);
  expect(JSON.stringify(log)).not.toContain("not-a-real-key-local-test-token");
  h.el("prompt-inspector").open = true; h.el("prompt-inspector").listeners.toggle(); await flush();
  h.el("prompt-full").listeners.click();
  expect(h.el("prompt-body").textContent).toContain('"script_mode": "append"');
  expect(h.el("prompt-body").textContent).toContain("not proof of provider admission");
});

test("simulation-only mode does not claim to send renderer prompts", async () => {
  const h = harness(); await h.simulation();
  expect(h.sent).toHaveLength(0);
  expect(h.requests.filter(r => r.path === "/prompts" && r.body)).toHaveLength(0);
  expect(h.el("prompt-body").textContent).toContain("No H3 prompts prepared yet");
});

test("failed prompt-log persistence preserves the browser export without stopping or retrying H3", async () => {
  const h = harness({ promptLogStatus: 500 }); await h.start();
  expect(h.sent.filter(message => message.type === "configure")).toHaveLength(1);
  expect(h.requests.some(request => request.path === "/stop")).toBe(false);
  expect(h.el("prompt-status").textContent).toContain("could not be saved");
  h.el("prompt-full").listeners.click();
  expect(h.el("prompt-body").textContent).toContain('"type": "configure"');
  h.el("prompt-json").listeners.click(); expect(h.el("prompt-json").href).toMatch(/^blob:/);
});

test("the home link preserves the private fragment while state requests authenticate only by header", async () => {
  const h = harness(); await flush();
  expect(h.el("home").href).toBe("/#not-a-real-key-local-test-token");
  expect(h.requests[0].headers["x-argos-token"]).toBe("not-a-real-key-local-test-token");
  expect(h.requests[0].path).toBe("/state?afterFrame=0&limit=200");
});

test("sent bubble stays dim until the displayed scene delivers it; future replies stay hidden", async () => {
  const h=harness();await h.start();await h.media();
  await h.data({ type: "chunk", chunk_index: 0, playback_seconds: 10.125, prompt_version: 1 });
  const incoming={id:1,direction:"in",text:"Hello Elaine",status:"read",createdMs:5000,deliveredMs:5200,readMs:8000,replyTo:-1};
  const reply={...incoming,id:2,direction:"out",text:"Hello back",status:"delivered",createdMs:9000};
  h.state.latest={...h.state.latest,atSimMs:10000,phone:[incoming,reply]};await h.poll();
  const pending=h.el("chat").children as Array<{className:string;children:Array<{textContent:string}>}>;
  expect(pending).toHaveLength(1);expect(pending[0].className).toContain("pending");
  expect(pending[0].children.at(-1)?.textContent).toContain("ARRIVING IN SCENE");
  h.state.frames.push({...h.state.latest,atSimMs:5500,phone:[{...incoming,status:"delivered",readMs:-1}]});
  h.el("source").currentTime=6;await h.poll();
  // This legacy fixture has no explicit source map: 6s of a 10.125s
  // opening still maps before the 5.5s delivery frame in its 8.5s source.
  expect((h.el("chat").children as typeof pending)[0].className).toContain("pending");
  h.el("source").currentTime=7;await h.poll();
  const delivered=h.el("chat").children as typeof pending;
  expect(delivered).toHaveLength(1);expect(delivered[0].className).not.toContain("pending");
  expect(delivered[0].children.at(-1)?.textContent).toContain("DELIVERED");
});
test("new episode is unavailable until saving finishes, then navigates once without allocating H3", async () => {
  const h = harness(); await flush();
  expect(h.el("reset").hidden).toBe(false); expect(h.el("reset").disabled).toBe(true);
  await h.reset(); expect(h.requests.some(r => r.path === "/reset")).toBe(false);
  await h.simulation(); await h.reset(); expect(h.requests.some(r => r.path === "/reset")).toBe(false);
  await h.stop(); expect(h.el("reset").disabled).toBe(false);
  await Promise.all([h.reset(), h.reset()]);
  expect(h.requests.filter(r => r.path === "/reset")).toHaveLength(1);
  expect(h.context.location.assign).toHaveBeenCalledWith(`http://127.0.0.1:3470/#${"b".repeat(48)}`);
  expect(h.open).not.toHaveBeenCalled(); expect(h.context.argosSitcom.stopped).toBe(true);
});
test("new episode cannot navigate away while video chunks are still being saved", async () => {
  const h = harness(); await h.start(); await h.media(); h.holdChunks();
  const saving = h.stop(); await flush();
  expect(h.el("reset").disabled).toBe(true); await h.reset();
  expect(h.requests.some(r => r.path === "/reset")).toBe(false);
  h.releaseChunks(); await saving; expect(h.el("reset").disabled).toBe(false);
});
test("replays can reset, while a startup error leaves the existing replay and downloads intact", async () => {
  const h = harness({ replay: true }); await flush();
  expect(h.el("reset").disabled).toBe(false); const source = h.el("source").src;
  h.rejectReset(); await h.reset();
  expect(h.el("reset").disabled).toBe(false); expect(h.context.location.assign).not.toHaveBeenCalled();
  expect(h.el("error").textContent).toContain("503"); expect(h.el("source").src).toBe(source);
  expect(h.el("download-raw").hidden).toBe(false);
});
test("new episode rejects a remote redirect and stays hidden for unsupported receivers", async () => {
  const h = harness({ replay: true }); await flush(); h.resetUrl(`https://example.com/#${"b".repeat(48)}`); await h.reset();
  expect(h.context.location.assign).not.toHaveBeenCalled(); expect(h.el("error").textContent).toContain("Invalid new episode link");
  const unsupported = harness(); unsupported.state.resetAvailable = false; await flush(); await unsupported.poll();
  expect(unsupported.el("reset").hidden).toBe(true); await unsupported.reset();
  expect(unsupported.requests.some(r => r.path === "/reset")).toBe(false);
});

test("a missing fragment shows actionable access recovery without polling or allowing a session start", async () => {
  const h = harness({ hash: "" }); await flush(); await h.advance(5000);
  expect(h.requests).toHaveLength(0);
  expect(h.el("error").textContent).toContain("full private demo link");
  expect(h.el("mode").textContent).toBe("ACCESS REQUIRED");
  expect(h.el("start").disabled).toBe(true); expect(h.el("text-start").disabled).toBe(true);
  await h.start(); await h.simulation(); expect(h.requests).toHaveLength(0); expect(h.open).not.toHaveBeenCalled();
  h.context.location.hash = "#corrected-session-token"; h.windowListeners.hashchange();
  expect(h.context.location.reload).toHaveBeenCalledTimes(1);
});

test.each([401, 403])("a rejected state token (%i) stops retrying and never starts paid rendering", async stateStatus => {
  const h = harness({ stateStatus }); await flush(); await h.advance(5000);
  expect(h.requests).toHaveLength(1); expect(h.open).not.toHaveBeenCalled();
  expect(h.el("error").textContent).toContain("another server or session will not work");
  expect(h.el("error").textContent).not.toContain("not-a-real-key-local-test-token");
  expect(h.el("contact-save").disabled).toBe(true);
});

test("changing the fragment during an active episode does not reload or swap its capability", async () => {
  const h = harness(); await h.simulation(); h.context.location.hash = "#different-session"; h.windowListeners.hashchange();
  expect(h.context.location.reload).not.toHaveBeenCalled(); await h.poll();
  expect(h.requests.at(-1)?.headers["x-argos-token"]).toBe("not-a-real-key-local-test-token");
});

test("actual browser entrypoint sends no next interval on applied, only on represented gap-free chunk", async () => {
  const h = harness(); await h.start(); expect(h.sent).toHaveLength(1); expect(h.sent[0].type).toBe("configure");
  expect(h.sent[0]).not.toHaveProperty("chunk_duration");
  await h.data({ type: "prompt_applied", prompt_version: 1 }); expect(h.requests.filter(r => r.path === "/next")).toHaveLength(0);
  await h.data({ type: "chunk", chunk_index: 1, prompt_version: 1, playback_seconds: 8.5 }); expect(h.sent).toHaveLength(1);
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  expect(h.sent[1]).toMatchObject({ type: "prompt", prompt_version: 2 });
});
test.each([undefined, "768p"])("missing/mismatched resolution confirmation %s stops the receiver", async resolution => {
  const h = harness({ autoConfirmResolution: false }); await h.start();
  await h.data({ type: "configured", ...(resolution ? { resolution } : {}) });
  expect(h.requests.some(r => r.path === "/stop" && r.body.reason === "resolution-not-confirmed")).toBe(true);
});
test("a chunk cannot advance playback before resolution confirmation", async () => {
  const h = harness({ autoConfirmResolution: false }); await h.start();
  await h.data({type:"chunk",chunk_index:0,prompt_version:1,playback_seconds:10.125});
  expect(h.requests.some(r => r.path === "/stop" && r.body.reason === "prompt-contract-mismatch")).toBe(true);
});

test("calibrated direct pipeline confirms ten, sends plain replans once and rejects drift", async () => {
  const h = harness({ requestedChunkSeconds: 10 }); await h.start();
  expect(h.sent[0].chunk_duration).toBe(10);
  await h.data({type:"configured",chunk_duration:10,resolution:"480p"});
  await h.data({type:"prompt_applied",prompt_version:1}); expect(h.sent).toHaveLength(1);
  await h.data({type:"chunk",chunk_index:0,prompt_version:1,playback_seconds:10.125});
  expect(h.sent[1]).toEqual({type:"prompt",prompt_version:2,prompt:"Public committed scene",replan:true});
  await h.data({type:"chunk",chunk_index:0,prompt_version:1,playback_seconds:10.125}); expect(h.sent).toHaveLength(2);
  await h.data({type:"chunk",chunk_index:1,prompt_version:2,playback_seconds:10});
  expect(h.requests.some(r=>r.path==="/stop"&&r.body.reason==="prompt-contract-mismatch")).toBe(true);
  expect(h.sent.filter(m=>m.type==="prompt")).toHaveLength(1);
});
test("native script admission queues one successor without pretending either script has been depicted", async () => {
  const h = harness({ scriptQueue: true }); await h.start();
  expect(h.sent[0].script).toEqual([{ offset: 0, prompt: "Public committed scene" }]);
  await h.data({ type: "prompt_applied", prompt_version: 1 }); expect(h.sent).toHaveLength(1);
  await h.data({ type: "prompt_applied", prompt_version: 1, script_beats: 1 });
  expect(h.sent[1]).toEqual({ type: "prompt", prompt_version: 2, script_mode: "append", script: [{ offset: 0, prompt: "Public committed scene" }] });
  expect(h.requests.filter(r => r.path === "/next").at(-1)?.body).toEqual({ settledVersion: 0, admittedVersion: 1 });
  expect(h.context.argosSitcom.chunks).toEqual([]);
  await h.data({ type: "prompt_applied", prompt_version: 2, script_beats: 1, script_mode: "append" });
  await h.poll(); expect(h.sent).toHaveLength(2); // Two outstanding, no third speculative scene.
  await h.data({ type: "chunk", chunk_index: 1, prompt_version: 2, script_version: 2, playback_seconds: 10 });
  expect(h.sent).toHaveLength(2); // Out-of-order metadata cannot release the queue.
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, script_version: 1, playback_seconds: 10.125 });
  expect(h.sent[2]).toMatchObject({ prompt_version: 3, script_mode: "append" });
  expect(h.requests.filter(r => r.path === "/next").at(-1)?.body).toEqual({ settledVersion: 2, admittedVersion: 2 });
});
test("EJity7 deadline ordering: successor is queued before the slow current chunk completes", async () => {
  const h = harness({ scriptQueue: true }); await h.start(); await h.media();
  for (let version = 1; version <= 6; version++) {
    await h.data({ type: "prompt_applied", prompt_version: version, script_beats: 1,
      ...(version > 1 ? { script_mode: "append" } : {}) });
    expect(h.sent.at(-1)).toMatchObject({ prompt_version: version + 1, script_mode: "append" });
    await h.data({ type: "chunk", chunk_index: version - 1, prompt_version: 1,
      script_version: version, playback_seconds: 10 });
  }
  // The old run waited for chunk 6/version 7 at 77.376s before sending v8.
  // Admission now releases its successor while generation is still underway.
  await h.data({ type: "prompt_pending", prompt_version: 7 });
  expect(h.sent.at(-1).prompt_version).toBe(7);
  await h.data({ type: "prompt_applied", prompt_version: 7, script_beats: 1, script_mode: "append" });
  expect(h.sent.at(-1)).toMatchObject({ prompt_version: 8, script_mode: "append" });
  expect(h.requests.filter(r => r.path === "/next").at(-1)?.body).toEqual({ settledVersion: 6, admittedVersion: 7 });
  expect(h.context.argosSitcom.chunks.map((c: any) => c.prompt_version)).toEqual([1,2,3,4,5,6]);
  await h.data({ type: "prompt_pending", prompt_version: 8 });
  await h.data({ type: "deadline_missed", chunk_index: 6, late_by_seconds: 1.046 });
  await h.data({ type: "chunk", chunk_index: 6, prompt_version: 1, script_version: 7, playback_seconds: 10 });
  expect(h.sent.at(-1).prompt_version).toBe(8); // pending is not admission
  expect(h.context.argosSitcom.chunks.at(-1).prompt_version).toBe(7);
  await h.data({ type: "prompt_applied", prompt_version: 8, script_beats: 1, script_mode: "append" });
  expect(h.sent.at(-1)).toMatchObject({ prompt_version: 9, script_mode: "append" });
  expect(h.context.argosSitcom.chunks.at(-1).prompt_version).toBe(7); // no invented phone scene
  await h.data({ type: "chunk", chunk_index: 7, prompt_version: 1, script_version: 8, playback_seconds: 10 });
  expect(h.context.argosSitcom.chunks.map((c: any) => c.prompt_version)).toEqual([1,2,3,4,5,6,7,8]);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.stop();
});
test("explicit five-second experiment sends the knob and stops if the provider confirms ten", async () => {
  const h = harness({ scriptQueue: true, requestedChunkSeconds: 5 }); await h.start();
  expect(h.sent[0].chunk_duration).toBe(5);
  await h.data({ type: "configured", chunk_duration: 10, resolution: "480p" });
  expect(h.requests.some(r => r.path === "/stop" && r.body.reason === "chunk-duration-not-confirmed")).toBe(true);
  expect(h.sent.filter(m => m.script_mode === "append")).toHaveLength(0);
});
test.each([5, 7, 10])("confirmed %is media maps with its issued identity", async duration => {
  const h = harness({ scriptQueue: true, requestedChunkSeconds: duration }); await h.start();
  await h.data({ type: "configured", chunk_duration: duration, resolution: "480p" });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, script_version: 1, playback_seconds: duration });
  expect(h.context.argosSitcom.chunks).toEqual([{ chunk_index: 0, prompt_version: 1, playback_seconds: duration }]);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
});
test("ending a source does not cancel the last admitted but still unrepresented script", async () => {
  const h = harness({ scriptQueue: true }); await h.start(); await h.media();
  h.nextResult({ ended: true });
  await h.data({ type: "prompt_applied", prompt_version: 1, script_beats: 1 });
  expect(h.sent.some(m => m.type === "stop")).toBe(false);
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, script_version: 1, playback_seconds: 10.125 });
  expect(h.sent.some(m => m.type === "stop")).toBe(false);
  await h.paint(10.125);
  expect(h.sent.at(-1)).toEqual({ type: "stop" });
});
test("queuing a successor does not reset the oldest unrepresented script's timeout", async () => {
  const h = harness({ scriptQueue: true }); await h.start();
  h.setNow(741000);
  await h.data({ type: "prompt_applied", prompt_version: 1, script_beats: 1 });
  expect(h.sent[1].prompt_version).toBe(2);
  h.setNow(745001); await h.poll();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("prompt-chunk-timeout");
});
test("an unissued script identity stops instead of treating admission as depiction", async () => {
  const h = harness({ scriptQueue: true }); await h.start(); await h.media();
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, script_version: 2, playback_seconds: 10.125 });
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("script-contract-mismatch");
  expect(h.context.argosSitcom.chunks).toEqual([]);
  expect(h.requests.find(r => r.path === "/playback")?.body.telemetry).toContainEqual(expect.objectContaining({
    type: "provider_chunk", version: 1, scriptVersion: 2,
  }));
});
test("rIUQMi: queued script2 uses its own identity while the premise remains at prompt1", async () => {
  const h = harness({ scriptQueue: true }); await h.start(); await h.media();
  await h.data({ type: "prompt_applied", prompt_version: 1, script_beats: 1 });
  await h.data({ type: "prompt_applied", prompt_version: 2, script_beats: 1, script_mode: "append" });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, script_version: 1, script_offset_seconds: 0, playback_seconds: 10 });
  await h.data({ type: "chunk", chunk_index: 1, prompt_version: 1, script_version: 2, script_offset_seconds: 0, playback_seconds: 10 });
  expect(h.context.argosSitcom.chunks.map((c: any) => c.prompt_version)).toEqual([1, 2]);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.stop();
  const saved = h.requests.find(r => r.path === "/playback")?.body;
  expect(saved.chunks.map((c: any) => c.version)).toEqual([1, 2]);
  expect(saved.telemetry).toContainEqual(expect.objectContaining({ type: "provider_chunk", version: 1, scriptVersion: 2, chunkIndex: 1 }));
});
test("a rejected queued script fails closed without retrying it as a replacement", async () => {
  const h = harness({ scriptQueue: true }); await h.start(); await h.media();
  await h.data({ type: "prompt_applied", prompt_version: 1, script_beats: 1 });
  await h.data({ type: "prompt_rejected", prompt_version: 2, reason: "queue_full" });
  expect(h.sent.at(-1)).toEqual({ type: "stop" });
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("provider-prompt_rejected");
  expect(h.sent.filter(m => m.type === "prompt")).toHaveLength(1);
});
test("a source failure immediately stops generation, saves, and preserves its cause in playback telemetry", async () => {
  const h = harness(); await h.start(); await h.media();
  h.nextResult({ ended: true, reason: "capture_failed", detail: "Source boundary mismatch" });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  expect(h.sent).toEqual(expect.arrayContaining([{ type: "stop" }]));
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("renderer-source-failure");
  expect(h.el("error").textContent).toContain("capture_failed");
  expect(h.requests.find(r => r.path === "/playback")?.body.telemetry).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "renderer_source_failed", reason: "capture_failed: Source boundary mismatch" })]));
});
test("normal source completion waits for playback, not final chunk metadata, before closing WebRTC", async () => {
  const h = harness(); await h.start(); await h.media(); h.nextResult({ ended: true });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  expect(h.sent.some(m => m.type === "stop")).toBe(false);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.paint(9);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.paint(10.125);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("committed-source-drained");
  expect(h.requests.find(r => r.path === "/playback")?.body.recordingEnd).toBe(10.125);
});
test("a peer error during final drain retains evidence and permits buffered playback", async () => {
  const h = harness(); await h.start(); await h.media(); h.nextResult({ ended: true });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  await h.connectionError();
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.paint(10.125);
  expect(h.requests.find(r => r.path === "/playback")?.body.telemetry).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "connection_error_during_drain" })]));
});
test("a sealed real-time remainder drains received media and explicitly reports unfilmed coverage", async () => {
  const h = harness(); await h.start(); await h.media();
  const tail = { reason: "incomplete_realtime_tail", sourceStartSimMs: 10125, sourceEndSimMs: 18000, evidence: [4] };
  h.nextResult({ ended: true, unfilmedTail: tail });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  expect(h.sent.filter(m => m.type === "prompt")).toHaveLength(0);
  await h.paint(9);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.paint(10.125);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("committed-source-drained");
  const playback = h.requests.find(r => r.path === "/playback")!.body;
  expect(playback.recordingEnd).toBe(10.125);
  expect(playback.telemetry).toEqual(expect.arrayContaining([expect.objectContaining({
    type: "source_tail_unfilmed", sourceMs: 10125, unfilmedEndMs: 18000 })]));
  expect(h.el("connection").textContent).toContain("7.875s of final world time saved but not filmed");
});
test("a stalled final drain ends boundedly as partial, never complete coverage", async () => {
  const h = harness(); await h.start(); await h.media(); h.nextResult({ ended: true });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  await h.connectionError(); await h.advance(15126);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("final-playback-timeout");
  expect(h.requests.find(r => r.path === "/playback")?.body.recordingEnd).toBe(0);
});
test("extra repeat metadata cannot extend the frozen final playback target", async () => {
  const h = harness(); await h.start(); await h.media(); h.nextResult({ ended: true });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  await h.data({ type: "chunk", chunk_index: 1, prompt_version: 1, playback_seconds: 8.5 });
  await h.poll();
  expect(h.requests.filter(r=>r.path==="/presentation").flatMap(r=>r.body.chunks)
    .every(c=>c.chunk_index===0)).toBe(true);
  await h.paint(10.125);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("committed-source-drained");
  const saved = h.requests.find(r => r.path === "/playback")?.body;
  expect(saved.chunks).toHaveLength(2);
  expect(saved.recordingEnd).toBe(10.125);
  expect(saved.telemetry).toEqual(expect.arrayContaining([expect.objectContaining({type:"provider_chunk",chunkIndex:1})]));
});
test("the original spending deadline still wins over a final media drain", async () => {
  const h = harness({ defaultSeconds: 10 }); await h.start(); await h.media();
  await h.advance(9000); h.nextResult({ ended: true });
  await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  await h.advance(1001);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("session-duration-limit");
});
test("provider error text is shown, not silently replaced with a generic message", async () => {
  const h = harness(); await h.start(); await h.data({ type: "error", error: "Exact provider diagnostic", code: "generation_failed" });
  expect(h.el("error").textContent).toContain("Exact provider diagnostic");
});
test("a late next response after stop is discarded and 204 saves are successful", async () => {
  const h = harness(); await h.start(); await h.data({ type: "chunk", chunk_index: 0, prompt_version: 1, playback_seconds: 10.125 });
  h.deferNext(); await h.data({ type: "chunk", chunk_index: 1, prompt_version: 2, playback_seconds: 8.5 });
  await h.stop(); h.resolveNext(); await flush();
  expect(h.sent.filter(m => m.type === "prompt").map(m => m.prompt_version)).toEqual([2]);
  expect(h.context.argosSitcom.stopped).toBe(true); expect(h.el("connection").textContent).not.toContain("incomplete");
  const playback = h.requests.find(r => r.path === "/playback")!.body;
  expect(playback.telemetry.every((row: any) => row.atMs < 600000)).toBe(true);
});
test("raw and UI composition use separate track streams and persist separately without paid requests", async () => {
  const h = harness(); await h.start(); const provider = await h.media();
  expect(h.captures).toHaveLength(2); expect(h.captures[0]).not.toBe(provider); expect(h.captures[0]).not.toBe(h.canvasStream);
  expect(h.captures[0].getTracks().every(t => t.cloned)).toBe(true); expect(h.captures[1]).toBe(h.canvasStream);
  await h.stop(); expect(h.requests.filter(r => r.path.endsWith("/finish"))).toHaveLength(2);
  expect(h.el("download-raw").hidden).toBe(false); expect(h.el("download-composition").hidden).toBe(false);
  expect(h.context.argosSitcom.recording.path).toBe("raw.webm"); expect(h.context.argosSitcom.composition.path).toBe("composition.webm");
});
test("saved replay opens authenticated media but cannot allocate another H3 session", async () => {
  const h = harness({ replay: true }); await flush();
  expect(h.open).not.toHaveBeenCalled(); expect(h.requests.some(r => r.path === "/start")).toBe(false);
  expect(h.requests.some(r => r.path === "/recordings/status")).toBe(true); expect(h.context.argosSitcom.status).toBe("replay");
  expect(h.requests.some(r => r.path.startsWith("/media/"))).toBe(false);
  expect(h.el("source").src).toBe("/recordings/raw/media?cap=fixture-media-capability");
  expect(h.el("download-raw").hidden).toBe(false);
});

test("contact identity can be explicitly applied before a run and changed during a run without renaming Elaine", async () => {
  const h = harness(); await flush(); expect(h.el("contact-name").value).toBe("Unknown sender");
  expect(h.el("session-limit").textContent).toBe("10-minute session · saves video and world");
  expect(h.el("contact-save").disabled).toBe(true);
  h.input("contact-name", "Alex"); h.input("contact-relationship", "boyfriend"); h.input("contact-context", "Dinner at eight.");
  expect(h.requests.some(r => r.path === "/contact")).toBe(false); expect(h.el("contact-status").textContent).toContain("Unapplied");
  await h.saveContact();
  expect(h.requests.find(r => r.path === "/contact")?.body).toEqual({ name: "Alex", relationship: "boyfriend", context: "Dinner at eight." });
  expect(h.el("contact-current").textContent).toBe("Alex · boyfriend"); expect(h.el("contact-status").textContent).toContain("Applied");
  expect(h.el("actor").value).toBe("Elaine"); expect(h.open).not.toHaveBeenCalled();
  await h.start(); h.input("contact-name", "Mr. Lippman"); h.input("contact-relationship", "boss"); await h.saveContact();
  expect(h.el("contact-current").textContent).toBe("Mr. Lippman · boss");
});

test("polling preserves an unapplied draft, and failed contact saves do not relabel the current contact", async () => {
  const h = harness(); await flush(); h.input("contact-name", "Draft name"); h.input("contact-relationship", "friend");
  await h.poll(); expect(h.el("contact-name").value).toBe("Draft name"); expect(h.el("contact-current").textContent).toBe("Unknown sender");
  h.rejectContact(); await h.saveContact(); expect(h.el("contact-status").textContent).toContain("not applied");
  expect(h.el("contact-name").value).toBe("Draft name"); expect(h.el("contact-current").textContent).toBe("Unknown sender");
  expect(h.el("contact-save").disabled).toBe(false);
});

test("custom relationships require a valid bounded value; stopped replays cannot change identity", async () => {
  const h = harness(); await flush(); h.input("contact-name", "Pat"); h.input("contact-relationship", "custom");
  expect(h.el("contact-custom-field").hidden).toBe(false); expect(h.el("contact-save").disabled).toBe(true);
  await h.saveContact(); expect(h.requests.some(r => r.path === "/contact")).toBe(false);
  h.input("contact-custom", "Former bandmate"); await h.saveContact(); expect(h.el("contact-current").textContent).toBe("Pat · Former bandmate");
  h.input("contact-custom", "x".repeat(41)); await h.saveContact(); expect(h.requests.filter(r => r.path === "/contact")).toHaveLength(1);
  const replay = harness({ replay: true }); await flush(); replay.input("contact-name", "Changed"); await replay.saveContact();
  expect(replay.el("contact-name").disabled).toBe(true); expect(replay.requests.some(r => r.path === "/contact")).toBe(false);
});

test("actual chat labels retain each message contact literally and never switch history to the edited profile", async () => {
  const h = harness(); await flush();
  const first = { name: "Alex", relationship: "friend", context: "" }, second = { name: "<img src=x onerror=alert(1)>", relationship: "police", context: "" };
  const message = (id: number, direction: string, contact?: typeof first) => ({ id, direction, contact, text: "A literal text", status: "delivered", createdMs: id, readMs: -1, deliveredMs: id, replyTo: -1 });
  h.state.latest.contact = second; h.state.latest.phone = [message(1, "in", first), message(2, "out", first), message(3, "in", second), message(4, "in")];
  await h.poll();
  const labels = h.el("chat").children.map((bubble: any) => bubble.children[0]);
  expect(labels.map((label: any) => label.textContent)).toEqual(["Alex · friend → Elaine", "Elaine → Alex · friend", "<img src=x onerror=alert(1)> · police → Elaine", "Unknown sender → Elaine"]);
  expect(labels.every((label: any) => label.children.length === 0)).toBe(true);
});

test("a pre-save state response cannot roll back an applied contact, and starting is blocked during save", async () => {
  const h = harness(); await flush(); h.deferState(); const pendingPoll = h.poll(); await flush();
  h.input("contact-name", "Alex"); h.input("contact-relationship", "partner"); h.deferContact(); const pendingSave = h.saveContact(); await flush();
  expect(h.el("start").disabled).toBe(true); expect(h.el("text-start").disabled).toBe(true);
  await h.el("start").onclick!(); expect(h.requests.some(r => r.path === "/start")).toBe(false);
  h.resolveContact(); await pendingSave; expect(h.el("contact-current").textContent).toBe("Alex · partner");
  h.resolveState(); await pendingPoll;
  expect(h.el("contact-current").textContent).toBe("Alex · partner"); expect(h.el("contact-name").value).toBe("Alex");
});

test("the text submit handler cannot race an in-flight contact save", async () => {
  const h = harness(); await h.start(); h.input("contact-name", "Alex"); h.deferContact(); const save = h.saveContact(); await flush();
  expect(h.el("send").disabled).toBe(true); await h.sendText(); expect(h.requests.some(r => r.path === "/control")).toBe(false);
  h.resolveContact(); await save; expect(h.el("send").disabled).toBe(false);
  await h.sendText(); expect(h.requests.some(r => r.path === "/control")).toBe(true);
});

test("extended presets reach the real start call, survive 120 seconds, and keep a viewer lease", async () => {
  const h = harness(); await flush(); h.input("duration", "1800"); await h.simulation();
  expect(h.requests.find(r => r.path === "/start")?.body).toEqual({ render: false, seconds: 1800 });
  expect(h.el("duration").disabled).toBe(true); expect(h.open).not.toHaveBeenCalled();
  await h.advance(121000);
  expect(h.requests.filter(r => r.path === "/heartbeat")).toHaveLength(12);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  expect(h.el("session-limit").textContent).toContain("30-minute session");
  expect([...h.timers.values()].some(t => t.delay === 1679000)).toBe(true);
  await h.stop();
});

test("provider unknown or larger limits never increase the selected budget; a lower actual limit clamps it", async () => {
  const h = harness(); await h.start(); await h.media();
  await h.data({ type: "session_info", max_session_seconds: null });
  expect(h.context.argosSitcom.state.maxSessionSeconds).toBe(600);
  await h.data({ type: "session_info", max_session_seconds: 1800 });
  expect(h.context.argosSitcom.state.maxSessionSeconds).toBe(600);
  await h.advance(1000);
  await h.data({ type: "session_info", max_session_seconds: 300 });
  expect(h.context.argosSitcom.state.maxSessionSeconds).toBe(300);
  expect(h.el("session-limit").textContent).toContain("5-minute session · provider-limited");
  expect([...h.timers.values()].some(t => t.delay === 299000)).toBe(true);
  await h.data({ type: "session_info", max_session_seconds: null });
  expect(h.context.argosSitcom.state.maxSessionSeconds).toBe(300);
  expect(h.requests.filter(r => r.path === "/session-info").map(r => r.body.maxSessionSeconds)).toEqual([null, 1800, 300, null]);
  expect(h.sent[0]).not.toHaveProperty("duration"); expect(h.sent[0]).not.toHaveProperty("max_session_seconds");
  await h.stop();
});

test("an actual lower provider deadline stops media, not just a UI label", async () => {
  const h = harness(); await h.start(); await h.media();
  await h.data({ type: "session_info", max_session_seconds: 2 });
  await h.advance(2000);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("session-duration-limit");
  expect(h.context.argosSitcom.stopped).toBe(true);
});

test("paged frame history drains immediately and subsequent polls do not duplicate same-time captures", async () => {
  const h = harness(); h.state.frames = Array.from({ length: 451 }, (_, i) => ({ ...h.state.latest, atSimMs: Math.floor(i / 2) * 250 }));
  await flush(); await h.poll();
  const reads = h.requests.filter(r => r.path.startsWith("/state?"));
  expect(reads.some(r => r.path === "/state?afterFrame=201&limit=200")).toBe(true);
  expect(reads.some(r => r.path === "/state?afterFrame=401&limit=200")).toBe(true);
  expect(h.context.argosSitcom.state.frames).toHaveLength(451);
  await h.poll(); expect(h.context.argosSitcom.state.frames).toHaveLength(451);
  h.state.frames.push({ ...h.state.latest, atSimMs: 60000 }); await h.poll();
  expect(h.context.argosSitcom.state.frames).toHaveLength(452);
  expect(h.context.argosSitcom.state.frames.at(-1).atSimMs).toBe(60000);
});

test("recordings are prepared before allocation and upload each part before Stop without a whole-video Blob", async () => {
  const h = harness(); await h.start(); await h.media();
  expect(h.requests.filter(r => r.path.endsWith("/start")).map(r => r.path)).toEqual(["/start", "/recordings/raw/start", "/recordings/composition/start"]);
  const part = new Blob(["first-media-part"]); h.recorders[0].ondataavailable!({ data: part }); await flush();
  expect(h.requests.find(r => r.path === "/recordings/raw/chunks/0")?.body).toBe(part);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false);
  await h.stop();
  expect(h.requests.find(r => r.path === "/recordings/raw/finish")?.body).toEqual({ chunks: 2 });
  expect(h.requests.some(r => r.path === "/recording" || r.path === "/composition")).toBe(false);
  expect(h.el("source").src).toBe("/recordings/raw/media?cap=fixture-media-capability");
  // The media path must stay streamed. The separate inspector may create small
  // text/JSON download blobs; it never receives recording bytes.
  expect(clientSource).not.toMatch(/new Blob\(/); expect(clientSource).not.toContain("createObjectURL");
});

test("an uncertain chunk retries once with exactly the same index and Blob", async () => {
  const h = harness(); await h.start(); await h.media(); h.failChunks(1);
  const part = new Blob(["same-part"]); h.recorders[0].ondataavailable!({ data: part }); await flush();
  const chunks = h.requests.filter(r => r.path === "/recordings/raw/chunks/0");
  expect(chunks).toHaveLength(2); expect(chunks.every(r => r.body === part)).toBe(true);
  expect(h.requests.some(r => r.path === "/stop")).toBe(false); await h.stop();
});

test("two failed chunk attempts stop the paid run and do not falsely finish that recording", async () => {
  const h = harness(); await h.start(); await h.media(); h.failChunks(2);
  h.recorders[0].ondataavailable!({ data: new Blob(["failed-part"]) }); await flush();
  expect(h.requests.filter(r => r.path === "/recordings/raw/chunks/0")).toHaveLength(2);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("recording-upload-failure");
  expect(h.requests.some(r => r.path === "/recordings/raw/finish")).toBe(false);
  expect(h.requests.some(r => r.path === "/recordings/composition/finish")).toBe(true);
  expect(h.context.argosSitcom.stopped).toBe(true);
});

test("an oversized chunk stops the run before upload instead of buffering an unbounded browser Blob", async () => {
  const h = harness(); await h.start(); await h.media();
  h.recorders[0].ondataavailable!({ data: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) }); await flush();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("recording-upload-failure");
  expect(h.requests.some(r => r.path.startsWith("/recordings/raw/chunks/"))).toBe(false);
});

test("pending media is bounded at 32 MiB, then safely retained as partial while the other recorder finishes", async () => {
  const h = harness(); await h.start(); await h.media(); h.holdChunks();
  const part = new Blob([new Uint8Array(8 * 1024 * 1024)]);
  h.recorders[0].ondataavailable!({ data: part }); await flush();
  for (let i = 0; i < 4; i++) h.recorders[0].ondataavailable!({ data: part });
  await flush(); expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("recording-upload-failure");
  h.releaseChunks(); await flush();
  expect(h.requests.filter(r => r.path.startsWith("/recordings/raw/chunks/"))).toHaveLength(1);
  expect(h.el("recording-recovery").textContent).toContain("raw.webm.part");
  expect(h.context.argosSitcom.composition?.complete).toBe(true);
  expect(h.context.argosSitcom.stopped).toBe(true);
});

test("raw finalization failure does not block composition and identifies retained local recovery media", async () => {
  const h = harness(); await h.start(); await h.media(); h.rejectFinish("raw"); await h.stop();
  expect(h.context.argosSitcom.recording).toBeNull(); expect(h.context.argosSitcom.composition.complete).toBe(true);
  expect(h.el("recording-recovery").hidden).toBe(false); expect(h.el("recording-recovery").textContent).toContain("playability not guaranteed");
  expect(h.el("connection").textContent).toContain("some saves incomplete");
});

test("a failed viewer heartbeat closes H3 and stops future paid work", async () => {
  const h = harness(); await h.start(); await h.media(); h.rejectHeartbeat(); await h.advance(10000);
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("viewer-lease-failure");
  expect(h.sent.some(m => m.type === "stop")).toBe(true);
  expect(h.context.argosSitcom.stopped).toBe(true);
  expect([...h.timers.values()].some(t => t.fn.name === "heartbeat")).toBe(false);
});

test("a server-stopped render run closes the live receiver even without stream_exhausted", async () => {
  const h = harness(); await h.start(); await h.media(); h.state.stopped = true; await h.poll();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("server-stopped");
  expect(h.context.argosSitcom.stopped).toBe(true);
});

test("a malformed history cursor fails closed rather than silently skipping committed frames", async () => {
  const h = harness(); await h.simulation(); h.badCursor(); await h.poll();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("audience-history-failure");
  expect(h.el("error").textContent).toContain("Invalid audience history cursor");
  expect(h.context.argosSitcom.state.frames).toHaveLength(1);
});

test("audience retention fails visibly at its bound instead of evicting earlier replay evidence", async () => {
  const h = harness(); await h.simulation();
  h.state.frames = Array.from({ length: 30001 }, (_, i) => ({ ...h.state.latest, atSimMs: i * 50 }));
  await h.poll();
  expect(h.requests.find(r => r.path === "/stop")?.body.reason).toBe("audience-history-failure");
  expect(h.el("error").textContent).toContain("30,000-frame safety bound");
  expect(h.context.argosSitcom.state.frames[0].atSimMs).toBe(0);
  expect(h.context.argosSitcom.state.frames.length).toBeLessThanOrEqual(30000);
});

test("late provider limits and media cannot restart a stopped receiver", async () => {
  const h = harness(); await h.start(); await h.media(); await h.stop();
  const infoCount = h.requests.filter(r => r.path === "/session-info").length;
  await h.data({ type: "session_info", max_session_seconds: 1800 });
  const late = await h.media();
  expect(late.getTracks().every(t => t.readyState === "ended")).toBe(true);
  expect(h.requests.filter(r => r.path === "/session-info")).toHaveLength(infoCount);
  expect(h.el("source").srcObject).toBeNull();
});

test("the server-configured duration initializes once, including bounded values outside the presets", async () => {
  const h = harness({ defaultSeconds: 10 }); await flush();
  expect(h.el("duration").value).toBe("10");
  expect(h.el("duration").children).toContainEqual(expect.objectContaining({ value: "10", textContent: "10 sec (configured)" }));
  expect(h.el("session-limit").textContent).toContain("10-second session");
  h.input("duration", "1200"); await h.poll();
  expect(h.el("duration").value).toBe("1200");
  await h.simulation(); expect(h.requests.find(r => r.path === "/start")?.body.seconds).toBe(1200);
  await h.stop();
});

test("a user duration edit made before the initial state response is not overwritten", async () => {
  const h = harness({ defaultSeconds: 120 }); h.input("duration", "1800"); await flush();
  expect(h.el("duration").value).toBe("1800");
});
