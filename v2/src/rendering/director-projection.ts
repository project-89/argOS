import type { AgentIntrospection } from "../introspection/introspection";

/** A renderer reads world state; it never writes visual inventions back to ECS. */
export function projectDirectorScene(seed: string, npc: AgentIntrospection, tick: number): string {
  return [
    "Render a continuous cinematic scene from this simulation snapshot.",
    "Preserve the same character appearance, clothing, architecture, and lighting across segments.",
    "Use subtle natural motion. Do not invent dialogue, arrivals, object transfers, or completed actions.",
    "Internal thoughts are not spoken dialogue. No subtitles or UI overlays.",
    `Setting: ${seed}`,
    `Subject: ${npc.name}. Role: ${npc.role}. Appearance/context: ${npc.description}`,
    `Confirmed current location: ${npc.room ?? "unspecified; keep the existing setting"}.`,
    `Simulation snapshot tick: ${tick}. Hold on the subject in this location with ambient sound.`,
  ].join("\n").slice(0, 50000);
}

export type DirectorResolution = "480p" | "768p" | "1080p";
export function validateDirectorResolution(value: unknown): DirectorResolution {
  if (value !== "480p" && value !== "768p" && value !== "1080p") throw new Error("Director resolution must be 480p, 768p or 1080p");
  return value;
}
export function confirmDirectorResolution(message: Record<string, unknown>, requested: DirectorResolution): void {
  validateDirectorResolution(requested);
  if (message.type !== "configured" || message.resolution !== requested)
    throw new Error(`Director did not confirm requested resolution ${requested}`);
}
export function directorConfigure(prompt: string, version = 1, resolution: DirectorResolution = "480p") {
  if (!prompt.trim()) throw new Error("Director requires a nonempty scene");
  return { type: "configure", protocol_version: 1, prompt, prompt_version: version,
    resolution: validateDirectorResolution(resolution), aspect_ratio: "16:9", memory: 12 } as const;
}

/** Explicit allowlist: the local proxy cannot be used to call other paid models. */
export function isDirectorProxyTarget(value: string): boolean {
  return ["https://wma.fal.run/ice", "https://wma.fal.run/session",
    "https://wma.fal.run/session/heartbeat"].includes(value);
}
