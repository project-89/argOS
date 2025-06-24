#!/usr/bin/env node
/**
 * God Agent V2 CLI
 * Interactive command-line interface for the autonomous God Agent
 */

import readline from 'readline';
import chalk from 'chalk';
import { createAutonomousGod, processAutonomousInput } from './agents/autonomous-god.js';
import { setModelOverride, getCurrentModel, modelNames, models } from './llm/model-selector.js';
import { startTerminalVisualization, TerminalVisualizer } from './visualization/terminal-visualizer.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan('\n🌟 > ')
});

async function main() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        GOD AGENT V2 - CLI              ║'));
  console.log(chalk.bold.cyan('║    Autonomous ECS World Creator        ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════╝\n'));
  
  console.log(chalk.yellow('Welcome! I am an autonomous God AI that can create any simulation.'));
  console.log(chalk.yellow('Tell me what you want to simulate, and I will build it for you.\n'));
  
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  • "Simulate two neurons communicating"'));
  console.log(chalk.gray('  • "Create a simple ecosystem with plants and animals"'));
  console.log(chalk.gray('  • "Model the solar system with gravitational forces"'));
  console.log(chalk.gray('  • "Build a village with people who can talk and trade"\n'));
  
  console.log(chalk.gray('Commands:'));
  console.log(chalk.gray('  • /inspect - Inspect the current world state'));
  console.log(chalk.gray('  • /model [name] - Switch AI model or show current'));
  console.log(chalk.gray('  • /live - Toggle live simulation mode (systems run continuously)'));
  console.log(chalk.gray('  • /watch - Open terminal visualization in current window'));
  console.log(chalk.gray('  • /save <filename> - Save simulation to .godsim file'));
  console.log(chalk.gray('  • /load <filename> - Load simulation from .godsim file'));
  console.log(chalk.gray('  • /list - List available .godsim files'));
  console.log(chalk.gray('  • /clear - Start fresh with a new world'));
  console.log(chalk.gray('  • /help - Show this help message'));
  console.log(chalk.gray('  • /exit - Exit the program\n'));

  // Create the autonomous god
  let god = createAutonomousGod();
  let visualizer: TerminalVisualizer | null = null;
  
  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle special commands
    if (trimmed.startsWith('/')) {
      visualizer = await handleCommand(trimmed, god, visualizer);
      rl.prompt();
      return;
    }

    // Process regular input
    try {
      console.log(); // Add spacing
      await processAutonomousInput(god, trimmed);
      console.log(); // Add spacing after response
    } catch (error) {
      console.error(chalk.red('\n❌ Error:', error));
    }
    
    rl.prompt();
  });

  rl.on('close', () => {
    if (visualizer) {
      visualizer.stop();
    }
    console.log(chalk.yellow('\n\nFarewell, mortal. May your simulations prosper! 🌟\n'));
    process.exit(0);
  });
}

async function handleCommand(command: string, god: any, visualizer: TerminalVisualizer | null): Promise<TerminalVisualizer | null> {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  switch (cmd) {
    case '/inspect':
      console.log(chalk.cyan('\n🔍 Inspecting world...\n'));
      await processAutonomousInput(god, 'Please inspect the current world state and show me what exists.');
      break;
    
    case '/live':
      console.log(chalk.cyan('\n🔄 Toggling live mode...\n'));
      await processAutonomousInput(god, 'Toggle live simulation mode. If it\'s off, turn it on. If it\'s on, turn it off.');
      break;
    
    case '/watch':
      if (visualizer) {
        visualizer.stop();
        visualizer = null;
        console.log(chalk.yellow('\n📺 Stopped visualization\n'));
      } else {
        console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
        console.log(chalk.gray('(This will take over your terminal. Press Ctrl+C to return to CLI)\n'));
        visualizer = startTerminalVisualization(god.world, {
          refreshRate: 500,
          showSystems: true,
          showThoughts: true,
          compact: false
        });
      }
      break;
    
    case '/model':
      if (args.length === 0) {
        // Show current model and options
        const current = getCurrentModel();
        console.log(chalk.cyan('\n🤖 AI Model Settings:\n'));
        console.log(chalk.yellow(`Current: ${current === 'auto' ? 'Automatic selection' : modelNames[current as keyof typeof modelNames] || current}`));
        console.log(chalk.gray('\nAvailable models:'));
        console.log(chalk.gray('  • auto - Automatic selection based on task'));
        console.log(chalk.gray('  • flash - Gemini 1.5 Flash (Fastest)'));
        console.log(chalk.gray('  • flash25 - Gemini 2.0 Flash (Smart & Fast) ⭐'));
        console.log(chalk.gray('  • flashLite - Gemini 2.5 Flash Lite (⚡ BLAZING FAST)'));
        console.log(chalk.gray('  • flashLatest - Gemini 2.0 Flash Exp'));
        console.log(chalk.gray('  • pro - Gemini 1.5 Pro (Quality)'));
        console.log(chalk.gray('  • proPreview - Gemini 2.5 Pro Preview (Highest Quality)'));
        console.log(chalk.gray('\nUsage: /model <name> to switch\n'));
      } else {
        const modelKey = args[0];
        if (modelKey.toLowerCase() === 'auto') {
          setModelOverride(null);
          console.log(chalk.green('\n✅ Model selection set to automatic\n'));
        } else if (modelKey in models) {
          setModelOverride(modelKey as keyof typeof models);
          console.log(chalk.green(`\n✅ Model switched to: ${modelNames[modelKey as keyof typeof modelNames]}\n`));
        } else {
          console.log(chalk.red(`\n❌ Unknown model: ${modelKey}`));
          console.log(chalk.gray('Use /model to see available options\n'));
        }
      }
      break;
    
    case '/save':
      if (args.length === 0) {
        console.log(chalk.red('\n❌ Please provide a filename: /save <filename>'));
        break;
      }
      console.log(chalk.cyan(`\n💾 Saving simulation to ${args[0]}...\n`));
      await processAutonomousInput(god, `Save the current simulation to "${args[0]}".godsim with name "${args[0]}" and description "User-created simulation"`);
      break;
    
    case '/load':
      if (args.length === 0) {
        console.log(chalk.red('\n❌ Please provide a filename: /load <filename>'));
        break;
      }
      try {
        const { SimulationRuntime } = await import('./runtime/simulation-runtime.js');
        const runtime = new SimulationRuntime();
        await runtime.loadFromFile(args[0]);
        console.log(chalk.green(`\n✅ Simulation loaded from ${args[0]}`));
        console.log(chalk.yellow('Note: This loads into a separate runtime. Use /clear and rebuild to modify.\n'));
      } catch (error) {
        console.log(chalk.red(`\n❌ Failed to load ${args[0]}: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      }
      break;
    
    case '/list':
      try {
        const { SimulationSerializer } = await import('./persistence/simulation-serializer.js');
        const files = await SimulationSerializer.list('.');
        console.log(chalk.cyan('\n📁 Available .godsim files:'));
        if (files.length === 0) {
          console.log(chalk.gray('   No simulation files found.\n'));
        } else {
          files.forEach(file => console.log(`   📄 ${file}`));
          console.log();
        }
      } catch (error) {
        console.log(chalk.red(`\n❌ Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      }
      break;
      
    case '/clear':
      console.log(chalk.yellow('\n🌊 Creating new world...\n'));
      god = createAutonomousGod();
      console.log(chalk.green('✨ A fresh world awaits your commands!\n'));
      break;
      
    case '/help':
      console.log(chalk.yellow('\n📖 Help:\n'));
      console.log(chalk.gray('Just tell me what you want to simulate in natural language.'));
      console.log(chalk.gray('I will create all necessary components, systems, and entities.\n'));
      console.log(chalk.gray('Examples:'));
      console.log(chalk.gray('  • "Create a neuron that fires action potentials"'));
      console.log(chalk.gray('  • "Build a simple economy with traders"'));
      console.log(chalk.gray('  • "Simulate predator-prey dynamics"'));
      console.log(chalk.gray('  • "Model a bouncing ball with physics"\n'));
      console.log(chalk.gray('Commands:'));
      console.log(chalk.gray('  • /model [name] - Switch AI model (flash25 recommended!)'));
      console.log(chalk.gray('  • /live - Toggle live mode (systems run continuously)'));
      console.log(chalk.gray('  • /save <name> - Save current simulation'));
      console.log(chalk.gray('  • /load <name> - Load saved simulation'));
      console.log(chalk.gray('  • /list - Show available simulations\n'));
      break;
      
    case '/exit':
    case '/quit':
      rl.close();
      break;
      
    default:
      console.log(chalk.red(`\n❌ Unknown command: ${cmd}`));
      console.log(chalk.gray('Type /help for available commands\n'));
  }
  
  return visualizer;
}

// Run the CLI
main().catch(error => {
  console.error(chalk.red('Fatal error:', error));
  process.exit(1);
});