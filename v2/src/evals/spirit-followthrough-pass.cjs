/** One explicit continuation, then stop for qualitative review before integration.
 * Keeps all trials and rejects source changes, repeated modes or increased budgets. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
async function main(){
  const root=path.resolve(__dirname,'../..'),phase=process.argv[2],evidence=path.resolve(process.argv[3]||'');
  if(!['--probes','--integration'].includes(phase))throw Error('Explicit --probes <offline gate> or --integration <pass directory> required');
  const hash=()=>Object.fromEntries(execFileSync('rg',['--files','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').sort()
    .map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const source=hash(),read=(directory,file)=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
  let directory,progress;
  if(phase==='--probes'){
    if(read(evidence,'verdict.json').status!=='OFFLINE_PASS' || JSON.stringify(source)!==JSON.stringify(read(evidence,'source-after.json')))
      throw Error('Current-source offline readiness pass required');
    directory=fs.mkdtempSync(path.join(root,'recordings/spirit-followthrough-live-'));fs.chmodSync(directory,0o700);
    progress={calls:0,wallMs:0,results:[]};
  }else{
    directory=evidence;progress=read(directory,'progress.json');
    if(path.dirname(directory)!==path.join(root,'recordings') || !path.basename(directory).startsWith('spirit-followthrough-live-'))throw Error('Owned follow-through evidence required');
    if(JSON.stringify(source)!==JSON.stringify(read(directory,'source-before.json')))throw Error('Source changed since probes');
    if(progress.results.length!==3 || !progress.results.every(row=>row.report?.result?.passed===true && row.report?.requestsDrained===true
      && row.report?.activeRequestsAtStop===0 && row.exit.code===0 && !row.exit.timedOut))
      throw Error('All three usefulness probes must pass before integration');
  }
  const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
  if(phase==='--probes'){
    write('source-before.json',source);write('protocol.json',{gate:evidence,maxCalls:24,combinedLiveWallMs:480000,
      perProbeWallMs:125000,maxSimulationMs:120000,oneAttemptPerMode:true,noModelChanges:true,noH3:true,
      phases:['tinker','narrator','steward','qualitative review','integration'],integrationRequiresExplicitContinuation:true});
  }
  for(const mode of phase==='--probes'?['tinker','narrator','steward']:['integration']){
    if(progress.calls>=24 || progress.wallMs>=480000)break;
    const probeDir=path.join(directory,mode);fs.mkdirSync(probeDir,{mode:0o700}); // refuses replay/overwrite
    const fd=fs.openSync(path.join(probeDir,'output.log'),'wx',0o600),began=Date.now();
    const child=spawn(process.execPath,['--import','tsx','src/evals/spirit-usefulness-live.ts',mode,probeDir,String(24-progress.calls)],
      {cwd:root,env:{...process.env,ARGOS_PROCESS_WORLD_HOST:'1'},stdio:['ignore',fd,fd]});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},Math.min(125000,480000-progress.wallMs));
    const exit=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal,timedOut})));
    clearTimeout(timer);fs.closeSync(fd);
    const log=path.join(probeDir,'provider.ndjson'),rows=fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    progress.calls+=rows.filter(row=>row.phase==='issued').length;progress.wallMs+=Date.now()-began;
    const report=fs.existsSync(path.join(probeDir,'verdict.json'))?read(probeDir,'verdict.json'):null;
    progress.results.push({mode,exit,report});write('progress.json',progress);
    console.log(JSON.stringify({directory,mode,calls:progress.calls,wallMs:progress.wallMs,passed:report?.result?.passed,exit}));
    if(exit.code!==0 || timedOut || report?.result?.passed!==true || report?.requestsDrained!==true || report?.activeRequestsAtStop!==0
      || rows.some(row=>[401,403,404,429].includes(row.status)))break;
  }
  const after=hash();write('source-after.json',after);
  write(phase==='--probes'?'probe-verdict.json':'integration-verdict.json',{...progress,sourceUnchanged:JSON.stringify(source)===JSON.stringify(after),
    acceptance:'Short usefulness only; does not replace ten-trial baseline/endurance.'});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
