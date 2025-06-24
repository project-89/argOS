#!/usr/bin/env node
/**
 * Autonomous Neuron Simulation Demo
 * Shows the God Agent creating a neuron simulation autonomously
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function runNeuronDemo() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   AUTONOMOUS NEURON SIMULATION DEMO    ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════╝\n'));
  
  const god = createAutonomousGod();
  
  // Give the agent a clear, scientific task
  const prompt = `
    Simulate the functioning of a single neuron at the cellular level. 
    Include:
    1. Membrane potential and resting state (-70mV)
    2. Ion channels (sodium and potassium)
    3. Action potential generation and propagation
    4. Refractory period
    5. Synaptic transmission capabilities
    
    Create all necessary components, systems, and a functioning neuron entity.
    Then run the simulation to show the neuron firing an action potential.
  `;
  
  console.log(chalk.yellow('📝 Task given to God Agent:'));
  console.log(chalk.gray(prompt.trim()));
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  try {
    // Process the request
    await processAutonomousInput(god, prompt);
    
    console.log(chalk.gray('\n' + '─'.repeat(60)));
    console.log(chalk.green('\n✅ Neuron simulation created!\n'));
    
    // Ask the agent to run the simulation
    console.log(chalk.yellow('📝 Requesting simulation run...\n'));
    await processAutonomousInput(god, 'Please run the neuron simulation and show me the action potential firing.');
    
    console.log(chalk.gray('\n' + '─'.repeat(60)));
    console.log(chalk.green('\n✨ Demo complete!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error in demo:'));
    console.error(error);
  }
  
  process.exit(0);
}

// Add timeout to prevent hanging
setTimeout(() => {
  console.log(chalk.yellow('\n⏱️  Demo timeout reached. Exiting...'));
  process.exit(0);
}, 60000); // 60 second timeout

runNeuronDemo();