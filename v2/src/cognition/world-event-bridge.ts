import type { World } from "../ecs/world";
import { query } from "bitecs";
import { Agent, Name, Room } from "../ecs/components";
import { broadcastToRoom, queueStimulus, type SensoryModality } from "./stimulus-queue";

export type WorldEvent = { type: string; data: any; timestamp: number };

function isSensoryModality(value: unknown): value is SensoryModality {
  return (
    value === "visual" ||
    value === "auditory" ||
    value === "olfactory" ||
    value === "tactile" ||
    value === "cognitive"
  );
}

function findAgentEidByName(world: World, name: string): number | undefined {
  const wanted = String(name || "").trim();
  if (!wanted) return undefined;
  for (const eid of Array.from(query(world, [Agent]))) {
    if (Name.value[eid] === wanted) return eid;
  }
  return undefined;
}

function findRoomEidByName(world: World, name: string): number | undefined {
  const wanted = String(name || "").trim();
  if (!wanted) return undefined;
  for (const eid of Array.from(query(world, [Room]))) {
    if (Name.value[eid] === wanted) return eid;
  }
  return undefined;
}

function normalizeSource(data: any): string {
  return String(data?.source || data?.agent || data?.speaker || "system");
}

function normalizeContent(data: any, fallback?: string): string {
  const content = typeof data?.content === "string" ? data.content : fallback;
  return String(content || "").trim();
}

function normalizeStimulusType(data: any): { type: string; modality?: SensoryModality } {
  // Many systems emit `ctx.emit("stimulus", { type: "visual" | "cognitive" | ... })` where `type` is
  // actually the modality. Others use `type` as a subtype (e.g. "speech", "sound").
  const raw = typeof data?.type === "string" ? data.type.trim() : "";
  const rawModality = typeof data?.modality === "string" ? data.modality.trim() : "";

  const modality = isSensoryModality(rawModality)
    ? rawModality
    : isSensoryModality(raw)
      ? raw
      : undefined;

  // If `type` was used for modality, default the subtype to "stimulus" so prompts don't show redundant "visual: ..."
  const type = modality && raw === modality ? "stimulus" : (raw || "stimulus");

  return { type, modality };
}

/**
 * Bridge ECS/system `ctx.emit(...)` events into the cognition stimulus queue.
 *
 * Without this, systems can emit "stimulus" events but agents never perceive them,
 * because `runWorldTickAt()` drains the system event buffer each tick.
 */
export function bridgeWorldEventsToStimuli(world: World, events: WorldEvent[]): { queued: number } {
  let queued = 0;

  for (const ev of events) {
    const data = ev?.data ?? {};
    const evType = String(ev?.type || "").trim();

    // Direct per-agent stimulus payloads.
    if (evType === "stimulus" || evType.endsWith("_stimulus")) {
      const targetEid =
        typeof data?.targetEid === "number"
          ? data.targetEid
          : typeof data?.target === "string"
            ? findAgentEidByName(world, data.target)
            : undefined;

      const roomEid =
        typeof data?.roomEid === "number"
          ? data.roomEid
          : typeof data?.room === "string"
            ? findRoomEidByName(world, data.room)
            : undefined;

      const { type, modality } = normalizeStimulusType(data);
      const content = normalizeContent(data);
      const source = normalizeSource(data);

      if (!content) continue;

      if (targetEid !== undefined) {
        queueStimulus({ targetEid, type, modality, content, source, intensity: data?.intensity });
        queued++;
      } else if (roomEid !== undefined) {
        broadcastToRoom(world, roomEid, { type, modality, content, source, intensity: data?.intensity });
        queued++;
      }
      continue;
    }

    // Convenience: systems may emit `speech` / `description` / `broadcast` with a similar shape.
    if (evType === "speech" || evType === "description" || evType === "broadcast") {
      const targetEid =
        typeof data?.targetEid === "number"
          ? data.targetEid
          : typeof data?.target === "string"
            ? findAgentEidByName(world, data.target)
            : undefined;

      const roomEid =
        typeof data?.roomEid === "number"
          ? data.roomEid
          : typeof data?.room === "string"
            ? findRoomEidByName(world, data.room)
            : undefined;

      const content = normalizeContent(data, typeof data?.message === "string" ? data.message : undefined);
      const source = normalizeSource(data);
      if (!content) continue;

      const modality = isSensoryModality(data?.modality)
        ? (data.modality as SensoryModality)
        : evType === "speech"
          ? "auditory"
          : "visual";

      if (targetEid !== undefined) {
        queueStimulus({ targetEid, type: evType, modality, content, source });
        queued++;
      } else if (roomEid !== undefined) {
        broadcastToRoom(world, roomEid, { type: evType, modality, content, source });
        queued++;
      }
      continue;
    }
  }

  return { queued };
}

