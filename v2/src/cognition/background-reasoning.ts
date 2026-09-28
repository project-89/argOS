import { foregroundProviderStats } from "./provider-telemetry";
import { getSimulationTaskSignal } from "../runtime/task-scope";

/** Scoped experiment knob: does not change foreground or immediate appraisal. */
export function backgroundThinkingLevel(): "low" | "medium" | "high" {
  const level=process.env.ARGOS_BACKGROUND_THINKING ?? "medium";
  if(level!=="low" && level!=="medium" && level!=="high") throw new Error("ARGOS_BACKGROUND_THINKING must be low, medium or high");
  return level;
}

/** Provider output limits include hidden reasoning, not just the JSON answer.
 * Preserve low's old limits; reserve headroom for deeper reasoning. Wall-clock
 * deadlines and semantic admission still independently bound these requests. */
export function backgroundOutputTokens(faculty:"planning"|"reflection",level:"low"|"medium"|"high"):number {
  return level==="high"?8192:level==="medium"?4096:faculty==="planning"?2200:1500;
}

/** Slow work has its own lane; it still expires and must pass source checks. */
export function backgroundDeadlineMs(faculty:"planning"|"reflection",level:"low"|"medium"|"high"):number {
  if(level==="low") return faculty==="planning"?10_000:12_000;
  if(level==="medium") return faculty==="planning"?15_000:20_000;
  return faculty==="planning"?20_000:30_000;
}

/** Only whitelisted metrics, never prompts, private thoughts or error bodies. */
export async function observeBackgroundProvider<T>(faculty:"planning"|"reflection", actorId:number, level:string, call:()=>Promise<T>):Promise<T>{
  const began=performance.now();
  const report=(outcome:"returned"|"timeout"|"cancelled"|"error",response?:unknown)=>{
    try{console.log("[BackgroundProvider]",JSON.stringify({faculty,actorId,thinkingLevel:level,
      ...foregroundProviderStats(performance.now()-began,outcome,response)}));}catch{/* Diagnostics cannot affect admission. */}
  };
  try{const result=await call();report("returned",result);return result;}
  catch(error){const name=error instanceof Error?error.name:"";
    report(getSimulationTaskSignal()?.aborted?"cancelled":["AbortError","TimeoutError"].includes(name)?"timeout":"error");throw error;}
}
