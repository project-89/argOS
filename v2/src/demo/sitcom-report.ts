import type { ApartmentSitcom, SitcomEvent } from "./apartment-sitcom";
import { evaluateGenerativeAgentsRun } from "../evals/generative-agents-evaluation";
import { getCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";

type CurrentSitcomFrame = Omit<ReturnType<ApartmentSitcom["snapshot"]>, "events">;
type CurrentSitcomMessage = CurrentSitcomFrame["phone"][number];
/** Persisted audience frames predate contact profiles. New snapshots always
 * carry them; a historical recording must not invent its sender's identity. */
export type SitcomFrame = Omit<CurrentSitcomFrame, "contact" | "phone" | "actors" | "scenario" | "provenance"> & {
  scenario?: Omit<CurrentSitcomFrame["scenario"], "phoneOwner"> & {phoneOwner?: string};
  provenance: Omit<CurrentSitcomFrame["provenance"], "rendering"> & { rendering?: string; h3?: boolean };
  contact?: CurrentSitcomFrame["contact"];
  actors: Array<Omit<CurrentSitcomFrame["actors"][number], "affect" | "attention"> & Partial<Pick<CurrentSitcomFrame["actors"][number], "affect" | "attention">>>;
  phone: Array<Omit<CurrentSitcomMessage, "contact" | "contactRevision"> & Partial<Pick<CurrentSitcomMessage, "contact" | "contactRevision">>>;
};
export function sitcomFrame(testbed: ApartmentSitcom): SitcomFrame {
  const { events: _events, ...frame } = testbed.snapshot(); return frame;
}
export function evaluateSitcom(testbed: ApartmentSitcom) {
  const snapshot = testbed.snapshot(), events = snapshot.events, names = Object.fromEntries(testbed.characters.map(name => [testbed.ids[name], name]));
  const publicTape = getCommittedEvents(testbed.sim.world);
  const speech = publicTape.events.filter(e => e.kind === "speech" && e.text);
  const actors = testbed.characters.map(name => {
    const own = events.filter(e => e.actor === name), latencies = own.filter(e => e.kind === "decision_latency" && e.text === "finished").map(e => e.durationWallMs!).sort((a, b) => a - b);
    const dispositions = own.flatMap(e => e.disposition ? [{ atSimMs: e.atSimMs, ...e.disposition }] : []);
    const dispositionCounts: Record<string, number> = {};
    for (const disposition of dispositions) { const key = `${disposition.type}:${disposition.reason ?? disposition.mentalUpdate ?? "unspecified"}`;
      dispositionCounts[key] = (dispositionCounts[key] ?? 0) + 1; }
    return { name, authoredThoughts: own.filter(e => e.kind === "thought" && ["reasoning", "appraisal"].includes(e.thoughtType ?? "")).length,
      authoredAppraisals: own.filter(e => e.kind === "thought" && e.thoughtType === "appraisal").length,
      foregroundRequestsObserved: new Set(dispositions.map(e => e.requestId)).size, foregroundDispositionCounts: dispositionCounts, foregroundDispositions: dispositions,
      speechSlices: speech.filter(e => e.actorId === testbed.ids[name]).length,
      completedSpeech: own.filter(e => e.kind === "speech" && e.status === "succeeded").length,
      failedActions: own.filter(e => e.status === "failed").map(e => ({ atSimMs: e.atSimMs, action: e.action, text: e.text })),
      decisionP50WallMs: latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null,
      decisionP95WallMs: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null };
  });
  const causalChains = snapshot.phone.filter(m => m.direction === "in").map(message => {
    const queued = events.find(e => e.kind === "operator_text" && e.messageId === message.id);
    const delivered = events.find(e => e.kind === "phone_delivered" && e.messageId === message.id);
    const reads = events.filter(e => e.kind === "phone_read" && e.messageId === message.id);
    const replies = snapshot.phone.filter(m => m.direction === "out" && m.replyTo === message.id);
    return { messageId: message.id, operatorQueuedAtSimMs: queued?.atSimMs ?? null, deliveredAtSimMs: delivered?.atSimMs ?? null,
      ownerHeardNotificationAtSimMs: events.find(e => e.kind === "perception" && e.actor === testbed.phoneOwner && e.text.includes("Your phone's familiar") && e.atSimMs >= (delivered?.atSimMs ?? Infinity))?.atSimMs ?? null,
      reads: reads.map(e => ({ actor: e.actor, atSimMs: e.atSimMs })), replies: replies.map(reply => ({ id: reply.id, typedAtSimMs: reply.createdMs, deliveredAtSimMs: reply.deliveredMs >= 0 ? reply.deliveredMs : null })),
      preReadBodyLeaks: events.filter(e => e.kind === "perception" && e.text.includes(message.text)
        && !reads.some(r => r.actor === e.actor && r.sequence < e.sequence)).map(e => ({ actor: e.actor, sequence: e.sequence })),
      repliesWithoutPriorRead: replies.filter(reply => { const typed = events.find(e => e.kind === "reply_typed" && e.messageId === reply.id);
        return !typed || !reads.some(read => read.actor === typed.actor && read.sequence < typed.sequence); }).map(reply => reply.id) };
  });
  const voices = new Map<string, { actorId: number; startedAt: number; endsAt: number }>();
  for (const event of publicTape.events) if (event.kind === "speech" && event.startedAtSimMs !== undefined) {
    const old = voices.get(event.executionId); voices.set(event.executionId, { actorId: event.actorId, startedAt: event.startedAtSimMs,
      endsAt: event.completedAtSimMs ?? old?.endsAt ?? snapshot.atSimMs });
  }
  const intervals = [...voices.values()], overlap: Array<{ first: string; second: string; startSimMs: number; endSimMs: number }> = [];
  for (let a = 0; a < intervals.length; a++) for (let b = a + 1; b < intervals.length; b++) {
    const start = Math.max(intervals[a].startedAt, intervals[b].startedAt), end = Math.min(intervals[a].endsAt, intervals[b].endsAt);
    if (intervals[a].actorId !== intervals[b].actorId && end > start) overlap.push({ first: names[intervals[a].actorId], second: names[intervals[b].actorId], startSimMs: start, endSimMs: end });
  }
  const transcript = evaluateGenerativeAgentsRun(events.map(e => ({ sequence: e.sequence, elapsedMs: e.atSimMs, tick: e.tick,
    actorId: e.actor ? testbed.ids[e.actor] : undefined, kind: e.kind, text: e.text, visibility: e.visibility, action: e.action, status: e.status,
    thoughtType: e.thoughtType })), snapshot.atSimMs, { actorNames: names, milestoneRules: [], minSpeechTurns: 8 });
  return { provenance: snapshot.provenance, sourceId: snapshot.sourceId, atSimMs: snapshot.atSimMs,
    gates: { everyActorAuthoredThought: actors.every(a => a.authoredThoughts > 0), everyActorSpoke: actors.every(a => a.speechSlices > 0),
      realTinOpened: events.some(e => e.action?.target === "Orange tin" && e.action.content === "open" && e.status === "succeeded"),
      realCookieAcquired: events.some(e => e.action?.type === "pickup" && e.action.target === "Last black-and-white cookie" && e.status === "succeeded"),
      ownerHeardPhone: causalChains.some(c => c.ownerHeardNotificationAtSimMs !== null), ownerReadPhone: causalChains.some(c => c.reads.some(r => r.actor === testbed.phoneOwner)),
      outsideReplyDelivered: causalChains.some(c => c.replies.some(r => r.deliveredAtSimMs !== null)),
      noPhoneKnowledgeLeakObserved: causalChains.every(c => c.preReadBodyLeaks.length === 0 && c.repliesWithoutPriorRead.length === 0),
      completeDiagnostics: snapshot.droppedEvents === 0 && !publicTape.gap },
    actors, causalChains, globalVoiceOverlap: overlap, overlapInterpretation: "Exact simultaneous voice intervals, possibly in different rooms; not automatically audible crosstalk or a failure.",
    transcript, notes: ["A fixture proves physical laws, not autonomous cognition.", "No comedy/naturalness score is inferred from gate completion. Review quoted repetition candidates and actual conversation.",
      "Acceptance or resistance to the outside sender is a character choice; an unobserved reply is not a physics success.",
      "Foreground dispositions are correlated by exact world-owned request and actor key. Global chronicle records without request identity are omitted, never assigned by matching a name.",
      "Decision latency measures request-slot duration, including deterministic plan selections; it does not by itself prove model/action admission."] };
}

/** Standalone operator-view replay. Private thoughts are intentionally displayed
 * to the audience, never fed back into another character or renderer prompt. */
export function renderSitcomReplay(frames: readonly SitcomFrame[], speech: readonly PublicCommittedEvent[], events: readonly SitcomEvent[]): string {
  const data = JSON.stringify({ frames, speech: speech.filter(e => e.kind === "speech" && e.text), events: events.filter(e => ["operator_text", "phone_read", "reply_typed", "reply_delivered"].includes(e.kind)) })
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Last Cookie · Argos</title>
<style>body{margin:0;background:#101411;color:#edf0df;font:16px/1.5 system-ui}main{max-width:1300px;margin:auto;padding:24px}h1{margin:0;font-size:32px}p{color:#aeb9a9}button,input{accent-color:#d5e58a}button{background:#d5e58a;border:0;border-radius:7px;padding:10px 16px;cursor:pointer}nav{display:flex;gap:16px;align-items:center;position:sticky;top:0;background:#101411;padding:16px 0}input{flex:1}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card,section{background:#1b241d;border:1px solid #344336;border-radius:10px;padding:18px;margin:12px 0}.name{color:#d5e58a;font-size:20px}.meta{font-size:12px;color:#aeb9a9}.thought{font-size:20px;min-height:100px}.body{color:#c5d0c2}.lower{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}.line{padding:10px 0;border-bottom:1px solid #344336}.bubble{background:#28392b;margin:10px 0;padding:12px;border-radius:9px;white-space:pre-wrap}.out{background:#3d4930}pre{white-space:pre-wrap;font:14px/1.6 system-ui}@media(max-width:850px){.cards{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:480px){main{padding:14px}.cards{grid-template-columns:1fr}.thought{min-height:0}}</style>
<main><h1>The Last Cookie</h1><p>Four minds. One apartment. Someone on the other side.<br>Operator replay · private authored thoughts shown to the audience, not shared between characters. No H3.</p>
<nav><button id="play">Play</button><span id="clock">0.0s</span><input id="time" type="range" min="0" value="0" step="100" aria-label="Source simulation playhead"></nav>
<div class="cards" id="cards"></div><div class="lower"><section><h2>Actually spoken</h2><p>Committed words appear as they are heard, not the future sentence.</p><div id="speech"></div></section>
<div><section><h2>The outside phone</h2><div id="phone"></div></section><section><h2>Simple ECS facts</h2><pre id="facts"></pre></section></div></div></main>
<script type="application/json" id="data">${data}</script><script>
const data=JSON.parse(document.getElementById('data').textContent),slider=document.getElementById('time');slider.max=String(data.frames.at(-1)?.atSimMs||0);
const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
const contactLabel=m=>{const c=m.contact,n=c?.name?.trim()||'Unknown sender',r=c?.relationship?.trim(),who=r&&r!=='unknown'?n+' · '+r:n;return m.direction==='out'?'Elaine → '+who:who+' → Elaine'};
function draw(){const ms=Number(slider.value),f=[...data.frames].reverse().find(f=>f.atSimMs<=ms)||data.frames[0];if(!f)return;document.getElementById('clock').textContent=(ms/1000).toFixed(1)+'s';
const cards=document.getElementById('cards');cards.replaceChildren();for(const a of f.actors){const c=el('div','','card');c.append(el('div',a.name,'name'),el('div',a.room+(a.speaking?' · speaking':''),'meta'),el('p',a.latestThought?'“'+a.latestThought.text+'”':'No authored thought yet.','thought'),el('div',a.latestThought?'Thought @ '+(a.latestThought.atSimMs/1000).toFixed(1)+'s':'Not an injected thought','meta'));cards.append(c)}
const s=document.getElementById('speech');s.replaceChildren();const turns=new Map();for(const e of data.speech.filter(e=>e.atSimMs<=ms)){let row=turns.get(e.executionId);if(!row){row={actor:e.actorId,text:'',at:e.atSimMs};turns.set(e.executionId,row)}row.text+=e.text.trim()+' '}
for(const t of [...turns.values()].slice(-8)){const name=f.actors.find(a=>a.id===t.actor)?.name||'Character';s.append(el('div',(t.at/1000).toFixed(1)+'s · '+name+': '+t.text,'line'))}
const phone=document.getElementById('phone');phone.replaceChildren();for(const m of f.phone){const n=el('div','','bubble'+(m.direction==='out'?' out':''));n.append(el('div',contactLabel(m),'meta'),el('div',m.text),el('div',m.status+' · '+(m.createdMs/1000).toFixed(1)+'s','meta'));phone.append(n)}if(!f.phone.length)phone.append(el('p','The scheduled operator text arrives at 25 seconds.'));
document.getElementById('facts').textContent='Cookie: '+(f.facts.cookieConsumed?'eaten by '+f.facts.cookieConsumedBy:'in '+f.facts.cookieContainer)+'\\nTin: '+f.facts.tin+'\\nPhone: '+f.facts.phoneContainer+'\\nUnread: '+f.facts.unread+' · Vibrations: '+f.facts.buzzes;}
let timer;slider.oninput=draw;document.getElementById('play').onclick=()=>{if(timer){clearInterval(timer);timer=null;document.getElementById('play').textContent='Play';return}if(Number(slider.value)>=Number(slider.max))slider.value='0';document.getElementById('play').textContent='Pause';timer=setInterval(()=>{slider.value=String(Math.min(Number(slider.max),Number(slider.value)+100));draw();if(Number(slider.value)>=Number(slider.max)){clearInterval(timer);timer=null;document.getElementById('play').textContent='Play'}},100)};draw();
</script></html>`;
}
