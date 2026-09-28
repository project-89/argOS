#!/usr/bin/env tsx
/**
 * Simple Neuron Test
 * Tests creating a basic neuron simulation
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { setModelOverride } from './src/llm/model-selector.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import chalk from 'chalk';

async function testSimpleNeuron() {
  console.log(chalk.bold.cyan('\n🧠 SIMPLE NEURON TEST\n'));
  
  // Use Flash 2.5 for speed
  setModelOverride('flash25');
  
  const god = createAutonomousGod();
  
  // Start terminal visualization
  const viz = startTerminalVisualization(god.world, {
    refreshRate: 500,
    showSystems: true
  });
  
  try {
    // Create neuron step by step
    console.log(chalk.yellow('Step 1: Creating Neuron component'));
    await processAutonomousInput(god, 'Create a Neuron component with membranePotential and threshold properties');
    
    console.log(chalk.yellow('\nStep 2: Creating neuron entity'));
    await processAutonomousInput(god, 'Create a neuron entity with resting potential -70 and threshold -55');
    
    console.log(chalk.yellow('\nStep 3: Creating firing system'));
    await processAutonomousInput(god, 'Create a simple NeuronFiringSystem that increases membrane potential and fires when threshold is reached');
    
    console.log(chalk.yellow('\nStep 4: Running simulation'));
    await processAutonomousInput(god, 'Run the neuron system 10 times to see it fire');
    
    // Keep visualization running
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log(chalk.green('\n✅ Test complete!'));
  } catch (error) {
    console.error(chalk.red('Error:', error));
  } finally {
    viz.stop();
  }
}

testSimpleNeuron().catch(console.error);