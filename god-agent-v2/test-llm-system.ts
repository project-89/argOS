#!/usr/bin/env node
/**
 * Test LLM System Generation
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function testLLMSystem() {
  console.log(chalk.bold.cyan('\n🧪 TESTING LLM SYSTEM GENERATION\n'));
  
  const god = createAutonomousGod();
  
  // Create a simple test
  console.log(chalk.yellow('Creating a simple conscious NPC...'));
  
  await processAutonomousInput(god, `
    Create an NPCMind component with personality and thoughts properties.
    Then create a SimpleThinkingSystem that uses AI to generate thoughts.
    Create one NPC named Alice with personality "curious and friendly".
  `);
  
  console.log(chalk.green('\n✅ Test complete!'));
}

testLLMSystem().catch(console.error);