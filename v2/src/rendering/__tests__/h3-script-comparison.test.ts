import {scriptComparisonConfigs,scriptComparisonLines,nextScriptComparisonUpdate,positiveEndingConfig,positiveSpeechEnding,timedEndingConfig} from "../h3-script-comparison";
test("timed ending preserves baseline and replaces each speaking direction after four seconds",()=>{
  const {script,...config}=timedEndingConfig();
  const {script:baseline,...base}=scriptComparisonConfigs().preloaded;
  expect(config).toEqual(base);
  expect(script.filter((_,i)=>i%2===0)).toEqual(baseline);
  expect(script.filter((_,i)=>i%2===1)).toEqual(baseline.map(b=>({offset:b.offset+4,prompt:"Alex quietly watches the street through the window."})));
});
test("facing-camera variant changes only quiet-action beat text",()=>{
  const {script,...config}=timedEndingConfig(true);
  const {script:baseline,...base}=timedEndingConfig();
  expect(config).toEqual(base);
  expect(script).toEqual(baseline.map((b,i)=>i%2 ? {...b,prompt:"Alex remains facing the camera, quietly resting her hands on the table."}:b));
});
test("positive ending changes only the post-line direction",()=>{
  const {script,...config}=positiveEndingConfig();
  const {script:baseline,...base}=scriptComparisonConfigs().preloaded;
  expect(config).toEqual(base);
  expect(script).toEqual(baseline.map(b=>({...b,prompt:b.prompt+positiveSpeechEnding})));
});
test("arms differ only in delivery of identical text beats",()=>{
  const {append,preloaded}=scriptComparisonConfigs();
  const {script:a,...ac}=append,{script:p,...pc}=preloaded;
  expect(ac).toEqual(pc);expect(a).toEqual([p[0]]);
  expect(p.map(b=>b.offset)).toEqual([0,10,20,30,40,50]);
  const updates=scriptComparisonLines.slice(1).map((_,i)=>nextScriptComparisonUpdate(i+1,i+1,i));
  expect([a[0].prompt,...updates.map(u=>u!.script[0].prompt)]).toEqual(p.map(b=>b.prompt));
  expect(updates.every(u=>u!.script_mode==="append"&&u!.script[0].offset===0)).toBe(true);
});
test("append admission and settlement bound the queue without resending",()=>{
  expect(nextScriptComparisonUpdate(1,0,0)).toBeUndefined();
  expect(nextScriptComparisonUpdate(1,1,0)?.prompt_version).toBe(2);
  expect(nextScriptComparisonUpdate(2,2,0)).toBeUndefined();
  expect(nextScriptComparisonUpdate(2,2,1)?.prompt_version).toBe(3);
  expect(nextScriptComparisonUpdate(6,6,6)).toBeUndefined();
});
