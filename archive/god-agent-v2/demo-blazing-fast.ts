#!/usr/bin/env tsx
/**
 * Blazing Fast Demo with Custom UI
 * Shows off Gemini 2.5 Flash Lite and dynamic UI generation
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startUniversalVisualization } from './src/visualization/universal-visualizer.js';
import { setModelOverride } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function blazingFastDemo() {
  console.log(chalk.bold.cyan('\n⚡ BLAZING FAST DEMO WITH CUSTOM UI ⚡\n'));
  
  // Use the blazing fast model
  setModelOverride('flashLite');
  
  const god = createAutonomousGod();
  
  // Start web visualization
  console.log(chalk.yellow('🌐 Starting web visualization...'));
  const viz = startUniversalVisualization(god.world, 8080);
  
  // Update frequently
  setInterval(() => viz.emitUpdate(), 100);
  
  console.log(chalk.green(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   Open: http://localhost:8080                      ║
║                                                    ║
║   Watch as God creates custom UI instantly! ⚡     ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `));
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(chalk.cyan('\n🎮 Demo 1: Particle System with Custom Trails UI\n'));
  
  await processAutonomousInput(god, `
    Create a beautiful particle system:
    
    1. Create Particle component with mass, charge, and colorHash
    2. Create Position component with x, y, z
    3. Create Velocity component with vx, vy, vz  
    4. Create Trail component to store past positions
    
    5. Create 10 charged particles with random colors
    6. Create ElectromagneticSystem that simulates attraction/repulsion
    7. Create TrailSystem that records particle paths
    
    8. Generate a custom UI with particle trails visualization, showing:
       - Particles as glowing orbs with their color
       - Trails that fade over time
       - Charge indicators (+ or -)
       - Interactive style with hover effects
    
    9. Run the simulation in live mode
  `);
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log(chalk.cyan('\n🏰 Demo 2: RPG Dungeon with Custom Game UI\n'));
  
  await processAutonomousInput(god, `
    Now create an RPG dungeon simulation:
    
    1. Create Character component with nameHash, health, mana, level
    2. Create Inventory component with slots array
    3. Create Room component with nameHash, description, treasureLevel
    4. Create Combat component with attack, defense, critChance
    
    5. Create rooms: "Entrance Hall", "Treasury", "Boss Chamber"
    6. Create a hero character with starting stats
    7. Create monsters in each room
    
    8. Generate a game-like UI showing:
       - Character stats with health/mana bars
       - Inventory grid system
       - Room navigation buttons
       - Combat log area
       - Fantasy/medieval styling
    
    The UI should be fully interactive for a game experience!
  `);
  
  console.log(chalk.green('\n✨ Demos running! Check your browser.'));
  console.log(chalk.gray('The UI updates instantly thanks to Gemini 2.5 Flash Lite! ⚡'));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));
  
  // Keep running
  process.on('SIGINT', () => {
    viz.stop();
    console.log(chalk.yellow('\n👋 Stopped'));
    process.exit(0);
  });
}

blazingFastDemo().catch(console.error);