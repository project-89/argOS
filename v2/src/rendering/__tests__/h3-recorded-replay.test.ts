import { recordedReplay } from "../h3-recorded-replay";
import type { Screenplay } from "../../demo/sitcom-screenplay";
const script=(version:number,start:number,end:number)=>({version,prompt:`Exact public prompt ${version}`,
  sourceStartSimMs:start,sourceEndSimMs:end,performance:{clock:"realtime",durationMs:end-start}} as Screenplay);
test("frozen replay preserves prompts, production config and native duration expectations",()=>{
  const source=[script(1,0,10125),script(2,10125,18625)],before=JSON.stringify(source),r=recordedReplay(source);
  expect(r.configure).toMatchObject({prompt:source[0].prompt,chunk_duration:10,resolution:"480p",memory:12});
  expect(r.configure).not.toHaveProperty("seed");expect(r.configure).not.toHaveProperty("script");
  expect(r.updates).toEqual([{type:"prompt",prompt_version:2,replan:true,prompt:source[1].prompt}]);
  expect(r.expectedChunks).toEqual([{version:1,seconds:10.125},{version:2,seconds:8.5}]);
  expect(r.playbackSeconds).toBe(18.625);expect(JSON.stringify(source)).toBe(before);
});
test("replay rejects gaps, oversized sessions and invalid version or source clocks",()=>{
  for(const s of [[],[script(2,0,8500)],[script(1,0,120001)],[script(1,0,8500),script(2,9000,17500)],
    [script(1,0,NaN)],[{...script(1,0,8500),prompt:""}]])expect(()=>recordedReplay(s)).toThrow();
});
