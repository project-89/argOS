/**
 * Test Runner for God Agent V2
 * Runs various tests to ensure functionality
 */

import { createWorld, query } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from './agents/god-factory.js';
import { Agent, GodMode, getString } from './components/god-components.js';
import { ecsInspect } from './actions/inspect.js';

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

// Helper to run a test
async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(chalk.blue(`\nRunning test: ${name}`));
  const start = Date.now();
  
  try {
    await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(chalk.green(`✓ ${name} (${duration}ms)`));
  } catch (error) {
    const duration = Date.now() - start;
    results.push({ 
      name, 
      passed: false, 
      error: error instanceof Error ? error.message : String(error),
      duration 
    });
    console.log(chalk.red(`✗ ${name} (${duration}ms)`));
    console.log(chalk.gray(`  Error: ${error}`));
  }
}

// Test 1: Basic world creation
async function testWorldCreation() {
  const world = createWorld();
  const entities = query(world, []);
  
  if (entities.length !== 0) {
    throw new Error(`Expected 0 entities, got ${entities.length}`);
  }
}

// Test 2: God agent creation
async function testGodAgentCreation() {
  const world = createWorld();
  
  const godEid = createGodAgent(world, {
    name: 'Test God',
    role: 'Test Role',
    level: 75,
  });
  
  // Verify agent was created
  const agents = query(world, [Agent]);
  if (agents.length !== 1) {
    throw new Error(`Expected 1 agent, got ${agents.length}`);
  }
  
  // Verify god mode
  const gods = query(world, [Agent, GodMode]);
  if (gods.length !== 1) {
    throw new Error(`Expected 1 god, got ${gods.length}`);
  }
  
  // Check properties
  const name = getString(Agent.nameHash[godEid]);
  if (name !== 'Test God') {
    throw new Error(`Expected name 'Test God', got '${name}'`);
  }
  
  if (GodMode.level[godEid] !== 75) {
    throw new Error(`Expected level 75, got ${GodMode.level[godEid]}`);
  }
}

// Test 3: Multiple god creation
async function testMultipleGods() {
  const world = createWorld();
  
  // Create several gods
  createGodAgent(world, GOD_PRESETS.ARCHITECT);
  createGodAgent(world, GOD_PRESETS.NATURALIST);
  createGodAgent(world, GOD_PRESETS.ECONOMIST);
  
  const gods = query(world, [Agent, GodMode]);
  if (gods.length !== 3) {
    throw new Error(`Expected 3 gods, got ${gods.length}`);
  }
}

// Test 4: World inspection
async function testWorldInspection() {
  const world = createWorld();
  const godEid = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  
  const result = await ecsInspect(world, { target: 'world' }, godEid);
  
  if (result.data.entityCount !== 1) {
    throw new Error(`Expected 1 entity, got ${result.data.entityCount}`);
  }
  
  if (result.data.godCount !== 1) {
    throw new Error(`Expected 1 god, got ${result.data.godCount}`);
  }
}

// Test 5: Component inspection
async function testComponentInspection() {
  const world = createWorld();
  const godEid = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  
  const result = await ecsInspect(world, { 
    target: 'components',
    detailed: true 
  }, godEid);
  
  if (!Array.isArray(result.data)) {
    throw new Error('Expected array of components');
  }
}

// Test 6: Entity inspection
async function testEntityInspection() {
  const world = createWorld();
  const godEid = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  
  const result = await ecsInspect(world, { 
    target: 'entities',
    detailed: true 
  }, godEid);
  
  if (!Array.isArray(result.data)) {
    throw new Error('Expected array of entities');
  }
  
  const godEntity = result.data.find(e => e.eid === godEid);
  if (!godEntity) {
    throw new Error('Could not find god entity in results');
  }
  
  if (godEntity.name !== 'The Architect') {
    throw new Error(`Expected name 'The Architect', got '${godEntity.name}'`);
  }
}

// Main test runner
async function runAllTests() {
  console.log(chalk.bold.cyan('\n🧪 God Agent V2 Test Suite\n'));
  
  await runTest('World Creation', testWorldCreation);
  await runTest('God Agent Creation', testGodAgentCreation);
  await runTest('Multiple Gods', testMultipleGods);
  await runTest('World Inspection', testWorldInspection);
  await runTest('Component Inspection', testComponentInspection);
  await runTest('Entity Inspection', testEntityInspection);
  
  // Summary
  console.log(chalk.bold.cyan('\n📊 Test Summary\n'));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`Total tests: ${results.length}`);
  console.log(chalk.green(`Passed: ${passed}`));
  console.log(chalk.red(`Failed: ${failed}`));
  console.log(`Total time: ${totalTime}ms`);
  
  if (failed > 0) {
    console.log(chalk.red('\n❌ Some tests failed:'));
    results.filter(r => !r.passed).forEach(r => {
      console.log(chalk.red(`  - ${r.name}: ${r.error}`));
    });
    process.exit(1);
  } else {
    console.log(chalk.green('\n✅ All tests passed!'));
  }
}

// Run tests
runAllTests().catch(error => {
  console.error(chalk.red('Test runner failed:'), error);
  process.exit(1);
});