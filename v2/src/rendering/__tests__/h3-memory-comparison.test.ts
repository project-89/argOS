import {memoryComparisonFromSaved,nextPreparedScriptUpdate} from "../h3-memory-comparison";
const rows=()=>[
  {message:{type:"configure",protocol_version:1,prompt_version:1,prompt:"Public premise",resolution:"768p",aspect_ratio:"16:9",chunk_duration:10,memory:12,script:[{offset:0,prompt:"Public opening"}]}},
  ...Array.from({length:5},(_,i)=>({message:{type:"prompt",prompt_version:i+2,script_mode:"append",script:[{offset:0,prompt:`Saved line ${i+2}`} ]}})),
];
test("matched comparison changes only history; preserves every saved prompt and append update",()=>{
  const input=rows(),before=JSON.stringify(input),result=memoryComparisonFromSaved(input);
  const {memory:a,...ca}=result.configs.memory12,{memory:b,...cb}=result.configs.memory1;
  expect([a,b]).toEqual([12,1]);expect(ca).toEqual(cb);
  expect(ca.script).toEqual(input[0].message.script);
  expect(result.updates).toEqual(input.slice(1).map(r=>r.message));
  expect(JSON.stringify(input)).toBe(before);
  expect(result.limits).toEqual({sessions:2,perMode:1,playbackSeconds:60,wallMs:120000,retries:0});
});
test("one bounded successor, no repeats, and stop after six packets",()=>{
  const {updates}=memoryComparisonFromSaved(rows());
  expect(nextPreparedScriptUpdate(updates,1,0,0)).toBeUndefined();
  expect(nextPreparedScriptUpdate(updates,1,1,0)?.prompt_version).toBe(2);
  expect(nextPreparedScriptUpdate(updates,2,2,0)).toBeUndefined();
  expect(nextPreparedScriptUpdate(updates,2,2,1)?.prompt_version).toBe(3);
  expect(nextPreparedScriptUpdate(updates,6,6,6)).toBeUndefined();
});
test("reject incompatible or non-text evidence rather than changing it for a replay",()=>{
  expect(()=>memoryComparisonFromSaved(rows().slice(0,5))).toThrow();
  for(const patch of [{chunk_duration:5},{audio_url:"private"},{image_url:"unrequested"},{seed:NaN}]){
    const input=rows();Object.assign(input[0].message,patch);expect(()=>memoryComparisonFromSaved(input)).toThrow();
  }
  const input=rows(); input[2].message.prompt_version=2;expect(()=>memoryComparisonFromSaved(input)).toThrow(/sequence/);
  const bad=rows();bad[1].message.script[0].offset=1;expect(()=>memoryComparisonFromSaved(bad)).toThrow(/offset/);
});
