import { buildRealtimePerformance } from "../sitcom-realtime-performance";
import { SitcomPlayback } from "../sitcom-presentation";
import { SitcomLivePacer } from "../sitcom-live-pacing";
import type { ScreenBeat } from "../sitcom-screenplay";

const speech=(actorId:number,roomId:number,start:number,end:number,text:string):ScreenBeat=>({kind:"speech",actorId,roomId,
  atSimMs:start,endSimMs:end,sourceStartedAtSimMs:start,text,direction:text,evidence:[actorId]});
test("alternating dialogue and ordinary movement hold one ensemble composition",()=>{
  const beats:ScreenBeat[]=[speech(1,10,0,2000,"Hello"),speech(2,10,2500,4500,"Hi"),speech(3,10,5000,7000,"Evening"),
    {kind:"action",actorId:2,roomId:10,atSimMs:3000,endSimMs:4000,operation:"move",direction:"Walk to the door",evidence:[4]}];
  const p=buildRealtimePerformance(beats,0,8500,8500,10);
  expect(p.shots).toEqual([{startMs:0,endMs:8500,roomId:10,kind:"establish"}]);
  expect(p.cues).toHaveLength(4);
  expect(p.cues.map(c=>[c.startMs,c.endMs])).toEqual([[0,2000],[2500,4500],[5000,7000],[3000,4000]]);
  expect(p.coverage?.every(c=>c.disposition==="prompted")).toBe(true);
});
test("parallel rooms never turn word interleaving into a media backlog",()=>{
  const beats=[speech(20,16,13000,16340,"What black-and-white? Did somebody eat a black-and-white?"),
    speech(19,15,14500,19720,"Notice how he immediately retreated to the kitchen when you asked that?")];
  const before=JSON.stringify(beats),p=buildRealtimePerformance(beats,13000,21500,8500,16);
  expect(p.sourceMap).toEqual([{mediaMs:0,sourceMs:13000},{mediaMs:8500,sourceMs:21500}]);
  expect(p.endingSilenceMs).toBe(0); expect(p.cues).toHaveLength(1);
  expect(p.cues[0]).toMatchObject({beat:0,startMs:0,endMs:3340,evidence:[20]});
  expect(p.coverage).toEqual([{beat:0,disposition:"prompted"},{beat:1,disposition:"off_camera"}]);
  expect(JSON.stringify(beats)).toBe(before);
});
test("same-room competing audio is explicit coverage, never reordered into later world time",()=>{
  const p=buildRealtimePerformance([speech(1,10,0,5000,"First voice"),speech(2,10,1000,6000,"Another voice")],0,8500,8500,10);
  expect(p.coverage).toEqual([{beat:0,disposition:"prompted"},{beat:1,disposition:"competing_audio"}]);
  expect(p.cues).toHaveLength(1); expect(Object.isFrozen(p.coverage![1])).toBe(true);
});
test("native gestures and phone sound onsets are not stretched to editorial minimums",()=>{
  const beats:ScreenBeat[]=[{kind:"action",actorId:1,roomId:10,atSimMs:1000,endSimMs:1800,operation:"pickup",direction:"pickup",evidence:[1]},
    {kind:"sound",roomId:10,atSimMs:2000,audibleDurationMs:800,direction:"buzz",evidence:[2]},
    {kind:"sound",roomId:10,atSimMs:8000,audibleDurationMs:800,direction:"buzz",evidence:[3]}];
  const p=buildRealtimePerformance(beats,0,8500,8500,10);
  expect(p.cues.map(c=>[c.startMs,c.endMs])).toEqual([[1000,1800],[2000,2800],[8000,8500]]);
  expect(p.shots.some(s=>s.kind==="pickup"&&s.startMs===1000&&s.endMs===1800)).toBe(true);
});
test("only emission-authorized sound crosses camera rooms, not speech or physical actions",()=>{
  const beats:ScreenBeat[]=[{kind:"sound",atSimMs:100,roomId:20,audibleRoomIds:[10,20],direction:"buzz",evidence:[1]},
    {kind:"sound",atSimMs:200,roomId:30,audibleRoomIds:[30],direction:"remote buzz",evidence:[2]},
    {kind:"speech",atSimMs:300,endSimMs:600,roomId:20,audibleRoomIds:[10,20],direction:"private words",evidence:[3]},
    {kind:"action",atSimMs:500,endSimMs:800,roomId:20,audibleRoomIds:[10,20],direction:"read",evidence:[4]}];
  const p=buildRealtimePerformance(beats,0,8500,8500,10);
  expect(p.cues.map(c=>c.beat)).toEqual([0]);
  expect(p.coverage?.slice(1).every(c=>c.disposition==="off_camera")).toBe(true);
  expect(p.sourceMap).toEqual([{mediaMs:0,sourceMs:0},{mediaMs:8500,sourceMs:8500}]);
});
test("five minutes of contiguous media advance five minutes of source, including quiet time",()=>{
  const timeline=new SitcomPlayback();let start=0;
  for(let i=0;i<36;i++) {
    const duration=i?8500:10125,p=buildRealtimePerformance([],start,start+duration,duration,10);
    expect(timeline.register({version:i+1,sourceId:"world",sourceStartSimMs:start,sourceEndSimMs:start+duration,performance:p})).toBe(true);
    timeline.add({chunk_index:i,prompt_version:i+1,playback_seconds:duration/1000}); start+=duration;
  }
  for(const seconds of [0,1,10,23.7,60,120,299.999,300])expect(timeline.at(seconds)).toMatchObject({state:"mapped",sourceMs:seconds*1000,sourceRate:1});
});
test("realtime metadata rejects synthetic holds, repeated chunks, and both longer and shorter provider intervals",()=>{
  const p=buildRealtimePerformance([],0,8500,8500,10),segment={version:1,sourceId:"world",sourceStartSimMs:0,sourceEndSimMs:8500,performance:p};
  const t=new SitcomPlayback();expect(t.register({...segment,performance:{...p,sourceMap:[{mediaMs:0,sourceMs:0},{mediaMs:8000,sourceMs:8500},{mediaMs:8500,sourceMs:8500}]}})).toBe(false);
  for(const seconds of [8.4,8.6]) {
    const player=new SitcomPlayback();player.register(segment);player.add({chunk_index:0,prompt_version:1,playback_seconds:seconds});
    expect(player.at(1)).toEqual({state:"unmapped",reason:"realtime_chunk_duration_mismatch"});
    const pacer=new SitcomLivePacer();pacer.register(segment);pacer.observe({playbackSeconds:1,chunks:[{chunk_index:0,prompt_version:1,playback_seconds:seconds}]});
    expect(pacer.sample(8500).failure?.reason).toBe("realtime_chunk_duration_mismatch");
  }
  const pacer=new SitcomLivePacer();pacer.register(segment);pacer.observe({playbackSeconds:9,chunks:[0,1].map(chunk_index=>({chunk_index,prompt_version:1,playback_seconds:8.5}))});
  expect(pacer.sample(8500).failure?.reason).toBe("provider_repeated_realtime_performance");
  expect(()=>buildRealtimePerformance([],0,1000,8500,10)).toThrow("equal positive");
});
