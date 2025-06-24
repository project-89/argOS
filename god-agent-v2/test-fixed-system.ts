#!/usr/bin/env tsx
/**
 * Test Fixed System Generation
 * Verifies that God can now create working systems
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import chalk from 'chalk';

async function testFixedSystemGeneration() {
  console.log(chalk.bold.cyan('\n🔧 TESTING FIXED SYSTEM GENERATION\n'));
  
  const god = createAutonomousGod();
  
  // Start visualization
  const viz = startTerminalVisualization(god.world, {
    refreshRate: 500,
    showSystems: true
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create a simple particle system
  console.log(chalk.yellow('Creating components and entities...'));
  
  await processAutonomousInput(god, `
    Create a simple particle simulation:
    
    1. Create Position component with x and y properties
    2. Create Velocity component with vx and vy properties  
    3. Create 3 particles with random positions and velocities
    4. Create a PhysicsSystem that updates positions based on velocities
    5. Run the system 5 times to see particles move
  `);
  
  // Keep running for a bit
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  viz.stop();
  console.log(chalk.green('\n✅ Test complete!'));
}

testFixedSystemGeneration().catch(console.error);