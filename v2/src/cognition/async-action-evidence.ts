/** Issuance identity for asynchronous actions. Completion is evidence for the
 * action/goal that started the job, not whichever plan is current later. */
import type { World } from "../ecs/world";
import type { AgentAction } from "./agent-mind";
import type { OfficeProcessJob } from "../office-tools/async-jobs";
import type { CoordinationActionIssuance } from "./coordination-memory";

export interface AsyncActionEvidence {
    actorEid: number;
    action: AgentAction;
    goalEid?: number;
    plan?: { planEid: number; goalEid: number; currentStep: number };
    coordination?: CoordinationActionIssuance;
    /** Stable identity of the actual device resolved when the job was issued. */
    targetKey?: string;
}
const actions = new WeakMap<World, Map<string, AsyncActionEvidence>>();
const owners = new Map<string, WeakRef<World>>();
const buffered = new WeakMap<World, OfficeProcessJob[]>();

/** First issuance wins: tool deduplication must not rebind a running job. */
export function registerAsyncAction(world: World, jobId: string, evidence: AsyncActionEvidence): boolean {
    if (!jobId.trim()) throw new Error("An async action requires a job id");
    if (owners.has(jobId)) return false;
    let entries = actions.get(world);
    if (!entries) { entries = new Map(); actions.set(world, entries); }
    entries.set(jobId, { actorEid: evidence.actorEid, action: { ...evidence.action }, goalEid: evidence.goalEid,
        plan: evidence.plan ? { ...evidence.plan } : undefined,
        coordination: evidence.coordination ? structuredClone(evidence.coordination) : undefined,
        targetKey: evidence.targetKey });
    owners.set(jobId, new WeakRef(world));
    return true;
}

/** Consume exactly once. A poll belonging to another world cannot consume it. */
export function takeAsyncAction(world: World, jobId: string): AsyncActionEvidence | undefined {
    const entries = actions.get(world); const entry = entries?.get(jobId);
    if (!entry) return undefined;
    entries!.delete(jobId); owners.delete(jobId);
    return entry;
}

/** The legacy process-job queue is global. Registered jobs must wait for their
 * own world's poll rather than being delivered to an equal eid in another world. */
export function routeAsyncActionCompletions(world: World, incoming: OfficeProcessJob[]): OfficeProcessJob[] {
    const ready = buffered.get(world)?.splice(0) || [];
    for (const job of incoming) {
        const reference = owners.get(job.jobId);
        const owner = reference?.deref();
        if (reference && !owner) { owners.delete(job.jobId); continue; }
        if (owner && owner !== world) {
            let queue = buffered.get(owner); if (!queue) { queue = []; buffered.set(owner, queue); }
            queue.push(job);
        } else ready.push(job);
    }
    return ready;
}
