/** Managed-system execution. No live ECS objects enter the VM. Not an OS security boundary. */
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { getAllEntities, hasComponent, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import { getMergedComponents } from "../ecs/component-registry";
import { assertComponentValueFormat } from "../ecs/component-value-formats";
import { entitySchema, type EntitySnapshot, type SystemSpec, type ComponentSpec } from "./contracts";

const FORBIDDEN = new Set(["eval", "Function", "process", "require", "globalThis", "global", "constructor", "prototype", "__proto__", "WebAssembly", "Promise", "setTimeout", "setInterval", "fetch"]);
const programs=new WeakMap<vm.Script,string>();
export function compileManagedSystem(source: string): vm.Script {
  if (source.length > 50000) throw new Error("System source exceeds 50KB");
  const ast = ts.createSourceFile("system.ts", source, ts.ScriptTarget.ES2022, true);
  let runCount = 0;
  for (const statement of ast.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== "run" || !statement.body ||
        statement.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || statement.asteriskToken) {
      throw new Error("Managed modules only export synchronous run(ctx); no top-level executable code");
    }
    runCount++;
  }
  if (runCount !== 1) throw new Error("Exactly one run(ctx) is required");
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && FORBIDDEN.has(node.text)) throw new Error(`Forbidden capability: ${node.text}`);
    if (node.kind === ts.SyntaxKind.ImportKeyword || ts.isAwaitExpression(node)) throw new Error("Async/imports are not allowed");
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid TypeScript system");
  const program=`"use strict";
    const input = JSON.parse(payload);
    const entities = input.entities;
    const byId = new Map(entities.map(e => [e.id,e]));
    const reads = new Set(input.spec.reads);
    const writes = new Set(input.spec.writes);
    const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
    let operations = 0;
    function component(id,name) {
      if (!reads.has(name)) throw Error("Undeclared read: " + name);
      const e = byId.get(id); if(!e) throw Error("Unknown entity");
      return e.components[name];
    }
    const ctx = Object.freeze({
      tick: input.tick, deltaMs: input.deltaMs,
      query: (...names) => { if(!names.length) throw Error("Query requires at least one declared component");
        for(const n of names) if(!reads.has(n)) throw Error("Undeclared query: " + n);
        return entities.filter(e => names.every(n => own(e.components,n))).map(e=>e.id); },
      get: (id,name,field) => { const c=component(id,name); return c && own(c,field) ? c[field] : undefined; },
      set: (id,name,field,value) => {
        if(++operations > 2000) throw Error("Mutation budget exceeded");
        if(!writes.has(name+"."+field)) throw Error("Undeclared write: "+name+"."+field);
        if(!["number","string","boolean"].includes(typeof value) || (typeof value==="number"&&!Number.isFinite(value)) || (typeof value==="string"&&value.length>4000)) throw Error("Invalid scalar");
        const c=component(id,name); if(!c) throw Error("Attach component before setting values");
        c[field]=value;
      },
      attach: (id,name) => {
        if(++operations > 2000) throw Error("Mutation budget exceeded");
        if(component(id,name)) return;
        const fields = input.defaults[name]; if(!fields) throw Error("Only declared dynamic components can be attached");
        for(const field of Object.keys(fields)) if(!writes.has(name+"."+field)) throw Error("Undeclared attachment field");
        byId.get(id).components[name]={...fields};
      }
    });
    const exports={};
    ${compiled.outputText}
    exports.run(ctx);
    JSON.stringify(entities);
  `;
  const script=new vm.Script(program,{filename:"argos-managed-system.js"});
  programs.set(script,program);
  return script;
}

/** Worker heap/time limits protect the simulation thread. This is not a hostile-code OS sandbox. */
export class ManagedSystemWorker {
  private readonly worker:Worker;
  private pending?:{resolve:(value:string)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private closed=false;
  constructor(script:vm.Script) {
    const program=programs.get(script);if(!program)throw new Error("Unrecognized managed script");
    this.worker=new Worker(`const {parentPort,workerData}=require("node:worker_threads");const vm=require("node:vm");
      const script=new vm.Script(workerData.program);
      parentPort.on("message",payload=>{try{const output=script.runInNewContext({payload},{timeout:25,contextCodeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});
      if(typeof output!=="string"||output.length>2000000)throw Error("Output budget exceeded");parentPort.postMessage({output});}catch(error){parentPort.postMessage({error:String(error)});}});`,
      {eval:true,workerData:{program},resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    this.worker.unref();
    this.worker.on("message",result=>{
      const pending=this.pending;if(!pending)return;this.pending=undefined;clearTimeout(pending.timer);
      if(result.error)pending.reject(new Error(result.error));else pending.resolve(result.output);
    });
    this.worker.on("error",error=>this.fail(error));
    this.worker.on("exit",code=>{if(!this.closed)this.fail(new Error(`System worker exited (${code})`));});
  }
  private fail(error:Error):void {const pending=this.pending;this.pending=undefined;if(pending){clearTimeout(pending.timer);pending.reject(error);}this.closed=true;}
  close():void {this.fail(new Error("System worker stopped"));void this.worker.terminate();}
  async run(spec:SystemSpec,entities:EntitySnapshot[],components:ComponentSpec[],tick:number,deltaMs:number):Promise<EntitySnapshot[]> {
    if(this.closed||this.pending)throw new Error("System worker is closed or busy");
    const defaults=Object.fromEntries(components.map(c=>[c.name,Object.fromEntries(Object.entries(c.fields).map(([n,f])=>[n,f.default]))]));
    const payload=JSON.stringify({entities,spec,defaults,tick,deltaMs});
    if(payload.length>2_000_000)throw new Error("Snapshot budget exceeded");
    const output=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.close();},2000);
      this.pending={resolve,reject,timer};this.worker.postMessage(payload);
    });
    const parsed=entitySchema.array().parse(JSON.parse(output));validateChanges(spec,entities,parsed,components);return parsed;
  }
}

export function executeManagedSystem(script: vm.Script, spec: SystemSpec, entities: EntitySnapshot[], components: ComponentSpec[], tick: number, deltaMs: number): EntitySnapshot[] {
  const defaults = Object.fromEntries(components.map(c => [c.name, Object.fromEntries(Object.entries(c.fields).map(([n,f]) => [n,f.default]))]));
  const payload = JSON.stringify({ entities, spec, defaults, tick, deltaMs });
  if (payload.length > 2_000_000) throw new Error("Managed-system snapshot exceeds 2MB budget");
  const output = script.runInNewContext({ payload }, { timeout: 25, contextCodeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
  if (typeof output !== "string" || output.length > 2_000_000) throw new Error("Invalid system output");
  const parsed = entitySchema.array().parse(JSON.parse(output));
  validateChanges(spec, entities, parsed, components);
  return parsed;
}

export function validateChanges(spec: SystemSpec, before: EntitySnapshot[], after: EntitySnapshot[], components: ComponentSpec[]): void {
  if (before.length !== after.length) throw new Error("Entity membership changed");
  const definitions = new Map(components.map(c => [c.name,c]));
  for (let i=0; i<before.length; i++) {
    const a=before[i], b=after[i];
    if(a.id!==b.id) throw new Error("Entity identity changed");
    for(const name of Object.keys(a.components)) if(!Object.hasOwn(b.components,name)) throw new Error("Components cannot be removed");
    for(const [name, values] of Object.entries(b.components)) {
      const old = a.components[name];
      if(!old && !definitions.has(name)) throw new Error("Cannot attach undeclared component");
      for(const field of Object.keys(old ?? {})) if(!Object.hasOwn(values,field)) throw new Error("Fields cannot be removed");
      for(const [field,value] of Object.entries(values)) {
        if(old && value === old[field]) continue;
        if(!spec.writes.includes(`${name}.${field}`)) throw new Error(`Undeclared write ${name}.${field}`);
        const definition = definitions.get(name);
        const type = definition?.fields[field]?.type ?? (old?.[field] === undefined ? undefined : typeof old[field]);
        if(!type || typeof value !== type) throw new Error(`Invalid type or unknown field ${name}.${field}`);
        assertComponentValueFormat(name,field,value);
      }
    }
  }
}

/** Include actual membership, not stale sparse-array slots left by recycled entity IDs. */
export function captureEntities(world: World, reads?: string[]): EntitySnapshot[] {
  const components = getMergedComponents();
  const names = reads ?? Object.keys(components);
  const entities: EntitySnapshot[] = [];
  for(const id of getAllEntities(world)) {
    if(hasComponent(world,id,Prefab))continue;
    const values: EntitySnapshot["components"] = {};
    for(const name of names) {
      const soa=components[name];
      if(!soa || !hasComponent(world,id,soa)) continue;
      const fields: Record<string, any> = {};
      for(const field of Object.keys(soa)) {
        const value=soa[field]?.[id];
        if(typeof value === "string" && value.length <= 4000 || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) fields[field]=value;
      }
      values[name]=fields;
    }
    if(!reads || Object.keys(values).length)entities.push({id,components:values});
  }
  return entities;
}
