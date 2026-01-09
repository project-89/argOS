/**
 * Behavioral Test Runner
 *
 * Runs all behavioral tests in sequence and generates a summary report.
 * Usage:
 *   npx tsx src/behavioral-tests/run-all.ts          # Run all tests
 *   npx tsx src/behavioral-tests/run-all.ts 1       # Run test 1 only
 *   npx tsx src/behavioral-tests/run-all.ts 1 2     # Run tests 1 and 2
 */

import "dotenv/config";

const testFiles = [
  { id: 1, name: "Ecosystem Builder", file: "./01-ecosystem-builder.ts" },
  { id: 2, name: "System Stress Test", file: "./02-system-stress.ts" },
  { id: 3, name: "Problem Solving", file: "./03-problem-solving.ts" },
  { id: 4, name: "Long Running", file: "./04-long-running.ts" },
];

async function runTest(testId: number): Promise<{ success: boolean; error?: string }> {
  const test = testFiles.find(t => t.id === testId);
  if (!test) {
    return { success: false, error: `Test ${testId} not found` };
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`Running Test ${test.id}: ${test.name}`);
  console.log(`${"═".repeat(70)}\n`);

  try {
    // Dynamic import to run the test
    await import(test.file);
    return { success: true };
  } catch (error) {
    console.error(`Test ${test.id} failed with error:`, error);
    return { success: false, error: String(error) };
  }
}

async function main() {
  const args = process.argv.slice(2);

  let testsToRun: number[];

  if (args.length > 0) {
    testsToRun = args.map(a => parseInt(a, 10)).filter(n => !isNaN(n));
    if (testsToRun.length === 0) {
      console.log("Usage: npx tsx src/behavioral-tests/run-all.ts [test_numbers...]");
      console.log("\nAvailable tests:");
      for (const t of testFiles) {
        console.log(`  ${t.id}: ${t.name}`);
      }
      process.exit(1);
    }
  } else {
    testsToRun = testFiles.map(t => t.id);
  }

  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 - Behavioral Test Suite                                    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(`\nRunning ${testsToRun.length} test(s): ${testsToRun.join(", ")}\n`);

  const results: Array<{ id: number; name: string; success: boolean; error?: string }> = [];
  const startTime = Date.now();

  for (const testId of testsToRun) {
    const test = testFiles.find(t => t.id === testId)!;
    const result = await runTest(testId);
    results.push({ id: testId, name: test.name, ...result });

    // Brief pause between tests
    await new Promise(r => setTimeout(r, 1000));
  }

  const duration = Date.now() - startTime;

  // Summary
  console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  BEHAVIORAL TEST SUITE - SUMMARY                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log("Results:");
  for (const r of results) {
    const status = r.success ? "✓ PASS" : "✗ FAIL";
    console.log(`  ${status} - Test ${r.id}: ${r.name}`);
    if (r.error) {
      console.log(`         Error: ${r.error.slice(0, 100)}`);
    }
  }

  console.log(`\nTotal: ${passed}/${results.length} passed`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)} seconds`);

  if (failed > 0) {
    console.log("\n⚠️  Some tests failed. Check the output above for details.");
    process.exit(1);
  } else {
    console.log("\n✅ All tests completed successfully!");
  }
}

main().catch(console.error);
