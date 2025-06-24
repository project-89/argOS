#!/usr/bin/env node
/**
 * Simple test for God Agent V2
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function testSimple() {
  console.log(chalk.cyan('Starting simple test...'));
  
  try {
    // Create the autonomous god
    const god = createAutonomousGod();
    console.log(chalk.green('✅ Created god agent'));
    
    // Simple request
    const request = "create a simple Position component with x and y properties";
    console.log(chalk.yellow('\nRequest:', request));
    
    // Process with very short timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 10000)
    );
    
    const result = await Promise.race([
      processAutonomousInput(god, request),
      timeoutPromise
    ]);
    
    console.log(chalk.green('\n✅ Done!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'));
    console.error(error);
  }
}

testSimple();