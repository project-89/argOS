#!/usr/bin/env node
/**
 * Simple Visualization Test
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startVisualizationServer } from './src/visualization/visualization-server.js';
import chalk from 'chalk';

async function simpleVizTest() {
  console.log(chalk.bold.cyan('\n🎨 SIMPLE VISUALIZATION TEST\n'));
  
  const god = createAutonomousGod();
  
  // Start visualization
  console.log(chalk.cyan('Starting visualization server...'));
  startVisualizationServer(god.world, 8081);
  
  console.log(chalk.green('✨ Visualization available at: http://localhost:8081'));
  console.log(chalk.yellow('Open this URL in your browser!\n'));
  
  // Create a simple component and entity
  await processAutonomousInput(god, `
    Create a Position component with x and y coordinates.
    Create an NPCMind component with personality and thoughts.
    Create Alice at position (200, 150) with personality "curious baker".
  `);
  
  console.log(chalk.green('\n✅ Created Alice! Check the visualization in your browser.'));
  console.log(chalk.gray('Press Ctrl+C to stop'));
  
  // Keep alive
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Stopping...'));
    process.exit(0);
  });
  
  // Keep the process running
  setInterval(() => {}, 1000);
}

simpleVizTest().catch(console.error);