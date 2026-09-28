import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { releaseSchema, componentSchema, type Release, type ComponentSpec, type AcceptanceTest } from "./contracts";
import { compileManagedSystem, ManagedSystemWorker } from "./system-sandbox";

export type PreparedRelease = {
  manifest: Release; components: ComponentSpec[]; sources: Map<string,string>;
  scripts: Map<string, ReturnType<typeof compileManagedSystem>>;
  digest: string; testsPassed: number;
};

export async function readArtifact(root: string, relative: string): Promise<string> {
  const resolved=path.resolve(root,relative), realRoot=await realpath(root);
  if(!resolved.startsWith(path.resolve(root)+path.sep)) throw new Error("Artifact path escapes workspace");
  const stat=await lstat(resolved);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>250000) throw new Error("Artifact must be a regular file under 250KB");
  if(!(await realpath(resolved)).startsWith(realRoot+path.sep)) throw new Error("Artifact symlink escapes workspace");
  return readFile(resolved,"utf8");
}

export async function prepareRelease(root: string, acceptance: AcceptanceTest[] = []): Promise<PreparedRelease> {
  const manifestText=await readArtifact(root,"release.json");
  const manifest=releaseSchema.parse(JSON.parse(manifestText));
  const sources=new Map<string,string>([["release.json",manifestText]]);
  const components: ComponentSpec[]=[];
  for(const file of manifest.components) {
    const source=await readArtifact(root,file); sources.set(file,source);
    components.push(componentSchema.parse(JSON.parse(source)));
  }
  if(new Set(components.map(c=>c.name)).size!==components.length) throw new Error("Duplicate component in release");
  if(new Set(manifest.systems.map(s=>s.name)).size!==manifest.systems.length) throw new Error("Duplicate system in release");
  const scripts=new Map<string,ReturnType<typeof compileManagedSystem>>();
  for(const system of manifest.systems) {
    const source=await readArtifact(root,system.file); sources.set(system.file,source);
    scripts.set(system.name,compileManagedSystem(source));
  }
  const tests=[...manifest.tests,...acceptance];
  for(const test of tests) {
    if(new Set(test.entities.map(e=>e.id)).size!==test.entities.length) throw new Error(`Duplicate entity ID in test ${test.name}`);
  }
  for(const system of manifest.systems) {
    if(manifest.tests.filter(t=>t.system===system.name).length<2) throw new Error(`${system.name} needs positive and boundary/negative tests`);
    let changes=0;
    const worker=new ManagedSystemWorker(scripts.get(system.name)!);
    try {
    for(const test of tests.filter(t=>t.system===system.name)) {
      let entities=structuredClone(test.entities);
      for(let tick=1;tick<=test.ticks;tick++) entities=await worker.run(system,entities,components,tick,test.deltaMs);
      if(JSON.stringify(entities)!==JSON.stringify(test.entities)) changes++;
      for(const assertion of test.expect) {
        const actual=entities.find(e=>e.id===assertion.entity)?.components[assertion.component]?.[assertion.field];
        if(actual!==assertion.equals) throw new Error(`Test ${test.name}: ${assertion.component}.${assertion.field} expected ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(actual)}`);
      }
    }
    } finally {worker.close();}
    if(!changes) throw new Error(`${system.name} has no test demonstrating an actual state change`);
  }
  for(const test of tests) if(!scripts.has(test.system)) throw new Error(`Acceptance test references absent system ${test.system}`);
  const hash=createHash("sha256");
  for(const [file,source] of [...sources].sort(([a],[b])=>a.localeCompare(b))) hash.update(file).update("\0").update(source).update("\0");
  return {manifest,components,sources,scripts,digest:hash.digest("hex"),testsPassed:tests.length};
}
