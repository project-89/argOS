/** The interview chair: the operator talks with one resident's own mind.
 *
 * The resident's system context is their real private context (the exact
 * buildAgentContext their foreground cognition receives) plus one mode
 * instruction. An interview never creates a world action: no tools, no
 * executor, no stimulus. It is off the record unless the operator asks an
 * in-character conversation to be remembered, which stores it as a private
 * experience the resident lived (their narrative memory), nothing else. */
import { generateText } from "ai";
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent } from "bitecs";
import { z } from "zod";
import type { World } from "../ecs/world";
import { Agent, Name } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import { buildAgentContext } from "../cognition/agent-mind";
import { appendNarrative } from "../cognition/narrative-memory";
import { getCommittedEvents } from "../runtime/committed-events";

export type InterviewMode = "in_character" | "analysis";
export const INTERVIEW_TURN_LIMIT = 160, INTERVIEW_SESSION_LIMIT = 32, INTERVIEW_TRANSCRIPT_TURNS = 24;
const INTERVIEW_TIMEOUT_MS = 60_000;

export const interviewRequestSchema = z.object({
  actorKey: z.string().min(1).max(180),
  text: z.string().trim().min(1).max(2000).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)),
  mode: z.enum(["in_character", "analysis"]),
  remember: z.boolean().optional(),
  sessionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:.-]+$/),
}).strict().refine(v => !(v.remember && v.mode === "analysis"), "Only an in-character conversation can be remembered");

const MODE_INSTRUCTIONS: Record<InterviewMode, string> = {
  in_character: `THIS MOMENT: A stranger has found you alone in a quiet moment, away from everyone else. Speak as yourself — your own voice, manner and mood right now, with everything you remember and everything you hide. You don't know this person. Be warm, wary, curious, tired or sharp as you truly would. You may deflect, change the subject or lie to protect your secrets and the people you love; you may also choose to tell them something. Nobody else can hear this.
Answer with spoken words only (no stage directions), usually 1–4 sentences.`,
  analysis: `ANALYSIS MODE: You are in analysis mode. The world around you is still; you are speaking with the one who made this world, and nothing you say here reaches anyone in it. Answer candidly: your motives, what you are hiding and why, what you believe about the others, what you fear and want, and why you did what you did. Do not deflect or lie here. Speak in first person, still in your own voice. Usually 1–4 sentences unless asked for more.`,
};

/** The exact system prompt for one interview turn. Pure; exported for tests. */
export function interviewSystemPrompt(context: string, mode: InterviewMode): string {
  return `${context}\n\n${MODE_INSTRUCTIONS[mode]}\nReply as JSON only: {"reply": "your words", "mood": "one or two words for how you feel right now"}`;
}

type Turn = { role: "operator" | "resident"; text: string; mode: InterviewMode };
type Session = { actor: number; actorKey: string; turns: Turn[]; busy: boolean; touchedAt: number };

export function createSpatialInterviews(options: { world: World;
  /** Resolve a current resident by key; undefined when absent or not a resident. */
  resolve(actorKey: string): number | undefined }) {
  const { world } = options, sessions = new Map<string, Session>();
  let used = 0;
  function session(sessionId: string, actor: number, actorKey: string): Session {
    const prior = sessions.get(sessionId);
    if (prior) {
      if (prior.actorKey !== actorKey) throw Error("An interview session belongs to one resident; start a new session");
      return prior;
    }
    if (sessions.size >= INTERVIEW_SESSION_LIMIT) {
      const oldest = [...sessions].filter(([, row]) => !row.busy).sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (!oldest) throw Error("Too many interviews are in progress");
      sessions.delete(oldest[0]);
    }
    const row: Session = { actor, actorKey, turns: [], busy: false, touchedAt: Date.now() };
    sessions.set(sessionId, row); return row;
  }
  function remember(actor: number, sessionId: string, question: string, reply: string): boolean {
    const now = readSimulationTime(world), name = Name.value[actor];
    const id = appendNarrative(world, actor, { kind: "experience", importance: 0.6, sourceAtSimMs: now,
      monologue: `A stranger found me alone and we talked quietly, just the two of us. They said ${JSON.stringify(question.slice(0, 600))} and I told them ${JSON.stringify(reply.slice(0, 900))}.`,
      evidence: [{ id: `interview:${sessionId}:${randomUUID()}`, kind: "dialogue", role: "primary", atSimMs: now, timeBasis: "simulation",
        content: `A stranger: ${JSON.stringify(question.slice(0, 1500))}\n${name}: ${JSON.stringify(reply.slice(0, 2000))}` }] });
    return id !== undefined;
  }
  async function ask(input: unknown): Promise<{ reply: string; mood?: string; sessionId: string; remembered?: boolean }> {
    const request = interviewRequestSchema.parse(input);
    const actor = options.resolve(request.actorKey);
    if (actor === undefined || !entityExists(world, actor) || !hasComponent(world, actor, Agent)) throw Error("That resident is not present in this world");
    if (getCommittedEvents(world).stopped) throw Error("This session has ended");
    const row = session(request.sessionId, actor, request.actorKey);
    if (row.busy) throw Error("They are still answering");
    if (used >= INTERVIEW_TURN_LIMIT) throw Error("This session's interview budget is spent");
    used++; row.busy = true; row.touchedAt = Date.now();
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), INTERVIEW_TIMEOUT_MS); timeout.unref();
    try {
      // The same model and request shape as the resident's foreground mind.
      const response = await generateText({ model: agentModel, abortSignal: abort.signal, maxRetries: 0, maxOutputTokens: 1800,
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } }, temperature: 0.3,
        system: interviewSystemPrompt(buildAgentContext(world, actor), request.mode),
        messages: [...row.turns.map(turn => ({ role: turn.role === "operator" ? "user" as const : "assistant" as const, content: turn.text })),
          { role: "user" as const, content: request.text }] });
      const raw = response.text?.trim() ?? "";
      let reply = raw, mood: string | undefined;
      try {
        const json = extractJSON(raw), parsed = json ? JSON.parse(json) : undefined;
        if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) reply = parsed.reply.trim();
        if (parsed && typeof parsed.mood === "string" && parsed.mood.trim()) mood = parsed.mood.trim().slice(0, 60);
      } catch { /* Plain spoken text is an acceptable answer. */ }
      reply = reply.slice(0, 4000);
      if (!reply) throw Error("They said nothing");
      row.turns.push({ role: "operator", text: request.text, mode: request.mode }, { role: "resident", text: reply, mode: request.mode });
      if (row.turns.length > INTERVIEW_TRANSCRIPT_TURNS) row.turns.splice(0, row.turns.length - INTERVIEW_TRANSCRIPT_TURNS);
      const remembered = request.remember === true && request.mode === "in_character" && entityExists(world, actor)
        ? remember(actor, request.sessionId, request.text, reply) : undefined;
      return { reply, ...(mood ? { mood } : {}), sessionId: request.sessionId, ...(remembered !== undefined ? { remembered } : {}) };
    } finally { clearTimeout(timeout); row.busy = false; }
  }
  return { ask, transcript: (sessionId: string) => structuredClone(sessions.get(sessionId)?.turns ?? []) };
}
