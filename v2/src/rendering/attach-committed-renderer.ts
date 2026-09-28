import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { CommittedSceneRenderer } from "./committed-scene-renderer";
import { CommittedSceneHistory, type CommittedSceneHistoryLimits } from "./committed-scene-history";
import { captureCommittedSceneHistory } from "./committed-scene-source";
import type { SceneSnapshot } from "./scene-snapshot";

/** Existing H3-capable wrapper over the provider-independent public source.
 * Keeps its established source windows, prompt issuance and acknowledgement
 * behavior; neither capture nor transport settlement advances the world. */
export function attachCommittedSceneRenderer(world: World, options: {
  roomId: number; windowMs?: number; captureScenes(): readonly SceneSnapshot[];
  historyLimits?: Partial<CommittedSceneHistoryLimits>;
}) {
  const history = new CommittedSceneHistory(options.historyLimits);
  const renderer = new CommittedSceneRenderer({ roomId: options.roomId, windowMs: options.windowMs,
    startSimMs: readSimulationTime(world) }, history);
  const source = captureCommittedSceneHistory(world, options, history);
  return { renderer, sourceId: source.sourceId, stop: source.stop,
    status: () => ({ ...source.status(), sourcePlayheadSimMs: renderer.snapshot().sourcePlayheadSimMs }) };
}
