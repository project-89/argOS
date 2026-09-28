import type { SitcomChunk } from "./sitcom-presentation";

/** Transport calibration, chosen before any immutable performance is issued.
 * Native values come from captured rIUQMi chunks, not a configure duration knob.
 * Reject incompatible media rather than retiming lived events.
 */
export const H3_MEDIA_TIMING = Object.freeze({
  script_append: Object.freeze({ openingMediaMs: 10_000, continuationMediaMs: 10_000 }),
  chunk_ack: Object.freeze({ openingMediaMs: 10_125, continuationMediaMs: 8_500 }),
});

/** Explicit CLI selection wins over legacy environment configuration. */
export function sitcomH3LaunchOptions(args: readonly string[], env: { ARGOS_H3_SCRIPT_QUEUE?: string; ARGOS_H3_CHUNK_SECONDS?: string; ARGOS_H3_MEMORY?: string }) {
  if (args.includes("--h3-direct") && args.includes("--h3-script")) throw new Error("Choose one H3 transport");
  const scriptQueue = args.includes("--h3-script") || !args.includes("--h3-direct") && env.ARGOS_H3_SCRIPT_QUEUE !== "0";
  const seconds = env.ARGOS_H3_CHUNK_SECONDS === undefined ? undefined : validateH3ChunkSeconds(Number(env.ARGOS_H3_CHUNK_SECONDS));
  if (!scriptQueue && seconds !== undefined && seconds !== 10) throw new Error("Direct H3 is calibrated only at 10 seconds; other durations require native scripts");
  const memory = env.ARGOS_H3_MEMORY === undefined ? undefined : validateH3Memory(Number(env.ARGOS_H3_MEMORY));
  return { scriptQueue, ...(seconds === undefined ? {} : { h3ChunkSeconds: seconds }),
    ...(memory === undefined ? {} : { h3Memory: memory }) };
}

/** Immutable provider history setting. Keep the established default until a
 * matched video experiment supports changing it; never rewrite a live session. */
export function validateH3Memory(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50)
    throw new Error("H3 prompt history must be a whole number from 1 through 50");
  return value;
}

/** Admission is not session readiness. In particular, initial script admission
 * can arrive before configured; it must not release a successor then. */
export function isH3SetupAcknowledgement(message: Record<string,unknown>): boolean {
  return message.type === "configured" && message.prompt_version === 1;
}

export function sitcomPromptMessage(segment: { version: number; prompt: string }, scriptQueue: boolean) {
  return scriptQueue
    ? { type: "prompt", script: [{ offset: 0, prompt: segment.prompt }], script_mode: "append", prompt_version: segment.version }
    : { type: "prompt", prompt: segment.prompt, prompt_version: segment.version, replan: true };
}

/** Session-level opt-in: require the provider's configured receipt.
 * Fal advertises integer 5–15s; only 5/10 have local live evidence so far.
 * The strict configure schema omits this advertised knob. Fail closed if it
 * is ignored. This does not authorize per-prompt duration reconfiguration.
 */
export function validateH3ChunkSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 5 || value > 15)
    throw new Error("H3 chunk seconds must be a whole number from 5 through 15");
  return value;
}
export function confirmH3ChunkSeconds(message: Record<string, unknown>, requested: number): void {
  validateH3ChunkSeconds(requested);
  if (message.type !== "configured" || message.chunk_duration !== requested)
    throw new Error(`H3 did not confirm the requested ${requested}-second chunk duration`);
}

/** Fal has two version namespaces: the premise prompt and the active script.
 * In append mode the premise can remain at1 while script2 supplies the footage.
 * Normalize only at the transport boundary; retain both raw IDs in telemetry.
 * This chooses an issued source map, never proves that H3 depicted its content.
 */
export function h3ChunkForPlayback(message: Record<string, unknown>, scriptQueue: boolean,
  issuedVersions: readonly number[], nativeChunkSeconds: number = 10): SitcomChunk {
  if (scriptQueue) validateH3ChunkSeconds(nativeChunkSeconds);
  const version = scriptQueue ? message.script_version : message.prompt_version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || !issuedVersions.includes(version))
    throw new Error(scriptQueue ? "H3 chunk has no issued native script identity" : "H3 chunk has no issued prompt identity");
  if (typeof message.chunk_index !== "number" || !Number.isSafeInteger(message.chunk_index) || message.chunk_index < 0 || message.chunk_index >= 1024
    || typeof message.playback_seconds !== "number" || !Number.isFinite(message.playback_seconds)
    || message.playback_seconds <= 0 || message.playback_seconds > 30)
    throw new Error("Invalid H3 chunk timing metadata");
  if (scriptQueue && Math.abs(message.playback_seconds * 1000 - nativeChunkSeconds * 1000) > 250)
    throw new Error(`H3 native chunk timing differs from the ${nativeChunkSeconds}-second script calibration`);
  if (!scriptQueue) {
    const expected = message.chunk_index === 0 ? H3_MEDIA_TIMING.chunk_ack.openingMediaMs : H3_MEDIA_TIMING.chunk_ack.continuationMediaMs;
    if (nativeChunkSeconds !== 10 || Math.abs(message.playback_seconds * 1000 - expected) > 250)
      throw new Error("H3 direct chunk timing differs from the immutable performance calibration");
  }
  return Object.freeze({ chunk_index: message.chunk_index, playback_seconds: message.playback_seconds, prompt_version: version });
}
