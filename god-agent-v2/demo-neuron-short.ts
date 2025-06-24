#!/usr/bin/env node
/**
 * Short Neuron Demo - Autonomous God Agent
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function runShortDemo() {
  console.log(chalk.bold.cyan('\n🧠 NEURON SIMULATION - AUTONOMOUS GOD AGENT\n'));
  
  const god = createAutonomousGod();
  
  // Simpler, more focused prompt
  const prompt = `Create a basic neuron simulation. Include:
1. MembranePotential component (with voltage property, default -70)
2. NeuronState component (with isResting, isFiring, isRefractory properties)
3. ActionPotentialSystem that fires when voltage > -55
4. Create one neuron entity and make it fire`;
  
  console.log(chalk.yellow('Task:'), prompt);
  console.log(chalk.gray('─'.repeat(60)) + '\n');
  
  try {
    await processAutonomousInput(god, prompt);
    console.log(chalk.green('\n✅ Simulation complete!'));
  } catch (error) {
    console.error(chalk.red('\nError:'), error);
  }
  
  // Exit after 20 seconds max
  setTimeout(() => process.exit(0), 20000);
}

runShortDemo();