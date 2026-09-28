/** One frozen public screenplay; no simulation or re-authored dialogue. */
import { directorConfigure } from "./director-projection";
import type { Screenplay } from "../demo/sitcom-screenplay";
export function recordedReplay(scripts: readonly Screenplay[]) {
  if (!Array.isArray(scripts) || !scripts.length || scripts.length > 20) throw new Error("Bounded screenplay required");
  let cursor = 0;
  for (const s of scripts) {
    if (s.version !== scripts.indexOf(s) + 1 || s.performance.clock !== "realtime" || !s.prompt?.trim()
      || s.prompt.length > 12000 || s.sourceStartSimMs !== cursor || !Number.isFinite(s.sourceEndSimMs)
      || s.sourceEndSimMs <= cursor || s.sourceEndSimMs - cursor !== s.performance.durationMs)
      throw new Error("Replay requires contiguous real-time public prompts");
    cursor = s.sourceEndSimMs;
  }
  if (cursor > 120000) throw new Error("Replay capped at 120 seconds");
  return { configure: { ...directorConfigure(scripts[0].prompt), chunk_duration: 10 },
    updates: scripts.slice(1).map(s => ({ type: "prompt", prompt_version: s.version, replan: true, prompt: s.prompt })),
    expectedChunks: scripts.map(s => ({ version: s.version, seconds: s.performance.durationMs / 1000 })),
    playbackSeconds: cursor / 1000, wallMs: 180000 };
}
