#!/usr/bin/env tsx
/**
 * Universal Visualization Demo
 * Shows how the visualizer adapts to different simulation types
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startUniversalVisualization, emitNarrative } from './src/visualization/universal-visualizer.js';
import chalk from 'chalk';

async function demonstrateUniversalVisualization() {
  console.log(chalk.bold.cyan('\n🌌 UNIVERSAL VISUALIZATION DEMO\n'));
  
  const god = createAutonomousGod();
  
  // Start universal visualization
  console.log(chalk.yellow('Starting universal visualization server...'));
  const viz = startUniversalVisualization(god.world, 8080);
  
  console.log(chalk.green(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   Open your browser to: http://localhost:8080     ║
║                                                    ║
║   The visualizer will adapt to any simulation!    ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `));
  
  // Give server time to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(chalk.cyan('\n🎭 Demo 1: Text Adventure Simulation\n'));
  
  await processAutonomousInput(god, `
    Create a text adventure simulation:
    
    1. Create Room component with nameHash and description
    2. Create Character component with nameHash, currentRoom, and inventory
    3. Create Dialogue component with speaker, text, and timestamp
    4. Create Contains relationship for inventory
    5. Create ConnectsTo relationship for room connections
    
    6. Create 3 rooms: "Tavern", "Market", "Castle Gate"
    7. Connect Tavern to Market, Market to Castle Gate
    8. Create a character named "Hero" in the Tavern
    9. Create an NPC named "Merchant" in the Market
    
    10. Create a DialogueSystem that generates conversations between characters
  `);
  
  // Add some narrative
  emitNarrative("The hero enters the tavern, the smell of ale and adventure in the air.", []);
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log(chalk.cyan('\n🌌 Demo 2: Abstract Knowledge Network\n'));
  
  await processAutonomousInput(god, `
    Now let's create a knowledge network:
    
    1. Create Concept component with name and category
    2. Create Knowledge component with confidence and source
    3. Create RelatesTo relationship with strength property
    
    4. Create concepts: "Gravity", "Mass", "Acceleration", "Force"
    5. Connect them with RelatesTo relationships
    
    The visualizer will show this as a network graph!
  `);
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log(chalk.cyan('\n🎮 Demo 3: Hybrid Simulation (Physics + AI)\n'));
  
  await processAutonomousInput(god, `
    Finally, create a hybrid simulation:
    
    1. Use existing Position and Velocity components if they exist
    2. Create Mind component with mood and intention
    3. Create 3 entities that have both physical and mental properties
    4. Create an AIThinkingSystem that updates their intentions based on positions
    
    The visualizer will show both spatial positions AND mental states!
  `);
  
  console.log(chalk.green('\n✨ Demo running! Check your browser to see how the visualization adapts.'));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));
  
  // Keep running and emit periodic updates
  setInterval(() => {
    viz.emitUpdate();
  }, 1000);
  
  // Handle exit
  process.on('SIGINT', () => {
    viz.stop();
    console.log(chalk.yellow('\n👋 Visualization stopped'));
    process.exit(0);
  });
}

demonstrateUniversalVisualization().catch(console.error);