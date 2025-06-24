#!/usr/bin/env node
/**
 * Performance Test - Compare model speeds
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function testPerformance() {
  console.log(chalk.bold.cyan('\n🏎️  PERFORMANCE TEST\n'));
  
  const god = createAutonomousGod();
  
  // Test cases
  const tests = [
    { input: '/inspect', name: 'Simple command' },
    { input: 'list all components', name: 'Query operation' },
    { input: 'create a Position component with x and y', name: 'Component creation' },
    { input: 'test the simulation', name: 'Testing operation' },
  ];
  
  for (const test of tests) {
    console.log(chalk.yellow(`\nTesting: ${test.name}`));
    console.log(chalk.gray(`Input: "${test.input}"`));
    
    const start = performance.now();
    
    try {
      await processAutonomousInput(god, test.input);
      
      const duration = performance.now() - start;
      console.log(chalk.green(`⏱️  Completed in ${(duration / 1000).toFixed(2)}s`));
      
    } catch (error) {
      console.error(chalk.red('Error:', error));
    }
  }
  
  console.log(chalk.cyan('\n✅ Performance test complete!\n'));
}

testPerformance();