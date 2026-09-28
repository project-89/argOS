/** Two bounded replays of six saved, public 10s packets. The arms differ only
 * in immutable prompt history. No text rewriting, NPC calls, or target audio. */
export type PreparedScriptUpdate = {
  type: "prompt"; prompt_version: number; script_mode: "append";
  script: Array<{offset:number;prompt:string}>;
};
type Configure = {
  type: "configure"; protocol_version: 1; prompt_version: 1; prompt: string;
  resolution: string; aspect_ratio: string; chunk_duration: 10; memory: number;
  seed: number; script: Array<{offset:number;prompt:string}>;
};
const record = (value: unknown): Record<string,unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected saved message object");
  return value as Record<string,unknown>;
};
const onlyKeys = (value: Record<string,unknown>, allowed: string[]) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported saved message field");
};
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 12000) throw new Error("Invalid saved public direction");
  return value;
}
function beat(value: unknown) {
  if (!Array.isArray(value) || value.length!==1) throw new Error("Expected exactly one saved text beat per packet");
  const b=record(value[0]); onlyKeys(b,["offset","prompt"]);
  if (b.offset!==0) throw new Error("Expected saved offset-zero append packet");
  return [{offset:0,prompt:text(b.prompt)}];
}
export function memoryComparisonFromSaved(rows: readonly unknown[]) {
  if (rows.length<6 || rows.length>4096) throw new Error("Need six saved packets within the journal bound");
  const messages=rows.slice(0,6).map(row=>record(record(row).message));
  const c=messages[0];
  onlyKeys(c,["type","protocol_version","prompt_version","prompt","resolution","aspect_ratio","chunk_duration","memory","seed","script"]);
  if(c.type!=="configure" || c.protocol_version!==1 || c.prompt_version!==1 || c.chunk_duration!==10
    || !["480p","768p","1080p"].includes(String(c.resolution)) || !["16:9","9:16","1:1"].includes(String(c.aspect_ratio)))
    throw new Error("Replay requires a supported saved 10s native configure");
  const seed=c.seed??891221;
  if(typeof seed!=="number"||!Number.isSafeInteger(seed))throw new Error("Invalid saved seed");
  const baseline:Configure={type:"configure",protocol_version:1,prompt_version:1,prompt:text(c.prompt),
    resolution:String(c.resolution),aspect_ratio:String(c.aspect_ratio),chunk_duration:10,memory:12,seed,script:beat(c.script)};
  const updates:PreparedScriptUpdate[]=messages.slice(1).map((m,i)=>{
    onlyKeys(m,["type","prompt_version","script_mode","script"]);
    if(m.type!=="prompt"||m.script_mode!=="append"||m.prompt_version!==i+2)throw new Error("Saved prompt sequence is not contiguous native append");
    return {type:"prompt",prompt_version:i+2,script_mode:"append",script:beat(m.script)};
  });
  return {configs:{memory12:baseline,memory1:{...baseline,memory:1}},updates,
    limits:{sessions:2,perMode:1,playbackSeconds:60,wallMs:120000,retries:0},
    seedOrigin:c.seed==null?"Fixed for the pair, not the original recording":"Retained from original recording"};
}
export function nextPreparedScriptUpdate(updates: readonly PreparedScriptUpdate[], sent:number, admitted:number, settled:number) {
  if(sent>admitted||sent-settled>=2)return undefined;
  return updates.find(update=>update.prompt_version===sent+1);
}
