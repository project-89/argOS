import {readFile,writeFile,mkdtemp} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {repackSavedPerformance} from "./repack-saved-performance";
import type {Screenplay} from "./sitcom-screenplay";
const directory=resolve(process.argv[2]), output=await mkdtemp(resolve("recordings/saved-packing-comparison-"));
const raw=await readFile(resolve(directory,"screenplay.json"),"utf8"), scripts=JSON.parse(raw) as Screenplay[];
const journal=await readFile(resolve(directory,"public-events.jsonl"),"utf8");
const words=journal.trim().split("\n").map(line=>JSON.parse(line)).filter(e=>e.kind==="speech"&&e.status==="succeeded"&&e.text);
const results=[];
for (const seconds of [5,10]) {
  const result=repackSavedPerformance(scripts,words,seconds*1000);
  const actual=result.packets.flatMap(p=>p.beats.filter(b=>b.kind==="speech").flatMap(b=>b.evidence));
  const expected=result.ledger.filter(b=>b.kind==="speech").flatMap(b=>b.evidence);
  const emitted=result.packets.flatMap(p=>p.beats);
  const keys=(beats:typeof emitted,kind:string)=>beats.filter(b=>b.kind===kind).flatMap(b=>b.evidence).sort((a,b)=>a-b);
  const gestures=(beats:typeof emitted)=>beats.filter(b=>b.kind==="action"&&b.endSimMs!==undefined
    && ["reading","typing","pickup","pouring","drinking"].includes(b.operation??""))
    .map(b=>JSON.stringify([b.executionId,b.actorId,b.operation,b.atSimMs,b.endSimMs])).sort();
  const summary={seconds,packets:result.packets.length,mediaSeconds:result.packets.length*seconds,
    endingHoldSeconds:result.packets.reduce((n,p)=>n+p.performance.endingSilenceMs/1000,0),
    wordCuts:result.packets.filter(p=>p.cut==="word").length,clauseCuts:result.packets.filter(p=>p.cut==="clause").length,
    exactSpeechEvidence:JSON.stringify([...actual].sort((a,b)=>a-b))===JSON.stringify([...expected].sort((a,b)=>a-b)),
    duplicateSpeechEvidence:actual.length-new Set(actual).size,failure:result.failure};
  Object.assign(summary,{exactSoundEvidence:JSON.stringify(keys(emitted,"sound"))===JSON.stringify(keys(result.ledger,"sound")),
    exactEssentialGestures:JSON.stringify(gestures(emitted))===JSON.stringify(gestures(result.ledger))});
  results.push(summary); await writeFile(resolve(output,`${seconds}s.json`),JSON.stringify(result,null,2),{flag:"wx",mode:0o600});
}
const report={source:directory,sha256:createHash("sha256").update(raw).digest("hex"),
  scope:"Frozen issued public performance ledger, not full historical scene replay or live admission timing. No NPC inference.",results};
await writeFile(resolve(output,"summary.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
console.log(output);console.log(JSON.stringify(report,null,2));
