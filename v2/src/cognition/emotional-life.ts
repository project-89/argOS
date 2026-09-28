/** Meaning persists; activation changes over simulation time. These are small
 * simulation laws, not a clinical model or a policy that compels an action. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, hasComponent, query } from "bitecs";
import { z } from "zod";
import type { World } from "../ecs/world";
import { Agent, EmotionalLife, EmotionalDynamics, Mind, WorkingMemoryIdentity } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "./working-memory";

const text = (limit: number) => z.string().trim().min(1).max(limit).refine(s => !/[\u0000-\u001f\u007f]/u.test(s));
export const emotionalEpisodeSchema = z.object({ episodeId: text(160), thread: text(120),
  meaning: text(700), feelings: z.array(z.object({ feeling: text(50), strength: z.number().finite().min(0).max(1) }).strict()).min(1).max(4),
  desires: z.array(text(180)).max(4), activation: z.number().finite().min(0).max(1),
  stance: z.enum(["open", "settled"]) }).strict();
export type EmotionalEpisodeUpdate = z.infer<typeof emotionalEpisodeSchema>;
export interface EmotionalEpisode extends Omit<EmotionalEpisodeUpdate, "episodeId"> {
  id: string; evidenceIds: string[]; createdAtSimMs: number; updatedAtSimMs: number;
}
export const EMOTION_BASELINE = .2, EMOTION_HALF_LIFE_MS = 60_000;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const actor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
  && hasComponent(world, eid, WorkingMemoryIdentity) && !!WorkingMemoryIdentity.id[eid];
export function getEmotionalEpisodes(world: World, eid: number): EmotionalEpisode[] {
  if (!actor(world, eid) || !hasComponent(world, eid, EmotionalLife) || EmotionalLife.ownerKey[eid] !== WorkingMemoryIdentity.id[eid]) return [];
  try {
    const values = JSON.parse(EmotionalLife.episodesJson[eid] || "[]");
    return Array.isArray(values) ? values.filter(row => row && emotionalEpisodeSchema.safeParse({ episodeId: row.id, thread: row.thread,
      meaning: row.meaning, feelings: row.feelings, desires: row.desires, activation: row.activation, stance: row.stance }).success
      && Array.isArray(row.evidenceIds) && row.evidenceIds.length <= 32 && row.evidenceIds.every((id: unknown) => typeof id === "string")
      && Number.isFinite(row.createdAtSimMs) && row.createdAtSimMs >= 0 && Number.isFinite(row.updatedAtSimMs) && row.updatedAtSimMs >= row.createdAtSimMs).slice(-12) : [];
  } catch { return []; }
}
/** Stable semantic basis: clock-driven recovery must not discard in-flight
 * thought or appraisal on every tick. Explicit meaning changes still do. */
export function emotionalLifeBasis(world: World, eid: number): string { return JSON.stringify(getEmotionalEpisodes(world, eid)); }
export function emotionalActivation(world: World, eid: number): number {
  if (!actor(world, eid) || !hasComponent(world, eid, EmotionalDynamics) || EmotionalDynamics.ownerKey[eid] !== WorkingMemoryIdentity.id[eid])
    return clamp(Number.isFinite(Mind.arousal[eid]) ? Mind.arousal[eid] : EMOTION_BASELINE);
  const level = EmotionalDynamics.anchorLevel[eid], at = EmotionalDynamics.anchorAtSimMs[eid];
  if (!Number.isFinite(level) || !Number.isFinite(at) || at < 0) return EMOTION_BASELINE;
  return clamp(EMOTION_BASELINE + (clamp(level) - EMOTION_BASELINE) * Math.pow(.5, Math.max(0, readSimulationTime(world) - at) / EMOTION_HALF_LIFE_MS));
}
export function setEmotionalActivation(world: World, eid: number, level: number): void {
  assertSimulationTaskActive(); if (!world.meta.narrativeMind || !actor(world, eid) || getCommittedEvents(world).stopped || !Number.isFinite(level)) return;
  addComponent(world, eid, EmotionalDynamics); EmotionalDynamics.ownerKey[eid] = WorkingMemoryIdentity.id[eid];
  EmotionalDynamics.anchorLevel[eid] = clamp(level); EmotionalDynamics.anchorAtSimMs[eid] = readSimulationTime(world);
  if (hasComponent(world, eid, Mind)) Mind.arousal[eid] = clamp(level);
}
export function nudgeEmotionalActivation(world: World, eid: number, amount: number): void {
  if (Number.isFinite(amount)) setEmotionalActivation(world, eid, emotionalActivation(world, eid) + amount);
}
export function runEmotionalDynamics(world: World): void {
  assertSimulationTaskActive(); if (!world.meta.narrativeMind || getCommittedEvents(world).stopped) return;
  for (const eid of query(world, [Agent, Mind])) {
    if (!Agent.active[eid] || !workingMemoryEntityRef(world, eid)) continue;
    if (!hasComponent(world, eid, EmotionalDynamics) || EmotionalDynamics.ownerKey[eid] !== WorkingMemoryIdentity.id[eid])
      setEmotionalActivation(world, eid, Number.isFinite(Mind.arousal[eid]) ? Mind.arousal[eid] : EMOTION_BASELINE);
    // A stable anchor makes one accelerated minute identical to 120 half-second
    // steps. No forgiveness, goal retirement, facial change or LLM call here.
    Mind.arousal[eid] = emotionalActivation(world, eid);
  }
}
export function prepareEmotionalEpisode(world: World, eid: number, input: unknown, evidenceIds: readonly string[]) {
  const parsed = emotionalEpisodeSchema.safeParse(input), source = getCommittedEvents(world).sourceId, owner = WorkingMemoryIdentity.id[eid];
  if (!world.meta.narrativeMind || !actor(world, eid) || !parsed.success || !evidenceIds.length || evidenceIds.length > 8
    || evidenceIds.some(id => typeof id !== "string" || !id || id.length > 200)) return;
  const sources = [...evidenceIds];
  const existing = getEmotionalEpisodes(world, eid), proposal = parsed.data, previous = existing.find(e => e.id === proposal.episodeId);
  if (proposal.episodeId !== "new" && !previous) return;
  // At capacity the model can revise a thread or settle one first. Do not
  // silently erase a still-open experience to make space for another one.
  if (!previous && existing.length >= 12 && !existing.some(e => e.stance === "settled")) return;
  const basis = emotionalLifeBasis(world, eid), id = previous?.id ?? `episode:${randomUUID()}`;
  let consumed = false;
  const current = () => !consumed && world.meta.narrativeMind === true && actor(world, eid) && WorkingMemoryIdentity.id[eid] === owner
    && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === source && emotionalLifeBasis(world, eid) === basis;
  if (!current()) return;
  return { id, current, commit() {
    assertSimulationTaskActive(); if (!current()) return false; consumed = true;
    const now = readSimulationTime(world), { episodeId: _, ...fields } = proposal;
    const row: EmotionalEpisode = { ...fields, id, evidenceIds: [...new Set([...(previous?.evidenceIds ?? []), ...sources])].slice(-32),
      createdAtSimMs: previous?.createdAtSimMs ?? now, updatedAtSimMs: now };
    let next = existing.filter(e => e.id !== id);
    if (next.length >= 12) { const retired = next.find(e => e.stance === "settled")!; next = next.filter(e => e.id !== retired.id); }
    addComponent(world, eid, EmotionalLife); EmotionalLife.ownerKey[eid] = owner;
    EmotionalLife.episodesJson[eid] = JSON.stringify([...next, row]); EmotionalLife.revision[eid] = (EmotionalLife.revision[eid] || 0) + 1;
    setEmotionalActivation(world, eid, proposal.activation);
    return true;
  } };
}
export function formatEmotionalLife(world: World, eid: number): string {
  if (!world.meta.narrativeMind) return "";
  const episodes = getEmotionalEpisodes(world, eid);
  return `YOUR INNER LIFE:\n`
    + `Emotional charge: ${emotionalActivation(world, eid).toFixed(2)}.\n`
    + episodes.map(e => JSON.stringify({ episodeId: e.id, thread: e.thread, meaning: e.meaning, lastAppraisedFeelings: e.feelings, desires: e.desires, stance: e.stance })).join("\n");
}
export const NARRATIVE_SELECTION_INSTRUCTION = `Your inner life is real and it drives you. Longing, suspicion, guilt, pride, fear, affection and curiosity should shape what you do and how you say it. A feeling doesn't have to become a task — but when it pulls you toward someone or something, follow it. Give your innerThought in your own private voice: what you actually think, not a report of your action. Draw on the past you remember.`;
export const NARRATIVE_APPRAISAL_INSTRUCTION = `Write a first-person inner monologue in this character's own voice: what just happened means to them, how it lands against what they want, fear and are hiding, and what it stirs. Let contradictions live side by side. When it matters, create or revise one emotionalEpisode: reuse an existing episodeId for the same thread of meaning, or "new". Its desires are felt pulls — what the character now wants to do, say, find out or keep hidden. Settled means the feeling has settled, not that the situation is solved. Ordinary moments may need no episode. Stay true to what this character actually experienced; other people's claims can be believed, doubted or feared.`;
