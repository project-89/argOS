import { snapshotDirectorScene, type SceneEvent, type SceneSnapshot } from "./scene-snapshot";

/** One post-physics boundary, not a request to advance the simulation. Every
 * room is captured at the same source clock. Sequence is supplied by the world. */
export type CommittedSceneCapture = Readonly<{ sequence: number; scenes: readonly SceneSnapshot[];
  /** Read-only local surface captured at the actual public event publication,
   * before an actor may leave during a coarse physics step. */
  eventWitnesses?: readonly { event: SceneEvent; scene: SceneSnapshot }[] }>;
export type SceneWindowState = Readonly<{ atSimMs: number; sequence: number; scene: SceneSnapshot }>;
export type SceneWindowEvent = Readonly<{ captureSequence: number; event: SceneEvent;
  /** Public identity at the event, never a later numeric-ID lookup. */
  actor?: Readonly<{ id: number; identityKey?: string; name: string }>;
  target?: Readonly<{ id: number; identityKey?: string; name: string; support?: string }> }>;
export type SceneWindowAction = Readonly<{
  executionId: string; actorId: number; actorKey?: string; action: string;
  /** Executor target identity, retained for continuation windows without a new event. */
  targetId?: number; targetKey?: string;
  operation?: SceneEvent["operation"];
  startedAtSimMs: number; completedAtSimMs?: number;
  /** Only this lived portion is in this window; the expected end is omitted. */
  visibleStartSimMs: number; visibleEndSimMs: number;
  status: "pending" | "succeeded" | "failed" | "out_of_view";
  evidenceSequences: readonly number[];
}>;
export type CommittedSceneWindow = Readonly<{
  coverage?:"continuous_room";
  sourceId: string; roomId: number; startSimMs: number; endSimMs: number;
  startSequence: number; endSequence: number;
  states: readonly SceneWindowState[];
  events: readonly SceneWindowEvent[];
  actions: readonly SceneWindowAction[];
  /** Only the sealed final frontier is closed on its right edge; no later live
   * window can duplicate its terminal receipts. */
  terminal?: boolean;
}>;
export type SceneWindowResult =
  | { status: "ready"; window: CommittedSceneWindow }
  | { status: "buffering" | "ended" | "expired" | "room_unavailable"; availableStartSimMs: number | null; availableEndSimMs: number | null };
/** Last-observed public views at a source point. Local event witnesses update
 * only their visible subjects; complete boundary captures replace the whole
 * captured scope. This is a projection of evidence, not another ECS snapshot. */
export type SceneWorldState = Readonly<{ atSimMs:number; sequence:number; scenes:readonly SceneSnapshot[] }>;
/** Deliberately incompatible with the continuous single-room projection API. */
export type WorldRoomEvidence = Omit<CommittedSceneWindow,"coverage"> & Readonly<{coverage:"world_room"}>;
export type CommittedSceneWorldWindow = Readonly<{
  sourceId:string; startSimMs:number; endSimMs:number;
  states:readonly SceneWorldState[];
  /** Each room's evidence within the common interval, not a claim that the room
   * existed for that entire interval. Consult states for observed presence. */
  rooms:readonly WorldRoomEvidence[];
}>;
export type SceneWorldWindowResult = {status:"ready";window:CommittedSceneWorldWindow}
  | Exclude<SceneWindowResult,{status:"ready"}>;
export type CommittedSceneHistoryLimits = { maxCaptures: number; maxEvents: number; retentionMs: number;
  /** Serialized UTF-8 payload ceiling, in addition to cardinality/time bounds.
   * This is not an assertion about the JS engine's exact heap allocation. */
  maxBytes: number };
type Limits = CommittedSceneHistoryLimits;
type StoredCapture = { sequence: number; atSimMs: number; tick: number; scenes: SceneSnapshot[] };
type StoredEvent = SceneWindowEvent & { witness?: SceneSnapshot };
type Tape = { schema: 1; sourceId: string | null; limits: Limits; captures: StoredCapture[]; events: StoredEvent[] };
const finite = (n: number) => Number.isFinite(n) && n >= 0;
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function immutable<T>(input: T): T {
  const value = structuredClone(input);
  const freeze = (v: any): void => { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } };
  freeze(value); return value;
}

/** Bounded, append-only public visual history. Retention loss is explicit: it
 * never skips the playhead ahead, invents missing events or consults live ECS. */
export class CommittedSceneHistory {
  private source: string | null = null;
  private captures: StoredCapture[] = [];
  private events: StoredEvent[] = [];
  private lastEventSequence = -1;
  private sealed = false;
  private readonly limits: Limits;
  private readonly sizes = new WeakMap<object, number>();
  private retainedBytes = 0;
  private bytes(value: object): number {
    let size = this.sizes.get(value);
    if (size === undefined) { size = new TextEncoder().encode(JSON.stringify(value)).byteLength; this.sizes.set(value, size); }
    return size;
  }
  constructor(options: Partial<Limits> = {}) {
    this.limits = { maxCaptures: options.maxCaptures ?? 512, maxEvents: options.maxEvents ?? 2048,
      retentionMs: options.retentionMs ?? 120_000, maxBytes: options.maxBytes ?? 64 * 1024 * 1024 };
    if (!integer(this.limits.maxCaptures) || this.limits.maxCaptures < 2 || this.limits.maxCaptures > 20_000
      || !integer(this.limits.maxEvents) || this.limits.maxEvents < 1 || this.limits.maxEvents > 65_536
      || !integer(this.limits.maxBytes) || this.limits.maxBytes < 1 || this.limits.maxBytes > 256 * 1024 * 1024
      || !finite(this.limits.retentionMs) || this.limits.retentionMs <= 0 || this.limits.retentionMs > 3_600_000)
      throw new Error("Invalid bounded scene history retention policy.");
  }
  append(input: CommittedSceneCapture): void {
    if (this.sealed) throw new Error("This scene history is stopped; create a new source for a new run.");
    if (!integer(input.sequence) || !Array.isArray(input.scenes) || !input.scenes.length || input.scenes.length > 64)
      throw new Error("A committed capture requires a source sequence and 1–64 public rooms.");
    if (input.scenes.some(s => s.events.length > 512)) throw new Error("Capture has too many events; never silently truncate evidence.");
    const scenes = input.scenes.map(s => snapshotDirectorScene(s, { eventLimit: 512 }));
    const first = scenes[0], last = this.captures.at(-1);
    if (scenes.some(s => s.sourceId !== first.sourceId || s.sourceTick !== first.sourceTick || s.elapsedMs !== first.elapsedMs)
      || new Set(scenes.map(s => s.room.id)).size !== scenes.length)
      throw new Error("All rooms must share one committed source identity and clock.");
    if (this.source !== null && first.sourceId !== this.source) throw new Error("Cannot join different source runs.");
    if (last && (input.sequence <= last.sequence || first.elapsedMs < last.atSimMs || first.sourceTick < last.tick))
      throw new Error("Committed source capture ordering cannot move backward or repeat.");
    const existing = new Map(this.events.map(e => [e.event.id, e]));
    const incoming: StoredEvent[] = [];
    const eventSequences = new Map(this.events.map(e => [e.event.sequence, e.event.id]));
    const eventSources: Array<{ event: SceneEvent; witness?: SceneSnapshot }> = scenes.flatMap(scene => scene.events.map(event => ({ event })));
    if ((input.eventWitnesses?.length ?? 0) > 512) throw new Error("Too many event-local witnesses.");
    for (const value of input.eventWitnesses ?? []) {
      const witness = snapshotDirectorScene({ ...value.scene, events: [value.event] });
      if (witness.sourceId !== first.sourceId || witness.elapsedMs !== value.event.elapsedMs || witness.sourceTick !== value.event.sourceTick
        || witness.elapsedMs > first.elapsedMs || witness.sourceTick > first.sourceTick) throw new Error("Event witness clock/source mismatch.");
      const event = witness.events[0];
      if (event) eventSources.push({ event, witness: { ...witness, events: [] } });
    }
    for (const { event, witness } of eventSources) {
      if (!integer(event.sequence!)) throw new Error("Public events require their actual source evidence sequence.");
      const previous = existing.get(event.id);
      if (previous) {
        if (JSON.stringify(previous.event) !== JSON.stringify(event)) throw new Error("A committed event cannot be rewritten.");
        continue;
      }
      // A rolling scene source may repeat an old cue after its full receipt has
      // left retention. Never resurrect it as newly observed evidence.
      if (event.sequence! <= this.lastEventSequence && event.elapsedMs <= (this.captures[0]?.atSimMs ?? 0)) continue;
      if (event.sequence! <= this.lastEventSequence) throw new Error("Public event order cannot move backward.");
      if (last && event.elapsedMs < last.atSimMs) throw new Error("Late events cannot rewrite an already committed source interval.");
      if (eventSequences.has(event.sequence) && eventSequences.get(event.sequence) !== event.id)
        throw new Error("Source evidence sequences must identify unique events.");
      const value = { captureSequence: input.sequence, event, ...(witness ? { witness } : {}) };
      incoming.push(value); existing.set(event.id, value); eventSequences.set(event.sequence, event.id);
    }
    if (incoming.length > this.limits.maxEvents) throw new Error("One boundary exceeds event retention capacity.");
    const committed = immutable({ sequence: input.sequence, atSimMs: first.elapsedMs, tick: first.sourceTick,
      scenes: scenes.map(scene => ({ ...scene, events: [] })) });
    const committedEvents = immutable(incoming);
    const incomingBytes = this.bytes(committed) + committedEvents.reduce((sum, event) => sum + this.bytes(event), 0);
    if (this.retainedBytes + incomingBytes > this.limits.maxBytes)
      throw new Error("Committed scene history payload byte limit exceeded; source history cannot be skipped.");
    // All checks finish before mutating the tape.
    this.source = first.sourceId;
    this.captures.push(committed);
    this.events.push(...committedEvents);
    this.lastEventSequence = Math.max(this.lastEventSequence, ...incoming.map(e => e.event.sequence!));
    this.events.sort((a, b) => a.event.elapsedMs - b.event.elapsedMs || a.event.sequence! - b.event.sequence!);
    const cutoff = first.elapsedMs - this.limits.retentionMs;
    // Keep one predecessor as a baseline for intervals beginning between samples.
    while (this.captures.length > 2 && this.captures[1].atSimMs <= cutoff) this.captures.shift();
    if (this.captures.length > this.limits.maxCaptures) this.captures.splice(0, this.captures.length - this.limits.maxCaptures);
    const baseline = this.captures[0];
    const ended = new Set(this.events.filter(e => e.event.interval?.completedAtSimMs !== undefined
      && e.event.interval.completedAtSimMs <= baseline.atSimMs).map(e => e.event.interval!.executionId));
    const retainedAdmission = (e: StoredEvent) => e.witness && e.event.status === "pending" && e.event.interval
      && !ended.has(e.event.interval.executionId) && baseline.scenes.some(scene => scene.room.id === e.event.roomId
        && scene.actors.some(actor => actor.id === e.event.actorId && (!e.event.actorKey || actor.identityKey === e.event.actorKey)));
    this.events = this.events.filter(e => e.event.elapsedMs >= baseline.atSimMs && e.captureSequence >= baseline.sequence || retainedAdmission(e));
    if (this.events.length > this.limits.maxEvents) {
      const removed = this.events.splice(0, this.events.length - this.limits.maxEvents);
      const lostThrough = removed.at(-1)!.captureSequence;
      // Dropping a receipt invalidates all windows that could have contained it.
      // Retain only a complete later baseline, never a plausible partial tape.
      this.captures = removed.some(retainedAdmission) ? [this.captures.at(-1)!] : this.captures.filter(c => c.sequence > lostThrough);
      this.events = this.events.filter(e => e.captureSequence >= this.captures[0].sequence);
    }
    this.retainedBytes = this.captures.reduce((sum, capture) => sum + this.bytes(capture), 0)
      + this.events.reduce((sum, event) => sum + this.bytes(event), 0);
  }
  stop(): void { this.sealed = true; }
  bounds() {
    return { sourceId: this.source, stopped: this.sealed, captures: this.captures.length, events: this.events.length,
      retainedBytes: this.retainedBytes, maxBytes: this.limits.maxBytes,
      availableStartSimMs: this.captures[0]?.atSimMs ?? null, availableEndSimMs: this.captures.at(-1)?.atSimMs ?? null,
      latestSequence: this.captures.at(-1)?.sequence ?? null };
  }
  /** Prefer a lived utterance boundary to a fixed time cut. Expected deadlines
   * are not used: completion must already be in the public event ledger. */
  speechBoundary(startSimMs: number, nominalEnd: number, maxEnd: number): { endSimMs: number; buffering: boolean } {
    if (!finite(startSimMs) || !finite(nominalEnd) || !finite(maxEnd) || nominalEnd <= startSimMs || maxEnd < nominalEnd)
      throw new Error("A speech boundary requires an ordered, bounded simulation interval.");
    const latest = this.captures.at(-1)?.atSimMs ?? startSimMs;
    const utterances = new Map<string, { start: number; end?: number }>();
    for (const { event } of this.events) {
      if (event.action !== "speak" || !event.interval || event.elapsedMs > Math.min(latest, maxEnd)) continue;
      const i = event.interval;
      const key = `${i.executionId}:${event.actorKey ?? event.actorId}`;
      const old = utterances.get(key);
      utterances.set(key, { start: i.startedAtSimMs, end: i.completedAtSimMs ?? old?.end });
    }
    const crossing = [...utterances.values()].filter(u => u.start < nominalEnd && (u.end === undefined || u.end >= nominalEnd));
    if (!crossing.length) return { endSimMs: nominalEnd, buffering: false };
    if (crossing.every(u => u.end !== undefined && u.end + .001 <= Math.min(latest, maxEnd)))
      return { endSimMs: Math.max(nominalEnd, ...crossing.map(u => u.end! + .001)), buffering: false };
    const starts = crossing.filter(u => u.start > startSimMs + 1000).map(u => u.start);
    if (starts.length === crossing.length) return { endSimMs: Math.min(...starts), buffering: false };
    // A line already underway may need a little more committed time. Never wait
    // beyond the bounded window or make up an unspoken ending to complete it.
    return { endSimMs: nominalEnd, buffering: !this.sealed && latest < maxEnd };
  }
  /** Candidate editorial cuts that cannot divide a spoken execution. Inspecting
   * already committed completion receipts is not a forecast. Callers must still
   * assemble each candidate and fit its complete evidence into a media budget. */
  safeSpeechBoundaries(startSimMs: number, nominalEnd: number, maxEnd: number, protectedOperations: readonly string[] = []) {
    if (!finite(startSimMs) || !finite(nominalEnd) || !finite(maxEnd) || nominalEnd <= startSimMs || maxEnd < nominalEnd)
      throw new Error("Invalid safe speech boundary interval");
    const latest = this.captures.at(-1)?.atSimMs ?? startSimMs, limit = Math.min(latest, maxEnd);
    const utterances = new Map<string, { start: number; end?: number }>();
    for (const { event } of this.events) {
      if (event.action !== "speak" && !protectedOperations.includes(event.action ?? "") && !protectedOperations.includes(event.operation ?? "") || !event.interval || event.elapsedMs > limit) continue;
      const i = event.interval, key = `${i.executionId}:${event.actorKey ?? event.actorId}`, old = utterances.get(key);
      utterances.set(key, { start: i.startedAtSimMs, end: i.completedAtSimMs ?? old?.end });
    }
    const all = [...utterances.values()].filter(u => u.end === undefined || u.end >= startSimMs);
    const candidates = [...new Set([nominalEnd, ...(this.sealed ? [latest] : []), ...all.flatMap(u => [u.start, ...(u.end === undefined ? [] : [u.end + .001])])])]
      .filter(at => at >= startSimMs + (this.sealed && at === latest ? .001 : 1000) && at <= limit
        && all.every(u => u.start >= at || u.end !== undefined && (u.end < at || this.sealed && at === latest && u.end === at)))
      .sort((a, b) => Math.abs(a - nominalEnd) - Math.abs(b - nominalEnd) || a - b);
    return { candidates, buffering: !this.sealed && latest < maxEnd, availableEndSimMs: latest, stopped: this.sealed };
  }
  /** Fallback editorial cuts after an actually delivered sentence or clause.
   * These do not complete its original speech execution. The screenplay must
   * retain an explicit continuation manifest and exact word-evidence cursor.
   * Optional last-resort word cuts preserve those same receipts and protected
   * actions, but must be labeled as fragments rather than complete clauses. */
  safeSpeechPhraseBoundaries(startSimMs: number, maxEnd: number, protectedOperations: readonly string[] = [], allowWordCuts = false) {
    if (!finite(startSimMs) || !finite(maxEnd) || maxEnd <= startSimMs) throw new Error("Invalid speech phrase horizon");
    const latest = this.captures.at(-1)?.atSimMs ?? startSimMs, limit = Math.min(latest, maxEnd);
    const protectedActions = new Map<string, { start: number; end?: number }>();
    const speech = new Map<string, { start: number; end?: number; words: SceneEvent[] }>();
    const candidates: number[] = [];
    for (const { event } of this.events) {
      if (event.elapsedMs > limit) continue;
      if (event.action === "speak" && event.kind === "speech" && event.status === "succeeded" && event.text
        && (allowWordCuts || /[.!?;,:—]\s*$/u.test(event.text))) candidates.push(event.elapsedMs + .001);
      if (event.action === "speak" && event.interval) {
        const key = `${event.interval.executionId}:${event.actorKey ?? event.actorId}`;
        const utterance: { start: number; end?: number; words: SceneEvent[] } = speech.get(key)
          ?? { start: event.interval.startedAtSimMs, words: [] };
        if (event.interval.completedAtSimMs !== undefined) utterance.end = event.interval.completedAtSimMs;
        if (event.kind === "speech" && event.status === "succeeded" && event.text) utterance.words.push(event);
        speech.set(key, utterance);
      }
      if (!event.interval || !protectedOperations.includes(event.action ?? "") && !protectedOperations.includes(event.operation ?? "")) continue;
      const key = `${event.interval.executionId}:${event.actorKey ?? event.actorId}`, old = protectedActions.get(key);
      protectedActions.set(key, { start: event.interval.startedAtSimMs, end: event.interval.completedAtSimMs ?? old?.end });
    }
    // A physical completion can fall just after a delivered clause and before
    // its next word (axS1ql: typing ends 145ms after "call!"). The punctuation
    // instant cannot cut the gesture, but this later committed boundary can.
    // Every crossing voice must still be at a clause boundary: never use the
    // earlier punctuation after a new word, or an expected action deadline.
    for (const action of protectedActions.values()) if (action.end !== undefined) {
      const at = action.end + .001;
      const paused = [...speech.values()].every(utterance => {
        if (utterance.start >= at || utterance.end !== undefined && utterance.end < at) return true;
        const lastWord = utterance.words.filter(word => word.elapsedMs < at).at(-1);
        // A pending speech execution before its first delivered word is also
        // silent. Cutting here carries the whole still-unspoken line forward;
        // it neither drops a word nor declares that utterance complete.
        return !lastWord && utterance.start >= startSimMs
          || Boolean(lastWord?.text && (allowWordCuts || /[.!?;,:—]\s*$/u.test(lastWord.text)));
      });
      if (paused) candidates.push(at);
    }
    if (this.sealed) candidates.push(latest);
    return [...new Set(candidates)].filter(at => at > startSimMs && at <= limit
      && [...protectedActions.values()].every(a => a.start >= at || a.end !== undefined && (a.end < at || this.sealed && at === latest && a.end === at)))
      .sort((a, b) => b - a);
  }
  assemble(startSimMs: number, endSimMs: number, roomId: number): SceneWindowResult {
    if (!finite(startSimMs) || !finite(endSimMs) || endSimMs <= startSimMs || !integer(roomId))
      throw new Error("A source window requires a positive simulation interval and one room.");
    const bounds = this.bounds();
    const terminal = this.sealed && endSimMs === bounds.availableEndSimMs;
    const unavailable = (status: Exclude<SceneWindowResult["status"], "ready">): SceneWindowResult => ({ status,
      availableStartSimMs: bounds.availableStartSimMs, availableEndSimMs: bounds.availableEndSimMs });
    if (!this.captures.length) return unavailable(this.sealed ? "ended" : "buffering");
    if (startSimMs < this.captures[0].atSimMs) return unavailable("expired");
    if (endSimMs > this.captures.at(-1)!.atSimMs) return unavailable(this.sealed ? "ended" : "buffering");
    const baseline = [...this.captures].reverse().find(c => c.atSimMs <= startSimMs)!;
    const frontier = [...this.captures].reverse().find(c => c.atSimMs <= endSimMs)!;
    const selected = [baseline, ...this.captures.filter(c => c.sequence > baseline.sequence && c.atSimMs <= endSimMs)];
    if (selected.some(c => !c.scenes.some(s => s.room.id === roomId))) return unavailable("room_unavailable");
    const states = selected.map(c => ({ atSimMs: c.atSimMs, sequence: c.sequence,
      scene: c.scenes.find(s => s.room.id === roomId)! }));
    return this.projectRoomWindow(startSimMs,endSimMs,roomId,baseline.sequence,frontier.sequence,states,terminal);
  }

  /** Assemble the captured world's changing scope without backfilling a new
   * room into older time. The single-room API deliberately remains strict. */
  assembleWorld(startSimMs:number,endSimMs:number):SceneWorldWindowResult {
    if(!finite(startSimMs)||!finite(endSimMs)||endSimMs<=startSimMs)throw new Error("A world window requires a positive simulation interval");
    const bounds=this.bounds();
    const unavailable=(status:"buffering"|"ended"|"expired"|"room_unavailable")=>({status,
      availableStartSimMs:bounds.availableStartSimMs,availableEndSimMs:bounds.availableEndSimMs});
    if(!this.captures.length)return unavailable(this.sealed?"ended":"buffering");
    if(startSimMs<this.captures[0].atSimMs)return unavailable("expired");
    if(endSimMs>this.captures.at(-1)!.atSimMs)return unavailable(this.sealed?"ended":"buffering");
    const baseline=[...this.captures].reverse().find(c=>c.atSimMs<=startSimMs)!;
    const frontier=[...this.captures].reverse().find(c=>c.atSimMs<=endSimMs)!;
    const observations=[baseline,...this.captures.filter(c=>c.sequence>baseline.sequence&&c.atSimMs<=endSimMs)]
      .map(c=>({...c,partial:false}));
    for(const item of this.events)if(item.witness&&item.captureSequence>baseline.sequence&&item.event.elapsedMs>=baseline.atSimMs&&item.event.elapsedMs<=endSimMs)
      observations.push({sequence:item.captureSequence,atSimMs:item.event.elapsedMs,tick:item.event.sourceTick,
        scenes:[item.witness],partial:true});
    observations.sort((a,b)=>a.atSimMs-b.atSimMs||a.sequence-b.sequence||Number(b.partial)-Number(a.partial));
    let current=new Map<number,SceneSnapshot>();
    const states:SceneWorldState[]=[];
    for(const observation of observations) {
      if(!observation.partial)current=new Map(observation.scenes.map(scene=>[scene.room.id,scene]));
      else for(const scene of observation.scenes) {
        const observedIds=new Set([...scene.actors.map(a=>a.id),...scene.props.map(p=>p.id)]);
        // Positive local placement supersedes a previous view of that subject.
        // Unmentioned people/props are not declared absent by a sparse witness.
        for(const [id,old] of current)current.set(id,{...old,
          actors:old.actors.filter(a=>!observedIds.has(a.id)),
          props:old.props.filter(p=>!observedIds.has(p.id)&&!(p.heldBy!==undefined&&observedIds.has(p.heldBy)))});
        const candidate=current.get(scene.room.id);
        // A lazily assigned first identity is not a room replacement. Sparse
        // witnesses must not erase everyone they did not mention. Two known,
        // different lifetime keys still invalidate continuity.
        const old=candidate&&(!candidate.room.identityKey||!scene.room.identityKey||candidate.room.identityKey===scene.room.identityKey)?candidate:undefined;
        current.set(scene.room.id,{...scene,
          room:{...scene.room,...(!scene.room.identityKey&&old?.room.identityKey?{identityKey:old.room.identityKey}:{})},
          actors:[...(old?.actors??[]),...scene.actors],props:[...(old?.props??[]),...scene.props]});
      }
      states.push({atSimMs:observation.atSimMs,sequence:observation.sequence,scenes:[...current.values()]});
    }
    const initial=[...states].reverse().find(s=>s.atSimMs<=startSimMs)!;
    const selected=[initial,...states.filter(s=>s.atSimMs>startSimMs)];
    const ids=[...new Set(selected.flatMap(s=>s.scenes.map(scene=>scene.room.id)))];
    if(ids.length>64)return unavailable("room_unavailable");
    const terminal=this.sealed&&endSimMs===bounds.availableEndSimMs;
    // A public event cannot disappear merely because its room is unavailable
    // at every selected boundary (e.g. a same-time replacement at the playhead).
    if(this.events.some(({event:e})=>e.elapsedMs>=startSimMs&&(e.elapsedMs<endSimMs||terminal&&e.elapsedMs===endSimMs)&&!ids.includes(e.roomId)))
      return unavailable("room_unavailable");
    const rooms:WorldRoomEvidence[]=[];
    for(const room of ids) {
      const presence=selected.map(s=>({atSimMs:s.atSimMs,sequence:s.sequence,scene:s.scenes.find(scene=>scene.room.id===room)}));
      const available=presence.filter((s):s is SceneWindowState=>!!s.scene);
      const result=this.projectRoomWindow(startSimMs,endSimMs,room,baseline.sequence,frontier.sequence,available,terminal,presence);
      if(result.status!=="ready")return result;
      rooms.push({...result.window,coverage:"world_room"});
    }
    return {status:"ready",window:immutable({sourceId:this.source!,startSimMs,endSimMs,states:selected,rooms})};
  }

  private projectRoomWindow(startSimMs:number,endSimMs:number,roomId:number,startSequence:number,endSequence:number,
    states:readonly SceneWindowState[],terminal:boolean,
    presence:readonly {atSimMs:number;scene?:SceneSnapshot}[]=states):SceneWindowResult {
    const bounds=this.bounds();
    // Numeric ECS IDs may be reused. A single continuous camera interval cannot
    // silently join two different room lifetimes or relabel earlier events.
    const roomKeys = new Set(states.map(s => s.scene.room.identityKey).filter((key): key is string => Boolean(key)));
    for (const { event } of this.events) if (event.roomId === roomId && event.roomKey
      && event.elapsedMs >= startSimMs && event.elapsedMs < endSimMs) roomKeys.add(event.roomKey);
    if (roomKeys.size > 1) return {status:"room_unavailable",availableStartSimMs:bounds.availableStartSimMs,availableEndSimMs:bounds.availableEndSimMs};
    const roomKey = [...roomKeys][0];
    // Half-open event windows: an event exactly on the next start is delivered
    // there, once. State at the closing boundary is available as endpoint proof.
    const events = this.events.filter(e => e.event.roomId === roomId && e.event.elapsedMs >= startSimMs
      && (e.event.elapsedMs < endSimMs || terminal && e.event.elapsedMs === endSimMs))
      .map(({ captureSequence, event, witness }) => {
        const local = witness ?? this.captures.find(c => c.sequence === captureSequence)?.scenes.find(s => s.room.id === roomId);
        const actor = local?.actors.find(a => a.id === event.actorId && (!event.actorKey || a.identityKey === event.actorKey));
        const target = [...(local?.actors ?? []), ...(local?.props ?? [])].find(item => item.id === event.targetId && (!event.targetKey || item.identityKey === event.targetKey));
        const support = target && "supportId" in target ? local?.props.find(p => p.id === target.supportId)?.name : undefined;
        return { captureSequence, event, ...(actor ? { actor: { id: actor.id, ...(actor.identityKey ? { identityKey: actor.identityKey } : {}), name: actor.name } } : {}),
          ...(target ? { target: { id: target.id, identityKey: target.identityKey, name: target.name, ...(support ? { support } : {}) } } : {}) };
      });
    const intervalEvents = this.events.filter(e => e.event.elapsedMs <= endSimMs && e.event.interval);
    const actions = new Map<string, SceneWindowAction>();
    for (const { event } of intervalEvents) {
      const interval = event.interval!;
      if (event.actorId === undefined || !event.action || interval.startedAtSimMs >= endSimMs) continue;
      const old = actions.get(interval.executionId);
      // A matching terminal receipt may end a local departure after arrival in
      // another room. Carry only its end time, never remote text/targets/state or
      // the remote success verdict. An unobserved remote start creates nothing.
      const remote = event.roomId !== roomId;
      if (!remote && roomKey && event.roomKey && event.roomKey !== roomKey) continue;
      if (remote && (!old || interval.completedAtSimMs === undefined || old.actorId !== event.actorId || old.actorKey !== event.actorKey
        || old.action !== event.action || old.startedAtSimMs !== interval.startedAtSimMs)) continue;
      const completedAtSimMs = interval.completedAtSimMs ?? old?.completedAtSimMs;
      if (completedAtSimMs !== undefined && completedAtSimMs <= startSimMs) { actions.delete(interval.executionId); continue; }
      actions.set(interval.executionId, { executionId: interval.executionId, actorId: event.actorId,
        ...(event.actorKey ? { actorKey: event.actorKey } : {}), action: event.action,
        ...((remote ? old?.targetId : event.targetId ?? old?.targetId) !== undefined
          ? { targetId: remote ? old!.targetId : event.targetId ?? old?.targetId } : {}),
        ...((remote ? old?.targetKey : event.targetKey ?? old?.targetKey)
          ? { targetKey: remote ? old!.targetKey : event.targetKey ?? old?.targetKey } : {}),
        ...((remote ? old?.operation : event.operation) ? { operation: remote ? old!.operation : event.operation } : {}),
        startedAtSimMs: interval.startedAtSimMs,
        ...(completedAtSimMs !== undefined ? { completedAtSimMs } : {}),
        visibleStartSimMs: Math.max(startSimMs, interval.startedAtSimMs),
        visibleEndSimMs: Math.min(endSimMs, completedAtSimMs ?? endSimMs),
        status: remote ? "out_of_view" : completedAtSimMs === undefined ? "pending" : event.status,
        evidenceSequences: [...(old?.evidenceSequences ?? []), event.sequence!] });
    }
    const presenceAtTime=[...new Map(presence.map(state=>[state.atSimMs,state])).values()];
    for (const [id, action] of actions) {
      const absent = presenceAtTime.find(state => state.atSimMs >= Math.max(startSimMs,action.startedAtSimMs) && !state.scene?.actors.some(a => a.id === action.actorId
        && (!action.actorKey || !a.identityKey || a.identityKey === action.actorKey)));
      if (!absent || absent.atSimMs >= action.visibleEndSimMs) continue;
      if (absent.atSimMs <= startSimMs) actions.delete(id);
      else actions.set(id, { ...action, visibleEndSimMs: absent.atSimMs, status: "out_of_view" });
    }
    return { status: "ready", window: immutable({ sourceId: this.source!, roomId, startSimMs, endSimMs,
      startSequence, endSequence, states, events, actions: [...actions.values()], ...(terminal ? { terminal: true } : {}) }) };
  }
  /** Historical playback only. Restoring cannot reopen callbacks or append a new
   * live world onto an old source. Start a fresh history/source for resumed ECS. */
  checkpoint(): Tape { return structuredClone({ schema: 1, sourceId: this.source, limits: this.limits, captures: this.captures, events: this.events }); }
  static restore(tape: Tape): CommittedSceneHistory {
    if (tape?.schema !== 1 || !Array.isArray(tape.captures) || !Array.isArray(tape.events)) throw new Error("Invalid scene history tape.");
    const history = new CommittedSceneHistory(tape.limits);
    if (tape.captures.length > history.limits.maxCaptures || tape.events.length > history.limits.maxEvents) throw new Error("Oversized scene history tape.");
    for (const c of tape.captures) {
      if (c.atSimMs !== c.scenes[0]?.elapsedMs || c.tick !== c.scenes[0]?.sourceTick) throw new Error("Inconsistent restored source clocks.");
      // Reapply the public allowlist and order checks. Events retain their real
      // original capture sequence, including baseline predecessors.
      history.append({ sequence: c.sequence, scenes: c.scenes.map(s => ({ ...s, events: [] })) });
    }
    if (history.source !== tape.sourceId) throw new Error("Restored source identity mismatch.");
    for (const item of tape.events) {
      const c = history.captures.find(c => c.sequence === item.captureSequence);
      const scene = item.witness ?? c?.scenes.find(s => s.room.id === item.event.roomId);
      if (!scene || scene.sourceId !== tape.sourceId || item.event.elapsedMs > (c?.atSimMs ?? history.captures.at(-1)?.atSimMs ?? -1)
        || !integer(item.event.sequence!) || !integer(item.captureSequence)
        || item.captureSequence > (history.captures.at(-1)?.sequence ?? -1)
        || item.witness && (scene.elapsedMs !== item.event.elapsedMs || scene.sourceTick !== item.event.sourceTick))
        throw new Error("Restored event has no committed local source.");
      const event = snapshotDirectorScene({ ...scene, events: [item.event] }).events[0];
      if (!event || JSON.stringify(event) !== JSON.stringify(item.event) || history.events.some(e => e.event.id === event.id || e.event.sequence === event.sequence))
        throw new Error("Invalid restored public event.");
      const restoredEvent = immutable({ captureSequence: item.captureSequence, event,
        ...(item.witness ? { witness: snapshotDirectorScene({ ...item.witness, events: [] }) } : {}) });
      const bytes = history.bytes(restoredEvent);
      if (history.retainedBytes + bytes > history.limits.maxBytes) throw new Error("Oversized restored history payload.");
      history.events.push(restoredEvent); history.retainedBytes += bytes;
      history.lastEventSequence = Math.max(history.lastEventSequence, event.sequence!);
    }
    history.events.sort((a, b) => a.event.elapsedMs - b.event.elapsedMs || a.event.sequence! - b.event.sequence!);
    history.stop(); return history;
  }
}
