/** Explicitly paid, serial, bounded probes. Failed outcomes are never retried. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
async function main() {
  if (process.argv[2] !== '--execute') throw Error('Use --execute only after offline readiness approval');
  const root = path.resolve(__dirname, '../..'), gate = path.resolve(process.argv[3] || '');
  const verdict = JSON.parse(fs.readFileSync(path.join(gate, 'verdict.json'), 'utf8'));
  if (verdict.status !== 'OFFLINE_PASS') throw Error('Passing explicit readiness evidence required');
  const hash = () => Object.fromEntries(execFileSync('rg', ['--files', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort()
    .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const before = hash();
  if (JSON.stringify(before) !== JSON.stringify(JSON.parse(fs.readFileSync(path.join(gate, 'source-after.json'), 'utf8'))))
    throw Error('Sources changed since offline gates; do not bypass readiness');
  const directory = fs.mkdtempSync(path.join(root, 'recordings/spirit-usefulness-live-')); fs.chmodSync(directory, 0o700);
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  write('protocol.json', { gate, maxCalls: 24, combinedDeadlineMs: 480000, perProbeMs: 120000, simulationLimitMs: 120000,
    models: 'Existing environment configuration, unchanged', oneAttemptPerProbe: true, integrationRequiresAllUseful: true });
  write('source-before.json', before);
  const began = Date.now(), results = []; let calls = 0;
  for (const mode of ['weaver', 'steward', 'tinker', 'narrator', 'lawgiver']) {
    const remaining = 480000 - (Date.now() - began);
    if (calls >= 24 || remaining < 2000) break;
    const probeDir = path.join(directory, mode); fs.mkdirSync(probeDir, { mode: 0o700 });
    const fd = fs.openSync(path.join(probeDir, 'output.log'), 'wx', 0o600);
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/evals/spirit-usefulness-live.ts', mode, probeDir, String(24 - calls)],
      { cwd: root, env: { ...process.env, ARGOS_PROCESS_WORLD_HOST: '1' }, stdio: ['ignore', fd, fd] });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, Math.min(125000, remaining));
    const exit = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, timedOut })));
    clearTimeout(timeout); fs.closeSync(fd);
    const log = path.join(probeDir, 'provider.ndjson'), rows = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    calls += rows.filter(row => row.phase === 'issued').length;
    const report = fs.existsSync(path.join(probeDir, 'verdict.json')) ? JSON.parse(fs.readFileSync(path.join(probeDir, 'verdict.json'), 'utf8')) : null;
    results.push({ mode, exit, report }); write('progress.json', { calls, wallMs: Date.now() - began, results });
    console.log(JSON.stringify({ mode, exit, calls, directory: probeDir, result: report?.result }));
    if (rows.some(row => [401, 403, 404, 429].includes(row.status))) break;
  }
  const after = hash(); write('source-after.json', after);
  write('verdict.json', { calls, wallMs: Date.now() - began, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), results,
    integration: 'NOT_RUN: requires review of all usefulness gates; this script never grants itself another episode.' });
  console.log(JSON.stringify({ directory, calls, wallMs: Date.now() - began }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
