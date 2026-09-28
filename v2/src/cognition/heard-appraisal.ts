/** Salience selection rides the existing foreground decision. Only exact,
 * personally heard complete turns can enter the private appraisal lane. No
 * keyword classifier, forced reaction, or model call for every room utterance. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { legacySimulationTimestamp } from "../ecs/temporal-age";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSocialDialogue } from "./social-memory";
import { canQueueExperiencedEvents, hasQueuedExperience, queueExperiencedEvent, type ExperiencedEvent } from "./experience-appraisal";

const enabled = (world: World) => (world.meta.experienceReconsideration === true || world.meta.narrativeMind === true) && world.meta.experienceAppraisalEnabled !== false;
export function captureHeardAppraisal(world: World, eid: number) {
  const source = getCommittedEvents(world).sourceId, owner = WorkingMemoryIdentity.id[eid];
  const candidates = enabled(world) ? getSocialDialogue(world, eid).filter(t => !t.own
    && !hasQueuedExperience(world, eid, t.id)).slice(-12) : [];
  const receipts = new Map(candidates.map(t => [t.id, Object.freeze({ id: t.id, channel: "heard-speech",
    source: `personally heard ${t.speaker}`.slice(0, 240), content: JSON.stringify({ speaker: t.speaker, target: t.target,
      establishes: "speaker_said_these_words", words: t.content }),
    atSimMs: t.simulation?.completedAtSimMs ?? t.atSimMs ?? legacySimulationTimestamp(world, t.atMs) }) satisfies ExperiencedEvent] as const)
    .filter(([, receipt]) => canQueueExperiencedEvents(world, eid, [receipt])));
  const basis = new Map(candidates.map(t => [t.id, JSON.stringify(t)]));
  return { world, eid, source, owner, receipts, basis,
    prompt: receipts.size ? `- appraiseSpeechIds: up to 3 exact IDs from ${JSON.stringify([...receipts.keys()])}.
  Select heard words that materially affect your motives, relationships or understanding for private appraisal.
  Ordinary conversation need not be selected. This schedules reflection, not an action or a duty to help;
  the speaker's words remain a claim. Omit when nothing warrants reconsideration.` : "" };
}
export function prepareHeardAppraisal(context: ReturnType<typeof captureHeardAppraisal>, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 3 || new Set(input).size !== input.length
    || input.some(id => typeof id !== "string" || !context.receipts.has(id))) return;
  const ids = [...input] as string[], { world, eid } = context;
  const receipts = ids.map(id => context.receipts.get(id)!).sort((a, b) => a.atSimMs - b.atSimMs);
  let consumed = false;
  const current = () => !consumed && enabled(world) && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === context.source && entityExists(world, eid)
    && hasComponent(world, eid, Agent) && Agent.active[eid] && WorkingMemoryIdentity.id[eid] === context.owner
    && ids.every(id => getSocialDialogue(world, eid).some(t => !t.own && t.id === id && JSON.stringify(t) === context.basis.get(id)))
    && receipts.every(r => r.atSimMs <= readSimulationTime(world)) && canQueueExperiencedEvents(world, eid, receipts);
  if (!current()) return;
  return { ids, current, commit() {
    if (!current()) return false;
    consumed = true;
    for (const receipt of receipts) queueExperiencedEvent(world, eid, receipt);
    return true;
  } };
}
