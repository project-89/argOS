/**
 * Spirit Cognition
 *
 * The cognitive loop for spirits - observe, analyze, report, intervene.
 * Spirits use LLMs to reason about what they observe in the ECS.
 */

import { generateText } from "ai";
import { getWorldAuthoringContext } from "../world/world-specification";
import { reviewNarrativeOpportunity } from "./narrative-opportunities";
import { google } from "@ai-sdk/google";
import { query, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Room, Goal, Impression, StimulusSource, PhysicalObject, Thought, ObjectState, AffectState, ObjectType } from "../ecs/components";
import { HasGoal, HasImpression } from "../ecs/relations";
import { getRoomForEntity, getDirectContainer } from "../ecs/location";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import type { EntityRegistry } from "../ecs/tools";
import type {
  SpiritState,
  SpiritCognitionInput,
  SpiritCognitionOutput,
  EcsSnapshot,
  AgentSnapshot,
  RoomSnapshot,
  ActionSnapshot,
  Observation,
  ObservationType,
  DivineMessage,
  Intervention,
  NarrativeState,
} from "./types";
import type { SpiritRegistry } from "./spirit-registry";
import { sendMessage, pruneSpiritInbox, markSpiritObservationCompleted } from "./spirit-registry";
import { broadcastToRoom, getActiveGoals } from "../cognition/cognition-system";
import { getAgentThoughts } from "../cognition/agent-mind";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { recordIssue } from "./consistency-spirit";
import { captureSpiritInterventionScope, type SpiritInterventionScope } from "./spirit-intervention-scope";
import { captureSpiritInterventionEvidence, type SpiritInterventionEvidence } from "./spirit-intervention-evidence";
import { captureSpiritCycleScope } from "./spirit-cycle-scope";
import { nudgeNpc } from "../nle/npc-nudge";
import { captureSpiritPhysicalEffects } from "./physical-effect-capabilities";
import { captureSpiritPublicEventReview, type SpiritPublicEventInput } from "./spirit-public-event-review";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { getWorldCharacterSeed, getWorldSpecification } from "../world/world-specification";
import { getNarrativeHost } from "../god/narrative-authority";
import { publishNarratorProse } from "./narrator-spirit";
import type { StoryLedger } from "./types";

// =============================================================================
// MODEL CONFIGURATION - LOCKED MODELS from centralized config
// See src/llm/config.ts for model definitions - DO NOT CHANGE HERE
// =============================================================================

import { spiritModel, proModel } from "../llm/config";

const models = {
  flash: spiritModel,
  haiku: spiritModel,  // Using flash as haiku equivalent
  pro: proModel,
};

// =============================================================================
// ECS OBSERVATION
// =============================================================================

/**
 * Collect a snapshot of the ECS world
 */
export function collectEcsSnapshot(
  world: World,
  registry: EntityRegistry,
  recentActions: ActionSnapshot[] = []
): EcsSnapshot {
  const agents = collectAgentSnapshots(world, registry);
  const rooms = collectRoomSnapshots(world, registry);

  return {
    tick: Date.now(),
    agents,
    rooms,
    recentActions,
  };
}

function collectAgentSnapshots(world: World, registry: EntityRegistry): AgentSnapshot[] {
  const agentEids = Array.from(query(world, [Agent]));

  return agentEids.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const roomEid = getRoomForEntity(world, eid);
    const location = roomEid !== undefined ? (Name.value[roomEid] || "Unknown") : "Nowhere";

    const arousal = Mind.arousal[eid] ?? 0.5;
    const focus = Mind.focus[eid] || "";
    const mode = Mind.mode[eid] || "reactive";
    const active = Agent.active[eid] ?? true;

    // Derive mood
    const mood = arousal > 0.7 ? "agitated" :
                 arousal > 0.5 ? "alert" :
                 arousal > 0.3 ? "calm" : "drowsy";

    return {
      eid,
      name,
      location,
      mood,
      arousal,
      focus,
      mode: mode as string,
      active,
      recentThoughts: getAgentThoughts(world, eid).slice(-3).map(id => Thought.content[id] || "").filter(Boolean),
      goals: getActiveGoals(world, eid),
    };
  });
}

function collectRoomSnapshots(world: World, registry: EntityRegistry): RoomSnapshot[] {
  const roomEids = Array.from(query(world, [Room]));
  // A quiet prop is still real. Phones, desks and carried objects need not
  // have StimulusSource, and must not look "missing" to world maintenance.
  const allObjects = [...new Set([...query(world, [StimulusSource]), ...query(world, [PhysicalObject])])];

  return roomEids.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const description = Description.value[eid] || "";
    const ambience = Room.ambience[eid] || "neutral";

    // Find occupants (agents in this room)
    const allAgents = Array.from(query(world, [Agent]));
    const occupants = allAgents
      .filter(aid => {
        return getRoomForEntity(world, aid) === eid;
      })
      .map(aid => Name.value[aid] || "Unknown");

    // Include nested/held physical objects, without exposing private message bodies.
    const objects: string[] = [];
    const objectPlacements: NonNullable<RoomSnapshot["objectPlacements"]> = [];

    for (const objEid of allObjects) {
      // Skip agents (they're in occupants)
      if (hasComponent(world, objEid, Agent)) continue;

      if (getRoomForEntity(world, objEid) === eid) {
        const objName = Name.value[objEid];
        if (objName) {
          objects.push(objName);
          const container = getDirectContainer(world, objEid);
          const state = hasComponent(world, objEid, ObjectState) ? ObjectState.current[objEid] : undefined;
          const description = hasComponent(world, objEid, Description) ? Description.value[objEid] : undefined;
          objectPlacements.push({ eid: objEid, name: objName,
            container: container === undefined ? null : Name.value[container] || `entity:${container}`,
            held: container !== undefined && hasComponent(world, container, Agent),
            ...(typeof state === "string" ? { state: state.slice(0, 128) } : {}),
            ...(typeof description === "string" ? { description: description.slice(0, 1000) } : {}),
          });
        }
      }
    }

    return {
      eid,
      name,
      description,
      occupants,
      objects,
      objectPlacements,
      ambience,
    };
  });
}

// =============================================================================
// SPIRIT COGNITION CYCLE
// =============================================================================

/**
 * Run a single cognition cycle for a spirit
 * @param globalContext - Optional global context from GodAgent (mood, directives, pacing)
 */
export async function runSpiritCognition(
  spirit: SpiritState,
  world: World,
  registry: EntityRegistry,
  spiritRegistry: SpiritRegistry,
  recentActions: ActionSnapshot[] = [],
  globalContext?: string
): Promise<SpiritCognitionOutput> {
  const startTime = Date.now();

  // 1. Collect ECS snapshot
  const cycleScope = captureSpiritCycleScope(world, spirit, spiritRegistry);
  if (!cycleScope.isCurrent()) return discardedCycleOutput();
  const ecsSnapshot = collectEcsSnapshot(world, registry, recentActions);
  const interventionScope = captureSpiritInterventionScope(world, spirit, spiritRegistry, cycleScope.sourceCurrent);
  const physicalEffects = captureSpiritPhysicalEffects(world, spirit, spiritRegistry);
  const publicReview = captureSpiritPublicEventReview(world, spirit, spiritRegistry, cycleScope.isCurrent);

  // 2. Prepare input
  // Keep receipt identity separate from the immutable text offered to this
  // cycle. New reports can arrive while inference or output delivery awaits.
  pruneSpiritInbox(spiritRegistry, spirit);
  const observedMessages = new Map(spirit.inbox.map(message => [message, { ...message }]));
  const interventionEvidence = captureSpiritInterventionEvidence(world, [...observedMessages.values()].map(message => ({
    sender: message.senderLabel ?? `spirit:${message.from}`,
    subject: message.subject, content: message.content,
  })));
  const input: SpiritCognitionInput = {
    spirit,
    ecsSnapshot,
    recentEvents: spirit.observations.slice(-20),
    incomingMessages: [...observedMessages.values()],
    activeDirectives: spirit.pendingDirectives.filter(d => d.status === "pending" || d.status === "active"),
    interventionEvidence: { records: interventionEvidence.records, omittedRecords: interventionEvidence.omittedRecords },
    physicalEffectPolicy: { restricted: physicalEffects.restricted, description: physicalEffects.description },
  };

  // 3. Build prompt based on spirit type (including global context if available)
  const narrative = spirit.definition.domain === "narrative";
  const authoringContext = [narrative ? compactAuthoringBrief(world, globalContext) : getWorldAuthoringContext(world), globalContext].filter(Boolean).join("\n\n");
  const prompt = narrative
    ? buildNarratorPrompt(spirit, input, world, interventionEvidence, authoringContext, publicReview.input)
    : buildSpiritPrompt(spirit, input, authoringContext, publicReview.input);

  // 4. Run LLM
  const model = models[spirit.definition.model];
  let output: SpiritCognitionOutput;
  let acceptedResponse = false;

  try {
    const response = await generateText({
      model,
      system: narrative ? `${spirit.definition.systemPrompt}\n\n${AUTHOR_GROUNDING}` : `${spirit.definition.systemPrompt}\n\nPERSISTENCE AND AGENCY: Live ECS state is authoritative; narrative setup, descriptions and previous reports may be stale. Absence from a remembered starting room is not evidence of a missing entity. Check current location and possession across the whole world before reporting a missing prop. A moved, carried, consumed, depleted, locked or intentionally removed object may be a real player consequence or puzzle condition, not an engine fault. Do not recommend restoring or duplicating it to force a planned beat. Report uncertainty, adapt the narrative, and distinguish genuine missing mechanics from story obstacles. NPC choices and unread/private information must not be fabricated as world events.`,
      prompt,
      temperature: 0.7,
    });

    // 5. Parse response
    assertSimulationTaskActive();
    if (!cycleScope.isCurrent()) return discardedCycleOutput();
    output = parseSpiritResponse(spirit, response.text, input, readSimulationTime(world));
    acceptedResponse = true;
  } catch (error) {
    assertSimulationTaskActive();
    if (!cycleScope.isCurrent()) return discardedCycleOutput();
    console.error(`[Spirit] ${spirit.definition.name} cognition error:`, error);
    output = {
      thoughts: `Error during cognition: ${error}`,
      observations: [],
      reports: [],
      interventions: [],
      directiveResponses: [],
    };
  }

  // 6. Process outputs
  assertSimulationTaskActive();
  if (!cycleScope.isCurrent()) return discardedCycleOutput();
  processOutputs(spirit, output, world, spiritRegistry, interventionScope, interventionEvidence, cycleScope, physicalEffects);
  if (!cycleScope.isCurrent()) return discardedCycleOutput();
  if (acceptedResponse && narrative) {
    recordAuthorMoves(spirit, output, world);
    // Presentation only: viewers and recordings, never a resident perception.
    if (output.storyProse) publishNarratorProse(world, { sourceId: getCommittedEvents(world).sourceId ?? null,
      atSimMs: readSimulationTime(world), spirit: spirit.definition.name, text: output.storyProse,
      phase: spirit.narrativeState?.currentPhase, tension: spirit.narrativeState?.tension });
  }

  // 7. Update spirit state
  if(acceptedResponse) reviewNarrativeOpportunity(world,spirit,[...observedMessages.keys()],output.reports);
  markSpiritObservationCompleted(spiritRegistry, spirit);
  if (acceptedResponse) {
    spirit.inbox = spirit.inbox.filter(message => {
      const observed = observedMessages.get(message);
      // A replacement receipt or amended prompt-visible text needs a fresh read.
      return !observed || observed.id !== message.id || observed.subject !== message.subject || observed.content !== message.content;
    });
  }

  // Add thoughts to memory
  if (output.thoughts) {
    spirit.shortTermMemory.push(output.thoughts);
    if (spirit.shortTermMemory.length > 20) {
      spirit.shortTermMemory = spirit.shortTermMemory.slice(-20);
    }
  }

  publicReview.finish({ accepted: acceptedResponse, interventions: output.interventions,
    phase: spirit.narrativeState?.currentPhase, tension: spirit.narrativeState?.tension });

  const duration = Date.now() - startTime;
  console.log(`[Spirit] ${spirit.definition.name} cycle complete (${duration}ms)`);

  return output;
}

function discardedCycleOutput(): SpiritCognitionOutput {
  return { discarded: "stale_cycle", thoughts: "", observations: [], reports: [], interventions: [], directiveResponses: [] };
}

// =============================================================================
// THE AUTHOR'S VIEW (narrative domain)
// =============================================================================

const AUTHOR_GROUNDING = "Live ECS state is authoritative: where people are, what they hold, what has been moved, eaten or broken. Build on the world as it is; a moved or missing object is part of the story, not something to put back. Your prose tells what really happened. Your events and whispers shape what happens next.";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const percent = (value: number | undefined) => `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;

/** Setting, genre, tone and tensions only; the author's system prompt carries the bible. */
function compactAuthoringBrief(world: World, alreadyShown = ""): string {
  const spec = getWorldSpecification(world);
  if (!spec) return "";
  const { setting, story } = spec as { setting?: { name?: string; genre?: string; premise?: string; tone?: string }; story?: { tensions?: string[] } };
  return [`SETTING: ${[setting?.name, setting?.genre].filter(Boolean).join(" · ")}`,
    setting?.premise && !alreadyShown.includes(setting.premise) ? `Premise: ${setting.premise}` : "", setting?.tone ? `Tone: ${setting.tone}` : "",
    story?.tensions?.length ? `Tensions: ${story.tensions.join(" ")}` : ""].filter(Boolean).join("\n");
}

function describeCast(world: World, snapshot: EcsSnapshot): string[] {
  const lines: string[] = [];
  for (const agent of snapshot.agents) {
    if (!agent.active) continue;
    const eid = agent.eid, seed = getWorldCharacterSeed(world, agent.name);
    const room = snapshot.rooms.find(r => r.name === agent.location);
    const company = room ? room.occupants.filter(name => name !== agent.name) : [];
    const affect = hasComponent(world, eid, AffectState) && typeof AffectState.feeling[eid] === "string" && AffectState.feeling[eid]
      ? `${AffectState.feeling[eid]}${AffectState.reason[eid] ? ` — ${clip(String(AffectState.reason[eid]), 110)}` : ""}` : agent.mood;
    const prompt = Agent.systemPrompt[eid] || "", marker = prompt.indexOf("PRIVATE LIFE BEFORE THIS SCENE:");
    const section = (label: string) => { const at = prompt.indexOf(label); if (at < 0) return "";
      const rest = prompt.slice(at + label.length); const next = rest.search(/\n[A-Z][A-Z ]+:/); return (next < 0 ? rest : rest.slice(0, next)).trim(); };
    const persona = clip((marker >= 0 ? prompt.slice(0, marker) : prompt).replace(/^You are [^.]*\.\s*/, "")
      .replace(/Choose from what you perceive[^.]*\.|Your memories are your own[^.]*\./g, ""), 200);
    const background = seed?.past?.background ?? section("PRIVATE LIFE BEFORE THIS SCENE:");
    const secret = seed?.past?.secret ?? section("WHAT YOU HIDE:");
    lines.push(`• ${agent.name} — ${clip(Agent.role[eid] || seed?.role || "resident", 90)}. At ${agent.location}${company.length ? ` with ${company.join(", ")}` : ", alone"}. Feeling: ${affect}.`);
    if (persona) lines.push(`  Nature: ${persona}`);
    if (secret) lines.push(`  Hides: ${clip(secret, 600)}`);
    if (background) lines.push(`  Life: ${clip(background, secret ? 300 : 700)}`);
    const goals = [...(agent.goals ?? [])].sort((a, b) => b.priority - a.priority).slice(0, 2).map(goal => clip(goal.description, 150));
    if (goals.length) lines.push(`  Wants now: ${goals.join(" | ")}`);
    const thoughts = agent.recentThoughts.slice(-2).map(thought => `"${clip(thought, 160)}"`);
    if (thoughts.length) lines.push(`  Inner voice: ${thoughts.join(" / ")}`);
  }
  return lines;
}

type Placement = NonNullable<RoomSnapshot["objectPlacements"]>[number];
/** Objects with their own story: an individual description, not catalogue
 * boilerplate shared by many (trees, seats, pastries) and not walls or phones. */
function notableObjects(world: World, snapshot: EcsSnapshot): Set<number> {
  const all = snapshot.rooms.flatMap(room => room.objectPlacements ?? []), generic = (o: Placement) =>
    (o.description ?? "").replaceAll(o.name, "").replace(/\b(belonging to )?[A-Z][a-z]+'s\b/g, "").trim();
  const counts = new Map<string, number>();
  for (const object of all) counts.set(generic(object), (counts.get(generic(object)) ?? 0) + 1);
  return new Set(all.filter(o => !!o.description && o.description.trim() !== o.name.trim() && (counts.get(generic(o)) ?? 0) < 3
    && !(hasComponent(world, o.eid, ObjectType) && ["structural_wall", "smartphone"].includes(ObjectType.typeId[o.eid]))).map(o => o.eid));
}
const isWall = (world: World, eid: number) => hasComponent(world, eid, ObjectType) && ObjectType.typeId[eid] === "structural_wall";

function describeWorldNow(world: World, snapshot: EcsSnapshot): string[] {
  const lines = [`It is ${world.time?.timeOfDay ?? "day"}${Number.isFinite(world.time?.simulationHour) ? ` (${world.time.simulationHour}:00)` : ""}.`];
  const notableIds = notableObjects(world, snapshot);
  for (const room of snapshot.rooms) {
    const objects = (room.objectPlacements ?? []).filter(o => !isWall(world, o.eid));
    const notable = objects.filter(o => notableIds.has(o.eid));
    const groups = new Map<string, number>();
    for (const object of objects) {
      if (notable.includes(object) || object.held) continue;
      const base = object.name.replace(/\s+\d+$/, "");
      groups.set(base, (groups.get(base) ?? 0) + 1);
    }
    const plain = [...groups].map(([name, count]) => count > 1 ? `${name} ×${count}` : name);
    const held = objects.filter(o => o.held && !notable.includes(o)).map(o => `${o.name} (carried by ${o.container})`);
    lines.push(`• ${room.name}: ${room.occupants.length ? room.occupants.join(", ") : "nobody"}${room.ambience && !["neutral", "calm", ""].includes(room.ambience) ? ` · feels ${room.ambience}` : ""}`);
    if (plain.length || held.length) lines.push(`  Things: ${clip([...plain, ...held].join(", "), 420)}`);
    for (const object of notable.slice(0, 6)) lines.push(`  ◦ ${object.name}${object.state && !["normal", "empty"].includes(object.state) ? ` [${object.state}]` : ""}${object.held ? ` (carried by ${object.container})` : object.container && object.container !== room.name ? ` (in/on ${object.container})` : ""}: ${clip(object.description ?? "", 220)}`);
  }
  return lines;
}

function describePublicEvents(events: SpiritPublicEventInput | undefined, since: number | undefined): string[] {
  if (!events) return ["(No public record is available to you in this world.)"];
  const rows = [
    ...events.records.map(record => ({ at: record.lastAtSimMs, text: record.spokenText
      ? `${record.actorName ?? "Someone"}${record.roomName ? ` (${record.roomName})` : ""} says: "${clip(record.spokenText, 280)}"`
      : `${record.actorName ?? "Someone"} ${record.action}${record.operation ? ` (${record.operation})` : ""}${record.targetName ? ` → ${record.targetName}` : ""}${record.roomName ? ` in ${record.roomName}` : ""} — ${record.status}` })),
    ...events.environment.receipts.map(receipt => ({ at: receipt.atSimMs, text: `${receipt.roomName}: ${clip(receipt.detail, 240)}` })),
  ].sort((a, b) => a.at - b.at);
  const lines = rows.slice(-30).map(row => `[${clock(row.at)}] ${row.text}`);
  const hidden = Math.max(0, rows.length - 30) + events.droppedBeforeWindow + events.omittedRecords;
  if (hidden) lines.unshift(`(${hidden} earlier events not shown)`);
  if (!lines.length) lines.push(since === undefined ? "(Nothing public has happened yet.)" : "(Nothing public happened since your last review.)");
  const pace = events.progress?.rolling;
  if (pace) lines.push(`Pace, last ${Math.round((events.progress.windowMs ?? 120_000) / 60_000)} min: ${pace.physicalCompletions} physical actions, ${pace.spokenExecutions} spoken, ${pace.inspectionCompletions} inspections, ${pace.waitOrRestCompletions} waits/rests, ${pace.failedActions} failed, ${pace.environmentChanges} world changes.`);
  return lines;
}

function describeLedger(spirit: SpiritState, nowMs: number): string[] {
  const state = spirit.narrativeState!, ledger = state.ledger;
  if (!ledger) return ["This is your first review. Meet the cast, choose the dramatic questions this session will ask, and start planting.",
    "Suggested shape: setup for ~3 min (tension ≈30%), rising to ~10 min (≈60%), a turn or crisis around 14–18 min (≈85%), then let consequences land (≈60%) and open a new question."];
  const lines = [`${clock(nowMs - ledger.startedAtSimMs)} into your arc. Tension now ${percent(ledger.tensionNow)}; your target ${percent(ledger.tensionTarget)}. Phase: ${state.currentPhase}.`,
    "Suggested shape: setup ~3 min (≈30%), rising to ~10 min (≈60%), a turn or crisis at 14–18 min (≈85%), then consequences (≈60%) and a new question."];
  if (ledger.plan) lines.push(`Your plan: ${clip(ledger.plan, 400)}`);
  if (ledger.questions.length) lines.push("Dramatic questions:", ...ledger.questions.map(q => `  - [${q.status}] ${clip(q.question, 180)}${q.answer ? ` → ${clip(q.answer, 140)}` : ""}`));
  if (ledger.threads.length) lines.push("Threads:", ...ledger.threads.map(t => `  - ${clip(t.name, 80)} [${t.status}] (${t.participants.join(", ") || "—"})${t.next ? ` next: ${clip(t.next, 160)}` : ""}`));
  if (ledger.foreshadowing.length) lines.push(`Foreshadowing: ${ledger.foreshadowing.map(f => `${clip(f.detail, 120)} [${f.status}]`).join("; ")}`);
  if (ledger.moves.length) lines.push("Your recent moves and what the world did:", ...ledger.moves.slice(-6).map(m => `  - [${clock(m.atSimMs)}] ${m.kind} → ${clip(m.target, 60)}: ${clip(m.summary, 140)} ⇒ ${clip(m.result, 140)}`));
  if (ledger.lastReasoning) lines.push(`Your reasoning last time: ${clip(ledger.lastReasoning, 700)}`);
  return lines;
}

/** Compact, optional citations: places, whereabouts and notable objects. */
function narratorEvidence(world: World, input: SpiritCognitionInput, evidence: SpiritInterventionEvidence): string {
  const ids = notableObjects(world, input.ecsSnapshot);
  const notable = new Set(input.ecsSnapshot.rooms.flatMap(room => (room.objectPlacements ?? []).filter(o => ids.has(o.eid)).map(o => o.name)));
  // Descriptions are already in THE WORLD NOW; the citation needs only its ID.
  const shown = evidence.records.filter(record => record.kind === "place" || record.kind === "actor_presence" || record.kind === "attributed_report"
    || notable.has(record.subject)).slice(0, 48)
    .map(({ value, ...record }) => record.kind === "object_description" ? record
      : { ...record, value: record.kind === "attributed_report" && typeof value === "string" ? clip(value, 160) : value });
  return JSON.stringify({ records: shown, omittedRecords: evidence.omittedRecords + evidence.records.length - shown.length });
}

function buildNarratorPrompt(spirit: SpiritState, input: SpiritCognitionInput, world: World, evidence: SpiritInterventionEvidence,
  context: string, publicEvents?: SpiritPublicEventInput): string {
  const nowMs = readSimulationTime(world), state = spirit.narrativeState;
  const host = getNarrativeHost(world), hostGranted = !!host && host.narrator === spirit;
  const sections: string[] = [`You are ${spirit.definition.name}. It is ${clock(nowMs)} of world time. Time for your review of the story.`, ""];
  if (context) sections.push(context, "");
  sections.push("=== THE CAST — author's eyes only ===",
    "Residents never see this. What one knows, the others don't, unless the world shows them.", ...describeCast(world, input.ecsSnapshot), "");
  sections.push("=== THE WORLD NOW ===", ...describeWorldNow(world, input.ecsSnapshot), "");
  sections.push("=== SINCE YOUR LAST REVIEW ===", ...describePublicEvents(publicEvents, publicEvents?.progress?.previousAcceptedAtSimMs ?? undefined), "");
  if (state) {
    sections.push("=== YOUR STORY LEDGER (your own notes) ===", ...describeLedger(spirit, nowMs));
    if (state.recentProse.length) sections.push("Your recent prose (move on from it; don't repeat it):", ...state.recentProse.slice(-4).map(prose => `  "${clip(prose, 320)}"`));
    sections.push("");
  }
  if (input.incomingMessages.length) {
    sections.push("=== MESSAGES ===");
    for (const message of input.incomingMessages) sections.push(`From ${message.senderLabel ?? `spirit:${message.from}`} (${message.type}): ${clip(message.subject, 160)}`, `  ${clip(message.content, 600)}`);
    sections.push("");
  }
  if (input.activeDirectives.length) sections.push("=== DIRECTIVES ===", ...input.activeDirectives.map(d => `- ${d.description} [${d.status}]`), "");
  sections.push("=== WHAT YOU CAN DO ===");
  const canAct = spirit.definition.canInjectEvents && (hostGranted || !!input.physicalEffectPolicy?.description);
  if (canAct) {
    sections.push("1) worldEvent — at most one per review. Use it when the story needs a push, a sign, a consequence or a callback; skip it when a scene needs room to breathe.");
    if (hostGranted) sections.push(host!.describe());
    if (input.physicalEffectPolicy?.description) sections.push(`Weather and branch events use the same worldEvent object with "place" set to the exact outdoor place, e.g. {"operation":"weather","place":"<outdoor place>","condition":"rain"}. Current details: ${input.physicalEffectPolicy.description}`);
  } else sections.push("1) worldEvent — no world events are granted to you here; ask God instead.");
  sections.push("2) whispers — up to two. A line in a resident's own inner voice: second person, vivid, brief. A pull, a doubt, a memory surfacing, a temptation, a dare — rooted in their own life and what they have seen. It moves them; it never hands them facts they lack or another person's secret.",
    "3) requests — ask God for larger moves: stage an event, place a story object, build a new mechanic, bring someone to town. Say what, where and why it serves the story.",
    "Use exact names from above. Evidence IDs are optional (\"evidenceIds\" on a whisper or worldEvent); cite them if a move depends on something that might change:",
    "ISSUED_INTERVENTION_EVIDENCE:", narratorEvidence(world, input, evidence), "");
  sections.push("=== ANSWER ===", "Reply with one JSON object:", "```json", `{
  "thoughts": "Your reasoning as the author: what the story needs now and why.",
  "storyProse": "1-3 sentences of present-tense prose about what actually happened since your last review (someone heading somewhere hasn't arrived yet); empty if nothing new.",
  "ledger": {
    "tensionNow": 0.0, "tensionTarget": 0.0, "phase": "exposition|inciting|rising|crisis|climax|falling|resolution",
    "questions": [{ "question": "", "status": "open|answered", "answer": "" }],
    "threads": [{ "name": "", "status": "setup|rising|turn|payoff|dormant", "participants": [""], "next": "the beat you are building toward" }],
    "foreshadowing": [{ "detail": "", "status": "planted|paid" }],
    "plan": "your next two or three beats"
  },
  "worldEvent": null,
  "whispers": [{ "resident": "exact name", "impulse": "You ...", "kind": "reflect|interact|arrive|escalate|resolve|change_goal" }],
  "requests": [{ "type": "create_event|escalate|suggest_beat|new_mechanic", "target": "who or where", "action": "what should happen", "reason": "why it serves the story" }]
}`, "```");
  return sections.join("\n");
}

const LEDGER_LIMITS = { questions: 8, threads: 8, foreshadowing: 10, moves: 16 };
function parseLedger(value: unknown, previous: StoryLedger | undefined, nowMs: number): StoryLedger | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, any>, text = (v: unknown, max: number) => typeof v === "string" && v.trim() ? clip(v, max) : undefined;
  const unit = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  const list = <T>(v: unknown, map: (row: any) => T | undefined, max: number): T[] | undefined =>
    Array.isArray(v) ? v.map(map).filter((row): row is T => row !== undefined).slice(0, max) : undefined;
  const threadStatuses = ["setup", "rising", "turn", "payoff", "dormant"] as const;
  return {
    startedAtSimMs: previous?.startedAtSimMs ?? nowMs,
    tensionNow: unit(raw.tensionNow, previous?.tensionNow ?? 0.2),
    tensionTarget: unit(raw.tensionTarget, previous?.tensionTarget ?? 0.3),
    questions: list(raw.questions, q => { const question = text(q?.question, 200); return question ? { question, status: q.status === "answered" ? "answered" as const : "open" as const, ...(text(q.answer, 200) ? { answer: text(q.answer, 200) } : {}) } : undefined; }, LEDGER_LIMITS.questions) ?? previous?.questions ?? [],
    threads: list(raw.threads, t => { const name = text(t?.name, 80); return name ? { name, status: threadStatuses.includes(t.status) ? t.status : "setup",
      participants: Array.isArray(t.participants) ? t.participants.filter((p: unknown) => typeof p === "string").slice(0, 6).map((p: string) => clip(p, 60)) : [],
      ...(text(t.next, 200) ? { next: text(t.next, 200) } : {}) } : undefined; }, LEDGER_LIMITS.threads) ?? previous?.threads ?? [],
    foreshadowing: list(raw.foreshadowing, f => { const detail = text(f?.detail, 160); return detail ? { detail, status: f.status === "paid" ? "paid" as const : "planted" as const } : undefined; }, LEDGER_LIMITS.foreshadowing) ?? previous?.foreshadowing ?? [],
    ...(text(raw.plan, 500) ?? previous?.plan ? { plan: text(raw.plan, 500) ?? previous?.plan } : {}),
    ...(previous?.lastReasoning ? { lastReasoning: previous.lastReasoning } : {}),
    moves: previous?.moves ?? [],
  };
}

const NUDGE_KINDS = ["arrive", "interact", "resolve", "escalate", "reflect", "change_goal"] as const;
const REQUEST_TYPES = ["create_event", "escalate", "suggest_beat", "new_mechanic", "resolve_thread"];
const PHASES = ["exposition", "inciting", "rising", "crisis", "climax", "falling", "resolution", "denouement"];
/** The author's JSON: ledger, one world event, whispers and requests to God. */
function parseAuthorMoves(spirit: SpiritState, parsed: Record<string, any>, output: SpiritCognitionOutput, nowMs: number): void {
  const moveId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ledger = spirit.narrativeState ? parseLedger(parsed.ledger, spirit.narrativeState.ledger, nowMs) : undefined;
  if (ledger) {
    output.updatedNarrativeState ??= {};
    output.updatedNarrativeState.ledger = ledger;
    output.updatedNarrativeState.tension = ledger.tensionNow;
    if (PHASES.includes(parsed.ledger?.phase)) output.updatedNarrativeState.currentPhase = parsed.ledger.phase;
  }
  const event = parsed.worldEvent;
  if (event && typeof event === "object" && !Array.isArray(event) && spirit.definition.canInjectEvents) {
    const operation = typeof event.operation === "string" ? event.operation : "";
    const content = operation === "weather" ? { operation, condition: event.condition }
      : operation === "tree_damage" ? { operation, tree: event.tree } : event;
    output.interventions.push({ id: moveId("event"), spiritEid: spirit.eid, timestamp: Date.now(), type: "world_effect",
      target: operation === "phone_message" ? { type: "agent", name: typeof event.resident === "string" ? event.resident : undefined }
        : { type: "room", name: typeof event.place === "string" ? event.place : undefined },
      content: content as unknown as string, reason: typeof event.reason === "string" ? event.reason : "The story needs it",
      evidenceIds: event.evidenceIds });
  }
  if (Array.isArray(parsed.whispers)) for (const whisper of parsed.whispers.slice(0, 2)) {
    if (!whisper || typeof whisper.resident !== "string" || typeof whisper.impulse !== "string" || !whisper.impulse.trim()) continue;
    output.interventions.push({ id: moveId("whisper"), spiritEid: spirit.eid, timestamp: Date.now(), type: "inject_stimulus",
      target: { type: "agent", name: whisper.resident }, content: clip(whisper.impulse, 400), reason: "An impulse from within",
      nudgeKind: NUDGE_KINDS.includes(whisper.kind) ? whisper.kind : "reflect", evidenceIds: whisper.evidenceIds });
  }
  if (Array.isArray(parsed.requests)) for (const request of parsed.requests.slice(0, 3)) {
    if (!request || typeof request.action !== "string" || !request.action.trim()) continue;
    const directiveType = REQUEST_TYPES.includes(request.type) ? request.type : "suggest_beat";
    const target = typeof request.target === "string" ? clip(request.target, 120) : "", reason = typeof request.reason === "string" ? clip(request.reason, 600) : "";
    const action = clip(request.action, 1200);
    output.reports.push({ id: moveId("request"), timestamp: Date.now(), from: spirit.eid, to: spirit.superiorEid || -1, type: "report",
      domain: "narrative", priority: "high", subject: `[NARRATIVE_DIRECTIVE:${directiveType}] ${target}`,
      content: `Target: ${target}\nAction: ${action}\nReason: ${reason}`, requiresResponse: false,
      data: { source: "narrative_directive", directiveType, target, action, reason } });
  }
}

/** Feed the author its own reasoning and the host's receipts next time. */
function recordAuthorMoves(spirit: SpiritState, output: SpiritCognitionOutput, world: World): void {
  const state = spirit.narrativeState; if (!state) return;
  const nowMs = readSimulationTime(world);
  const ledger: StoryLedger = state.ledger ?? { startedAtSimMs: nowMs, tensionNow: state.tension, tensionTarget: 0.3, questions: [], threads: [], foreshadowing: [], moves: [] };
  if (output.thoughts) ledger.lastReasoning = clip(output.thoughts, 1200);
  for (const intervention of output.interventions) {
    const content = typeof intervention.content === "string" ? intervention.content : JSON.stringify(intervention.content);
    ledger.moves.push({ atSimMs: nowMs, kind: intervention.type === "world_effect" ? `event:${operationOf(intervention.content) ?? "effect"}` : intervention.type === "inject_stimulus" ? "whisper" : intervention.type,
      target: intervention.target.name ?? "", summary: clip(content, 160), result: clip(`${intervention.result ?? "not attempted"}${intervention.detail ? ` — ${intervention.detail}` : ""}`, 200) });
  }
  for (const report of output.reports) if (report.data?.source === "narrative_directive")
    ledger.moves.push({ atSimMs: nowMs, kind: `request:${report.data.directiveType}`, target: String(report.data.target ?? ""), summary: clip(String(report.data.action ?? ""), 160), result: "sent to God" });
  ledger.moves = ledger.moves.slice(-LEDGER_LIMITS.moves);
  state.ledger = ledger;
}

function operationOf(content: unknown): string | undefined {
  let value = content;
  if (typeof content === "string") { if (content.length > 4000) return; try { value = JSON.parse(content); } catch { return; } }
  const operation = value && typeof value === "object" && !Array.isArray(value) ? Object.getOwnPropertyDescriptor(value, "operation")?.value : undefined;
  return typeof operation === "string" ? operation : undefined;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildSpiritPrompt(spirit: SpiritState, input: SpiritCognitionInput, globalContext?: string,
  publicEvents?: SpiritPublicEventInput): string {
  const sections: string[] = [];
  const narrative = spirit.definition.domain === "narrative";
  const physicalPolicy = () => {
    sections.push("PHYSICAL EFFECT POLICY: Room inject_stimulus, mood modification and all unlisted effects are forbidden. inject_stimulus may only offer an optional, evidence-grounded consideration to an agent; it cannot create an event, fact, goal or action. Physical changes require the following host-issued capability, exact JSON and room/place evidence. Unchanged state is a valid outcome; do not claim a suggested effect happened before its native receipt.");
    sections.push(input.physicalEffectPolicy?.description ?? "No physical-effect capability is granted to this spirit; report suggestions only.");
    sections.push("");
  };

  // Header
  sections.push(`You are ${spirit.definition.name}, a ${spirit.definition.rank} spirit managing the ${spirit.definition.domain} domain.`);
  sections.push("");

  // GLOBAL CONTEXT (if provided by God)
  // This is the critical "pinned context" that spans all spirits
  if (globalContext) {
    sections.push(globalContext);
    sections.push("");
  }

  // Put the live capability menu before the evidence, not after a town-sized
  // inventory. This is still the same captured, native authority grant.
  if (narrative && input.physicalEffectPolicy?.restricted) physicalPolicy();

  if (narrative) {
    sections.push("=== PUBLIC SCENE ===");
    sections.push(`Captured at ${publicEvents?.observedAtSimMs ?? "unknown"} simulated milliseconds. The issued current evidence below supplies actor presence and object state, placement and exterior detail. Omitted evidence is unknown, not absence.`);
    sections.push("PLACE CONTEXT (setting descriptions, not new events):");
    for (const room of input.ecsSnapshot.rooms) sections.push(`  ${room.name}: ${(room.description || "").slice(0, 600)}`);
    sections.push("");
  } else {
    // Other supervisory domains retain their existing diagnostic view. The
    // public Narrator above must not turn that private cognition into a story.
    sections.push("=== CURRENT WORLD STATE ===");
    sections.push("");
    sections.push("AGENTS:");
    for (const agent of input.ecsSnapshot.agents) {
      sections.push(`  ${agent.name} [${agent.mood}] @ ${agent.location}${agent.active ? "" : " (inactive)"}`);
      if (agent.focus) sections.push(`    Focus: ${agent.focus}`);
      sections.push(`    Active goals: ${agent.goals?.map(g => `${g.description} (priority ${g.priority})`).join("; ") || "none"}`);
      if (agent.recentThoughts.length) sections.push(`    Recent thoughts: ${JSON.stringify(agent.recentThoughts)}`);
    }
    sections.push("");
    sections.push("LOCATIONS:");
    for (const room of input.ecsSnapshot.rooms) {
      const occupants = room.occupants.length > 0 ? room.occupants.join(", ") : "empty";
      sections.push(`  ${room.name}: [${occupants}]`);
      if (room.objectPlacements?.length) {
        sections.push("    Physical objects (current public state):");
        for (const object of room.objectPlacements) {
          sections.push(`      ${object.name}${object.state ? ` [${object.state}]` : ""} (${object.held ? "held by" : "in/on"} ${object.container})${object.description ? `: ${object.description}` : ""}`);
        }
      }
    }
    sections.push("");
  }

  // Native history is independent of the legacy shared action buffer and the
  // spirit's own interpretations. These receipts cannot authorize an effect.
  if (publicEvents) {
    sections.push("COMMITTED_PUBLIC_EVENTS_SINCE_REVIEW:");
    sections.push(JSON.stringify(publicEvents));
    sections.push("These are historical native receipts, not predictions or current-state guarantees. Pending actions have not completed. Spoken text contains only already-spoken slices; coalescing does not establish that an utterance is finished. Dropped or omitted receipts mean this history is incomplete, not that the world was quiet. Actor, room and target keys identify the historical participants, even if a name or entity slot changes. Use the separate issued current evidence for any intervention.");
    if (narrative) sections.push("Compare the progress window with the previous accepted review in simulated time. Repeated inspection is another attempt, not proof of another discovery; its contents are not available in the public action tape. Spoken claims establish what was said, not that their contents happened. Judge consequences from native outcomes and current evidence, while allowing useful work, rest and listening. These counts inform judgment; they are not a stagnation verdict or an intervention quota.");
    sections.push("");
  }

  // Current, field-scoped intervention authority remains separate.
  if (input.interventionEvidence) {
    sections.push("ISSUED_INTERVENTION_EVIDENCE:");
    sections.push(JSON.stringify(input.interventionEvidence));
    sections.push("For each intervention or nudge_character, cite 1–8 issued evidenceIds covering the facts it relies on. State, placement and description are separate observations; cite each relevant field. Missing or stale citations reject the suggestion. These observations are supervisor context, not proof the character knows them. Attributed reports establish only what was reported, not current physical facts or another character's knowledge. Use current physical observations for physical premises. If the needed evidence is absent, report uncertainty instead of intervening.");
    sections.push("");
  }

  if (input.recentEvents.length > 0) {
    sections.push("PRIOR SPIRIT INTERPRETATIONS (not native event receipts):");
    for (const event of input.recentEvents.slice(narrative ? -3 : -10)) {
      sections.push(`  - [${event.type}] ${event.content}`);
    }
    sections.push("");
  }

  // Domain-specific state
  if (spirit.definition.domain === "narrative" && spirit.narrativeState) {
    sections.push("=== NARRATIVE STATE (previous assessment, not evidence of progress) ===");
    sections.push(`Act: ${spirit.narrativeState.currentAct}`);
    sections.push(`Phase: ${spirit.narrativeState.currentPhase}`);
    sections.push(`Tension: ${(spirit.narrativeState.tension * 100).toFixed(0)}%`);

    if (spirit.narrativeState.plotThreads.length > 0) {
      sections.push("Plot Threads:");
      for (const thread of spirit.narrativeState.plotThreads) {
        sections.push(`  - ${thread.name} [${thread.status}]: ${thread.description}`);
      }
    }

    if (spirit.narrativeState.protagonists.length > 0) {
      sections.push(`Protagonists: ${spirit.narrativeState.protagonists.join(", ")}`);
    }
    if (spirit.narrativeState.antagonists.length > 0) {
      sections.push(`Antagonists: ${spirit.narrativeState.antagonists.join(", ")}`);
    }
    sections.push("");

    sections.push("Ground storyProse in the public receipts and issued current evidence above, using their exact names. Their participants' private minds are not public evidence. A prospective new person, place or mechanism requires a request to God and native construction before it exists.");
    sections.push("");

    // Add recent prose to prevent repetition
    if (spirit.narrativeState.recentProse && spirit.narrativeState.recentProse.length > 0) {
      sections.push("=== RECENT PROSE ===");
      for (const prose of spirit.narrativeState.recentProse.slice(-5)) {
        sections.push(`  - "${prose.slice(0, 100)}${prose.length > 100 ? '...' : ''}"`);
      }
      sections.push("");
      sections.push("Describe only changes supported by current events and state. Movement intent is not evidence of arrival.");
      sections.push("If nothing new is established, leave storyProse empty.");
      sections.push("");
    }
  }

  // Messages
  if (input.incomingMessages.length > 0) {
    sections.push("=== MESSAGES ===");
    for (const msg of input.incomingMessages) {
      sections.push(`From ${msg.senderLabel ?? `spirit:${msg.from}`} (${msg.type}): ${msg.subject}`);
      sections.push(`  ${msg.content}`);
    }
    sections.push("");
  }

  // Directives
  if (input.activeDirectives.length > 0) {
    sections.push("=== ACTIVE DIRECTIVES ===");
    for (const dir of input.activeDirectives) {
      sections.push(`- ${dir.description} [${dir.status}]`);
    }
    sections.push("");
  }

  // Instructions
  sections.push("=== YOUR TASK ===");
  sections.push("Observe the world and respond with your analysis in the following JSON format:");
  sections.push("");
  sections.push("```json");
  sections.push("{");
  sections.push('  "thoughts": "Your internal reasoning about what you observe",');
  sections.push('  "observations": [');
  sections.push('    {');
  sections.push('      "type": "action|dialogue|conflict|stagnation|emergence",');
  sections.push('      "content": "What you observed",');
  sections.push('      "entities": ["entity names involved"],');
  sections.push('      "significance": 0.0-1.0');
  sections.push('    }');
  sections.push('  ],');
  sections.push('  "reportToSuperior": {');
  sections.push('    "needed": true/false,');
  sections.push('    "subject": "Brief subject",');
  sections.push('    "content": "What to report",');
  sections.push('    "priority": "low|normal|high|urgent"');
  sections.push('  },');
  sections.push('  "intervention": {');
  sections.push('    "needed": true/false,');
  sections.push(input.physicalEffectPolicy?.restricted
    ? '    "type": "world_effect|inject_stimulus",' : '    "type": "inject_stimulus|modify_mood",');
  sections.push('    "target": "agent or room name",');
  sections.push('    "targetType": "agent|room",');
  sections.push('    "evidenceIds": ["issued observation ID"],');
  sections.push('    "content": "What to inject or change",');
  sections.push('    "reason": "Why this intervention"');
  sections.push('  },');

  if (spirit.definition.domain === "narrative") {
    sections.push('  "narrativeUpdate": {');
    sections.push('    "tension": 0.0-1.0,');
    sections.push('    "phase": "exposition|inciting|rising|crisis|climax|falling|resolution",');
    sections.push('    "newPlotThread": { "name": "", "description": "" },');
    sections.push('    "protagonists": ["names"],');
    sections.push('    "antagonists": ["names"]');
    sections.push('  },');
    sections.push('  "narrativeDirectives": [');
    sections.push('    {');
    sections.push('      "type": "nudge_character|resolve_thread|escalate|create_event|suggest_beat",');
    sections.push('      "target": "character name or thread name",');
    sections.push('      "action": "What should happen - be specific",');
    sections.push('      "evidenceIds": ["issued observation ID; required for nudge_character"],');
    sections.push('      "reason": "Why this advances the story"');
    sections.push('    }');
    sections.push('  ],');
    sections.push('  "storyProse": "Write 1-3 sentences of engaging narrative prose describing what just happened. Write it like a novel - vivid, immersive, showing not telling. Use present tense. If nothing interesting happened, leave empty string."');
  }

  sections.push("}");
  sections.push("```");
  if (!narrative && input.physicalEffectPolicy?.restricted) physicalPolicy();

  return sections.join("\n");
}

// =============================================================================
// NARRATIVE DEDUPLICATION
// =============================================================================

/**
 * Calculate similarity between new prose and recent prose entries.
 * Uses word overlap (Jaccard similarity) to detect repetition.
 * Returns max similarity score (0-1) against any recent prose.
 */
function calculateProseSimilarity(newProse: string, recentProse: string[]): number {
  if (recentProse.length === 0) return 0;

  // Tokenize and normalize
  const tokenize = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)  // Skip short words
    );
  };

  const newTokens = tokenize(newProse);
  if (newTokens.size === 0) return 0;

  let maxSimilarity = 0;

  for (const oldProse of recentProse) {
    const oldTokens = tokenize(oldProse);
    if (oldTokens.size === 0) continue;

    // Jaccard similarity: intersection / union
    const intersection = new Set([...newTokens].filter(x => oldTokens.has(x)));
    const union = new Set([...newTokens, ...oldTokens]);
    const similarity = intersection.size / union.size;

    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  return maxSimilarity;
}

// =============================================================================
// NARRATIVE GROUNDING VALIDATION
// =============================================================================

/**
 * Check if storyProse contains entities that don't exist in ECS
 * Returns cleaned prose and list of hallucinated terms
 */
function validateNarratorProse(
  prose: string,
  ecsSnapshot: EcsSnapshot
): { cleanedProse: string; hallucinations: string[] } {
  const hallucinations: string[] = [];
  let cleanedProse = prose;

  // Build set of valid names
  const validAgentNames = new Set(ecsSnapshot.agents.map(a => a.name.toLowerCase()));
  const validRoomNames = new Set(ecsSnapshot.rooms.map(r => r.name.toLowerCase()));
  const validObjectNames = new Set<string>();
  for (const room of ecsSnapshot.rooms) {
    if (room.objects) {
      for (const obj of room.objects) {
        validObjectNames.add(obj.toLowerCase());
      }
    }
  }

  // Common hallucinated creatures/items to check for
  const suspectTerms = [
    // Animals
    "wolf", "wolves", "bear", "bears", "deer", "bird", "birds", "snake", "fox", "rabbit",
    // Weapons
    "sword", "knife", "dagger", "spear", "bow", "arrow", "axe",
    // Instruments
    "lute", "flute", "harp", "drum", "guitar",
    // Items
    "torch", "lantern", "key", "book", "scroll", "potion", "gem",
    // Fictional entities
    "stranger", "figure", "shadow creature", "monster", "beast",
  ];

  for (const term of suspectTerms) {
    const regex = new RegExp(`\\b${term}s?\\b`, "gi");
    if (regex.test(prose)) {
      // Check if this term is a valid entity
      if (!validObjectNames.has(term.toLowerCase()) &&
          !validAgentNames.has(term.toLowerCase())) {
        hallucinations.push(term);
      }
    }
  }

  // Check for names that look like they could be hallucinated characters
  const namePattern = /\b[A-Z][a-z]+\b/g;
  const possibleNames = prose.match(namePattern) || [];
  for (const name of possibleNames) {
    const lower = name.toLowerCase();
    // Skip common words
    if (["the", "a", "an", "he", "she", "it", "they", "something", "someone"].includes(lower)) {
      continue;
    }
    if (!validAgentNames.has(lower) &&
        !validRoomNames.has(lower) &&
        !validObjectNames.has(lower)) {
      // Could be a hallucinated character name - check if it looks like one
      // Skip generic descriptive words
      const genericWords = [
        "morning", "evening", "afternoon", "night", "day", "sun", "moon",
        "wind", "breeze", "air", "sky", "ground", "earth", "water",
        "light", "dark", "shadow", "silence", "sound", "voice",
      ];
      if (!genericWords.includes(lower) && name.length > 2) {
        // This might be a hallucinated character - flag but don't remove
        // (could be a legitimate reference we missed)
      }
    }
  }

  return { cleanedProse, hallucinations };
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

function parseSpiritResponse(
  spirit: SpiritState,
  responseText: string,
  input: SpiritCognitionInput,
  nowMs = 0
): SpiritCognitionOutput {
  const output: SpiritCognitionOutput = {
    thoughts: "",
    observations: [],
    reports: [],
    interventions: [],
    directiveResponses: [],
  };

  try {
    // Extract JSON from response
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Spirit response must be a JSON object");

    // Extract thoughts
    output.thoughts = parsed.thoughts || "";

    // Extract observations
    if (parsed.observations && Array.isArray(parsed.observations)) {
      for (const obs of parsed.observations) {
        output.observations.push({
          id: `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          domain: spirit.definition.domain,
          type: obs.type as ObservationType || "action",
          content: obs.content || "",
          entities: obs.entities || [],
          location: obs.location,
          significance: obs.significance || 0.5,
        });
      }
    }

    // Extract report
    if (parsed.reportToSuperior?.needed) {
      const report: DivineMessage = {
        id: `msg_${Date.now()}`,
        timestamp: Date.now(),
        from: spirit.eid,
        to: spirit.superiorEid || -1,
        type: "report",
        domain: spirit.definition.domain,
        priority: parsed.reportToSuperior.priority || "normal",
        subject: parsed.reportToSuperior.subject || "Observation Report",
        content: parsed.reportToSuperior.content || "",
        requiresResponse: false,
      };
      output.reports.push(report);
    }

    // Extract intervention
    if (parsed.intervention?.needed && spirit.definition.canInjectEvents) {
      output.interventions.push({
        id: `int_${Date.now()}`,
        spiritEid: spirit.eid,
        timestamp: Date.now(),
        type: parsed.intervention.type || "inject_stimulus",
        target: {
          type: parsed.intervention.targetType || "room",
          name: parsed.intervention.target,
        },
        content: parsed.intervention.content || "",
        reason: parsed.intervention.reason || "",
        evidenceIds: parsed.intervention.evidenceIds,
      });
    }

    // Extract narrative update
    if (parsed.narrativeUpdate && spirit.narrativeState) {
      output.updatedNarrativeState = {};

      if (parsed.narrativeUpdate.tension !== undefined) {
        output.updatedNarrativeState.tension = parsed.narrativeUpdate.tension;
      }
      if (parsed.narrativeUpdate.phase) {
        output.updatedNarrativeState.currentPhase = parsed.narrativeUpdate.phase;
      }
      if (parsed.narrativeUpdate.protagonists) {
        output.updatedNarrativeState.protagonists = parsed.narrativeUpdate.protagonists;
      }
      if (parsed.narrativeUpdate.antagonists) {
        output.updatedNarrativeState.antagonists = parsed.narrativeUpdate.antagonists;
      }

      // New plot thread
      if (parsed.narrativeUpdate.newPlotThread?.name) {
        const newThread = {
          id: `plot_${Date.now()}`,
          name: parsed.narrativeUpdate.newPlotThread.name,
          description: parsed.narrativeUpdate.newPlotThread.description || "",
          participants: [],
          status: "setup" as const,
          tension: 0.3,
          events: [],
          startedAt: Date.now(),
        };

        if (!output.updatedNarrativeState.plotThreads) {
          output.updatedNarrativeState.plotThreads = [...(spirit.narrativeState?.plotThreads || [])];
        }
        output.updatedNarrativeState.plotThreads.push(newThread);
      }
    }

    // Process narrative directives - send to appropriate handlers via messaging
    if (parsed.narrativeDirectives && Array.isArray(parsed.narrativeDirectives)) {
      for (const directive of parsed.narrativeDirectives) {
        if (!directive.type || !directive.target) continue;

        console.log(`[Narrator] Directive: ${directive.type} -> ${directive.target}: ${directive.action}`);

        // Convert directive to appropriate message/intervention
        switch (directive.type) {
          case "nudge_character":
            // Create intervention to inject stimulus to character
            output.interventions.push({
              id: `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              spiritEid: spirit.eid,
              timestamp: Date.now(),
              type: "inject_stimulus",
              target: { type: "agent", name: directive.target },
              content: String(directive.action ?? ""),
              reason: directive.reason || "Story progression",
              evidenceIds: directive.evidenceIds,
            });
            break;

          case "resolve_thread":
          case "escalate":
          case "create_event":
          case "suggest_beat":
            {
              const directiveType = String(directive.type || "").toLowerCase();
              // The author's requests are the story's engine; never below normal
              // traffic, so God's autopilot reviews them before they expire.
              const priority: DivineMessage["priority"] = "high";
              const subject = `[NARRATIVE_DIRECTIVE:${directiveType}] ${directive.target}`;

              // Report to GodAI with specific suggestion
              output.reports.push({
                id: `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: Date.now(),
                from: spirit.eid,
                to: spirit.superiorEid || -1,
                type: "report",
                domain: "narrative",
                priority,
                subject,
                content: `Target: ${directive.target}\nAction: ${directive.action}\nReason: ${directive.reason}`,
                requiresResponse: false,
                data: {
                  source: "narrative_directive",
                  directiveType,
                  target: directive.target,
                  action: directive.action,
                  reason: directive.reason,
                },
              });
            }
            break;
        }
      }
    }

    if (spirit.definition.domain === "narrative") parseAuthorMoves(spirit, parsed, output, nowMs);

    // Extract story prose from narrative spirits - with validation and deduplication
    if (parsed.storyProse && typeof parsed.storyProse === "string" && parsed.storyProse.trim()) {
      const rawProse = parsed.storyProse.trim();

      // Validate narrator prose against ECS state
      const { cleanedProse, hallucinations } = validateNarratorProse(rawProse, input.ecsSnapshot);

      if (hallucinations.length > 0) {
        console.warn(`[Spirit] Narrator hallucinations detected: ${hallucinations.join(", ")}`);

        // Import and use consistency reporting if available
        try {
          recordIssue({
            id: `hal_${Date.now()}`,
            timestamp: Date.now(),
            severity: "medium",
            category: "narrative_drift",
            description: `Narrator mentioned non-existent entities: ${hallucinations.join(", ")}`,
            evidence: [rawProse.substring(0, 150)],
            affectedEntities: hallucinations,
            recommendation: `Ground narration in verified entities and events; do not create entities merely to justify prose.`,
            autoFixable: false,
          });
        } catch {
          // Consistency spirit not available
        }
      }

      // Check for prose similarity/repetition
      const recentProse = spirit.narrativeState?.recentProse || [];
      const similarity = calculateProseSimilarity(cleanedProse, recentProse);

      if (similarity > 0.6) {
        console.warn(`[Spirit] Narrative repetition detected (${(similarity * 100).toFixed(0)}% similar). Skipping prose.`);
        // Don't output repetitive prose
      } else {
        output.storyProse = cleanedProse;

        // Track this prose for future deduplication
        if (!output.updatedNarrativeState) {
          output.updatedNarrativeState = {};
        }
        const updatedRecentProse = [...recentProse, cleanedProse].slice(-10);
        output.updatedNarrativeState.recentProse = updatedRecentProse;
      }
    }

  } catch (error) {
    // Never apply a partially parsed response or acknowledge its input. The
    // cognition caller handles this as a failed cycle with empty effects.
    throw new Error("Invalid spirit response", { cause: error });
  }

  return output;
}

// =============================================================================
// OUTPUT PROCESSING
// =============================================================================

function processOutputs(
  spirit: SpiritState,
  output: SpiritCognitionOutput,
  world: World,
  spiritRegistry: SpiritRegistry,
  interventionScope: SpiritInterventionScope,
  interventionEvidence: SpiritInterventionEvidence,
  cycleScope: ReturnType<typeof captureSpiritCycleScope>,
  physicalEffects: ReturnType<typeof captureSpiritPhysicalEffects>
): void {
  // Add observations to spirit's history
  for (const obs of output.observations) {
    spirit.observations.push(obs);
    // Keep only recent observations
    if (spirit.observations.length > 100) {
      spirit.observations = spirit.observations.slice(-100);
    }
  }

  // Send reports
  for (const report of output.reports) {
    if (!cycleScope.isCurrent()) return;
    if (cycleScope.destination !== undefined) {
      sendMessage(
        spiritRegistry,
        spirit.eid,
        cycleScope.destination,
        "report",
        report.subject,
        report.content,
        { priority: report.priority, ...(report.data ? { data: report.data } : {}) }
      );
    }
  }

  // Execute interventions. At most one physical world event per review.
  const slot = { used: false };
  for (const intervention of output.interventions) {
    if (!cycleScope.isCurrent()) return;
    executeIntervention(intervention, world, spirit, interventionScope, interventionEvidence, physicalEffects, slot);
  }
  if (!cycleScope.isCurrent()) return;

  // Update narrative state
  if (output.updatedNarrativeState && spirit.narrativeState) {
    Object.assign(spirit.narrativeState, output.updatedNarrativeState);
  }

  // Update social state
  if (output.updatedSocialState && spirit.socialState) {
    Object.assign(spirit.socialState, output.updatedSocialState);
  }
}

function executeIntervention(
  intervention: Intervention,
  world: World,
  spirit: SpiritState,
  scope: SpiritInterventionScope,
  evidence: SpiritInterventionEvidence,
  physicalEffects: ReturnType<typeof captureSpiritPhysicalEffects>,
  slot: { used: boolean } = { used: false }
): void {
  // Narrative events (sound, arrival, lights, phone messages): the host resolves
  // exact targets when the event happens and issues the receipt. Only the
  // host-selected Narrator holds this grant; the world moving on during
  // inference does not void a story beat.
  if (intervention.type === "world_effect") {
    const operation = operationOf(intervention.content), host = getNarrativeHost(world);
    if (operation && host?.operations.includes(operation)) {
      if (host.narrator !== spirit || !spirit.definition.canInjectEvents) { intervention.result = "rejected_no_event_grant"; return; }
      if (slot.used) { intervention.result = "rejected_one_event_per_review"; return; }
      slot.used = true;
      const receipt = host.stage(intervention.content, "narrator");
      intervention.result = receipt.status; intervention.detail = receipt.detail;
      return;
    }
  }
  const advice = intervention.type === "inject_stimulus" && intervention.target.type === "agent";
  if (intervention.type !== "world_effect" && !advice && !physicalEffects.legacyAllowed()) {
    intervention.result = "rejected_physical_effect_policy"; return;
  }
  const binding = scope(intervention.target);
  if (!binding?.isCurrent()) { intervention.result = "stale_or_invalid_target"; return; }
  const ids = intervention.evidenceIds, cited = Array.isArray(ids) && ids.length > 0;
  // Whispers need only a present resident; any issued citations are honored.
  // A room-scoped effect without citations binds that place's own record.
  const evidenceCurrent = advice ? evidence.bindCited(ids).current
    : intervention.type === "world_effect" && !cited && intervention.target.type === "room" && intervention.target.name
      ? evidence.guardFor("place", intervention.target.name) : evidence.bind(ids);
  if (!evidenceCurrent?.()) { intervention.result = "stale_or_invalid_evidence"; return; }
  const isCurrent = () => binding.isCurrent() && evidenceCurrent();
  if (intervention.type === "world_effect") {
    const citedIds = cited ? ids as unknown[] : [];
    if (intervention.target.type !== "room" || cited && !evidence.records.some(record => record.kind === "place"
      && record.subject === intervention.target.name && citedIds.includes(record.id))) {
      intervention.result = "rejected_physical_effect_evidence"; return;
    }
    if (slot.used) { intervention.result = "rejected_one_event_per_review"; return; }
    const receipt = physicalEffects.execute(intervention.content, binding.eid, isCurrent);
    intervention.result = receipt.status; intervention.detail = receipt.detail;
    if (receipt.status === "applied") slot.used = true;
    return;
  }
  console.log(`[Spirit] ${spirit.definition.name} intervening: ${intervention.type} -> ${intervention.target.name}`);

  switch (intervention.type) {
    case "inject_stimulus": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      if (intervention.target.type === "room") {
        const roomEid = binding.eid;
        if (roomEid !== undefined) {
          broadcastToRoom(world, roomEid, {
            type: "environmental",
            content: intervention.content,
            source: "the world",
            modality: "visual",
          });
        }
      } else if (intervention.target.type === "agent") {
        intervention.result = nudgeNpc(world, targetName, {
          type: intervention.nudgeKind ?? "reflect", action: String(intervention.content), reason: intervention.reason,
          ...(spirit.definition.domain === "narrative" ? { priority: "high" as const } : {}),
        }, isCurrent) ? "accepted" : "rejected";
        return; // Accepted advice is not proof of delivery or an executed action.
      }
      break;
    }

    case "modify_mood": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      const agentEid = intervention.target.type === "agent" ? binding.eid : undefined;
      if (agentEid !== undefined) {
        // Parse content for arousal value
        const arousalMatch = intervention.content.match(/arousal[:\s]+(\d+\.?\d*)/i);
        if (arousalMatch) {
          Mind.arousal[agentEid] = parseFloat(arousalMatch[1]);
        }
      }
      break;
    }
  }

  intervention.result = "executed";
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a summary of a spirit's current understanding
 */
export function getSpiritSummary(spirit: SpiritState): string {
  const lines: string[] = [];

  lines.push(`=== ${spirit.definition.name} (${spirit.definition.domain}) ===`);
  lines.push(`Rank: ${spirit.definition.rank}`);
  lines.push(`Observations: ${spirit.observations.length}`);
  lines.push(`Significant Events: ${spirit.significantEvents.length}`);

  if (spirit.narrativeState) {
    lines.push("");
    lines.push("Narrative State:");
    lines.push(`  Act ${spirit.narrativeState.currentAct}, Phase: ${spirit.narrativeState.currentPhase}`);
    lines.push(`  Tension: ${(spirit.narrativeState.tension * 100).toFixed(0)}%`);
    lines.push(`  Plot Threads: ${spirit.narrativeState.plotThreads.length}`);
  }

  if (spirit.shortTermMemory.length > 0) {
    lines.push("");
    lines.push("Recent Thoughts:");
    for (const thought of spirit.shortTermMemory.slice(-3)) {
      lines.push(`  "${thought.slice(0, 100)}..."`);
    }
  }

  return lines.join("\n");
}
