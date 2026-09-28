#!/usr/bin/env tsx
/**
 * God Agent CLI with Web Visualization
 * Run the God CLI with automatic web visualization
 */

import { spawn } from 'child_process';
import { createAutonomousGod } from './src/agents/autonomous-god.js';
import { startUniversalVisualization } from './src/visualization/universal-visualizer.js';
import chalk from 'chalk';

async function runGodWithWebViz() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║     GOD AGENT V2 + WEB VISUALIZATION       ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════╝\n'));
  
  // Create god instance
  const god = createAutonomousGod();
  
  // Start web visualization
  console.log(chalk.yellow('🌐 Starting web visualization...'));
  const viz = startUniversalVisualization(god.world, 8080);
  
  // Update visualization periodically
  setInterval(() => {
    viz.emitUpdate();
  }, 500);
  
  console.log(chalk.green(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   Web UI: http://localhost:8080                    ║
║                                                    ║
║   The visualizer adapts to your simulation type!  ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `));
  
  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Start the CLI in a subprocess
  console.log(chalk.cyan('\n🤖 Starting God Agent CLI...\n'));
  
  const cliProcess = spawn('tsx', ['src/cli.ts'], {
    stdio: 'inherit',
    env: { ...process.env, GOD_INSTANCE_ID: god.godEid.toString() }
  });
  
  // Handle exit
  process.on('SIGINT', () => {
    viz.stop();
    cliProcess.kill();
    console.log(chalk.yellow('\n👋 Stopped'));
    process.exit(0);
  });
  
  cliProcess.on('exit', () => {
    viz.stop();
    process.exit(0);
  });
}

// If we need to share the god instance between processes, we'd need a different approach
// For now, let's create a simpler integrated version:

import readline from 'readline';
import { processAutonomousInput } from './src/agents/autonomous-god.js';
import { emitNarrative } from './src/visualization/universal-visualizer.js';

async function integratedGodWithWeb() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║     GOD AGENT V2 + WEB VISUALIZATION       ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════╝\n'));
  
  const god = createAutonomousGod();
  
  // Start visualization
  const viz = startUniversalVisualization(god.world, 8080);
  
  // Update visualization periodically
  setInterval(() => {
    viz.emitUpdate();
  }, 500);
  
  console.log(chalk.green('✨ Web visualization active at: http://localhost:8080\n'));
  
  console.log(chalk.yellow('Welcome! Create any simulation and watch it come alive in your browser.\n'));
  
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  • "Create a particle simulation with 5 particles"'));
  console.log(chalk.gray('  • "Build a text adventure with 3 rooms"'));
  console.log(chalk.gray('  • "Simulate a social network of 5 people"'));
  console.log(chalk.gray('  • "Create a neural network with 10 neurons"\n'));
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('🌟 > ')
  });
  
  rl.prompt();
  
  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (!trimmed) {
      rl.prompt();
      return;
    }
    
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === '/exit') {
      rl.close();
      return;
    }
    
    // Special visualization commands
    if (trimmed.startsWith('/narrate ')) {
      const text = trimmed.substring(9);
      emitNarrative(text);
      console.log(chalk.gray('Added to narrative log'));
      rl.prompt();
      return;
    }
    
    // Process with God
    try {
      console.log();
      await processAutonomousInput(god, trimmed);
      console.log();
      
      // Auto-emit update after changes
      viz.emitUpdate();
    } catch (error) {
      console.error(chalk.red('\n❌ Error:', error));
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    viz.stop();
    console.log(chalk.yellow('\n\nFarewell! May your simulations prosper! 🌟\n'));
    process.exit(0);
  });
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    viz.stop();
    rl.close();
  });
}

// Run the integrated version
integratedGodWithWeb().catch(console.error);