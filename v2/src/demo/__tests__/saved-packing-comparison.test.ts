import { repackSavedPerformance } from "../repack-saved-performance";
import { selectPackedPerformance } from "../sitcom-director";
import type { Screenplay } from "../sitcom-screenplay";
import { buildSitcomPerformance } from "../sitcom-performance";
const words="A long spoken line should survive both packet sizes without repeating any of its words.".split(" ")
  .map((text,i,a)=>({sequence:i+1,atSimMs:700+i*420,text:text+(i===a.length-1?"":" ")}));
const scripts=[{sourceStartSimMs:0,sourceEndSimMs:10000,beats:[{kind:"speech",actorId:1,executionId:"line",
  atSimMs:0,endSimMs:words.at(-1)!.atSimMs,text:words.map(w=>w.text).join(""),evidence:words.map(w=>w.sequence),direction:"exact line"}]}] satisfies Pick<Screenplay,"beats"|"sourceStartSimMs"|"sourceEndSimMs">[];
test.each([5000,10000])("frozen ledger replay preserves exact word receipts at %ims without changing its input",ms=>{
  const before=JSON.stringify(scripts), r=repackSavedPerformance(scripts,words,ms);
  expect(r.failure).toBeNull(); expect(JSON.stringify(scripts)).toBe(before);
  const emitted=r.packets.flatMap(p=>p.beats.filter(b=>b.kind==="speech").flatMap(b=>b.evidence));
  expect(emitted).toEqual(words.map(w=>w.sequence));
  for(const p of r.packets) expect(p.performance.endingSilenceMs).toBeGreaterThanOrEqual(499.999);
});
test("a tampered saved transcript is refused before repacking",()=>{
  expect(()=>repackSavedPerformance(scripts,words.map((w,i)=>i===0?{...w,text:"Invented "}:w),10000)).toThrow(/disagrees/);
});
test("a completed resumed utterance is a complete candidate, not a reason for another fragment cut",()=>{
  const candidate=(end:number,hold:number,ending:"utterance_complete"|"phrase_boundary")=>({end,compiled:{script:{
    ...scripts[0],version:1,opening:true,checkpoint:true,prompt:"fixture",directedIntervals:[],
    beats:[{...scripts[0].beats[0],speechSlice:{executionId:"line",firstWordSequence:1,lastWordSequence:15,starts:"resumes_utterance" as const,ends:ending}}],
    performance:{...buildSitcomPerformance(scripts[0].beats,0,10000,10000),endingSilenceMs:hold}} satisfies Screenplay}});
  const complete=candidate(8000,1800,"utterance_complete"), fragment=candidate(8500,1300,"phrase_boundary");
  expect(selectPackedPerformance([fragment,complete])).toBe(complete);
});
