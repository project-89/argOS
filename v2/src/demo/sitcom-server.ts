import express from "express";
import { requestProject89Influence, project89SpiritDiagnostics } from "./project89";
import { narrativeOpportunityStatuses } from "../spirits/narrative-opportunities";
import { build } from "esbuild";
import { timingSafeEqual } from "node:crypto";
import { readFile, writeFile, appendFile, mkdir, readdir, statfs } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { ApartmentSitcom, SITCOM_CHARACTERS } from "./apartment-sitcom";
import { SitcomDirector } from "./sitcom-director";
import { H3_MEDIA_TIMING, validateH3ChunkSeconds, validateH3Memory, sitcomPromptMessage } from "./sitcom-h3-chunk";
import type { H3PromptSend, H3PromptLog } from "./sitcom-prompt-log";
import { evaluateSitcom, type SitcomFrame } from "./sitcom-report";
import { getCommittedEvents, subscribeCommittedEvents } from "../runtime/committed-events";
import { directorConfigure, isDirectorProxyTarget, validateDirectorResolution, type DirectorResolution } from "../rendering/director-projection";
import { installDirectorRecording } from "../rendering/director-recording";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";
import { normalizePhoneContact } from "./phone-contact";
import { installStreamRecordings } from "../rendering/stream-recording";
import { SitcomJournal } from "./sitcom-journal";
import { SITCOM_DURATION, SitcomSessionBudget } from "./sitcom-session";
import { SitcomLivePacer } from "./sitcom-live-pacing";
import { getNativeRuntimeServices } from "../runtime/native-services";
import { getWorldConstructionStatus } from "../runtime/world-construction-budget";
import { getCodingDaemon } from "../engineering/coding-daemon";

const secondsSchema = z.number().int().min(SITCOM_DURATION.min).max(SITCOM_DURATION.max);
const promptSendSchema = z.object({ id: z.number().int().min(1).max(4096),
  atMs: z.number().finite().min(0).max(2000000), message: z.record(z.unknown()) }).strict();
const controlSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("influence"), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("thought"), actor: z.enum(SITCOM_CHARACTERS), text: z.string().trim().min(1).max(300) }).strict(),
]);
const chunkSchema = z.object({ index: z.number().int().min(0).max(1023), start: z.number().finite().min(0).max(2000),
  end: z.number().finite().positive().max(2000), version: z.number().int().positive() }).strict();
const playbackSchema = z.object({ chunks: z.array(chunkSchema).max(1024), recordingStart: z.number().finite().min(0).max(2000),
  recordingEnd: z.number().finite().min(0).max(2000), telemetry: z.array(z.object({ type: z.string().max(80),
    atMs: z.number().finite().min(0).max(2000000), version: z.number().int().positive().optional(),
    sourceMs: z.number().finite().min(0).max(2000000).optional(), reason: z.string().max(300).optional(),
    unfilmedEndMs: z.number().finite().min(0).max(2000000).optional(),
    promptCharacters: z.number().int().min(0).max(50000).optional(),
    chunkIndex: z.number().int().min(0).max(1023).optional(), playbackSeconds: z.number().finite().positive().max(30).optional(),
    bufferDepthSeconds: z.number().finite().min(0).max(2000).optional(),
    generationSeconds: z.number().finite().min(0).max(300).optional(),
    schedulingLeadMs: z.number().finite().min(-2000000).max(2000000).optional(),
    scriptVersion: z.number().int().min(1).max(1024).optional(),
    scriptOffsetSeconds: z.number().int().min(0).max(2000).optional(),
    scriptOriginChunkIndex: z.number().int().min(0).max(1023).optional(),
    scriptQueued: z.number().int().min(0).max(64).optional(),
    resolution: z.enum(["480p", "768p", "1080p"]).optional(),
    width: z.number().int().min(1).max(8192).optional(), height: z.number().int().min(1).max(8192).optional() }).strict()).max(4096).optional() }).strict();

/** A loopback-only, single-session test receiver. Keys never enter audience data.
 * The NPC world starts first; only already-lived windows can be sent to H3. */
export async function createSitcomDemoApp(options: {
  testbed: ApartmentSitcom; directory: string; token: string; seconds?: number; allowVideo?: boolean;
  conversationFraming?: boolean;
  /** Queue one immutable successor. GUI defaults to append; false retains direct diagnostics. */
  scriptQueue?: boolean;
  /** Explicit matched duration experiment; provider confirmation required. */
  h3ChunkSeconds?: number;
  h3Resolution?: DirectorResolution;
  h3Memory?: number;
  newEpisode?: () => Promise<{ url: string }>;
}) {
  const defaultSeconds = secondsSchema.parse(options.seconds ?? SITCOM_DURATION.default), t = options.testbed;
  const requestedResolution = validateDirectorResolution(options.h3Resolution ?? "480p");
  const requestedMemory = validateH3Memory(options.h3Memory ?? 12);
  let seconds = defaultSeconds, budget: SitcomSessionBudget | undefined;
  if (options.token.length < 24) throw new Error("A fresh unguessable session token is required");
  if (options.h3ChunkSeconds !== undefined) {
    validateH3ChunkSeconds(options.h3ChunkSeconds);
    if (!options.scriptQueue && options.h3ChunkSeconds !== 10) throw new Error("Direct H3 is calibrated only at 10 seconds; other durations require native scripts");
  }
  const requestedChunkSeconds = options.h3ChunkSeconds ?? 10;
  const mediaTiming = options.h3ChunkSeconds === undefined || !options.scriptQueue
    ? H3_MEDIA_TIMING[options.scriptQueue ? "script_append" : "chunk_ack"]
    : { openingMediaMs: options.h3ChunkSeconds * 1000, continuationMediaMs: options.h3ChunkSeconds * 1000 };
  const directory = resolve(options.directory), director = new SitcomDirector(t, {
    // Transport does not choose the story's clock or writing style. Append
    // queues committed 1:1 scenes; it must not restore performance compression.
    windowMs: mediaTiming.continuationMediaMs, ...mediaTiming, scheduling: "realtime", promptStyle: "direct",
    conversationFraming: options.conversationFraming,
  });
  const rendererStatus = () => ({ ...director.status(), handoff: options.scriptQueue ? "script_append" : "chunk_ack",
    requestedChunkSeconds: requestedChunkSeconds ?? null, requestedResolution, requestedMemory,
    alignment: "issued-source-map; audiovisual performance unverified" });
  const pacer = new SitcomLivePacer();
  let ownsVideoPause = false;
  const asset = (name: string) => fileURLToPath(new URL(name, import.meta.url));
  const bundle = await build({ entryPoints: [asset("sitcom-client.mjs")], bundle: true, write: false, platform: "browser", format: "esm" });
  await mkdir(directory, { recursive: true });
  const journal = await SitcomJournal.open<SitcomFrame>(directory, { maxFrames: 30_000 });
  let started = false, prepared = false, stopped = false, render = false, ready = false, allocated = false;
  let sample: NodeJS.Timeout | undefined, startupDeadline: NodeJS.Timeout | undefined, playbackDeadline: NodeJS.Timeout | undefined;
  let saving: Promise<void> | undefined, playback: z.infer<typeof playbackSchema> | undefined;
  let issuedConfigure: Record<string, unknown> | undefined;
  const promptSends: H3PromptSend[] = [];
  const influences: Array<{id:string; status:"queued"; recipient:string; text:string; atSimMs:number}> = [];
  let promptLogBytes = 0, promptLogWrites = Promise.resolve();
  let nextEpisode: Promise<{ url: string }> | undefined;
  let compositionSaved = false, stoppedAt = 0, stopReason: string | null = null, storageError: string | null = null;
  let streams: ReturnType<typeof installStreamRecordings> | undefined;
  const network = new AbortController(), frames: SitcomFrame[] = [];
  const telemetry: Array<Record<string, string | number | boolean | null>> = [];
  const audience = (eventLimit = 100) => {
    const snapshot = t.snapshot({ eventLimit });
    return { ...snapshot, sourceId: getCommittedEvents(t.sim.world).sourceId ?? snapshot.sourceId };
  };
  const capture = () => {
    const { events: _events, ...frame } = audience(0);
    frames.push(frame); if (frames.length > 200) frames.shift(); // small current-state tail, not the replay archive
    persist(journal.appendFrame(frame));
  };
  function persist(write: Promise<void>) {
    void write.catch(error => {
      storageError ??= error instanceof Error ? error.message : "World journal failed";
      if (!stopped) void stop("storage_failure").catch(() => {});
    });
  }
  for (const event of t.snapshot().events) persist(journal.appendEvent(event));
  for (const event of getCommittedEvents(t.sim.world).events) persist(journal.appendPublicEvent(event));
  capture();
  const unsubscribe = t.onEvent(event => {
    persist(journal.appendEvent(event));
    if (event.kind === "thought" && ["reasoning", "appraisal"].includes(event.thoughtType ?? "") || ["phone_read", "reply_delivered"].includes(event.kind)) capture();
  });
  const unsubscribePublic = subscribeCommittedEvents(t.sim.world, event => persist(journal.appendPublicEvent(event)));
  const duration = () => ({ durationLimits: { ...SITCOM_DURATION, default: defaultSeconds },
    requestedSessionSeconds: seconds, maxSessionSeconds: budget?.effectiveSeconds ?? seconds,
    providerMaxSessionSeconds: budget?.providerMaxSessionSeconds ?? null });
  const paceSource = () => {
    if (!render || !started || stopped || !t.running) return;
    const pacing = pacer.sample(t.elapsedMs);
    if (pacing.sourcePausedForVideo && !t.sim.paused) { ownsVideoPause = true; t.sim.pause(); }
    else if (!pacing.sourcePausedForVideo && ownsVideoPause) { ownsVideoPause = false; t.sim.resume(); }
  };
  const roomOverview = () => {
    try { return { rooms: t.scenes().map(scene => ({ name: scene.room.name, actors: scene.actors.map(actor => actor.name),
      props: scene.props.map(prop => prop.name) })), roomOverviewError: null }; }
    catch (error) { return { rooms: [], roomOverviewError: error instanceof Error ? error.message : "Room observation failed" }; }
  };
  const state = () => { const latest = audience(); return { started, prepared, stopped, render, ...duration(), stopReason, storageError,
    engine: { model: t.options.live ? MODEL_IDS.flash : null, controller: t.sim.world.meta.cognitionController,
      ...(t.options.scenario === "project89" ? {spirits:project89SpiritDiagnostics(t.sim.world),godAutopilot:t.sim.god.autopilot && {
        lastRunAt:t.sim.god.autopilot.lastRunAt,
        consecutiveFailures:t.sim.god.autopilot.consecutiveFailures,
        lastError:t.sim.god.autopilot.lastError,
        inbox:t.sim.god.autopilot.inbox.map(({id,subject,priority})=>({id,subject,priority})),
      }} : {}),
      narrativeMind: t.sim.world.meta.narrativeMind, experienceReconsideration: t.sim.world.meta.experienceReconsideration,
      services: getNativeRuntimeServices(t.sim.world).map(({ id, enabled }) => ({ id, enabled })),
      cookieHistory: t.options.cookieHistory, openNeighborhood: t.options.openNeighborhood,
      evolution: t.sim.getEvolutionStatus(),
      construction: getWorldConstructionStatus(t.sim.world),
      managedBuilds: (() => { const daemon = getCodingDaemon(t.sim.world)?.getStatus();
        return daemon ? { running: daemon.running, busy: daemon.busy, jobs: daemon.jobs.length, admissionBudget: daemon.admissionBudget } : null; })(),
      ...roomOverview(),
      runtime: (() => { const r = t.sim.getRuntimeStatus(); return r ? { tick: r.tick, slowTicks: r.slowTicks,
        pendingTasks: r.pendingTasks, health: r.fastSystemHealth?.status, lifecycle: r.fastSystemHealth?.lifecycle } : null; })() },
    influences: influences.map(row=>({...row,...narrativeOpportunityStatuses(t.sim.world).find(status=>status.id===row.id)})), videoAvailable: options.allowVideo === true, resetAvailable: Boolean(options.newEpisode), latest, frames,
    segments: director.snapshot(), renderer: rendererStatus(), publicEvents: getCommittedEvents(t.sim.world).events.slice(-100), droppedFrames: 0,
    pacing: render ? pacer.sample(t.elapsedMs) : null,
    journal: journal.snapshot(), recordings: streams?.status() ?? {},
    replay: stopped && playback !== undefined, hasPlayback: playback !== undefined }; };
  async function stop(reason = "operator") {
    if (saving) return saving;
    if (stopped) return; // synchronous callbacks during t.stop cannot initiate a second finalization
    stopped = true; stoppedAt = Date.now(); stopReason = reason;
    clearInterval(sample); clearTimeout(startupDeadline); clearTimeout(playbackDeadline);
    network.abort(); t.stop(); capture(); unsubscribe(); unsubscribePublic(); director.stop();
    const drain = setTimeout(() => { void streams?.closeIncomplete(); }, 120000); drain.unref();
    saving = (async () => {
      try { await journal.close(); } catch (error) { storageError ??= String(error); }
      const snapshot = t.snapshot();
      const save = (name: string, content: string) => writeFile(resolve(directory, name), content, { flag: "wx", mode: 0o600 });
      await Promise.all([
        save("state.json", JSON.stringify(state())), save("result.json", JSON.stringify({ ...evaluateSitcom(t), models: t.options.live ? MODEL_IDS : null,
          renderRequested: render, droppedFrames: 0, limitSeconds: budget?.effectiveSeconds ?? seconds, ...duration(), stopReason, storageError,
          journal: journal.snapshot(), evaluationScope: snapshot.droppedEvents || getCommittedEvents(t.sim.world).gap
            ? "In-memory tail only. Full evidence is in the incremental journals; these gates are not a full-run evaluation." : "Complete in-memory transcript" }, null, 2)),
        save("segments.json", JSON.stringify(director.snapshot())),
        save("screenplay.json", JSON.stringify(director.screenplay(), null, 2)),
        save("scene-history.json", JSON.stringify(director.checkpoint())),
        save("renderer.json", JSON.stringify(rendererStatus(), null, 2)),
        save("world.json", JSON.stringify(serializeWorld(t.sim.world, t.sim.god.systemRegistry))),
        save("transport.json", JSON.stringify(telemetry)),
        save("pacing.json", JSON.stringify(render ? pacer.sample(t.elapsedMs) : null)),
      ]);
      // Stream complete standalone exports from the journal; the live player still
      // requests small cursor pages instead of downloading the archive every poll.
      if (!storageError) await Promise.all([journal.exportJsonArray("frames", resolve(directory, "frames.json")),
        journal.exportReplay(resolve(directory, "replay.html"))]);
      console.log(`SITCOM_SAVED ${directory}`);
    })();
    return saving;
  }
  const app = express();
  app.get("/", async (_req, res) => {
    let html = await readFile(asset("sitcom-demo.html"), "utf8");
    // Authored scenario copy only; never interpolate a user message into HTML.
    if (t.options.scenario === "duet") html = html
      .replaceAll("The Last Cookie", "Before Tonight").replaceAll("THE LAST COOKIE", "BEFORE TONIGHT")
      .replace("FOUR MINDS. ONE APARTMENT.", "TWO MINDS. ONE OPEN EVENING.")
      .replace("Someone ate<br>the last cookie.", "She has plans.<br>You have her number.")
      .replace("They have motives. They have secrets.<br>You have Elaine’s number.", "Elaine is getting ready to meet Alex.<br>Jerry is keeping her company. Your text can change the evening.")
      .replace("A small problem with four very different priorities.", "Two autonomous people. No scripted reply. No automatic test texts.")
      .replace("<option>George</option><option>Kramer</option>", "");
    if (t.options.scenario === "project89") html = html
      .replaceAll("The Last Cookie", "Project 89 · Someone Outside").replaceAll("THE LAST COOKIE", "PROJECT 89")
      .replace("FOUR MINDS. ONE APARTMENT.", "TWO MINDS. SOMEONE OUTSIDE.")
      .replace("Someone ate<br>the last cookie.", "Someone outside<br>has his number.")
      .replace("A small problem with four very different priorities.", "Two autonomous minds. One real text conversation.")
      .replaceAll("her world", "his world").replaceAll("Text her. Watch her decide", "Text him. Watch him decide")
      .replaceAll("She can question", "He can question")
      .replace("They have motives. They have secrets.<br>You have Elaine’s number.", "Jerry and George question their reality.<br>Text Jerry. See what he sends back.")
      .replaceAll("Elaine", "Jerry").replace("<span class=\"avatar\">E</span>", "<span class=\"avatar\">J</span>")
      .replace("<option>Jerry</option><option>Jerry</option><option>George</option><option>Kramer</option>", "<option>Jerry</option><option>George</option>")
      .replace('id="influence-section" hidden', 'id="influence-section"')
      .replace("How did they react when you read my message?", "Look in the drawer beneath your couch. What does the card say?");
    res.type("html").send(html);
  });
  app.get("/demo.css", async (_req, res) => res.type("css").send(await readFile(asset("sitcom-demo.css"), "utf8")));
  app.get("/client.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
  app.use((req, res, next) => {
    const given = Buffer.from(req.get("x-argos-token") ?? ""), expected = Buffer.from(options.token);
    if (!streams?.mediaAccess(req) && (given.length !== expected.length || !timingSafeEqual(given, expected))) { res.sendStatus(403); return; }
    res.set("Cache-Control", "no-store"); next();
  });
  app.use("/playback", express.json({ limit: "512kb" }));
  app.use("/prompts", express.json({ limit: "100kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/prompts", (_req, res) => {
    const log: H3PromptLog = { scope: "Exact client-captured outgoing H3 messages plus compiled script text. No NPC private cognition.",
      entries: director.screenplay().map(s => ({ version: s.version, sourceStartSimMs: s.sourceStartSimMs,
        sourceEndSimMs: s.sourceEndSimMs, prompt: s.prompt,
        sends: promptSends.filter(send => send.message.prompt_version === s.version),
        receipts: telemetry.filter(receipt => ["prompt_applied", "chunk"].includes(String(receipt.type))
          && (receipt.type === "chunk" && options.scriptQueue ? receipt.script_version : receipt.prompt_version) === s.version),
      })) };
    res.json(log);
  });
  app.post("/prompts", async (req, res) => {
    const parsed = promptSendSchema.safeParse(req.body);
    if (!parsed.success || !prepared || !render) { res.sendStatus(400); return; }
    const message = parsed.data.message, segment = director.screenplay().find(s => s.version === message.prompt_version);
    const expected = message.type === "configure" ? issuedConfigure
      : message.type === "prompt" && segment ? sitcomPromptMessage(segment, options.scriptQueue === true) : undefined;
    // Only already-issued public renderer payloads may be stored. Arbitrary
    // fields (including keys/private cognition) and invented versions fail closed.
    if (!expected || !isDeepStrictEqual(message, expected)) { res.sendStatus(400); return; }
    const send = parsed.data as H3PromptSend, line = JSON.stringify(send) + "\n";
    const write = promptLogWrites.then(async () => {
      const previous = promptSends.find(item => item.id === send.id);
      if (previous) return isDeepStrictEqual(previous, send) ? 204 : 409;
      if (promptSends.length >= 4096 || promptLogBytes + Buffer.byteLength(line) > 4 * 1024 * 1024) return 413;
      await mkdir(directory, { recursive: true });
      await appendFile(resolve(directory, "h3-outgoing.jsonl"), line, { mode: 0o600 });
      promptSends.push(send); promptLogBytes += Buffer.byteLength(line); return 204;
    });
    promptLogWrites = write.then(() => {}, () => {});
    try { res.sendStatus(await write); }
    catch { res.status(500).json({ error: "Prompt log save failed; browser copy remains available" }); }
  });
  streams = installStreamRecordings(app, { directory, canStart: () => prepared && render && !stopped,
    canWrite: () => started && render && (!stopped || Date.now() - stoppedAt < 120000),
    onFailure: () => stop("recording_failure") });
  app.get("/recordings/status", (_req, res) => res.json(streams!.status()));
  app.get("/state", async (req, res) => {
    const cursor = Number(req.query.afterFrame ?? 0), limit = Number(req.query.limit ?? 200);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      res.status(400).json({ error: "Invalid frame page" }); return;
    }
    try { res.json({ ...state(), ...await journal.framesPage(cursor, limit) }); }
    catch (error) {
      if (journal.snapshot().failed) { storageError ??= String(error); await stop("storage_failure"); res.status(503).json({ ...state(), frames: [], error: storageError }); }
      else res.status(400).json({ error: "Frame cursor is ahead of saved history" });
    }
  });
  app.post("/contact", (req, res) => {
    if (stopped || started && !t.running) { res.status(409).json({ error: "Create a fresh world to change its contacts" }); return; }
    let contact;
    try { contact = normalizePhoneContact(req.body); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid phone contact" }); return; }
    t.setPhoneContact(contact);
    capture(); res.json({ contact: t.snapshot().contact });
  });
  app.post("/start", async (req, res) => {
    const parsed = z.object({ render: z.boolean(), seconds: secondsSchema.optional() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Choose render true or false and a duration from 10 to 1800 seconds" }); return; }
    if (started || stopped) { res.status(409).json({ error: "Create a fresh server for another episode" }); return; }
    if (parsed.data.render && !options.allowVideo) { res.status(403).json({ error: "Video is disabled" }); return; }
    // Reserve the single start before asynchronous preflight; racing requests cannot allocate twice.
    started = true; render = parsed.data.render; seconds = parsed.data.seconds ?? defaultSeconds;
    budget = new SitcomSessionBudget(Date.now(), seconds);
    const stopSafely = (reason: string) => { void stop(reason).catch(error => console.error("SITCOM_SAVE_FAILED", String(error))); };
    startupDeadline = setTimeout(() => stopSafely("startup_timeout"), 60000);
    try {
      if (render) {
        const disk = await statfs(directory);
        // Two requested video bitrates total 8 Mbps. Include audio/container margin,
        // a full journal allowance and a reserve; filesystem/quota errors still fail closed during writes.
        const required = Math.ceil(seconds * 1_250_000) + 768 * 1024 ** 2;
        if (disk.bavail * disk.bsize < required) throw new Error("Not enough free disk for this duration and both recordings; choose a shorter session");
      }
      if (stopped) throw new Error("Session stopped during preparation");
      await t.start();
      if (stopped) { t.stop(); throw new Error("Session stopped while the world was starting"); }
      sample = setInterval(() => {
        if (stopped) return;
        const expired = budget!.expiration(Date.now());
        if (expired) { stopSafely(expired); return; }
        paceSource();
        if (!t.options.live && t.running && !t.sim.paused) t.advance(250);
        if (t.running) capture();
        if (t.elapsedMs >= budget!.effectiveSeconds * 1000 && t.running) {
          t.stop(); capture();
          if (!render) stopSafely("duration"); // video may still be displaying its committed buffer
        }
      }, 250);
      if (!render) { prepared = true; clearTimeout(startupDeadline); budget.ready(Date.now()); res.json({ render, ...duration() }); return; }
      let next = director.next();
      while (!stopped && "buffering" in next && next.buffering) { await delay(100); next = director.next(); }
      const opening = "segment" in next ? next.segment : undefined;
      if (stopped || !opening) throw new Error("Could not prepare a committed opening interval");
      pacer.register(opening); paceSource(); prepared = true;
      const configure = { ...directorConfigure(opening.prompt, opening.version, requestedResolution), memory: requestedMemory };
      issuedConfigure = options.scriptQueue ? { ...configure,
        prompt: "A continuous painterly sitcom following the recorded characters. Script directions supply the only actions and dialogue.",
        script: [{ offset: 0, prompt: opening.prompt }] } : { ...configure };
      if (requestedChunkSeconds !== undefined) issuedConfigure.chunk_duration = requestedChunkSeconds;
      res.json({ render, ...duration(), handoff: options.scriptQueue ? "script_append" : "chunk_ack",
        ...(requestedChunkSeconds === undefined ? {} : { requestedChunkSeconds }),
        configure: { ...issuedConfigure }, initialSegment: opening });
    } catch (error) { await stop("startup_failure"); res.status(503).json({ error: error instanceof Error ? error.message : "Opening failed" }); }
  });
  const armPlaybackDeadline = () => {
    clearTimeout(playbackDeadline);
    playbackDeadline = setTimeout(() => { void stop("duration").catch(() => {}); }, Math.max(0, budget!.deadline - Date.now()));
  };
  app.post("/ready", (_req, res) => {
    if (!prepared || !render || stopped || ready) { res.sendStatus(409); return; }
    ready = true; clearTimeout(startupDeadline);
    budget!.ready(Date.now()); armPlaybackDeadline();
    res.json({ atSimMs: t.elapsedMs });
  });
  app.post("/heartbeat", (_req, res) => {
    if (!started || stopped) { res.sendStatus(409); return; }
    budget!.heartbeat(Date.now()); res.sendStatus(204);
  });
  app.post("/session-info", (req, res) => {
    const parsed = z.object({ maxSessionSeconds: z.number().finite().positive().nullable() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid provider limit" }); return; }
    if (!prepared || !render || stopped) { res.sendStatus(409); return; }
    budget!.reportProvider(parsed.data.maxSessionSeconds); armPlaybackDeadline(); res.json(duration());
  });
  app.post("/presentation", (req, res) => {
    const parsed = z.object({ playbackSeconds: z.number().finite().min(0).max(2000), chunks: z.array(z.object({
      chunk_index: z.number().int().min(0).max(1023), playback_seconds: z.number().finite().positive().max(30),
      prompt_version: z.number().int().positive(),
    }).strict()).max(32) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid presentation receipt" }); return; }
    if (!prepared || !render || stopped) { res.status(409).json({ error: "No active video presentation" }); return; }
    try {
      pacer.observe(parsed.data); paceSource(); const pacing = pacer.sample(t.elapsedMs); res.json(pacing);
      if (pacing.failure) void stop("provider-performance-mismatch").catch(error => console.error("SITCOM_SAVE_FAILED", String(error)));
    }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid presentation receipt" }); }
  });
  app.post("/next", (req, res) => {
    const parsed = z.object({ settledVersion: z.number().int().min(0), admittedVersion: z.number().int().min(0).optional() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid prompt acknowledgement" }); return; }
    if (!prepared || !render || stopped) { res.status(409).json({ error: "No active video session" }); return; }
    const lastIssued = director.snapshot().at(-1)?.version ?? 0;
    const { settledVersion, admittedVersion } = parsed.data;
    if (settledVersion > lastIssued || admittedVersion !== undefined && (!options.scriptQueue
      || admittedVersion > lastIssued || admittedVersion < settledVersion)) {
      res.status(400).json({ error: "A future version cannot acknowledge a source interval" }); return;
    }
    try {
      // Script admission permits ONE queued successor, not a playback receipt.
      // The pacer still retains every issued packet until actual media plays.
      const release = admittedVersion ?? settledVersion;
      if (release === lastIssued && (lastIssued - settledVersion >= (options.scriptQueue ? 2 : 1)
        || !pacer.canIssue(mediaTiming.continuationMediaMs))) {
        paceSource(); res.json({ buffering: true }); return;
      }
      let next = director.next(release);
      if ("segment" in next) { pacer.register(next.segment); paceSource(); }
      if ("ended" in next && !next.reason && t.running) next = { ended: true, reason: "unexpected_source_end" };
      if ("ended" in next && next.reason && !telemetry.some(e => e.type === "renderer_failure")) {
        telemetry.push({ type: "renderer_failure", reason: next.reason, detail: next.detail ?? null, atSimMs: t.elapsedMs });
        console.error("SITCOM_RENDERER_FAILED", JSON.stringify({ ...next, sourceCursorSimMs: director.status().sourceCursorSimMs }));
      }
      res.json(next);
      if ("ended" in next && next.reason) void stop("renderer-source-failure").catch(error => console.error("SITCOM_SAVE_FAILED", String(error)));
    }
    catch { res.status(400).json({ error: "Unknown or out-of-order prompt acknowledgement" }); }
  });
  app.post("/control", (req, res) => {
    const parsed = controlSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Use a bounded message or thought" }); return; }
    try {
      if (parsed.data.type === "message") t.text(parsed.data.text, "live UI operator");
      else if (parsed.data.type === "influence") {
        if (!t.running || !t.options.worldMaintenance || t.options.scenario !== "project89" || influences.length >= 8)
          throw new Error("Influence requires an active Project 89 world with spirits; maximum eight requests per episode");
        const receipt = requestProject89Influence(t.sim.world, parsed.data.text);
        influences.push({...receipt,text:parsed.data.text,atSimMs:t.elapsedMs});
      }
      else t.plantThought(parsed.data.actor, parsed.data.text);
      capture(); res.json(state());
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "World is not accepting input" }); }
  });
  app.post("/telemetry", (req, res) => {
    if (!started || telemetry.length >= 4096 || typeof req.body?.type !== "string") { res.sendStatus(400); return; }
    const clean: Record<string, string | number | boolean | null> = { type: req.body.type.slice(0, 80), receivedWallMs: Date.now() };
    for (const key of ["prompt_version", "script_version", "script_beats", "script_mode", "chunk_index", "playback_seconds", "generation_seconds", "buffer_depth_seconds", "max_session_seconds", "code", "reason", "error"])
      if (["string", "number", "boolean"].includes(typeof req.body[key]) || req.body[key] === null)
        clean[key] = typeof req.body[key] === "string" ? req.body[key].slice(0, 300) : req.body[key];
    telemetry.push(clean); res.sendStatus(204);
  });
  app.post("/stop", async (req, res) => {
    const parsed = z.object({ reason: z.string().regex(/^[a-z0-9_-]{1,80}$/).optional() }).strict().safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "Invalid stop reason" }); return; }
    await stop(parsed.data.reason ?? "operator"); res.sendStatus(204);
  });
  app.post("/reset", async (req, res) => {
    if (!options.newEpisode) { res.status(409).json({ error: "This receiver does not support new episodes" }); return; }
    if (!z.object({}).strict().safeParse(req.body).success) { res.status(400).json({ error: "Reset takes no options" }); return; }
    if (!stopped) { res.status(409).json({ error: "Stop & save this episode before creating another" }); return; }
    try {
      await saving;
      if (storageError) throw new Error("Recover this episode's world journal before resetting");
      // One successor per episode: double clicks, another tab and an uncertain
      // response retry must all return the same fresh, unstarted receiver.
      nextEpisode ??= Promise.resolve().then(options.newEpisode).catch(error => { nextEpisode = undefined; throw error; });
      res.json(await nextEpisode);
    } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not prepare a new episode" }); }
  });
  app.post("/playback", async (req, res) => {
    if (!stopped || playback) { res.sendStatus(409); return; }
    const parsed = playbackSchema.safeParse(req.body), versions = new Set(director.snapshot().map(s => s.version));
    if (!parsed.success || parsed.data.recordingEnd < parsed.data.recordingStart || parsed.data.chunks.some((c, i, chunks) =>
      c.index !== i || c.start !== (i ? chunks[i - 1].end : 0) || c.end <= c.start || !versions.has(c.version))) {
      res.status(400).json({ error: "Invalid recorded source timeline" }); return;
    }
    try { await stop(); await writeFile(resolve(directory, "playback.json"), JSON.stringify({ ...parsed.data,
      alignment: "Provider chunk versions select the pre-issued performance/source map in segments.json; older mapless segments use legacy retiming. Generated pixels and audio remain best-effort." }), { flag: "wx", mode: 0o600 });
      playback = parsed.data; res.sendStatus(204); }
    catch { res.status(500).json({ error: "Could not save playback metadata" }); }
  });
  app.get("/replay", (_req, res) => playback ? res.json(playback) : res.sendStatus(404));
  installDirectorRecording(app, () => started && stopped && render && !streams!.has("raw"), directory);
  app.post("/composition", express.raw({ type: ["video/mp4", "video/webm"], limit: "96mb" }), async (req, res) => {
    if (!started || !stopped || !render || compositionSaved || streams!.has("composition")) { res.sendStatus(409); return; }
    if (!Buffer.isBuffer(req.body) || !req.body.length) { res.sendStatus(400); return; }
    compositionSaved = true;
    const extension = req.is("video/mp4") ? "mp4" : "webm", path = resolve(directory, `ui-composition.${extension}`);
    try { await mkdir(directory, { recursive: true }); await writeFile(path, req.body, { flag: "wx", mode: 0o600 });
      res.json({ path, bytes: req.body.length, mimeType: `video/${extension}` }); }
    catch { compositionSaved = false; res.status(500).json({ error: "Composition save failed; use the browser download" }); }
  });
  app.get(["/media/raw", "/replay/video", "/media/composition"], async (req, res) => {
    if (!stopped) { res.sendStatus(409); return; }
    try { const pattern = req.path === "/media/composition" ? /^ui-composition\.(mp4|webm)$/ : /^director-.*\.(mp4|webm)$/;
      const files = (await readdir(directory)).filter(name => pattern.test(name));
      if (files.length !== 1) { res.sendStatus(404); return; } res.sendFile(resolve(directory, files[0])); }
    catch { res.sendStatus(404); }
  });
  app.post("/proxy", async (req, res) => {
    const target = req.get("x-fal-target-url") ?? "";
    if (!render || !prepared || stopped || !isDirectorProxyTarget(target)
      || (target.endsWith("/ice") || target.endsWith("/session")) && req.body.app_id !== "minimax/h3-max/director") {
      res.sendStatus(403); return;
    }
    if (target.endsWith("/session")) {
      if (allocated) { res.sendStatus(409); return; }
      allocated = true; // uncertain failures never authorize a second allocation
      budget!.allocated(Date.now());
    }
    try { const response = await fetch(target, { method: "POST", redirect: "error",
      signal: AbortSignal.any([network.signal, AbortSignal.timeout(45000)]),
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
      res.status(response.status).type("json").send(await response.text()); }
    catch { res.status(502).json({ error: "Director connection failed" }); }
  });
  app.use((_req, res) => res.sendStatus(404));
  return { app, stop, state, directory };
}
