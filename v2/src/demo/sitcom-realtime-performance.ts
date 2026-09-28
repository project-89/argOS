import type { ScreenBeat } from "./sitcom-screenplay";
import type { SitcomPerformance, PerformanceShot } from "./sitcom-performance";

/** One camera, one real-time clock. Off-camera evidence stays in the screenplay;
 * it does not become a backlog of performances the viewer must sit through. */
export function buildRealtimePerformance(beats: readonly ScreenBeat[], start: number, end: number,
  durationMs: number, roomId: number): SitcomPerformance {
  if (![start,end,durationMs].every(Number.isFinite) || start < 0 || durationMs < 1000 || durationMs > 30000
    || Math.abs(end-start-durationMs) > .000001 || !Number.isSafeInteger(roomId))
    throw new Error("Realtime video requires equal positive source and media durations and a grounded camera room");
  const coverage: Array<{beat:number; disposition:"prompted"|"off_camera"|"competing_audio"}> = [];
  const selected = new Set<number>(), voices: ScreenBeat[] = [];
  const indices = beats.map((_,i)=>i).sort((a,b)=>(beats[a].sourceStartedAtSimMs??beats[a].atSimMs)
    -(beats[b].sourceStartedAtSimMs??beats[b].atSimMs) || a-b);
  for (const index of indices) {
    const beat=beats[index];
    const audibleOffscreen = beat.kind === "sound" && beat.audibleRoomIds?.includes(roomId);
    if(beat.roomId!==roomId && !audibleOffscreen) { coverage.push({beat:index,disposition:"off_camera"}); continue; }
    if(beat.kind==="speech") {
      if(!Number.isFinite(beat.endSimMs)||beat.endSimMs!<=beat.atSimMs)
        throw new Error("Realtime speech has no positive observed interval; retain evidence rather than invent its timing");
      if(voices.some(other=>other.atSimMs<(beat.endSimMs??beat.atSimMs)
        && (other.endSimMs??other.atSimMs)>beat.atSimMs)) {
        coverage.push({beat:index,disposition:"competing_audio"}); continue;
      }
      voices.push(beat);
    }
    selected.add(index); coverage.push({beat:index,disposition:"prompted"});
  }
  const clamp=(at:number)=>Math.max(0,Math.min(durationMs,at-start));
  const cues=beats.flatMap((beat,index)=>selected.has(index)?[Object.freeze({beat:index,
    startMs:clamp(beat.atSimMs),endMs:clamp(beat.kind==="sound"?beat.atSimMs+(beat.audibleDurationMs??800):beat.endSimMs??beat.atSimMs),
    evidence:Object.freeze([...beat.evidence])})]:[]);
  const boundaries=[...new Set([0,durationMs,...cues.flatMap(c=>[c.startMs,c.endMs])])].sort((a,b)=>a-b);
  const shots:PerformanceShot[]=[];
  for(let i=0;i<boundaries.length-1;i++) {
    const from=boundaries[i],to=boundaries[i+1];
    const active=cues.filter(c=>c.startMs<=from&&c.endMs>from&&beats[c.beat].actorId!==undefined);
    const physical=active.find(c=>beats[c.beat].kind==="action"&&["reading","typing","pickup","pouring","drinking"].includes(beats[c.beat].operation??""));
    // Dialogue owns a voice, not a fresh camera setup. Hold the local ensemble
    // through ordinary speech, reactions and movement; only a readable physical
    // operation earns an insert. Cue timing/coverage remain unchanged.
    const chosen=physical;
    const beat=chosen===undefined?undefined:beats[chosen.beat];
    const kind:PerformanceShot["kind"]=beat?.kind==="speech"?"speaker"
      : beat?.operation==="pickup"?"pickup": ["reading","typing"].includes(beat?.operation??"")?"interaction_insert"
      : ["pouring","drinking"].includes(beat?.operation??"")?"object_hands":beat?"action":"establish";
    const prior=shots.at(-1);
    if(prior&&prior.beat===chosen?.beat&&prior.kind===kind) shots[shots.length-1]={...prior,endMs:to};
    else shots.push({startMs:from,endMs:to,roomId,kind,...(chosen&&beat?{beat:chosen.beat,actorId:beat.actorId}:{})});
  }
  return Object.freeze({clock:"realtime" as const,durationMs,endingSilenceMs:0,
    sourceMap:Object.freeze([Object.freeze({mediaMs:0,sourceMs:start}),Object.freeze({mediaMs:durationMs,sourceMs:end})]),
    cues:Object.freeze(cues),shots:Object.freeze(shots.map(s=>Object.freeze(s))),
    coverage:Object.freeze(coverage.sort((a,b)=>a.beat-b.beat).map(c=>Object.freeze(c)))});
}
