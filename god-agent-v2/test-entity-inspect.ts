#!/usr/bin/env node
/**
 * Test entity inspection functionality
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function testEntityInspection() {
  console.log(chalk.bold.cyan('\n🔍 ENTITY INSPECTION TEST\n'));
  
  const god = createAutonomousGod();
  
  // Create some entities first
  console.log(chalk.yellow('1. Creating test entities...'));
  await processAutonomousInput(god, 'Create two villagers named Alice and Bob with Position and Health components');
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Test inspecting specific entity
  console.log(chalk.yellow('2. Testing entity inspection...'));
  await processAutonomousInput(god, 'Inspect Alice');
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Test inspecting another entity
  console.log(chalk.yellow('3. Inspecting Bob...'));
  await processAutonomousInput(god, 'Show me what components Bob has');
  
  console.log(chalk.green('\n✅ Entity inspection test complete!\n'));
}

testEntityInspection().catch(console.error);