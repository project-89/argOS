/** Frozen single-speaker fixture. Only script delivery differs between arms. */
export const scriptComparisonLines = [
  "The blue envelope arrived this morning.",
  "I left the brass key beside the window.",
  "Our train leaves at seven on Tuesday.",
  "The garden gate needs a fresh coat of paint.",
  "I ordered tomato soup for lunch.",
  "Please put the green notebook on the shelf.",
];
const premise = "A continuous naturalistic scene in a quiet apartment. Alex is an adult woman with short dark hair, wearing a green sweater, seated at a wooden table. Locked medium shot of Alex. Preserve her face, voice, clothing and position. Natural conversational delivery and quiet room tone.";
export function scriptComparisonConfigs() {
  const base = {type:"configure",protocol_version:1,prompt_version:1,prompt:premise,
    chunk_duration:10,resolution:"480p",aspect_ratio:"16:9",memory:12,seed:891209};
  const beats = scriptComparisonLines.map((line,index)=>({offset:index*10,prompt:`Alex says: ${JSON.stringify(line)}`}));
  return {append:{...base,script:[beats[0]]},preloaded:{...base,script:beats}};
}
export function nextScriptComparisonUpdate(sent: number, admitted: number, settled: number) {
  if(sent>admitted || sent-settled>=2 || sent>=scriptComparisonLines.length)return undefined;
  return {type:"prompt",prompt_version:sent+1,script_mode:"append",
    script:[{offset:0,prompt:`Alex says: ${JSON.stringify(scriptComparisonLines[sent])}`}]};
}

export const positiveSpeechEnding = " After speaking, Alex looks out the window quietly.";
export function timedEndingConfig(faceCamera = false) {
  const baseline = scriptComparisonConfigs().preloaded;
  return {...baseline,script:baseline.script.flatMap(beat=>[beat,
    {offset:beat.offset+4,prompt:faceCamera ? "Alex remains facing the camera, quietly resting her hands on the table." : "Alex quietly watches the street through the window."}])};
}
export function positiveEndingConfig() {
  const baseline = scriptComparisonConfigs().preloaded;
  return {...baseline,script:baseline.script.map(beat=>({...beat,prompt:beat.prompt+positiveSpeechEnding}))};
}
