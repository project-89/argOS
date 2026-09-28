import type { SceneActor } from "../rendering/scene-director";
import type { ScreenBeat } from "./sitcom-screenplay";
import type { SitcomPerformance } from "./sitcom-performance";

const say = (value: string) => JSON.stringify(value);
const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** Names are sufficient on set unless two captured characters share one. */
export function stageName(actor: Pick<SceneActor, "id" | "identityKey" | "name">,
  cast: readonly Pick<SceneActor, "id" | "identityKey" | "name">[], token: (actor: Pick<SceneActor, "id" | "identityKey">) => string): string {
  return say(actor.name) + (cast.some(other => other.name === actor.name
    && (other.id !== actor.id || other.identityKey !== actor.identityKey)) ? ` (${token(actor)})` : "");
}

/** Presentation-only replacements of our own stage-direction boilerplate.
 * Quoted public data is opaque: never rewrite dialogue, names or descriptions.
 * The original directions and all outcome evidence remain in the beat ledger. */
function conciseStageDirection(direction: string): string {
  return direction.split(/("(?:\\.|[^"\\])*")/g).map((part, index) => index % 2 ? part : part
    .replaceAll("; do not invent a destination", "")
    .replaceAll(". Do not infer destruction, a transfer or a hidden location", "")
    .replaceAll(". Do not infer destruction or invent a replacement", "")
    .replaceAll(". Do not carry its former occupants or props forward", "")
    .replaceAll(" This is observed state, not an instruction to build it.", "")
    .replaceAll(" The attempt fails; do not depict the intended success.", " The attempt fails.")
    .replaceAll("Continue only the remaining tail of the already-started double phone vibration; do not trigger a new buzz", "The ongoing double phone vibration fades")
    .replaceAll(" Keep that room and device offscreen.", "")
    .replaceAll(" No other buzzes unless listed.", "")
    .replaceAll("; preserve the recorded resulting state", "")
    .replaceAll("continues the same action: ", "")
    .replaceAll("; keep the target visible in its recorded position, written text illegible", "; screen text illegible")
    .replaceAll("; show finger movement on its input surface in its recorded position, written text illegible", "; screen text illegible")
    .replaceAll(" — expression: ", "'s expression becomes ")
    .replaceAll(" — clothing: ", " wears ")
    .replaceAll(" — accessories: ", " wears ")
    .replaceAll("; visible state: ", "; now ")
    .replaceAll("finishes pickup", "finishes picking up")
    .replaceAll("finishes move", "finishes walking")
  ).join("");
}

/** Editorial labels, not new ECS identities or invented character voice traits.
 * Clone per candidate; only the accepted screenplay may advance this registry. */
export class ScreenCast {
  private current = new Map<string, { token: string; identityKey?: string }>();
  private lifetimes = new Map<string, string>();
  private next = 1;
  clone(): ScreenCast {
    const copy = new ScreenCast();
    copy.current = new Map(this.current); copy.lifetimes = new Map(this.lifetimes); copy.next = this.next;
    return copy;
  }
  token(sourceId: string, actor: Pick<SceneActor, "id" | "identityKey">): string {
    const key = JSON.stringify([sourceId, actor.id]), old = this.current.get(key);
    const lifetime = actor.identityKey ? JSON.stringify([sourceId, actor.id, actor.identityKey]) : undefined;
    const token = lifetime && this.lifetimes.get(lifetime)
      || (old && (!actor.identityKey || !old.identityKey || old.identityKey === actor.identityKey) ? old.token : `S${this.next++}`);
    this.current.set(key, { token, identityKey: actor.identityKey ?? old?.identityKey });
    if (lifetime) this.lifetimes.set(lifetime, token);
    return token;
  }
}

export type DirectedInterval = Readonly<{
  startMs: number; endMs: number; roomId?: number; focalActorId?: number;
  visibleActorIds: readonly number[];
  speaker?: Readonly<{ actorId: number; token: string; cueId: string; onscreen: boolean }>;
  /** Cue starts are owned exactly once; continuations never repeat dialogue. */
  starts: readonly number[]; continues: readonly number[];
}>;

/** Compact shot instructions over fine-grained evidence intervals. No new timing,
 * dialogue, world lookup, or speculative action selection is allowed here. */
export function directPerformance(input: {
  beats: readonly ScreenBeat[]; performance: SitcomPerformance; version: number;
  style?: "timed" | "direct";
  /** Last accepted view, not the last compiled candidate. */
  previousCamera?: string;
  conversationPair?: readonly Pick<SceneActor, "id" | "identityKey">[];
  actorsAt: (sourceMs: number) => readonly SceneActor[];
  roomName: (roomId: number, sourceMs: number) => string;
  token: (actor: Pick<SceneActor, "id" | "identityKey">) => string;
}) {
  const { beats, performance: p } = input;
  const endingAt = p.durationMs - p.endingSilenceMs;
  const boundaries = [...new Set([0, endingAt, ...p.shots.flatMap(s => [s.startMs, s.endMs]),
    ...p.cues.flatMap(c => [c.startMs, c.endMs])])].filter(t => t >= 0 && t <= endingAt).sort((a, b) => a - b);
  const sourceAt = (mediaMs: number) => {
    for (let i = 1; i < p.sourceMap.length; i++) {
      const a = p.sourceMap[i - 1], b = p.sourceMap[i];
      if (mediaMs < b.mediaMs) return a.sourceMs + (b.sourceMs - a.sourceMs) * (mediaMs - a.mediaMs) / (b.mediaMs - a.mediaMs);
    }
    return p.sourceMap.at(-1)!.sourceMs;
  };
  const cueId = (index: number) => `V${input.version}C${index + 1}`;
  const cast = boundaries.flatMap(at => input.actorsAt(sourceAt(at)));
  const label = (actor: Pick<SceneActor, "id" | "identityKey" | "name">) => input.style === "direct"
    ? stageName(actor, cast, input.token) : `${say(actor.name)} (${input.token(actor)})`;
  const offscreen = (beat: ScreenBeat, roomId?: number) => beat.roomId !== undefined && beat.roomId !== roomId
    ? `offscreen in ${say(input.roomName(beat.roomId, beat.atSimMs))}; editorial audio bridge from that room`
    : "offscreen in the same room";
  const intervals: DirectedInterval[] = [];
  // Keep the fine-grained evidence intervals for synchronization, but do not
  // present each property/sound boundary as another instruction to perform.
  const blocks: Array<{ startMs: number; endMs: number; frame: string; camera: string;
    location: string; visible: string; voiceKey?: string; lines: string[]; prose: string[] }> = [];
  const emitted = new Set<number>();
  let lastRoom: number | undefined, lastFrame: string | undefined, lastFocalId: number | undefined;
  for (let i = 0; i < boundaries.length; i++) {
    const startMs = boundaries[i], endMs = boundaries[i + 1] ?? startMs;
    const starts = p.cues.filter(c => c.startMs === startMs);
    // Retain terminal point receipts, even at the beginning of the ending hold.
    if (endMs === startMs && !starts.length) continue;
    const active = p.cues.filter(c => c.startMs <= startMs && c.endMs > startMs);
    const speech = active.find(c => beats[c.beat].kind === "speech");
    const shot = p.shots.find(s => s.startMs <= startMs && s.endMs > startMs);
    const focus = shot?.beat === undefined ? undefined : beats[shot.beat];
    const at = sourceAt(startMs), actors = input.actorsAt(at);
    const focusActor = actors.find(a => a.id === focus?.actorId && (shot?.roomId===undefined||a.roomId===shot.roomId));
    const roomId = shot?.roomId ?? focusActor?.roomId ?? focus?.roomId ?? starts.map(c => beats[c.beat].roomId).find(r => r !== undefined)
      ?? lastRoom ?? actors[0]?.roomId;
    const local = actors.filter(a => a.roomId === roomId);
    // Public event witnesses may reorder the same cast. Enumeration order is
    // neither spatial blocking nor a reason to issue a new camera instruction.
    if (p.clock === "realtime") local.sort((a, b) => a.id - b.id);
    const ensemble = p.clock === "realtime" && shot?.kind === "establish";
    const pair = ensemble && input.conversationPair?.length === 2
      ? input.conversationPair.map(member => local.find(a => a.id === member.id && a.identityKey === member.identityKey)) : [];
    const paired = pair.length === 2 && pair.every((a): a is SceneActor => a !== undefined);
    // A close shot isolates the focal character; a hold/establishing shot does
    // not import characters from other rooms into the visible cast.
    const previousFocal = local.find(a => a.id === lastFocalId);
    const hold = !ensemble && !focus && lastFrame !== undefined && roomId === lastRoom
      && (lastFocalId === undefined || previousFocal !== undefined)
      && !starts.some(c => beats[c.beat].kind === "state");
    const picturedActor = focusActor ?? (hold ? previousFocal : undefined);
    const visible = picturedActor ? [picturedActor] : paired ? pair as SceneActor[] : local;
    const frame = hold ? lastFrame! : `${roomId}:${shot?.kind ?? "hold"}:${paired ? visible.map(a => a.id).join("+") : focusActor?.id ?? "wide"}`;
    const simpleCamera = paired ? `Held two-shot of ${visible.map(label).join(" and ")}.`
      : ensemble ? `Wide shot of ${visible.map(label).join(", ") || "the empty room"}.`
      : shot?.kind === "interaction_insert" || shot?.kind === "phone_hands" ? `Over-the-shoulder close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")} ${focus?.operation === "typing" ? "typing using" : "reading"} ${say(focus?.targetVisual?.name ?? "the recorded visible target")}, ${say(focus?.targetVisual?.placement ?? "in its established position")}; written text illegible.`
      : shot?.kind === "pickup" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")}, hands, object and source surface.`
      : shot?.kind === "object_hands" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")}, hands and objects.`
      : shot?.kind === "speaker" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")} speaking.`
      : focusActor ? `Medium shot of ${say(focusActor.name)}.` : "Fixed room-local wide view.";
    const camera = input.style === "direct" ? simpleCamera : paired ? `Held two-shot of ${visible.map(a => say(a.name)).join(" and ")}. Frame both in their established positions; do not move them together. Keep the same camera side and screen positions through their exchange, without reverse shots or following each speaker. Other characters remain in their established offscreen positions. Return to this composition after an insert.`
      : ensemble ? "Locked-off ensemble view of only the listed visible cast. Hold this room's composition through the exchange; return to it after an insert. Retain the camera side and each character's relative position within this room. No pan, zoom or speaker-by-speaker reframing. Only recorded movement changes where a character stands."
      : shot?.kind === "interaction_insert" || shot?.kind === "phone_hands" ? `Over-the-shoulder close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")} ${focus?.operation === "typing" ? "typing using" : "reading"} ${say(focus?.targetVisual?.name ?? "the recorded visible target")}; placement: ${say(focus?.targetVisual?.placement ?? "retain its recorded position")}. Keep the target visible; written text illegible.`
      : shot?.kind === "pickup" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")}, recorded source surface and object; ${focus?.sourceStartedAtSimMs!==undefined&&focus.sourceStartedAtSimMs<focus.atSimMs?"continue the same in-progress reach without restarting it":"uninterrupted surface-to-hand reach"}, no pocket retrieval or duplicate.`
      : shot?.kind === "object_hands" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")}, hands and recorded objects; keep ${focus?.operation === "pouring" ? "the pour" : "the drink"} visible.`
      : shot?.kind === "speaker" ? `Medium close shot of ${say(focusActor?.name ?? focus?.actorName ?? "the recorded actor")} speaking.`
      : focusActor ? `Medium shot of ${say(focusActor.name)}.` : "Fixed room-local wide view.";
    const location = roomId === undefined ? "retain established location" : say(input.roomName(roomId, at));
    const visibleLabels = visible.map(a => `${say(a.name)} (${input.token(a)})`).join(", ") || "no recorded character";
    let block = blocks.at(-1);
    if (!block || block.frame !== frame || block.location !== location || block.visible !== visibleLabels) {
      const heldCamera = hold && block?.frame === frame ? block.camera : camera;
      block = { startMs, endMs, frame, camera: heldCamera, location, visible: visibleLabels, lines: [], prose: [] }; blocks.push(block);
    } else block.endMs = endMs;
    let speaker: DirectedInterval["speaker"];
    if (speech) {
      const beat = beats[speech.beat];
      if (beat.actorId === undefined) throw new Error("Committed dialogue needs an identified speaker");
      const actor = input.actorsAt(beat.atSimMs).find(a => a.id === beat.actorId && (!beat.actorKey || a.identityKey === beat.actorKey));
      const token = input.token(actor ?? { id: beat.actorId, identityKey: beat.actorKey });
      const onscreen = visible.some(a => a.id === beat.actorId && input.token(a) === token);
      speaker = Object.freeze({ actorId: beat.actorId, token, cueId: cueId(speech.beat), onscreen });
      // A cut changes coverage, not the performance. Only identify an
      // offscreen voice; never ask the model to resume/reperform the line.
      if (block.voiceKey !== speaker.cueId && speech.startMs < startMs && !onscreen)
        block.prose.push(`Voice over this shot: ${label(actor ?? { name: beat.actorName ?? "recorded speaker", id: beat.actorId, identityKey: beat.actorKey })}, ${offscreen(beat, roomId)}.`);
      if (block.voiceKey !== speaker.cueId) block.lines.push(`[${seconds(startMs)}s] VOICE ${speaker.cueId}: ${say(beat.actorName ?? actor?.name ?? "recorded speaker")} (${token}), ${onscreen ? "ONSCREEN; only this character lip-syncs" : `OFFSCREEN${beat.roomId !== undefined && beat.roomId !== roomId ? ` in ${say(input.roomName(beat.roomId, beat.atSimMs))}; editorial audio bridge, not sound heard in the pictured room` : " in the same room"}; visible characters do not lip-sync this voice`}.`);
    } else if (block.voiceKey !== "none") block.lines.push(`[${seconds(startMs)}s] VOICE: none; no vocal sounds.`);
    const silent = visible.filter(a => a.id !== speaker?.actorId || !speaker.onscreen);
    // The legacy timed format retains explicit non-speaker lists. Direct prose
    // binds each utterance to its actor instead of repeating those lists.
    if (silent.length && block.voiceKey !== (speaker?.cueId ?? "none")) block.lines.push(`SILENT: ${silent.map(label).join(", ")}; no speaking mouth movements.`);
    block.voiceKey = speaker?.cueId ?? "none";
    for (const cue of starts) {
      const beat = beats[cue.beat]; emitted.add(cue.beat);
      const owner = beat.actorId === undefined || beat.kind === "speech" ? undefined
        : input.actorsAt(beat.atSimMs).find(a => a.id === beat.actorId && (!beat.actorKey || a.identityKey === beat.actorKey));
      block.lines.push(`${beat.kind.toUpperCase()} ${cueId(cue.beat)} [${seconds(cue.startMs)}–${seconds(cue.endMs)}s]${owner ? ` ACTOR ${label(owner)}` : ""}: ${beat.direction}`);
      // Exact timing stays in the immutable ledger. Numerical onset prose was
      // audibly read by H3 in the live run; the direct channel is ordered acting
      // directions, not a narrated scheduler. This is not frame-exact control.
      if (beat.kind === "speech") {
        const actor = input.actorsAt(beat.atSimMs).find(a => a.id === beat.actorId && (!beat.actorKey || a.identityKey === beat.actorKey));
        const who = actor ? label(actor) : say(beat.actorName ?? "recorded speaker");
        const depicted = visible.some(a => a.id === beat.actorId && (!beat.actorKey || a.identityKey === beat.actorKey));
        const appearance = actor?.appearance;
        // Public expression supplies acting, not private motives. Posture and
        // condition changes already have state beats; repeating them at every
        // line reads like another instruction to reset the actor.
        const expression = appearance?.expression;
        const acting = expression && !["neutral", "attentive"].includes(expression.toLowerCase())
          ? ` (${say(expression)})` : "";
        block.prose.push(`${who}${depicted ? "" : ` (${offscreen(beat, roomId)})`}${acting} says: ${say(beat.text ?? "")}${beat.interrupted ? " The line cuts off abruptly." : ""}`);
      } else {
        // A matched successful terminal receipt adds proof, not another
        // performance. The original action and any resulting state changes
        // already describe it. Unmatched completions remain visible.
        const coveredCompletion = beat.kind === "action" && beat.endSimMs === undefined
          && beat.executionId && beat.direction.startsWith(`${say(beat.actorName ?? "")} finishes `)
          && p.cues.some(other => {
            const action = beats[other.beat];
            return action !== beat && action.kind === "action" && action.executionId === beat.executionId
              && action.actorId === beat.actorId && (!beat.actorKey || action.actorKey === beat.actorKey)
              && action.operation === beat.operation && action.endSimMs === beat.atSimMs
              && action.atSimMs <= beat.atSimMs && !action.direction.endsWith("The attempt fails; do not depict the intended success.");
          });
        if (!coveredCompletion) block.prose.push(conciseStageDirection(beat.direction));
      }
    }
    const continues = active.filter(c => c.startMs < startMs);
    intervals.push(Object.freeze({ startMs, endMs, roomId, focalActorId: picturedActor?.id,
      visibleActorIds: Object.freeze(visible.map(a => a.id)), ...(speaker ? { speaker } : {}),
      starts: Object.freeze(starts.map(c => c.beat)), continues: Object.freeze(continues.map(c => c.beat)) }));
    lastRoom = roomId; lastFrame = frame; lastFocalId = picturedActor?.id;
  }
  if (emitted.size !== p.cues.length) throw new Error("Shot directions must preserve every committed cue exactly once");
  let lastCamera = input.previousCamera;
  const lines = input.style === "direct" ? blocks.flatMap(block => {
    const camera = `Camera: ${block.camera} In ${block.location}.`;
    const cameraKey = JSON.stringify([block.frame, block.location, block.visible, block.camera]);
    const frame = block.endMs - block.startMs >= 250 || block.prose.length;
    const changed = frame && cameraKey !== lastCamera;
    if (frame) lastCamera = cameraKey;
    return [
      // Reuse an unchanged view. A changed view owning any cue or voice handoff
      // still gets framing, however brief; only empty micro-cuts may be omitted.
      ...(changed ? [camera] : []),
      ...block.prose,
    ];
  }) : blocks.flatMap(block => [
    `[${seconds(block.startMs)}–${seconds(block.endMs)}s] CAMERA: ${block.camera} LOCATION: ${block.location}. VISIBLE ONLY: ${block.visible}. No additional people.`,
    ...block.lines,
  ]);
  return { lines, intervals: Object.freeze(intervals), lastCamera };
}
