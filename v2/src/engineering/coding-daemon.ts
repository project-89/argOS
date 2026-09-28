import { mkdir, writeFile, readFile, rename, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { claimEngineeringDirectory } from "./directory-ownership";
import { addComponent, hasComponent, getAllEntities } from "bitecs";
import { z } from "zod";
import type { World } from "../ecs/world";
import { getComponent, getRegistryEntry, listDefinitions, extendDynamicComponent } from "../ecs/component-registry";
import { registerSystem, type SystemRegistry, type SystemDefinition } from "../ecs/dynamic-systems";
import { type BuildRequest, type BuildJob, type BuildStatus, type ComponentSpec, type EntitySnapshot, type Scalar, testSchema, SYSTEM_API, PROTECTED_MANAGED_COMPONENTS, MANAGED_SYSTEM_CAPABILITIES, PRIVATE_MANAGED_COMPONENTS } from "./contracts";
import { captureEntities, ManagedSystemWorker } from "./system-sandbox";
import { prepareRelease, type PreparedRelease } from "./release";
import { codexBuilder, geminiBuilder, type SystemBuilder } from "./builders";
import { getNativeRuntimeServices } from "../runtime/native-services";
import { getWorldAuthoringContext } from "../world/world-specification";
import { buildWorkSourceCurrent, identifyBuildWork } from "./build-work-identity";
import { captureRepairAdmission, type RepairAdmission } from "./repair-admission";

export type CodingReleaseContext = Readonly<{ componentNames: readonly string[] }>;

export interface CodingDaemonConfig {
  backend?: "codex" | "gemini";
  directory?: string;
  timeoutMs?: number;
  pollMs?: number;
  maxQueue?: number;
  /** Lifetime admitted job IDs in this daemon/store, including failed/cancelled
   * work. Omit for continuous worlds. Internal builder passes share one job. */
  maxTotalJobs?: number;
  /** Host-only, synchronous, read-only capability policy. Throw to reject a
   * release. Checked after independent tests and again before activation,
   * including accepted-history restoration. Never accepted from build JSON. */
  validateRelease?: (release: PreparedRelease, context: CodingReleaseContext) => void;
  /** Public host-provided build guidance, not execution authority. Captured at
   * construction, bounded, and never copied into persisted BuildRequest JSON. */
  authoringContext?: string;
  /** Trusted synchronous input projection before managed worker freshness
   * checks or release activation. Never supplied by a model/build artifact. */
  beforeCommit?: () => void;
  /** Trusted native input-schema installation before accepted-release replay.
   * Synchronous only; never supplied by a model or persisted build request. */
  initializeInputs?: () => void;
  /** Optional host-owned entity authority for public builder/worker inputs and
   * the entire runtime mutation batch. Synchronous, read-only, strict boolean;
   * bind current source and durable identities in the host. Never persisted or
   * supplied by build JSON. Omission preserves non-spatial whole-world scope. */
  permitsEntity?: (eid: number) => boolean;
  /** Optional host-owned scalar output policy, checked for release defaults
   * and complete runtime mutation batches before any writes. Synchronous,
   * read-only, strict boolean; never persisted or supplied by build JSON. */
  permitsValue?: (component: string, field: string, value: Scalar) => boolean;
}
export type BuildEvent = { job: BuildJob; message: string };
export type BuildAdmission = Readonly<{ key: string; current(): boolean;
  /** Host-observed stable causes. Never accepted in model/file BuildRequest JSON. */
  causalKeys?: readonly string[] }>;
export type ManagedSystemMetrics = {attempts:number;commits:number;changedCommits:number;staleResults:number;failures:number;maxWorkerMs:number;lastCommitTick:number};
const services = new WeakMap<World, CodingDaemon>();
export function getCodingDaemon(world: World): CodingDaemon | undefined { return services.get(world); }
const protectedComponents=PROTECTED_MANAGED_COMPONENTS;
const requestSchema=z.object({instruction:z.string().min(1).max(12000),source:z.string().min(1).max(100),
  acceptance:z.array(testSchema).max(30).optional(),protectedConditions:z.array(z.string().max(1000)).max(30).optional()}).strict();
const buildStatusSchema=z.enum(["queued","building","validating","ready","active","rejected","cancelled","rolled_back"]);
const persistedJobSchema=z.object({id:z.string().uuid(),request:requestSchema,status:buildStatusSchema,directory:z.string(),
  baseRevision:z.number().int().nonnegative(),createdAt:z.number().finite(),updatedAt:z.number().finite(),error:z.string().optional(),
  systems:z.array(z.string()).optional(),testsPassed:z.number().int().nonnegative().optional(),repairOfJobId:z.string().uuid().optional(),
  repairAttempt:z.number().int().min(1).max(1).optional(),admissionScope:z.string().min(1).max(500).optional(),
  work:z.object({key:z.string().regex(/^work:[a-f0-9]{64}$/),sourceId:z.string().min(1).max(500),
    causalKeys:z.array(z.string().min(1).max(500)).min(1).max(32)}).strict().optional()}).strip();
const MAX_MANAGED_REPAIR_ATTEMPTS=1;

/** Single-flight asynchronous engineering + synchronous, atomic tick-boundary admission. */
export class CodingDaemon {
  readonly directory: string;
  private jobs: BuildJob[]=[];
  private admissions = new Map<string, BuildAdmission>();
  private repairs = new Map<string, RepairAdmission>();
  private contracts = new WeakMap<SystemDefinition, PreparedRelease>();
  private admissionCurrent(job: BuildJob): boolean {
    if (job.work && !buildWorkSourceCurrent(this.world, job.work)) return false;
    if (!job.admissionScope) return true;
    const admission = this.admissions.get(job.id);
    try { return !!admission && admission.key === job.admissionScope && admission.current(); } catch { return false; }
  }
  private readonly maxTotalJobs: number | undefined;
  private readonly admittedJobIds = new Set<string>();
  private revision=0;
  private initialized=false;
  private stopped=false;
  private epoch=0;
  private busy=false;
  private timer?: ReturnType<typeof setInterval>;
  private abort?: AbortController;
  private ready: Array<{job:BuildJob;release:PreparedRelease;directory:string}>=[];
  private activeReleases: Array<{digest:string;id:string;disabled?:boolean}>=[];
  // Preparation is read-only with respect to ECS. Validate the entire ready batch
  // against one boundary state before any admitted result changes that state.
  private completions: Array<()=>void|(()=>void)>=[];
  private boundaryTick=0;
  private runtimeMetrics=new WeakMap<SystemDefinition,ManagedSystemMetrics>();
  private computations=new Set<Promise<void>>();
  private closeWorkers=new Map<SystemDefinition,()=>void>();
  private callbacks=new Map<string,Array<(job:BuildJob)=>void>>();
  private owned=new Map<string,{jobId:string;writes:string[]}>();
  private ancestors=new WeakMap<SystemDefinition,{definition?:SystemDefinition;owner?:{jobId:string;writes:string[]}}>();
  private persistence: Promise<void>=Promise.resolve();
  private onEvent?: (event:BuildEvent)=>void;
  private readonly builder: SystemBuilder;
  private readonly releasePolicy?: CodingDaemonConfig["validateRelease"];
  private readonly beforeCommit?: CodingDaemonConfig["beforeCommit"];
  private readonly initializeInputs?: CodingDaemonConfig["initializeInputs"];
  private readonly entityPolicy?: CodingDaemonConfig["permitsEntity"];
  private readonly valuePolicy?: CodingDaemonConfig["permitsValue"];
  private readonly hostAuthoringContext: string;
  /** Scoped to synchronous replay of already validated accepted history. */
  private restoringSchemaFields?: Map<string, Map<string, string>>;
  private restoringComponentNames?: readonly string[];

  constructor(readonly world: World, readonly registry: SystemRegistry, readonly config: CodingDaemonConfig={}, builder?:SystemBuilder) {
    if(config.maxTotalJobs !== undefined && (!Number.isSafeInteger(config.maxTotalJobs) || config.maxTotalJobs < 0))
      throw new Error("Coding admission budget must be a non-negative safe integer");
    this.maxTotalJobs = config.maxTotalJobs;
    if (config.validateRelease !== undefined && typeof config.validateRelease !== "function")
      throw new Error("Coding release policy must be a synchronous host function");
    this.releasePolicy = config.validateRelease;
    if (config.beforeCommit !== undefined && typeof config.beforeCommit !== "function")
      throw new Error("Coding before-commit hook must be a synchronous host function");
    this.beforeCommit = config.beforeCommit;
    if (config.initializeInputs !== undefined && typeof config.initializeInputs !== "function")
      throw new Error("Coding input initialization must be a synchronous host function");
    this.initializeInputs = config.initializeInputs;
    if (config.permitsEntity !== undefined && typeof config.permitsEntity !== "function")
      throw new Error("Coding entity policy must be a synchronous host function");
    this.entityPolicy = config.permitsEntity;
    if (config.permitsValue !== undefined && typeof config.permitsValue !== "function")
      throw new Error("Coding value policy must be a synchronous host function");
    this.valuePolicy = config.permitsValue;
    if (config.authoringContext !== undefined && (typeof config.authoringContext !== "string" || config.authoringContext.length > 12000))
      throw new Error("Coding authoring context must be a host string of at most 12000 characters");
    this.hostAuthoringContext = config.authoringContext?.trim() ?? "";
    this.directory=path.resolve(config.directory ?? path.join("data","live-builds",world.meta.name.replace(/[^A-Za-z0-9_-]/g,"_").slice(0,80)));
    this.builder=builder ?? ((config.backend ?? process.env.ARGOS_CODE_BUILDER ?? "codex")==="gemini" ? geminiBuilder : codexBuilder);
    services.set(world,this);
  }
  setEventHandler(callback:(event:BuildEvent)=>void):void { this.onEvent=callback; }
  getHostAuthoringContext(): string { return this.hostAuthoringContext; }
  ownsSystem(name:string):boolean {return this.owned.has(name);}
  /** Model callers can request only a currently managed replacement. Native
   * rollback and Tinker share this queue and the same host admission boundary. */
  requestRepair(name:string,instruction:string):BuildJob {
    const pending=this.jobs.find(job=>["queued","building","validating","ready"].includes(job.status)
      && this.repairs.get(job.id)?.systems.includes(name) && this.admissionCurrent(job));
    if(pending)return structuredClone(pending);
    const system=this.registry.systems.get(name),owner=this.owned.get(name);
    const release=system && this.contracts.get(system),job=this.jobs.find(row=>row.id===owner?.jobId);
    if(!system || !owner || !release || !job)throw Error("Automatic repair requires a managed system; unmanaged migration needs explicit host approval");
    if(system.managedRelease?.jobId!==owner.jobId)throw Error("Managed system ownership changed");
    return this.enqueueRepair(job,release,instruction,[name]);
  }
  getRepairStatus(jobId:string) {
    const job=this.jobs.find(row=>row.id===jobId);
    if(!job)return undefined;
    const recovered=job.status==="active" && !!job.systems?.length && job.systems.every(name=>{
      const system=this.registry.systems.get(name),metrics=system && this.runtimeMetrics.get(system);
      return system?.active && system.managedRelease?.jobId===job.id && !!metrics?.changedCommits && metrics.failures===0;
    });
    return {jobId,systems:job.systems ?? this.repairs.get(jobId)?.systems ?? [],
      stage:recovered?"recovered":job.status==="active"?"activated":job.status==="ready"?"validated":job.status,
      recovered,error:job.error};
  }
  getStatus() { return {revision:this.revision,running:!this.stopped,busy:this.busy,directory:this.directory,
    admissionBudget:{limit:this.maxTotalJobs ?? null,used:this.admittedJobIds.size,
      remaining:this.maxTotalJobs === undefined ? null : Math.max(0,this.maxTotalJobs-this.admittedJobIds.size)},
    activeSystems:[...this.owned].map(([name,owner])=>({name,jobId:owner.jobId,writes:[...owner.writes],active:this.registry.systems.get(name)?.active ?? false})),
    runtime:[...this.owned].map(([name,owner])=>({name,jobId:owner.jobId,...this.runtimeMetrics.get(this.registry.systems.get(name)!)})),
    jobs:structuredClone(this.jobs)}; }
  private event(job:BuildJob,message:string):void {
    job.updatedAt=Date.now();
    try { this.onEvent?.({job:structuredClone(job),message}); } catch(error) { console.error("[CodingDaemon] Observer failed",error); }
  }
  private finish(job:BuildJob,status:BuildStatus,message:string):void {
    job.status=status;
    if(status==="rejected"||status==="cancelled"||status==="rolled_back") job.error=message;
    this.event(job,message);
    const callbacks=this.callbacks.get(job.id) ?? []; this.callbacks.delete(job.id);
    for(const callback of callbacks) {
      try { callback(structuredClone(job)); } catch(error) { console.error("[CodingDaemon] Completion observer failed",error); }
    }
    this.persistJob(job);
    this.admissions.delete(job.id);
  }
  private persistJob(job:BuildJob):void {
    const snapshot=JSON.stringify(job,null,2);
    this.persistence=this.persistence.then(async()=>{
      const dir=path.join(this.directory,"jobs",job.id); await mkdir(dir,{recursive:true});
      await writeFile(path.join(dir,"host-job.json"),snapshot);
    }).catch(error=>console.error("[CodingDaemon] Cannot persist job",error));
  }
  async flush():Promise<void> { await this.persistence; }
  /** Test/diagnostic barrier; the live scheduler never awaits system workers. */
  async settle():Promise<void> {await Promise.all([...this.computations]);}

  async initialize():Promise<void> {
    if(this.initialized) return;
    // Native input schemas must exist before accepted generated code is
    // checked against them. Stored modules never grant their own input schema.
    if (this.initializeInputs) this.assertSynchronousHostResult(this.initializeInputs(), "Coding input initialization");
    if (process.env.ARGOS_PROCESS_WORLD_HOST === "1") {
      const release = claimEngineeringDirectory(this.directory);
      // Hold through stop/pending persistence. Process exit is the writer fence.
      process.once("exit", release);
    }
    await mkdir(path.join(this.directory,"inbox"),{recursive:true});
    await mkdir(path.join(this.directory,"releases"),{recursive:true});
    await mkdir(path.join(this.directory,"jobs"),{recursive:true});
    let saved:Array<{digest:string;id:string;disabled?:boolean}>=[];
    try { saved=z.array(z.object({digest:z.string().regex(/^[a-f0-9]{64}$/),id:z.string().uuid(),disabled:z.boolean().optional()})).parse(JSON.parse(await readFile(path.join(this.directory,"active.json"),"utf8"))); }
    catch(error:any) { if(error.code!=="ENOENT") throw new Error(`Invalid live release index: ${error}`); }
    // A snapshot is data, not permission to execute its embedded module. Match
    // every pending module against this caller-selected accepted release store
    // before changing ownership or activating any of its systems.
    const pending = [...this.registry.systems.values()].filter(system => system.managedRestorePending);
    const prepared = new Map<string, PreparedRelease>();
    const acceptedFields = new Map<string, Map<string, string>>();
    const precedingComponents = new Set<string>();
    const replayContexts = new Map<(typeof saved)[number], readonly string[]>();
    // Reopening an accepted store does not carry the previous host's execution
    // grant. Preflight the entire history before removing pending definitions
    // or restoring even the first schema/system under this host's policy.
    for (const entry of saved) {
      const release = await prepareRelease(path.join(this.directory, "releases", entry.digest));
      if (release.digest !== entry.digest) throw new Error("Persisted release digest mismatch");
      const prior = Object.freeze([...precedingComponents].sort());
      this.validateHostRelease(release, prior);
      prepared.set(entry.digest, release);
      replayContexts.set(entry, prior);
      for (const component of release.components) precedingComponents.add(component.name);
    }
    if (pending.length) {
      const effective = new Map<string, { digest: string; jobId: string; code: string | undefined }>();
      for (const entry of saved) {
        const release = prepared.get(entry.digest)!;
        for (const component of release.components) {
          const fields = acceptedFields.get(component.name) ?? new Map<string, string>();
          for (const [name, field] of Object.entries(component.fields)) {
            if (fields.has(name) && fields.get(name) !== field.type) throw new Error(`Incompatible accepted schema history: ${component.name}.${name}`);
            fields.set(name, field.type);
          }
          acceptedFields.set(component.name, fields);
        }
        for (const spec of entry.disabled ? [] : release.manifest.systems) {
          effective.set(spec.name, { digest: entry.digest, jobId: entry.id, code: release.sources.get(spec.file) });
        }
      }
      for (const system of pending) {
        const accepted = effective.get(system.name);
        if (!accepted) throw new Error(`Managed snapshot release unavailable: ${system.name}`);
        if (system.managedRelease?.digest !== accepted.digest || system.managedRelease.jobId !== accepted.jobId
          || system.code !== accepted.code) throw new Error(`Managed snapshot/store mismatch: ${system.name}`);
        effective.delete(system.name);
      }
      if (effective.size) throw new Error(`Managed store contains systems absent from snapshot: ${[...effective.keys()].join(", ")}`);
      for (const [name, fields] of acceptedFields) {
        const existing = getRegistryEntry(name);
        if (existing?.isStatic) throw new Error(`Cannot redefine built-in ${name}`);
        for (const [field, value] of Object.entries(existing?.definition?.properties ?? {})) {
          const type = typeof value === "string" ? value : (value as any).type;
          if (fields.get(field) !== type) throw new Error(`Managed snapshot schema mismatch: ${name}.${field}`);
        }
        // Replay may retain fields from a later accepted snapshot schema.
        // Validate those defaults before removing any pending definition.
        for (const [field, value] of Object.entries(existing?.definition?.defaults ?? {}))
          this.assertPermittedValue(name, field, value);
      }
      for (const system of pending) this.registry.systems.delete(system.name);
    }
    const persisted=new Map<string,BuildJob>();
    for(const name of (await readdir(path.join(this.directory,"jobs"))).filter(name=>/^[a-f0-9-]{36}$/i.test(name)).sort()) {
      // A damaged/missing receipt must not refund a slot after restart. Job
      // directories and accepted release IDs are conservative admission history.
      this.admittedJobIds.add(name.toLowerCase());
      const file=path.join(this.directory,"jobs",name,"host-job.json");
      try {
        const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>250000)continue;
        const job=persistedJobSchema.parse(JSON.parse(await readFile(file,"utf8"))) as BuildJob;
        if(job.id!==name)throw new Error("Job directory/id mismatch");
        persisted.set(job.id,job);this.jobs.push(job);
      } catch(error:any) {
        if(error.code!=="ENOENT")console.warn(`[CodingDaemon] Ignoring invalid persisted job ${name}: ${String(error).slice(0,200)}`);
      }
    }
    this.jobs.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
    for(const entry of saved) {
      this.admittedJobIds.add(entry.id.toLowerCase());
      const directory=path.join(this.directory,"releases",entry.digest);
      const release=prepared.get(entry.digest)!;
      if(release.digest!==entry.digest) throw new Error("Persisted release digest mismatch");
      const job=persisted.get(entry.id) ?? {id:entry.id,request:{instruction:"Restore accepted release",source:"restore"},directory,
        baseRevision:this.revision,status:"ready" as const,createdAt:Date.now(),updatedAt:Date.now()};
      if(!persisted.has(entry.id))this.jobs.push(job);
      job.baseRevision=this.revision;job.status="ready";job.systems=release.manifest.systems.map(system=>system.name);
      this.ready.push({job,release,directory});
      this.restoringSchemaFields = pending.length ? acceptedFields : undefined;
      this.restoringComponentNames = replayContexts.get(entry);
      try { this.commitReady(0,false,entry.disabled); }
      finally { this.restoringSchemaFields = undefined; this.restoringComponentNames = undefined; }
      const restoredStatus=job.status as BuildStatus;
      if(restoredStatus!=="active"&&restoredStatus!=="rolled_back") throw new Error(`Could not restore release: ${job.error}`);
    }
    const activeIds=new Set(saved.map(entry=>entry.id));
    for (const system of pending) {
      const restored = this.registry.systems.get(system.name);
      if (!restored?.managedRelease || restored.managedRelease.digest !== system.managedRelease?.digest)
        throw new Error(`Managed snapshot was not rebound: ${system.name}`);
      restored.active = system.managedRestorePending!.active;
    }
    for(const job of this.jobs) if(!activeIds.has(job.id)&&["queued","building","validating","ready","active"].includes(job.status)) {
      if (job.admissionScope || job.work) { this.finish(job,"cancelled","Observed build requires fresh authorization after restore"); continue; }
      // A crash may happen after an inbox request was renamed accepted but
      // before activation. Rebuild in a fresh directory so partial/stale
      // release.json files from the interrupted attempt cannot be admitted.
      job.directory=path.join(this.directory,"jobs",job.id,`candidate-recovery-${randomUUID()}`);
      job.baseRevision=this.revision;job.status="queued";job.error=undefined;job.systems=undefined;job.testsPassed=undefined;
      this.event(job,"Recovered interrupted engineering request after restart");this.persistJob(job);
    }
    this.initialized=true;
  }
  start():void {
    if(this.timer) return;
    this.stopped=false;
    this.timer=setInterval(()=>{void this.pump();},Math.max(100,this.config.pollMs ?? 1000));
    this.timer.unref();
    void this.pump();
  }
  stop():void {
    this.stopped=true;
    this.epoch++;
    if(this.timer) clearInterval(this.timer); this.timer=undefined;
    this.abort?.abort();
    for(const close of this.closeWorkers.values()) close();this.closeWorkers.clear();this.completions=[];
    this.ready=[];
    for(const job of this.jobs) if(["queued","building","validating","ready"].includes(job.status)) this.finish(job,"cancelled","Simulation stopped; candidate not activated");
  }
  enqueue(request:BuildRequest,onComplete?:(job:BuildJob)=>void,admission?:BuildAdmission):BuildJob {
    if(this.stopped) throw new Error("Coding daemon is stopped");
    if(this.maxTotalJobs !== undefined && !this.initialized) throw new Error("Initialize coding admission history before bounded submissions");
    const parsed=requestSchema.parse(request);
    if(admission && (!admission.key || admission.key.length>500 || !admission.current())) throw new Error("Observed build demand is no longer current");
    const work=identifyBuildWork(this.world,parsed,admission?.causalKeys);
    const duplicate=this.jobs.find(j=>["queued","building","validating","ready"].includes(j.status) && this.admissionCurrent(j)
      && (work ? j.work?.key===work.key : !j.work && JSON.stringify(j.request)===JSON.stringify(parsed) && this.admissions.get(j.id)===admission));
    if(duplicate) {
      // Joining observes the original job; it does not replace/extend its original
      // approval. That approval must still pass at build and activation boundaries.
      if(onComplete && (this.callbacks.get(duplicate.id)?.length ?? 0)>=64) throw new Error("Build completion observer limit reached");
      if(onComplete)this.callbacks.set(duplicate.id,[...(this.callbacks.get(duplicate.id) ?? []),onComplete]);
      return structuredClone(duplicate);
    }
    if(this.maxTotalJobs !== undefined && this.admittedJobIds.size >= this.maxTotalJobs)
      throw new Error(`Coding admission budget exhausted (${this.admittedJobIds.size}/${this.maxTotalJobs} jobs)`);
    if(this.jobs.filter(j=>["queued","building","validating","ready"].includes(j.status)).length >= (this.config.maxQueue??8)) throw new Error("Coding queue is full");
    const id=randomUUID();
    // Reserve synchronously before callbacks/persistence can re-enter enqueue.
    this.admittedJobIds.add(id);
    const job:BuildJob={id,request:parsed,status:"queued",directory:path.join(this.directory,"jobs",id,"candidate"),baseRevision:this.revision,createdAt:Date.now(),updatedAt:Date.now()};
    if(admission) { job.admissionScope=admission.key; this.admissions.set(id,admission); }
    if(work) job.work=work;
    this.jobs.push(job); if(onComplete) this.callbacks.set(id,[onComplete]);
    this.event(job,"Engineering request queued"); this.persistJob(job);
    return structuredClone(job);
  }

  /** File inbox permits local authoring daemons to submit requests without restarting the sim. */
  private async scanInbox():Promise<void> {
    const dir=path.join(this.directory,"inbox");
    for(const file of (await readdir(dir)).filter(f=>/^[A-Za-z0-9_-]+\.json$/.test(f)).sort()) {
      const full=path.join(dir,file),stat=await lstat(full);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>100000) continue;
      try {
        const request=requestSchema.parse(JSON.parse(await readFile(full,"utf8")));
        const job=this.enqueue(request);
        await rename(full,path.join(dir,`${file}.${job.id}.accepted`));
      } catch(error) {
        // Partial writes stay pending. The producer should publish with an atomic rename.
        console.warn(`[CodingDaemon] Inbox ${file}: ${String(error).slice(0,200)}`);
      }
    }
  }

  async pump():Promise<void> {
    if(this.busy||this.stopped||!this.initialized) return;
    this.busy=true;
    try {
      await this.scanInbox();
      // Do not build on an obsolete schema while another candidate awaits the next tick.
      if(this.ready.length) return;
      const job=this.jobs.find(j=>j.status==="queued"); if(!job) return;
      if(!this.admissionCurrent(job)) { this.finish(job,"cancelled","Observed build demand changed before building"); return; }
      job.baseRevision=this.revision; job.status="building"; this.event(job,"Coding worker started");
      const abort=new AbortController(); this.abort=abort;
      const buildEpoch=this.epoch;
      const timeoutMs=Math.max(1,this.config.timeoutMs??180000);
      let deadlineExpired=false;
      const deadline=setTimeout(()=>{
        deadlineExpired=true;
        abort.abort(new Error(`Coding worker timed out after ${timeoutMs}ms`));
      },timeoutMs);
      try {
        await mkdir(job.directory,{recursive:true});
        const activeProtectedConditions=[...new Set([...this.owned.values()].flatMap(owner=>
          this.jobs.find(candidate=>candidate.id===owner.jobId)?.request.protectedConditions ?? []))];
        const worldAuthoringContext = getWorldAuthoringContext(this.world);
        const context=JSON.stringify({request:job.request,revision:this.revision,schemas:listDefinitions(),
          ...(worldAuthoringContext ? { worldAuthoringContext } : {}),
          ...(this.hostAuthoringContext ? { hostAuthoringContext: this.hostAuthoringContext } : {}),
          nativeRuntimeServices:getNativeRuntimeServices(this.world),
          managedCapabilities: { supported: MANAGED_SYSTEM_CAPABILITIES, protectedComponents: [...PROTECTED_MANAGED_COMPONENTS], privateUnreadableComponents: [...PRIVATE_MANAGED_COMPONENTS] },
          repairContract:this.repairs.get(job.id)?.contract,
          systems:[...this.registry.systems.values()].map(s=>({name:s.name,description:s.description,code:s.code?.slice(0,10000)})),
          activeProtectedConditions,world:this.captureManagedEntities(this.world).slice(0,300).map(entity => ({ ...entity,
            components: Object.fromEntries(Object.entries(entity.components).filter(([name]) => !PRIVATE_MANAGED_COMPONENTS.has(name))) })),api:SYSTEM_API},null,2);
        abort.signal.throwIfAborted();
        // Cancellation is a host boundary, not a courtesy to the provider. A
        // broken/custom builder may ignore AbortSignal indefinitely; racing the
        // signal lets this single build lane recover while the abandoned promise
        // can only write inside its unique, never-admitted candidate directory.
        const cancelled=new Promise<never>((_resolve,reject)=>{
          const fail=()=>reject(abort.signal.reason instanceof Error
            ? abort.signal.reason : new Error("Coding worker cancelled"));
          if(abort.signal.aborted) fail();
          else abort.signal.addEventListener("abort",fail,{once:true});
        });
        const build=Promise.resolve().then(()=>this.builder({
          job:structuredClone(job),directory:job.directory,context,signal:abort.signal,
          progress:message=>{
            if(this.epoch!==buildEpoch||this.stopped||abort.signal.aborted||job.status!=="building")return;
            this.event(job,message.slice(0,1000));
          },
        }));
        // Promise.race installs a rejection handler on the builder promise. Its
        // late result is intentionally ignored after cancellation/timeout.
        await Promise.race([build,cancelled]);
        abort.signal.throwIfAborted(); if(this.stopped) return;
        job.status="validating"; this.event(job,"Independent host validation");
        let release=await prepareRelease(job.directory,job.request.acceptance);
        const explicit=new Set((job.request.acceptance??[]).map(test=>JSON.stringify(test)));
        const inherited=release.manifest.systems.flatMap(system=>{
          const owner=this.owned.get(system.name);
          return (this.jobs.find(candidate=>candidate.id===owner?.jobId)?.request.acceptance ?? [])
            .filter(test=>test.system===system.name&&!explicit.has(JSON.stringify(test)));
        });
        if(inherited.length) {
          const effective=[...(job.request.acceptance??[]),...inherited];
          if(effective.length>30)throw new Error("Replacement inherits more than 30 host acceptance tests; split the release");
          release=await prepareRelease(job.directory,effective);job.request.acceptance=effective;
        }
        const replacementProtections=[...new Set([...(job.request.protectedConditions??[]),...release.manifest.systems.flatMap(system=>{
          const owner=this.owned.get(system.name);
          return this.jobs.find(candidate=>candidate.id===owner?.jobId)?.request.protectedConditions ?? [];
        })])];
        if(replacementProtections.length>30)throw new Error("Replacement inherits more than 30 protected conditions; split the release");
        if(replacementProtections.length)job.request.protectedConditions=replacementProtections;
        abort.signal.throwIfAborted();
        this.validateHostRelease(release);
        this.checkCompatibility(release);
        this.repairs.get(job.id)?.validate(release);
        const releaseDir=path.join(this.directory,"releases",release.digest);
        await mkdir(releaseDir,{recursive:true});
        // Copy exactly the bytes validated; later edits to the candidate cannot change this release.
        for(const [file,source] of release.sources) {
          const target=path.join(releaseDir,file); await mkdir(path.dirname(target),{recursive:true});
          await writeFile(target,source);
        }
        abort.signal.throwIfAborted(); if(this.stopped) return;
        if(!this.admissionCurrent(job)) throw new Error("Observed build demand changed during building");
        job.status="ready";job.testsPassed=release.testsPassed;job.systems=release.manifest.systems.map(s=>s.name);
        this.ready.push({job,release,directory:releaseDir});this.event(job,"Validated files ready for tick-boundary activation");this.persistJob(job);
      } catch(error) {
        if(!this.stopped) this.finish(job,deadlineExpired?"rejected":abort.signal.aborted?"cancelled":"rejected",String(error));
      }
      finally { clearTimeout(deadline);if(this.abort===abort)this.abort=undefined; }
    } catch(error) { console.error("[CodingDaemon] Poll failed",error); }
    finally {this.busy=false;}
  }

  private scheduleManagedRepair(job:BuildJob,release:PreparedRelease,reason:string):void {
    if(this.stopped)return;
    if((job.repairAttempt??0)>=MAX_MANAGED_REPAIR_ATTEMPTS) {
      this.event(job,"Managed repair attempt exhausted; failed release remains quarantined");this.persistJob(job);return;
    }
    const failedCode=release.manifest.systems.map(system=>
      `SYSTEM ${system.name}:\n${(release.sources.get(system.file)??"").slice(0,3000)}`).join("\n\n");
    const instruction=`Repair the managed release that failed after activation. This is the only automatic repair attempt; diagnose the runtime failure, preserve the requested behavior and host invariants, and return a complete independently tested replacement release.\nFAILED JOB: ${job.id}\nORIGINAL REQUEST: ${job.request.instruction}\nRUNTIME FAILURE: ${reason}\nFAILED IMPLEMENTATION:\n${failedCode}`.slice(0,12000);
    try {
      this.enqueueRepair(job,release,instruction);
    } catch(error) {
      console.error(`[CodingDaemon] Could not queue bounded repair for ${job.id}:`,error);
      this.event(job,`Managed release remains rolled back; repair could not be queued: ${String(error).slice(0,300)}`);this.persistJob(job);
    }
  }

  private enqueueRepair(job:BuildJob,release:PreparedRelease,instruction:string,names=release.manifest.systems.map(spec=>spec.name)):BuildJob {
    if((job.repairAttempt??0)>=MAX_MANAGED_REPAIR_ATTEMPTS)throw Error("Bounded repair attempt exhausted; host review required");
    const specs=release.manifest.systems.filter(spec=>names.includes(spec.name));
    const epoch=this.epoch;
    const admission=captureRepairAdmission(this.world,this.registry,specs,release.components,
      ()=>!this.stopped && this.epoch===epoch && getCodingDaemon(this.world)===this);
    const queued=this.enqueue({source:"The Tinker",instruction,
      acceptance:job.request.acceptance?.filter(test=>names.includes(test.system)),
      protectedConditions:job.request.protectedConditions},undefined,admission);
    this.repairs.set(queued.id,admission);
    const repair=this.jobs.find(candidate=>candidate.id===queued.id)!;
    repair.repairOfJobId=job.id;repair.repairAttempt=(job.repairAttempt??0)+1;
    this.event(repair,`Bounded managed repair ${repair.repairAttempt}/${MAX_MANAGED_REPAIR_ATTEMPTS} queued for ${names.join(", ")}`);
    this.persistJob(repair);
    return structuredClone(repair);
  }

  private admittedComponentNames(): readonly string[] {
    const names = new Set<string>();
    for (const [name, owner] of this.owned) {
      const definition = this.registry.systems.get(name);
      if (!definition || definition.managedRelease?.jobId !== owner.jobId) continue;
      for (const component of this.contracts.get(definition)?.components ?? []) names.add(component.name);
    }
    return [...names].sort();
  }

  private validateHostRelease(release: PreparedRelease, prior?: readonly string[]): void {
    for (const component of release.components) for (const [field, schema] of Object.entries(component.fields))
      this.assertPermittedValue(component.name, field, schema.default);
    if (!this.releasePolicy) return;
    // Candidates never enter this provenance set. Restore preflights and
    // replays each release against only its validated preceding history.
    const context: CodingReleaseContext = Object.freeze({ componentNames: Object.freeze([
      ...(prior ?? this.restoringComponentNames ?? this.admittedComponentNames()),
    ]) });
    this.assertSynchronousHostResult(this.releasePolicy(release, context), "Coding release policy");
  }

  private permitsEntity(eid: number): boolean {
    if (!this.entityPolicy) return true;
    const permitted: unknown = this.entityPolicy(eid);
    if (typeof permitted !== "boolean") {
      if (permitted instanceof Promise) void permitted.catch(() => {});
      throw new Error("Coding entity policy must complete synchronously and return boolean");
    }
    return permitted;
  }

  private assertPermittedValue(component: string, field: string, value: Scalar): void {
    if (!this.valuePolicy) return;
    const permitted: unknown = this.valuePolicy(component, field, value);
    if (typeof permitted !== "boolean") {
      if (permitted instanceof Promise) void permitted.catch(() => {});
      throw new Error("Coding value policy must complete synchronously and return boolean");
    }
    if (!permitted) throw new Error(`Coding value policy rejected ${component}.${field}`);
  }

  private validateMutationValues(before: EntitySnapshot[], after: EntitySnapshot[]): void {
    if (!this.valuePolicy) return;
    for (let index = 0; index < after.length; index++) {
      for (const [name, fields] of Object.entries(after[index].components)) {
        const previous = before[index].components[name];
        // Attachment first materializes the current host schema defaults,
        // including later accepted fields absent from this worker's schema.
        if (!previous) for (const [field, value] of Object.entries(getRegistryEntry(name)?.definition?.defaults ?? {}))
          this.assertPermittedValue(name, field, value);
        for (const [field, value] of Object.entries(fields)) if (!previous || previous[field] !== value)
          this.assertPermittedValue(name, field, value);
      }
    }
  }

  private captureManagedEntities(world: World, reads?: string[]): EntitySnapshot[] {
    if (this.entityPolicy && world !== this.world) throw new Error("Coding entity scope belongs to another world");
    const entities = captureEntities(world, reads);
    return this.entityPolicy ? entities.filter(entity => this.permitsEntity(entity.id)) : entities;
  }

  private currentMutationScope(before: EntitySnapshot[], after: EntitySnapshot[]): boolean {
    // Validate all targets before any attachment/write. Worker validation also
    // checks membership; its completed result is not a lasting host grant.
    return !this.entityPolicy || before.length === after.length && after.every((entity, index) =>
      entity.id === before[index].id && this.permitsEntity(entity.id));
  }

  private assertSynchronousHostResult(result: unknown, label: string): void {
    // TypeScript permits async functions where void is expected; do not let
    // an accidentally asynchronous host policy admit work before it finishes.
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => {});
      throw new Error(`${label} must complete synchronously and return void`);
    }
  }

  private checkCompatibility(release:PreparedRelease):void {
    const schemas=new Map(release.components.map(c=>[c.name,c]));
    const incomingSystems=new Set(release.manifest.systems.map(system=>system.name));
    for(const component of release.components) {
      const old=getRegistryEntry(component.name);
      if(old?.isStatic) throw new Error(`Cannot redefine built-in ${component.name}`);
      for(const [field,value] of Object.entries(old?.definition?.properties??{})) {
        const type=typeof value==="string"?value:(value as any).type;
        const incoming = component.fields[field]?.type;
        const acceptedLaterField = incoming === undefined && this.restoringSchemaFields?.get(component.name)?.get(field) === type;
        if(incoming!==type && !acceptedLaterField) throw new Error(`Incompatible schema: ${component.name}.${field}`);
      }
    }
    for(const system of release.manifest.systems) {
      if(this.registry.systems.has(system.name)&&!this.owned.has(system.name)) throw new Error(`Cannot replace unmanaged system ${system.name}`);
      for(const coordinate of system.writes) if(protectedComponents.has(coordinate.split(".")[0])) throw new Error(`Protected component ${coordinate.split(".")[0]}`);
      for(const name of system.reads) {
        if(PRIVATE_MANAGED_COMPONENTS.has(name)) throw new Error(`Private component read denied: ${name}`);
        if(!getComponent(name)&&!schemas.has(name)) throw new Error(`Unknown component ${name}`);
      }
      for(const coordinate of system.writes) {
        const [name,field]=coordinate.split(".");
        if(!system.reads.includes(name)) throw new Error(`Written component must be declared readable: ${name}`);
        if(!schemas.get(name)?.fields[field]&&!Object.hasOwn(getComponent(name)??{},field)) throw new Error(`Unknown field ${coordinate}`);
        // An atomic release may deliberately transfer a field from one of its
        // replaced systems to another. Current owners absent from this release
        // remain protected; incoming/incoming conflicts are checked below.
        for(const [other,owner] of this.owned) if(other!==system.name&&!incomingSystems.has(other)&&owner.writes.includes(coordinate)) throw new Error(`Write conflict: ${other} owns ${coordinate}`);
        for(const other of release.manifest.systems) if(other.name!==system.name&&other.writes.includes(coordinate)) throw new Error(`Release write conflict: ${coordinate}`);
      }
    }
  }

  /** Called before world tick. No awaits or filesystem work inside the admission transaction. */
  commitReady(tick:number,persist=true,disabled=false):void {
    if(this.stopped) return;
    // Refresh weather/location-derived public inputs before a worker result
    // compares its captured read set. Host failure leaves all work unapplied.
    if (this.beforeCommit) this.assertSynchronousHostResult(this.beforeCommit(), "Coding before-commit hook");
    this.boundaryTick=tick;
    const commits=this.completions.splice(0).map(prepare=>prepare());
    for(const commit of commits)if(commit)commit();
    const next=this.ready.shift();if(!next)return;
    const {job,release}=next;
    try {
      // Accepted history may be restored; an uncommitted observed job may not
      // inherit authority merely because its files validated successfully.
      if(persist && !this.admissionCurrent(job)) throw new Error("Observed build demand changed before activation");
      if(job.baseRevision!==this.revision) throw new Error("Stale release: registry changed during build");
      this.validateHostRelease(release);
      this.checkCompatibility(release);
      if(persist)this.repairs.get(job.id)?.validate(release);
      const defaultTargets = getAllEntities(this.world).filter(id => this.permitsEntity(id));
      const installations=release.components.map(component => {
        const properties=Object.fromEntries(Object.entries(component.fields).map(([name,f])=>[name,f.type]));
        const defaults=Object.fromEntries(Object.entries(component.fields).map(([name,f])=>[name,f.default]));
        if (this.restoringSchemaFields) {
          // Older history must not delete fields already restored from a later
          // accepted schema. Compatibility above proved their type/provenance.
          const existing = getRegistryEntry(component.name)?.definition;
          for (const [field, value] of Object.entries(existing?.properties ?? {})) if (!(field in properties)) {
            properties[field] = typeof value === "string" ? value : (value as any).type;
            const savedDefault = existing?.defaults?.[field];
            if (savedDefault !== undefined) defaults[field] = savedDefault;
          }
        }
        for(const [field,value] of Object.entries(defaults)) this.assertPermittedValue(component.name,field,value);
        return {name:component.name,description:component.description,properties,defaults};
      });
      // Validate every effective default before changing even the first schema.
      for(const installation of installations) {
        extendDynamicComponent(installation);
        const soa=getComponent(installation.name);
        for(const id of defaultTargets) if(hasComponent(this.world,id,soa)) {
          for(const [field,value] of Object.entries(installation.defaults)) if(soa[field][id]===undefined) soa[field][id]=value;
        }
      }
      const previousVersions=new Map(release.manifest.systems.map(s=>[s.name,this.registry.systems.get(s.name)]));
      const previousOwners=new Map(release.manifest.systems.map(s=>[s.name,this.owned.get(s.name)]));
      const definitions=new Map<string,SystemDefinition>();
      const rollback=(reason:string)=>{
        if(job.status!=="active")return;
        for(const [name,definition] of definitions) {
          if(this.registry.systems.get(name)!==definition)continue;
          definition.active=false;this.closeWorkers.get(definition)?.();this.closeWorkers.delete(definition);
          let previous=previousVersions.get(name),owner=previousOwners.get(name);
          // Another system may have invalidated an ancestor release while a newer
          // version was running. Never resurrect that failed ancestor on rollback.
          while(previous && owner && this.jobs.some(j=>j.id===owner!.jobId && j.status==="rolled_back")) {
            const ancestor=this.ancestors.get(previous);previous=ancestor?.definition;owner=ancestor?.owner;
          }
          if(previous)this.registry.systems.set(name,previous);else this.registry.systems.delete(name);
          if(owner)this.owned.set(name,owner);else this.owned.delete(name);
        }
        this.revision++;
        this.finish(job,"rolled_back",reason);
        this.activeReleases=this.activeReleases.map(r=>r.id===job.id?{...r,disabled:true}:r);this.persistActive();
        this.scheduleManagedRepair(job,release,reason);
      };
      for(const spec of disabled?[]:release.manifest.systems) {
        const previous=previousVersions.get(spec.name);
        if(previous){this.closeWorkers.get(previous)?.();this.closeWorkers.delete(previous);}
        let lastTick=tick-spec.frequency,elapsed=0,pending=false;
        let worker:ManagedSystemWorker|undefined;
        const metrics:ManagedSystemMetrics={attempts:0,commits:0,changedCommits:0,staleResults:0,failures:0,maxWorkerMs:0,lastCommitTick:0};
        const definition:SystemDefinition={name:spec.name,description:spec.description,pseudocode:"Managed release "+release.digest,
          managedRelease:{digest:release.digest,jobId:job.id},
          code:release.sources.get(spec.file),frequency:0,active:true,lastRun:previous?.lastRun??0,
          compiledFn:(world,ctx)=>{
            if(this.stopped)return;
            elapsed+=ctx.delta;
            if(pending||ctx.tick-lastTick<spec.frequency)return;lastTick=ctx.tick;
            if(!worker){worker=new ManagedSystemWorker(release.scripts.get(spec.name)!);this.closeWorkers.set(definition,()=>{worker?.close();worker=undefined;});}
            pending=true;
            metrics.attempts++;const started=performance.now();
            const deltaMs=elapsed,epoch=this.epoch;elapsed=0;
            const failedCommit=(error:unknown)=>{
              metrics.failures++;
              return ()=>{if(epoch===this.epoch&&this.registry.systems.get(spec.name)===definition){
                const message=`${spec.name} failed at tick ${ctx.tick}: ${error}`;
                const errorCount=(this.registry.errorCounts.get(spec.name)??0)+1;
                this.registry.errors.push({systemName:spec.name,error:message,timestamp:Date.now(),errorCount});
                this.registry.errorCounts.set(spec.name,errorCount);
                rollback(message);
              }};
            };
            const calculation=(async()=>{try {
              const before=this.captureManagedEntities(world,spec.reads);
              const after=await worker!.run(spec,before,release.components,ctx.tick,deltaMs);
              if(epoch!==this.epoch||this.stopped||this.registry.systems.get(spec.name)!==definition||!definition.active)return;
              this.completions.push(()=>{
              if(epoch!==this.epoch||this.registry.systems.get(spec.name)!==definition||!definition.active)return;
              // Optimistic concurrency: player/NPC changes win over stale worker results.
              if(!this.currentMutationScope(before,after)
                || JSON.stringify(this.captureManagedEntities(world,spec.reads))!==JSON.stringify(before)){elapsed+=deltaMs;metrics.staleResults++;return;}
              try { this.validateMutationValues(before,after); }
              catch(error) { return failedCommit(error); }
              return ()=>{
              if(epoch!==this.epoch||this.registry.systems.get(spec.name)!==definition||!definition.active)return;
              // An earlier admitted result may revoke a host scope at this same
              // boundary. Reject this whole batch, not just its last bad target.
              if(!this.currentMutationScope(before,after)){elapsed+=deltaMs;metrics.staleResults++;return;}
              try { this.validateMutationValues(before,after); }
              catch(error) { failedCommit(error)(); return; }
              let changes=0;
              for(let i=0;i<before.length;i++) {
                for(const [name,fields] of Object.entries(after[i].components)) {
                  const soa=getComponent(name);
                  if(!before[i].components[name]) {
                    addComponent(world,after[i].id,soa);
                    // Restored older code may attach a component whose schema has
                    // since grown. Materialize current host defaults, not stale SoA slots.
                    for(const [field,value] of Object.entries(getRegistryEntry(name)?.definition?.defaults ?? {})) soa[field][after[i].id]=value;
                  }
                  for(const [field,value] of Object.entries(fields)) if(before[i].components[name]?.[field]!==value) {soa[field][after[i].id]=value;changes++;}
                }
              }
              if(changes) ctx.emit("managed_system_changed",{system:spec.name,release:release.digest,changes,jobId:job.id});
              metrics.commits++;metrics.lastCommitTick=this.boundaryTick;
              if(changes)metrics.changedCommits++;
              };
              });
            } catch(error) {
              if(epoch!==this.epoch||this.stopped||this.registry.systems.get(spec.name)!==definition||!definition.active)return;
              const fail=failedCommit(error);this.completions.push(()=>fail);
            } finally {pending=false;metrics.maxWorkerMs=Math.max(metrics.maxWorkerMs,performance.now()-started);}})();
            this.computations.add(calculation);void calculation.finally(()=>this.computations.delete(calculation));
          }};
        definitions.set(spec.name,definition);
        this.runtimeMetrics.set(definition,metrics);
        this.ancestors.set(definition,{definition:previous,owner:previousOwners.get(spec.name)});
        this.contracts.set(definition,release);
        registerSystem(this.registry,definition);
        this.owned.set(spec.name,{jobId:job.id,writes:spec.writes});
      }
      this.revision++;this.activeReleases.push({digest:release.digest,id:job.id,...(disabled?{disabled:true}:{})});
      this.finish(job,disabled?"rolled_back":"active",`${disabled?"Restored schemas only for rolled-back release":"Activated"} ${job.systems?.join(", ")??release.manifest.systems.map(s=>s.name).join(", ")} at tick ${tick}`);
      if(persist)this.persistActive();
    } catch(error) {this.finish(job,"rejected",String(error));}
  }
  private persistActive():void {
    const contents=JSON.stringify(this.activeReleases,null,2);
    this.persistence=this.persistence.then(async()=>{
      await writeFile(path.join(this.directory,"active.json.tmp"),contents);
      await rename(path.join(this.directory,"active.json.tmp"),path.join(this.directory,"active.json"));
    }).catch(error=>console.error("[CodingDaemon] Cannot persist active releases",error));
  }
}
