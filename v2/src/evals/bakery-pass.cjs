/** One fresh bakery attempt after current-source offline readiness. Never resumes
 * or overwrites a failed trial, changes a budget, retries, or launches H3. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
async function main(){
  if(process.argv.length!==4 || !['--live','--service'].includes(process.argv[2]))throw Error('Explicit --live or --service <offline readiness directory> required');
  const mode=process.argv[2]==='--service'?'service':'bakery';
  const root=path.resolve(__dirname,'../..'),gate=path.resolve(process.argv[3]);
  const read=(dir,file)=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  const hash=()=>Object.fromEntries(execFileSync('rg',['--files','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').sort()
    .map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const source=hash();
  if(read(gate,'verdict.json').status!=='OFFLINE_PASS' || JSON.stringify(source)!==JSON.stringify(read(gate,'source-after.json')))
    throw Error('Current-source offline readiness pass required');
  const directory=fs.mkdtempSync(path.join(root,`recordings/${mode}-integration-`));fs.chmodSync(directory,0o700);
  const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
  write('source-before.json',source);write('parent-protocol.json',{mode,gate,requestLimit:64,wallLimitMs:180000,requestDrainMs:2000,
    parentDeadlineMs:185000,simulationLimitMs:120000,oneFreshAttempt:true,noH3:true,noModelsChanged:true,priorFailuresRetained:true});
  const fd=fs.openSync(path.join(directory,'output.log'),'wx',0o600),began=Date.now();
  const child=spawn(process.execPath,['--max-old-space-size=512','--import','tsx','src/evals/spirit-usefulness-live.ts',mode,directory,'64'],
    {cwd:root,env:{...process.env,ARGOS_PROCESS_WORLD_HOST:'1'},stdio:['ignore',fd,fd]});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},185000);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,timedOut}));});
  clearTimeout(timer);fs.closeSync(fd);
  const rows=fs.existsSync(path.join(directory,'provider.ndjson'))?fs.readFileSync(path.join(directory,'provider.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const issued=rows.filter(row=>row.phase==='issued'),terminal=rows.filter(row=>['settled','failed'].includes(row.phase));
  const allRequestsAccounted=issued.length===terminal.length && new Set(issued.map(row=>row.id)).size===issued.length
    && issued.every(row=>terminal.filter(end=>end.id===row.id).length===1);
  const report=fs.existsSync(path.join(directory,'verdict.json'))?read(directory,'verdict.json'):null,after=hash();
  write('source-after.json',after);
  const passed=report?.result?.passed===true && report?.requestsDrained===true && report?.activeRequestsAtStop===0
    && exit.code===0 && !timedOut && issued.length<=64 && allRequestsAccounted
    && !rows.some(row=>[401,403,404,429].includes(row.status)) && JSON.stringify(source)===JSON.stringify(after);
  const verdict={directory,passed,requiresQualitativeReview:true,childPid:child.pid,exit,calls:issued.length,allRequestsAccounted,
    wallMs:Date.now()-began,sourceUnchanged:JSON.stringify(source)===JSON.stringify(after),report,
    acceptance:'Short usefulness only; does not replace original ten-trial baseline or ten-minute endurance.'};
  write('parent-verdict.json',verdict);console.log(JSON.stringify({...verdict,report:undefined},null,2));process.exitCode=passed?0:1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
