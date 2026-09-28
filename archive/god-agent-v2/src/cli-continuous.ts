#!/usr/bin/env node
/**
 * God Agent V2 CLI - Continuous Mode
 * Allows the agent to build until it decides it's done
 */

import readline from 'readline';
import chalk from 'chalk';
import { createAutonomousGod, processAutonomousInput } from './agents/autonomous-god.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan('\n🌟 > ')
});

async function main() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   GOD AGENT V2 - CONTINUOUS MODE       ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════╝\n'));
  
  console.log(chalk.yellow('🔄 Continuous Mode: The agent will build until it decides it\'s done.'));
  console.log(chalk.yellow('It can take as many steps as needed to complete complex simulations.\n'));
  
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  • "Build a complete neural network with 3 layers"'));
  console.log(chalk.gray('  • "Create an entire ecosystem with food chains"'));
  console.log(chalk.gray('  • "Simulate a small village with economy"'));
  console.log(chalk.gray('  • "Model the entire solar system with all planets"\\n'));
  
  console.log(chalk.gray('Commands:'));
  console.log(chalk.gray('  • /continuous <task> - Build continuously with up to 100 steps'));
  console.log(chalk.gray('  • /unlimited <task> - Build with no step limit (careful!)'));
  console.log(chalk.gray('  • /inspect - Inspect the current world state'));
  console.log(chalk.gray('  • /clear - Start fresh with a new world'));
  console.log(chalk.gray('  • /exit - Exit the program\\n'));

  // Create the autonomous god
  let god = createAutonomousGod();
  
  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle special commands
    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed, god);
      rl.prompt();
      return;
    }

    // Process regular input with default 50 steps
    try {
      console.log(); // Add spacing
      await processAutonomousInput(god, trimmed);
      console.log(); // Add spacing after response
    } catch (error) {
      console.error(chalk.red('\\n❌ Error:', error));
    }
    
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.yellow('\\n\\nThe creation is complete. 🌟\\n'));
    process.exit(0);
  });
}

async function handleCommand(command: string, god: any) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  
  switch (cmd) {
    case '/continuous':
      if (!args) {
        console.log(chalk.red('\\n❌ Please provide a task after /continuous'));
        break;
      }
      console.log(chalk.cyan('\\n🔄 Continuous mode (100 steps max)...\\n'));
      try {
        await processAutonomousInput(god, args, { maxSteps: 100 });
      } catch (error) {
        console.error(chalk.red('\\n❌ Error:', error));
      }
      break;
      
    case '/unlimited':
      if (!args) {
        console.log(chalk.red('\\n❌ Please provide a task after /unlimited'));
        break;
      }
      console.log(chalk.yellow('\\n⚠️  Unlimited mode - the agent will build until done...'));
      console.log(chalk.yellow('Press Ctrl+C if it takes too long.\\n'));
      try {
        await processAutonomousInput(god, args, { maxSteps: 1000 });
      } catch (error) {
        console.error(chalk.red('\\n❌ Error:', error));
      }
      break;
    
    case '/inspect':
      console.log(chalk.cyan('\\n🔍 Inspecting world...\\n'));
      await processAutonomousInput(god, 'Please inspect the current world state and show me what exists.');
      break;
      
    case '/clear':
      console.log(chalk.yellow('\\n🌊 Creating new world...\\n'));
      god = createAutonomousGod();
      console.log(chalk.green('✨ A fresh world awaits your commands!\\n'));
      break;
      
    case '/exit':
    case '/quit':
      rl.close();
      break;
      
    default:
      console.log(chalk.red(`\\n❌ Unknown command: ${cmd}`));
      console.log(chalk.gray('Type a task or use /continuous <task> for extended building\\n'));
  }
}

// Run the CLI
main().catch(error => {
  console.error(chalk.red('Fatal error:', error));
  process.exit(1);
});