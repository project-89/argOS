/** Bounded, evidence-preserving offline test invocation; never retries. */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
async function main() {
  const root = path.resolve(__dirname, "../.."), label = process.argv[2];
  if (!/^[a-z0-9-]+$/.test(label || "")) throw Error("Explicit checkpoint label required");
  const files = process.argv.slice(3);
  const dir = fs.mkdtempSync(path.join(root, "recordings/" + label + "-")); fs.chmodSync(dir, 0o700);
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  const hash = () => Object.fromEntries(execFileSync("rg", ["--files", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort()
    .map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
  const before = hash(); write("source-before.json", before);
  const guard = path.join(__dirname, label.includes("loopback") ? "loopback-offline-network-guard.cjs" : "spirit-offline-network-guard.cjs");
  const env = { ...process.env, NODE_OPTIONS: "--require=" + guard, ARGOS_SPIRIT_GATE_NETWORK_LOG: path.join(dir, "network-attempts.ndjson") };
  delete env.ARGOS_RUN_LLM_TESTS;
  const base = (await import(pathToFileURL(path.join(root, "jest.config.js")).href)).default;
  const args = label.includes("types") ? ["node_modules/typescript/bin/tsc", "--noEmit"]
    : ["--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--config", JSON.stringify({ ...base, rootDir: root, silent: true, setupFiles: [guard],
      testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.gate.ts"] }), "--runInBand", "--json", "--outputFile", path.join(dir, "jest.json"),
      ...(files.length ? ["--runTestsByPath", ...files] : [])];
  write("protocol.json", { args, deadlineMs: 180000, maxAttempts: 1, startedAt: new Date().toISOString(), liveRequests: 0 });
  const fd = fs.openSync(path.join(dir, "output.log"), "wx", 0o600), start = Date.now(); let timedOut = false;
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", fd, fd] });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 180000);
  const result = await new Promise(resolve => child.on("close", (code, signal) => resolve({ pid: child.pid, code, signal })));
  clearTimeout(timer); fs.closeSync(fd);
  const after = hash(); write("source-after.json", after);
  const verdict = { ...result, directory: dir, timedOut, elapsedMs: Date.now() - start, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
    networkAttempts: fs.existsSync(env.ARGOS_SPIRIT_GATE_NETWORK_LOG) ? fs.readFileSync(env.ARGOS_SPIRIT_GATE_NETWORK_LOG, "utf8").trim().split("\n").length : 0 };
  if (fs.existsSync(path.join(dir, "jest.json"))) { const j = JSON.parse(fs.readFileSync(path.join(dir, "jest.json"))); Object.assign(verdict, { passed: j.numPassedTests, failed: j.numFailedTests, skipped: j.numPendingTests }); }
  write("verdict.json", verdict); console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = result.code === 0 && !timedOut && verdict.sourceUnchanged && !verdict.networkAttempts ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
