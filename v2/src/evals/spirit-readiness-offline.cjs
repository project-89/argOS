/** One bounded offline gate run. No live switch, retries, source repair or budget extension. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../..");
const existingSuites = [
  "spirits/advisory-prompt-contracts", "spirits/narrative-pressure", "spirits/scoped-narrative-nudge",
  "spirits/spirit-intervention-freshness", "spirits/spirit-cycle-freshness", "spirits/spirit-message-delivery",
  "spirits/spirit-inbox-lifecycle", "spirits/physical-world-snapshot", "spirits/crafter-failure-authoring",
  "spirits/crafter-evolution-truth", "spirits/steward-authored-place", "spirits/steward-materialization",
  "spirits/steward-authoring-scope", "spirits/architect-admission", "spirits/watcher-policy-evolution",
  "runtime/fast-system-health-integration", "runtime/evolution-coordinator",
  "engineering/place-support", "engineering/place-existing-actors", "engineering/place-data",
].map(name => { const [dir, file] = name.split("/"); return `src/${dir}/__tests__/${file}.test.ts`; });
existingSuites.push("src/__tests__/god-autopilot.test.ts");
existingSuites.push("src/god/__tests__/spirit-growth.test.ts", "src/engineering/__tests__/place-materialization.test.ts",
  "src/evals/__tests__/service-closure-fixture.test.ts", "src/evals/__tests__/baseline-evidence-journal.test.ts");
existingSuites.push("src/world/__tests__/physical-access.test.ts", "src/cognition/__tests__/cognitive-local-view.test.ts",
  "src/cognition/__tests__/perception-boundaries.test.ts");
existingSuites.push("src/engineering/__tests__/place-custody-support.test.ts", "src/evals/__tests__/bakery-outcome.test.ts");
existingSuites.push("src/world/__tests__/object-state-time.test.ts", "src/cognition/__tests__/thought-publication.test.ts",
  "src/cognition/__tests__/actor-controller.test.ts", "src/demo/__tests__/sitcom-open-neighborhood.test.ts");
existingSuites.push("src/evals/__tests__/elaine-growth-evidence.test.ts", "src/runtime/__tests__/scheduler-readiness.test.ts",
  "src/cognition/__tests__/intention-reconsideration.test.ts", "src/cognition/__tests__/experience-appraisal.test.ts",
  "src/cognition/__tests__/commitment-handoff.test.ts", "src/cognition/__tests__/appraisal-intention-handoff.test.ts");
existingSuites.push("src/cognition/__tests__/personal-review-response.test.ts", "src/cognition/__tests__/planner-decision-foreground.test.ts");
existingSuites.push("src/cognition/__tests__/intention-inactivity-review.test.ts", "src/cognition/__tests__/intention-context.test.ts",
  "src/cognition/__tests__/foreground-goal-review-transition.test.ts", "src/cognition/__tests__/goal-plan-retirement.test.ts");
existingSuites.push("src/demo/__tests__/cookie-character-history.test.ts", "src/demo/__tests__/apartment-sitcom-cognition.test.ts",
  "src/demo/__tests__/apartment-sitcom.test.ts", "src/cognition/__tests__/character-past.test.ts");
existingSuites.push("src/cognition/__tests__/goal-pursuit.test.ts", "src/cognition/__tests__/foreground-action-admission.test.ts",
  "src/cognition/__tests__/foreground-mental-envelope.test.ts", "src/cognition/__tests__/planner-decision-frontier.test.ts",
  "src/cognition/__tests__/social-memory.test.ts");
existingSuites.push("src/spirits/__tests__/actor-intention-evidence.test.ts", "src/spirits/__tests__/weaver-demand.test.ts",
  "src/spirits/__tests__/watcher-weaver-handoff.test.ts", "src/spirits/__tests__/watcher-source-safety.test.ts",
  "src/spirits/__tests__/architect-feedback.test.ts");
existingSuites.push("src/evals/__tests__/iterative-diner-evidence.test.ts", "src/evals/__tests__/iterative-diner-fixture.test.ts");
existingSuites.push("src/evals/__tests__/purposeful-diner-support.test.ts");
existingSuites.push("src/__tests__/library-thought-publication.test.ts", "src/__tests__/actor-controller-runtime.test.ts",
  "src/__tests__/no-ai-mode.test.ts", "src/__tests__/simulation-bus.test.ts", "src/cognition/__tests__/optional-expressed-thought.test.ts",
  "src/demo/__tests__/optional-thought-view.test.ts", "src/lil/__tests__/thought-publication.test.ts");
existingSuites.push("src/runtime/__tests__/committed-outcome-evidence.test.ts", "src/cognition/__tests__/ongoing-activity.test.ts",
  "src/cognition/__tests__/timed-native-actions.test.ts", "src/demo/__tests__/sitcom-launch-profile.test.ts",
  "src/rendering/__tests__/committed-renderer-integration.test.ts");
existingSuites.push("src/demo/__tests__/sitcom-director.test.ts", "src/demo/__tests__/sitcom-generated-scenes.test.ts",
  "src/demo/__tests__/sitcom-screenplay.test.ts", "src/demo/__tests__/sitcom-phrase-action-boundary.test.ts",
  "src/rendering/__tests__/committed-scene-history.test.ts");
// Long-lived world ownership/retention supplements the original behavioral gates.
existingSuites.push("src/__tests__/library-operational-status.test.ts",
  "src/cognition/__tests__/stimulus-queue-lifecycle.test.ts", "src/cognition/__tests__/stimulus-producer-admission.test.ts",
  "src/cognition/__tests__/perception-admission.test.ts", "src/cognition/__tests__/listening-continuation.test.ts",
  "src/cognition/__tests__/cognitive-model-contract.test.ts", "src/runtime/__tests__/foreground-cognition.test.ts",
  "src/spirits/__tests__/daemon-whisper-freshness.test.ts", "src/spirits/__tests__/spirit-world-lifecycle.test.ts",
  "src/spirits/__tests__/successive-useful-growth.test.ts",
  "src/cognition/__tests__/policy-learning.test.ts", "src/cognition/__tests__/policy-learning-lifecycle.test.ts",
  "src/cognition/__tests__/narrative-hot-read.test.ts", "src/cognition/__tests__/narrative-mind.test.ts",
  "src/cognition/__tests__/narrative-recall-groups.test.ts", "src/cognition/__tests__/simulation-chronicle-retention.test.ts",
  "src/ecs/__tests__/system-diagnostic-retention.test.ts", "src/ecs/__tests__/system-telemetry.test.ts",
  "src/evals/__tests__/system-diagnostic-evidence.test.ts");
// Prospective scheduled two-need harness; retain every earlier suite.
existingSuites.push("src/evals/__tests__/successive-growth-fixture.test.ts", "src/evals/__tests__/successive-growth-evidence.test.ts",
  "src/evals/__tests__/successive-growth-builds.test.ts", "src/__tests__/god-autopilot-observation.test.ts");
// Native long-world repairs retain all earlier suites and live acceptance gates.
existingSuites.push("src/ecs/__tests__/seating-location.test.ts", "src/world/__tests__/effect-executor.test.ts",
  "src/world/__tests__/object-manager-components.test.ts", "src/world/__tests__/object-manager-grid-inheritance.test.ts",
  "src/cognition/__tests__/next-purpose.test.ts", "src/spirits/__tests__/next-purpose-demand.test.ts",
  "src/__tests__/god-autopilot-report-timing.test.ts");
const gates = ["arbiter", "watcher", "lawgiver"].map(name => `src/spirits/__tests__/${name}-readiness.gate.ts`);
const files = [...existingSuites, ...gates];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing declared suite: ${file}`);
function sourceHashes() {
  return Object.fromEntries(execFileSync("rg", ["--files", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n")
    .sort().map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
}
async function run() {
  const dir = fs.mkdtempSync(path.join(root, "recordings/spirit-readiness-offline-")); fs.chmodSync(dir, 0o700);
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value, { mode: 0o600 });
  const before = sourceHashes();
  write("source-before.json", JSON.stringify(before, null, 2));
  write("git-status-before.txt", execFileSync("git", ["status", "--short"], { cwd: root }));
  write("tracked-diff-before.patch", execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
  write("protocol.json", JSON.stringify({ startedAt: new Date().toISOString(), files, liveRequests: 0,
    testDeadlineMs: 180000, typecheckDeadlineMs: 120000, maxAttempts: 1, modelResponses: "scripted" }, null, 2));
  const guard = path.join(__dirname, "spirit-offline-network-guard.cjs");
  const env = { ...process.env, NODE_OPTIONS: `--require=${guard}`,
    ARGOS_SPIRIT_GATE_NETWORK_LOG: path.join(dir, "network-attempts.ndjson") };
  delete env.ARGOS_RUN_LLM_TESTS;
  const execute = (label, args, deadline) => new Promise(resolve => {
    const fd = fs.openSync(path.join(dir, `${label}.log`), "wx", 0o600);
    const started = Date.now(); let timedOut = false;
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", fd, fd] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, deadline);
    child.on("error", error => { fs.writeSync(fd, `${error.name}: ${error.message}\n`); });
    child.on("close", (code, signal) => {
      clearTimeout(timer); fs.closeSync(fd);
      const result = { pid: child.pid, code, signal, timedOut, elapsedMs: Date.now() - started };
      write(`${label}-exit.json`, JSON.stringify(result, null, 2)); resolve(result);
    });
  });
  const base = (await import(pathToFileURL(path.join(root, "jest.config.js")).href)).default;
  const config = { ...base, rootDir: root, testTimeout: 10000, setupFiles: [guard],
    testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.gate.ts"] };
  const testResult = await execute("tests", ["--experimental-vm-modules", "node_modules/jest/bin/jest.js",
    "--config", JSON.stringify(config), "--runInBand", "--json", "--outputFile", path.join(dir, "jest.json"),
    "--runTestsByPath", ...files], 180000);
  // A failed gate is still followed by this non-mutating diagnostic, never by a repair/retry.
  const types = await execute("types", ["node_modules/typescript/bin/tsc", "--noEmit"], 120000);
  const after = sourceHashes(); write("source-after.json", JSON.stringify(after, null, 2));
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const blockedNetwork = fs.existsSync(env.ARGOS_SPIRIT_GATE_NETWORK_LOG)
    ? fs.readFileSync(env.ARGOS_SPIRIT_GATE_NETWORK_LOG, "utf8").trim().split("\n").filter(Boolean).length : 0;
  const verdict = { status: testResult.code === 0 && types.code === 0 && unchanged && blockedNetwork === 0 ? "OFFLINE_PASS" : "HOLD",
    testResult, types, sourceUnchanged: unchanged, blockedNetwork, liveAcceptance: false };
  write("verdict.json", JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify({ directory: dir, ...verdict }, null, 2));
  process.exitCode = verdict.status === "OFFLINE_PASS" ? 0 : 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
