import type { SitcomFrame } from "./sitcom-report";

export interface SitcomSegment {
  version: number; sourceId: string; sourceStartSimMs: number; sourceEndSimMs: number; prompt?: string;
  performance?: { clock?: "realtime"; durationMs: number; sourceMap: readonly { mediaMs: number; sourceMs: number }[] };
}
export interface SitcomChunk { chunk_index: number; playback_seconds: number; prompt_version: number }
export type SitcomPlayhead = { state: "mapped" | "held"; sourceMs: number; version: number; sourceRate: number; reason?: string }
  | { state: "buffering" | "unmapped"; reason: string };

/** New segments carry an editorial clock chosen before prompting. Provider
 * metadata selects that immutable performance, not a new after-the-fact retime.
 * Historical segments without a map keep their legacy linear playback. Missing
 * or repeated versions never invent another source interval. */
export class SitcomPlayback {
  private segments = new Map<number, SitcomSegment>();
  private chunks = new Map<number, SitcomChunk>();
  register(segment: SitcomSegment): boolean {
    if (!Number.isInteger(segment.version) || segment.version < 1 || !segment.sourceId ||
      !Number.isFinite(segment.sourceStartSimMs) || !Number.isFinite(segment.sourceEndSimMs) ||
      segment.sourceStartSimMs < 0 || segment.sourceEndSimMs <= segment.sourceStartSimMs) return false;
    const map = segment.performance?.sourceMap, duration = segment.performance?.durationMs;
    if(segment.performance?.clock==="realtime" && (Math.abs(segment.sourceEndSimMs-segment.sourceStartSimMs-duration!)>.000001
      || !Array.isArray(map) || map.some(p=>Math.abs(p.sourceMs-segment.sourceStartSimMs-p.mediaMs)>.000001)))return false;
    if (segment.performance && (!Number.isFinite(duration) || duration! < 1000 || duration! > 30000 || !Array.isArray(map) || map.length < 2 || map.length > 4096
      || map[0].mediaMs !== 0 || map[0].sourceMs !== segment.sourceStartSimMs || map.at(-1)!.mediaMs !== duration
      || map.at(-1)!.sourceMs !== segment.sourceEndSimMs || map.some((p, i) => !Number.isFinite(p.mediaMs) || !Number.isFinite(p.sourceMs)
        || p.sourceMs < segment.sourceStartSimMs || p.sourceMs > segment.sourceEndSimMs
        || i > 0 && (p.mediaMs <= map[i - 1].mediaMs || p.sourceMs < map[i - 1].sourceMs)))) return false;
    const prior = this.segments.get(segment.version);
    if (prior) return prior.sourceId === segment.sourceId && prior.sourceStartSimMs === segment.sourceStartSimMs && prior.sourceEndSimMs === segment.sourceEndSimMs
      && JSON.stringify(prior.performance) === JSON.stringify(segment.performance);
    if (this.segments.size >= 1024) return false;
    this.segments.set(segment.version, Object.freeze({ ...segment, ...(segment.performance ? { performance: Object.freeze({ ...(segment.performance.clock?{clock:segment.performance.clock}:{}),durationMs: duration!, sourceMap: Object.freeze(map!.map(p => Object.freeze({ ...p }))) }) } : {}) })); return true;
  }
  add(chunk: SitcomChunk): boolean {
    if (!Number.isInteger(chunk.chunk_index) || chunk.chunk_index < 0 || chunk.chunk_index >= 1024 ||
      !Number.isInteger(chunk.prompt_version) || chunk.prompt_version < 1 ||
      !Number.isFinite(chunk.playback_seconds) || chunk.playback_seconds <= 0 || chunk.playback_seconds > 30 || this.chunks.has(chunk.chunk_index)) return false;
    this.chunks.set(chunk.chunk_index, Object.freeze({ chunk_index: chunk.chunk_index, playback_seconds: chunk.playback_seconds, prompt_version: chunk.prompt_version })); return true;
  }
  snapshot(): SitcomChunk[] { return [...this.chunks.values()].sort((a, b) => a.chunk_index - b.chunk_index).map(c => ({ ...c })); }
  issued(): SitcomSegment[] { return [...this.segments.values()].map(({ prompt: _prompt, ...s }) => ({ ...s })); }
  at(seconds: number): SitcomPlayhead {
    if (!Number.isFinite(seconds) || seconds < 0) return { state: "unmapped", reason: "invalid_playhead" };
    let begin = 0, previous: SitcomSegment | undefined;
    for (let index = 0; index < 1024; index++) {
      const chunk = this.chunks.get(index);
      if (!chunk) return { state: "buffering", reason: "awaiting_gap_free_chunk_metadata" };
      const end = begin + chunk.playback_seconds, segment = this.segments.get(chunk.prompt_version);
      if (!segment) return { state: "unmapped", reason: "unknown_prompt_version" };
      const repeated = previous?.version === segment.version;
      if (previous && !repeated && (segment.sourceId !== previous.sourceId || segment.sourceStartSimMs !== previous.sourceEndSimMs))
        return { state: "unmapped", reason: "source_discontinuity" };
      if (seconds < end) {
        if(segment.performance?.clock==="realtime") {
          if(repeated)return {state:"unmapped",reason:"provider_repeated_realtime_performance"};
          if(Math.abs(chunk.playback_seconds*1000-segment.performance.durationMs)>1)
            return {state:"unmapped",reason:"realtime_chunk_duration_mismatch"};
        }
        if (repeated) return { state: "held", sourceMs: segment.sourceEndSimMs, version: segment.version, sourceRate: 0, reason: "provider_repeated_prior_prompt" };
        if (segment.performance) {
          const plan = segment.performance, elapsed = (seconds - begin) * 1000;
          // The issued choreography has a clock already. Do not silently fix a
          // mismatched performance by stretching the audience's source clock.
          if (chunk.playback_seconds * 1000 + 250 < plan.durationMs)
            return { state: "unmapped", reason: "provider_chunk_shorter_than_performance" };
          if (elapsed >= plan.durationMs) return { state: "held", sourceMs: segment.sourceEndSimMs, version: segment.version, sourceRate: 0, reason: "performance_ending_hold" };
          for (let i = 1; i < plan.sourceMap.length; i++) {
            const before = plan.sourceMap[i - 1], after = plan.sourceMap[i];
            if (elapsed < after.mediaMs) {
              const sourceRate = (after.sourceMs - before.sourceMs) / (after.mediaMs - before.mediaMs);
              return { state: "mapped", sourceMs: before.sourceMs + (elapsed - before.mediaMs) * sourceRate, version: segment.version, sourceRate };
            }
          }
        }
        const sourceRate = (segment.sourceEndSimMs - segment.sourceStartSimMs) / (1000 * chunk.playback_seconds);
        return { state: "mapped", sourceMs: segment.sourceStartSimMs + (seconds - begin) * 1000 * sourceRate, version: segment.version, sourceRate };
      }
      begin = end; previous = segment;
    }
    return { state: "buffering", reason: "retention_limit" };
  }
}

/** No first-frame fallback: it might be from the future. Same-time captures are
 * resolved in append order, after all already-committed updates at that time. */
export function sitcomFrameAt(frames: readonly SitcomFrame[], sourceMs: number): SitcomFrame | undefined {
  if (!Number.isFinite(sourceMs) || sourceMs < 0) return undefined;
  let found: SitcomFrame | undefined;
  for (const frame of frames) if (frame.atSimMs <= sourceMs && (!found || frame.atSimMs >= found.atSimMs)) found = frame;
  return found;
}

export function sitcomAudienceMessages(latest: SitcomFrame | undefined, scene: SitcomFrame | undefined) {
  const known = new Map((scene?.phone ?? []).map(message => [message.id, message]));
  const inbound = (latest?.phone ?? []).filter(message => message.direction === "in").map(message => {
    const observed = known.get(message.id);
    return { ...message, status: observed?.status ?? "awaiting scene", readMs: observed?.readMs ?? -1 };
  });
  // Only delivery is a reply to the outside world; typing a draft is not.
  const outbound = (scene?.phone ?? []).filter(message => message.direction === "out" && message.status === "delivered");
  return [...inbound, ...outbound].sort((a, b) => a.createdMs - b.createdMs || a.id - b.id);
}

export function sitcomThoughtAge(thought: { atSimMs: number } | null | undefined, sourceMs: number): string {
  if (!thought || !Number.isFinite(sourceMs) || sourceMs < thought.atSimMs) return "No authored thought in this scene";
  return `Last articulated thought · ${Math.floor((sourceMs - thought.atSimMs) / 1000)}s ago in scene`;
}

export interface SitcomContactLabel { name: string; relationship: string; context?: string }
/** Labels belong to the message envelope, not whichever contact is being edited
 * now. Older recordings without a profile remain honestly unknown. */
export function sitcomContactLabel(contact: SitcomContactLabel | undefined): string {
  if (!contact) return "Unknown sender";
  const name = contact.name.trim() || "Unknown sender", relationship = contact.relationship.trim();
  return relationship && relationship !== "unknown" ? `${name} · ${relationship}` : name;
}
export function sitcomMessageLabel(message: { direction: string; contact?: SitcomContactLabel }, owner = "Elaine"): string {
  const label = sitcomContactLabel(message.contact);
  return message.direction === "out" ? `${owner} → ${label}` : `${label} → ${owner}`;
}

/** The share composition may show another real thought while its selected actor
 * has none yet. The returned actor supplies the label; no thought is invented. */
export function sitcomThoughtActor(frame: SitcomFrame | undefined, selected: string) {
  const actor = frame?.actors.find(a => a.name === selected);
  if (actor?.latestThought) return actor;
  return frame?.actors.filter(a => a.latestThought).sort((a, b) => b.latestThought!.atSimMs - a.latestThought!.atSimMs)[0] ?? actor;
}

export function sitcomFactLines(frame: SitcomFrame | undefined): string[] {
  if (!frame) return ["Waiting for a committed scene"];
  const f = frame.facts;
  if(frame.scenario?.kind === "project89") return [`Card · ${f.cookieContainer}`,`Couch drawer · ${f.tin}`,`Phone · ${f.phoneContainer}`,`Unread · ${f.unread} / Vibrations · ${f.buzzes}`];
  return [`Cookie · ${f.cookieConsumed ? `eaten by ${f.cookieConsumedBy}` : f.cookieContainer}`,
    `Tin · ${f.tin}`, `Phone · ${f.phoneContainer}`, `Unread · ${f.unread}  /  Vibrations · ${f.buzzes}`];
}
