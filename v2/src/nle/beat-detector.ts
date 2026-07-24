/**
 * Beat Detector — Event-Driven Narrative Advancement
 *
 * Subscribes to the chronicle event stream and detects when
 * dramatic beats are triggered by world events. No polling —
 * beats fire the moment the matching event occurs.
 *
 * Detection methods:
 *   - Keyword matching against beat trigger conditions
 *   - NPC involvement checking (did the right character act?)
 *   - Location awareness (did it happen in the right place?)
 *   - LLM semantic matching for ambiguous triggers
 *
 * When a beat triggers, the detector:
 *   1. Marks it in the scaffold
 *   2. Notifies the NarrativeDirector to advance the story
 *   3. Fires any registered callbacks (for DM narration, logging)
 */

import { chronicle, type ChronicleEntry } from "../cognition/simulation-chronicle";
import {
  getStoryScaffold,
  updateStoryScaffold,
  type StoryScaffoldData,
  type DramaticBeat,
  type NarrativeTension,
} from "./story-scaffold";
import type { World } from "../ecs/world";

// =============================================================================
// TYPES
// =============================================================================

export type BeatCallback = (tension: NarrativeTension, beat: DramaticBeat, triggerEvent: ChronicleEntry) => void;

// =============================================================================
// STATE
// =============================================================================

let world: World | null = null;
let unsubscribe: (() => void) | null = null;
const beatCallbacks: BeatCallback[] = [];

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Start listening for beat triggers on the chronicle event stream.
 * Call once after the story scaffold is created.
 */
export function startBeatDetection(w: World): void {
  world = w;

  // Unsubscribe any previous listener
  if (unsubscribe) unsubscribe();

  unsubscribe = chronicle.subscribe((entry) => {
    if (!world) return;
    checkBeatTriggers(entry);
  });

  console.log(`[NLE] Beat detection started — listening for story triggers`);
}

/**
 * Register a callback for when a beat is triggered.
 * Used by the DM to narrate beat moments and by the NarrativeDirector to advance.
 */
export function onBeatTriggered(callback: BeatCallback): void {
  beatCallbacks.push(callback);
}

/**
 * Stop listening.
 */
export function stopBeatDetection(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  world = null;
}

// =============================================================================
// BEAT TRIGGER CHECKING
// =============================================================================

/** Relevant event types that could trigger narrative beats */
const TRIGGER_EVENT_TYPES = new Set([
  "action_success",
  "autonomous_goal",
  "conversation",
  "world_mutation",
  "crisis_event",
  "phase_change",
  "llm_decision",
  "policy_decision",
]);

function checkBeatTriggers(entry: ChronicleEntry): void {
  if (!world) return;
  if (!TRIGGER_EVENT_TYPES.has(entry.type)) return;

  const scaffold = getStoryScaffold(world);
  if (!scaffold) return;

  for (const tension of scaffold.tensions) {
    if (tension.status !== "active") continue;

    for (const beat of tension.beats) {
      if (beat.status !== "pending") continue;

      if (matchesTrigger(entry, beat, tension)) {
        triggerBeat(scaffold, tension, beat, entry);
        return; // One beat per event
      }
    }
  }
}

/**
 * Check if a chronicle event matches a beat's trigger condition.
 * Uses keyword matching + NPC involvement + location awareness.
 */
function matchesTrigger(
  entry: ChronicleEntry,
  beat: DramaticBeat,
  tension: NarrativeTension,
): boolean {
  const trigger = beat.triggerCondition.toLowerCase();
  const data = entry.data || {};
  const summary = (entry.summary || "").toLowerCase();
  const agent = String(data.agent || data.actor || "").toLowerCase();
  const action = String(data.action || "").toLowerCase();
  const target = String(data.target || "").toLowerCase();
  const content = String(data.content || data.description || data.goal || "").toLowerCase();

  // Extract keywords from trigger condition (words > 3 chars, not common words)
  const stopWords = new Set(["the", "and", "that", "with", "from", "this", "have", "will", "been", "they", "their", "when", "what", "about", "into", "over", "after", "before"]);
  const triggerKeywords = trigger
    .split(/\W+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  if (triggerKeywords.length === 0) return false;

  // Build a searchable string from the event
  const eventText = `${summary} ${agent} ${action} ${target} ${content}`.toLowerCase();

  // Check keyword overlap
  const matchedKeywords = triggerKeywords.filter(kw => eventText.includes(kw));
  const matchRatio = matchedKeywords.length / triggerKeywords.length;

  // Check if involved NPCs participated
  const involvedNpcs = tension.involvedNpcs.map(n => n.toLowerCase());
  const npcInvolved = involvedNpcs.some(npc =>
    agent.includes(npc) || target.includes(npc) || content.includes(npc));

  // Trigger thresholds:
  // - 50%+ keyword match AND an involved NPC acted → trigger
  // - 70%+ keyword match even without NPC → trigger (environmental events)
  // - Movement to a location mentioned in the trigger → possible trigger
  if (matchRatio >= 0.5 && npcInvolved) return true;
  if (matchRatio >= 0.7) return true;

  // Special case: player enters a location mentioned in the trigger
  if (entry.type === "action_success" && action.includes("move")) {
    const location = String(data.to || data.target || "").toLowerCase();
    if (trigger.includes(location) && location.length > 3) return true;
  }

  // Special case: conversation about a topic in the trigger
  if (entry.type === "conversation" || action.includes("speak")) {
    if (matchRatio >= 0.3 && npcInvolved) return true;
  }

  return false;
}

// =============================================================================
// BEAT TRIGGERING
// =============================================================================

function triggerBeat(
  scaffold: StoryScaffoldData,
  tension: NarrativeTension,
  beat: DramaticBeat,
  event: ChronicleEntry,
): void {
  beat.status = "triggered";

  console.log(`[NLE] ★ Beat triggered: "${beat.description.slice(0, 60)}..." (${beat.act})`);
  console.log(`[NLE]   Triggered by: ${event.type} — ${event.summary || ""}`);

  // Advance act based on beat progression
  const triggeredCount = tension.beats.filter(b => b.status !== "pending").length;
  const totalBeats = tension.beats.length;

  if (beat.act === "setup" && scaffold.currentAct === "setup") {
    // First beat triggered — story is underway
  }
  if (beat.act === "escalation" && scaffold.currentAct === "setup") {
    scaffold.currentAct = "escalation";
    console.log(`[NLE] Act advanced: setup → escalation`);
  }
  if (beat.act === "crisis" && scaffold.currentAct !== "crisis") {
    scaffold.currentAct = "crisis";
    console.log(`[NLE] Act advanced: → crisis`);
  }
  if (beat.act === "resolution") {
    scaffold.currentAct = "resolution";
    tension.status = "resolved";
    console.log(`[NLE] Tension resolved: "${tension.description.slice(0, 50)}..."`);
  }

  // Record adaptation
  scaffold.adaptations.push(
    `[${new Date().toISOString()}] Beat "${beat.id}" triggered by ${event.type}: ${event.summary || ""}`
  );

  // Update scaffold in ECS
  if (world) updateStoryScaffold(world, scaffold);

  // Notify callbacks
  for (const cb of beatCallbacks) {
    try { cb(tension, beat, event); } catch {}
  }

  // Record in chronicle
  chronicle.record("crisis_event", {
    name: `Beat: ${beat.description.slice(0, 50)}`,
    act: beat.act,
    tension: tension.description.slice(0, 50),
    trigger: event.type,
  });
}
