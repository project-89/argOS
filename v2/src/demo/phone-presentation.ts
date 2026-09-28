import type { PhoneSnapshot } from "./phone-demo";

/** A read-only editorial snapshot, not another simulation or canonical event log. */
export type PhonePresentation = Pick<PhoneSnapshot,
    "elapsedMs" | "location" | "phase" | "decisions" | "mara" | "phone" | "door" | "messages" | "screen" | "thoughts" | "actionCommits">;
export function capturePresentation(s: PhoneSnapshot): PhonePresentation {
    const { elapsedMs, location, phase, decisions, mara, phone, door, messages, screen, thoughts, actionCommits } = s;
    return structuredClone({ elapsedMs, location, phase, decisions, mara, phone, door, messages, screen, thoughts, actionCommits });
}
export function currentThought(view: PhonePresentation | null) {
    return view?.thoughts.at(-1) ?? null;
}

export type PlaybackChunk = { index: number; start: number; end: number; version: number };
/** Provider indices are contiguous from zero. Duplicates cannot stretch the film;
 * out-of-order metadata waits for its missing predecessor, never guesses duration. */
export class PhonePlaybackTimeline {
    private received = new Map<number, { seconds: number; version: number }>();
    add(message: { chunk_index?: unknown; playback_seconds?: unknown; prompt_version?: unknown }): boolean {
        const { chunk_index: index, playback_seconds: seconds, prompt_version: version } = message;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= 256 ||
            typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 ||
            typeof version !== "number" || !Number.isInteger(version) || version < 1 || this.received.has(index)) return false;
        this.received.set(index, { seconds, version });
        return true;
    }
    snapshot(): PlaybackChunk[] {
        let start = 0;
        const chunks: PlaybackChunk[] = [];
        for (let index = 0; this.received.has(index); index++) {
            const { seconds, version } = this.received.get(index)!;
            chunks.push({ index, start, end: start + seconds, version });
            start += seconds;
        }
        return chunks;
    }
    /** The last gap-free chunk is the only safe transport acknowledgement.
     * A later data-channel message can arrive before an earlier one; it must not
     * release another prompt or expose a presentation that the media clock
     * cannot reach yet. */
    frontier(): PlaybackChunk | null {
        return this.snapshot().at(-1) ?? null;
    }
}

/** Emits each gap-free segment once, on the first displayed video frame at or
 * beyond its start. If frame delivery skips across a boundary, every crossed
 * segment is returned in order so the audit tape never silently loses one. */
export class PhonePlaybackDisplayTracker {
    private nextIndex = 0;
    crossed(chunks: PlaybackChunk[], seconds: number): PlaybackChunk[] {
        if (!Number.isFinite(seconds) || seconds < 0) return [];
        const crossed: PlaybackChunk[] = [];
        while (this.nextIndex < chunks.length) {
            const chunk = chunks[this.nextIndex];
            if (chunk.index !== this.nextIndex || seconds < chunk.start) break;
            crossed.push(chunk);
            this.nextIndex++;
        }
        return crossed;
    }
}

/** Separates transport flow-control from editorial truth. Applied/rejected or
 * gap-free chunk availability may release the next prompt. Only a frame-clock
 * crossing can say which immutable presentation was actually displayed. */
export class PhonePromptFlow {
    private sent = 0;
    private settled = 0;
    private displayed = 0;
    markSent(version: number): boolean {
        if (!Number.isInteger(version) || version <= this.sent) return false;
        this.sent = version;
        return true;
    }
    settle(message: { type?: unknown; prompt_version?: unknown }): boolean {
        const version = message.prompt_version;
        if (!["prompt_applied", "prompt_rejected"].includes(String(message.type)) ||
            typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > this.sent || version <= this.settled) return false;
        this.settled = version;
        return true;
    }
    /** A generated, gap-free chunk is a compatibility transport acknowledgement
     * when a provider omits prompt_applied/rejected. It is not display proof. */
    markAvailable(frontier: PlaybackChunk | null): boolean {
        if (!frontier || frontier.version > this.sent || frontier.version <= this.settled) return false;
        this.settled = frontier.version;
        return true;
    }
    /** Called only at a displayed-frame crossing (or the animation-frame
     * fallback on browsers without requestVideoFrameCallback). */
    markDisplayed(chunk: PlaybackChunk): boolean {
        if (!chunk || chunk.version > this.sent || chunk.version <= this.displayed) return false;
        this.displayed = chunk.version;
        return true;
    }
    snapshot() { return { sent: this.sent, settled: this.settled, displayed: this.displayed }; }
}

/** Commit client flow state only after the realtime transport accepted the
 * synchronous send. A throw leaves the version uncommitted; because provider
 * versions cannot be reused, the caller must terminate or obtain a new version. */
export function sendPromptTransaction(flow: PhonePromptFlow, version: number, send: () => void): boolean {
    if (!Number.isInteger(version) || version <= flow.snapshot().sent) return false;
    send();
    if (!flow.markSent(version))
        throw new Error(`Could not commit sent prompt version ${version}`);
    return true;
}

/** Tracks delivery separately from provider application. `prompt_pending` proves
 * transport receipt but deliberately does not settle PhonePromptFlow. Director
 * versions are strictly increasing, so timeout recovery is terminal, never a
 * duplicate send of the same version. */
export class PhonePromptDeliveryTracker {
    private version = 0;
    private sentAtMs = 0;
    private pendingAtMs: number | null = null;
    constructor(private readonly receiptTimeoutMs = 15000, private readonly settlementTimeoutMs = 30000) {
        if (!Number.isFinite(receiptTimeoutMs) || receiptTimeoutMs <= 0 ||
            !Number.isFinite(settlementTimeoutMs) || settlementTimeoutMs <= 0)
            throw new Error("Invalid prompt delivery policy");
    }
    begin(version: number, atMs: number): boolean {
        if (!Number.isInteger(version) || version < 1 || !Number.isFinite(atMs) || this.version) return false;
        this.version = version; this.sentAtMs = atMs; this.pendingAtMs = null;
        return true;
    }
    markPending(version: number, atMs: number): boolean {
        if (version !== this.version || this.pendingAtMs !== null || !Number.isFinite(atMs)) return false;
        this.pendingAtMs = atMs;
        return true;
    }
    settle(version: number): boolean {
        if (!this.version || !Number.isInteger(version) || version < this.version) return false;
        this.version = 0; this.sentAtMs = 0; this.pendingAtMs = null;
        return true;
    }
    due(atMs: number): "idle" | "awaiting-receipt" | "receipt-timeout" | "awaiting-settlement" | "settlement-timeout" {
        if (!this.version) return "idle";
        if (!Number.isFinite(atMs)) return this.pendingAtMs !== null ? "awaiting-settlement" : "awaiting-receipt";
        if (this.pendingAtMs === null)
            return atMs - this.sentAtMs >= this.receiptTimeoutMs ? "receipt-timeout" : "awaiting-receipt";
        return atMs - this.pendingAtMs >= this.settlementTimeoutMs ? "settlement-timeout" : "awaiting-settlement";
    }
    snapshot() { return { version: this.version, sentAtMs: this.sentAtMs, pendingAtMs: this.pendingAtMs }; }
}

type ConfigureMessage = { type?: unknown; code?: unknown; message?: unknown; reason?: unknown;
    error?: unknown };
/** The published Director contract and examples currently disagree about
 * `chunk_duration`. Retry only a rejected initial configure, never an ordinary
 * generation error or a later prompt rejection. */
export function isChunkDurationConfigureRejection(message: ConfigureMessage): boolean {
    const nested = message.error && typeof message.error === "object" ? message.error as Record<string, unknown> : null;
    const code = String(message.code ?? nested?.code ?? "").toLowerCase();
    const reason = String(message.reason ?? message.message ??
        (typeof message.error === "string" ? message.error : nested?.message ?? "")).toLowerCase();
    const namesChunkDuration = /chunk[ _-]?duration/.test(reason);
    const schemaLanguage = /(?:unknown|unexpected|additional|unsupported|unrecognized|not allowed|extra)[^.!]*chunk[ _-]?duration|chunk[ _-]?duration[^.!]*(?:unknown|unexpected|unsupported|unrecognized|not allowed)/.test(reason);
    return namesChunkDuration && (message.type === "invalid_message" || code === "invalid_message" || schemaLanguage);
}


/** Learn the next forecast window from actual playable media, leaving a 500ms
 * guard for overlap trimming/end-boundary ambiguity. Requested duration is only
 * a fallback because it can differ from what the provider actually emits. The
 * opening chunk has no continuation trim: it may tighten the existing forecast,
 * but must never expand the window used for the shorter next segment. */
export function renderHorizonFromChunk(currentMs: number, message: {
    chunk_index?: unknown;
    playback_seconds?: unknown;
    requested_duration_seconds?: unknown;
}): number {
    const playback = typeof message.playback_seconds === "number" && Number.isFinite(message.playback_seconds) &&
        message.playback_seconds > 0 && message.playback_seconds <= 30 ? message.playback_seconds : null;
    const requested = typeof message.requested_duration_seconds === "number" && Number.isFinite(message.requested_duration_seconds) &&
        message.requested_duration_seconds >= 5 && message.requested_duration_seconds <= 15 ? message.requested_duration_seconds : null;
    const seconds = playback ?? requested;
    if (seconds === null) return currentMs;
    const guarded = Math.floor(seconds * 2) * 500 - 500;
    const horizon = Math.max(1000, Math.min(15000, guarded));
    return message.chunk_index === 0 ? Math.min(currentMs, horizon) : horizon;
}

export type PhoneSyncEvent = {
    type: string;
    atMs: number;
    wallMs?: number;
    promptVersion?: number;
    sourceMs?: number;
    /** Wall time at which the immutable camera source shot was captured. */
    sourceCapturedWallMs?: number;
    sourceEpochWallMs?: number;
    playbackTime?: number;
    sourceToDisplayMs?: number;
    sourceToFilmOffsetMs?: number;
};
export type PhoneSyncMeasurement = {
    promptVersion: number;
    sourceMs: number;
    sourceCapturedWallMs: number | null;
    sourceToSentMs: number | null;
    sentToAppliedMs: number | null;
    sourceToAppliedMs: number | null;
    appliedToChunkReadyMs: number | null;
    chunkReadyToDisplayMs: number | null;
    sourceToDisplayMs: number | null;
    sourceToFilmOffsetMs: number | null;
};

/** Turn a persisted playback telemetry tape into comparable per-prompt legs.
 * Wall-clock source latency uses the server's /ready epoch; content offset uses
 * the media clock and remains useful even when browser/server clocks differ. */
export function phoneSyncMeasurements(events: PhoneSyncEvent[]): PhoneSyncMeasurement[] {
    const epoch = events.find(event => event.type === "world_clock_started")?.sourceEpochWallMs;
    const sent = events.filter(event => ["configure_sent", "prompt_sent"].includes(event.type) &&
        Number.isInteger(event.promptVersion) && Number.isFinite(event.sourceMs));
    const first = (type: string, version: number) => events.find(event => event.type === type && event.promptVersion === version);
    const elapsed = (later?: PhoneSyncEvent, earlier?: PhoneSyncEvent) => later && earlier ? later.atMs - earlier.atMs : null;
    const fromSource = (event: PhoneSyncEvent | undefined, sourceMs: number, capturedWallMs?: number) => {
        if (!event || !Number.isFinite(event.wallMs)) return null;
        if (Number.isFinite(capturedWallMs)) return event.wallMs! - capturedWallMs!;
        return Number.isFinite(epoch) ? event.wallMs! - (epoch! + sourceMs) : null;
    };
    return sent.map(prompt => {
        const version = prompt.promptVersion!, sourceMs = prompt.sourceMs!;
        const capturedWallMs = Number.isFinite(prompt.sourceCapturedWallMs) ? prompt.sourceCapturedWallMs : undefined;
        const applied = first("provider_prompt_applied", version);
        const chunk = first("provider_chunk", version);
        const displayed = first("segment_displayed", version);
        return {
            promptVersion: version,
            sourceMs,
            sourceCapturedWallMs: capturedWallMs ?? null,
            sourceToSentMs: fromSource(prompt, sourceMs, capturedWallMs),
            sentToAppliedMs: elapsed(applied, prompt),
            sourceToAppliedMs: fromSource(applied, sourceMs, capturedWallMs),
            appliedToChunkReadyMs: elapsed(chunk, applied),
            chunkReadyToDisplayMs: elapsed(displayed, chunk),
            sourceToDisplayMs: displayed?.sourceToDisplayMs ?? fromSource(displayed, sourceMs, capturedWallMs),
            sourceToFilmOffsetMs: displayed?.sourceToFilmOffsetMs ?? null,
        };
    });
}
export function shotAtPlayback<T extends { version: number }>(shots: T[], chunks: PlaybackChunk[], seconds: number): { shot: T | null; matched: boolean } {
    if (!Number.isFinite(seconds) || seconds < 0) return { shot: null, matched: false };
    // After the known tape ends, hold the last known state, not the live world's future.
    const chunk = [...chunks].reverse().find(c => seconds >= c.start);
    const shot = chunk ? shots.find(s => s.version === chunk.version) ?? null : null;
    return { shot, matched: !!shot && seconds < chunk!.end };
}

type ProjectedMilestone = {
    atMs: number;
    inMs: number;
    event: "arrive" | "pickup" | "read" | "send" | "open";
};
type ProjectionForPresentation = {
    basisSequence: number;
    destination: string | null;
    milestone: ProjectedMilestone | null;
};
export type ProjectedPresentationShot = {
    version: number;
    sourceMs: number;
    presentation: PhonePresentation;
    projection: ProjectionForPresentation | null;
};
export type PlaybackPresentation<T> = {
    /** The H3 segment's immutable source shot. */
    shot: T | null;
    /** State safe to put beside the displayed frame. */
    presentation: PhonePresentation | null;
    presentationVersion: number | null;
    matched: boolean;
    projectedTransition: boolean;
};

function milestonePatch(base: PhonePresentation, candidate: PhonePresentation,
    projection: ProjectionForPresentation, milestone: ProjectedMilestone): PhonePresentation | null {
    const commit = candidate.actionCommits.find(value => value.basisSequence === projection.basisSequence &&
        value.event === milestone.event && value.atMs >= milestone.atMs);
    if (!commit) return null;
    const patched = structuredClone(base);
    // This timestamp represents the film cue, while all unlisted state remains
    // frozen at the segment source to avoid leaking unrelated future changes.
    patched.elapsedMs = commit.atMs;
    patched.actionCommits = [...base.actionCommits, { ...commit }].slice(-64);
    if (milestone.event === "arrive") {
        if (!projection.destination || candidate.location !== projection.destination || candidate.phase === "walking") return null;
        patched.location = candidate.location;
        patched.phase = "arrived";
        // Arrival moves carried inventory too. Reconstruct that single physical
        // consequence from the source shot instead of copying a later phone
        // location from the proof snapshot.
        if (base.mara.heldPhone)
            patched.phone = { ...base.phone, room: projection.destination };
    }
    else if (milestone.event === "pickup") {
        if (!candidate.mara.heldPhone) return null;
        patched.phase = "holding";
        patched.mara = { ...base.mara, heldPhone: true };
        // Pickup does not move Mara. A much later proof shot may show her in a
        // different room, so derive the phone's exact post-pickup placement.
        patched.phone = { ...base.phone, location: "Mara", room: base.location,
            placement: "held in Mara's hand, never in a pocket" };
    }
    else if (milestone.event === "read") {
        const before = base.messages.find(message => message.id === commit.messageId &&
            message.direction === "in" && message.status === "delivered");
        const after = candidate.messages.find(message => message.id === commit.messageId &&
            message.direction === "in" && message.status === "read");
        if (!before || !after || base.phone.unread < 1 || candidate.mara.readCount <= base.mara.readCount) return null;
        const unread = base.phone.unread - 1;
        patched.phase = "read";
        patched.messages = base.messages.map(message => message.id === before.id ?
            { ...message, status: "read", readMs: commit.atMs } : message);
        patched.mara = { ...base.mara, readCount: base.mara.readCount + 1 };
        patched.phone = { ...base.phone, unread,
            reminding: base.phone.battery > 0 && !base.phone.silent && unread > 0,
            buzzing: unread > 0 && base.phone.buzzing };
        patched.screen = { body: before.body, typing: false, receivedBody: null };
    }
    else if (milestone.event === "send") {
        const alreadyPresent = base.messages.some(message => message.id === commit.messageId);
        const reply = candidate.messages.find(message => message.id === commit.messageId &&
            message.direction === "out" && ["queued", "delivered"].includes(message.status));
        if (alreadyPresent || !reply || reply.createdMs !== commit.atMs) return null;
        // Pressing send and network delivery are distinct facts. If an offline
        // reply was delivered only in a later proof shot, do not pull that
        // delivery receipt backward to the film's earlier send cue.
        const delivered = reply.status === "delivered" && reply.deliveredMs >= 0 && reply.deliveredMs <= commit.atMs;
        patched.phase = "sent";
        patched.messages = [...base.messages, { ...reply, status: delivered ? "delivered" : "queued",
            deliveredMs: delivered ? reply.deliveredMs : -1, readMs: -1 }];
        patched.screen = { body: reply.body, typing: false, receivedBody: base.screen?.receivedBody ?? null };
    }
    else {
        if (candidate.door !== "open" || candidate.location !== "Basement") return null;
        patched.phase = "basement";
        patched.door = "open";
        patched.location = "Basement";
        if (base.mara.heldPhone)
            patched.phone = { ...base.phone, room: "Basement" };
    }
    return patched;
}

/** Keep UI state on the segment's committed source snapshot, except for one
 * narrowly authorized intra-segment transition. Once the playhead reaches the
 * model's projected cue, an already-observed later snapshot must independently
 * prove that exact milestone. A cancelled forecast therefore never leaks into
 * the audience presentation, and private read/reply text remains unavailable
 * until the committed proof exists. */
export function presentationAtPlayback<T extends ProjectedPresentationShot>(shots: T[], chunks: PlaybackChunk[],
    seconds: number): PlaybackPresentation<T> {
    const mapped = shotAtPlayback(shots, chunks, seconds);
    const base = mapped.shot;
    if (!base)
        return { ...mapped, presentation: null, presentationVersion: null, projectedTransition: false };
    const unchanged = { ...mapped, presentation: base.presentation,
        presentationVersion: base.version, projectedTransition: false };
    const chunk = [...chunks].reverse().find(candidate => seconds >= candidate.start);
    const projection = base.projection;
    const milestone = projection?.milestone;
    if (!mapped.matched || !chunk || !milestone || !Number.isFinite(milestone.inMs) ||
        seconds < chunk.start + milestone.inMs / 1000)
        return unchanged;
    let proof: T | undefined, patched: PhonePresentation | null = null;
    for (const candidate of [...shots].sort((a, b) => a.sourceMs - b.sourceMs || a.version - b.version)) {
        if (candidate.version <= base.version) continue;
        if (candidate.sourceMs >= milestone.atMs && (patched = milestonePatch(base.presentation,
            candidate.presentation, projection, milestone))) {
            proof = candidate;
            break;
        }
    }
    return proof && patched ? { ...mapped, presentation: patched, presentationVersion: proof.version,
        projectedTransition: true } : unchanged;
}

export function audienceMessages(live: PhoneSnapshot["messages"], view: PhonePresentation | null) {
    const filmed = new Map(view?.messages.map(m => [m.id, m]) ?? []);
    // The viewer knows what they typed immediately. Delivery/read acknowledgments
    // and NPC replies are revealed only when the film reaches their source state.
    const incoming = live.filter(m => m.direction === "in").map(m => filmed.get(m.id) ?? {
        ...m, status: "awaiting scene", deliveredMs: -1, readMs: -1,
    });
    const outgoing = (view?.messages ?? []).filter(m => m.direction === "out" && m.status === "delivered");
    return [...incoming, ...outgoing].sort((a, b) => a.createdMs - b.createdMs || a.id - b.id);
}
