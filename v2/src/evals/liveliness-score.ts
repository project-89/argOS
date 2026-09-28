/**
 * Offline liveliness scorer for recorded Argos simulation runs.
 *
 * Reads a recording directory (read-only), adapts whatever recording files it
 * contains into one common event model, and computes liveliness metrics plus a
 * transparent composite `alivenessIndex` (0-100). No provider calls, no world
 * construction: this is pure file analysis so it can be run on any past or
 * future recording and compared side by side.
 *
 * Usage:
 *   npx tsx src/evals/liveliness-score.ts <recordingDir> [more dirs] [--json out.json]
 *   npm run eval:liveliness -- recordings/town-crisis-live-of3NLe
 *
 * Recording formats differ between runs. Adapters (in priority order per
 * signal) are tolerant of missing files and of both "flat" and wrapped shapes:
 *   - operator-events.jsonl  ({id, atSimMs, kind, text}) committed action/speech/world feed
 *   - session.json           (spatial client snapshot; `events` is a bounded window of the
 *                             last ~100 feed entries, `townLife.changes/story`, `actors`)
 *   - chronicle.jsonl        ({scope, observedAtSimMs, entry:{type, data}}) decisions,
 *                             conversations (full line + addressee), goals, rejections
 *   - receipts.jsonl         ({event:{kind, action, status, text, executionId, ...}}) public
 *                             receipts; speech arrives as word chunks reassembled by executionId
 *   - thoughts.jsonl         ({actor, text, atSimMs})
 *   - narrator-reviews.jsonl (flat status, or {capturedAtSimMs, status:{...}})
 *   - world-changes.jsonl    (flat change, or {capturedAtSimMs, change:{...}})
 *   - injections.jsonl       (operator-scheduled injections)
 *   - phone-events.jsonl     (resident phone traffic)
 *   - god-reviews.jsonl      (God autopilot review cycles)
 *   - samples.jsonl          (periodic snapshots; goal-key fallback + evolution totals)
 *   - result.json            (run summary; simulationMs)
 *   - optional future files: narrator-prose.jsonl / story-feed.jsonl / narration.jsonl,
 *     whispers.jsonl / daemon-whispers.jsonl, builds.jsonl
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// ─── Common event model ─────────────────────────────────────────────────────

export type LivelinessEventKind =
  | "action"
  | "speech"
  | "thought"
  | "goal_created"
  | "goal_completed"
  | "narrator_review"
  | "narrator_intervention"
  | "narrator_prose"
  | "world_event"
  | "build"
  | "whisper"
  | "rejection";

export interface LivelinessEvent {
  tSimMs: number;
  actor?: string;
  kind: LivelinessEventKind;
  /** Verb for actions (wait, move, examine...), sub-type for other kinds. */
  actionType?: string;
  content?: string;
  target?: string;
  success?: boolean;
  /** Which recording file/adapter produced this event, or who authored it (world events). */
  source: string;
  room?: string;
  /** Adapter-specific extras (end time, phase, tension, origin...). */
  meta?: Record<string, unknown>;
}

export type Coverage = "full" | "session-window" | "empty";

export interface RecordingEvents {
  dir: string;
  name: string;
  coverage: Coverage;
  events: LivelinessEvent[];
  residents: string[];
  /** Span used for per-minute speech/action rates (the event window for session-window recordings). */
  durationSimMs: number;
  /** Whole-run length; world/narrator logs (e.g. townLife.changes) cover the whole run even when the feed is windowed. */
  runSimMs: number;
  sources: Record<string, string>;
  evolutionTotals?: Record<string, number>;
  counters: { phoneRepliesSent: number; godReviews: number };
  notes: string[];
}

// ─── Output shape ───────────────────────────────────────────────────────────

export interface LexiconHit { speech: number; thoughts: number; total: number; examples: string[] }

export interface CompositeComponent { weight: number; value: number | null; points: number; available: boolean; note: string }

export interface LivelinessScore {
  name: string;
  dir: string;
  coverage: Coverage;
  sources: Record<string, string>;
  notes: string[];
  residents: number;
  /** Minutes used for speech/action rates (event window for session-window recordings). */
  simMinutes: number;
  /** Whole-run minutes, used for world/narrator rates. */
  runMinutes: number;
  actions: {
    chosen: number;
    waitRest: number;
    waitRestShare: number | null;
    failures: number;
    histogram: Record<string, number>;
    decisionHistogram?: Record<string, number>;
    decisionWaitRestShare?: number | null;
  };
  speech: {
    lines: number;
    perResidentMinute: number | null;
    meanWordsPerLine: number | null;
    distinctLineRatio: number | null;
    lexicalDiversityTTR: number | null;
    lexicalDiversityMATTR: number | null;
    topicEcho: number | null;
    speakers: number;
  };
  exchanges: { turnPairs: number; distinctPairs: number; perResidentMinute: number | null };
  thoughts: { count: number };
  drama: { conflict: LexiconHit; disclosure: LexiconHit; fear: LexiconHit; deflation: LexiconHit; dramaDensity: number | null; deflationDensity: number | null };
  goals: { created: number | null; completed: number | null; completedNative: number | null; completedSubjective: number | null; completedOther: number | null; source: string };
  narrator: {
    reviews: number;
    reviewsAccepted: number;
    interventionsRequested: number;
    interventionsAccepted: number;
    interventionsCommitted: number;
    proseProduced: number;
    proseShown: number;
    tensionStart: number | null;
    tensionEnd: number | null;
    tensionMax: number | null;
    tensionTrajectory: Array<{ tSimMs: number; tension: number; phase?: string }>;
  };
  world: {
    committedBy: Record<string, number>;
    nonOperatorCommitted: number;
    operatorCommitted: number;
    builds: number;
    buildProposals: number;
    buildRejections: number;
    whispersDelivered: number;
    operatorWhispers: number;
    phoneRepliesSent: number;
    godReviews: number;
    rejections: number;
  };
  alivenessIndex: number;
  composite: Record<string, CompositeComponent>;
}

// ─── Small utilities ────────────────────────────────────────────────────────

type Json = Record<string, any>;

function isObj(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readJson(file: string): Json | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return isObj(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Stream a JSONL file line by line (recordings can be tens of MB). Bad lines are skipped. */
async function forEachJsonl(file: string, visit: (row: Json) => void): Promise<boolean> {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (isObj(row)) visit(row);
    } catch {
      /* tolerate partial trailing lines */
    }
  }
  return true;
}

function firstExisting(dir: string, names: string[]): string | undefined {
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

const WAIT_REST = new Set(["wait", "rest", "idle", "sleep"]);

// ─── Adapters ───────────────────────────────────────────────────────────────

/** Parse an operator/session feed line ({atSimMs, kind, text}) into model events. */
export function parseFeedEntry(entry: Json, source: string): LivelinessEvent[] {
  const t = num(entry.atSimMs) ?? 0;
  const kind = str(entry.kind) ?? "";
  const text = str(entry.text) ?? "";
  if (kind === "action") {
    // "Ada: examine Net House supplies box · completed" | "Ada: wait · completed"
    const instant = /^(.+?): (\S+)(?: (.+?))? · (\w+)$/.exec(text);
    if (instant) {
      return [{ tSimMs: t, actor: instant[1], kind: "action", actionType: instant[2], target: instant[3], success: instant[4] === "completed" ? true : instant[4] === "failed" ? false : undefined, source, meta: { phase: "instant", status: instant[4] } }];
    }
    // "Ivo begins pickup Ivo's phone"
    const begins = /^(.+?) begins (\S+)(?: (.+))?$/.exec(text);
    if (begins) return [{ tSimMs: t, actor: begins[1], kind: "action", actionType: begins[2], target: begins[3], source, meta: { phase: "begin" } }];
    return [];
  }
  if (kind === "failed") {
    const m = /^(.+?): (.*)$/.exec(text);
    return [{ tSimMs: t, actor: m?.[1], kind: "action", actionType: "outcome", content: m?.[2] ?? text, success: false, source, meta: { phase: "outcome" } }];
  }
  if (kind === "speech") {
    const m = /^(.+?): (.*)$/s.exec(text);
    if (!m) return [];
    return [{ tSimMs: t, actor: m[1], kind: "speech", actionType: "speak", content: m[2].trim(), source, meta: { endMs: t } }];
  }
  if (kind === "operator") {
    const planted = /^Planted a thought for (.+?)\.?$/.exec(text);
    if (planted) return [{ tSimMs: t, actor: planted[1], kind: "whisper", source: "operator", content: text }];
    const phone = /^Operator sent a text to (.+?)'s/.exec(text);
    if (phone) return [{ tSimMs: t, target: phone[1], kind: "world_event", actionType: "phone_text", source: "operator", content: text, success: true }];
    return [{ tSimMs: t, kind: "world_event", actionType: "operator", source: "operator", content: text, success: true, meta: { forcedAction: /^Explicit operator action/.test(text) } }];
  }
  if (kind === "world-control") {
    return [{ tSimMs: t, kind: "world_event", actionType: "world_control", source: "operator", content: text, success: /· applied/.test(text) }];
  }
  if (kind === "growth" || kind === "engineering") {
    return [{ tSimMs: t, kind: "build", actionType: kind, source: /operator/i.test(text) ? "operator" : "spirits", content: text, success: /installed|built|applied/i.test(text) }];
  }
  if (kind === "world") {
    return [{ tSimMs: t, kind: "world_event", actionType: "consequence", source: "world_feed", content: text, success: true }];
  }
  if (kind === "whisper" || kind === "daemon") {
    const m = /^(.+?): (.*)$/.exec(text);
    return [{ tSimMs: t, actor: m?.[1], kind: "whisper", source: "daemon", content: m?.[2] ?? text }];
  }
  if (kind === "story" || kind === "narration" || kind === "narrator" || kind === "prose") {
    return [{ tSimMs: t, kind: "narrator_prose", source: "viewer_feed", content: text, meta: { shown: true } }];
  }
  return [];
}

/** Classify a world-change author (`spirit` field) into a coarse authority bucket. */
export function classifyAuthor(spirit: string | undefined, origin?: string): string {
  const s = (spirit ?? "").toLowerCase();
  if (origin === "operator" || /operator/.test(s)) return "operator";
  if (/narrator/.test(s)) return "narrator";
  if (/^god/.test(s)) return "god";
  if (/resident/.test(s)) return "residents";
  if (/system|weather/.test(s)) return "system";
  if (s) return "spirits";
  return "unknown";
}

/** Adapt one world-change record (flat or wrapped) into model events. */
export function worldChangeToEvents(raw: Json, source: string): LivelinessEvent[] {
  const change = isObj(raw.change) ? raw.change : raw;
  const id = str(change.id) ?? "";
  const status = str(change.status) ?? "";
  const t = num(change.atSimMs) ?? num(raw.capturedAtSimMs) ?? 0;
  const summary = str(change.summary) ?? "";
  const author = classifyAuthor(str(change.spirit), str(change.origin));
  // Narrator/Weaver reviews recorded as world changes are observations, not commitments.
  if (/^narrator-review:/.test(id)) return [narratorReviewFromSummary(t, summary, status, source)];
  if (/^review:/.test(id) && status === "observed") return [];
  if (/^build:/.test(id)) return [{ tSimMs: t, kind: "build", actionType: "build", source: author, content: summary, success: status === "applied" || status === "built" }];
  if (/^proposal:/.test(id)) {
    const stage = /:(\w+)$/.exec(id)?.[1] ?? status;
    return [{ tSimMs: t, kind: "build", actionType: `proposal_${stage}`, source: author, content: summary, success: stage !== "rejected" && stage !== "failed" }];
  }
  if (status === "rejected" || status === "failed") return [{ tSimMs: t, kind: "rejection", actionType: `world_change_${status}`, source: author, content: summary, success: false }];
  if (status === "applied" || status === "used" || status === "committed") {
    return [{ tSimMs: t, kind: "world_event", actionType: /^(\w+)/.exec(id)?.[1] ?? "change", source: author, content: summary, success: true, meta: { status } }];
  }
  return [];
}

function narratorReviewFromSummary(t: number, summary: string, status: string, source: string): LivelinessEvent {
  const requested = Number(/(\d+) interventions? requested/.exec(summary)?.[1] ?? 0);
  const results = /requested \(([^)]*)\)/.exec(summary)?.[1]?.split(/,\s*/).filter(Boolean) ?? [];
  const phase = /Story interpretation: (\w+)/.exec(summary)?.[1];
  return { tSimMs: t, kind: "narrator_review", source, success: status !== "failed", meta: { accepted: status !== "failed", interventionsRequested: requested, interventionResults: results, phase } };
}

/** Adapt one narrator-review record (flat status or {status:{...}}) into model events. */
export function narratorReviewToEvents(raw: Json, source: string): LivelinessEvent[] {
  const status = isObj(raw.status) ? raw.status : raw;
  const t = num(status.atSimMs) ?? num(raw.capturedAtSimMs) ?? 0;
  const results = Array.isArray(status.interventionResults) ? status.interventionResults.map((r: unknown) => (typeof r === "string" ? r : isObj(r) ? str(r.status) ?? str(r.outcome) ?? "unknown" : "unknown")) : [];
  const events: LivelinessEvent[] = [{
    tSimMs: t, kind: "narrator_review", source, success: status.accepted !== false,
    meta: { accepted: status.accepted !== false, interventionsRequested: num(status.interventionsRequested) ?? 0, interventionResults: results, phase: str(status.phase), tension: num(status.tension) },
  }];
  // Future-proof: prose produced by the review, optionally flagged as shown to the viewer.
  const prose = status.prose ?? status.narration ?? status.storyProse;
  const proseItems = typeof prose === "string" ? [prose] : Array.isArray(prose) ? prose : [];
  for (const item of proseItems) {
    const text = typeof item === "string" ? item : isObj(item) ? str(item.text) : undefined;
    if (text) events.push({ tSimMs: t, kind: "narrator_prose", source, content: text, meta: { shown: isObj(item) ? item.shown === true || item.delivered === true : status.proseShown === true } });
  }
  return events;
}

/** Chronicle entry ({observedAtSimMs, entry:{type,data}}) → model events. */
export function chronicleToEvents(row: Json): LivelinessEvent[] {
  const entry = isObj(row.entry) ? row.entry : row;
  const type = str(entry.type) ?? "";
  const data = isObj(entry.data) ? entry.data : {};
  const t = num(row.observedAtSimMs) ?? num(data.atSimMs) ?? 0;
  const source = "chronicle";
  switch (type) {
    case "llm_decision":
    case "contract_decision":
      return [{ tSimMs: t, actor: str(data.agent), kind: "action", actionType: str(data.actionType) ?? "unknown", target: str(data.target), source, meta: { phase: "decision", origin: str(data.origin), decisionType: type } }];
    case "conversation": {
      const sim = isObj(data.simulation) ? data.simulation : {};
      return [{ tSimMs: num(sim.startedAtSimMs) ?? t, actor: str(data.speaker), kind: "speech", actionType: "speak", target: str(data.target), content: str(data.content), source, meta: { endMs: num(sim.completedAtSimMs) ?? num(sim.expectedEndSimMs) ?? t } }];
    }
    case "autonomous_goal":
    case "goal_created":
      return [{ tSimMs: t, actor: str(data.agent), kind: "goal_created", content: str(data.goal), actionType: str(data.kind), source }];
    case "goal_completed":
      return [{ tSimMs: t, actor: str(data.agent), kind: "goal_completed", content: str(data.goal), actionType: str(data.source) ?? "unknown", success: true, source }];
    case "decision_rejected":
      return [{ tSimMs: t, actor: str(data.agent), kind: "rejection", actionType: str(data.reason) ?? "decision_rejected", source, success: false }];
    case "action_failure":
      return [{ tSimMs: t, actor: str(data.agent), kind: "action", actionType: "outcome", target: str(data.target), success: false, source, meta: { phase: "outcome", verb: str(data.action) } }];
    default:
      if (/whisper|daemon_nudge|daemon_perception/.test(type)) return [{ tSimMs: t, actor: str(data.agent) ?? str(data.actor), kind: "whisper", content: str(data.text) ?? str(data.content), source: "daemon" }];
      if (/prose|narration/.test(type)) return [{ tSimMs: t, kind: "narrator_prose", content: str(data.text) ?? str(data.prose), source, meta: { shown: data.shown === true || data.delivered === true } }];
      return [];
  }
}

interface SpeechAccumulator { actor?: string; room?: string; start: number; end: number; parts: Array<{ seq: number; text: string }>; completed: boolean }

/** Reassemble chunked speech receipts into whole lines, and collect non-speech receipts as actions. */
async function readReceipts(file: string): Promise<{ speech: LivelinessEvent[]; actions: LivelinessEvent[] }> {
  const speech = new Map<string, SpeechAccumulator>();
  const actions: LivelinessEvent[] = [];
  await forEachJsonl(file, row => {
    const e = isObj(row.event) ? row.event : row;
    const kind = str(e.kind);
    const t = num(e.atSimMs) ?? 0;
    if (kind === "speech") {
      const key = str(e.executionId) ?? `${e.actorName}:${e.startedAtSimMs}`;
      let acc = speech.get(key);
      if (!acc) { acc = { actor: str(e.actorName), room: str(e.roomName), start: num(e.startedAtSimMs) ?? t, end: t, parts: [], completed: false }; speech.set(key, acc); }
      if (typeof e.text === "string") acc.parts.push({ seq: num(e.sequence) ?? acc.parts.length, text: e.text });
      acc.end = Math.max(acc.end, num(e.completedAtSimMs) ?? t);
      if (e.completedAtSimMs !== undefined) acc.completed = true;
    } else if (kind === "action" && e.status !== "pending") {
      actions.push({ tSimMs: t, actor: str(e.actorName), kind: "action", actionType: str(e.action) ?? "unknown", target: str(e.targetName), room: str(e.roomName), success: e.status === "succeeded", source: "receipts", meta: { phase: "instant", status: e.status } });
    }
  });
  const lines: LivelinessEvent[] = [];
  for (const acc of speech.values()) {
    const content = acc.parts.sort((a, b) => a.seq - b.seq).map(p => p.text).join("").trim();
    if (!content) continue;
    lines.push({ tSimMs: acc.start, actor: acc.actor, kind: "speech", actionType: "speak", content, room: acc.room, source: "receipts", meta: { endMs: acc.end, completed: acc.completed } });
  }
  return { speech: lines, actions };
}

/** Load a recording directory into the common event model. Read-only. */
export async function loadRecording(dirInput: string): Promise<RecordingEvents> {
  const dir = resolve(dirInput);
  const name = basename(dir);
  const notes: string[] = [];
  const sources: Record<string, string> = {};
  const events: LivelinessEvent[] = [];
  const session = readJson(join(dir, "session.json"));
  const result = readJson(join(dir, "result.json"));

  // 1. Committed action/speech feed: operator-events.jsonl (full) or session.json events (window).
  const feed: LivelinessEvent[] = [];
  let coverage: Coverage = "empty";
  const feedFile = join(dir, "operator-events.jsonl");
  if (await forEachJsonl(feedFile, row => feed.push(...parseFeedEntry(row, "operator-events")))) {
    coverage = "full";
    sources.feed = "operator-events.jsonl";
  } else if (session && Array.isArray(session.events) && session.events.length > 1) {
    for (const row of session.events) if (isObj(row)) feed.push(...parseFeedEntry(row, "session"));
    coverage = "session-window";
    sources.feed = "session.json events (bounded window)";
    notes.push("Only the spatial session's bounded event window (last ~100 feed entries) is recorded; rates use the window span.");
  }

  // 2. Chronicle (decisions, conversations with addressee, goals, rejections).
  const chronicle: LivelinessEvent[] = [];
  const hasChronicle = await forEachJsonl(join(dir, "chronicle.jsonl"), row => chronicle.push(...chronicleToEvents(row)));
  if (hasChronicle) sources.chronicle = "chronicle.jsonl";

  // 3. Receipts (full speech lines by reassembly; action outcomes).
  let receipts: { speech: LivelinessEvent[]; actions: LivelinessEvent[] } = { speech: [], actions: [] };
  if (existsSync(join(dir, "receipts.jsonl"))) receipts = await readReceipts(join(dir, "receipts.jsonl"));

  // Actions: the committed feed (includes wait/rest). Fall back to chronicle decisions, then receipts.
  const feedActions = feed.filter(e => e.kind === "action");
  const chronicleDecisions = chronicle.filter(e => e.kind === "action" && e.meta?.phase === "decision");
  if (feedActions.length > 0) {
    events.push(...feedActions);
    sources.actions = sources.feed;
  } else if (chronicleDecisions.length > 0) {
    events.push(...chronicleDecisions);
    sources.actions = "chronicle.jsonl llm_decision";
  } else if (receipts.actions.length > 0) {
    events.push(...receipts.actions);
    sources.actions = "receipts.jsonl (no wait/rest visibility)";
    notes.push("Actions come from public receipts, which do not record wait/rest; waitRestShare is a lower bound.");
  }
  // Keep chronicle decisions available separately (tagged) for the decision histogram.
  if (feedActions.length > 0 && chronicleDecisions.length > 0) {
    for (const d of chronicleDecisions) events.push({ ...d, meta: { ...d.meta, shadow: true } });
  }
  events.push(...chronicle.filter(e => e.kind === "action" && e.meta?.phase === "outcome" && feedActions.length === 0));

  // Speech: chronicle conversation (full + addressee) > receipts reassembly > session feed > operator feed (truncated).
  const chronicleSpeech = chronicle.filter(e => e.kind === "speech");
  const feedSpeech = feed.filter(e => e.kind === "speech");
  if (chronicleSpeech.length > 0) {
    // Room is not on conversation entries; borrow it from matching receipts when present.
    const roomByStart = new Map(receipts.speech.map(s => [`${s.actor}@${s.tSimMs}`, s.room]));
    for (const s of chronicleSpeech) events.push({ ...s, room: roomByStart.get(`${s.actor}@${s.tSimMs}`) });
    sources.speech = "chronicle.jsonl conversation";
  } else if (receipts.speech.length > 0) {
    events.push(...receipts.speech);
    sources.speech = "receipts.jsonl (reassembled chunks)";
  } else if (feedSpeech.length > 0) {
    events.push(...feedSpeech);
    sources.speech = sources.feed ?? "feed";
    if (sources.feed === "operator-events.jsonl") notes.push("Speech text in operator-events is only the first streamed chunk; text metrics are unreliable.");
  }

  // Thoughts.
  const thoughtsFile = join(dir, "thoughts.jsonl");
  if (await forEachJsonl(thoughtsFile, row => {
    const text = str(row.text) ?? str(row.thought) ?? str(row.content);
    if (text) events.push({ tSimMs: num(row.atSimMs) ?? 0, actor: str(row.actor) ?? str(row.agent), kind: "thought", content: text, source: "thoughts" });
  })) sources.thoughts = "thoughts.jsonl";
  else if (session && Array.isArray(session.actors)) {
    for (const actor of session.actors) {
      const th = isObj(actor?.thought) ? actor.thought : undefined;
      const text = th ? str(th.text) : undefined;
      if (text) events.push({ tSimMs: num(th!.atSimMs) ?? 0, actor: str(actor.name), kind: "thought", content: text, source: "session.actors" });
    }
    sources.thoughts = "session.json actors[].thought (latest only)";
  }

  // Goals: chronicle (created + completed with source); fallback to samples goal keys (created only).
  events.push(...chronicle.filter(e => e.kind === "goal_created" || e.kind === "goal_completed" || e.kind === "rejection" || e.kind === "whisper" || e.kind === "narrator_prose"));
  if (chronicle.some(e => e.kind === "goal_created" || e.kind === "goal_completed")) sources.goals = "chronicle.jsonl";

  let evolutionTotals: Record<string, number> | undefined;
  const samplesFile = join(dir, "samples.jsonl");
  if (existsSync(samplesFile)) {
    const seen = new Set<string>();
    let first = true;
    const created: LivelinessEvent[] = [];
    await forEachJsonl(samplesFile, row => {
      const t = num(row.simMs) ?? 0;
      const actors = Array.isArray(row.actors) ? row.actors : [];
      for (const a of actors) for (const g of Array.isArray(a?.goals) ? a.goals : []) {
        const key = str(g?.key) ?? String(g?.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!first) created.push({ tSimMs: t, actor: str(a.name), kind: "goal_created", content: str(g.description), source: "samples" });
      }
      if (actors.length > 0) first = false;
      if (isObj(row.evolution) && isObj(row.evolution.totals)) {
        evolutionTotals = {};
        for (const [k, v] of Object.entries(row.evolution.totals)) if (typeof v === "number") evolutionTotals[k] = v;
      }
    });
    if (!sources.goals && created.length > 0) {
      events.push(...created);
      sources.goals = "samples.jsonl (new goal keys; completion not observable)";
    }
  }

  // Narrator reviews.
  let narratorCount = 0;
  if (await forEachJsonl(join(dir, "narrator-reviews.jsonl"), row => { const ev = narratorReviewToEvents(row, "narrator-reviews"); narratorCount++; events.push(...ev); })) {
    sources.narrator = "narrator-reviews.jsonl";
  }

  // World changes: world-changes.jsonl > session.townLife.changes. Narrator reviews in them only if none above.
  const worldChanges: LivelinessEvent[] = [];
  if (await forEachJsonl(join(dir, "world-changes.jsonl"), row => worldChanges.push(...worldChangeToEvents(row, "world-changes")))) {
    sources.world = "world-changes.jsonl";
  } else if (session && isObj(session.townLife) && Array.isArray(session.townLife.changes)) {
    for (const row of session.townLife.changes) if (isObj(row)) worldChanges.push(...worldChangeToEvents(row, "session.townLife"));
    sources.world = "session.json townLife.changes (bounded)";
  }
  for (const w of worldChanges) {
    if (w.kind === "narrator_review") {
      if (narratorCount === 0) events.push(w);
    } else events.push(w);
  }
  if (narratorCount === 0 && worldChanges.some(w => w.kind === "narrator_review")) sources.narrator = `${sources.world} narrator-review summaries`;
  // Final tension from session story when reviews did not record it.
  const story = session && isObj(session.townLife) && isObj(session.townLife.story) ? session.townLife.story : undefined;
  if (story && num(story.tension) !== undefined && !events.some(e => e.kind === "narrator_review" && num(e.meta?.tension) !== undefined)) {
    events.push({ tSimMs: num(story.lastReviewAtSimMs) ?? num(session?.atSimMs) ?? 0, kind: "narrator_review", source: "session.townLife.story", meta: { summaryOnly: true, tension: num(story.tension), phase: str(story.phase) } });
  }

  // Operator injections (authoritative for operator world pressure); else operator lines from the feed.
  const injections: LivelinessEvent[] = [];
  if (await forEachJsonl(join(dir, "injections.jsonl"), row => {
    const res = isObj(row.result) ? row.result : {};
    injections.push({ tSimMs: num(row.actualAtSimMs) ?? num(row.at) ?? 0, kind: "world_event", actionType: str(row.kind) ?? "injection", target: str(row.actor) ?? str(row.room), source: "operator", success: res.status ? res.status === "applied" : true, content: str(row.text) ?? str(res.detail) });
  })) {
    sources.operator = "injections.jsonl";
    // Injected weather/branches also appear in world-changes as "God · operator ..."; keep only text injections from here.
    events.push(...injections.filter(e => e.actionType === "text" || !worldChanges.some(w => w.source === "operator")));
  } else {
    events.push(...feed.filter(e => e.source === "operator" && e.kind === "world_event"));
  }
  events.push(...feed.filter(e => e.kind === "whisper" || e.kind === "narrator_prose" || e.kind === "build"));
  // Feed world consequences only when no attributed world-change log exists.
  if (!sources.world) events.push(...feed.filter(e => e.kind === "world_event" && e.source === "world_feed"));

  // Phone replies sent by residents.
  let phoneReplies = 0;
  await forEachJsonl(join(dir, "phone-events.jsonl"), row => { if (row.direction === "out" && (row.status === "sent" || row.status === "delivered")) phoneReplies++; });

  // God autopilot review cycles.
  let godReviews = 0;
  await forEachJsonl(join(dir, "god-reviews.jsonl"), () => { godReviews++; });

  // Optional future files.
  const proseFile = firstExisting(dir, ["narrator-prose.jsonl", "story-feed.jsonl", "narration.jsonl"]);
  if (proseFile) {
    await forEachJsonl(proseFile, row => {
      const text = str(row.text) ?? str(row.prose) ?? str(row.content);
      if (text) events.push({ tSimMs: num(row.atSimMs) ?? 0, kind: "narrator_prose", content: text, source: basename(proseFile), meta: { shown: row.shown === true || row.delivered === true || /story-feed/.test(proseFile) } });
    });
    sources.prose = basename(proseFile);
  }
  const whisperFile = firstExisting(dir, ["whispers.jsonl", "daemon-whispers.jsonl"]);
  if (whisperFile) {
    await forEachJsonl(whisperFile, row => {
      const delivered = row.delivered !== false && row.status !== "rejected" && row.status !== "dropped";
      if (delivered) events.push({ tSimMs: num(row.atSimMs) ?? 0, actor: str(row.actor) ?? str(row.agent), kind: "whisper", content: str(row.text), source: str(row.origin) === "operator" ? "operator" : "daemon" });
    });
    sources.whispers = basename(whisperFile);
  }
  await forEachJsonl(join(dir, "builds.jsonl"), row => {
    events.push({ tSimMs: num(row.atSimMs) ?? 0, kind: "build", actionType: "build", source: classifyAuthor(str(row.spirit) ?? str(row.author), str(row.origin)), content: str(row.summary) ?? str(row.name), success: row.status ? row.status === "applied" || row.status === "built" : true });
  });

  events.sort((a, b) => a.tSimMs - b.tSimMs);

  // Residents: session actors, else distinct actors in feed actions/speech.
  const residentSet = new Set<string>();
  if (session && Array.isArray(session.actors)) for (const a of session.actors) { const n = str(a?.name); if (n) residentSet.add(n); }
  if (residentSet.size === 0 && result && Array.isArray(result.actors)) for (const a of result.actors) { const n = str(a?.name); if (n) residentSet.add(n); }
  if (residentSet.size === 0) for (const e of events) if ((e.kind === "action" || e.kind === "speech") && e.actor) residentSet.add(e.actor);

  // Duration: full recordings use run length; session windows use the window span.
  const times = events.filter(e => e.kind === "action" || e.kind === "speech").map(e => e.tSimMs);
  let durationSimMs = 0;
  if (coverage === "session-window") {
    durationSimMs = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  } else {
    durationSimMs = Math.max(num(result?.simulationMs) ?? 0, num(session?.atSimMs) ?? 0, times.length ? Math.max(...times) : 0);
  }
  if (coverage === "empty" && events.length > 0) coverage = "full";
  const runSimMs = Math.max(durationSimMs, num(result?.simulationMs) ?? 0, num(session?.atSimMs) ?? 0);
  return { dir, name, coverage, events, residents: [...residentSet], durationSimMs, runSimMs, sources, evolutionTotals, counters: { phoneRepliesSent: phoneReplies, godReviews }, notes };
}

// ─── Text helpers ───────────────────────────────────────────────────────────

const STOPWORDS = new Set(("a an the and or but if so of to in on at by for with from as is are was were be been being it its it's this that these those " +
  "i me my we our you your he him his she her they them their there here what which who whom when where why how not no yes do does did done " +
  "have has had just then than too very can could would should will shall may might must i'm i'll i've i'd you're you'll we're they're let's " +
  "about into over under up down out off again all any some more most other such only own same also well oh yeah okay ok hey still even").split(/\s+/));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'’]*/g) ?? []).map(w => w.replace(/[’']+$/g, "").replace(/’/g, "'"));
}

function contentWords(text: string): Set<string> {
  return new Set(tokenize(text).filter(w => w.length >= 3 && !STOPWORDS.has(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Moving-average type/token ratio (window 50) — length-robust lexical diversity. */
export function mattr(tokens: string[], window = 50): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  let distinct = 0, sum = 0;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (counts.get(w) === 1) distinct++;
    if (i >= window) {
      const old = tokens[i - window];
      const c = (counts.get(old) ?? 0) - 1;
      counts.set(old, c);
      if (c === 0) distinct--;
    }
    if (i >= window - 1) sum += distinct / window;
  }
  return sum / (tokens.length - window + 1);
}

// ─── Drama lexicons ─────────────────────────────────────────────────────────

/** Conflict: accusation, distrust, confrontation. */
export const CONFLICT = /\b(accus\w*|liar|lied|lying to|a lie|lie to|lies to|why did you|why didn'?t you|don'?t trust|do not trust|you knew|hiding (something|it|the)|hid it|what are you hiding|blam\w+|how dare|stay away from|betray\w*|you took|stole|steal\w*|threaten\w*|furious|angry|suspect\w*|not telling (me|us)|tell me the truth|explain yourself|caught you)\b/i;
/** Disclosure / secret: confession, admission, revealed truth. */
export const DISCLOSURE = /\b(confess\w*|truth is|the truth|never told|i never said|secrets?|admit\w*|have to tell you|need to tell you|should have told|it was me|i did it|between us|don'?t tell (anyone|her|him)|keep (this|it) quiet|i saw (him|her|otis|leon|them))\b/i;
/** Fear / uncanny: the sea legend, knocks, dread, strangeness. */
export const FEAR = /\b(knocks?|knocking|drown\w*|sea|(?<!,\s*(?:i'?m|i am)\s+)afraid(?!\s+(?:so|not)\b)|scared|frighten\w*|fear\w*|voice\w*|fog|ghost\w*|haunt\w*|omen\w*|curse\w*|dread\w*|uncanny|eerie|shiver\w*|whisper\w*|shadow\w*|three hooks|hooked marks?|counting|owed|marrow star|storm|lost at sea|drowned|dead|grave)\b/i;
/** Deflation: talking the mystery down (known failure mode). */
export const DEFLATION = /(just old|just an? (old|ordinary|leftover|everyday)|nothing to (worry|fear|see)|nothing to it\b|no sense (in )?(turning|making|reading|spinning|worrying|fretting)|not an omen|no omen|(hardly|not|rather than|instead of|no) (an? |any )?(\w+ )?(omens?|portents?|curses?|legends?|ghost stor\w*|hauntings?)\b|(spin\w*|turn\w*|inflat\w*|mak\w*) [^.?!]{0,40}\binto\b [^.?!]{0,20}\b(omens?|portents?|legends?|curses?|mysteries|mystery)|rules? out|not every (old )?(thing|scratch|mark|scrape|nick|pot)|grand mystery|bigger puzzle|tall tales?|without inventing|ominous fantas\w*|(discard\w*|dismiss\w*) [^.?!]{0,30}(supernatural|omen|legend|mystery)|(ordinary|shed|plain|old|everyday) wear|wear and tear|worn scratches|(no|without( needing)?( a| any( more)?)?) mystery|nothing mysterious|grand conspiracy|nothing that justifies|jumping to (any )?conclusions|out of thin air|coincidence|everyday (wear|workshop)|workshop wear|just (wear|weather|a scratch|scratches|marks|the wind|means someone)|practical (daily )?mess|nothing more than|perfectly (normal|ordinary)|nothing (unusual|strange|sinister|supernatural|out of the ordinary)|don'?t read (too much )?into|no need to (worry|fret|panic)|rational explanation|plain explanation|not proof|old nick|keep (it|things) grounded)/i;

/** Machine scaffolding on reflective thoughts; stripped from report examples only. */
const RETROSPECTIVE_PREFIX = /^(Reflecting on the experience at \d+ms, not describing my present state|Looking back at earlier experiences through [^:]+\)): /;

function lexiconHits(pattern: RegExp, speech: LivelinessEvent[], thoughts: LivelinessEvent[], exclude?: RegExp): LexiconHit {
  const match = (e: LivelinessEvent) => !!e.content && pattern.test(e.content) && !(exclude && exclude.test(e.content));
  const s = speech.filter(match), t = thoughts.filter(match);
  const examples = [...s, ...t].slice(0, 1).map(e => {
    const text = e.content!.replace(RETROSPECTIVE_PREFIX, "");
    return `${e.actor ?? "?"}: ${text.length > 90 ? `${text.slice(0, 87)}...` : text}`;
  });
  return { speech: s.length, thoughts: t.length, total: s.length + t.length, examples };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

const REPLY_WINDOW_MS = 20_000;
const CONVERSATION_GAP_MS = 60_000;

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Infer an addressee by the first other-resident name mentioned in the line. */
export function inferAddressee(content: string | undefined, speaker: string | undefined, residents: string[]): string | undefined {
  if (!content) return undefined;
  let best: { name: string; at: number } | undefined;
  for (const name of residents) {
    if (name === speaker) continue;
    const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).exec(content);
    if (m && (!best || m.index < best.at)) best = { name, at: m.index };
  }
  return best?.name;
}

/**
 * Cross-resident exchanges: a line by B counts as a reply to A when it starts
 * within 20 s (sim) of A's line ending, A≠B, both lines are in the same room when
 * rooms are known, and addressing does not contradict (A addressed B, or A's
 * addressee is unknown, or B addressed A). Each A-line is answered at most once.
 */
export function countExchanges(lines: LivelinessEvent[], residents: string[]): { turnPairs: number; distinctPairs: number } {
  const sorted = [...lines].sort((a, b) => a.tSimMs - b.tSimMs);
  const answered = new Set<number>();
  const pairs = new Set<string>();
  let turnPairs = 0;
  for (let j = 0; j < sorted.length; j++) {
    const reply = sorted[j];
    const replyTarget = reply.target ?? inferAddressee(reply.content, reply.actor, residents);
    for (let i = j - 1; i >= 0; i--) {
      const prior = sorted[i];
      const priorEnd = num(prior.meta?.endMs) ?? prior.tSimMs;
      if (reply.tSimMs - priorEnd > REPLY_WINDOW_MS && reply.tSimMs - prior.tSimMs > REPLY_WINDOW_MS) break;
      if (!prior.actor || !reply.actor || prior.actor === reply.actor || answered.has(i)) continue;
      if (prior.room && reply.room && prior.room !== reply.room) continue;
      const priorTarget = prior.target ?? inferAddressee(prior.content, prior.actor, residents);
      const compatible = priorTarget === reply.actor || replyTarget === prior.actor || (priorTarget === undefined && (replyTarget === undefined || replyTarget === prior.actor));
      if (!compatible) continue;
      answered.add(i);
      turnPairs++;
      pairs.add([prior.actor, reply.actor].sort().join("↔"));
      break;
    }
  }
  return { turnPairs, distinctPairs: pairs.size };
}

/**
 * Topic echo: mean Jaccard similarity of content-word sets between consecutive
 * lines (different speakers) within the same conversation. A conversation is a
 * run of lines in the same room (or globally when rooms are unknown) with gaps
 * ≤ 60 s. High values mean agreement/echo chains ("Yes, just old marks." / "Old marks, yes.").
 */
export function topicEcho(lines: LivelinessEvent[]): number | null {
  const byRoom = new Map<string, LivelinessEvent[]>();
  for (const l of [...lines].sort((a, b) => a.tSimMs - b.tSimMs)) {
    const key = l.room ?? "*";
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key)!.push(l);
  }
  const scores: number[] = [];
  for (const seq of byRoom.values()) {
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (a.actor === b.actor) continue;
      if (b.tSimMs - (num(a.meta?.endMs) ?? a.tSimMs) > CONVERSATION_GAP_MS) continue;
      scores.push(jaccard(contentWords(a.content ?? ""), contentWords(b.content ?? "")));
    }
  }
  return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
}

/** Goal completion source classification. */
export function classifyGoalSource(source: string | undefined): "native" | "subjective" | "other" {
  const s = (source ?? "").toLowerCase();
  if (/subjective|social|review|self_report|judg/.test(s)) return "subjective";
  if (/native|outcome|physical|contract|need|state|satisf|receipt/.test(s)) return "native";
  return "other";
}

const COMMIT_RESULTS = /^(applied|committed|executed|succeeded|staged|delivered)$/i;
const ACCEPT_RESULTS = /^(accepted|applied|committed|executed|succeeded|staged|delivered|queued)$/i;

/**
 * Composite weights (sum 100 before penalty). Each component is normalized to
 * 0..1 against a saturation target, then multiplied by its weight. Components
 * whose inputs are not recorded are marked unavailable and the remaining weights
 * are rescaled to 100 so partial recordings stay comparable. Deflation is a
 * subtractive penalty (up to 15 points); waiting lowers the `activity` term.
 *
 *   activity   20  1 − waitRestShare
 *   speech     10  lines per resident-minute / 1.5
 *   language   10  ½·distinctLineRatio + ½·MATTR
 *   freshness   5  1 − topicEcho / 0.4 (echo chains lower it)
 *   exchanges  10  ½·(turn pairs per resident-minute / 0.5) + ½·(distinct pairs / residents)
 *   drama      20  (conflict+disclosure+fear lines) / (speech+thought lines) / 0.3
 *   goals      10  min(1, completed / residents) · (½ + ½·nativeShare)
 *   world      15  (Narrator commits + non-operator world events + builds + whispers) per run-minute / 1.0
 *   deflation −15  deflation lines / (speech+thought lines) / 0.4
 */
export const COMPOSITE_WEIGHTS = { activity: 20, speech: 10, language: 10, freshness: 5, exchanges: 10, drama: 20, goals: 10, world: 15 } as const;
export const DEFLATION_PENALTY = 15;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function scoreEvents(rec: RecordingEvents): LivelinessScore {
  const { events } = rec;
  const residents = rec.residents.length;
  const simMinutes = rec.durationSimMs / 60_000;
  const runMinutes = (rec.runSimMs ?? rec.durationSimMs) / 60_000;
  const residentMinutes = residents * simMinutes;
  const { phoneRepliesSent: phoneReplies, godReviews } = rec.counters;

  // Actions: chosen = begin/instant/decision entries (not outcomes, not shadow decisions).
  const chosen = events.filter(e => e.kind === "action" && e.meta?.phase !== "outcome" && !e.meta?.shadow);
  const histogram: Record<string, number> = {};
  for (const a of chosen) histogram[a.actionType ?? "unknown"] = (histogram[a.actionType ?? "unknown"] ?? 0) + 1;
  const speech = events.filter(e => e.kind === "speech" && e.content);
  // Speech is a chosen action too; feed-derived action streams omit it, decision streams include it.
  const actionsIncludeSpeak = chosen.some(a => a.actionType === "speak");
  if (!actionsIncludeSpeak && speech.length > 0) histogram.speak = speech.length;
  const chosenTotal = Object.values(histogram).reduce((s, v) => s + v, 0);
  const waitRest = Object.entries(histogram).filter(([k]) => WAIT_REST.has(k)).reduce((s, [, v]) => s + v, 0);
  const failures = events.filter(e => e.kind === "action" && e.success === false).length;
  const shadow = events.filter(e => e.kind === "action" && e.meta?.shadow);
  let decisionHistogram: Record<string, number> | undefined;
  let decisionWaitRestShare: number | null | undefined;
  if (shadow.length) {
    decisionHistogram = {};
    for (const d of shadow) decisionHistogram[d.actionType ?? "unknown"] = (decisionHistogram[d.actionType ?? "unknown"] ?? 0) + 1;
    const dw = Object.entries(decisionHistogram).filter(([k]) => WAIT_REST.has(k)).reduce((s, [, v]) => s + v, 0);
    decisionWaitRestShare = round(dw / shadow.length);
  }

  // Speech metrics.
  const tokensPerLine = speech.map(s => tokenize(s.content!));
  const allTokens = tokensPerLine.flat();
  const normalized = new Set(speech.map(s => s.content!.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()));
  const exchanges = countExchanges(speech, rec.residents);
  const echo = topicEcho(speech);
  const speakers = new Set(speech.map(s => s.actor).filter(Boolean)).size;

  // Drama.
  const thoughts = events.filter(e => e.kind === "thought" && e.content);
  const conflict = lexiconHits(CONFLICT, speech, thoughts);
  const disclosure = lexiconHits(DISCLOSURE, speech, thoughts);
  const fear = lexiconHits(FEAR, speech, thoughts, DEFLATION); // a talked-down fear line counts as deflation, not fear
  const deflation = lexiconHits(DEFLATION, speech, thoughts);
  const textLines = speech.length + thoughts.length;
  const dramaLineSet = new Set([...speech, ...thoughts].filter(e => (CONFLICT.test(e.content!) || DISCLOSURE.test(e.content!) || (FEAR.test(e.content!) && !DEFLATION.test(e.content!)))));
  const dramaDensity = textLines ? dramaLineSet.size / textLines : null;
  const deflationDensity = textLines ? deflation.total / textLines : null;

  // Goals.
  const goalCreated = events.filter(e => e.kind === "goal_created");
  const goalCompleted = events.filter(e => e.kind === "goal_completed");
  const goalSource = rec.sources.goals ?? "not recorded";
  const completionObservable = /chronicle/.test(goalSource);
  const cls = goalCompleted.map(g => classifyGoalSource(g.actionType));
  const goals = {
    created: rec.sources.goals ? goalCreated.length : null,
    completed: completionObservable ? goalCompleted.length : null,
    completedNative: completionObservable ? cls.filter(c => c === "native").length : null,
    completedSubjective: completionObservable ? cls.filter(c => c === "subjective").length : null,
    completedOther: completionObservable ? cls.filter(c => c === "other").length : null,
    source: goalSource,
  };

  // Narrator.
  const reviews = events.filter(e => e.kind === "narrator_review" && !e.meta?.summaryOnly);
  const allResults = reviews.flatMap(r => (Array.isArray(r.meta?.interventionResults) ? (r.meta!.interventionResults as string[]) : []));
  const narratorWorldCommits = events.filter(e => (e.kind === "world_event" || e.kind === "narrator_intervention") && e.source === "narrator" && e.success !== false).length;
  const tensionTrajectory = events.filter(e => e.kind === "narrator_review" && num(e.meta?.tension) !== undefined).map(e => ({ tSimMs: e.tSimMs, tension: num(e.meta!.tension)!, ...(str(e.meta!.phase) ? { phase: str(e.meta!.phase) } : {}) }));
  const prose = events.filter(e => e.kind === "narrator_prose");
  const narrator = {
    reviews: reviews.length,
    reviewsAccepted: reviews.filter(r => r.meta?.accepted !== false).length,
    interventionsRequested: reviews.reduce((s, r) => s + (num(r.meta?.interventionsRequested) ?? 0), 0),
    interventionsAccepted: allResults.filter(r => ACCEPT_RESULTS.test(r)).length,
    interventionsCommitted: Math.max(allResults.filter(r => COMMIT_RESULTS.test(r)).length, narratorWorldCommits),
    proseProduced: prose.length,
    proseShown: prose.filter(p => p.meta?.shown === true).length,
    tensionStart: tensionTrajectory.length ? tensionTrajectory[0].tension : null,
    tensionEnd: tensionTrajectory.length ? tensionTrajectory[tensionTrajectory.length - 1].tension : null,
    tensionMax: tensionTrajectory.length ? Math.max(...tensionTrajectory.map(t => t.tension)) : null,
    tensionTrajectory,
  };

  // World.
  const committedBy: Record<string, number> = {};
  for (const w of events.filter(e => e.kind === "world_event" && e.success !== false)) committedBy[w.source] = (committedBy[w.source] ?? 0) + 1;
  const authorities = ["narrator", "god", "spirits"];
  const nonOperatorCommitted = authorities.reduce((s, k) => s + (committedBy[k] ?? 0), 0);
  const buildEvents = events.filter(e => e.kind === "build");
  const builds = Math.max(buildEvents.filter(b => b.success && !/^proposal_/.test(b.actionType ?? "")).length, rec.evolutionTotals?.entitiesCreated ?? 0);
  const whispers = events.filter(e => e.kind === "whisper");
  const world = {
    committedBy,
    nonOperatorCommitted,
    operatorCommitted: committedBy.operator ?? 0,
    builds,
    buildProposals: Math.max(buildEvents.filter(b => b.actionType === "proposal_proposed").length, rec.evolutionTotals?.proposalsCreated ?? 0),
    buildRejections: buildEvents.filter(b => b.success === false).length,
    whispersDelivered: whispers.filter(w => w.source !== "operator").length,
    operatorWhispers: whispers.filter(w => w.source === "operator").length,
    phoneRepliesSent: phoneReplies,
    godReviews,
    rejections: events.filter(e => e.kind === "rejection").length,
  };

  // Composite.
  const nativeShare = goals.completed ? (goals.completedNative ?? 0) / goals.completed : 0;
  const worldActivity = narrator.interventionsCommitted + nonOperatorCommitted - Math.min(nonOperatorCommitted, narratorWorldCommits) + builds + world.whispersDelivered;
  const speechLines = speech.length;
  const truncatedSpeech = rec.notes.some(n => /first streamed chunk/.test(n));
  const components: Record<string, { value: number | null; note: string }> = {
    activity: { value: chosenTotal ? 1 - waitRest / chosenTotal : null, note: "1 − waitRestShare" },
    speech: { value: residentMinutes > 0 ? clamp01(speechLines / residentMinutes / 1.5) : null, note: "lines/resident-min ÷ 1.5" },
    language: { value: speechLines && !truncatedSpeech ? 0.5 * (normalized.size / speechLines) + 0.5 * (mattr(allTokens) ?? 0) : null, note: "½ distinct-line ratio + ½ MATTR" },
    freshness: { value: echo !== null && !truncatedSpeech ? clamp01(1 - echo / 0.4) : null, note: "1 − echo ÷ 0.4" },
    exchanges: { value: residentMinutes > 0 && residents > 0 ? 0.5 * clamp01(exchanges.turnPairs / residentMinutes / 0.5) + 0.5 * clamp01(exchanges.distinctPairs / residents) : null, note: "½ pairs/resident-min ÷ 0.5 + ½ distinct pairs ÷ residents" },
    drama: { value: dramaDensity !== null && !truncatedSpeech ? clamp01(dramaDensity / 0.3) : null, note: "drama lines ÷ text lines ÷ 0.3" },
    goals: { value: goals.completed !== null && residents > 0 ? clamp01(goals.completed / residents) * (0.5 + 0.5 * nativeShare) : null, note: "completed/residents × (½ + ½ native share)" },
    world: { value: runMinutes > 0 && (rec.sources.world || rec.sources.narrator) ? clamp01(worldActivity / runMinutes / 1.0) : null, note: "authority commits + builds + whispers per run-min ÷ 1" },
  };
  const availableWeight = Object.entries(components).reduce((s, [k, c]) => s + (c.value === null ? 0 : COMPOSITE_WEIGHTS[k as keyof typeof COMPOSITE_WEIGHTS]), 0);
  const scale = availableWeight > 0 ? 100 / availableWeight : 0;
  const composite: Record<string, CompositeComponent> = {};
  let total = 0;
  for (const [k, c] of Object.entries(components)) {
    const weight = COMPOSITE_WEIGHTS[k as keyof typeof COMPOSITE_WEIGHTS];
    const points = c.value === null ? 0 : c.value * weight * scale;
    total += points;
    composite[k] = { weight, value: round(c.value), points: round(points, 2)!, available: c.value !== null, note: c.note };
  }
  const penaltyValue = deflationDensity !== null && !truncatedSpeech ? clamp01(deflationDensity / 0.4) : null;
  const penalty = penaltyValue === null ? 0 : penaltyValue * DEFLATION_PENALTY;
  composite.deflationPenalty = { weight: -DEFLATION_PENALTY, value: round(penaltyValue), points: round(-penalty, 2)!, available: penaltyValue !== null, note: "deflation lines ÷ text lines ÷ 0.4" };
  const alivenessIndex = round(Math.max(0, Math.min(100, total - penalty)), 1)!;

  return {
    name: rec.name,
    dir: relative(process.cwd(), rec.dir).startsWith("..") ? rec.dir : relative(process.cwd(), rec.dir),
    coverage: rec.coverage,
    sources: rec.sources,
    notes: rec.notes,
    residents,
    simMinutes: round(simMinutes, 2)!,
    runMinutes: round(runMinutes, 2)!,
    actions: { chosen: chosenTotal, waitRest, waitRestShare: chosenTotal ? round(waitRest / chosenTotal) : null, failures, histogram, ...(decisionHistogram ? { decisionHistogram, decisionWaitRestShare } : {}) },
    speech: {
      lines: speechLines,
      perResidentMinute: residentMinutes > 0 ? round(speechLines / residentMinutes) : null,
      meanWordsPerLine: speechLines ? round(allTokens.length / speechLines, 2) : null,
      distinctLineRatio: speechLines ? round(normalized.size / speechLines) : null,
      lexicalDiversityTTR: allTokens.length ? round(new Set(allTokens).size / allTokens.length) : null,
      lexicalDiversityMATTR: round(mattr(allTokens)),
      topicEcho: round(echo),
      speakers,
    },
    exchanges: { ...exchanges, perResidentMinute: residentMinutes > 0 ? round(exchanges.turnPairs / residentMinutes) : null },
    thoughts: { count: thoughts.length },
    drama: { conflict, disclosure, fear, deflation, dramaDensity: round(dramaDensity), deflationDensity: round(deflationDensity) },
    goals,
    narrator,
    world,
    alivenessIndex,
    composite,
  };
}

/** Load and score one recording directory. */
export async function scoreRecording(dir: string): Promise<LivelinessScore> {
  return scoreEvents(await loadRecording(dir));
}

// ─── Table rendering ────────────────────────────────────────────────────────

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1);
  return String(value);
}

function topHistogram(h: Record<string, number>, n = 4): string {
  return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(" ");
}

export function tableRows(scores: LivelinessScore[]): Array<[string, ...string[]]> {
  const rows: Array<[string, (s: LivelinessScore) => unknown]> = [
    ["coverage", s => s.coverage],
    ["residents", s => s.residents],
    ["rate minutes (window)", s => s.simMinutes],
    ["run minutes", s => s.runMinutes],
    ["chosen actions", s => s.actions.chosen],
    ["wait/rest share", s => s.actions.waitRestShare],
    ["top actions", s => topHistogram(s.actions.histogram)],
    ["action failures", s => s.actions.failures],
    ["speech lines", s => s.speech.lines],
    ["lines/resident-min", s => s.speech.perResidentMinute],
    ["words/line", s => s.speech.meanWordsPerLine],
    ["distinct-line ratio", s => s.speech.distinctLineRatio],
    ["lexical TTR", s => s.speech.lexicalDiversityTTR],
    ["lexical MATTR50", s => s.speech.lexicalDiversityMATTR],
    ["topic echo", s => s.speech.topicEcho],
    ["exchange turn pairs", s => s.exchanges.turnPairs],
    ["distinct pairs", s => s.exchanges.distinctPairs],
    ["thoughts", s => s.thoughts.count],
    ["conflict lines", s => s.drama.conflict.total],
    ["disclosure lines", s => s.drama.disclosure.total],
    ["fear/uncanny lines", s => s.drama.fear.total],
    ["DEFLATION lines", s => s.drama.deflation.total],
    ["drama density", s => s.drama.dramaDensity],
    ["deflation density", s => s.drama.deflationDensity],
    ["goals created", s => s.goals.created],
    ["goals completed", s => s.goals.completed],
    ["  native / subjective", s => (s.goals.completed === null ? null : `${s.goals.completedNative} / ${s.goals.completedSubjective}`)],
    ["narrator reviews", s => s.narrator.reviews],
    ["interv. requested", s => s.narrator.interventionsRequested],
    ["interv. committed", s => s.narrator.interventionsCommitted],
    ["prose produced/shown", s => `${s.narrator.proseProduced}/${s.narrator.proseShown}`],
    ["tension start→end", s => (s.narrator.tensionStart === null ? null : `${s.narrator.tensionStart}→${s.narrator.tensionEnd}`)],
    ["world commits non-op", s => s.world.nonOperatorCommitted],
    ["world commits operator", s => s.world.operatorCommitted],
    ["builds (proposals)", s => `${s.world.builds} (${s.world.buildProposals})`],
    ["whispers delivered", s => s.world.whispersDelivered],
    ["ALIVENESS INDEX", s => s.alivenessIndex],
  ];
  return [["metric", ...scores.map(s => s.name)], ...rows.map(([label, get]) => [label, ...scores.map(s => fmt(get(s)))] as [string, ...string[]])];
}

export function renderTable(scores: LivelinessScore[]): string {
  const rows = tableRows(scores);
  const widths = rows[0].map((_, col) => Math.max(...rows.map(r => r[col].length)));
  return rows.map((r, i) => {
    const line = r.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join("  ");
    return i === 0 ? `${line}\n${widths.map(w => "─".repeat(w)).join("  ")}` : line;
  }).join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<void> {
  const dirs: string[] = [];
  let jsonOut: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") jsonOut = argv[++i];
    else if (argv[i].startsWith("--json=")) jsonOut = argv[i].slice(7);
    else dirs.push(argv[i]);
  }
  if (dirs.length === 0) {
    console.error("usage: npx tsx src/evals/liveliness-score.ts <recordingDir> [more dirs] [--json out.json]");
    process.exitCode = 2;
    return;
  }
  const scores: LivelinessScore[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) { console.error(`skip: ${dir} does not exist`); continue; }
    scores.push(await scoreRecording(dir));
  }
  console.log(renderTable(scores));
  for (const s of scores) for (const n of s.notes) console.log(`note [${s.name}]: ${n}`);
  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({ generatedAt: new Date().toISOString(), weights: COMPOSITE_WEIGHTS, deflationPenalty: DEFLATION_PENALTY, scores }, null, 2)}\n`);
    console.log(`wrote ${jsonOut}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
