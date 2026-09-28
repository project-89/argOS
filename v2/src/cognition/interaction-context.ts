/** Source-bound conversation context for memory extraction. Never use the room's
 * global transcript: only the remembering actor's actually delivered turns. */
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { legacySimulationTimestamp } from "../ecs/temporal-age";
import { getSocialDialogue, type SocialDialogueTurn } from "./social-memory";
import type { NarrativeEvidence } from "./narrative-memory";

export interface RememberedInteraction {
  type: string;
  content: string;
  otherParty?: string;
  context: string;
  perspective?: "own_speech" | "heard_speech" | "own_action" | "observation" | "private_thought";
  speaker?: string;
  /** Exact actor-owned completed speech receipt, supplied by the executor. */
  speechId?: string;
}

export interface InteractionContext {
  sourceId?: string;
  sourceSpeaker?: string;
  sourceAtSimMs: number;
  antecedents: NarrativeEvidence[];
}

/** Undefined rejects a supplied false receipt. Missing receipt is legacy input,
 * not authority to look up other people's conversation or guess a source ID. */
export function captureInteractionContext(world: World, eid: number, input: RememberedInteraction): InteractionContext | undefined {
  const now = readSimulationTime(world);
  if (input.speechId === undefined) return { sourceAtSimMs: now, antecedents: [] };
  const turns = getSocialDialogue(world, eid), index = turns.findIndex(t => t.id === input.speechId);
  const anchor = turns[index];
  const own = input.perspective === "own_speech", heard = input.perspective === "heard_speech";
  if (!anchor || !(own || heard) || anchor.own !== own || (input.speaker && input.speaker !== anchor.speaker)
    || anchor.content !== input.content.trim()) return;
  const at = (t: SocialDialogueTurn) => t.simulation?.completedAtSimMs ?? t.atSimMs ?? legacySimulationTimestamp(world, t.atMs);
  const sourceAtSimMs = at(anchor);
  if (!Number.isFinite(sourceAtSimMs) || sourceAtSimMs < 0 || sourceAtSimMs > now) return;
  // A local, temporally continuous window, not a semantic claim that all these
  // statements concern the same subject. Older references may remain unknown.
  const preceding: SocialDialogueTurn[] = [];
  let nextAt = sourceAtSimMs;
  for (let i = index - 1; i >= 0 && preceding.length < 6; i--) {
    const turn = turns[i], time = at(turn);
    if (turn.room !== anchor.room || !Number.isFinite(time) || time < 0 || time > nextAt
      || nextAt - time > 60_000 || sourceAtSimMs - time > 120_000) break;
    preceding.unshift(turn); nextAt = time;
  }
  return { sourceId: anchor.id, sourceSpeaker: anchor.speaker, sourceAtSimMs, antecedents: preceding.map(turn => ({
    id: turn.id, kind: "dialogue", role: "context",
    content: JSON.stringify({ speaker: turn.speaker, target: turn.target, words: turn.content,
      perspective: turn.own ? "own_speech" : "heard_speech", room: turn.room }), atSimMs: at(turn),
  })) };
}
