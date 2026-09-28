const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { collectOwnedProcesses } = require('./process-ownership.cjs');
const arg = key => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3);
const cohort = path.resolve(arg('cohort') || '');
if (path.dirname(cohort) !== path.resolve('recordings') || !path.basename(cohort).startsWith('cognition-baseline-'))
  throw new Error('Use an existing unique recordings/cognition-baseline-* cohort directory');
const sources = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? sources(path.join(dir,e.name)) : e.isFile() ? [path.join(dir,e.name)] : []);
const sha = value => createHash('sha256').update(value).digest('hex');
const names = [...sources('src'), 'package.json', 'package-lock.json', 'tsconfig.json'].sort();
const current = Object.fromEntries(names.map(p => [p, sha(fs.readFileSync(p))]));
const manifestPath = path.join(cohort, 'source-manifest.json');
if (process.argv.includes('--freeze')) {
  fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2), {flag:'wx',mode:0o600});
  console.log('SOURCE_FROZEN', JSON.stringify({files:names.length, sha256:sha(JSON.stringify(current))})); process.exit(0);
}
const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (JSON.stringify(current) !== JSON.stringify(frozen)) throw new Error('Source differs from frozen cohort; preserve it and declare a new cohort');
const rssSmoke = process.argv.includes('--smoke-rss');
const smoke = process.argv.includes('--smoke') || rssSmoke, id = arg('trial');
if (!smoke && (!process.argv.includes('--live') || !/^[SP][1-5]$/.test(id || ''))) throw new Error('Explicit --live and --trial=S1..S5/P1..P5 required');
const directory = path.join(cohort, rssSmoke ? 'watchdog-rss-smoke' : smoke ? 'watchdog-smoke' : id);
fs.mkdirSync(directory, {mode:0o700}); // no recursive reuse or overwrite
const began = performance.now(), seconds = id?.startsWith('P') ? 300 : 180;
const bounds = { wallMs: smoke ? 1800 : (seconds + 90) * 1000, heapMiB: 512, rssKiB: rssSmoke ? 1024 : 2097152, stdoutBytes: 4194304,
  artifactsBytes: 96 * 1024 * 1024, httpAttempts: id?.startsWith('P') ? 420 : 240, cleanupMs: 10000 };
const args = smoke ? ['-e', `const {spawn}=require('node:child_process');
  const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  console.log('DETACHED_SMOKE',c.pid);setInterval(()=>{},1000);`] : [
  '--max-old-space-size='+bounds.heapMiB,
  '--require', path.join(__dirname,'two-world-baseline-provider.cjs'), '--import','tsx',
  path.join(__dirname,'two-world-baseline-run.ts'), '--live', '--trial='+id];
const child = spawn(process.execPath, args, {detached:true,stdio:['ignore','pipe','pipe','ipc'],
  env:{...process.env, ARGOS_BASELINE_DIRECTORY:directory, ARGOS_TRIAL_HTTP_LIMIT:String(bounds.httpAttempts),
    ARGOS_CODE_MODEL:'gemini-3.8-flash',ARGOS_AGENT_MODEL:'gemini-3.8-flash',ARGOS_RENDER_MODEL:'gemini-3.8-flash'}});
const owned = new Map(), groups = new Set();
let stopReason = null, stopAt = null, exit = null, maxRssKiB = 0, bytes = 0, httpAttempts = 0,
  artifacts = directory, maxArtifactBytes = 0, monitoringErrors = 0, pendingOutput = '', finished = false;
function table() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,rss=,lstart='],
    { encoding: 'utf8', timeout: 2000, maxBuffer: 2000000 }).trim().split('\n').map(line => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (!m) throw new Error('Invalid process census');
      return { pid: +m[1], ppid: +m[2], pgid: +m[3], rss: +m[4], born: m[5].trim() };
    });
}
function census() {
  return collectOwnedProcesses(table(), process.pid, owned.size ? [] : [child.pid], owned, groups);
}
function signalOwned(signal) {
  // Fresh identity census immediately before every signal. Never kill an
  // arbitrary port owner, stale PID, or the parent Codex task process.
  for (const p of census().sort((a, b) => a.pid === child.pid ? 1 : b.pid === child.pid ? -1 : b.pid - a.pid)) {
    try { process.kill(p.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}
function stop(reason) {
  if (stopReason) return;
  stopReason = reason; stopAt = performance.now();
  if (!exit) child.kill('SIGINT');
}
function artifactSize(dir) {
  let size = 0;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) size += artifactSize(full);
    else if (item.isFile()) size += fs.statSync(full).size;
  }
  return size;
}
function output(chunk) {
  bytes += chunk.length;
  if (bytes <= bounds.stdoutBytes) process.stdout.write(chunk);
  else stop('stdout_limit');

}
child.stdout.on('data', output); child.stderr.on('data', output);
child.on('message', message => {
  if (message.type === 'audit_failed') stop('audit_failed');
  if (message.type === 'provider_attempt') httpAttempts = message.calls;
  // The preload sends its own single SIGINT; do not send another and interrupt
  // the runner's artifact-saving shutdown after its once-only signal handler.
  if (message.type === 'provider_limit_reached' && !stopReason) {
    stopReason = 'provider_attempt_limit'; stopAt = performance.now();
  }
});
child.once('error', error => { exit = { code: null, signal: null, error: error.message }; stop('spawn_error'); });
child.once('exit', (code, signal) => { exit = { code, signal }; });
process.once('SIGINT', () => stop('operator'));
process.once('SIGTERM', () => stop('operator'));
console.log('OWNED_CHILD', JSON.stringify({ pid: child.pid, bounds, smoke }));
let lastProgress = 0;
const timer = setInterval(() => {
  if (finished) return;
  try {
    const live = census(), now = performance.now(), wallMs = now - began;
    const rss = live.reduce((sum, p) => sum + p.rss, 0); maxRssKiB = Math.max(maxRssKiB, rss);
    if (rss > bounds.rssKiB) {
      stop('aggregate_rss_limit');
      // Runaway allocation cannot receive a ten-second grace period. The live
      // journals already preserve the prefix; signal only census-owned identities.
      signalOwned('SIGKILL');
    }
    if (wallMs > bounds.wallMs) stop('wall_limit');
    if (artifacts) { maxArtifactBytes = Math.max(maxArtifactBytes, artifactSize(artifacts));
      if (maxArtifactBytes > bounds.artifactsBytes) stop('artifact_limit'); }
    if (exit && live.length && !stopReason) stop('owned_descendant_after_exit');
    if (stopAt !== null && now - stopAt > bounds.cleanupMs) signalOwned('SIGKILL');
    if (wallMs - lastProgress > 15000) {
      lastProgress = wallMs;
      console.log('RESOURCE_PROGRESS', JSON.stringify({ wallMs: Math.round(wallMs), live: live.length, rssKiB: rss, httpAttempts, maxArtifactBytes }));
    }
    if (exit && live.length === 0) {
      finished = true; clearInterval(timer);
      const receipt = { pid: child.pid, ...exit, stopReason, maxRssKiB, maxArtifactBytes, bytes, httpAttempts,
        monitoringErrors, sourceUnchanged: JSON.stringify(Object.fromEntries(names.map(p => [p, sha(fs.readFileSync(p))]))) === JSON.stringify(frozen), wallMs: Math.round(wallMs), owned: [...owned.values()], residual: [], artifacts, bounds, smoke };
      fs.writeFileSync(path.join(directory, smoke ? 'smoke-result.json' : 'resource-result.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
      console.log('OWNED_EXIT', JSON.stringify({ ...receipt, owned: receipt.owned.map(p => p.pid) }));
      process.exitCode = smoke ? (stopReason === (rssSmoke ? 'aggregate_rss_limit' : 'wall_limit') && owned.size >= 2 ? 0 : 1) : exit.code === 0 && !stopReason ? 0 : 1;
    }
  } catch (error) {
    monitoringErrors++; console.error('MONITOR_ERROR', error.message); stop('monitor_error');
    if (stopAt !== null && performance.now() - stopAt > bounds.cleanupMs) child.kill('SIGKILL');
  }
}, 250);
