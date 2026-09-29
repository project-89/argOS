/** Decision leaves: small, closed questions a behaviour tree or learned skill
 * asks a character's mind at one point, instead of handing the whole moment to
 * the full foreground decision. The structure (which step, which kind of act)
 * stays deterministic; the leaf supplies only what varies:
 *
 * - say:    word a line from its gist, in this voice, for this conversation
 *           (or let it go unsaid when it no longer fits).
 * - pick:   choose one of a closed list of options (an index; it cannot invent one).
 * - yes_no: a single judgement.
 *
 * Each call is a few hundred tokens on the light model. Answers always come
 * back as something the executor can admit, and every answer is logged with
 * the options' features so a slot that keeps answering the same way can later
 * become a plain rule (learning/slot-rules.ts). A leaf never acts: callers turn an
 * answer into an ordinary action that still goes through normal admission.
 *
 * Synchronous callers (the fast loop, the offstage driver, BT evaluation) use
 * requestDecision(): the first call starts the question and reports "pending";
 * a later tick picks up the answer. Async callers can await decideNow(). */
import { generateText } from "ai";
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { intentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import { getSocialDialogue } from "./social-memory";
import { getAgentVisualEntities } from "./world-capabilities";
import { readAttention } from "../runtime/attention";
import type { DecisionFeatures } from "../learning/slot-rules";

export type DecisionRequest =
  | { kind: "say"; gist: string; to?: string; allowSilence?: boolean }
  | { kind: "pick"; question: string; options: string[]; features?: DecisionFeatures[] }
  | { kind: "yes_no"; question: string };

export type DecisionAnswer =
  | { kind: "say"; line: string | null; source: "model" | "fallback" }
  | { kind: "pick"; index: number; source: "model" | "fallback" }
  | { kind: "yes_no"; yes: boolean; source: "model" | "fallback" };

export type { DecisionFeatures } from "../learning/slot-rules";

export type DecisionLogRow = { actor: string; slot: string; kind: DecisionRequest["kind"]; atSimMs: number;
  options?: string[]; features?: DecisionFeatures[]; index?: number; yes?: boolean; line?: string | null; source: "model" | "fallback" };

export type DecisionLeafConfig = {
  /** Per-call deadline; past it the fallback answer stands. */
  timeoutMs: number;
  /** Concurrent leaf calls per world. */
  maxInFlight: number;
  /** Calls per wall minute per world. */
  maxPerMinute: number;
  /** A pending/ready answer is valid this long (simulated). */
  answerTtlMs: number;
};
export const DEFAULT_DECISION_LEAF_CONFIG: DecisionLeafConfig = { timeoutMs: 6_000, maxInFlight: 4, maxPerMinute: 90, answerTtlMs: 30_000 };

type Slot = { key: string; actorKey: string; fingerprint: string; startedAtSimMs: number; answer?: DecisionAnswer; promise?: Promise<DecisionAnswer> };
type State = { slots: Map<string, Slot>; inFlight: number; calls: number[]; log: DecisionLogRow[]; stats: DecisionStats;
  generate?: DecisionGenerator; config: DecisionLeafConfig };
export type DecisionStats = { calls: number; model: number; fallback: number; tokensIn: number; tokensOut: number; distilled: number };
export type DecisionGenerator = (input: { system: string; prompt: string; maxOutputTokens: number; abortSignal: AbortSignal }) =>
  Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;

const states = new WeakMap<World, State>();
function state(world: World): State {
  let s = states.get(world);
  if (!s) {
    s = { slots: new Map(), inFlight: 0, calls: [], log: [], config: { ...DEFAULT_DECISION_LEAF_CONFIG },
      stats: { calls: 0, model: 0, fallback: 0, tokensIn: 0, tokensOut: 0, distilled: 0 } };
    states.set(world, s);
  }
  return s;
}

export function configureDecisionLeaves(world: World, config: Partial<DecisionLeafConfig> & { generate?: DecisionGenerator }): void {
  const s = state(world);
  const { generate, ...rest } = config;
  s.config = { ...s.config, ...rest };
  if (generate) s.generate = generate;
}
export function getDecisionLog(world: World): readonly DecisionLogRow[] { return state(world).log; }
export function getDecisionStats(world: World): DecisionStats { return { ...state(world).stats }; }
export function noteDistilledDecision(world: World): void { state(world).stats.distilled++; }

function apiKey(): boolean {
  return !!String(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}
function modelAvailable(world: World, s: State): boolean {
  return world.meta.aiEnabled !== false && (!!s.generate || apiKey());
}

export function fallbackAnswer(request: DecisionRequest): DecisionAnswer {
  if (request.kind === "say") return { kind: "say", line: request.gist.trim() || null, source: "fallback" };
  if (request.kind === "pick") return { kind: "pick", index: 0, source: "fallback" };
  return { kind: "yes_no", yes: true, source: "fallback" };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string { const t = text.trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; }

function scene(world: World, eid: number, turns: number): string {
  const room = getRoomForEntity(world, eid);
  const others = getAgentVisualEntities(world, eid).filter(id => id !== eid && hasComponent(world, id, Agent)).map(id => Name.value[id]).filter(Boolean);
  const heard = getSocialDialogue(world, eid).slice(-turns)
    .map(turn => `${turn.own ? "You" : turn.speaker}${turn.target ? ` (to ${turn.own ? turn.target : turn.target === Name.value[eid] ? "you" : turn.target})` : ""}: ${JSON.stringify(clip(turn.content, 240))}`);
  return `Where: ${room !== undefined ? Name.value[room] : "somewhere"}. With you: ${others.length ? others.join(", ") : "no one"}.`
    + (heard.length ? `\nJust now:\n${heard.join("\n")}` : "");
}

export function decisionPrompt(world: World, eid: number, request: DecisionRequest): { system: string; prompt: string; maxOutputTokens: number } {
  const name = Name.value[eid], role = Agent.role[eid];
  const persona = clip(String(Agent.systemPrompt[eid] || ""), request.kind === "say" ? 900 : 450);
  const system = `You are ${name}${role ? `, ${role}` : ""}. ${persona}\nAnswer only with the JSON asked for.`;
  if (request.kind === "say") {
    return { maxOutputTokens: 200, system, prompt: `${scene(world, eid, 6)}

You mean to say this${request.to ? ` to ${request.to}` : ""}: ${JSON.stringify(clip(request.gist, 400))}
Say it now in your own voice, fitted to what was just said — a sentence or two, as people really talk.${request.allowSilence
    ? "\nIf it has already been said or no longer makes sense, you may let it go: use null." : ""}
JSON: {"line": "..."${request.allowSilence ? " | null" : ""}}` };
  }
  if (request.kind === "pick") {
    return { maxOutputTokens: 60, system, prompt: `${scene(world, eid, 4)}

${request.question}
${request.options.map((option, i) => `${i}. ${clip(option, 160)}`).join("\n")}
Choose as ${name} would. JSON: {"choice": <number>}` };
  }
  return { maxOutputTokens: 40, system, prompt: `${scene(world, eid, 4)}

${request.question}
Answer as ${name} would. JSON: {"yes": true | false}` };
}

export function parseDecision(request: DecisionRequest, text: string): DecisionAnswer | null {
  const json = extractJSON(text);
  if (!json) return null;
  let value: any;
  try { value = JSON.parse(json); } catch { return null; }
  if (request.kind === "say") {
    if (value?.line === null && request.allowSilence) return { kind: "say", line: null, source: "model" };
    const line = typeof value?.line === "string" ? value.line.replace(/\s+/g, " ").trim() : "";
    return line ? { kind: "say", line: clip(line, 500), source: "model" } : null;
  }
  if (request.kind === "pick") {
    const index = Number(value?.choice);
    return Number.isInteger(index) && index >= 0 && index < request.options.length ? { kind: "pick", index, source: "model" } : null;
  }
  return typeof value?.yes === "boolean" ? { kind: "yes_no", yes: value.yes, source: "model" } : null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

function withinBudget(s: State): boolean {
  const now = Date.now();
  s.calls = s.calls.filter(at => now - at < 60_000);
  return s.inFlight < s.config.maxInFlight && s.calls.length < s.config.maxPerMinute;
}

async function callModel(world: World, eid: number, request: DecisionRequest, s: State): Promise<DecisionAnswer> {
  const { system, prompt, maxOutputTokens } = decisionPrompt(world, eid, request);
  s.inFlight++; s.calls.push(Date.now()); s.stats.calls++;
  const abortSignal = AbortSignal.timeout(s.config.timeoutMs);
  try {
    const response = s.generate
      ? await s.generate({ system, prompt, maxOutputTokens, abortSignal })
      : await generateText({ model: intentModel, abortSignal, maxRetries: 0, maxOutputTokens,
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } }, system, messages: [{ role: "user", content: prompt }] });
    s.stats.tokensIn += Number(response.usage?.inputTokens ?? 0) || 0;
    s.stats.tokensOut += Number(response.usage?.outputTokens ?? 0) || 0;
    const parsed = parseDecision(request, response.text);
    if (parsed) { s.stats.model++; return parsed; }
  } catch { /* the fallback answer stands */ } finally { s.inFlight--; }
  s.stats.fallback++;
  return fallbackAnswer(request);
}

function record(world: World, eid: number, slot: string, request: DecisionRequest, answer: DecisionAnswer): void {
  const s = state(world);
  const row: DecisionLogRow = { actor: Name.value[eid], slot, kind: request.kind, atSimMs: readSimulationTime(world), source: answer.source };
  if (request.kind === "pick" && answer.kind === "pick") { row.options = request.options.slice(0, 12); row.features = request.features?.slice(0, 12); row.index = answer.index; }
  if (answer.kind === "yes_no") row.yes = answer.yes;
  if (answer.kind === "say") row.line = answer.line;
  s.log.push(row);
  if (s.log.length > 2000) s.log.splice(0, s.log.length - 2000);
}

const actorKey = (world: World, eid: number) => hasComponent(world, eid, WorkingMemoryIdentity) ? String(WorkingMemoryIdentity.id[eid] || eid) : String(eid);
const fingerprintOf = (request: DecisionRequest) => JSON.stringify(request.kind === "pick" ? [request.kind, request.question, request.options] : request);

/** Ask and wait. Falls back deterministically (never throws). */
export async function decideNow(world: World, eid: number, slot: string, request: DecisionRequest): Promise<DecisionAnswer> {
  const s = state(world);
  if (!entityExists(world, eid) || !modelAvailable(world, s) || !withinBudget(s)) {
    const answer = fallbackAnswer(request);
    record(world, eid, slot, request, answer);
    return answer;
  }
  const answer = await callModel(world, eid, request, s);
  record(world, eid, slot, request, answer);
  return answer;
}

// ---------------------------------------------------------------------------
// Voiced speech: an action whose words are a gist to be said in the moment
// ---------------------------------------------------------------------------

/** A speak action chosen by a plan or learned skill carries its gist; the
 * foreground words it with the say leaf (or lets it go unsaid, calling onSilence). */
export type VoicedSpeech = { gist: string; slot: string; onSilence?: () => void };
const voiced = new WeakMap<object, VoicedSpeech>();
export function markVoicedSpeech<T extends object>(action: T, meta: VoicedSpeech): T { voiced.set(action, meta); return action; }
export function voicedSpeechOf(action: object | null | undefined): VoicedSpeech | undefined { return action ? voiced.get(action) : undefined; }

export type DecisionPoll = { status: "ready"; answer: DecisionAnswer } | { status: "pending" };

/** Ask without waiting. The first call for a slot starts the question; the
 * answer is returned (once) by a later call with the same slot and request. A
 * changed request, another resident in this body, or an old answer starts over.
 * Without a model (or over budget) the fallback answer is ready at once. */
export function requestDecision(world: World, eid: number, slot: string, request: DecisionRequest): DecisionPoll {
  const s = state(world), key = `${eid}:${slot}`, now = readSimulationTime(world);
  // Offstage, words are the scene's business (see scene-resolver): no call.
  if (request.kind === "say" && readAttention(world, eid).tier === "offstage") return { status: "ready", answer: fallbackAnswer(request) };
  const fingerprint = fingerprintOf(request), who = actorKey(world, eid);
  const existing = s.slots.get(key);
  if (existing && existing.actorKey === who && existing.fingerprint === fingerprint && now - existing.startedAtSimMs <= s.config.answerTtlMs) {
    if (!existing.answer) return { status: "pending" };
    s.slots.delete(key);
    return { status: "ready", answer: existing.answer };
  }
  if (!modelAvailable(world, s) || !withinBudget(s)) {
    if (existing) s.slots.delete(key);
    const answer = fallbackAnswer(request);
    record(world, eid, slot, request, answer);
    return { status: "ready", answer };
  }
  const row: Slot = { key, actorKey: who, fingerprint, startedAtSimMs: now };
  s.slots.set(key, row);
  row.promise = callModel(world, eid, request, s).then(answer => {
    record(world, eid, slot, request, answer);
    if (s.slots.get(key) === row) row.answer = answer;
    return answer;
  });
  return { status: "pending" };
}

/** Test/diagnostic hook: settle every question in flight. */
export async function settleDecisions(world: World): Promise<void> {
  await Promise.all([...state(world).slots.values()].map(row => row.promise));
}
