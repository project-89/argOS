#!/usr/bin/env tsx
/**
 * Simple Neuron Demo - Direct Commands
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startUniversalVisualization } from './src/visualization/universal-visualizer.js';
import { setModelOverride } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function demoNeurons() {
  console.log(chalk.bold.cyan('\n🧠 SIMPLE NEURON DEMO\n'));
  
  // Use Flash Lite for speed
  setModelOverride('flashLite');
  
  const god = createAutonomousGod();
  
  // Start web visualization
  console.log(chalk.cyan('🌐 Starting visualization on http://localhost:8081'));
  const viz = startUniversalVisualization(god.world, 8081);
  
  // Update frequently
  setInterval(() => viz.emitUpdate(), 500);
  
  try {
    // Step 1: Create Neuron component
    console.log(chalk.yellow('\n1️⃣ Creating Neuron component...'));
    await processAutonomousInput(god, 
      'Generate a component called Neuron with these properties: membranePotential (number), threshold (number), isFiring (boolean)'
    );
    
    // Step 2: Create neurons
    console.log(chalk.yellow('\n2️⃣ Creating three neurons...'));
    await processAutonomousInput(god, 
      'Create an entity named "Neuron1" with purpose "First neuron in network" and traits ["basic neuron"]'
    );
    await processAutonomousInput(god, 
      'Create an entity named "Neuron2" with purpose "Second neuron in network" and traits ["basic neuron"]'
    );
    await processAutonomousInput(god, 
      'Create an entity named "Neuron3" with purpose "Third neuron in network" and traits ["basic neuron"]'
    );
    
    // Step 3: Set neuron data
    console.log(chalk.yellow('\n3️⃣ Setting neuron properties...'));
    await processAutonomousInput(god, 
      'Set data on Neuron1: component Neuron with membranePotential=-70, threshold=-55, isFiring=false'
    );
    await processAutonomousInput(god, 
      'Set data on Neuron2: component Neuron with membranePotential=-65, threshold=-55, isFiring=false'
    );
    await processAutonomousInput(god, 
      'Set data on Neuron3: component Neuron with membranePotential=-60, threshold=-55, isFiring=false'
    );
    
    // Step 4: Create firing system
    console.log(chalk.yellow('\n4️⃣ Creating neuron firing system...'));
    await processAutonomousInput(god, 
      `Generate a system called NeuronFiringSystem that:
       - Requires Neuron component
       - Increases membranePotential by 2 each tick
       - If membranePotential >= threshold, set isFiring=true and reset membranePotential to -70
       - If isFiring was true, set it back to false after reset`
    );
    
    // Step 5: Run simulation
    console.log(chalk.yellow('\n5️⃣ Running simulation...'));
    await processAutonomousInput(god, 'Run NeuronFiringSystem 30 times');
    
    // Step 6: Inspect results
    console.log(chalk.yellow('\n6️⃣ Inspecting neurons...'));
    await processAutonomousInput(god, 'Inspect entity Neuron1');
    await processAutonomousInput(god, 'Inspect entity Neuron2');
    await processAutonomousInput(god, 'Inspect entity Neuron3');
    
    // Step 7: Generate UI
    console.log(chalk.yellow('\n7️⃣ Generating custom UI...'));
    await processAutonomousInput(god, 
      'Generate a rich interactive UI showing neurons as circles that pulse and glow when firing. Style should be artistic.'
    );
    
    // Step 8: Toggle live mode
    console.log(chalk.yellow('\n8️⃣ Starting live mode...'));
    await processAutonomousInput(god, 'Toggle live mode on with 10 FPS');
    
    console.log(chalk.green('\n✅ Demo running!'));
    console.log(chalk.cyan('View at: http://localhost:8081'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error(chalk.red('Error:', error));
  }
}

demoNeurons().catch(console.error);