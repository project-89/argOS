#!/usr/bin/env tsx
/**
 * Test God Agent with Terminal Visualization
 * Shows how visualizer works with real simulations
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import chalk from 'chalk';

async function testGodWithVisualization() {
  console.log(chalk.bold.cyan('\n🔮 GOD AGENT WITH VISUALIZATION TEST\n'));
  
  const god = createAutonomousGod();
  
  // Start visualization immediately
  console.log(chalk.yellow('Starting terminal visualization...'));
  const viz = startTerminalVisualization(god.world, {
    refreshRate: 500,  // Faster refresh for testing
    showThoughts: true,
    showSystems: true
  });
  
  // Give visualization a moment to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create a simple simulation
  console.log(chalk.green('\n\nCreating simulation...'));
  
  await processAutonomousInput(god, `
    Create a simple social simulation:
    
    1. Create a Person component with name and mood (0-100)
    2. Create a Friendship relationship
    3. Create three people: Alice (happy), Bob (neutral), Charlie (sad)
    4. Make Alice friends with Bob
    5. Create a MoodContagion system that spreads mood between friends
    
    Then run the system a few times to see mood spreading.
  `);
  
  // Keep running for a bit to see the visualization
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  viz.stop();
  console.log(chalk.green('\n✅ Test complete!'));
}

testGodWithVisualization().catch(console.error);