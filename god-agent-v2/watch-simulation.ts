#!/usr/bin/env tsx
/**
 * Watch Current Simulation
 * Connects to the running God Agent world and visualizes it
 */

import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import { globalRegistry } from './src/components/registry.js';
import chalk from 'chalk';

// Import the CLI session to get the current world
import { getActiveSession } from './src/cli.js';

async function watchSimulation() {
  console.log(chalk.bold.cyan('\n👁️  SIMULATION WATCHER\n'));
  
  // Get the active God Agent session
  const session = getActiveSession();
  
  if (!session) {
    console.error(chalk.red('No active God Agent session found!'));
    console.log(chalk.yellow('\nPlease run "npm run god" first to start a session.'));
    process.exit(1);
  }
  
  const world = session.god.world;
  
  // Show what's registered
  console.log(chalk.green('📦 Registered Components:'));
  for (const comp of globalRegistry.listComponents()) {
    console.log(`   - ${comp}`);
  }
  
  console.log(chalk.green('\n⚙️  Registered Systems:'));
  for (const sys of globalRegistry.listSystems()) {
    console.log(`   - ${sys}`);
  }
  
  // Start visualization
  console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
  console.log(chalk.gray('(Press Ctrl+C to stop)\n'));
  
  const viz = startTerminalVisualization(world, {
    refreshRate: 500,
    showSystems: true,
    showThoughts: true,
    compact: false
  });
  
  // Keep running
  process.on('SIGINT', () => {
    viz.stop();
    console.log(chalk.yellow('\n👋 Stopped watching'));
    process.exit(0);
  });
}

// Export for use in CLI
export { watchSimulation };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  watchSimulation().catch(console.error);
}