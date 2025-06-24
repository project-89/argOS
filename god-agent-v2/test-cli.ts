#!/usr/bin/env node
/**
 * Test script for God Agent V2 CLI
 * Demonstrates autonomous neuron simulation
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function testNeuronSimulation() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║     GOD AGENT V2 - NEURON TEST         ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════╝\n'));
  
  // Create the autonomous god
  const god = createAutonomousGod();
  console.log(chalk.green('✅ Created autonomous god agent\n'));
  
  // Test request
  const request = "simulate the functioning of a single neuron";
  console.log(chalk.yellow('📝 User request:', request));
  console.log(chalk.gray('─'.repeat(50)) + '\n');
  
  try {
    // Process the request with timeout
    console.log(chalk.gray('Starting simulation...'));
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout after 30 seconds')), 30000)
    );
    
    const result = await Promise.race([
      processAutonomousInput(god, request),
      timeout
    ]);
    
    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(chalk.green('\n✅ Simulation complete!\n'));
    
    // Skip inspection for now
    console.log(chalk.yellow('Simulation has been created. Use CLI to inspect.'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:', error));
    if (error instanceof Error && error.message.includes('Timeout')) {
      console.log(chalk.yellow('\n⚠️  The AI is taking longer than expected.'));
      console.log(chalk.yellow('This might be due to the complexity of the neuron simulation.'));
    }
  }
}

// Run the test
testNeuronSimulation().catch(console.error);