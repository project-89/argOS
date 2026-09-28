/** Operator control of one body (Inhabit mode): request shapes, the mapping of
 * control verbs onto native actions, and what the body actually heard. Control
 * is ECS-grounded (ecs/controlled.ts); every act still goes through the same
 * native executor and admission checks any resident's choice does. */
import { z } from "zod";
import type { World } from "../ecs/world";
import { getSocialDialogue, getSocialSpeechFragments } from "../cognition/social-memory";
import type { SpatialControlView } from "./spatial-contract";

const key = z.string().min(1).max(180);
const line = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const coordinate = z.number().finite().min(-10_000).max(10_000);

export const controlVisitorSchema = z.object({ name: line(40).refine(s => /^[\p{L}\p{N} .'-]+$/u.test(s)).optional(),
  persona: line(1200).optional() }).strict();
export const controlTakeSchema = z.object({ actorKey: key }).strict();
export const controlWalkSchema = z.union([
  z.object({ x: coordinate, y: coordinate }).strict(),
  z.object({ dx: coordinate, dy: coordinate }).strict().refine(v => Math.hypot(v.dx, v.dy) > 1e-6, "A direction needs length"),
]);
export const controlActSchema = z.object({ type: z.string().trim().min(1).max(40).regex(/^[a-z_]+$/), targetKey: key.optional(),
  content: line(500).optional() }).strict();
export const controlSaySchema = z.object({ text: line(500), targetKey: key.optional() }).strict();

/** The distance within which things are offered for interaction (E). */
export const CONTROL_NEARBY_METRES = 3;
/** One WASD/stick step. */
export const CONTROL_STEP_METRES = 1.2;
export const VISITOR_LIMIT = 4;
export const DEFAULT_VISITOR_PERSONA = "You are a visitor passing through: a stranger to everyone here, curious and observant, with no history in this place.";

/** Object/story verbs are native `interact` operations; carrying and moving
 * have their own native action types. Anything else is refused up front. */
const INTERACT_VERBS = new Set(["sit", "eat", "open", "close", "read", "give", "show", "put", "hide", "knock", "write_note",
  "examine", "inspect", "read_phone", "reply", "clear_branches", "isolate", "install", "power_on"]);
export function nativeControlAction(input: { type: string; content?: string }): { type: string; content?: string } {
  const type = input.type === "take" || input.type === "pick_up" ? "pickup" : input.type === "say" || input.type === "talk" ? "speak" : input.type;
  if (["move", "pickup", "drop", "observe", "wait"].includes(type)) return { type, ...(input.content ? { content: input.content } : {}) };
  if (type === "speak") {
    if (!input.content) throw Error("Speech needs words");
    return { type, content: input.content };
  }
  if (INTERACT_VERBS.has(type)) return { type: "interact", content: input.content ? `${type} ${input.content}` : type };
  throw Error(`Unknown action "${input.type}"`);
}

/** Speech this body really heard (complete turns and still-arriving excerpts),
 * from its own social memory. Newest last. Its own lines are not "heard". */
export function projectHeardSpeech(world: World, eid: number, limit = 20): SpatialControlView["heard"] {
  const turns = getSocialDialogue(world, eid).filter(turn => !turn.own).map(turn => ({ id: turn.id, speaker: turn.speaker,
    text: turn.content, atSimMs: turn.simulation?.completedAtSimMs ?? turn.atSimMs ?? 0 }));
  const partial = getSocialSpeechFragments(world, eid).filter(row => !row.own && !row.historical && row.content.trim())
    .map(row => ({ id: row.id, speaker: row.speaker, text: row.content.trim(), atSimMs: row.heardAtSimMs }));
  return [...turns, ...partial].sort((a, b) => a.atSimMs - b.atSimMs).slice(-limit);
}
