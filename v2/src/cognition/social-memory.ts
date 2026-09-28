/** Fast, durable dialogue recall. Only the action executor admits public speech.
 * Claims remain attributed claims; this never changes possessions or world facts. */
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, Goal, Name, SocialMemory, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { isStandingIntention } from "./goal-lifecycle";
import { retireGoalPlans } from "./plan-state";
import { getRoomForEntity } from "../ecs/location";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import type { SpeechInterval, SpeechFragment } from "./timed-speech";
import { readSimulationTime } from "../ecs/simulation-time";
import { legacySimulationTimestamp } from "../ecs/temporal-age";
import { getCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "./working-memory";
import { recordActivitySpeech } from "./activity-review";
import { hearingReceipt, type HeardSpeechProgress } from "./hearing-receipt";
export { isInvalidHeardSpeechNotice, readHeardSpeechProgress, type HeardSpeechNotice, type HeardSpeechProgress } from "./hearing-receipt";

export interface SocialDialogueTurn {
  id: string; atMs: number; speaker: string; target?: string; room: string;
  atSimMs?: number;
  content: string; own: boolean;
  /** Kept separate from wall/source-order atMs for accelerated worlds. */
  simulation?: SpeechInterval;
}
type ActivitySpeechReceipt = { world: World; eid: number; owner: string; source: string | null; room: number; atSimMs: number; exact: string; consumed: boolean };
const activitySpeechReceipts = new WeakMap<SocialDialogueTurn, ActivitySpeechReceipt>();
/** One-use provenance for the encounter cursor, issued only by completed speech.
 * Restored JSON and equal copies cannot replay a completion into a new episode. */
export function consumeActivitySpeechReceipt(world: World, eid: number, turn: SocialDialogueTurn): boolean {
  assertSimulationTaskActive();
  const receipt = activitySpeechReceipts.get(turn), tape = getCommittedEvents(world);
  if (!receipt || receipt.consumed || receipt.world !== world || receipt.eid !== eid || tape.stopped || tape.sourceId !== receipt.source
    || !actor(world, eid) || !Agent.active[eid] || WorkingMemoryIdentity.id[eid] !== receipt.owner
    || getRoomForEntity(world, eid) !== receipt.room || readSimulationTime(world) !== receipt.atSimMs || JSON.stringify(turn) !== receipt.exact) return false;
  receipt.consumed = true; return true;
}
export interface SocialExchange {
  question: SocialDialogueTurn; response: SocialDialogueTurn;
}
/** An actually heard span, explicitly not a completed speech turn. It cannot
 * satisfy APIs that require own/received complete dialogue evidence. */
export interface SocialSpeechFragment {
  id: string; executionId: string; speaker: string; target?: string; room: string;
  content: string; own: boolean; complete: false; firstToken: number; lastToken: number;
  startedAtSimMs: number; heardAtSimMs: number; notifiedLength: number; notifiedToken: number;
  /** Last deliberation boundary, not the arrival time of each audible word. */
  notifiedAtSimMs?: number;
  /** Last coherent sentence/end boundary; timed prefix refreshes do not advance it. */
  boundaryToken?: number;
  /** A restored heard prefix is recall, not a live execution or notification. */
  historical?: true;
}
export function getSocialSpeechFragments(world: World, eid: number): SocialSpeechFragment[] {
  return actor(world, eid) && hasComponent(world, eid, SocialMemory)
    ? rows<SocialSpeechFragment>(SocialMemory.fragmentsJson[eid]).filter(row => row && row.complete === false
      && typeof row.executionId === "string" && typeof row.content === "string" && Number.isFinite(row.heardAtSimMs)).slice(-48) : [];
}
/** Store each exact slice; reconsider at sentence/turn boundaries, with a
 * bounded listening horizon for a long unfinished sentence. Commas and every
 * few words are perceptual progress, not fresh decisions to keep listening.
 * A listener leaving earshot receives their remaining prefix once, never the
 * suffix they missed. Complete-turn consumers cannot read this separate ledger. */
export function recordHeardSpeechFragment(world: World, speakerEid: number, fragment: SpeechFragment, target?: string): Array<{ eid: number; content: string; hearing: HeardSpeechProgress }> {
  assertSimulationTaskActive();
  const notifications: Array<{ eid: number; content: string; hearing: HeardSpeechProgress }> = [];
  const audible = new Set([speakerEid, ...fragment.audience]);
  const sentenceBoundary = fragment.tokenIndex === fragment.totalTokens - 1 || /[.!?。！？]\s*$/.test(fragment.content);
  for (const eid of query(world, [Agent, Name])) {
    if (!Agent.active[eid]) continue;
    let partials = getSocialSpeechFragments(world, eid);
    if (audible.has(eid)) {
      initialize(world, eid);
      let latest = [...partials].reverse().find(row => !row.historical && row.executionId === fragment.executionId && row.lastToken === fragment.tokenIndex - 1);
      if (!latest || latest.executionId !== fragment.executionId || latest.lastToken !== fragment.tokenIndex - 1) {
        latest = { id: `speech-fragment:${randomUUID()}`, executionId: fragment.executionId,
          speaker: Name.value[speakerEid], ...(target ? { target } : {}), room: Name.value[fragment.roomId], content: "", own: eid === speakerEid,
          complete: false, firstToken: fragment.tokenIndex, lastToken: fragment.tokenIndex - 1,
          startedAtSimMs: fragment.startedAtSimMs, heardAtSimMs: fragment.heardAtSimMs, notifiedLength: 0, notifiedToken: fragment.tokenIndex - 1,
          boundaryToken: fragment.tokenIndex - 1 };
        partials.push(latest);
      }
      latest.content += fragment.content; latest.lastToken = fragment.tokenIndex; latest.heardAtSimMs = fragment.heardAtSimMs;
    }
    let notified = false;
    for (const partial of partials) if (!partial.historical && partial.executionId === fragment.executionId && partial.notifiedLength < partial.content.length
      && (sentenceBoundary || !audible.has(eid)
        || fragment.heardAtSimMs - (partial.notifiedAtSimMs ?? partial.startedAtSimMs) >= 4_000)) {
      const boundary = !audible.has(eid) || fragment.tokenIndex === fragment.totalTokens - 1 ? "end" : sentenceBoundary ? "sentence" : "progress";
      const content = `${partial.speaker} (heard speech excerpt): ${JSON.stringify(partial.content.slice(partial.notifiedLength).trim())}`;
      if (!partial.own) notifications.push({ eid, content, hearing: hearingReceipt(world, eid, partial.executionId, boundary, content, partial.speaker) });
      if (boundary !== "progress") partial.boundaryToken = partial.lastToken;
      partial.notifiedLength = partial.content.length; partial.notifiedToken = partial.lastToken;
      partial.notifiedAtSimMs = fragment.heardAtSimMs; notified = true;
    }
    if (partials.length) {
      SocialMemory.fragmentsJson[eid] = JSON.stringify(partials.slice(-48));
      if (notified) SocialMemory.revision[eid] = (SocialMemory.revision[eid] || 0) + 1;
    }
  }
  return notifications;
}
/** End-of-utterance attention for an interrupted/abandoned prefix. Only words
 * already stored as heard are eligible; flushing never creates a complete turn,
 * invents an unheard suffix, or notifies the same excerpt twice. */
export function flushHeardSpeechFragments(world: World, executionId: string): Array<{ eid: number; content: string; hearing: HeardSpeechProgress }> {
  assertSimulationTaskActive();
  const notifications: Array<{ eid: number; content: string; hearing: HeardSpeechProgress }> = [];
  if (!executionId) return notifications;
  for (const eid of query(world, [Agent, SocialMemory])) {
    const partials = getSocialSpeechFragments(world, eid);
    let changed = false;
    for (const partial of partials) {
      if (partial.historical || partial.executionId !== executionId || partial.notifiedLength >= partial.content.length) continue;
      const remaining = partial.content.slice(partial.notifiedLength).trim();
      const content = `${partial.speaker} (heard speech excerpt): ${JSON.stringify(remaining)}`;
      if (!partial.own && Agent.active[eid] && remaining) notifications.push({ eid, content,
        hearing: hearingReceipt(world, eid, executionId, "end", content, partial.speaker) });
      partial.notifiedLength = partial.content.length;
      partial.notifiedToken = partial.lastToken;
      partial.boundaryToken = partial.lastToken;
      partial.notifiedAtSimMs = partial.heardAtSimMs;
      changed = true;
    }
    if (changed) {
      SocialMemory.fragmentsJson[eid] = JSON.stringify(partials);
      SocialMemory.revision[eid] = (SocialMemory.revision[eid] || 0) + 1;
    }
  }
  return notifications;
}
/** A character's evidenced decision to let a social desire settle, not a claim
 * that the people involved agreed or that a physical task was completed. */
export interface SocialClosure {
  id: string; atMs: number; description: string; reason: string;
  atSimMs?: number;
  kind?: "engagement";
  evidence: SocialDialogueTurn[];
}
const MAX_TURNS = 48, MAX_EXCHANGES = 16, MAX_CLOSURES = 16;
function actor(world: World, eid: number) { return entityExists(world, eid) && hasComponent(world, eid, Agent); }
function rows<T>(raw: string | undefined): T[] { try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function validTurn(t: any): t is SocialDialogueTurn {
  return t && typeof t.id === "string" && Number.isFinite(t.atMs) && typeof t.speaker === "string" && typeof t.content === "string"
    && typeof t.room === "string" && typeof t.own === "boolean" && (t.target === undefined || typeof t.target === "string");
}
/** Rehydrate durable records without issuing speech/hearing receipts. In
 * particular, sparse component slots must never supply absent snapshot fields. */
export function restoreSocialMemoryFields(eid: number, data: Record<string, unknown>): void {
  const text = (value: unknown) => typeof value === "string" ? value : "[]";
  const turns = rows<SocialDialogueTurn>(text(data.turnsJson)).filter(validTurn).slice(-MAX_TURNS);
  const own = new Set(turns.filter(turn => turn.own).map(turn => turn.id));
  const contributions = rows<{ speechId: string; purpose: string }>(text(data.contributionsJson))
    .filter(row => row && own.has(row.speechId) && typeof row.purpose === "string"
      && !!row.purpose.trim() && row.purpose.length <= 400).slice(-16);
  const fragments = rows<SocialSpeechFragment>(text(data.fragmentsJson)).filter(row => row && row.complete === false
    && typeof row.id === "string" && typeof row.executionId === "string" && typeof row.content === "string"
    && typeof row.speaker === "string" && typeof row.room === "string" && typeof row.own === "boolean"
    && (row.target === undefined || typeof row.target === "string")
    && Number.isFinite(row.startedAtSimMs) && Number.isFinite(row.heardAtSimMs)
    && Number.isInteger(row.firstToken) && row.firstToken >= 0
    && Number.isInteger(row.lastToken) && row.lastToken >= row.firstToken).slice(-48)
    .map(row => ({ ...row, historical: true as const, notifiedLength: row.content.length,
      notifiedToken: row.lastToken, boundaryToken: row.lastToken, notifiedAtSimMs: row.heardAtSimMs }));
  SocialMemory.turnsJson[eid] = JSON.stringify(turns);
  SocialMemory.fragmentsJson[eid] = JSON.stringify(fragments);
  SocialMemory.contributionsJson[eid] = JSON.stringify(contributions);
  SocialMemory.exchangesJson[eid] = text(data.exchangesJson);
  SocialMemory.closuresJson[eid] = text(data.closuresJson);
  SocialMemory.revision[eid] = typeof data.revision === "number" && Number.isFinite(data.revision) ? data.revision : 0;
  SocialMemory.lastSpokeAt[eid] = typeof data.lastSpokeAt === "number" && Number.isFinite(data.lastSpokeAt) ? data.lastSpokeAt : 0;
}
function evidenceId(id: string): string {
  // The display namespace is not part of the UUID identity. Models sometimes
  // copy the UUID without "speech:"; accept the same exact owned event, never
  // a fuzzy match, a truncated ID or evidence from another actor's store.
  const uuid = /^(?:speech:)?([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(id);
  return uuid ? uuid[1].toLowerCase() : id;
}
export function getSocialDialogue(world: World, eid: number): SocialDialogueTurn[] {
  return actor(world, eid) && hasComponent(world, eid, SocialMemory) ? rows<SocialDialogueTurn>(SocialMemory.turnsJson[eid]).filter(validTurn).slice(-MAX_TURNS) : [];
}
/** The speaker's private intent behind words that really completed. This is
 * not what listeners inferred, nor evidence the intended social effect worked. */
export function getCompletedContributions(world: World, eid: number): Array<{ turn: SocialDialogueTurn; purpose: string }> {
  if (!actor(world, eid) || !hasComponent(world, eid, SocialMemory)) return [];
  const own = new Map(getSocialDialogue(world, eid).filter(t => t.own).map(t => [t.id, t]));
  return rows<{ speechId: string; purpose: string }>(SocialMemory.contributionsJson[eid]).slice(-16).flatMap(row => {
    const turn = row && own.get(row.speechId);
    return turn && typeof row.purpose === "string" && row.purpose.trim() && row.purpose.length <= 400 ? [{ turn, purpose: row.purpose }] : [];
  });
}
export function getSocialExchanges(world: World, eid: number): SocialExchange[] {
  return actor(world, eid) && hasComponent(world, eid, SocialMemory) ? rows<SocialExchange>(SocialMemory.exchangesJson[eid])
    .filter(e => e && validTurn(e.question) && validTurn(e.response)).slice(-MAX_EXCHANGES) : [];
}
export function getSocialClosures(world: World, eid: number): SocialClosure[] {
  return actor(world, eid) && hasComponent(world, eid, SocialMemory) ? rows<SocialClosure>(SocialMemory.closuresJson[eid])
    .filter(c => c && typeof c.id === "string" && Number.isFinite(c.atMs) && typeof c.description === "string"
      && typeof c.reason === "string" && Array.isArray(c.evidence) && c.evidence.length >= (c.kind === "engagement" ? 1 : 2) && c.evidence.length <= 8
      && c.evidence.every(validTurn) && c.evidence.some(t => t.own) && (c.kind === "engagement" || c.evidence.some(t => !t.own))).slice(-MAX_CLOSURES) : [];
}
function initialize(world: World, eid: number) {
  if (hasComponent(world, eid, SocialMemory)) return;
  addComponent(world, eid, SocialMemory);
  SocialMemory.turnsJson[eid] = "[]"; SocialMemory.exchangesJson[eid] = "[]"; SocialMemory.closuresJson[eid] = "[]";
  SocialMemory.fragmentsJson[eid] = "[]";
  SocialMemory.contributionsJson[eid] = "[]";
  SocialMemory.revision[eid] = 0; SocialMemory.lastSpokeAt[eid] = 0;
}
export function canHearSocialSpeech(world: World, eid: number): boolean {
  return actor(world, eid) && getAgentSensoryCapabilities(world, eid).auditory > 0;
}
/** Called exactly after a successful speak action; remote listeners learn nothing.
 * id is a source event identity local to the speaker, never an EID reference to remap. */
export function recordCommittedSpeech(world: World, speakerEid: number, content: string, target?: string, now = Date.now(),
  delivery?: { audience: ReadonlySet<number>; interval: SpeechInterval }, privatePurpose?: string): SocialDialogueTurn | undefined {
  assertSimulationTaskActive();
  if (!actor(world, speakerEid) || !content.trim() || !Number.isFinite(now) || getCommittedEvents(world).stopped) return;
  const room = getRoomForEntity(world, speakerEid); if (room === undefined) return;
  initialize(world, speakerEid);
  const event: SocialDialogueTurn = { id: `speech:${randomUUID()}`,
    atMs: now, atSimMs: delivery?.interval.completedAtSimMs ?? readSimulationTime(world),
    speaker: Name.value[speakerEid], ...(target?.trim() ? { target: target.trim() } : {}),
    room: Name.value[room] || "unnamed room", content: content.trim().slice(0, 2000), own: true,
    ...(delivery ? { simulation: { ...delivery.interval } } : {}) };
  for (const eid of query(world, [Agent, Name])) {
    if (delivery && eid !== speakerEid && !delivery.audience.has(eid)) continue;
    if (getRoomForEntity(world, eid) !== room || (eid !== speakerEid && !canHearSocialSpeech(world, eid))) continue;
    initialize(world, eid);
    const turns = getSocialDialogue(world, eid), heard = { ...event, own: eid === speakerEid };
    // Preserve question-response pairs separately so ambient descriptions and a
    // later social exchange cannot immediately erase a previously heard answer.
    // This association is not a semantic claim that the question was answered.
    const elapsedSince = (t: SocialDialogueTurn) => delivery && t.simulation
      ? delivery.interval.completedAtSimMs - t.simulation.completedAtSimMs : now - t.atMs;
    const question = [...turns].reverse().find(t => t.content.includes("?") && t.target === event.speaker
      && (!event.target || event.target === t.speaker) && t.room === event.room
      && t.speaker !== event.speaker && elapsedSince(t) >= 0 && elapsedSince(t) <= 60_000);
    let exchanges = getSocialExchanges(world, eid);
    // An answer may itself end in a question. Preserve the exchange without
    // deciding its meaning; a remark addressed to someone else is not a reply.
    if (question && !exchanges.some(e => e.question.id === question.id)) {
      exchanges.push({ question, response: heard }); exchanges = exchanges.slice(-MAX_EXCHANGES);
    }
    SocialMemory.turnsJson[eid] = JSON.stringify([...turns, heard].slice(-MAX_TURNS));
    if (eid === speakerEid && typeof privatePurpose === "string" && privatePurpose.trim() && privatePurpose.length <= 400) {
      const previous = getCompletedContributions(world, eid).map(c => ({ speechId: c.turn.id, purpose: c.purpose }));
      SocialMemory.contributionsJson[eid] = JSON.stringify([...previous, { speechId: event.id, purpose: privatePurpose.trim() }].slice(-16));
    }
    if (delivery) SocialMemory.fragmentsJson[eid] = JSON.stringify(getSocialSpeechFragments(world, eid)
      .filter(fragment => fragment.executionId !== delivery.interval.executionId));
    SocialMemory.exchangesJson[eid] = JSON.stringify(exchanges);
    SocialMemory.revision[eid] = (SocialMemory.revision[eid] || 0) + 1;
    if (eid === speakerEid) SocialMemory.lastSpokeAt[eid] = now;
    activitySpeechReceipts.set(heard, { world, eid, owner: workingMemoryEntityRef(world, eid)!.key,
      source: getCommittedEvents(world).sourceId, room, atSimMs: readSimulationTime(world), exact: JSON.stringify(heard), consumed: false });
    recordActivitySpeech(world, eid, heard);
  }
  return event;
}

/** Words already heard, including durable question-response excerpts. Read-only. */
export function formatSocialMemoryContext(world: World, eid: number): string {
  const turns = getSocialDialogue(world, eid), exchanges = getSocialExchanges(world, eid), closures = getSocialClosures(world, eid);
  const fragments = getSocialSpeechFragments(world, eid);
  if (!turns.length && !exchanges.length && !closures.length && !fragments.length) return "CONVERSATIONS: none yet.";
  const ageMs = (t: SocialDialogueTurn) => t.simulation && Number.isFinite(t.simulation.completedAtSimMs)
    ? readSimulationTime(world) - t.simulation.completedAtSimMs : readSimulationTime(world) - legacySimulationTimestamp(world, t.atMs);
  const format = (t: SocialDialogueTurn) => `[${t.id}] (${Math.max(0, Math.round(ageMs(t) / 1000))}s ago, ${t.room}) ${t.own ? "You" : t.speaker}${t.target ? ` to ${t.target}` : " to the room"}: ${JSON.stringify(t.content)}`;
  const recent = turns.slice(-14);
  const recentIds = new Set(recent.map(t => t.id));
  const earlier = exchanges.filter(e => !recentIds.has(e.question.id) || !recentIds.has(e.response.id)).slice(-8);
  const ownRecent = turns.filter(t => t.own && ageMs(t) < 60_000).length;
  const contributions = getCompletedContributions(world, eid).slice(-6);
  return `CONVERSATIONS (what was actually said — people can be wrong, or lie):
${recent.map(format).join("\n")}
HEARD EXCERPTS (not complete turns; do not infer an unheard continuation):
${fragments.slice(-8).map(fragment => `(${Math.max(0, Math.round((readSimulationTime(world) - fragment.heardAtSimMs) / 1000))}s ago, ${fragment.room}; incomplete excerpt) ${fragment.own ? "You" : fragment.speaker}${fragment.target ? ` to ${fragment.target}` : ""}: ${JSON.stringify(fragment.content.trim())}`).join("\n") || "None."}
EARLIER QUESTION / RESPONSE EXCERPTS (association is not a guarantee the response answered the question):
${earlier.length ? earlier.map(e => `${format(e.question)}\n${format(e.response)}`).join("\n") : "No earlier excerpts needed."}
Your spoken turns in the last minute: ${ownRecent}.
POINTS YOU ALREADY CONTRIBUTED (your private purpose; only the words completed, not necessarily their intended effect):
${contributions.map(c => `[${c.turn.id}] to ${c.turn.target || "the room"}: ${JSON.stringify(c.purpose)}`).join("\n") || "No private speech purposes recorded."}
Changing the wording does not itself add a new point. Use new evidence or a changed intention to decide whether to add, clarify, correct, or let the exchange rest.
PERSONAL SOCIAL CLOSURES (your own evidenced decisions about a desire or exchange, not anyone else's consent or emotional resolution):
${closures.length ? closures.slice(-5).map(c => `- ${Math.max(0, Math.round((readSimulationTime(world) - (c.atSimMs ?? legacySimulationTimestamp(world, c.atMs))) / 1000))}s ago: ${JSON.stringify(c.description)} — ${c.reason}`).join("\n") : "None recorded."}`;
}

/** A personal conversational closure, not a shared agreement or goal success.
 * The review caller supplies only its frozen, actor-owned completed receipts. */
export function recordPersonalSocialClosure(world: World, eid: number, input: {
  description: string; reason: string; evidence: readonly SocialDialogueTurn[];
}): boolean {
  assertSimulationTaskActive();
  if (!actor(world, eid) || !Agent.active[eid] || getCommittedEvents(world).stopped
    || !input.description.trim() || input.description.length > 400 || !input.reason.trim() || input.reason.length > 400
    || input.evidence.length < 1 || input.evidence.length > 6 || !input.evidence.some(turn => turn.own)
    || new Set(input.evidence.map(turn => turn.id)).size !== input.evidence.length) return false;
  const owned = getSocialDialogue(world, eid);
  if (input.evidence.some(turn => !owned.some(actual => actual.id === turn.id && JSON.stringify(actual) === JSON.stringify(turn)))) return false;
  initialize(world, eid);
  const closure: SocialClosure = { id: `social-closure:${randomUUID()}`, kind: "engagement", atMs: Date.now(), atSimMs: readSimulationTime(world),
    description: input.description.trim(), reason: input.reason.trim(), evidence: structuredClone([...input.evidence]) };
  SocialMemory.closuresJson[eid] = JSON.stringify([...getSocialClosures(world, eid), closure].slice(-MAX_CLOSURES));
  SocialMemory.revision[eid] = (SocialMemory.revision[eid] || 0) + 1;
  return true;
}

export function formatSocialGoalsForReview(world: World, eid: number): string {
  const goals = getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal) && Goal.status[g] === "active" && Goal.kind[g] === "social");
  return goals.length ? `PERSONAL SOCIAL GOALS (subjective; review against your own spoken and heard exchanges):\n${goals.map(g => `[goalId=${g}] ${Goal.description[g]}${isStandingIntention(world, g) ? " (standing desire; a single exchange does not complete it)" : ""}`).join("\n")}` : "";
}

/** A subjective social desire can settle; a physical success contract can never
 * be bypassed by a model self-report. No canned dialogue is learned as a reflex. */
export function reviewSocialGoal(world: World, eid: number, review: unknown): { goalId: number; reason: string } | undefined {
  assertSimulationTaskActive();
  const r = review as any;
  if (!actor(world, eid) || !r || !Number.isSafeInteger(r.goalId) || r.disposition !== "satisfied_for_now"
    || typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 600 || !Array.isArray(r.evidenceIds) || r.evidenceIds.length < 2 || r.evidenceIds.length > 8) return;
  const goal = r.goalId;
  if (!getRelationTargets(world, eid, HasGoal).includes(goal) || !hasComponent(world, goal, Goal) || Goal.status[goal] !== "active" || Goal.kind[goal] !== "social") return;
  // Satisfying one exchange is not the end of a recurring desire. The actor
  // can still explicitly defer or release it through intention reconsideration.
  if (isStandingIntention(world, goal)) return;
  try { if (JSON.parse(Goal.successJson[goal] || "{}").type !== "custom") return; } catch { return; }
  const seen = new Map([...getSocialDialogue(world, eid), ...getSocialExchanges(world, eid).flatMap(e => [e.question, e.response])].map(t => [evidenceId(t.id), t]));
  const evidence = r.evidenceIds.map((id: unknown) => typeof id === "string" ? seen.get(evidenceId(id)) : undefined);
  if (evidence.some((t: SocialDialogueTurn | undefined) => !t || t.atMs < (Goal.createdAt[goal] || 0))
    || !evidence.some((t: SocialDialogueTurn) => t.own) || !evidence.some((t: SocialDialogueTurn) => !t.own)) return;
  Goal.status[goal] = "completed"; Goal.progress[goal] = 100;
  retireGoalPlans(world, goal, getRelationTargets(world, eid, HasPlan));
  initialize(world, eid);
  const closure: SocialClosure = { id: `social-closure:${randomUUID()}`, atMs: Date.now(), atSimMs: readSimulationTime(world),
    description: Goal.description[goal], reason: r.reason.trim(), evidence: evidence as SocialDialogueTurn[] };
  SocialMemory.closuresJson[eid] = JSON.stringify([...getSocialClosures(world, eid), closure].slice(-MAX_CLOSURES));
  SocialMemory.revision[eid] = (SocialMemory.revision[eid] || 0) + 1;
  return { goalId: goal, reason: r.reason.trim() };
}
