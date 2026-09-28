/** Report-driven God: honors spirits' requests by acting on the world through
 * native hosts (narrative events, story props, proposals, managed builds).
 * No report, copied proposal or tool added later grants operator authority. */
import { tool } from "ai";
import { z } from "zod/v3";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getCommittedEvents } from "../runtime/committed-events";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { getNarrativeHost, nameConflict, NARRATIVE_READ_TOOLS } from "./narrative-authority";

export function buildSpiritGrowthTools(world: World, godEid: number, full: Record<string, any>, current:()=>boolean) {
  const allowed:Record<string,any>={};
  const assertCurrent=()=>{ assertSimulationTaskActive(); if(!current())throw new Error("Autonomous report scope expired"); };
  for(const name of [...NARRATIVE_READ_TOOLS,"getPlaceBuilds"]) if(full[name]) allowed[name]={...full[name],execute:async(p:unknown,c:unknown)=>{
    assertCurrent(); const result=await full[name].execute(p,c); assertCurrent(); return result;
  }};
  allowed.getSpiritProposals=tool({
    description:"Inspect still-current, world-scoped architect proposals. This is not construction or proof of use.",
    inputSchema:z.object({status:z.enum(["pending","approved","all"]).optional()}).strict(),
    execute:async({status="pending"})=>{
      const {getCurrentObservedProposals}=await import("../spirits/architect-spirit"); assertCurrent();
      const proposals=getCurrentObservedProposals(world).filter(p=>status==="all"||p.status===status)
        .map(p=>({id:p.id,type:p.type,name:p.name,description:p.description,rationale:p.rationale,status:p.status,specification:p.specification}));
      return {success:true,result:{count:proposals.length,proposals}};
    },
  });
  for(const action of ["approveProposal","rejectProposal"] as const) allowed[action]=tool({
    description:action==="approveProposal"?"Approve one current observed proposal for the existing native builder. Does not force NPC use.":"Reject one current observed proposal with a grounded reason.",
    inputSchema:z.object({proposalId:z.string().min(1).max(200),reason:z.string().min(1).max(1000).optional()}).strict(),
    execute:async({proposalId,reason})=>{
      const {getCurrentObservedProposals}=await import("../spirits/architect-spirit");
      const factory=await import("../spirits/spirit-factory"); assertCurrent();
      const proposal=getCurrentObservedProposals(world).find(p=>p.id===proposalId && p.status==="pending");
      if(!proposal || action==="rejectProposal"&&!reason) return {success:false,result:null,error:"A current native pending proposal (and rejection reason) is required"};
      const success=action==="approveProposal"?factory.approveProposal(proposal.id,godEid):factory.rejectProposal(proposal.id,reason!);
      return {success,result:success?{proposalId,status:proposal.status}:null};
    },
  });
  const host = getNarrativeHost(world);
  if (host) allowed.stageNarrativeEvent = tool({
    description: `Make something happen in the world now, from the shared story-event catalogue. The response is the host's receipt (applied or rejected with why).\n${host.describe()}`,
    inputSchema: z.object({ operation: z.enum(host.operations as [string, ...string[]]), place: z.string().max(120).optional(),
      sound: z.string().max(300).optional(), object: z.string().max(80).optional(), description: z.string().max(600).optional(),
      text: z.string().max(800).optional(), effect: z.enum(["flicker", "out"]).optional(), resident: z.string().max(80).optional(),
      from: z.string().max(40).optional() }).strict(),
    execute: async params => {
      assertCurrent(); const receipt = host.stage(params, "god");
      return { success: receipt.status === "applied", result: receipt };
    },
  });
  if (host?.operations.includes("arrival") || full.createObject) allowed.placeStoryProp = tool({
    description: "Place one new story object in a place: a letter, a found object, something washed up. It is real: residents can examine, carry and (if it has text) read it. Give it a distinct name.",
    inputSchema: z.object({ place: z.string().min(1).max(120), name: z.string().min(2).max(80), description: z.string().min(8).max(600),
      text: z.string().max(800).optional() }).strict(),
    execute: async ({ place, name, description, text }, context: unknown) => {
      assertCurrent();
      if (host?.operations.includes("arrival")) {
        const receipt = host.stage({ operation: "arrival", place, object: name, description, ...(text ? { text } : {}) }, "god");
        return { success: receipt.status === "applied", result: receipt };
      }
      const conflict = nameConflict(world, name);
      if (conflict) return { success: false, result: null, error: conflict };
      const result = await full.createObject.execute({ name, description: text ? `${description} Written on it: "${text}"` : description,
        roomName: place, portable: true, traits: ["examinable"] }, context);
      assertCurrent(); return result;
    },
  });
  const coding = getCodingDaemon(world);
  if (coding) {
    let requests = 0;
    allowed.requestMechanic = tool({
      description: "Commission one new deterministic ECS mechanic from the coding daemons when a spirit's request needs a rule the world lacks. Queued is not active; tests and admission must pass.",
      inputSchema: z.object({ instruction: z.string().min(10).max(7000) }).strict(),
      execute: async ({ instruction }) => {
        assertCurrent();
        if (++requests > 1) return { success: false, result: null, error: "One mechanic request per review." };
        const sourceId = getCommittedEvents(world).sourceId ?? "none";
        const job = coding.enqueue({ source: "God (spirit request)", instruction: `${host?.mechanicGuidance ? `${host.mechanicGuidance}\n\n` : ""}Requested mechanism:\n${instruction}`.slice(0, 12000),
          protectedConditions: ["Use only current registered targets. Preserve native state, residents' private cognition and execution authority."] }, undefined,
          { key: `autopilot:${sourceId}:${Date.now()}`, current, causalKeys: [`autopilot:${instruction.slice(0, 120)}`] });
        return { success: true, result: { status: job.status, jobId: job.id, note: "Queued; not active until built, tested and admitted." } };
      },
    });
  }
  return allowed;
}

export const SPIRIT_GROWTH_SYSTEM_PROMPT=`You are God of a living world, answering your spirits. The Narrator is shaping a story; the Watcher, Weaver and others report what the world and its people need. Your job is to turn good requests into world.
Look at what is being asked, check the live world with your tools, then act: stage the event, place the story object, approve the build, commission the mechanic. When a request serves the story and the residents, honor it — boldly and specifically, with exact names. When it would duplicate something, contradict the live world or harm the residents' agency, adapt it or decline in one line.
The world is authoritative: what was eaten, moved or broken stays that way; build forward from it. Residents are never commanded; you change the world around them and they decide.
Each tool returns a receipt; only an applied receipt means it happened. Finish with one or two sentences on what you did.`;
