import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { nextContinuousSpeechUpdate } from "./h3-continuous-speech-probe";
import { nextScriptComparisonUpdate } from "./h3-script-comparison";
import { nextPreparedScriptUpdate } from "./h3-memory-comparison";
import { isH3SetupAcknowledgement } from "../demo/sitcom-h3-chunk";
const token=location.hash.slice(1),video=document.getElementById("video"),status=document.getElementById("status");
const modes=[...document.querySelectorAll("[data-mode]")].map(button=>button.dataset.mode);
let run;
window.speechProbe={runs:[]};
const post=(path,body)=>fetch(path,{method:"POST",headers:{"x-argos-token":token,"Content-Type":"application/json"},body:JSON.stringify(body)});
function record(r,type,data={}) {
  const row={mode:r.mode,atMs:performance.now()-r.startedAt,type,...data}; r.rows.push(row);
  status.textContent=JSON.stringify(row,null,2);
  r.chain=r.chain.then(async()=>{const response=await post("/evidence",row);if(!response.ok)throw new Error("Evidence persistence failed");})
    .catch(()=>{r.evidenceFailure=true;if(!r.stopping)void stop(r,"evidence-failure");});
}
async function stop(r,reason) {
  if(r.stopping)return;r.stopping=true;clearTimeout(r.timer);record(r,"stop",{reason,mediaSeconds:r.mediaSeconds});
  try{r.session?.send({type:"stop"});}catch{}
  if(r.recorder?.state === "recording")r.recorder.stop();
  await new Promise(resolve=>setTimeout(resolve,500));
  try{await r.session?.close();}catch{}
  for(const track of r.stream?.getTracks()??[])track.stop();
  try {
    if(r.finished){
      const blob=await r.finished; const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;link.textContent=`Download ${r.mode} video`;link.download=`${r.mode}.${blob.type.startsWith("video/mp4")?"mp4":"webm"}`;
      document.getElementById("downloads").append(link,document.createElement("br"));
      const response=await fetch(`/recording/${r.mode}`,{method:"POST",headers:{"x-argos-token":token,"Content-Type":blob.type.split(";")[0]},body:blob,signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`Save failed ${response.status}`);
      r.recording=await response.json();record(r,"recording_saved",r.recording);
      video.srcObject=null;video.src=url;video.autoplay=false;video.load();
    }
  }catch(error){record(r,"save_error",{message:String(error)});}
  await r.chain;r.done=true;status.textContent=`${r.mode} stopped: ${reason}. ${r.recording?"Video saved.":"Check evidence: video unavailable."}`;
  for(const mode of modes)document.getElementById(mode).disabled=window.speechProbe.runs.some(x=>x.mode===mode);
}
async function start(mode) {
  if(run&&!run.done)return;
  const r=run={mode,startedAt:performance.now(),rows:[],chain:Promise.resolve(),stopping:false,done:false,mediaSeconds:0};
  window.speechProbe.runs.push(r);
  for(const m of modes)document.getElementById(m).disabled=true;
  record(r,"start");
  try {
    const response=await post(`/start/${mode}`,{});if(!response.ok)throw new Error(`Start rejected ${response.status}`);
    const initial=await response.json();r.sentVersion=initial.configure.prompt_version;r.chunks=[];r.timer=setTimeout(()=>stop(r,"wall-cap"),initial.wallMs);
    r.admitted=0;r.settled=0;
    const appendNext=()=>{
      if(!initial.scriptComparison||!(mode==="append"||initial.scriptAppend)||r.stopping||!r.configured)return;
      const update=initial.scriptUpdates ? nextPreparedScriptUpdate(initial.scriptUpdates,r.sentVersion,r.admitted,r.settled)
        : nextScriptComparisonUpdate(r.sentVersion,r.admitted,r.settled);
      if(update){r.session.send(update);r.sentVersion=update.prompt_version;record(r,"sent",{message:update,observedMediaSeconds:r.mediaSeconds});}
    };
    video.removeAttribute("src");video.autoplay=true;
    const fal=createFalClient({proxyUrl:"/proxy",fetch:(url,init)=>{const h=new Headers(init?.headers);h.set("x-argos-token",token);return fetch(url,{...init,headers:h});}});
    r.session=fal.realtime.open(wma("minimax/h3-max/director"),{receive:["video","audio"],negotiationTimeoutMs:30000,
      onMedia(stream){
        if(r.stopping){stream.getTracks().forEach(t=>t.stop());return;}
        r.stream=stream;video.srcObject=stream;
        const mimeType=['video/mp4;codecs="avc1.424028,mp4a.40.2"',"video/webm;codecs=vp8,opus","video/webm"].find(x=>MediaRecorder.isTypeSupported(x));
        if(!mimeType){void stop(r,"recording-unsupported");return;}
        const parts=[];r.recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2500000});
        r.finished=new Promise(resolve=>{r.recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};r.recorder.onstop=()=>resolve(new Blob(parts,{type:mimeType}));});
        r.recorder.onerror=()=>stop(r,"recording-error");
        const frame=(_now,meta)=>{
          if(r.stopping)return;
          if(r.firstMediaTime===undefined){r.firstMediaTime=meta.mediaTime;r.recorder.start(1000);record(r,"first_frame",{mediaTime:meta.mediaTime});}
          r.mediaSeconds=meta.mediaTime-r.firstMediaTime;
          const visible=r.chunks.find(c=>r.mediaSeconds>=c.startSeconds&&r.mediaSeconds<c.endSeconds);
          if(visible&&r.visibleChunk!==visible.chunkIndex){r.visibleChunk=visible.chunkIndex;record(r,"display_boundary",{...visible,observedMediaSeconds:r.mediaSeconds});}
          if(r.mediaSeconds>=initial.playbackSeconds){void stop(r,`${initial.playbackSeconds}-second-media-cap`);return;}
          video.requestVideoFrameCallback(frame);
        };
        video.requestVideoFrameCallback(frame);void video.play().catch(()=>stop(r,"playback-failed"));
      },
      onData(raw){
        if(r.stopping)return;let message;try{message=JSON.parse(raw);}catch{return;}
        record(r,"received",{message});
        if(message.type==="configured"){
          if(!isH3SetupAcknowledgement(message)||message.chunk_duration!==initial.configure.chunk_duration){void stop(r,"setup-mismatch");return;}
          r.configured=true;appendNext();
        }
        if(initial.scriptComparison){
          if(message.type==="session_info"&&message.scripts===false){void stop(r,"scripts-unsupported");return;}
          if(message.type==="prompt_applied"&&(mode==="append"||initial.scriptAppend)&&message.prompt_version===r.admitted+1
            &&message.prompt_version<=r.sentVersion&&message.script_beats===1){r.admitted=message.prompt_version;appendNext();}
          if(message.type==="chunk"){
            if(message.chunk_index!==r.chunks.length||Math.abs(message.playback_seconds-10)>.001
              ||!Number.isInteger(message.script_version)||message.script_version<1||message.script_version>r.sentVersion){void stop(r,"script-chunk-mismatch");return;}
            const startSeconds=r.chunks.at(-1)?.endSeconds??0;
            r.chunks.push({chunkIndex:message.chunk_index,version:message.script_version,startSeconds,endSeconds:startSeconds+message.playback_seconds});
            r.settled=Math.max(r.settled,message.script_version);r.admitted=Math.max(r.admitted,r.settled);appendNext();
          }
        }
        if(initial.continuous&&message.type==="chunk"){
          if(initial.replay&&r.chunks.length===initial.expectedChunks.length){record(r,"unadmitted_drain_chunk",{message});return;}
          if(message.chunk_index!==r.chunks.length||!Number.isFinite(message.playback_seconds)||message.playback_seconds<=0||message.playback_seconds>20||message.prompt_version>r.sentVersion){void stop(r,"chunk-contract-mismatch");return;}
          if(initial.replay){const expected=initial.expectedChunks[r.chunks.length];
            if(message.prompt_version!==expected.version||Math.abs(message.playback_seconds-expected.seconds)>.001){void stop(r,"replay-version-or-duration-mismatch");return;}}
          const startSeconds=r.chunks.at(-1)?.endSeconds??0;
          r.chunks.push({chunkIndex:message.chunk_index,version:message.prompt_version,startSeconds,endSeconds:startSeconds+message.playback_seconds});
          const update=initial.replay ? initial.updates.find(u=>u.prompt_version===r.sentVersion+1)
            : nextContinuousSpeechUpdate(r.sentVersion,message.prompt_version);
          if(update){r.sentVersion=update.prompt_version;record(r,"sent",{message:update,afterChunk:message.chunk_index,observedMediaSeconds:r.mediaSeconds});r.session.send(update);}
        }
        if(message.type==="configured" && message.chunk_duration!==initial.configure.chunk_duration)void stop(r,"duration-mismatch");
        if(["error","invalid_message","prompt_rejected"].includes(message.type))void stop(r,`provider-${message.type}`);
      },
      onState(state){if(!r.stopping)record(r,"state",{state});},
      onError(error){if(!r.stopping){record(r,"error",{message:String(error)});void stop(r,"connection-error");}},
    });
    r.session.send(initial.configure);record(r,"sent",{message:initial.configure});
  }catch(error){record(r,"error",{message:String(error)});await stop(r,"startup-failure");}
}
for(const mode of modes)document.getElementById(mode).onclick=()=>start(mode);
document.getElementById("stop").onclick=()=>run&&stop(run,"manual");
addEventListener("pagehide",()=>{try{run?.session?.send({type:"stop"});run?.session?.close();}catch{}});
