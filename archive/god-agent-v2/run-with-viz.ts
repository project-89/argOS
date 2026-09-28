#!/usr/bin/env tsx
/**
 * God Agent CLI with Integrated Visualization
 * Runs the CLI with a live terminal visualization
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import readline from 'readline';

async function runWithVisualization() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║    GOD AGENT V2 - WITH VISUALIZATION       ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════╝\n'));
  
  // Create the god agent
  const god = createAutonomousGod();
  
  // Start visualization
  console.log(chalk.cyan('📺 Starting terminal visualization...'));
  const viz = startTerminalVisualization(god.world, {
    refreshRate: 1000,
    showSystems: true,
    showThoughts: true,
    compact: true // Compact mode for split view
  });
  
  // Wait a moment for viz to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create a simple input prompt at the bottom
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log(chalk.yellow('\n💡 Type commands to create your simulation:'));
  console.log(chalk.gray('   Example: "create 5 particles with physics"'));
  console.log(chalk.gray('   Type "exit" to quit\n'));
  
  const processInput = () => {
    rl.question(chalk.cyan('> '), async (input) => {
      if (input.trim().toLowerCase() === 'exit') {
        viz.stop();
        rl.close();
        console.log(chalk.yellow('\n👋 Goodbye!'));
        process.exit(0);
      }
      
      if (input.trim()) {
        try {
          await processAutonomousInput(god, input);
        } catch (error) {
          console.error(chalk.red('Error:', error));
        }
      }
      
      processInput(); // Continue loop
    });
  };
  
  processInput();
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    viz.stop();
    rl.close();
    console.log(chalk.yellow('\n\n👋 Stopped'));
    process.exit(0);
  });
}

runWithVisualization().catch(console.error);