/** Opt-in, single bounded production-cognition trial. No H3 or reaction script.
 * --live --seconds=120 [--condition=neutral] [--contact=neutral]
 * Neutral message preserves the boyfriend; neutral contact makes the same text
 * arrive from an unknown sender. These are separate, explicitly reported controls.
 */
import "dotenv/config";
import { parseEpisodeGrowthLimits } from "./episode-builds";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { ApartmentSitcom, type SitcomEvent } from "./apartment-sitcom";
import { CoffeeIntervention } from "./coffee-intervention";
import { SitcomJournal } from "./sitcom-journal";
import { SitcomDirector } from "./sitcom-director";
import { sitcomFrame, evaluateSitcom } from "./sitcom-report";
import { summarizeContinuityEvidence } from "./continuity-evidence";
import { Mind, Name, Perception, Goal, GoalLifecycle, Plan } from "../ecs/components";
import { getRelationTargets, hasComponent } from "bitecs";
import { HasGoal, HasPlan } from "../ecs/relations";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { snapshotAffect, publicFacialExpression } from "../cognition/affect-state";
import { getEmotionalEpisodes, emotionalActivation } from "../cognition/emotional-life";
import { getNarrativeHistory, narrativeEntryCount } from "../cognition/narrative-memory";
import { snapshotExperienceAppraisal } from "../cognition/experience-appraisal";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { snapshotOngoingActivity } from "../cognition/ongoing-activity";
import { snapshotWaitExperience } from "../cognition/wait-experience";
import { snapshotActorWait } from "../cognition/actor-wait";
import { snapshotCoordinationReview } from "../cognition/coordination-review";
import { snapshotActivityReview } from "../cognition/activity-review";
import { snapshotForegroundCognitionDiagnostics } from "../cognition/idle-cognition";
import { getPersonalConcerns } from "../cognition/personal-concerns";
import { getCompletedContributions } from "../cognition/social-memory";
import { getAgentVisualEntities } from "../cognition/world-capabilities";
import { getSocialDialogue, getSocialSpeechFragments } from "../cognition/social-memory";
import { getWorkingMemory } from "../cognition/working-memory";
import { getCommittedEvents, subscribeCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";
import { snapshotInhabitedWorld } from "../evals/inhabited-world-observation";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getFactoryState } from "../spirits/spirit-factory";
import { getRoomPopulationStatus } from "../spirits/steward-spirit";
import { getPlaceBuildStatus } from "../engineering/place-materialization";
import { getEvolutionWorkStatus } from "../spirits/world-crafter-spirit";
import { getInteractionObservations } from "../spirits/interaction-observations";
import { getExternalParticipants } from "../runtime/participant-identities";
import { parseCognitionController } from "../cognition/decision-policy";
import { breakupTrialInputs, breakupObservationEvidence, type BreakupCondition, type BreakupContactCondition,
  type BreakupPerceptionEvidence } from "./sitcom-breakup-evaluation";

const argument = (key: string, fallback: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const live = process.argv.includes("--live"), seconds = Number(argument("seconds", "120"));
const focused = process.argv.includes("--focused"), openNeighborhood = process.argv.includes("--open-neighborhood");
const worldMaintenance = live && (focused || openNeighborhood) && !process.argv.includes("--core-only");
const growthLimits = parseEpisodeGrowthLimits(worldMaintenance, argument("max-world-entities", ""), argument("max-build-jobs", ""));
const condition = argument("condition", "breakup"), contactCondition = argument("contact", "boyfriend");
const label = argument("label", "trial");
const intervention = argument("intervention", "none");
if (!["none", "drain-first-pour"].includes(intervention)
  || intervention !== "none" && (!focused || condition !== "coffee"))
  throw new Error("--intervention=drain-first-pour requires --focused --condition=coffee");
const coffeeIntervention = intervention === "drain-first-pour" ? new CoffeeIntervention() : undefined;
const controller = parseCognitionController(argument("controller", "priority"));
const reconsiderationOption = argument("reconsideration", "off");
if (!["on", "off"].includes(reconsiderationOption)) throw new Error("Choose --reconsideration=on or off");
const experienceReconsideration = reconsiderationOption === "on";
const narrativeOption = argument("narrative-mind", "off");
if (!["on", "off"].includes(narrativeOption)) throw new Error("Choose --narrative-mind=on or off");
const narrativeMind = narrativeOption === "on";
const maximumSeconds = process.argv.includes("--extended") ? 300 : 120;
if (!Number.isInteger(seconds) || seconds < 30 || seconds > maximumSeconds)
  throw new Error(`Choose an integer --seconds=30..${maximumSeconds}; --extended explicitly permits up to 300 seconds.`);
if (!["breakup", "neutral", "logistics", "writing", "coffee", "handoff", "destination"].includes(condition) || !["boyfriend", "neutral"].includes(contactCondition)) throw new Error("Unknown condition/contact control");
if (["writing", "handoff"].includes(condition) && !focused) throw new Error("The writing/handoff trial requires --focused, which seeds the native notebook.");
if (condition === "coffee" && !focused) throw new Error("The coffee trial requires --focused, which seeds the finite coffee supply.");
if (!/^[a-zA-Z0-9_-]{1,48}$/.test(label)) throw new Error("Use a short --label with letters, digits, dashes or underscores");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for --live");
const inputs = breakupTrialInputs(condition as BreakupCondition, contactCondition as BreakupContactCondition);
const contact = focused && contactCondition === "boyfriend" ? { ...inputs.contact, name: "Alex", context: inputs.contact.context.replaceAll("David", "Alex") } : inputs.contact;
const stimuli = focused ? inputs.stimuli.map(row => ({ ...row, text: row.text.replaceAll("David", "Alex") })) : inputs.stimuli;

await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", `sitcom-${condition}-${contactCondition}-`));
const original = { log: console.log, warn: console.warn, error: console.error }, runtime = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
let runtimeBytes = 0;
for (const key of ["log", "warn", "error"] as const) console[key] = (...args: unknown[]) => {
  const line = format(...args) + "\n"; if (runtimeBytes < 12_000_000) { runtime.write(line); runtimeBytes += Buffer.byteLength(line); }
};
original.log(`BREAKUP_CHECK ${live ? "LIVE PRODUCTION COGNITION" : "OFFLINE PHYSICS ONLY"} · ${condition}/${contactCondition} · NO H3\nArtifacts: ${directory}`);

let t: ApartmentSitcom | undefined, unsubscribe: (() => void) | undefined, journal: SitcomJournal | undefined;
let director: SitcomDirector | undefined, settledVersion: number | undefined;
const drainProjection = () => {
  // Immediate offline acknowledgements exercise compilation, not H3 latency.
  if (!director) return;
  for (let count = 0; count < 128; count++) {
    const next = director.next(settledVersion);
    if (!("segment" in next)) return;
    settledVersion = next.segment.version;
  }
  throw new Error("Projection drain exceeded bounded segment count");
};
let failed: string | null = null, stoppedByOperator = false, nextStimulus = 0;
let projectionFailed = false;
const events: SitcomEvent[] = [], publicEvents: PublicCommittedEvent[] = [];
let lastGrowthAt = -Infinity, growthBytes = 0;
const growthLog = worldMaintenance ? createWriteStream(join(directory, "growth.ndjson"), { flags: "wx", mode: 0o600 }) : undefined;
growthLog?.on("error", error => { failed ??= String(error); t?.stop(); });
const captureGrowth = () => {
  if (!t || !growthLog || t.elapsedMs < lastGrowthAt + 1000) return;
  const row = { ...snapshotInhabitedWorld(t.sim.world), coding: t.sim.getCodingStatus(),
    roomPopulation: getRoomPopulationStatus(t.sim.world),
    placeBuilds: getPlaceBuildStatus(t.sim.world,t.sim.god.systemRegistry),
    legacyEvolution: getEvolutionWorkStatus(t.sim.world),
    interactionFailures:getInteractionObservations(t.sim.world),
    externalParticipants:getExternalParticipants(t.sim.world),
    architect: getArchitectDiagnostics(t.sim.world),
    proposals: getFactoryState().pendingProposals.map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status,
      specification: p.specification, observationScopeId: p.observationScopeId, rejectionReason: p.rejectionReason })),
  };
  const line = JSON.stringify(row) + "\n";
  growthBytes += Buffer.byteLength(line);
  if (growthBytes > 24_000_000) throw new Error("Growth evidence byte bound exceeded");
  growthLog.write(line); lastGrowthAt = t.elapsedMs;
};
type CognitiveFrame = { atSimMs: number; actors: Array<{ name: string; mind: { mode: string; arousal: number; focus: string };
  affect?: ReturnType<typeof snapshotAffect>; appraisal?: ReturnType<typeof snapshotExperienceAppraisal>; perceptions: BreakupPerceptionEvidence[];
  emotionalEpisodes: ReturnType<typeof getEmotionalEpisodes>; activation: number;
  narrative: ReturnType<typeof getNarrativeHistory>; narrativeCount: number;
  continuation?: ReturnType<typeof snapshotActorContinuation>;
  ongoingActivity?: ReturnType<typeof snapshotOngoingActivity>;
  waitExperience?: ReturnType<typeof snapshotWaitExperience>;
  chosenWait?: ReturnType<typeof snapshotActorWait>;
  coordinationReview?: ReturnType<typeof snapshotCoordinationReview>;
  activityReview?: ReturnType<typeof snapshotActivityReview>;
  foregroundDiagnostics?: ReturnType<typeof snapshotForegroundCognitionDiagnostics>;
  personalConcerns: ReturnType<typeof getPersonalConcerns>;
  completedContributions: ReturnType<typeof getCompletedContributions>;
  pursuit: Array<{ goalId: number; description: string; status: string; reason: string; deferred: string }>;
  plans: Array<{ id: number; goalId: number; status: string; currentStep: number; stepsJson: string }>;
  visibleExpressions: Array<{ subject: string; expression: string }>;
  goals: ReturnType<ApartmentSitcom["sim"]["getAgentGoals"]>; dialogue: ReturnType<typeof getSocialDialogue>; fragments: ReturnType<typeof getSocialSpeechFragments> }> };
const cognition: CognitiveFrame[] = [];
const issued: Array<{ requestedAtSimMs: number; actualAtSimMs: number; messageId: number; text: string }> = [];
const capture = () => {
  if (!t || !journal) return;
  const frame = sitcomFrame(t), cognitive: CognitiveFrame = { atSimMs: t.elapsedMs, actors: t.characters.map(name => ({ name,
    mind: { mode: Mind.mode[t!.ids[name]], arousal: Mind.arousal[t!.ids[name]], focus: Mind.focus[t!.ids[name]] },
    affect: snapshotAffect(t!.sim.world, t!.ids[name]),
    emotionalEpisodes: getEmotionalEpisodes(t!.sim.world, t!.ids[name]), activation: emotionalActivation(t!.sim.world, t!.ids[name]),
    narrative: getNarrativeHistory(t!.sim.world, t!.ids[name], { limit: 8, excludeThoughts: true }), narrativeCount: narrativeEntryCount(t!.sim.world, t!.ids[name]),
    pursuit: getRelationTargets(t!.sim.world, t!.ids[name], HasGoal).filter(g => hasComponent(t!.sim.world, g, GoalLifecycle))
      .map(g => ({ goalId: g, description: Goal.description[g], status: Goal.status[g], reason: GoalLifecycle.reason[g], deferred: GoalLifecycle.deferredJson[g] || "" })),
    plans: getRelationTargets(t!.sim.world, t!.ids[name], HasPlan).filter(p => hasComponent(t!.sim.world, p, Plan)).slice(-8)
      .map(p => ({ id: p, goalId: Plan.goalEid[p], status: Plan.status[p], currentStep: Plan.currentStep[p], stepsJson: (Plan.steps[p] || "[]").slice(0, 6000) })),
    appraisal: snapshotExperienceAppraisal(t!.sim.world, t!.ids[name]),
    continuation: snapshotActorContinuation(t!.sim.world, t!.ids[name]),
    ongoingActivity: snapshotOngoingActivity(t!.sim.world, t!.ids[name]),
    waitExperience: snapshotWaitExperience(t!.sim.world, t!.ids[name]),
    chosenWait: snapshotActorWait(t!.sim.world, t!.ids[name]),
    coordinationReview: snapshotCoordinationReview(t!.sim.world, t!.ids[name]),
    activityReview: snapshotActivityReview(t!.sim.world, t!.ids[name]),
    foregroundDiagnostics: snapshotForegroundCognitionDiagnostics(t!.sim.world, t!.ids[name]),
    personalConcerns: getPersonalConcerns(t!.sim.world, t!.ids[name]),
    completedContributions: getCompletedContributions(t!.sim.world, t!.ids[name]),
    perceptions: getAgentPerceptions(t!.sim.world, t!.ids[name]).map(id => ({ id, type: Perception.type[id], source: Perception.source[id], content: Perception.content[id], timestamp: Perception.timestamp[id] })),
    visibleExpressions: getAgentVisualEntities(t!.sim.world, t!.ids[name]).filter(id => id !== t!.ids[name]).flatMap(id => {
      const expression = publicFacialExpression(t!.sim.world, id); return expression ? [{ subject: Name.value[id], expression }] : [];
    }),
    goals: t!.sim.getAgentGoals(name), dialogue: getSocialDialogue(t!.sim.world, t!.ids[name]), fragments: getSocialSpeechFragments(t!.sim.world, t!.ids[name]) })) };
  if (cognition.length >= 8000) throw new Error("Cognition-frame bound exceeded");
  cognition.push(structuredClone(cognitive));
  void journal.appendFrame({ ...frame, cognitive: cognitive.actors }).catch(error => { failed ??= String(error); t?.stop(); });
};
const interrupt = () => { stoppedByOperator = true; t?.stop(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  const sourceFiles = ["src/index.ts", "src/ecs/components.ts", "src/demo/apartment-sitcom.ts", "src/cognition/agent-mind.ts", "src/cognition/cognition-system.ts", "src/cognition/actor-continuation.ts", "src/cognition/foreground-action-admission.ts", "src/cognition/cognitive-local-view.ts", "src/cognition/idle-cognition.ts", "src/runtime/simulation-loop.ts", "src/cognition/communication-motivation.ts", "src/cognition/affect-state.ts", "src/cognition/experience-appraisal.ts", "src/cognition/appearance-emitter.ts", "src/rendering/character-appearance.ts", "src/llm/json-envelope.ts", "src/demo/sitcom-breakup-check.ts", "src/demo/sitcom-breakup-evaluation.ts"];
  sourceFiles.push("src/cognition/goal-pursuit.ts", "src/cognition/goal-lifecycle.ts");
  sourceFiles.push("src/cognition/foreground-response-shape.ts");
  sourceFiles.push("src/cognition/goal-attempt.ts", "src/cognition/procedural-skills.ts", "src/cognition/skill-registry.ts", "src/cognition/goal-learning.ts", "src/cognition/bt-compiler.ts");
  sourceFiles.push("src/world/productive-work.ts", "src/world/affordance-availability.ts", "src/world/schema.ts", "src/world/effect-executor.ts", "src/cognition/goal-contract.ts", "src/systems/goal-evaluation-system.ts");
  sourceFiles.push("src/demo/sitcom-director.ts", "src/demo/sitcom-screenplay.ts", "src/demo/sitcom-performance.ts", "src/cognition/unresolved-attention.ts", "src/ecs/temporal-age.ts");
  sourceFiles.push("src/runtime/native-services.ts", "src/runtime/simulation-timeline.ts", "src/cognition/foreground-action-admission.ts", "src/systems/deterministic-behavior-systems.ts", "src/systems/scheduled-activity-systems.ts", "src/spirits/architect-spirit.ts", "src/engineering/coding-daemon.ts");
  sourceFiles.push("src/cognition/personal-concerns.ts", "src/cognition/social-memory.ts");
  sourceFiles.push("src/cognition/communication-memory.ts", "src/cognition/coordination-memory.ts");
  sourceFiles.push("src/cognition/coordination-review.ts");
  sourceFiles.push("src/cognition/ongoing-activity.ts");
  sourceFiles.push("src/cognition/wait-experience.ts");
  sourceFiles.push("src/cognition/actor-wait.ts");
  sourceFiles.push("src/cognition/plan-evidence-barrier.ts");
  sourceFiles.push("src/cognition/plan-wait-schema.ts", "src/cognition/planning-observable-conditions.ts");
  sourceFiles.push("src/cognition/autonomous-goals.ts", "src/cognition/subconscious-system.ts");
  sourceFiles.push("src/cognition/goal-inactivity-budget.ts", "src/ecs/builtin-component-schema.ts");
  sourceFiles.push("src/cognition/schedule-occurrences.ts", "src/cognition/schedule-system.ts");
  sourceFiles.push("src/cognition/goal-dependents.ts");
  sourceFiles.push("src/cognition/timed-speech.ts", "src/cognition/planning-system.ts", "src/cognition/foreground-motor-plan.ts", "src/cognition/motor-plan-scope.ts");
  sourceFiles.push("src/cognition/decision-policy.ts", "src/ecs/world.ts");
  sourceFiles.push("src/cognition/intention-reconsideration.ts");
  sourceFiles.push("src/cognition/heard-appraisal.ts");
  sourceFiles.push("src/cognition/knowledge-graph.ts", "src/cognition/interaction-context.ts");
  sourceFiles.push("src/cognition/activity-review.ts");
  sourceFiles.push("src/nle/story-scaffold.ts", "src/nle/narrative-integrity.ts", "src/nle/narrative-director.ts", "src/nle/npc-nudge.ts");
  sourceFiles.push("src/nle/narrative-evidence.ts", "src/nle/beat-detector.ts", "src/spirits/agent-daemon.ts");
  sourceFiles.push("src/spirits/steward-spirit.ts");
  sourceFiles.push("src/rendering/committed-scene-history.ts", "src/rendering/attach-committed-renderer.ts", "src/rendering/committed-scene-renderer.ts");
  sourceFiles.push("src/runtime/room-routes.ts", "src/cognition/world-capabilities.ts", "src/cognition/physical-activity.ts");
  sourceFiles.push("src/world/object-manager.ts", "src/world/schema.ts", "src/ecs/component-registry.ts", "src/engineering/entity-materialization.ts");
  sourceFiles.push("src/ecs/prefabs.ts", "src/spirits/actor-intention-evidence.ts", "src/engineering/entity-materialization-scope.ts");
  sourceFiles.push("src/engineering/place-materialization.ts", "src/engineering/entity-authoring-catalog.ts");
  sourceFiles.push("src/spirits/world-crafter-spirit.ts");
  sourceFiles.push("src/spirits/interaction-observations.ts");
  sourceFiles.push("src/runtime/participant-identities.ts");
  sourceFiles.push("src/engineering/build-work-identity.ts", "src/engineering/contracts.ts", "src/god/god-agent.ts");
  sourceFiles.push("src/runtime/world-construction-budget.ts", "src/ecs/tools.ts", "src/world/ascii-world.ts", "src/demo/episode-builds.ts");
  sourceFiles.push("src/office-tools/tool-registry.ts", "src/systems/builtin-systems.ts", "src/ecs/builtin-component-schema.ts");
  sourceFiles.push("src/cognition/emotional-life.ts", "src/cognition/narrative-memory.ts", "src/cognition/reflection-system.ts", "src/cognition/reflection-retrieval.ts", "src/ecs/relations.ts", "src/persistence/world-persistence.ts");
  sourceFiles.push("src/demo/continuity-evidence.ts", "src/cognition/stimulus-queue.ts", "src/cognition/sensory-system.ts", "src/cognition/simulation-chronicle.ts");
  sourceFiles.push("src/demo/coffee-intervention.ts");
  sourceFiles.push("src/world/finite-portions.ts");
  sourceFiles.push("src/evals/inhabited-world-observation.ts");
  sourceFiles.push("src/world/object-type-traits.ts");
  sourceFiles.push("src/spirits/room-inventory-observation.ts", "src/runtime/evolution-coordinator.ts");
  sourceFiles.push("src/spirits/architect-diagnostics.ts");
  const fingerprints = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash("sha256").update(await readFile(resolve(path))).digest("hex")])));
  await writeFile(join(directory, "configuration.json"), JSON.stringify({ label, controller, experienceReconsideration, narrativeMind, live, focused, openNeighborhood, h3: false, evolution: worldMaintenance, growthLimits, seconds, condition, contactCondition, contact, stimuli, models: live ? MODEL_IDS : null,
    personalDaemonsEnabled: live,
    fingerprints, intervention, experiment: "Two fixed operator texts. Optional drain-first-pour removes all coffee during the first observed live pour; no pour means an inconclusive intervention. No forced action, emotional state, goal replacement, inner thought, friend knowledge, or response script." }, null, 2), { flag: "wx", mode: 0o600 });
  t = await ApartmentSitcom.create({ live, outsideTextAtMs: null, cognitionController: controller, experienceReconsideration, narrativeMind,
    scenario: focused ? "duet" : "cookie", openNeighborhood, worldMaintenance, growthLimits });
  if (focused) director = new SitcomDirector(t, { scheduling: "performance" });
  journal = await SitcomJournal.open(directory, { maxFrames: 8000 });
  for (const event of t.snapshot().events) { events.push(event); await journal.appendEvent(event); }
  for (const event of getCommittedEvents(t.sim.world).events) { publicEvents.push(event); await journal.appendPublicEvent(event); }
  t.onEvent(event => {
    events.push(event); void journal!.appendEvent(event).catch(error => { failed ??= String(error); t?.stop(); });
    if (event.kind === "thought" && ["reasoning", "appraisal"].includes(event.thoughtType ?? "") || event.kind === "speech" && event.status === "succeeded"
      || ["operator_text", "phone_read", "reply_delivered"].includes(event.kind)) {
      original.log(`[${(event.atSimMs / 1000).toFixed(1)}s] ${event.actor ?? "World"} ${event.thoughtType === "appraisal" ? "appraisal" : event.kind}: ${event.text}`);
    }
  });
  unsubscribe = subscribeCommittedEvents(t.sim.world, event => {
    publicEvents.push(event); void journal!.appendPublicEvent(event).catch(error => { failed ??= String(error); t?.stop(); });
  });
  t.setPhoneContact(contact); capture(); captureGrowth(); await t.start();
  const began = performance.now(); original.log(`TRIAL_STARTED label=${label} source=${t.sourceId} contact=${contact.name}/${contact.relationship}`);
  while (t.running && t.elapsedMs < seconds * 1000 && performance.now() - began < seconds * 1000 + 1000 && !failed) {
    while (nextStimulus < stimuli.length && t.elapsedMs >= stimuli[nextStimulus].atSimMs) {
      const message = stimuli[nextStimulus++], id = t.text(message.text, `fixed ${condition} evaluation stimulus`);
      issued.push({ requestedAtSimMs: message.atSimMs, actualAtSimMs: t.elapsedMs, messageId: id, text: message.text });
    }
    if (coffeeIntervention?.poll(t)) original.log(`OPERATOR_INTERVENTION ${JSON.stringify(coffeeIntervention.snapshot())}`);
    capture(); captureGrowth(); drainProjection();
    if (live) await sleep(250); else t.advance(250);
  }
  captureGrowth(); t.stop(); capture(); drainProjection(); unsubscribe(); unsubscribe = undefined;
  await journal.flush();
  const snapshot = t.snapshot(), firstRead = events.find(e => e.kind === "phone_read" && e.actor === "Elaine" && issued.some(m => m.messageId === e.messageId));
  const afterRead = events.filter(e => firstRead && e.sequence > firstRead.sequence);
  const thoughts = afterRead.filter(e => e.actor === "Elaine" && e.kind === "thought" && e.thoughtType === "reasoning");
  const before = [...cognition].reverse().find(f => firstRead && f.atSimMs < firstRead.atSimMs)?.actors.find(a => a.name === "Elaine");
  const afterStates = cognition.filter(f => firstRead && f.atSimMs >= firstRead.atSimMs);
  const compact = (e: SitcomEvent) => ({ sequence: e.sequence, atSimMs: e.atSimMs, actor: e.actor, text: e.text });
  const goalChanges: unknown[] = [], mindChanges: unknown[] = [];
  let oldGoals = JSON.stringify(before?.goals), oldMind = JSON.stringify(before?.mind);
  for (const f of afterStates) {
    const elaine = f.actors.find(a => a.name === "Elaine")!;
    if (JSON.stringify(elaine.goals) !== oldGoals) { goalChanges.push({ atSimMs: f.atSimMs, goals: elaine.goals }); oldGoals = JSON.stringify(elaine.goals); }
    if (JSON.stringify(elaine.mind) !== oldMind) { mindChanges.push({ atSimMs: f.atSimMs, mind: elaine.mind }); oldMind = JSON.stringify(elaine.mind); }
  }
  const heard = new Map<string, unknown>();
  for (const f of afterStates) for (const actor of f.actors.filter(a => a.name !== "Elaine")) for (const turn of actor.dialogue) {
    const key = `${actor.name}:${turn.id}`;
    if (turn.speaker === "Elaine" && !turn.own && turn.simulation && turn.simulation.completedAtSimMs >= firstRead!.atSimMs && !heard.has(key))
      heard.set(key, { listener: actor.name, observedAtSimMs: f.atSimMs, ...turn });
  }
  const chains = issued.map(message => {
    const delivered = events.find(e => e.kind === "phone_delivered" && e.messageId === message.messageId);
    const read = events.find(e => e.kind === "phone_read" && e.actor === "Elaine" && e.messageId === message.messageId);
    const buzz = events.find(e => e.kind === "phone_buzz" && delivered && e.sequence > delivered.sequence);
    const notification = events.find(e => e.kind === "perception" && e.actor === "Elaine" && delivered && e.sequence > delivered.sequence && e.text.includes("Your phone's familiar"));
    return { ...message, deliveredAtSimMs: delivered?.atSimMs ?? null, firstSubsequentBuzzAtSimMs: buzz?.atSimMs ?? null,
      ownerNotificationAtSimMs: notification?.atSimMs ?? null, ownerReadAtSimMs: read?.atSimMs ?? null,
      queuedToReadSimMs: read ? read.atSimMs - message.actualAtSimMs : null,
      replies: snapshot.phone.filter(m => m.direction === "out" && m.replyTo === message.messageId) };
  });
  const evidence = { label, controller, experienceReconsideration, narrativeMind, condition, contactCondition, atSimMs: snapshot.atSimMs, live, focused, h3: false, stoppedByOperator, failed,
    intervention: coffeeIntervention?.snapshot() ?? null,
    continuity: summarizeContinuityEvidence(events, cognition),
    runtime: { configuration: t.options, services: t.sim.getRuntimeServices(), stats: t.sim.getStats(), control: t.sim.getRuntimeStatus(), construction: t.sim.getWorldConstructionStatus(),
      evolution: t.sim.getEvolutionStatus(), coding: t.sim.getCodingStatus(), systemHealth: t.sim.getSystemHealth(),
      daemons: [...t.sim.daemons.daemons.values()].map(daemon => ({ name: daemon.agentName, whispers: daemon.whisperCount })) },
    projection: director ? { status: director.status(), segments: director.snapshot(),
      interpretation: "Pre-send compiler test, with immediate offline acknowledgements. No provider or media playback exercised. Any renderer failure blocks H3 readiness, independently of behavior." } : null,
    models: live ? MODEL_IDS : null, chains, firstReadAtSimMs: firstRead?.atSimMs ?? null,
    firstAuthoredThoughtAfterReadAtSimMs: thoughts[0]?.atSimMs ?? null, authoredPostReadThoughts: thoughts.map(compact),
    otherAuthoredPostReadThoughts: afterRead.filter(e => e.actor === "Elaine" && e.kind === "thought" && e.thoughtType !== "reasoning" && e.thoughtType !== "injected")
      .map(e => ({ ...compact(e), thoughtType: e.thoughtType })),
    exactMindComponentChangesAfterRead: mindChanges, exactGoalChangesAfterRead: goalChanges,
    observationEvidence: breakupObservationEvidence(cognition, firstRead?.atSimMs ?? null, events),
    experienceAppraisalEvents: events.filter(e => e.kind === "experience_appraisal" || e.kind === "appraisal"),
    completedElaineSpeechAfterRead: afterRead.filter(e => e.actor === "Elaine" && e.kind === "speech" && e.status === "succeeded").map(compact),
    peerActuallyHeardElaineAfterRead: [...heard.values()], completedPeerSpeechAfterRead: afterRead.filter(e => e.actor && e.actor !== "Elaine" && e.kind === "speech" && e.status === "succeeded").map(compact),
    semanticAssessment: { status: "requires_evidence_review", acknowledgement: null, emotionalReorientation: null, breakupSpecificGoalChange: null, deliberateDecline: null,
      explanation: "Post-read timing and component changes are mechanically observed, not proof of semantic uptake or causality. Review the exact quotes and goals. No reply alone is not evidence of a deliberate decline. No keyword match is a success score." },
    transportEvaluation: evaluateSitcom(t), journal: journal.snapshot(), completeEventCollection: !failed && events.length === snapshot.events.length + snapshot.droppedEvents,
    cognitiveState: t.characters.map(name => ({ name, goals: t!.sim.getAgentGoals(name), memories: t!.sim.getAgentMemories(name), workingMemory: getWorkingMemory(t!.sim.world, t!.ids[name]) })) };
  projectionFailed = !!director && !!(director.status().reason || director.status().error);
  const transcript = events.filter(e => e.kind === "thought" && ["reasoning", "appraisal"].includes(e.thoughtType ?? "") || e.kind === "speech" && e.status === "succeeded"
    || ["operator_text", "phone_read", "reply_delivered"].includes(e.kind)).map(e => `${(e.atSimMs / 1000).toFixed(1)}s ${e.actor ?? "World"} / ${e.thoughtType === "appraisal" ? "appraisal" : e.kind}: ${e.text}`).join("\n");
  await Promise.all([
    ...(director ? [writeFile(join(directory, "screenplay.json"), JSON.stringify(director.screenplay(), null, 2), { flag: "wx", mode: 0o600 }),
      writeFile(join(directory, "prompts.md"), director.screenplay().map((script, i) => `## Prompt ${i + 1}\n\n${script.prompt}\n`).join("\n"), { flag: "wx", mode: 0o600 })] : []),
    writeFile(join(directory, "result.json"), JSON.stringify(evidence, null, 2), { flag: "wx", mode: 0o600 }),
    writeFile(join(directory, "cognitive-frames.json"), JSON.stringify(cognition), { flag: "wx", mode: 0o600 }),
    writeFile(join(directory, "transcript.txt"), transcript + "\n", { flag: "wx", mode: 0o600 }),
    writeFile(join(directory, "world.json"), JSON.stringify(serializeWorld(t.sim.world, t.sim.god.systemRegistry)), { flag: "wx", mode: 0o600 }),
    journal.exportReplay(join(directory, "replay.html")),
  ]);
  original.log(`BREAKUP_RESULT ${JSON.stringify({ directory, condition, contactCondition, atSimMs: snapshot.atSimMs, chains,
    authoredThoughtsAfterRead: thoughts.length, goalChangesAfterRead: goalChanges.length, peerHeardTurns: heard.size,
    projectionGate: director ? (projectionFailed ? "failed" : "compiled_without_reported_error") : "not_requested",
    semanticAssessment: "requires_evidence_review", failed })}`);
} catch (error) {
  failed ??= error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(join(directory, "failure.json"), JSON.stringify({ failed, issued }, null, 2), { flag: "wx", mode: 0o600 });
} finally {
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); t?.stop(); director?.stop(); unsubscribe?.();
  try { await journal?.close(); } catch (error) { failed ??= String(error); }
  if (growthLog) await new Promise<void>(done => growthLog.end(done));
  Object.assign(console, original); await new Promise<void>(done => runtime.end(done));
}
if (failed) { original.error(failed); process.exitCode = 1; }
if (projectionFailed) { original.error("FOCUSED_PROJECTION_GATE_FAILED: review result.json and exact prompts before any H3 run."); process.exitCode = 1; }
