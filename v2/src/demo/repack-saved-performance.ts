/** Offline diagnostic over a frozen public performance ledger. This is NOT
 * full scene-history replay, live admission simulation, or a new controller. */
import { buildSitcomPerformance, ESSENTIAL_PHYSICAL_OPERATIONS, PerformanceBudgetError } from "./sitcom-performance";
import type { ScreenBeat, Screenplay } from "./sitcom-screenplay";

type Word = { sequence: number; atSimMs: number; text: string };
export function repackSavedPerformance(scripts: readonly Pick<Screenplay,"beats"|"sourceStartSimMs"|"sourceEndSimMs">[], words: readonly Word[], durationMs: number) {
  const original = scripts.flatMap(s => s.beats), ledger: ScreenBeat[] = [];
  for (const b of original) {
    const prior = b.kind === "speech" && b.executionId ? ledger.findIndex(x => x.kind === "speech"
      && x.executionId === b.executionId && x.actorId === b.actorId) : -1;
    if (prior < 0) ledger.push({ ...b });
    else {
      const a = ledger[prior];
      ledger[prior] = { ...a, text: `${a.text} ${b.text}`, endSimMs: b.endSimMs,
        evidence: [...a.evidence, ...b.evidence], speechSlice: undefined };
    }
  }
  const start = scripts[0].sourceStartSimMs, end = scripts.at(-1)!.sourceEndSimMs;
  const spoken = ledger.filter(b => b.kind === "speech");
  for (const b of spoken) {
    const delivered = words.filter(w => b.evidence.includes(w.sequence));
    if (delivered.map(w => w.text).join("").trim() !== b.text?.trim()) throw new Error("Saved speech disagrees with its native word evidence");
  }
  const protectedBeats = ledger.filter(b => b.kind === "action" && b.endSimMs !== undefined
    && ESSENTIAL_PHYSICAL_OPERATIONS.some(op => op === b.operation));
  const packets: Array<{ start: number; end: number; cut: string; beats: ScreenBeat[]; performance: ReturnType<typeof buildSitcomPerformance> }> = [];
  const lastSound = new Map<string,{source:number;media:number}>();
  let cursor = start, mediaCursor = 0;
  while (cursor < end && packets.length < 1024) {
    const limit = Math.min(end, cursor + 20000);
    const whole = [Math.min(end,cursor + durationMs),limit,...ledger.flatMap(b => [b.atSimMs,(b.endSimMs ?? b.atSimMs)+.001])];
    const cuts = [
      ...whole.map(at => ({at,kind:"whole"})),
      ...words.filter(w => /[.!?;,:—]\s*$/u.test(w.text)).map(w => ({at:w.atSimMs+.001,kind:"clause"})),
      ...words.map(w => ({at:w.atSimMs+.001,kind:"word"})),
    ].filter(c => c.at > cursor && c.at <= limit && !protectedBeats.some(b => b.atSimMs < c.at && b.endSimMs! >= c.at && c.at !== end));
    const viable: typeof packets = []; let lastFailure = "No safe candidate";
    for (const cut of cuts) {
      if (cut.kind === "word" && viable.some(p=>p.cut!=="word")) break;
      if (cut.kind === "whole" && spoken.some(b => b.atSimMs < cut.at && b.endSimMs! >= cut.at && cut.at !== end)) continue;
      const beats: ScreenBeat[] = [];
      for (const b of ledger) {
        const to = b.endSimMs ?? b.atSimMs;
        if (b.kind === "speech") {
          const evidence = words.filter(w => b.evidence.includes(w.sequence) && w.atSimMs >= cursor && (w.atSimMs < cut.at || cut.at === end && w.atSimMs === end));
          if (!evidence.length) continue;
          beats.push({...b,atSimMs:Math.max(cursor,b.atSimMs),endSimMs:evidence.at(-1)!.atSimMs,
            text:evidence.map(w=>w.text).join("").trim(),evidence:evidence.map(w=>w.sequence)});
        } else if (to > b.atSimMs) {
          if (to > cursor && b.atSimMs < cut.at) beats.push({...b,atSimMs:Math.max(cursor,b.atSimMs),endSimMs:Math.min(to,cut.at)});
        } else if (b.atSimMs >= cursor && (b.atSimMs < cut.at || cut.at === end && b.atSimMs === end)) {
          const prior = b.soundKey ? lastSound.get(b.soundKey) : undefined;
          beats.push({...b,notBeforeMediaMs: prior ? Math.max(0,prior.media + b.atSimMs-prior.source-mediaCursor) : undefined});
        }
      }
      if (cut.at < Math.min(end,cursor+durationMs) && !beats.some(b => b.kind === "sound" || (b.endSimMs ?? b.atSimMs)>b.atSimMs)) continue;
      try {
        const performance = buildSitcomPerformance(beats,cursor,cut.at,durationMs,packets.length===0);
        viable.push({start:cursor,end:cut.at,cut:cut.kind,beats,performance});
      } catch(e) { if (!(e instanceof PerformanceBudgetError)) throw e; lastFailure=e.message; }
    }
    if (!viable.length) return {packets,failure:{cursor,detail:lastFailure},ledger};
    // Complete turns first, unless an extending clause removes >=1s of hold.
    viable.sort((a,b)=>a.performance.endingSilenceMs-b.performance.endingSilenceMs||b.end-a.end);
    const wholeBest=viable.find(p=>p.cut==="whole"), chosen=wholeBest
      ? viable.find(p=>p.end>wholeBest.end && p.performance.endingSilenceMs<=wholeBest.performance.endingSilenceMs-1000)??wholeBest : viable[0];
    packets.push(chosen);
    for (const cue of chosen.performance.cues) {
      const b=chosen.beats[cue.beat];
      if(b.kind==="sound"&&b.soundKey) lastSound.set(b.soundKey,{source:b.atSimMs,media:mediaCursor+cue.startMs});
    }
    cursor=chosen.end; mediaCursor+=durationMs;
  }
  return {packets,failure:cursor<end?{cursor,detail:"Packet limit"}:null,ledger};
}
