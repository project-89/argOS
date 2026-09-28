import { CommittedSceneHistory } from "../../rendering/committed-scene-history";
import type { SceneEvent, SceneSnapshot } from "../../rendering/scene-director";
import { SitcomScreenwriter } from "../sitcom-screenplay";

// a0CWtL's public timings: typing completes 95ms after George begins his
// execution, but 605ms before his first word. No private message body is needed.
function fixture(earlyWord = false, completed = true) {
  const events: SceneEvent[] = [];
  const add = (at: number, actor: number, execution: string, start: number, extra: Partial<SceneEvent>) => {
    events.push({ id: `receipt:${events.length}`, elapsedMs: at, sourceTick: Math.ceil(at / 500),
      actorId: actor, actorKey: `actor:${actor}`, roomId: 16, roomKey: "kitchen", kind: "speech",
      action: "speak", status: "succeeded", interval: { executionId: execution, startedAtSimMs: start }, ...extra });
  };
  const speech = (actor: number, execution: string, start: number, words: string[], times: number[]) => {
    add(start, actor, execution, start, { status: "pending" });
    words.forEach((text, i) => add(times[i], actor, execution, start, { text }));
    add(times.at(-1)!, actor, execution, start, { interval: { executionId: execution, startedAtSimMs: start, completedAtSimMs: times.at(-1)! } });
  };
  speech(26, "kramer", 141000, ["Look, ", "the ", "tin ", "is ", "right ", "here ", "on ", "the ", "counter! ", "Let's ", "crack ", "it ", "open!"],
    [141820,142220,142620,143020,143420,143820,144220,144620,145140,145540,145940,146340,146860]);
  add(143500, 21, "typing", 143500, { kind: "action", action: "interact", operation: "typing", status: "pending", targetId: 30, targetKey: "phone" });
  if (completed) add(147595, 21, "typing", 143500, { kind: "action", action: "interact", operation: "typing", targetId: 30, targetKey: "phone",
    interval: { executionId: "typing", startedAtSimMs: 143500, completedAtSimMs: 147595 } });
  speech(20, "george", 147500, ["Why ", "the ", "third ", "degree, ", "Elaine? ", "You're ", "treating ", "me ", "like ", "a ", "common ", "criminal!"],
    [earlyWord ? 147550 : 148200,148600,149000,149520,150040,150440,150840,151240,151640,152040,152440,152960]);
  events.sort((a,b) => a.elapsedMs-b.elapsedMs); events.forEach((e,i) => events[i]={...e,sequence:i+1});
  const scene = (at: number): SceneSnapshot => ({ sourceId: "a0CWtL-boundary", sourceTick: Math.ceil(at/500), elapsedMs: at, capturedWallMs: at,
    room: { id: 16, identityKey: "kitchen", name: "Kitchen", description: "An interior apartment kitchen" },
    actors: [20,21,26].map(id => ({ id, identityKey: `actor:${id}`, name: id === 20 ? "George" : id === 21 ? "Elaine" : "Kramer", roomId: 16,
      appearance: { eid:id, name:"Adult", identity:{ height:"average",build:"average",hairColor:"dark",hairStyle:"short",eyeColor:"brown",skinTone:"fair",age:"adult",distinguishing:"",description:"adult" },
        clothing:"casual",accessories:"",expression:"attentive",posture:"standing",condition:"dry",visiblyHolding:"",wornGarments:[],heldItems:[],possessedItems:[],description:"adult" } })),
    props: [{ id:30,identityKey:"phone",roomId:16,name:"Elaine's phone",description:"phone",heldBy:21 }], events:events.filter(e=>e.elapsedMs===at) });
  const history = new CommittedSceneHistory(); let sequence=0;
  for (const at of [140500,...new Set(events.map(e=>e.elapsedMs)),160000]) history.append({ sequence:sequence++,scenes:[scene(at)] });
  return { history, events };
}

test("typing completion before a new voice's first word covers the whole line, not a lone Look clip", () => {
  const { history, events } = fixture(), writer = new SitcomScreenwriter(), cut = 147595.001;
  expect(history.safeSpeechPhraseBoundaries(141000,161000,["typing"])).toContain(cut);
  const compile = (start:number,end:number,version:number) => {
    const result=history.assemble(start,end,16); if(result.status!=="ready")throw Error(result.status);
    return writer.compile([result.window],[],version,{mediaDurationMs:8500,requireWholeUtterances:true,allowSpeechSlices:true});
  };
  const first=compile(141000,cut,2); first.commit();
  expect(first.script.beats.filter(b=>b.kind==="speech").map(b=>b.text)).toEqual(["Look, the tin is right here on the counter! Let's crack it open!"]);
  // 6.595s of actual performance, not 0.82s of "Look," plus 7.68s dead air.
  expect(first.script.performance.endingSilenceMs).toBeCloseTo(1904.999, 2);
  const next=compile(cut,152960.001,3); next.commit();
  expect(next.script.beats.find(b=>b.kind==="speech")?.text).toBe("Why the third degree, Elaine? You're treating me like a common criminal!");
  const evidence=[first.script,next.script].flatMap(s=>s.beats.filter(b=>b.kind==="speech").flatMap(b=>[...b.evidence]));
  expect(evidence).toEqual(events.filter(e=>e.text).map(e=>e.sequence));
  expect(new Set(evidence).size).toBe(evidence.length);
  expect(first.script.beats.filter(b=>b.operation==="typing" && b.endSimMs!==undefined)).toHaveLength(1);
  expect(next.script.beats.filter(b=>b.operation==="typing")).toHaveLength(0);
});

test.each([[true,true],[false,false]])("no safe cut after an unpunctuated word or an uncompleted gesture (%s,%s)", (word,completed) => {
  expect(fixture(word,completed).history.safeSpeechPhraseBoundaries(141000,161000,["typing"])).not.toContain(147595.001);
});

test("absence of words before an already-crossing execution is not proof of retained leading silence", () => {
  const {history}=fixture();
  expect(history.safeSpeechPhraseBoundaries(147550,161000,["typing"])).not.toContain(147595.001);
});
