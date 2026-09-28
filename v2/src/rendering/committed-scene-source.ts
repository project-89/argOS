import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { WorkingMemoryIdentity } from "../ecs/components";
import { getSimulationBoundary, subscribeSimulationBoundaries, type SimulationBoundary } from "../runtime/simulation-timeline";
import { getCommittedEvents, startCommittedEvents, subscribeCommittedEvents, subscribeCommittedSourceStop, type PublicCommittedEvent } from "../runtime/committed-events";
import { CommittedSceneHistory, type CommittedSceneHistoryLimits, type SceneWindowResult, type SceneWorldWindowResult } from "./committed-scene-history";
import { snapshotDirectorScene, type SceneEvent, type SceneSnapshot } from "./scene-snapshot";

export type CommittedSceneSourceOptions = Readonly<{
  /** Authored public surfaces only, never introspection/private ECS snapshots. */
  captureScenes(): readonly SceneSnapshot[];
  historyLimits?: Partial<CommittedSceneHistoryLimits>;
}>;

export type CommittedSceneSource = Readonly<{
  sourceId: string;
  read(startSimMs: number, endSimMs: number, roomId: number): SceneWindowResult;
  readWorld(startSimMs: number, endSimMs: number): SceneWorldWindowResult;
  bounds(): Readonly<ReturnType<CommittedSceneHistory["bounds"]>>;
  status: ReturnType<typeof captureCommittedSceneHistory>["status"];
  /** Detach only this observation and seal its retained evidence. Never stops,
   * pauses or advances the world, or another consumer's attachment. */
  stop(): void;
}>;

function eventForScene(e: PublicCommittedEvent): SceneEvent {
  return { id: e.id, sequence: e.sequence, actorId: e.actorId, actorKey: e.actorKey, roomId: e.roomId, roomKey: e.roomKey,
    kind: e.kind, action: e.action, status: e.status, sourceTick: e.tick, elapsedMs: e.atSimMs,
    ...(e.targetId !== undefined ? { targetId: e.targetId, targetKey: e.targetKey } : {}),
    ...(e.text !== undefined ? { text: e.text } : {}),
    ...(e.operation !== undefined ? { operation: e.operation } : {}),
    ...(e.startedAtSimMs !== undefined ? { interval: { executionId: e.executionId, startedAtSimMs: e.startedAtSimMs,
      ...(e.expectedEndSimMs !== undefined ? { expectedEndSimMs: e.expectedEndSimMs } : {}),
      ...(e.completedAtSimMs !== undefined ? { completedAtSimMs: e.completedAtSimMs } : {}) } } : {}) };
}

/** Provider-independent read-only pull surface over actually committed world
 * time. Consumers own their cursors and choose intervals; no media duration,
 * prompt compiler, network transport or playback policy is imposed here.
 * Expired evidence is explicit, never replaced with the latest world state. */
export function attachCommittedSceneSource(world: World, options: CommittedSceneSourceOptions): CommittedSceneSource {
  if (getCommittedEvents(world).stopped)
    throw new Error("Cannot observe a stopped public source; the runtime owner must explicitly start a new epoch.");
  const history = new CommittedSceneHistory(options.historyLimits);
  const capture = captureCommittedSceneHistory(world, options, history);
  return Object.freeze({
    ...capture,
    read: (startSimMs: number, endSimMs: number, roomId: number) => history.assemble(startSimMs, endSimMs, roomId),
    readWorld: (startSimMs: number, endSimMs: number) => history.assembleWorld(startSimMs, endSimMs),
    bounds: () => Object.freeze(history.bounds()),
  });
}

/** @internal Shared capture implementation for the legacy renderer wrapper.
 * The mutable store remains owner-supplied, never exposed by a consumer handle.
 * Callback failures seal only this observation; native execution stays owned
 * by the runtime. Capture itself is synchronous and must remain bounded. */
export function captureCommittedSceneHistory(world: World, options: Pick<CommittedSceneSourceOptions, "captureScenes">,
  history: CommittedSceneHistory) {
  const sourceId = startCommittedEvents(world);
  let cursor = 0, stopped = false, error: "source_changed" | "event_retention_gap" | "capture_failed" | null = null;
  let errorDetail: string | null = null;
  let unsubscribe = () => {};
  let unsubscribeStop = () => {};
  let unsubscribeEvents = () => {};
  const witnesses = new Map<string, { event: SceneEvent; scene: SceneSnapshot }>();
  const identity = (eid: number) => hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || undefined : undefined;
  const stop = () => { if (stopped) return; stopped = true; unsubscribe(); unsubscribeStop(); unsubscribeEvents(); witnesses.clear(); history.stop(); };
  const project = (scene: SceneSnapshot, events: readonly PublicCommittedEvent[]) => snapshotDirectorScene({ ...scene, sourceId,
    room: { ...scene.room, identityKey: identity(scene.room.id) },
    actors: scene.actors.map(actor => ({ ...actor, identityKey: identity(actor.id) })),
    props: scene.props.map(prop => ({ ...prop, identityKey: identity(prop.id) })),
    events: events.filter(e => e.sourceId === sourceId && e.roomId === scene.room.id).map(eventForScene),
  }, { eventLimit: 512 });
  const capture = (boundary: SimulationBoundary, initial = false) => {
    if (stopped) return;
    const events = getCommittedEvents(world, cursor);
    if (events.sourceId !== sourceId) { error = "source_changed"; stop(); return; }
    if (events.stopped) { stop(); return; }
    if (events.gap && !initial) { error = "event_retention_gap"; stop(); return; }
    try {
      const scenes = options.captureScenes().map(scene => {
        if (scene.elapsedMs !== boundary.atSimMs || scene.sourceTick !== boundary.tick)
          throw new Error("Public scene capture does not match its committed boundary.");
        return project(scene, events.events.filter(e => !witnesses.has(e.id)));
      });
      history.append({ sequence: boundary.sequence, scenes, eventWitnesses: [...witnesses.values()] });
      cursor = events.latestSequence;
      witnesses.clear();
    } catch (cause) { error = "capture_failed"; errorDetail = cause instanceof Error ? cause.message.slice(0, 300) : "Unknown scene capture failure"; stop(); }
  };
  capture(getSimulationBoundary(world), true);
  if (!stopped) unsubscribe = subscribeSimulationBoundaries(world, capture);
  if (!stopped) unsubscribeStop = subscribeCommittedSourceStop(world, stop);
  if (!stopped) unsubscribeEvents = subscribeCommittedEvents(world, event => {
    if (stopped || event.sourceId !== sourceId) return;
    try {
      if (witnesses.size >= 512) { error = "event_retention_gap"; stop(); return; }
      const local = options.captureScenes().find(scene => scene.room.id === event.roomId);
      if (!local) return; // A single-room camera never fetches a remote scene.
      if (local.elapsedMs !== event.atSimMs || local.sourceTick !== event.tick) throw new Error("Event-local source mismatch.");
      const scene = project(local, [event]), publicEvent = scene.events[0];
      if (publicEvent) witnesses.set(event.id, { event: publicEvent,
        scene: { ...scene, events: [], actors: scene.actors.filter(actor => actor.id === event.actorId || actor.id === event.targetId),
          props: scene.props.filter(prop => prop.id === event.targetId || prop.id === scene.props.find(target => target.id === event.targetId)?.supportId
            || prop.heldBy !== undefined && (prop.heldBy === event.actorId || prop.heldBy === event.targetId)) } });
    } catch (cause) { error = "capture_failed"; errorDetail = cause instanceof Error ? cause.message.slice(0, 300) : "Unknown event witness failure"; stop(); }
  });
  return Object.freeze({ sourceId, stop, status: () => Object.freeze({
    sourceId, stopped, error, errorDetail, history: Object.freeze(history.bounds()), eventCursor: cursor,
  }) });
}
