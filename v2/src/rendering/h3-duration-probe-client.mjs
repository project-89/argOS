import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
const token = location.hash.slice(1), status = document.getElementById("status"), video = document.getElementById("video");
let session, timer, mode, startedAt, active = false, changed = false, afterChange = 0, confirmed = false, chain = Promise.resolve();
const rows = []; window.durationProbe = { rows };
function record(type, data = {}) {
  const row = { mode, atMs: performance.now() - startedAt, type, ...data }; rows.push(row);
  status.textContent = JSON.stringify(row,null,2);
  chain = chain.then(async () => {
    const r = await fetch("/evidence", { method:"POST",headers:{"Content-Type":"application/json","x-argos-token":token},body:JSON.stringify(row) });
    if (!r.ok) throw new Error("Evidence persistence failed");
  }).catch(() => { if (active) void stop("evidence-failure"); });
}
async function stop(reason) {
  if (!active) return; active = false; clearTimeout(timer); record("stop",{reason});
  try { session?.send({type:"stop"}); } catch {}
  try { await session?.close(); } catch {}
  for (const t of video.srcObject?.getTracks() ?? []) t.stop();
  await chain; status.textContent = `Stopped: ${reason}. Evidence saved.`;
  document.getElementById("prompt").disabled = false; document.getElementById("configure").disabled = false;
}
async function start(testMode) {
  if (active) return;
  mode = testMode; active = true; changed = false; afterChange = 0; confirmed = false; startedAt = performance.now();
  document.getElementById("prompt").disabled = true; document.getElementById("configure").disabled = true;
  record("start",{limitSeconds:45,initialSeconds:5,requestedChangeSeconds:7});
  timer = setTimeout(() => stop("45-second-cap"),45000);
  const fal = createFalClient({proxyUrl:"/proxy",fetch:(url,init) => {
    const headers = new Headers(init?.headers); headers.set("x-argos-token",token); return fetch(url,{...init,headers});
  }});
  const premise = "Locked wide shot of a red wooden toy boat floating gently on a quiet pond in daylight. No people, no speech, no music. Quiet water sounds only.";
  const send = message => { record("sent",{message}); session.send(message); };
  session = fal.realtime.open(wma("minimax/h3-max/director"),{receive:["video","audio"],negotiationTimeoutMs:30000,
    onMedia(stream) { if (!active) { stream.getTracks().forEach(t=>t.stop()); return; } video.srcObject = stream; void video.play(); },
    onState(state) { if (active) record("state",{state}); },
    onError(error) { if (active) { record("error",{message:String(error)}); void stop("connection-error"); } },
    onData(raw) {
      if (!active) return;
      let message; try {message = JSON.parse(raw);} catch {record("unparsed",{raw:String(raw).slice(0,1000)});return;}
      record("received",{message});
      if (message.type === "configured" && !changed) {
        confirmed = message.chunk_duration === 5;
        if (!confirmed) void stop("initial-duration-not-confirmed");
      }
      if (["error","prompt_rejected","invalid_message"].includes(message.type)) { void stop("provider-rejected-change"); return; }
      if (message.type === "stream_exhausted") { void stop("provider-exhausted"); return; }
      if (message.type !== "chunk") return;
      if (!changed) {
        if (!confirmed || Math.abs(message.playback_seconds-5)>.25) { void stop("baseline-mismatch"); return; }
        changed = true;
        send({type:mode,prompt:premise + " A small ripple passes the boat. Keep the same framing.",prompt_version:2,
          ...(mode === "configure" ? {protocol_version:1} : {}),chunk_duration:7});
      } else if (++afterChange >= 3) void stop("three-post-change-chunks");
    }
  });
  send({type:"configure",prompt:premise,prompt_version:1,protocol_version:1,chunk_duration:5,resolution:"480p"});
}
document.getElementById("prompt").onclick=()=>start("prompt");
document.getElementById("configure").onclick=()=>start("configure");
document.getElementById("stop").onclick=()=>stop("manual");
addEventListener("pagehide",()=>{try{session?.send({type:"stop"});session?.close();}catch{}});
