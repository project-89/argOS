// One owned, bounded diagnostic. Keeps every request/outcome, never retries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {collectOwnedProcesses}=require('./process-ownership.cjs');
const root=path.resolve(__dirname,'../..');
const args=process.argv.slice(2),scheduledAppointment=args.includes('--scheduled-appointment'),appointment=args.includes('--appointment')||scheduledAppointment;
const dinnerNotification=args.includes('--dinner-notification');
const snackGrievance=args.includes('--snack-grievance');
if(!args.includes('--live')||new Set(args).size!==args.length||args.some(a=>!['--live','--appointment','--scheduled-appointment','--dinner-notification','--snack-grievance'].includes(a))||(scheduledAppointment&&args.includes('--appointment'))||(dinnerNotification&&appointment)||(snackGrievance&&!dinnerNotification))throw Error('Use --live [--appointment | --scheduled-appointment | --dinner-notification [--snack-grievance]]');
const hash=()=>Object.fromEntries(execFileSync('rg',['--files','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').sort()
  .map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
async function main(){
 const directory=fs.mkdtempSync(path.join(root,'recordings/phone-attention-live-'));fs.chmodSync(directory,0o700);
 const save=(f,v)=>fs.writeFileSync(path.join(directory,f),JSON.stringify(v,null,2),{mode:0o600});
 const source=hash(),bounds={httpAttempts:350,wallMs:240000,simMs:dinnerNotification?120000:180000,rssKiB:2097152,artifactBytes:96*1024*1024,cleanupMs:10000};
 save('source-before.json',source);save('protocol.json',{bounds,oneAttempt:true,noH3:true,noModelChanges:true,
  cookieGrievance:snackGrievance?'snack':'respect',
  characterizationChange:snackGrievance?'Only Elaine opening cookie memory drops the respect grievance, and her cookie goal seeks availability/retrieval instead of fair resolution. Same priority, identity, David history, phone motivation, other actors, and text.':'None',
  inputs:dinnerNotification?[{atSimMs:34500,text:"Elaine, the restaurant confirmed our dinner reservation for eight tonight. I'll see you there."}]:[{atSimMs:71000,text:'where are you Elaine?  We had a date!'},{atSimMs:119000,text:'Hello?'}],
  profile:appointment?'sitcomLaunchProfile([]) with separately authored david-appointment history; continuous maintenance enabled; zero coding admissions':snackGrievance?'sitcomLaunchProfile([]) with snack grievance authoring ablation; David contact; continuous maintenance enabled; zero coding admissions':'Unmodified sitcomLaunchProfile([]); David contact; continuous maintenance enabled; zero coding admissions',
  fixture:dinnerNotification?'dinner-notification':scheduledAppointment?'scheduled-known-appointment':appointment?'known-appointment':'unexpected-date-claim',
  authoring:scheduledAppointment?'Same private appointment history, also authored as a flexible 16:00 coffee activity in existing Schedule; no injected action, goal, read or reply. One-hour schedule window is fixture data; this test does not cross a day boundary.':'Unchanged schedule',
  authority:'Viewer texts only; no host NPC actions/goals or required answer. Observe attention and voluntary read/reply.',
  behavioralAcceptance:false,notBaselineOrEndurance:true,priorFailuresRetained:true});
 const fd=fs.openSync(path.join(directory,'output.log'),'wx',0o600),began=Date.now();
 const child=spawn(process.execPath,['--max-old-space-size=512','--require',path.join(__dirname,'two-world-baseline-provider.cjs'),
   '--import','tsx',path.join(__dirname,'phone-attention-live.ts'),'--live',...(snackGrievance?['--snack-grievance']:[]),...(dinnerNotification?['--dinner-notification']:scheduledAppointment?['--scheduled-appointment']:appointment?['--appointment']:[])],{cwd:root,detached:true,stdio:['ignore',fd,fd,'ipc'],
   env:{...process.env,ARGOS_BASELINE_DIRECTORY:directory,ARGOS_TRIAL_HTTP_LIMIT:String(bounds.httpAttempts)}});
 const owned=new Map(),groups=new Set();let exit=null,reason=null,stopAt=0,maxRssKiB=0,maxBytes=0,monitorErrors=0;
 const census=()=>collectOwnedProcesses(execFileSync('ps',['-axo','pid=,ppid=,pgid=,rss=,lstart='],{encoding:'utf8',timeout:2000}).trim().split('\n').map(line=>{
   const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m)throw Error('Invalid process census');
   return {pid:+m[1],ppid:+m[2],pgid:+m[3],rss:+m[4],born:m[5].trim()};}),process.pid,owned.size?[]:[child.pid],owned,groups);
 const stop=why=>{if(reason)return;reason=why;stopAt=Date.now();if(!exit)child.kill('SIGINT');};
 const kill=()=>{for(const p of census().sort((a,b)=>b.pid-a.pid))try{process.kill(p.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
 child.on('error',e=>{exit={error:String(e)};stop('spawn_error');});child.on('exit',(code,signal)=>{exit={code,signal};});
 child.on('message',m=>{if(m.type==='audit_failed')stop('audit_failed');
   // The provider hook already SIGINTs its own process. A second SIGINT from
   // the parent can terminate it after a once-handler, before its checkpoint.
   // Retain the independent cleanup deadline, but do not duplicate that signal.
   if(m.type==='provider_limit_reached'&&!reason){reason='provider_limit';stopAt=Date.now();}});
 process.once('SIGINT',()=>stop('operator'));process.once('SIGTERM',()=>stop('operator'));
 console.log(JSON.stringify({directory,pid:child.pid,bounds}));
 await new Promise(resolve=>{const timer=setInterval(()=>{try{
   const live=census();maxRssKiB=Math.max(maxRssKiB,live.reduce((n,p)=>n+p.rss,0));
   maxBytes=Math.max(maxBytes,fs.readdirSync(directory).reduce((n,f)=>n+fs.statSync(path.join(directory,f)).size,0));
   if(maxRssKiB>bounds.rssKiB){stop('rss_bound');kill();}if(maxBytes>bounds.artifactBytes)stop('artifact_bound');
   if(Date.now()-began>bounds.wallMs+3000)stop('wall_bound');if(exit&&live.length)stop('residual_after_exit');
   if(reason&&Date.now()-stopAt>bounds.cleanupMs)kill();
   if(exit&&!live.length){clearInterval(timer);resolve();}
 }catch(e){monitorErrors++;stop('monitor_error');if(Date.now()-stopAt>bounds.cleanupMs)child.kill('SIGKILL');}},250);});
 fs.closeSync(fd);const after=hash();save('source-after.json',after);
 const read=f=>fs.existsSync(path.join(directory,f))?JSON.parse(fs.readFileSync(path.join(directory,f),'utf8')):null;
 const usage=read('provider-usage.json'),report=read('verdict.json');
 const requests=fs.readdirSync(directory).filter(f=>/^request-\d+\.json$/.test(f)).map(read);
 const accounted=!!usage&&requests.length===usage.calls&&usage.pending===0&&usage.incomplete===0&&requests.every(r=>r.finishedAtWallMs&&r.response.state!=='pending');
 const passed=report?.diagnosticComplete===true&&exit.code===0&&!reason&&!monitorErrors&&accounted&&!usage.denied&&JSON.stringify(source)===JSON.stringify(after);
 const result={diagnosticComplete:passed,behavioralAcceptance:false,exit,reason,usage,accounted,report,maxRssKiB,maxBytes,monitorErrors,sourceUnchanged:JSON.stringify(source)===JSON.stringify(after),residual:[],owned:[...owned.keys()]};
 save('parent-verdict.json',result);console.log(JSON.stringify(result));process.exitCode=passed?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
