/** Finite test-source shutdown, not an NPC control policy or media retimer. */
import type { World } from "../ecs/world";
import { getCommittedEvents, subscribeCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { scheduleSimulationEvent } from "../runtime/simulation-timeline";
import { H3_MEDIA_TIMING } from "./sitcom-h3-chunk";

export function sourcePacketBoundary(atMs: number, rounding: "up" | "down") {
  const {openingMediaMs,continuationMediaMs}=H3_MEDIA_TIMING.chunk_ack;
  if(!Number.isFinite(atMs)||atMs<openingMediaMs)throw new Error("Source budget must include a calibrated opening");
  const n=(rounding==="up"?Math.ceil:Math.floor)((atMs-openingMediaMs)/continuationMediaMs);
  return openingMediaMs+n*continuationMediaMs;
}
export function attachBoundedSourceDrain(world:World,options:{nominalEndMs:number;maxDrainMs:number;
  onSeal(report:{atSimMs:number;nominalEndMs:number;hardEndMs:number;unfinishedExecutionIds:string[];reason:"drained"|"drain_limit"}):void}) {
  const {nominalEndMs,maxDrainMs}=options;
  if(!Number.isFinite(maxDrainMs)||maxDrainMs<0||maxDrainMs>30000||nominalEndMs<=readSimulationTime(world))
    throw new Error("Invalid bounded source drain");
  const first=sourcePacketBoundary(nominalEndMs,"up"),hardEndMs=sourcePacketBoundary(nominalEndMs+maxDrainMs,"down");
  if(hardEndMs<first)throw new Error("Drain budget cannot contain a complete media packet");
  const source=getCommittedEvents(world);
  if(source.stopped||!source.sourceId||source.gap)throw new Error("Attach to a complete active source before its nominal end");
  const pending=new Set<string>();let cohort:Set<string>|undefined,settledAt=nominalEndMs,disposed=false;
  let cancelNominal=()=>{},cancelBoundary=()=>{},removeStop=()=>{};
  const accept=(event:typeof source.events[number])=>{
    if(event.sourceId!==source.sourceId||event.kind!=="action")return;
    if(event.status==="pending")pending.add(event.executionId);
    else {
      pending.delete(event.executionId);
      if(cohort?.delete(event.executionId))settledAt=event.atSimMs;
    }
  };
  source.events.forEach(accept);
  const removeEvents=subscribeCommittedEvents(world,accept);
  const dispose=()=>{if(disposed)return;disposed=true;cancelNominal();cancelBoundary();removeEvents();removeStop();};
  const boundary=(atSimMs:number)=>{
    cancelBoundary=scheduleSimulationEvent(world,{atSimMs,phase:"speech",run:()=>{
      if(disposed)return;
      if(getCommittedEvents(world).sourceId!==source.sourceId){dispose();return;}
      // Freeze the cohort at nominal end. Later choices never renew the cap.
      // A short native settlement interval allows already-triggered delivery;
      // its expiration still never asserts that delivery actually succeeded.
      const drained=!!cohort&&!cohort.size&&readSimulationTime(world)>=settledAt+1000;
      if(drained||atSimMs>=hardEndMs){
        const report={atSimMs:readSimulationTime(world),nominalEndMs,hardEndMs,
          unfinishedExecutionIds:[...cohort??[]],reason:drained?"drained" as const:"drain_limit" as const};
        dispose();options.onSeal(report);
      } else boundary(atSimMs+H3_MEDIA_TIMING.chunk_ack.continuationMediaMs);
    }});
  };
  cancelNominal=scheduleSimulationEvent(world,{atSimMs:nominalEndMs,phase:"speech",run:()=>{
    cohort=new Set(pending);if(!cohort.size)settledAt=nominalEndMs-1000;
  }});
  removeStop=subscribeCommittedSourceStop(world,dispose);
  boundary(first);
  return dispose;
}
