import type { World } from "../ecs/world";
import { isDocumentOperation } from "../world/productive-work";
import { requiresFreshAffordanceDecision } from "../world/affordance-availability";
import { recordGoalAttemptActivity, exhaustGoalMacro, isGoalMacroExhausted } from "./goal-attempt";
import { addComponent, addEntity, getRelationTargets, hasComponent, removeComponent } from "bitecs";
import { Agent, Goal, Memory, Name, Perception, Plan, PlanningDecision, ProcedureState } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { HasPerception } from "../ecs/relations";
import { HasGoal } from "../ecs/relations";
import { getNextPlannedAction, getPlanForGoal } from "./planning-system";
import { getRoomForEntity } from "../ecs/location";
import { ensureGoalSignature, goalSignatureId } from "./goal-contract";
import { getAgentVisibleEntities } from "./world-capabilities";
import { readSimulationTime } from "../ecs/simulation-time";
import type { PersonQuery, PlaceQuery, TargetQuery } from "../learning/library";
import { bindPerson, bindPlaceQuery, bindTargetQuery, fillPlaceholders, hasPlaceholder, peopleWithFeatures, personByRule } from "../learning/binding";
import { markVoicedSpeech, noteDistilledDecision, requestDecision } from "./decision-leaves";
import { abstractText, buildNameIndex, goalKeywords, goalPatternMatches } from "../learning/abstraction";

export type AgentActionLike = {
  type: string;
  target?: string;
  content?: string;
};

export type ProceduralSkillV1 = {
  kind: "procedure_v1";
  signature: string;
  name: string;
  trigger: {
    affordance: string;
    requiredTraits?: string[];
    toolId?: string;
    /** The intention a compiled plan/goal macro was learned for (plan macros). */
    goal?: string;
    /** Library macros: keywords of the kind of intention this applies to. */
    goalPattern?: string[];
  };
  example?: {
    targetName?: string;
    args?: string;
  };
  steps: Array<{
    type: "interact" | "move" | "observe" | "think" | "speak" | "wait" | "await";
    target?: string;
    content?: string;
    waitFor?: {
      perceptionType: string;
      includes?: string;
    };
    onMatchNext?: number;
    onMismatchNext?: number;
    onSuccessNext?: number;
    onFailureNext?: number;
    /** Library (abstract) steps, bound to this world at run time. Optional and
     * absent from concrete procedures, which behave exactly as before. */
    targetQuery?: TargetQuery;
    placeQuery?: PlaceQuery;
    person?: PersonQuery;
  }>;
  /** Seeded from the cross-session skill library (src/learning). */
  library?: { entryId: string; status: "promoted" | "candidate"; run?: string; seededSuccesses?: number; seededFailures?: number };
  stats: {
    successes: number;
    failures: number;
    createdAt: number;
    lastUsedAt: number;
  };
};

export function parseProceduralSkillV1(content: string): ProceduralSkillV1 | null {
  const raw = String(content || "").trim();
  if (!raw) return null;

  let jsonText = raw;
  if (raw.startsWith("[ProcedureV1]")) {
    jsonText = raw.slice("[ProcedureV1]".length).trim();
  }

  try {
    const obj = JSON.parse(jsonText);
    if (!obj || obj.kind !== "procedure_v1") return null;
    if (typeof obj.signature !== "string" || typeof obj.name !== "string") return null;
    if (!obj.trigger || typeof obj.trigger.affordance !== "string") return null;
    if (!Array.isArray(obj.steps) || obj.steps.length === 0 || obj.steps.length > 100) return null;
    for (const step of obj.steps) {
      if (!step || !["interact", "move", "observe", "think", "speak", "wait", "await"].includes(step.type)) return null;
      for (const key of ["onMatchNext", "onMismatchNext", "onSuccessNext", "onFailureNext"]) {
        if (step[key] !== undefined && (!Number.isInteger(step[key]) || step[key] < 0 || step[key] > obj.steps.length)) return null;
      }
      if (step.type === "await" && (!step.waitFor || typeof step.waitFor.perceptionType !== "string")) return null;
      if (step.targetQuery !== undefined && (typeof step.targetQuery !== "object" || step.targetQuery === null)) return null;
      if (step.placeQuery !== undefined && !["home", "workplace", "current", "room-with"].includes(step.placeQuery?.place)) return null;
      if (step.person !== undefined && !["addressee", "anyone-present", "role"].includes(step.person?.person)) return null;
    }
    if (!obj.stats || typeof obj.stats.successes !== "number") return null;
    return obj as ProceduralSkillV1;
  } catch {
    return null;
  }
}

export function serializeProceduralSkillV1(skill: ProceduralSkillV1): string {
  return `[ProcedureV1] ${JSON.stringify(skill)}`;
}

// ---------------------------------------------------------------------------
// Execution outcomes (read by the skill-library harvest) and run-time binding
// of abstract (library) steps. Concrete procedures never bind anything.
// ---------------------------------------------------------------------------

export type ProcedureOutcome = { agentEid: number; signature: string; started: number; completed: number; failed: number; abandoned: number };
const outcomeLedgers = new WeakMap<World, Map<string, ProcedureOutcome>>();
function noteProcedureOutcome(world: World, agentEid: number, signature: string, kind: "started" | "completed" | "failed" | "abandoned"): void {
  if (!signature) return;
  let ledger = outcomeLedgers.get(world);
  if (!ledger) { ledger = new Map(); outcomeLedgers.set(world, ledger); }
  const key = `${agentEid}\u0000${signature}`;
  let row = ledger.get(key);
  if (!row) { row = { agentEid, signature, started: 0, completed: 0, failed: 0, abandoned: 0 }; ledger.set(key, row); }
  row[kind]++;
}
/** Every procedure start and settlement in this world, per resident and signature. */
export function getProcedureOutcomes(world: World): ProcedureOutcome[] {
  return [...(outcomeLedgers.get(world)?.values() ?? [])].map(row => ({ ...row }));
}

type ProcedureStep = ProceduralSkillV1["steps"][number];
type Binding = { signature: string; stepIndex: number; step: ProcedureStep; object?: string; addressee?: string };
const bindings = new WeakMap<World, Map<number, Binding>>();
const progressMarks = new WeakMap<World, Map<number, { signature: string; stepIndex: number; atSimMs: number }>>();
/** An abstract step that cannot bind for this long (simulated) abandons its procedure quietly. */
export const LIBRARY_UNBOUND_ABANDON_MS = 45_000;

export const isAbstractProcedureStep = (step: ProcedureStep | undefined): boolean =>
  !!step && !!(step.targetQuery || step.placeQuery || step.person || hasPlaceholder(step.content));

function bindingFor(world: World, agentEid: number, signature: string): Binding | undefined {
  const row = bindings.get(world)?.get(agentEid);
  return row && row.signature === signature ? row : undefined;
}
function resetBinding(world: World, agentEid: number): void {
  bindings.get(world)?.delete(agentEid);
  progressMarks.get(world)?.delete(agentEid);
}

/** Who a library step's person is. A learned rule decides when it singles
 * someone out; otherwise, with several people here, the character chooses (a
 * small decision; yields while thinking). Dry runs use the plain binding. */
function choosePerson(world: World, agentEid: number, signature: string, stepIndex: number, step: ProcedureStep, dryRun: boolean): number | undefined {
  const q = step.person!;
  if (q.person === "role") return bindPerson(world, agentEid, q);
  const options = peopleWithFeatures(world, agentEid);
  if (!options.length) return undefined;
  if (q.rule) {
    const ruled = personByRule(options, q.rule);
    if (ruled !== undefined) { if (!dryRun) noteDistilledDecision(world); return ruled; }
  }
  const plain = bindPerson(world, agentEid, q);
  if (dryRun || options.length < 2) return plain;
  if (q.person === "addressee" && options.some(option => option.features.partner)) return plain;
  const doing = step.type === "speak" ? `say this to: ${JSON.stringify(String(step.content || "").slice(0, 160))}`
    : step.type === "interact" ? `${String(step.content || "deal with").split(/\s+/)[0]}` : "turn to";
  const poll = requestDecision(world, agentEid, `skill:${signature}:${stepIndex}:person`, { kind: "pick",
    question: `Who do you ${doing}?`, options: options.map(option => option.name), features: options.map(option => option.features) });
  if (poll.status === "pending") return undefined;
  return options[poll.answer.kind === "pick" ? poll.answer.index : 0]?.eid ?? plain;
}

/** Bind one abstract step to what this resident can perceive now. Concrete
 * steps are returned unchanged. null: nothing suitable here (yield). */
function resolveProcedureStep(world: World, agentEid: number, signature: string, stepIndex: number, step: ProcedureStep, dryRun = false): ProcedureStep | null {
  if (!isAbstractProcedureStep(step)) return step;
  const previous = bindingFor(world, agentEid, signature);
  const resolved: ProcedureStep = { ...step };
  let object = previous?.object, addressee = previous?.addressee;
  if (step.placeQuery) {
    const room = bindPlaceQuery(world, agentEid, step.placeQuery);
    if (room === undefined) return null;
    if (step.type === "move" || step.type === "observe") resolved.target = String(Name.value[room] || "");
    if (!resolved.target) return null;
  }
  if (step.targetQuery) {
    const target = bindTargetQuery(world, agentEid, step.targetQuery);
    if (target === undefined) return null;
    resolved.target = object = String(Name.value[target] || "");
  }
  if (step.person) {
    const person = choosePerson(world, agentEid, signature, stepIndex, step, dryRun);
    if (person === undefined) return null;
    resolved.target = addressee = String(Name.value[person] || "");
  }
  if (step.content && hasPlaceholder(step.content)) {
    const room = getRoomForEntity(world, agentEid);
    if (!addressee && /\{(addressee|person)\}/.test(step.content)) {
      const person = bindPerson(world, agentEid, { person: "addressee" });
      if (person === undefined) return null;
      addressee = String(Name.value[person] || "");
      if (step.type === "speak" && !resolved.target) resolved.target = addressee;
    }
    resolved.content = fillPlaceholders(step.content, { addressee, object, place: room === undefined ? undefined : String(Name.value[room] || "") });
  }
  delete resolved.targetQuery; delete resolved.placeQuery; delete resolved.person;
  if (!dryRun) {
    let map = bindings.get(world);
    if (!map) { map = new Map(); bindings.set(world, map); }
    map.set(agentEid, { signature, stepIndex, step: resolved, object, addressee });
  }
  return resolved;
}

/** The step as last bound for this resident (abstract steps), else as stored. */
function effectiveProcedureStep(world: World, agentEid: number, signature: string, stepIndex: number, step: ProcedureStep): ProcedureStep {
  if (!isAbstractProcedureStep(step)) return step;
  const bound = bindingFor(world, agentEid, signature);
  return bound && bound.stepIndex === stepIndex ? bound.step : { ...step, target: undefined, content: hasPlaceholder(step.content) ? undefined : step.content };
}

function markProcedureProgress(world: World, agentEid: number, signature: string, stepIndex: number): number {
  let map = progressMarks.get(world);
  if (!map) { map = new Map(); progressMarks.set(world, map); }
  const now = readSimulationTime(world), mark = map.get(agentEid);
  if (!mark || mark.signature !== signature || mark.stepIndex !== stepIndex) { map.set(agentEid, { signature, stepIndex, atSimMs: now }); return 0; }
  return now - mark.atSimMs;
}

/** Nothing suitable is perceptible for this abstract step. Yield; after a
 * while, set the remembered way of doing it aside (not a failure). */
function yieldUnboundStep(world: World, agentEid: number, signature: string): null {
  const stepIndex = ProcedureState.stepIndex[agentEid] || 0;
  if (markProcedureProgress(world, agentEid, signature, stepIndex) >= LIBRARY_UNBOUND_ABANDON_MS) {
    noteProcedureOutcome(world, agentEid, signature, "abandoned");
    recordExhaustedGoalMacro(world, agentEid, signature);
    clearProcedureExecution(world, agentEid);
  }
  return null;
}

// Library macros: the intention on top decides whether a remembered way applies.
const goalKeywordCache = new WeakMap<World, Map<number, { description: string; keywords: string[] }>>();
function goalKeywordsFor(world: World, goalEid: number): string[] {
  const description = String(Goal.description[goalEid] || "").trim();
  let cache = goalKeywordCache.get(world);
  if (!cache) { cache = new Map(); goalKeywordCache.set(world, cache); }
  const hit = cache.get(goalEid);
  if (hit && hit.description === description) return hit.keywords;
  const keywords = description ? goalKeywords(abstractText(buildNameIndex(world), description).text) : [];
  cache.set(goalEid, { description, keywords });
  return keywords;
}
function libraryMacroMatchesGoal(world: World, skill: ProceduralSkillV1, goalEid: number | undefined): boolean {
  return goalEid !== undefined && !!skill.trigger.goalPattern?.length && goalPatternMatches(skill.trigger.goalPattern, goalKeywordsFor(world, goalEid));
}
const isLibraryMacro = (skill: ProceduralSkillV1) => !!skill.library && skill.trigger.affordance === "__goal_macro__" && !!skill.trigger.goalPattern?.length;

/** Offstage, remembered words and thoughts are the scene's business: a library
 * procedure whose current step is speech/thought moves past it. */
export function skipLibrarySoftStep(world: World, agentEid: number): boolean {
  if (!hasComponent(world as any, agentEid, ProcedureState as any) || ProcedureState.status[agentEid] !== "active") return false;
  const signature = String(ProcedureState.signature[agentEid] || "");
  const found = signature ? getProceduralSkillBySignature(world, agentEid, signature) : undefined;
  if (!found?.skill.library) return false;
  const index = ProcedureState.stepIndex[agentEid] || 0, step = found.skill.steps[index];
  if (!step || (step.type !== "speak" && step.type !== "think")) return false;
  ProcedureState.stepIndex[agentEid] = index + 1;
  ProcedureState.lastUpdatedAt[agentEid] = Date.now();
  if (index + 1 >= found.skill.steps.length) finishProcedureExecution(world, agentEid, signature, "completed");
  return true;
}

export function proceduralSignature(input: { affordance: string; args?: string; toolId?: string }): string {
  const affordance = input.affordance.trim().toLowerCase();
  const args = (input.args || "").trim();
  return `${affordance}|${args}`;
}

export function getAgentProceduralSkills(world: World, agentEid: number): Array<{ memoryEid: number; skill: ProceduralSkillV1 }> {
  if (!hasComponent(world as any, agentEid, Agent as any)) return [];
  const memoryEids = getRelationTargets(world as any, agentEid, HasMemory as any)
    .filter((eid: number) => hasComponent(world as any, eid, Memory as any))
    .filter((eid: number) => String(Memory.type[eid] || "") === "procedural");

  const skills: Array<{ memoryEid: number; skill: ProceduralSkillV1 }> = [];
  for (const eid of memoryEids) {
    const parsed = parseProceduralSkillV1(String(Memory.content[eid] || ""));
    if (parsed) skills.push({ memoryEid: eid, skill: parsed });
  }
  return skills;
}

export function getProceduralSkillBySignature(
  world: World,
  agentEid: number,
  signature: string
): { memoryEid: number; skill: ProceduralSkillV1 } | undefined {
  const skills = getAgentProceduralSkills(world, agentEid);
  return skills.find((s) => s.skill.signature === signature);
}

function startProcedureExecution(world: World, agentEid: number, signature: string): void {
  addComponent(world as any, agentEid, ProcedureState as any);
  ProcedureState.signature[agentEid] = signature;
  ProcedureState.stepIndex[agentEid] = 0;
  ProcedureState.status[agentEid] = "active";
  const now = Date.now();
  ProcedureState.startedAt[agentEid] = now;
  ProcedureState.lastUpdatedAt[agentEid] = now;
  resetBinding(world, agentEid);
  noteProcedureOutcome(world, agentEid, signature, "started");
}

function clearProcedureExecution(world: World, agentEid: number): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  removeComponent(world as any, agentEid, ProcedureState as any);
}

function findActiveGoalForMacro(world: World, agentEid: number, signature: string): number | undefined {
  const sig = String(signature || "");
  if (sig.startsWith("lib:")) {
    const skill = getProceduralSkillBySignature(world, agentEid, sig)?.skill;
    if (!skill || !isLibraryMacro(skill)) return undefined;
    return getRelationTargets(world as any, agentEid, HasGoal as any)
      .filter((eid: number) => hasComponent(world as any, eid, Goal as any) && String(Goal.status[eid] || "") === "active")
      .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))
      .find((gid: number) => libraryMacroMatchesGoal(world, skill, gid));
  }
  if (!sig.startsWith("goal:") && !sig.startsWith("goalid:")) return undefined;

  const bar = sig.indexOf("|");
  if (bar <= 0) return undefined;
  const prefix = sig.startsWith("goalid:") ? "goalid:" : "goal:";
  if (bar <= prefix.length) return undefined;
  const token = sig.slice(prefix.length, bar).trim().toLowerCase();
  if (!token) return undefined;

  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));

  for (const gid of goalEids) {
    if (prefix === "goalid:") {
      const goalSig = ensureGoalSignature(world, gid);
      if (!goalSig) continue;
      const id = goalSignatureId(goalSig);
      if (id.toLowerCase() !== token) continue;
    } else {
      const desc = String(Goal.description[gid] || "").trim();
      if (!desc) continue;
      if (normalizeGoalKey(desc) !== token) continue;
    }
    return gid;
  }
  return undefined;
}

/** Only a matched action result renews activity; cursor reconciliation is not work. */
function markGoalMacroActivity(world: World, agentEid: number, signature: string): void {
  const goal = findActiveGoalForMacro(world, agentEid, signature);
  if (goal === undefined) return;
  recordGoalAttemptActivity(world, agentEid, goal);
}

function recordExhaustedGoalMacro(world: World, agentEid: number, signature: string): void {
  const goal = findActiveGoalForMacro(world, agentEid, signature);
  if (goal === undefined) return;
  // A successful sequence is not proof that its objective was achieved. This
  // applies to custom goals too: they need an external verifier or a typed contract.
  exhaustGoalMacro(world, agentEid, goal, signature);
}

function finishProcedureExecution(world: World, agentEid: number, signature: string, status: "completed" | "failed"): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  ProcedureState.status[agentEid] = status;
  ProcedureState.lastUpdatedAt[agentEid] = Date.now();
  noteProcedureOutcome(world, agentEid, signature, status);
  if (status === "completed") {
    recordExhaustedGoalMacro(world, agentEid, signature);
  }
  clearProcedureExecution(world, agentEid);
  resetBinding(world, agentEid);
}

export function tryStartProcedureExecution(
  world: World,
  agentEid: number,
  signature: string,
  opts?: { minSuccesses?: number }
): boolean {
  if (!hasComponent(world as any, agentEid, Agent as any)) return false;
  // A policy's explicit start must fail admission too; returning true and then
  // yielding no action would turn reconsideration into a deterministic wait.
  if (currentPlanRequiresEvidence(world, agentEid)) return false;
  const sig = String(signature || "").trim();
  if (!sig) return false;

  const minSuccesses = Number.isFinite(Number(opts?.minSuccesses)) ? Math.max(0, Math.min(100, Number(opts?.minSuccesses))) : 2;
  const found = getProceduralSkillBySignature(world, agentEid, sig);
  if (!found) return false;
  if ((found.skill.stats?.successes || 0) < minSuccesses) return false;
  const goal = findActiveGoalForMacro(world, agentEid, sig);
  if (goal !== undefined && isGoalMacroExhausted(world, agentEid, goal, sig)) return false;

  startProcedureExecution(world, agentEid, sig);
  return true;
}

/** True only when an action is the current step of the active procedure.
 * World packages use this to distinguish routine procedure completion from a
 * detour that should force foreground reconsideration. */
export function isExpectedProcedureAction(world: World, agentEid: number, action: AgentActionLike): boolean {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return false;
  if (String(ProcedureState.status[agentEid] || "") !== "active") return false;
  const signature = String(ProcedureState.signature[agentEid] || "");
  const found = signature ? getProceduralSkillBySignature(world, agentEid, signature) : undefined;
  const stored = found?.skill.steps[ProcedureState.stepIndex[agentEid] || 0];
  if (!stored) return false;
  const step = effectiveProcedureStep(world, agentEid, signature, ProcedureState.stepIndex[agentEid] || 0, stored);
  const expectedType = step.type === "await" ? "wait" : step.type;
  if (String(action.type || "").trim().toLowerCase() !== expectedType) return false;
  if (step.target && String(action.target || "").trim().toLowerCase() !== step.target.trim().toLowerCase()) return false;
  if (step.content && String(action.content || "").trim().toLowerCase() !== step.content.trim().toLowerCase()) return false;
  return true;
}

export function onProcedureActionResult(
  world: World,
  agentEid: number,
  action: AgentActionLike,
  outcome: { success: boolean }
): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  if (String(ProcedureState.status[agentEid] || "") !== "active") {
    if (ProcedureState.status[agentEid] === "needs_revision") return;
    clearProcedureExecution(world, agentEid);
    return;
  }

  const signature = String(ProcedureState.signature[agentEid] || "");
  if (!signature) {
    clearProcedureExecution(world, agentEid);
    return;
  }

  const found = getProceduralSkillBySignature(world, agentEid, signature);
  if (!found) {
    clearProcedureExecution(world, agentEid);
    return;
  }

  const stepIndex = ProcedureState.stepIndex[agentEid] || 0;
  const storedStep = found.skill.steps[stepIndex];
  if (!storedStep) {
    clearProcedureExecution(world, agentEid);
    return;
  }
  const step = effectiveProcedureStep(world, agentEid, signature, stepIndex, storedStep);

  // "move" steps are advanced by checking location inside the selector (not via action result).
  if (step.type === "move") return;
  // "await" steps are advanced inside the selector (based on Perceptions).
  if (step.type === "await") return;

  const typeMatches = String(action.type || "").toLowerCase() === String(step.type || "").toLowerCase();
  if (!typeMatches) return;

  const contentMatches =
    !step.content ||
    String(action.content || "").trim().toLowerCase() === String(step.content || "").trim().toLowerCase();
  if (!contentMatches) return;

  const targetMatches =
    !step.target || String(action.target || "").trim().toLowerCase() === String(step.target || "").trim().toLowerCase();
  if (!targetMatches) return;

  if (!outcome.success) {
    if (typeof step.onFailureNext === "number") {
      ProcedureState.stepIndex[agentEid] = step.onFailureNext;
      ProcedureState.lastUpdatedAt[agentEid] = Date.now();
      if (!["wait", "rest"].includes(action.type)) markGoalMacroActivity(world, agentEid, signature);
      return;
    }
    ProcedureState.status[agentEid] = "failed";
    ProcedureState.lastUpdatedAt[agentEid] = Date.now();
    noteProcedureOutcome(world, agentEid, signature, "failed");
    clearProcedureExecution(world, agentEid);
    resetBinding(world, agentEid);
    return;
  }

  const nextIndex = typeof step.onSuccessNext === "number" ? step.onSuccessNext : (stepIndex + 1);
  ProcedureState.stepIndex[agentEid] = nextIndex;
  ProcedureState.lastUpdatedAt[agentEid] = Date.now();
  if (!["wait", "rest"].includes(action.type)) markGoalMacroActivity(world, agentEid, signature);
  if (nextIndex >= found.skill.steps.length) {
    finishProcedureExecution(world, agentEid, signature, "completed");
  }
}

export function upsertProceduralSkillFromInteraction(
  world: World,
  agentEid: number,
  data: {
    affordance: string;
    args?: string;
    toolId?: string;
    requiredTraits?: string[];
    targetName?: string;
    success: boolean;
  }
): void {
  if (!hasComponent(world as any, agentEid, Agent as any)) return;

  const affordance = data.affordance.trim();
  if (!affordance) return;
  // Keep normal action/memory receipts, but do not learn content or revision
  // literals as an automatically repeatable document-writing habit.
  if (isDocumentOperation({ type: "interact", content: affordance })) return;

  const signature = proceduralSignature({ affordance, args: data.args, toolId: data.toolId });
  const now = Date.now();

  const existing = getAgentProceduralSkills(world, agentEid).find((s) => s.skill.signature === signature);
  if (existing) {
    const skill = existing.skill;
    skill.stats.lastUsedAt = now;
    if (data.success) skill.stats.successes += 1;
    else skill.stats.failures += 1;

    if (data.targetName) skill.example = { ...(skill.example || {}), targetName: data.targetName };
    if (typeof data.args === "string") skill.example = { ...(skill.example || {}), args: data.args };

    Memory.content[existing.memoryEid] = serializeProceduralSkillV1(skill);
    Memory.lastRecalled[existing.memoryEid] = now;
    Memory.recallCount[existing.memoryEid] = (Memory.recallCount[existing.memoryEid] || 0) + 1;
    return;
  }

  const newSkill: ProceduralSkillV1 = {
    kind: "procedure_v1",
    signature,
    name: data.toolId
      ? `Use ${affordance} (${data.toolId})`
      : `Use ${affordance}`,
    trigger: {
      affordance,
      requiredTraits: data.requiredTraits?.slice(0, 6),
      toolId: data.toolId,
    },
    example: {
      targetName: data.targetName,
      args: (data.args || "").trim() || undefined,
    },
    steps: [
      {
        type: "interact",
        target: data.targetName,
        content: `${affordance}${data.args && data.args.trim() ? ` ${data.args.trim()}` : ""}`,
      },
    ],
    stats: {
      successes: data.success ? 1 : 0,
      failures: data.success ? 0 : 1,
      createdAt: now,
      lastUsedAt: now,
    },
  };

  const memoryEid = addEntity(world as any);
  addComponent(world as any, memoryEid, Memory as any);
  addComponent(world as any, agentEid, HasMemory(memoryEid) as any);

  Memory.type[memoryEid] = "procedural";
  Memory.content[memoryEid] = serializeProceduralSkillV1(newSkill);
  Memory.importance[memoryEid] = 0.65;
  Memory.emotionalValence[memoryEid] = 0;
  Memory.timestamp[memoryEid] = now;
  Memory.lastRecalled[memoryEid] = now;
  Memory.recallCount[memoryEid] = 0;
}

export function formatProceduralSkillsForContext(world: World, agentEid: number, limit: number = 6): string {
  const skills = getAgentProceduralSkills(world, agentEid)
    .map((s) => s.skill)
    // "How I did it" plan records and carried-over library macros are for
    // replay and harvest, not the affordance menu.
    .filter((s) => s.trigger.affordance !== "__plan_macro__" && !isLibraryMacro(s))
    .sort((a, b) => (b.stats.successes - a.stats.successes) || (b.stats.lastUsedAt - a.stats.lastUsedAt))
    .slice(0, limit);

  if (skills.length === 0) return "";

  const lines: string[] = [];
  lines.push("SKILLS (PROCEDURAL):");
  for (const s of skills) {
    const req = s.trigger.requiredTraits?.length ? ` requires: ${s.trigger.requiredTraits.join(", ")}` : "";
    const stats = `(${s.stats.successes}✓/${s.stats.failures}✗)`;
    const exampleArgs = s.example?.args ? ` ${s.example.args}` : "";
    lines.push(`  - ${s.name} ${stats}${req} :: interact "${s.example?.targetName || "<target>"}" "${s.trigger.affordance}${exampleArgs}"`);
  }
  return lines.join("\n");
}

function hasRecentCriticalFailure(world: World, agentEid: number): boolean {
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 3);
  for (const peid of perceptionEids) {
    if (String(Perception.type[peid] || "") !== "action_failed") continue;
    const c = String(Perception.content[peid] || "");
    if (c.includes("FAILED") || c.includes("🚨 CRITICAL")) return true;
  }
  return false;
}

function getLatestPerception(world: World, agentEid: number, type: string, after: number): string | undefined {
  const wanted = type.trim();
  if (!wanted) return undefined;
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .filter((eid: number) => String(Perception.type[eid] || "") === wanted)
    .filter((eid: number) => Number(Perception.timestamp[eid] || 0) >= after)
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 1);
  const peid = perceptionEids[0];
  if (typeof peid !== "number") return undefined;
  return String(Perception.content[peid] || "");
}

function normalizeGoalKey(goalDesc: string): string {
  return goalDesc.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function getTopActiveGoalDescription(world: World, agentEid: number): string | null {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goalEids[0];
  if (typeof top !== "number") return null;
  const desc = String(Goal.description[top] || "").trim();
  return desc || null;
}

function getTopActiveGoalMacroPrefix(world: World, agentEid: number): string | null {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goalEids[0];
  if (typeof top !== "number") return null;

  const sig = ensureGoalSignature(world, top);
  if (sig) {
    const id = goalSignatureId(sig);
    return `goalid:${id}|`;
  }

  const desc = String(Goal.description[top] || "").trim();
  if (!desc) return null;
  const goalKey = normalizeGoalKey(desc);
  return `goal:${goalKey}|`;
}

/** Flat remembered procedures cannot stand in for a conditional plan. This is
 * a pure admission check: selecting a habit must not sense/consume a barrier or
 * treat its null action as permission to jump straight to a goal macro. Keep
 * the guard after reconsideration too, until a new selected plan replaces the
 * conditional episode. A future wait matters as much as the current one. */
function currentPlanRequiresEvidence(world: World, agentEid: number): boolean {
  const goal = getRelationTargets(world, agentEid, HasGoal)
    .filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
  if (goal === undefined) return false;
  const plan = getPlanForGoal(world, agentEid, goal);
  if (plan === undefined) return false;
  if (hasComponent(world, plan, PlanningDecision)) return true;
  try {
    const steps: unknown = JSON.parse(Plan.steps[plan] || "[]");
    if (!Array.isArray(steps)) return true;
    return steps.some(step => !step || typeof step !== "object"
      || step.actionType === "wait" || step.waitUntil !== undefined);
  } catch { return true; }
}

function topActiveGoal(world: World, agentEid: number): number | undefined {
  return getRelationTargets(world, agentEid, HasGoal)
    .filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
}

/** The first physical step of an abstract procedure has something to bind to here. */
function canBindFirstStep(world: World, agentEid: number, skill: ProceduralSkillV1): boolean {
  const first = skill.steps.find(step => step.type !== "think" && step.type !== "wait");
  if (!first) return false;
  const index = skill.steps.indexOf(first);
  return resolveProcedureStep(world, agentEid, skill.signature, index, first, true) !== null;
}

export function selectProceduralAction(world: World, agentEid: number): AgentActionLike | null {
  if (!hasComponent(world as any, agentEid, Agent as any)) return null;
  if (hasRecentCriticalFailure(world, agentEid)) return null;
  if (currentPlanRequiresEvidence(world, agentEid)) return null;

  // Continue an active procedure, if any.
  if (hasComponent(world as any, agentEid, ProcedureState as any)) {
    if (ProcedureState.status[agentEid] !== "active") return null;
    const signature = String(ProcedureState.signature[agentEid] || "");
    if (!signature) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }
    const found = getProceduralSkillBySignature(world, agentEid, signature);
    if (!found) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }

    // Habit is subordinate to current intention. Keep the interrupted cursor so
    // it resumes after the urgent goal, but never let a macro veto that goal.
    if (signature.startsWith("goal:") || signature.startsWith("goalid:")) {
      const prefix = getTopActiveGoalMacroPrefix(world, agentEid);
      if (!prefix || !signature.startsWith(prefix)) return null;
    }
    if (isLibraryMacro(found.skill) && !libraryMacroMatchesGoal(world, found.skill, topActiveGoal(world, agentEid))) return null;
    markProcedureProgress(world, agentEid, signature, ProcedureState.stepIndex[agentEid] || 0);

    // Move step auto-advancement: if a move step's target room is already reached, advance without emitting an action.
    let transitions = 0;
    while (true) {
      const idx = ProcedureState.stepIndex[agentEid] || 0;
      const storedStep = found.skill.steps[idx];
      if (!storedStep) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      if (storedStep.type !== "move") break;
      const step = resolveProcedureStep(world, agentEid, signature, idx, storedStep);
      if (!step) return yieldUnboundStep(world, agentEid, signature);

      const dest = String(step.target || "").trim();
      if (!dest) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      const roomEid = getRoomForEntity(world, agentEid);
      const currentRoomName = roomEid !== undefined ? String(Name.value[roomEid] || "") : "";
      if (currentRoomName && currentRoomName.toLowerCase() === dest.toLowerCase()) {
        ProcedureState.stepIndex[agentEid] = idx + 1;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }
      return { type: "move", target: dest };
    }

    // Await step: wait for a perception, then branch/advance.
    while (true) {
      if (++transitions > found.skill.steps.length + 1) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      const idx = ProcedureState.stepIndex[agentEid] || 0;
      const step = found.skill.steps[idx];
      if (!step) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      if (step.type !== "await") break;

      const waitFor = step.waitFor;
      if (!waitFor || !waitFor.perceptionType) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }

      const latest = getLatestPerception(world, agentEid, waitFor.perceptionType, ProcedureState.lastUpdatedAt[agentEid] || ProcedureState.startedAt[agentEid] || 0);
      if (!latest) return { type: "wait" };

      const includes = (waitFor.includes || "").trim();
      const match = includes ? latest.toLowerCase().includes(includes.toLowerCase()) : true;
      if (match) {
        ProcedureState.stepIndex[agentEid] = typeof step.onMatchNext === "number" ? step.onMatchNext : idx + 1;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }

      if (typeof step.onMismatchNext === "number") {
        ProcedureState.stepIndex[agentEid] = step.onMismatchNext;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }

      return { type: "wait" };
    }

    const idx = ProcedureState.stepIndex[agentEid] || 0;
    const storedStep = found.skill.steps[idx];
    if (!storedStep) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }
    const step = resolveProcedureStep(world, agentEid, signature, idx, storedStep);
    if (!step) return yieldUnboundStep(world, agentEid, signature);

    // A remembered target is not omniscient tracking. Let deliberation handle
    // searching when it is no longer perceived; do not read its hidden current room.
    if (step.type === "interact" && step.target) {
      const visible = getAgentVisibleEntities(world, agentEid).some(eid =>
        String(Name.value[eid] || "").trim().toLowerCase() === step.target!.trim().toLowerCase());
      if (!visible) return null;
    }
    if (requiresFreshAffordanceDecision(world, agentEid, step)) return null;
    const action = { type: step.type, target: step.target, content: step.content };
    // Carried-over words are a gist: said in this voice, for this moment.
    if (found.skill.library && step.type === "speak" && step.content?.trim())
      markVoicedSpeech(action, { gist: step.content, slot: `skill:${signature}:${idx}:say`, onSilence: () => { skipLibrarySoftStep(world, agentEid); } });
    return action;
  }

  // Goal-macro auto-start: if there is an active goal but no explicit plan step,
  // and we have a compiled macro for that goal, start executing it deterministically.
  const next = getNextPlannedAction(world, agentEid);
  if (!next) {
    const prefix = getTopActiveGoalMacroPrefix(world, agentEid);
    const topGoal = getRelationTargets(world, agentEid, HasGoal)
      .filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active")
      .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
    // Do not replay an exhausted macro forever while waiting for success evidence.
    if (prefix) {
      const skills = getAgentProceduralSkills(world, agentEid)
        .map((s) => s.skill)
        .filter((s) => String(s.trigger?.affordance || "") === "__goal_macro__")
        .filter((s) => String(s.signature || "").startsWith(prefix))
        .filter(s => !isGoalMacroExhausted(world, agentEid, topGoal, s.signature))
        .sort((a, b) => (b.stats.successes - a.stats.successes) || (b.stats.lastUsedAt - a.stats.lastUsedAt));

      const macro = skills[0];
      if (macro && macro.stats.successes >= 1) {
        startProcedureExecution(world, agentEid, macro.signature);
        return selectProceduralAction(world, agentEid);
      }
    }
    // A way of doing things carried over from other lives (skill library):
    // only for an intention with the same gist, and only if its first step
    // can bind to something here. Own compiled macros above take precedence.
    if (topGoal !== undefined) {
      const library = getAgentProceduralSkills(world, agentEid).map(s => s.skill)
        .filter(s => isLibraryMacro(s) && s.stats.successes >= 1)
        .filter(s => libraryMacroMatchesGoal(world, s, topGoal) && !isGoalMacroExhausted(world, agentEid, topGoal, s.signature))
        .filter(s => canBindFirstStep(world, agentEid, s))
        .sort((a, b) => (b.stats.successes - a.stats.successes) || a.signature.localeCompare(b.signature));
      if (library[0]) {
        startProcedureExecution(world, agentEid, library[0].signature);
        return selectProceduralAction(world, agentEid);
      }
    }
  }
  if (!next) return null;

  if (next.actionType !== "interact") return null;
  if (!next.target) return null;

  const content = String(next.content || "").trim();
  if (!content) return null;

  const [affordance, ...rest] = content.split(/\s+/);
  const args = rest.join(" ").trim();
  const sig = proceduralSignature({ affordance, args });

  const skills = getAgentProceduralSkills(world, agentEid);
  const skill = skills.find((s) => s.skill.signature === sig)?.skill;
  if (!skill) return null;
  if (skill.stats.successes < 2) return null; // require repetition before auto-executing

  if (skill.steps.length > 1) {
    startProcedureExecution(world, agentEid, skill.signature);
    // Re-enter selection in "active procedure" mode so preconditions/await/move-handling apply
    // to the very first emitted step.
    return selectProceduralAction(world, agentEid);
  }

  return { type: "interact", target: next.target, content };
}
