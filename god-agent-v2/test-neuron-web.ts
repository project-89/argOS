#!/usr/bin/env tsx
/**
 * Neuron Test with Web Visualization
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startUniversalVisualization } from './src/visualization/universal-visualizer.js';
import { setModelOverride } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function testNeuronWithWeb() {
  console.log(chalk.bold.cyan('\n🧠 NEURON SIMULATION WITH WEB VIZ\n'));
  
  // Use Flash Lite for blazing fast speed
  setModelOverride('flashLite');
  
  const god = createAutonomousGod();
  
  // Start web visualization
  console.log(chalk.cyan('🌐 Starting web visualization on http://localhost:8081'));
  const viz = startUniversalVisualization(god.world, 8081);
  
  // Update frequently
  setInterval(() => viz.emitUpdate(), 500);
  
  try {
    // Create a simple neuron simulation
    console.log(chalk.yellow('\n📋 Creating neuron simulation...'));
    
    await processAutonomousInput(god, 
      `Create a simple neuron simulation with 3 neurons that fire when stimulated. 
       The neurons should have membrane potential and firing threshold properties.
       When a neuron fires, it should reset its potential and possibly stimulate neighboring neurons.`
    );
    
    console.log(chalk.yellow('\n🏃 Running the simulation...'));
    await processAutonomousInput(god, 'Run the neuron systems 20 times to see neurons firing');
    
    console.log(chalk.yellow('\n🎨 Generating custom UI...'));
    await processAutonomousInput(god, 
      'Generate a rich interactive UI that shows the neurons as circles that glow when they fire'
    );
    
    console.log(chalk.green('\n✅ Simulation running!'));
    console.log(chalk.cyan('View at: http://localhost:8081\n'));
    console.log(chalk.gray('Press Ctrl+C to stop'));
    
    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error(chalk.red('Error:', error));
  }
}

testNeuronWithWeb().catch(console.error);