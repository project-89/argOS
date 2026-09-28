/** One current-source live attempt. Reuse native provider audit and owned-process
 * census; never overwrite a failed trial, increase its limits or restart it. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {collectOwnedProcesses}=require('./process-ownership.cjs');
const root=path.resolve(__dirname,'../..');
const read=(dir,file)=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
const hash=()=>Object.fromEntries(execFileSync('rg',['--files','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').sort()
  .map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
async function main(){
  const resume=process.argv[2]==='--resume-baker';
  const david=process.argv[2]==='--elaine-growth-david';
  const elaine=process.argv[2]==='--elaine-growth'||david;
  const purposeful=process.argv[2]==='--purposeful-diner';
  const successive=process.argv[2]==='--successive-growth';
  const iterative=process.argv[2]==='--iterative-diner'||purposeful;
  if(resume?process.argv.length!==5:process.argv.length!==4||!['--live','--elaine-growth','--elaine-growth-david','--iterative-diner','--purposeful-diner','--successive-growth'].includes(process.argv[2]))
    throw Error('Explicit --live, --elaine-growth, --elaine-growth-david, --iterative-diner, --purposeful-diner, or --successive-growth <readiness>; or --resume-baker <readiness> <trusted construction checkpoint> required');
  const gate=path.resolve(process.argv[3]),source=hash();
  if(read(gate,'verdict.json').status!=='OFFLINE_PASS'||JSON.stringify(source)!==JSON.stringify(read(gate,'source-after.json')))
    throw Error('Current-source offline readiness required');
  const checkpoint=resume?path.resolve(process.argv[4]):null;
  const checkpointBytes=checkpoint?fs.readFileSync(checkpoint):null;
  const checkpointDigest=checkpointBytes?crypto.createHash('sha256').update(checkpointBytes).digest('hex'):null;
  const directory=fs.mkdtempSync(path.join(root,successive?'recordings/successive-growth-integration-':purposeful?'recordings/purposeful-diner-integration-':iterative?'recordings/iterative-diner-integration-':david?'recordings/elaine-david-growth-integration-':elaine?'recordings/elaine-growth-integration-':resume?'recordings/baker-continuation-':'recordings/continued-growth-integration-'));fs.chmodSync(directory,0o700);
  const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2),{mode:0o600});
  if(checkpointBytes)fs.writeFileSync(path.join(directory,'source-checkpoint.json'),checkpointBytes,{mode:0o600});
  const bounds={httpAttempts:successive?240:iterative?200:elaine?450:resume?80:160,wallMs:successive?360000:elaine?420000:resume?120000:300000,simMs:successive?300000:elaine?360000:resume?60000:240000,heapMiB:512,rssKiB:2097152,artifactBytes:96*1024*1024,cleanupMs:10000};
  write('source-before.json',source);write('protocol.json',successive?{startedAt:new Date().toISOString(),gate,bounds,oneAttempt:true,
    mode:'successive-growth',fixtureVersion:'scheduled-two-authored-concerns-v2',noH3:true,noModelChanges:true,notBaselineOrEndurance:true,
    requires:'Two separate current God-approved native constructions, independent NPC food consumption then independently chosen use of a separately later-built seat; exact source/actor/object identities, physical outcomes and post-use Weaver/God feedback. Preserve first consumption and removed control. Zero execution/observer failures and complete shutdown evidence.',
    fixture:'One hungry visitor in an empty courtyard, creation-time meal and seated-break concerns. No initial edible food or seating. No post-start host goal/need/stock edits, input nudges, actor actions, approvals or direct author-cycle calls.',
    scheduling:'Existing library dual-loop scheduler: focused Weaver specialist, deterministic Watcher, God autopilot and native proposal execution. Generic spirit model observations/other specialist families/narrative director/coding are disabled before start. Existing NPC cognition, planning, appraisal, reflection and daemon remain configured.',
    cadence:'2Hz ECS/500ms; default architect30/proposal5 ticks; God normal-priority eligibility with default30s throttle. No evaluator-scheduled reasoning or retries.',
    authority:'God must approve, coordinator executes. Host observes and stops at declared limits only. Character decisions and native success never manufactured.',
    maxWorldEntities:24,maxBuildJobs:0,qualitativeReviewRequired:true,
    failureCoverage:'Cumulative native registry/fast callbacks, async operation failures, observed evolution errors/proposal failures, and pre-stop failed God reviews. Intentional shutdown cancellation is separately retained, not a pre-stop fault. Pure usefulness and operational cleanliness reported separately.',
    interpretation:'Both concerns built at once, floor rest, departure, refusal, or another coherent choice may be good behavior but do not prove this two-successive-cycle gate. No automatic retry, budget increase or model change.',
    priorFailuresRetained:true,priorEvidence:'world-lifecycle-repair-jz105n offline two-cycle wiring; purposeful-diner-integration-dgYFkY one-meal live pass. Neither substitutes for this run.'
  }:{startedAt:new Date().toISOString(),gate,bounds,oneAttempt:true,
    ...(resume?{mode:'baker-continuation',checkpoint,checkpointDigest,
      continuation:'Restore trusted construction state, reattach original route policy and prospective goal binding. Fresh decisions; no in-flight callback replay.',
      behavioralGate:'Both finite meals witnessed without stale availability; bilateral heard dialogue and completed baker speech after consumption. All prompts and speech require qualitative stale-offer review.',
      simBoundMeaning:'Additional simulation time after restored clock; no regeneration, host stock movement, H3 or baseline/endurance acceptance.'}:{}),
    fixtureVersion:resume?'restored-baker-behavior-v1':'provider-mediated-service-v3',priorFailedAttempts:['continued-growth-integration-dBLlVg','continued-growth-integration-u5MpCY','continued-growth-integration-BaiJ0u'],
    finiteStock:'Two fresh servings requested before startup; each must have an original initial_custody requirement and native assembly receipt. No stock repair or reduced hunger threshold.',
    requires:resume?'Restored original bakery; independent meals; exact-identity witness memory; subsequent baker speech and bilateral heard dialogue. Qualitative stale-offer review required; no fresh construction or spirit outcome claim.':'Running native cognition while Weaver observes an unmet need; God reviews a current scoped proposal; native builder authors resident custody; independent same-food direct handoff OR native provider release into the shared service room followed by visitor consumption there; original native goal closes once; fresh outcomes enter another real Weaver and God turn.',
    servicePaths:'Direct handoffs and shared-room release-to-meal chains reported separately. A room-level drop is not evidence of counter/table placement. Initial loose food and unreceipted custody changes do not count. Old direct-only failures remain failed.',
    targetBinding:'Eval prospectively binds exact generated names once immediately after construction, before any activity involving the new place. No host stock/actor movement, agency writes or completion flags.',
    noH3:true,noModelChanges:true,priorFailuresRetained:true,notBaselineOrEndurance:true,
    ...(elaine?{mode:'elaine-phone-growth',fixtureVersion:david?'elaine-phone-growth-david-history-v1':'elaine-phone-growth-v2',
      cookieHistory:david?'david':'legacy',
      characterComparison:david?'Creation-time David relationship, private past and drives. Same cookie goals and invitation body; no added appointment/deadline or prescribed choice. Not a controller change or a replacement baseline.':'Original sparse-history Alex contact fixture.',
      requires:'Native phone read and reply; actor-selected dining intention; real Weaver/God design and approval; native useful destination; timed departure/arrival; same-food provider service and consumption; bilateral heard dialogue; continuing apartment activity; fresh outcomes in a real subsequent Weaver/God review; independent private-safe local camera tapes.',
      finiteStock:'Builder-authored finite edible stock; no host custody, appetite, actor choice or completion writes.',
      targetBinding:'None. Original cookie goals untouched; dining intentions must be model-authored. Milestone checks do not mint semantic goal completion.',
      authorScope:'Two host-scheduled Weaver/God reviews, at most one construction, no coding jobs, no other spirit families or automatic open-ended scheduling.',
      constructionTrigger:'Native completed outward travel after phone read, tied to a fresh selected dining purpose or its own dining goal. A dinner-coordination goal alone is insufficient. One author probe; no proposal preserves continued observation until the original episode bound, never forces construction.',
      shutdownEvidence:'Retain observers through bounded actual runtime-operation and HTTP-audit settlement. Save both pre-stop and post-drain world state; incomplete callbacks remain failed evidence.',
      initialCast:4,maxWorldEntities:24,maxBuildJobs:0,qualitativeReviewRequired:true}:{} ),
    ...(iterative?{mode:'iterative-diner',fixtureVersion:'existing-diner-additive-repair-v1',
      priorFailedAttempts:['elaine-david-growth-integration-ffTcwE','elaine-david-growth-integration-359u0M'],
      finiteStock:'No edible stock initially available; removed cake protected. A newly generated finite serving may be eaten once. No host stock or hunger writes after startup.',
      servicePaths:'Not a service test. Initial generated loose food can prove a meal but never provider-mediated service.',
      initialHunger:65,targetBinding:'Creation-time original room and hunger<=40 contract; paired native meal required independently. No generated target/goal rebinding.',
      requires:'Existing-place additive repair, independent exact-identity native meal, native original goal closure, fresh Weaver and God outcome review, no duplicate rooms or restored removed/consumed objects. NOT staffed service, initial world generation, managed systems, scheduler cadence, Elaine, baseline, endurance or H3 acceptance.',
      authorScope:'At most three serial repair opportunities starting at 12s, at least 20 simulation seconds between completed repair reviews; one proposal each. One outcome review immediately after a witnessed meal; at most two native God reviews per opportunity. Maximum three constructed additions. No model-response retries.',
      maxWorldEntities:20,maxBuildJobs:0,qualitativeReviewRequired:true}:{} ),
    ...(purposeful?{mode:'purposeful-diner',fixtureVersion:'existing-diner-purposeful-repair-v2',
      priorFailedAttempts:['iterative-diner-integration-AHsne2'],
      cognition:'Existing priority controller, narrative mind, appraisal, background planning/reflection; creation-time behavior policy disabled like ApartmentSitcom. Actual foreground completion and published thought required. One authored fixture goal, not a claim of identical sitcom persona/intentions.',
      finiteStock:'No edible stock initially available. Removed non-food brass key remains removed and emits no sensation. New finite food must be independently consumed once. Old removed-cake v1 preserved separately; no live removed-food judgment claim.',
      targetBinding:'Creation-time original room plus native eat-affordance goal contract. Independent exact NEW food deletion and hunger decrease required; no post-start stock, appetite, goal or actor-choice writes.',
      dispatch:'Production EvolutionCoordinator proposal stage, auto-approval disabled, current world-scoped approval queue including earlier cycles. Observer attached before authoring; no identity writes in observers.',
      requires:'Actual foreground cognition/thought, current God-approved same-room native additive construction, independent exact new-food meal, native original goal closure once, fresh post-meal Weaver and God receipts, no outcome replacement proposal, no removed or consumed restoration, complete identity coverage, zero runtime/observer errors. Not staffed service, Elaine, initial world generation, all-spirit scheduling, ten-trial baseline, ten-minute endurance, or H3 acceptance.',
      earlyFailure:'After three repair opportunities, fail when no meal, usable food or current work remains; never extend bounds or retry model responses.'}:{} )});
  const fd=fs.openSync(path.join(directory,'output.log'),'wx',0o600),began=Date.now();
  const child=spawn(process.execPath,['--max-old-space-size=512','--require',path.join(__dirname,'two-world-baseline-provider.cjs'),
    '--import','tsx',path.join(__dirname,successive?'successive-growth-live.ts':iterative?'iterative-diner-live.ts':elaine?'elaine-growth-live.ts':resume?'baker-resume-live.ts':'continued-growth-live.ts'),'--live',...(david?['--david-history']:[])],{cwd:root,detached:true,stdio:['ignore',fd,fd,'ipc'],
      env:{...process.env,ARGOS_BASELINE_DIRECTORY:directory,ARGOS_TRIAL_HTTP_LIMIT:String(bounds.httpAttempts)}});
  const owned=new Map(),groups=new Set();let exit=null,stopReason=null,stopAt=0,maxRssKiB=0,maxArtifactBytes=0,monitorErrors=0;
  const census=()=>{const rows=execFileSync('ps',['-axo','pid=,ppid=,pgid=,rss=,lstart='],{encoding:'utf8',timeout:2000}).trim().split('\n').map(line=>{
    const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m)throw Error('Invalid census');return {pid:+m[1],ppid:+m[2],pgid:+m[3],rss:+m[4],born:m[5].trim()};});
    return collectOwnedProcesses(rows,process.pid,owned.size?[]:[child.pid],owned,groups);};
  const signalOwned=signal=>{for(const p of census().sort((a,b)=>b.pid-a.pid)){try{process.kill(p.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}}};
  const stop=reason=>{if(stopReason)return;stopReason=reason;stopAt=Date.now();if(!exit)child.kill('SIGINT');};
  child.on('error',error=>{exit={code:null,error:String(error)};stop('spawn_error');});
  child.on('exit',(code,signal)=>{exit={code,signal};});
  child.on('message',message=>{if(message.type==='audit_failed')stop('audit_failed');
    if(message.type==='provider_limit_reached'&&!stopReason){stopReason='provider_limit';stopAt=Date.now();}});
  process.once('SIGINT',()=>stop('operator'));process.once('SIGTERM',()=>stop('operator'));
  console.log(JSON.stringify({directory,pid:child.pid,bounds}));
  await new Promise(resolve=>{const timer=setInterval(()=>{try{
    const live=census();maxRssKiB=Math.max(maxRssKiB,live.reduce((n,p)=>n+p.rss,0));
    maxArtifactBytes=Math.max(maxArtifactBytes,fs.readdirSync(directory).reduce((n,file)=>n+fs.statSync(path.join(directory,file)).size,0));
    if(maxRssKiB>bounds.rssKiB){stop('rss_bound');signalOwned('SIGKILL');}
    if(maxArtifactBytes>bounds.artifactBytes)stop('artifact_bound');
    if(Date.now()-began>bounds.wallMs+3000)stop('wall_bound');
    if(exit&&live.length)stop('residual_after_exit');
    if(stopReason&&Date.now()-stopAt>bounds.cleanupMs)signalOwned('SIGKILL');
    if(exit&&!live.length){clearInterval(timer);resolve();}
  }catch(error){monitorErrors++;stop('monitor_error');if(Date.now()-stopAt>bounds.cleanupMs)child.kill('SIGKILL');}},250);});
  fs.closeSync(fd);const after=hash();write('source-after.json',after);
  const report=fs.existsSync(path.join(directory,'verdict.json'))?read(directory,'verdict.json'):null;
  const usage=fs.existsSync(path.join(directory,'provider-usage.json'))?read(directory,'provider-usage.json'):null;
  const requests=fs.readdirSync(directory).filter(name=>/^request-\d+\.json$/.test(name)).map(file=>read(directory,file));
  const accounted=!!usage&&requests.length===usage.calls&&requests.every(r=>r.response.state!=='pending'&&r.finishedAtWallMs);
  const checkpointUnchanged=!checkpoint||crypto.createHash('sha256').update(fs.readFileSync(checkpoint)).digest('hex')===checkpointDigest;
  const passed=checkpointUnchanged&&report?.result.passed===true&&report.drained===true&&!report.stopReason&&!report.observerError&&exit.code===0&&!stopReason
    &&!monitorErrors&&JSON.stringify(source)===JSON.stringify(after)&&accounted&&usage.calls<=bounds.httpAttempts
    &&usage.pending===0&&usage.incomplete===0&&!usage.denied&&!requests.some(r=>[401,403,404,429].includes(r.response.status));
  const verdict={passed,requiresQualitativeReview:true,directory,exit,stopReason,wallMs:Date.now()-began,report,usage,accounted,
    maxRssKiB,maxArtifactBytes,monitorErrors,sourceUnchanged:JSON.stringify(source)===JSON.stringify(after),checkpointUnchanged,owned:[...owned.values()],residual:[]};
  write('parent-verdict.json',verdict);console.log(JSON.stringify({...verdict,report:undefined,owned:verdict.owned.map(p=>p.pid)},null,2));process.exitCode=passed?0:1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
