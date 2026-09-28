/** A read-only sitcom camera over already-lived apartment time. Transport
 * acknowledgements advance its source cursor; they do not advance the world. */
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { attachCommittedSceneRenderer } from "../rendering/attach-committed-renderer";
import type { CommittedSceneHistoryLimits } from "../rendering/committed-scene-history";
import type { ApartmentSitcom } from "./apartment-sitcom";
import { SitcomScreenwriter, type PhoneSound, type Screenplay } from "./sitcom-screenplay";
import { ESSENTIAL_PHYSICAL_OPERATIONS, PerformanceBudgetError, type PerformancePoint } from "./sitcom-performance";

export type SitcomSegmentMetadata = Readonly<{
  version: number; sourceId: string; sourceStartSimMs: number; sourceEndSimMs: number;
  performance?: Readonly<{ clock?: "realtime"; durationMs: number; sourceMap: readonly PerformancePoint[] }>;
}>;
export type SitcomRenderSegment = SitcomSegmentMetadata & Readonly<{ prompt: string; script: Screenplay }>;
export type SitcomUnfilmedTail = Readonly<{ sourceStartSimMs: number; sourceEndSimMs: number;
  evidence: readonly number[]; reason: "incidental_continuity_only" | "incomplete_realtime_tail" }>;
export type SitcomDirectorResult = { segment: SitcomRenderSegment } | { buffering: true }
  | { ended: true; reason?: string; detail?: string; unfilmedTail?: SitcomUnfilmedTail };

export class SitcomDirector {
  private readonly world;
  private readonly apartmentSource: string;
  private readonly attachment;
  private readonly windowMs: number;
  private readonly openingMediaMs: number;
  private readonly continuationMediaMs: number;
  private readonly wholeUtterances: boolean;
  private readonly performanceScheduling: boolean;
  private readonly promptStyle: "timed" | "direct";
  private readonly conversationFraming: boolean;
  private readonly realtime: boolean;
  private readonly cameraActorId: number;
  private unfilmedTail: SitcomUnfilmedTail | null = null;
  private cursor: number;
  private version = 0;
  private outstanding: SitcomRenderSegment | null = null;
  private readonly issued: SitcomSegmentMetadata[] = [];
  private readonly sounds: PhoneSound[] = [];
  private readonly soundArchive: PhoneSound[] = [];
  private unsubscribeSound = () => {};
  private stopped = false;
  private failure: string | undefined;
  private failureDetail: string | undefined;
  private readonly writer = new SitcomScreenwriter();
  private readonly scripts: Screenplay[] = [];

  constructor(private readonly testbed: ApartmentSitcom, options: { windowMs?: number;
    openingMediaMs?: number; continuationMediaMs?: number; wholeUtterances?: boolean;
    scheduling?: "source_windows" | "performance" | "realtime";
    cameraActorId?: number;
    promptStyle?: "timed" | "direct";
    conversationFraming?: boolean;
    historyLimits?: Partial<CommittedSceneHistoryLimits> } = {}) {
    this.windowMs = options.windowMs ?? 8500;
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0 || this.windowMs > 30_000)
      throw new Error("Sitcom director needs a positive window of at most 30,000 simulation milliseconds.");
    this.openingMediaMs = options.openingMediaMs ?? 10125; this.continuationMediaMs = options.continuationMediaMs ?? 8500;
    this.wholeUtterances = options.wholeUtterances ?? true;
    this.performanceScheduling = options.scheduling === "performance";
    this.realtime = options.scheduling === "realtime";
    this.cameraActorId = options.cameraActorId ?? testbed.ids[testbed.phoneOwner];
    this.promptStyle = options.promptStyle ?? "timed";
    this.conversationFraming = options.conversationFraming ?? false;
    for (const ms of [this.openingMediaMs, this.continuationMediaMs]) if (!Number.isFinite(ms) || ms < 1000 || ms > 30_000)
      throw new Error("Invalid renderer media duration calibration");
    this.world = testbed.sim.world; this.apartmentSource = testbed.sourceId;
    if (getCommittedEvents(this.world).stopped) throw new Error("Attach the sitcom director before stopping the source.");
    const rooms = [...new Set(testbed.scenes().map(scene => scene.room.id))];
    if (!rooms.length) throw new Error("Sitcom director needs at least one captured authored room.");
    this.cursor = readSimulationTime(this.world);
    this.attachment = attachCommittedSceneRenderer(this.world, { roomId: rooms[0], windowMs: this.windowMs,
      captureScenes: () => testbed.scenes(), historyLimits: { retentionMs: 2_000_000, maxCaptures: 20_000,
        maxEvents: 65_536, maxBytes: 128 * 1024 * 1024, ...options.historyLimits } });
    // This side-channel carries one explicitly typed sound, not the testbed's
    // operator/private event history. Sample location at emission, never next().
    this.unsubscribeSound = testbed.onEvent(event => {
      if (this.stopped || event.kind !== "phone_buzz" || event.visibility !== "public"
        || event.atSimMs !== readSimulationTime(this.world) || !this.sourceCurrent()) return;
      const roomId = getRoomForEntity(this.world, testbed.ids.phone);
      if (roomId === undefined) return;
      const scene = testbed.scenes().find(scene => scene.room.id === roomId);
      if(!scene)return;
      const phone = scene?.props.find(prop => prop.id === testbed.ids.phone);
      const support = getDirectContainer(this.world, testbed.ids.phone);
      const visibleSupport = support !== undefined && scene?.props.some(prop => prop.id === support);
      this.sounds.push(Object.freeze({ sequence: event.sequence, atSimMs: event.atSimMs, roomId, kind: "phone_double_vibration",
        ...(event.sound?.roomId === roomId ? { audibleRoomIds: Object.freeze([...event.sound.audibleRoomIds]) } : {}),
        ...(phone ? { visibleSource: Object.freeze({ id: phone.id, name: phone.name,
          ...(phone.heldBy !== undefined ? { heldBy: phone.heldBy } : {}),
          ...(visibleSupport ? { supportId: support } : {}) }) } : {}) }));
      this.soundArchive.push(this.sounds.at(-1)!);
      if (this.soundArchive.length > 4096) this.end("sound_retention_gap");
    });
  }
  private sourceCurrent() {
    return this.testbed.sim.world === this.world && this.testbed.sourceId === this.apartmentSource
      && getCommittedEvents(this.world).sourceId === this.attachment.sourceId;
  }
  private end(reason?: string, detail?: string): SitcomDirectorResult {
    this.failure = reason; this.failureDetail = detail; this.stop();
    return this.endedResult();
  }
  private endedResult(): SitcomDirectorResult {
    return { ended: true, ...(this.failure ? { reason: this.failure } : {}),
      ...(this.failureDetail ? { detail: this.failureDetail } : {}),
      ...(this.realtime && this.unfilmedTail ? { unfilmedTail: this.unfilmedTail } : {}) };
  }
  next(settledVersion?: number): SitcomDirectorResult {
    if (this.stopped) return this.endedResult();
    if (!this.sourceCurrent()) return this.end("source_changed");
    const status = this.attachment.status();
    if (status.error) return this.end(status.error, status.errorDetail ?? undefined);
    const bounds = this.attachment.renderer.history.bounds();
    if (bounds.availableStartSimMs !== null && this.cursor < bounds.availableStartSimMs) return this.end("expired");
    if (this.outstanding && settledVersion === this.outstanding.version) {
      this.cursor = this.outstanding.sourceEndSimMs; this.outstanding = null;
      while (this.sounds.length && (this.realtime?this.sounds[0].atSimMs+800<=this.cursor:this.sounds[0].atSimMs < this.cursor)) this.sounds.shift();
    }
    if (this.outstanding) return { segment: this.outstanding };
    // Keep every issued version for recording/replay. A bounded metadata limit
    // ends explicitly rather than making old media chunks unresolvable.
    if (this.issued.length >= 8192) return this.end("segment_metadata_limit");
    const mediaDurationMs = this.version ? this.continuationMediaMs : this.openingMediaMs;
    if(this.realtime) {
      const end=this.cursor+mediaDurationMs;
      if(bounds.availableEndSimMs===null||bounds.availableEndSimMs<end) {
        if(!bounds.stopped) return {buffering:true};
        if (bounds.availableEndSimMs === this.cursor) return this.end();
        if (bounds.availableEndSimMs === null) return this.end("missing_source_bounds");
        // A sealed remainder is incomplete coverage, not corrupt source. Verify
        // its history, retain its exact range, and let the receiver drain only
        // acknowledged media. Never advance the filmed cursor over this tail.
        const tail = this.attachment.renderer.history.assembleWorld(this.cursor, bounds.availableEndSimMs);
        if (tail.status !== "ready") return this.end(tail.status);
        this.unfilmedTail = Object.freeze({ sourceStartSimMs: this.cursor, sourceEndSimMs: bounds.availableEndSimMs,
          evidence: Object.freeze([...new Set(tail.window.rooms.flatMap(room => room.events
            .flatMap(({event}) => event.sequence === undefined ? [] : [event.sequence])))]),
          reason: "incomplete_realtime_tail" });
        return this.end();
      }
      const result=this.attachment.renderer.history.assembleWorld(this.cursor,end);
      if(result.status!=="ready")return this.end(result.status);
      const baseline=[...result.window.states].reverse().find(s=>s.atSimMs<=this.cursor);
      const actor=baseline?.scenes.flatMap(s=>s.actors).find(a=>a.id===this.cameraActorId);
      if(!actor)return this.end("camera_subject_unavailable","The followed character has no committed location; do not invent a camera destination.");
      try {
        const compiled=this.writer.compileWorld(result.window,this.sounds.filter(s=>s.atSimMs+800>this.cursor&&s.atSimMs<end),this.version+1,
          {mediaDurationMs,promptStyle:this.promptStyle,conversationFraming:this.conversationFraming,realtimeRoomId:actor.roomId,allowSpeechSlices:true,allowWordCuts:true});
        return this.issue(compiled);
      } catch(cause) { return this.end("realtime_projection_failed",cause instanceof Error?cause.message:String(cause)); }
    }
    const nominal = this.cursor + (this.wholeUtterances && !this.version ? Math.max(this.windowMs, mediaDurationMs) : this.windowMs);
    const boundary = this.wholeUtterances ? this.attachment.renderer.history.safeSpeechBoundaries(this.cursor, nominal,
      this.cursor + Math.max(nominal - this.cursor, 20_000), ESSENTIAL_PHYSICAL_OPERATIONS) : undefined;
    if (boundary && boundary.availableEndSimMs < nominal && !boundary.stopped) return { buffering: true };
    if (boundary?.stopped && boundary.availableEndSimMs <= this.cursor) return this.end();
    const wholeCandidates = [...(boundary?.candidates ?? [nominal]), ...(this.performanceScheduling ? this.sounds
      .filter(sound => sound.atSimMs > this.cursor + 1000 && sound.atSimMs <= Math.min(boundary?.availableEndSimMs ?? nominal, this.cursor + 20000))
      .map(sound => sound.atSimMs) : [])];
    const phraseCandidates = this.performanceScheduling && this.wholeUtterances
      ? this.attachment.renderer.history.safeSpeechPhraseBoundaries(this.cursor, this.cursor + Math.max(nominal - this.cursor, 20_000), ESSENTIAL_PHYSICAL_OPERATIONS) : [];
    // Last-resort transport cuts use delivered word receipts, never generated
    // future text. Keep their candidates separate so a viable clause wins.
    const wordCandidates = this.performanceScheduling && this.wholeUtterances
      ? this.attachment.renderer.history.safeSpeechPhraseBoundaries(this.cursor,
        this.cursor + Math.max(nominal - this.cursor, 20_000), ESSENTIAL_PHYSICAL_OPERATIONS, true) : [];
    const candidates = [...wholeCandidates.map(end => ({ end, allowSpeechSlices: false, allowWordCuts: false })),
      ...phraseCandidates.map(end => ({ end, allowSpeechSlices: true, allowWordCuts: false })),
      ...wordCandidates.map(end => ({ end, allowSpeechSlices: true, allowWordCuts: true }))];
    let lastBudget: PerformanceBudgetError | undefined;
    const feasible: Array<{ end: number; compiled: ReturnType<SitcomScreenwriter["compile"]> }> = [];
    const fallback: typeof feasible = [];
    for (const { end, allowSpeechSlices, allowWordCuts } of candidates) {
      if (allowWordCuts && feasible.length) break;
      // Evaluate delivered clause cuts too. Selecting any whole turn used to
      // suppress these candidates even when most of the media was ending hold.
      const result = this.attachment.renderer.history.assembleWorld(this.cursor, end);
      if (result.status === "buffering") return { buffering: true };
      if (result.status === "ended") return this.end();
      if (result.status !== "ready") return this.end(result.status);
      if (result.window.sourceId !== this.attachment.sourceId) return this.end("source_changed");
      const sounds = this.sounds.filter(sound => sound.atSimMs >= this.cursor && sound.atSimMs < end);
      let compiled: ReturnType<SitcomScreenwriter["compile"]>;
      try { compiled = this.writer.compileWorld(result.window, sounds, this.version + 1, { mediaDurationMs,
        requireWholeUtterances: this.wholeUtterances, allowShortEstablishing: !this.wholeUtterances, allowSpeechSlices, allowWordCuts,
        preserveSoundCadence: this.performanceScheduling, promptStyle: this.promptStyle }); }
      catch (cause) {
        if (cause instanceof PerformanceBudgetError) { lastBudget = cause; continue; }
        if (cause instanceof Error && cause.message.startsWith("Screenplay prompt budget exceeded")) {
          lastBudget = new PerformanceBudgetError("performance_overflow", cause.message); continue;
        }
        return this.end("projection_failed", cause instanceof Error ? cause.message.slice(0, 300) : "Screenplay projection failed");
      }
      // A safe cut immediately before an unfinished line is not automatically
      // a useful clip. Keep its point-state/sound evidence queued until the line
      // can be covered, instead of stretching a tiny idle prefix into a full clip.
      // Full nominal lived waits and the sealed final receipts remain valid.
      const hasPerformance = compiled.script.beats.some(b => (b.kind === "speech" || b.kind === "action")
        && (b.endSimMs ?? b.atSimMs) > b.atSimMs || b.kind === "sound" && (b.audibleDurationMs ?? 0) > 0);
      if (this.performanceScheduling && boundary?.buffering
        && compiled.script.beats.some(b => b.speechSlice && ["phrase_boundary", "word_boundary"].includes(b.speechSlice.ends))
        && compiled.script.beats.filter(b => b.kind === "speech").flatMap(b => b.text?.trim().split(/\s+/u) ?? []).length <= 1
        && !compiled.script.beats.some(b => b.kind === "action" && (b.endSimMs ?? b.atSimMs) > b.atSimMs)
        && compiled.script.performance.endingSilenceMs > mediaDurationMs / 2) {
        lastBudget ??= new PerformanceBudgetError("underfilled_continuation", "Await enough committed continuation to avoid filming a tiny speech fragment as a full packet.");
        continue;
      }
      if (end < nominal && !hasPerformance && !(boundary?.stopped && end === boundary.availableEndSimMs)) {
        lastBudget ??= new PerformanceBudgetError("underfilled_continuation", "A short source prefix contains no performed action or dialogue; await the following complete beat within the bounded horizon.");
        continue;
      }
      // A recording is not an exhaustive slideshow of every ECS property. An
      // incidental, unheld prop changing in the final tail stays in the source
      // journal and explicit coverage report; it must not manufacture8.5s of film.
      if (this.performanceScheduling && this.version && boundary?.stopped && end === boundary.availableEndSimMs
        && end < nominal && compiled.script.beats.length && compiled.script.beats.every(b => b.depiction === "continuity")) {
        this.unfilmedTail = Object.freeze({ sourceStartSimMs: this.cursor, sourceEndSimMs: end,
          evidence: Object.freeze([...new Set(compiled.script.beats.flatMap(b => [...b.evidence]))]), reason: "incidental_continuity_only" });
        this.cursor = end; return this.end();
      }
      // Empty final dead air needs no manufactured media clip. Essential final
      // speech, action receipts, sounds and actor/held-prop changes are preserved.
      if (boundary?.stopped && end < nominal && !compiled.script.beats.length) return this.end();
      (allowWordCuts ? fallback : feasible).push({ end, compiled });
      if (!this.performanceScheduling) break;
    }
    if (feasible.length || fallback.length) {
      // Evaluate actual complete committed beats, not merely the nearest source
      // timestamp. Never look into a planned but uncommitted NPC action.
      const { compiled } = selectPackedPerformance(feasible.length ? feasible : fallback);
      return this.issue(compiled);
    }
    if (boundary?.buffering) return { buffering: true };
    return this.end(lastBudget?.reason ?? "incomplete_utterance", lastBudget?.message ?? "No complete speech boundary fits the bounded source horizon.");
  }
  private issue(compiled: ReturnType<SitcomScreenwriter["compile"]>): SitcomDirectorResult {
    compiled.commit(); this.scripts.push(compiled.script);
    this.outstanding = Object.freeze({ version: ++this.version, sourceId: this.attachment.sourceId,
      sourceStartSimMs: this.cursor, sourceEndSimMs: compiled.script.sourceEndSimMs, prompt: compiled.script.prompt, script: compiled.script,
      performance: Object.freeze({ ...(compiled.script.performance.clock?{clock:compiled.script.performance.clock}:{}),
        durationMs: compiled.script.performance.durationMs, sourceMap: compiled.script.performance.sourceMap }) });
    this.issued.push(Object.freeze({ version: this.version, sourceId: this.outstanding.sourceId,
      sourceStartSimMs: this.cursor, sourceEndSimMs: this.outstanding.sourceEndSimMs, performance: this.outstanding.performance }));
    return { segment: this.outstanding };
  }
  snapshot(): readonly SitcomSegmentMetadata[] { return Object.freeze([...this.issued]); }
  screenplay(): readonly Screenplay[] { return Object.freeze([...this.scripts]); }
  /** Local evidence for deterministic renderer replay; never audience state. */
  checkpoint() { return { history: this.attachment.renderer.history.checkpoint(), sounds: [...this.soundArchive] }; }
  status() { return { ...this.attachment.status(), stopped: this.stopped, reason: this.failure ?? null,
    detail: this.failureDetail ?? null, sourceCursorSimMs: this.cursor, issuedVersions: this.version,
    scheduling: this.realtime?"realtime":this.performanceScheduling ? "performance" : "source_windows", promptStyle: this.promptStyle, unfilmedTail: this.unfilmedTail }; }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.outstanding = null; this.unsubscribeSound(); this.attachment.stop();
  }
}

/** Keep complete turns unless an extending, evidence-backed clause saves at
 * least one second of ending hold. Never split an already feasible turn just
 * to re-time it, and never relax speech/gesture budgets to improve this score. */
export function selectPackedPerformance<T extends { end: number; compiled: { script: Screenplay } }>(candidates: readonly T[]): T {
  if (!candidates.length) throw new Error("No feasible performance candidates");
  const ordered = [...candidates].sort((a, b) => a.compiled.script.performance.endingSilenceMs - b.compiled.script.performance.endingSilenceMs
    || b.end - a.end);
  const whole = ordered.find(c => !c.compiled.script.beats.some(b => b.speechSlice
    && ["phrase_boundary", "word_boundary"].includes(b.speechSlice.ends)));
  if (!whole) return ordered[0]; // Existing clause fallback for an indivisible over-budget turn.
  return ordered.find(c => c.end > whole.end && c.compiled.script.performance.endingSilenceMs <= whole.compiled.script.performance.endingSilenceMs - 1000)
    ?? whole;
}
