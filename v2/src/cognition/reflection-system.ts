/**
 * Reflection System
 *
 * Implements the reflection mechanism from the Generative Agents paper.
 * When accumulated memory importance exceeds a threshold, the agent
 * reflects on recent experiences to generate higher-order insights.
 *
 * These insights are:
 * - Stored as new memories with high importance
 * - Used to update beliefs and impressions
 * - Provide context for future decision-making
 */

import { generateText } from "ai";
import { flashModel } from "../llm/config";
import { backgroundThinkingLevel, backgroundOutputTokens, backgroundDeadlineMs, observeBackgroundProvider } from "./background-reasoning";
import type { World } from "../ecs/world";
import { addEntity, addComponent, query, getRelationTargets, hasComponent, entityExists } from "bitecs";
import { Name, Description, Agent, Mind, Memory, ReflectionState, Thought, WorkingMemoryIdentity } from "../ecs/components";
import { HasMemory, HasReflectionState, HasThought } from "../ecs/relations";
import { getAgentMemories, addMemory, getKnowledgeSummary, normalizeMemoryImportance } from "./knowledge-graph";
import { addThought } from "./agent-mind";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { formatWorkingMemoryContext, getWorkingMemory, workingMemoryEntityRef, type ActorWorkingMemory } from "./working-memory";
import { formatCoordinationContext, getCoordinationMemory } from "./coordination-memory";
import { coordinationDependency } from "./coordination-memory-dependencies";
import { selectReflectionSources, formatReflectionSources, reflectionSourceId, type ReflectionContextSource, type ReflectionMemorySource } from "./reflection-retrieval";
import { getSocialDialogue, type SocialDialogueTurn } from "./social-memory";
import { appendNarrative, getNarrativeHistory, selectNarrativeMemories, selectIdentityAnchors, getIdentityAnchors, type NarrativeEvidence } from "./narrative-memory";
import { identityRevisionSchema, type IdentityRevision, type NarrativeIdentity } from "./character-past-schema";
import { randomUUID } from "node:crypto";
import { readSimulationTime } from "../ecs/simulation-time";
import { readStampedSimulationTime, legacySimulationTimestamp } from "../ecs/temporal-age";
import { getCommittedEvents } from "../runtime/committed-events";
import { recordControlLoopDiagnostic } from "../runtime/control-loop-diagnostics";
import { getReflectionQuestions, prepareReflectionQuestions, formatReflectionQuestions, type ReflectionQuestionReview, type RaisedReflectionQuestion } from "./reflection-questions";
import { captureCognitiveLocalView, isCognitiveLocalViewCurrent, formatCognitiveLocalView, type CognitiveLocalView } from "./cognitive-local-view";

const model = flashModel;

// Default reflection threshold (accumulated importance before reflecting)
const DEFAULT_REFLECTION_THRESHOLD = 100;

const reflectionWork = new WeakMap<World, Map<number, { inFlight: boolean; retryAt: number;
  candidateScope?: string; candidateAttempts: Set<string> }>>();
function workFor(world: World) {
  let work = reflectionWork.get(world);
  if (!work) { work = new Map(); reflectionWork.set(world, work); }
  return work;
}
function canReflect(world: World, eid: number) {
  return world.meta.aiEnabled !== false && entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid];
}
/** Scheduling identity only, never evidence or admission authority. Scene/clock
 * churn does not create new work; a source or actor replacement gets a fresh
 * opportunity to interpret its own restored history against current evidence. */
function reflectionCandidateBatch(world: World, eid: number): { scope: string; candidates: string[]; retained: Set<string> } | undefined {
  const state = getReflectionState(world, eid), source = getCommittedEvents(world);
  if (state === undefined || source.stopped || !hasComponent(world, eid, WorkingMemoryIdentity)
    || !WorkingMemoryIdentity.id[eid]) return;
  const questions = getReflectionQuestions(world, eid);
  const candidates = questions.filter(row => row.status === "candidate").map(row => row.id).sort();
  if (!candidates.length) return;
  return { scope: JSON.stringify([source.sourceId, WorkingMemoryIdentity.id[eid], state]), candidates,
    retained: new Set(questions.map(row => row.id)) };
}
/** Cheap scheduler demand check; failed generations back off without occupying a lane. */
export function hasPendingReflection(world: World, eid: number): boolean {
  const work = reflectionWork.get(world)?.get(eid);
  if (!canReflect(world, eid) || getCommittedEvents(world).stopped || work?.inFlight || Date.now() < (work?.retryAt ?? 0)) return false;
  if (shouldReflect(world, eid)) return true;
  const batch = reflectionCandidateBatch(world, eid);
  return batch !== undefined && (work?.candidateScope !== batch.scope || batch.candidates.some(id => !work.candidateAttempts.has(id)));
}

export interface ReflectionInsight {
  insight: string;
  importance: number;
  relatedMemories: string[];
  category: "self" | "social" | "world" | "goal";
  /** Missing legacy scope is conservatively current, regardless of category. */
  temporalScope?: "current" | "historical";
  /** Exact references issued in this request's bounded source catalogue. */
  sourceIds?: string[];
  narrativeKind?: "recollection" | "learning";
  /** Optional, sourced change in self-understanding. Never edits the past. */
  identityRevision?: IdentityRevision;
}

export interface ReflectionResult {
  insights: ReflectionInsight[];
  questionsRaised: RaisedReflectionQuestion[];
  questionReviews?: ReflectionQuestionReview[];
  emotionalSummary: string;
}

type ReflectionSource = ReflectionContextSource | { kind: "dialogue"; turn: SocialDialogueTurn };
interface ReflectionAdmission {
  requestId: string;
  consumed?: boolean;
  world: World;
  actorEid: number;
  ownerKey: string;
  identity: string;
  issuedAt: number;
  consideredAtSimMs: number;
  runtimeSource: string | null;
  narrative: boolean;
  sources: ReadonlyMap<string, ReflectionSource>;
  currentPhysical: string;
  currentDialogue: string;
  currentCoordination: string;
  currentKnowledge: string;
  currentDescription: string;
  localView: Readonly<CognitiveLocalView> | undefined;
  insights: ReadonlySet<string>;
  questionBasis: string;
  questionOutput: string;
}
const reflectionAdmissions = new WeakMap<ReflectionResult, ReflectionAdmission>();
// Engine-owned metadata, not model fields. A candidate cannot promote itself
// when a later storage check happens to see the old scene again.
const admittedQuestionOutputs = new WeakMap<ReflectionResult, { output: string; candidateKeys: ReadonlySet<string> }>();
const sourceId = (source: ReflectionSource) => source.kind === "dialogue" ? `dialogue:${source.turn.id}` : reflectionSourceId(source);
const sourceTime = (source: ReflectionSource) => source.kind === "dialogue" ? source.turn.atMs
  : source.kind === "memory" ? source.memory.timestamp : source.kind === "narrative" ? source.entry.sourceAtSimMs : source.receipt.atMs;
const questionOutput = (result: ReflectionResult) => JSON.stringify([result.questionsRaised, result.questionReviews ?? []]);
const questionSources = (sources: ReadonlyMap<string, ReflectionSource>) => new Map([...sources].map(([id, source]) => [id,
  source.kind === "dialogue" ? `${source.turn.speaker}: ${source.turn.content}` : source.kind === "memory" ? source.memory.content
    : source.kind === "narrative" ? source.entry.monologue : source.receipt.summary]));
const actorIdentity = (eid: number) => JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]);

function identityRevisionValid(world: World, eid: number, insight: ReflectionInsight, sources: ReadonlyMap<string, ReflectionSource>): boolean {
  if (!insight.identityRevision) return true;
  const parsed = identityRevisionSchema.safeParse(insight.identityRevision);
  if (!world.meta.narrativeMind || !parsed.success || insight.category !== "self" || insight.importance < 7
    || insight.temporalScope !== "historical" || !insight.sourceIds?.length) return false;
  const cited = insight.sourceIds.map(id => sources.get(id));
  // A reflection on a reflection isn't another life event. Require experienced
  // material as well as the previous interpretation when revising an anchor.
  const experienced = cited.some(source => source?.kind === "dialogue" || source?.kind === "physical_receipt"
    || source?.kind === "memory" && source.memory.type === "episodic"
    || source?.kind === "narrative" && !source.entry.identity && source.entry.evidence.some(e => e.kind === "experience" || e.kind === "dialogue" || e.kind === "interaction"));
  if (!experienced) return false;
  const anchors = getIdentityAnchors(world, eid);
  if (parsed.data.anchorId === "new") return anchors.length < 12;
  const current = anchors.find(row => row.identity!.anchorId === parsed.data.anchorId);
  return !!current && insight.sourceIds.includes(current.id);
}

/** Values, not refresh ages, define a changed physical understanding. New own
 * outcomes also matter when a private read has no public state-changing fact. */
function physicalContext(memory: ActorWorkingMemory): string {
  const facts = memory.facts.map(f => [f.subject, f.subjectLabel, f.predicate, f.slot || "", f.value, f.valueLabel])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const ownOutcome = [...memory.receipts].reverse().find(r => r.kind === "action" && r.provenance === "own_action")?.id;
  return JSON.stringify({ facts, ownOutcome });
}

/** Per-insight admission keeps unrelated sourced history while rejecting stale
 * present-tense interpretations, even when their category is self/social or they
 * use only pronouns. The local-view check compares visible public state only;
 * it neither refreshes memory nor looks up a remote actor's current state. */
function admitReflection(world: World, eid: number, result: ReflectionResult, stage = "generation_admission"): ReflectionResult | null {
  const admission = reflectionAdmissions.get(result);
  if (!admission) return result; // Direct trusted storage callers retain the legacy API.
  const report = (reason: string | undefined, retained?: ReflectionResult, insightReasons?: string[]) => {
    // Cross-world attempts do not copy even diagnostic counts to another world.
    if (admission.world !== world || admission.actorEid !== eid) return;
    recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: eid, requestId: admission.requestId,
      stage, detail: { reason, input: reflectionCounts(result), retained: reflectionCounts(retained),
        candidateQuestions: retained ? admittedQuestionOutputs.get(retained)?.candidateKeys.size ?? 0 : 0, insightReasons } }));
  };
  let reason: string | undefined;
  const check = (label: string, valid: boolean) => { if (!valid) reason = label; return valid; };
  if (!check("consumed", !admission.consumed)
    || !check("owner_world", admission.world === world && admission.actorEid === eid)
    || !check("actor_unavailable", !!canReflect(world, eid))
    || !check("source_stopped", !getCommittedEvents(world).stopped)
    || !check("source_changed", getCommittedEvents(world).sourceId === admission.runtimeSource)
    || !check("mode_changed", (world.meta.narrativeMind === true) === admission.narrative)
    || !check("owner_changed", hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === admission.ownerKey)
    || !check("identity_changed", actorIdentity(eid) === admission.identity)
    || !check("clock_reversed", !(Date.now() < admission.issuedAt) && readSimulationTime(world) >= admission.consideredAtSimMs)) { report(reason); return null; }
  const memory = getWorkingMemory(world, eid), dialogue = getSocialDialogue(world, eid);
  const currentUnchanged = check("local_view_unavailable", admission.localView !== undefined)
    && check("local_view_changed", isCognitiveLocalViewCurrent(world, eid, admission.localView!))
    && check("physical_memory_changed", physicalContext(memory) === admission.currentPhysical)
    && check("dialogue_changed", JSON.stringify(dialogue) === admission.currentDialogue)
    && check("description_changed", Description.value[eid] === admission.currentDescription)
    && check("knowledge_changed", getKnowledgeSummary(world, eid) === admission.currentKnowledge)
    && check("coordination_changed", coordinationDependency(getCoordinationMemory(world, eid), { all: true, strict: true }) === admission.currentCoordination);
  const currentSources: ReflectionSource[] = [...reflectionMemorySources(world, eid).map(memory => ({ kind: "memory" as const, memory })),
    ...[...admission.sources.values()].flatMap(source => source.kind === "narrative"
      ? getNarrativeHistory(world, eid, { id: source.entry.id, limit: 1 }).map(entry => ({ kind: "narrative" as const, entry })) : []),
    ...memory.receipts.map(receipt => ({ kind: "physical_receipt" as const, receipt })),
    ...dialogue.map(turn => ({ kind: "dialogue" as const, turn }))];
  const ownedSources = new Map(currentSources.map(source => [sourceId(source), JSON.stringify(source)]));
  const validSources = new Map([...admission.sources].map(([id, source]) => [id, ownedSources.get(id) === JSON.stringify(source)]));
  const allSourcesValid = [...validSources.values()].every(Boolean);
  const insightReasons: string[] = [];
  const insights = result.insights.filter(insight => {
    const drop = (why: string) => { insightReasons.push(why); return false; };
    if (!admission.insights.has(JSON.stringify(insight))) return drop("output_changed");
    const references = insight.sourceIds || [];
    if (references.some(id => !validSources.get(id))) return drop("cited_source_changed");
    if (!identityRevisionValid(world, eid, insight, admission.sources)) return drop("identity_revision_invalid");
    const valid = insight.temporalScope === "historical" ? references.length > 0 : currentUnchanged && allSourcesValid;
    return valid || drop(insight.temporalScope === "historical" ? "missing_historical_sources" : reason ?? "source_changed");
  });
  const priorQuestionAdmission = admittedQuestionOutputs.get(result);
  const questionsIntact = check("question_basis_changed", JSON.stringify(getReflectionQuestions(world, eid)) === admission.questionBasis)
    && check("question_output_changed", questionOutput(result) === (priorQuestionAdmission?.output ?? admission.questionOutput));
  const questionsCurrent = currentUnchanged && check("question_source_changed", allSourcesValid) && questionsIntact;
  const candidateKeys = new Set<string>();
  const questionsRaised = result.questionsRaised.filter(question => {
    if (!questionsIntact) return false;
    if (typeof question === "string") return questionsCurrent; // Legacy unsourced questions retain the old rule.
    if (!question.sourceIds.every(id => validSources.get(id))) return false;
    if (!questionsCurrent || priorQuestionAdmission?.candidateKeys.has(JSON.stringify(question))) candidateKeys.add(JSON.stringify(question));
    return true;
  });
  const questionReviews = questionsCurrent ? result.questionReviews ?? [] : [];
  if ((result.insights.length || result.questionsRaised.length || result.questionReviews?.length)
    && !insights.length && !questionsRaised.length && !questionReviews.length) { report(reason, undefined, insightReasons); return null; }
  const admitted = { ...result, insights, questionsRaised,
    ...(result.questionReviews !== undefined ? { questionReviews } : {}),
    emotionalSummary: currentUnchanged ? result.emotionalSummary : "" };
  reflectionAdmissions.set(admitted, admission);
  admittedQuestionOutputs.set(admitted, { output: questionOutput(admitted), candidateKeys });
  report(reason, admitted, insightReasons);
  return admitted;
}

function reflectionCounts(result?: Partial<ReflectionResult>) {
  return { insights: Array.isArray(result?.insights) ? result.insights.length : 0,
    questions: Array.isArray(result?.questionsRaised) ? result.questionsRaised.length : 0,
    reviews: Array.isArray(result?.questionReviews) ? result.questionReviews.length : 0 };
}

function retrospectiveText(insight: ReflectionInsight, admission: ReflectionAdmission | undefined): string {
  if (insight.temporalScope !== "historical" || !admission || !insight.sourceIds?.length) return insight.insight;
  const lastSourceAt = Math.max(...insight.sourceIds.map(id => sourceTime(admission.sources.get(id)!)));
  const date = new Date(lastSourceAt);
  const hasNarrative = insight.sourceIds.some(id => admission.sources.get(id)?.kind === "narrative");
  const time = hasNarrative ? "the cited historical records (each in its recorded time domain)" : Number.isFinite(date.getTime()) ? date.toISOString() : `recorded atMs=${lastSourceAt}`;
  return `Looking back at earlier experiences through ${time} (${insight.sourceIds.length} cited sources; a retrospective interpretation): ${insight.insight}`;
}

/**
 * Initialize reflection state for an agent
 */
export function initializeReflectionState(
  world: World,
  agentEid: number,
  threshold: number = DEFAULT_REFLECTION_THRESHOLD
): number {
  // Check if already has reflection state
  const existing = getRelationTargets(world, agentEid, HasReflectionState);
  if (existing.length > 0) {
    return existing[0];
  }

  const stateEid = addEntity(world);
  addComponent(world, stateEid, ReflectionState);
  addComponent(world, agentEid, HasReflectionState(stateEid));

  ReflectionState.lastReflection[stateEid] = Date.now();
  ReflectionState.importanceAccum[stateEid] = 0;
  ReflectionState.reflectionThreshold[stateEid] = threshold;
  ReflectionState.reflectionCount[stateEid] = 0;
  ReflectionState.insights[stateEid] = "[]";
  ReflectionState.questions[stateEid] = "[]";

  return stateEid;
}

/**
 * Get the reflection state for an agent
 */
export function getReflectionState(world: World, agentEid: number): number | undefined {
  const targets = getRelationTargets(world, agentEid, HasReflectionState);
  return targets.length > 0 ? targets[0] : undefined;
}

/**
 * Add importance to an agent's reflection accumulator
 * Call this when the agent experiences something
 */
export function accumulateImportance(world: World, agentEid: number, importance: number): void {
  const stateEid = getReflectionState(world, agentEid);
  if (stateEid === undefined) return;

  const current = ReflectionState.importanceAccum[stateEid] || 0;
  ReflectionState.importanceAccum[stateEid] = current + importance;
}

/**
 * Check if an agent should reflect (importance exceeds threshold)
 */
export function shouldReflect(world: World, agentEid: number): boolean {
  const stateEid = getReflectionState(world, agentEid);
  if (stateEid === undefined) return false;

  const accum = ReflectionState.importanceAccum[stateEid] || 0;
  const threshold = ReflectionState.reflectionThreshold[stateEid] || DEFAULT_REFLECTION_THRESHOLD;

  return accum >= threshold;
}

/**
 * Build context for reflection generation
 */
function buildReflectionContext(
  world: World,
  agentEid: number,
  sources: ReflectionContextSource[],
  dialogue: readonly SocialDialogueTurn[],
  knowledge: string,
  localView: Readonly<CognitiveLocalView> | undefined
): string {
  const agentName = Name.value[agentEid];
  const agentDesc = Description.value[agentEid];
  const agentRole = Agent.role[agentEid];

  return `You are ${agentName}, turning recent experiences over in your mind — what they mean, what they stir up, what you now suspect or want.

AGENT:
- Name: ${agentName}
- Description: ${agentDesc}
- Role: ${agentRole}
${world.meta.narrativeMind ? `- My character and outlook: ${JSON.stringify(Agent.systemPrompt[agentEid])}` : ""}

${formatWorkingMemoryContext(world, agentEid)}

${formatCoordinationContext(world, agentEid)}

${formatReflectionQuestions(world, agentEid, true)}

RECENT ACTUAL DIALOGUE (only words you spoke or heard; claims, not verified physical outcomes):
${dialogue.map(turn => `[sourceId=${JSON.stringify(`dialogue:${turn.id}`)}; atMs=${turn.atMs}; ${turn.own ? "own speech" : "heard"}; speaker=${JSON.stringify(turn.speaker)}; room=${JSON.stringify(turn.room)}] ${JSON.stringify(turn.content)}`).join("\n") || "No spoken exchange recorded."}

SELECTED EXPERIENCES (a bounded, diverse sample, not an exhaustive autobiography):
${formatReflectionSources(sources)}
Physical receipts establish past observed outcomes, not current remote state. Remembered episodes and interpretations can predate or conflict with these sources; importance is salience, not authority.

${knowledge ? `EXISTING KNOWLEDGE:\n${knowledge}` : ""}

${localView ? `FRESH LOCAL SENSING (current request, not a remembered source):
${formatCognitiveLocalView(localView)}
This freshly sensed local view takes precedence for what is here and happening now. The earlier evidence ledger remains last-known experience, especially for anything outside this view.`
    : "CURRENT LOCAL VIEW: unavailable; the records above establish past experiences, not present local conditions."}`;
}

function reflectionMemorySources(world: World, agentEid: number): ReflectionMemorySource[] {
  return getAgentMemories(world, agentEid).map(id => ({ id, content: Memory.content[id],
    importance: normalizeMemoryImportance(Memory.importance[id]), type: Memory.type[id], timestamp: Memory.timestamp[id] }));
}

/**
 * Generate reflective insights using LLM
 */
export async function generateReflection(
  world: World,
  agentEid: number
): Promise<ReflectionResult | null> {
  if (!canReflect(world, agentEid)) return null;
  assertSimulationTaskActive();
  const agentName = Name.value[agentEid];
  // This is an explicit sensing boundary, not a scheduler/readiness probe. Take
  // it before assembling the evidence catalogue so stale local WM is corrected
  // for the request, while remote remembered locations remain only last-known.
  const localView = captureCognitiveLocalView(world, agentEid);

  // Get recent memories (as entity IDs)
  const memories = reflectionMemorySources(world, agentEid);
  const narratives = [...new Map([...selectNarrativeMemories(world, agentEid),
    ...selectIdentityAnchors(world, agentEid, getWorkingMemory(world, agentEid).receipts.slice(-4).map(r => r.summary).join(" "))]
    .map(entry => [entry.id, entry])).values()];
  if (memories.length === 0 && narratives.length === 0) {
    console.log(`[Reflection] ${agentName} has no memories to reflect on`);
    return null;
  }

  const workingMemory = getWorkingMemory(world, agentEid);
  const sources: ReflectionContextSource[] = [...selectReflectionSources(memories, workingMemory.receipts, 20 - narratives.length),
    ...narratives.map(entry => ({ kind: "narrative" as const, entry }))];
  const dialogue = getSocialDialogue(world, agentEid);
  const selectedDialogue = dialogue.slice(-8);
  const knowledge = getKnowledgeSummary(world, agentEid), description = Description.value[agentEid];
  const context = buildReflectionContext(world, agentEid, sources, selectedDialogue, knowledge, localView);
  const coordinationMemory = getCoordinationMemory(world, agentEid);
  const owner = workingMemoryEntityRef(world, agentEid); if (!owner) return null;
  const issuedAt = Date.now();
  const consideredAtSimMs = readSimulationTime(world);
  const requestId = `reflection:${randomUUID()}`;
  const runtimeSource = getCommittedEvents(world).sourceId, narrative = world.meta.narrativeMind === true;
  const issuedSources: ReflectionSource[] = [...sources, ...selectedDialogue.map(turn => ({ kind: "dialogue" as const, turn: structuredClone(turn) }))];
  const citableSourceIds = new Set(issuedSources.map(sourceId));
  // The knowledge summary also includes five recent memories, without citation
  // labels. Preserve their integrity for conservative current/legacy admission.
  for (const memory of [...memories].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5)) {
    if (!issuedSources.some(source => source.kind === "memory" && source.memory.id === memory.id)) issuedSources.push({ kind: "memory", memory: { ...memory } });
  }
  const sourceCatalogue = new Map(issuedSources.map(source => [sourceId(source), source]));
  const identity = actorIdentity(agentEid);
  const questionBasis = JSON.stringify(getReflectionQuestions(world, agentEid));

  const prompt = `${world.meta.narrativeMind ? "Write in this character's first-person inner voice, including each memory or realization. A recollection can narrate what I experienced and what I thought it meant; a learning can connect experiences, revise an expectation or notice something about myself. Mark narrativeKind as recollection or learning. Be honest the way people are with themselves at night: suspicion, guilt, longing, resentment and hope all belong. No tidy lessons; ambivalence is welcome. Notice what you now want to do about it.\nFor a genuinely formative self-insight (importance >=7), you may include identityRevision: {anchorId, selfBelief, meaning, cues:[short relevant cues]}. Use a supplied anchorId and cite its current sourceId plus experienced evidence to revise it; use anchorId 'new' only for a new enduring meaning grounded in experience. Use historical temporalScope. Omit this for ordinary thoughts. \n" : ""}Return up to 4 insights supported by these memories, connecting experiences when useful. Keep what you saw distinct from what you suspect. Importance ranges from 0 to 10. Insights and questions may be empty arrays when nothing is new.
For each insight cite 1–8 exact sourceId values. temporalScope is "historical" for interpreting those past experiences, or "current" if it depends on the present situation (including what people know, await, hold, or are doing). A category is not a time scope; split mixed historical/current claims. Historical interpretations are stored as explicitly retrospective, never as current world proof.
Raise at most 4 useful unanswered questions as {question,sourceIds}, each at most 400 characters, citing 1–8 exact sourceIds that prompted it. Keep existing questions rather than repeating them. If the situation changes before this returns, a sourced question may remain only a historical candidate. To reconsider a listed question or candidate, optionally include questionReviews:[{id,status:"open|answered|parked",reason,sourceIds}]. Choose one status and cite 1–8 exact sourceIds from this request for each review (at most 4). The reason states what evidence answered it, why it remains relevant and open, or why I am setting it aside. An unanswered question need not become a task. These are my interpretations, not objective proof or permission to act.

Respond with JSON only:
{
  "insights": [
    {
      "insight": "The realization or understanding",
      "importance": 7.5,
      "relatedMemories": ["brief reference to relevant experiences"],
      "category": "self|social|world|goal",
      "temporalScope": "historical|current",
      "sourceIds": ["exact sourceId from the context"]
    }
  ],
  "questionsRaised": [{"question":"A question prompted by these experiences", "sourceIds":["exact sourceId from the context"]}],
  "emotionalSummary": "brief emotional state summary after reflection"
}`;

  recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: agentEid, requestId,
    stage: "issued", detail: { sources: sourceCatalogue.size, questions: getReflectionQuestions(world, agentEid).length } }));
  const rejectGeneration = (reason: string) => {
    recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: agentEid, requestId,
      stage: "generation_rejected", detail: { reason } }));
    return null;
  };
  let generationPhase = "provider_error";
  try {
    const thinkingLevel=backgroundThinkingLevel();
    const deadline = AbortSignal.timeout(backgroundDeadlineMs("reflection",thinkingLevel));
    const parent = getSimulationTaskSignal();
    const signal = parent ? AbortSignal.any([parent, deadline]) : deadline;
    const response = await observeBackgroundProvider("reflection",agentEid,thinkingLevel,()=>generateText({
      model,
      system: context,
      prompt,
      abortSignal: signal, maxRetries: 0, maxOutputTokens: backgroundOutputTokens("reflection",thinkingLevel),
      // Reflection can spend more reasoning without blocking the next action.
      providerOptions: { google: { thinkingConfig: { thinkingLevel } } },
    }));
    signal.throwIfAborted();
    assertSimulationTaskActive();
    if(response.finishReason === "length") return rejectGeneration("output_limit");
    generationPhase = "malformed_json";
    const {text}=response;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Reflection] Failed to parse reflection JSON");
      return rejectGeneration("missing_json");
    }

    const result = JSON.parse(jsonMatch[0]) as ReflectionResult;
    recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: agentEid, requestId,
      stage: "generated", detail: reflectionCounts(result) }));
    if (!Array.isArray(result.questionsRaised) || prepareReflectionQuestions(world, agentEid, result.questionsRaised,
        result.questionReviews, new Map([...questionSources(sourceCatalogue)].filter(([id]) => citableSourceIds.has(id)))) === null ||
        typeof result.emotionalSummary !== "string" || !Array.isArray(result.insights) || result.insights.length > 4 || result.insights.some(i =>
      !i || typeof i.insight !== "string" || !i.insight.trim() || i.insight.length > 2000 ||
      !Number.isFinite(i.importance) || i.importance < 0 || i.importance > 10 ||
      !["self", "social", "world", "goal"].includes(i.category) || !Array.isArray(i.relatedMemories) ||
      i.relatedMemories.some(m => typeof m !== "string") || i.temporalScope !== undefined && !["historical", "current"].includes(i.temporalScope)
      || i.narrativeKind !== undefined && !["recollection", "learning"].includes(i.narrativeKind)
      || i.sourceIds !== undefined && (!Array.isArray(i.sourceIds) || i.sourceIds.length > 8 || new Set(i.sourceIds).size !== i.sourceIds.length
        || i.sourceIds.some(id => typeof id !== "string" || !citableSourceIds.has(id)))
      || i.temporalScope === "historical" && !i.sourceIds?.length
      || !identityRevisionValid(world, agentEid, i, sourceCatalogue))) return rejectGeneration("invalid_schema");
    generationPhase = "admission_error";
    reflectionAdmissions.set(result, { requestId, world, actorEid: agentEid, ownerKey: owner.key, identity, issuedAt, consideredAtSimMs, runtimeSource, narrative, sources: sourceCatalogue,
      currentPhysical: physicalContext(workingMemory), currentDialogue: JSON.stringify(dialogue),
      currentCoordination: coordinationDependency(coordinationMemory, { all: true, strict: true }),
      currentKnowledge: knowledge, currentDescription: description, localView,
      insights: new Set(result.insights.map(insight => JSON.stringify(insight))), questionBasis, questionOutput: questionOutput(result) });
    const admitted = admitReflection(world, agentEid, result);
    console.log(`[Reflection] ${agentName} generated ${admitted?.insights.length || 0} admitted insights`);
    return admitted;
  } catch (error) {
    console.error("[Reflection] Error generating reflection:", error);
    return rejectGeneration(getSimulationTaskSignal()?.aborted ? "cancelled"
      : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "timeout" : generationPhase);
  }
}

/**
 * Store reflection insights as new memories and thoughts
 */
export function storeReflectionResults(
  world: World,
  agentEid: number,
  result: ReflectionResult
): boolean {
  const admitted = admitReflection(world, agentEid, result, "storage_admission"); if (!admitted) return false;
  result = admitted;
  const provenance = reflectionAdmissions.get(result);
  const rejectStorage = (reason: string) => {
    if (provenance) recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: agentEid,
      requestId: provenance.requestId, stage: "storage_rejected", detail: { reason } }));
    return false;
  };
  if (!provenance && result.questionsRaised.some(question => typeof question !== "string")) return rejectStorage("unissued_question_sources");
  // Direct legacy storage remains usable, but cannot mint identity changes
  // without a model request's issued, owner-bound evidence catalogue.
  if (result.insights.some(i => i.identityRevision && !provenance)) return rejectStorage("unissued_identity_revision");
  const revisedIds = result.insights.flatMap(i => i.identityRevision && i.identityRevision.anchorId !== "new" ? [i.identityRevision.anchorId] : []);
  if (new Set(revisedIds).size !== revisedIds.length) return rejectStorage("duplicate_identity_revision");
  if (getIdentityAnchors(world, agentEid).length + result.insights.filter(i => i.identityRevision?.anchorId === "new").length > 12) return rejectStorage("identity_capacity");
  const questions = prepareReflectionQuestions(world, agentEid, result.questionsRaised, result.questionReviews,
    provenance ? questionSources(provenance.sources) : undefined,
    provenance ? { consideredAtSimMs: provenance.consideredAtSimMs, requestId: provenance.requestId,
      candidateKeys: admittedQuestionOutputs.get(result)?.candidateKeys ?? new Set() } : undefined);
  if (!questions) return rejectStorage("invalid_question_update");
  if (provenance) provenance.consumed = true;
  const agentName = Name.value[agentEid];
  const stateEid = getReflectionState(world, agentEid) ?? (questions.length ? initializeReflectionState(world, agentEid) : undefined);
  // Restored history is not guaranteed to be valid JSON. Prepare it before
  // writing new memories so corrupt history cannot produce a partial commit.
  let existingInsights: Array<{ insight: string; timestamp: number; category: string }> = [];
  try {
    const parsed = JSON.parse(stateEid === undefined ? "[]" : ReflectionState.insights[stateEid] || "[]");
    if (Array.isArray(parsed)) existingInsights = parsed.filter(i => i && typeof i.insight === "string" && Number.isFinite(i.timestamp));
  } catch { /* Discard corrupt history, not the new evidence. */ }

  for (const insight of result.insights) {
    // Preserve the exact admitted source excerpts before bounded ordinary
    // memory storage can prune them. Never archive unsourced model claims.
    if (provenance && insight.sourceIds?.length) {
      const now = readSimulationTime(world);
      const legacyTime = (atWallMs: number) => Math.max(0, Math.min(now, legacySimulationTimestamp(world, atWallMs)));
      const evidence: NarrativeEvidence[] = insight.sourceIds.map(id => {
        const source = provenance.sources.get(id)!;
        if (source.kind === "narrative") return { id, kind: "reflection", content: source.entry.monologue, atSimMs: source.entry.sourceAtSimMs };
        if (source.kind === "dialogue") return { id, kind: "dialogue", content: source.turn.content.slice(0, 4000), atSimMs: source.turn.atSimMs ?? legacyTime(source.turn.atMs),
          atWallMs: source.turn.atMs, timeBasis: source.turn.atSimMs === undefined ? "legacy-estimate" : "simulation" };
        if (source.kind === "memory") return { id, kind: "memory", content: source.memory.content.slice(0, 4000),
          atSimMs: Math.max(0, Math.min(now, readStampedSimulationTime(world, source.memory.id, "Memory.timestamp", source.memory.timestamp))) };
        return { id, kind: "experience", content: source.receipt.summary.slice(0, 4000), atSimMs: legacyTime(source.receipt.atMs),
          atWallMs: source.receipt.atMs, timeBasis: "legacy-estimate" };
      });
      let identity: NarrativeIdentity | undefined;
      if (insight.identityRevision) {
        const revision = identityRevisionSchema.parse(insight.identityRevision);
        const previous = getIdentityAnchors(world, agentEid).find(row => row.identity!.anchorId === revision.anchorId);
        identity = { ...(previous?.identity ?? {}), ...revision,
          anchorId: previous?.identity?.anchorId ?? `identity:${randomUUID()}`,
          ...(previous ? { revises: previous.id } : {}) };
      }
      appendNarrative(world, agentEid, { kind: insight.narrativeKind ?? "learning", monologue: insight.insight, ...(identity ? { identity } : {}),
        importance: insight.importance / 10, evidence, sourceAtSimMs: Math.max(...evidence.map(e => e.atSimMs)) });
    }
    // Add as high-importance semantic memory (reflections are higher-order semantic understanding)
    addMemory(world, agentEid, {
      type: "semantic",
      content: `[Reflection] ${retrospectiveText(insight, provenance)}`,
      importance: insight.importance,
      importanceScale: 10,
      countForReflection: false,
      emotionalValence: 0, // Neutral by default
      timestamp: Date.now(),
    });

    // Also add as a thought (for immediate context)
    addThought(world, agentEid, {
      content: retrospectiveText(insight, provenance),
      type: "insight",
      salience: insight.importance / 10,
    });

    console.log(`[Reflection] ${agentName} realized: "${insight.insight.slice(0, 60)}..."`);
  }

  // Update reflection state
  if (stateEid !== undefined) {
    ReflectionState.lastReflection[stateEid] = Date.now();
    ReflectionState.importanceAccum[stateEid] = 0; // Reset accumulator
    ReflectionState.reflectionCount[stateEid] = (ReflectionState.reflectionCount[stateEid] || 0) + 1;

    // Store recent insights
    const newInsights = result.insights.map(i => ({
      insight: retrospectiveText(i, provenance),
      timestamp: Date.now(),
      category: i.category,
      ...(i.temporalScope ? { temporalScope: i.temporalScope } : {}),
      ...(i.sourceIds ? { sourceIds: [...i.sourceIds] } : {}),
    }));
    // Keep last 10 insights
    const allInsights = [...newInsights, ...existingInsights].slice(0, 10);
    ReflectionState.insights[stateEid] = JSON.stringify(allInsights);
    ReflectionState.questions[stateEid] = JSON.stringify(questions);
  }
  if (provenance) recordControlLoopDiagnostic(world, () => ({ lane: "reflection", actorId: agentEid,
    requestId: provenance.requestId, stage: "stored", detail: { ...reflectionCounts(result), totalQuestions: questions.length,
      totalCandidates: questions.filter(question => question.status === "candidate").length } }));
  return true;
}

/**
 * Run the existing reflection when accumulated experience is due, or give an
 * unreviewed historical candidate batch one fresh opportunity. The model may
 * leave it unresolved; neither elapsed time nor stale output promotes it.
 */
export async function maybeReflect(world: World, agentEid: number): Promise<boolean> {
  if (!hasPendingReflection(world, agentEid)) {
    return false;
  }
  assertSimulationTaskActive();

  const agentName = Name.value[agentEid];
  console.log(`[Reflection] ${agentName} is reflecting on recent experiences...`);

  const stateEid = getReflectionState(world, agentEid)!;
  const accumulated = ReflectionState.importanceAccum[stateEid] || 0;
  const identity = [Name.value[agentEid], Agent.role[agentEid], Agent.systemPrompt[agentEid]].join("|");
  const previous = reflectionWork.get(world)?.get(agentEid);
  const batch = reflectionCandidateBatch(world, agentEid);
  // Reserve at dispatch, not in readiness. A malformed/stale response must not
  // generate an unbounded candidate-only retry loop. Ordinary importance still
  // schedules independently, and retains its existing failure backoff.
  // Retain coverage only inside the bounded question store. Removing/reviewing
  // one row must not make the remaining old candidates a new work batch.
  const candidateAttempts = new Set(batch && previous?.candidateScope === batch.scope
    ? [...previous.candidateAttempts].filter(id => batch.retained.has(id)) : []);
  for (const id of batch?.candidates ?? []) candidateAttempts.add(id);
  const work = { inFlight: true, retryAt: 0, candidateScope: batch?.scope, candidateAttempts };
  workFor(world).set(agentEid, work);
  try {
    const result = await generateReflection(world, agentEid);
    assertSimulationTaskActive();
    // Reflection interprets historical evidence. Movement is fine; changed identity,
    // removed evidence, a stopped simulation, or replaced reflection state is not.
    if (!result || !canReflect(world, agentEid) || getReflectionState(world, agentEid) !== stateEid ||
        identity !== [Name.value[agentEid], Agent.role[agentEid], Agent.systemPrompt[agentEid]].join("|")) return false;
    const unprocessedImportance = Math.max(0, (ReflectionState.importanceAccum[stateEid] || 0) - accumulated);
    if (!storeReflectionResults(world, agentEid, result)) return false;
    // Do not erase experiences that arrived while the subconscious was occupied.
    ReflectionState.importanceAccum[stateEid] = unprocessedImportance;
    return true;
  } finally {
    work.inFlight = false;
    work.retryAt = Date.now() + 5_000;
  }
}

/**
 * Run the reflection system for all agents
 */
export async function runReflectionSystem(world: World): Promise<number> {
  const agents = query(world, [Agent, Mind]);
  let reflectionsTriggered = 0;

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    // Ensure agent has reflection state
    let stateEid = getReflectionState(world, agentEid);
    if (!stateEid) {
      stateEid = initializeReflectionState(world, agentEid);
    }

    // Check and maybe reflect
    if (await maybeReflect(world, agentEid)) {
      reflectionsTriggered++;
    }
  }

  return reflectionsTriggered;
}

/**
 * Get recent insights for inclusion in agent context
 */
export function getRecentInsights(world: World, agentEid: number, count: number = 3): string[] {
  const stateEid = getReflectionState(world, agentEid);
  if (!stateEid) return [];

  try {
    const insightsJson = ReflectionState.insights[stateEid];
    if (!insightsJson) return [];

    const insights = JSON.parse(insightsJson) as Array<{ insight: string; timestamp: number }>;
    return insights.slice(0, count).map(i => i.insight);
  } catch {
    return [];
  }
}

/**
 * Format reflection insights for agent context
 */
export function formatInsightsForContext(world: World, agentEid: number): string {
  const insights = getRecentInsights(world, agentEid, 3);
  if (insights.length === 0) return "";

  return `RECENT REALIZATIONS (interpretations of past experiences, not new world facts):\n${insights.map(i => `- ${i}`).join("\n")}`;
}
