#!/usr/bin/env node
/**
 * Simulation Player
 * Standalone runtime for playing .godsim files
 */

import chalk from 'chalk';
import { SimulationRuntime } from './runtime/simulation-runtime.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.bold.cyan('\n🎮 SIMULATION PLAYER\n'));
    console.log(chalk.yellow('Usage:'));
    console.log(chalk.gray('  npm run play <simulation.godsim>'));
    console.log(chalk.gray('  npx tsx src/player.ts <simulation.godsim>\n'));
    
    console.log(chalk.yellow('Available commands once loaded:'));
    console.log(chalk.gray('  start  - Start the simulation'));
    console.log(chalk.gray('  stop   - Stop the simulation'));
    console.log(chalk.gray('  step   - Execute one step'));
    console.log(chalk.gray('  reset  - Reset to initial state'));
    console.log(chalk.gray('  stats  - Show simulation stats'));
    console.log(chalk.gray('  query <components> - Find entities'));
    console.log(chalk.gray('  exit   - Exit player\n'));
    
    // List available simulations
    try {
      const { SimulationSerializer } = await import('./persistence/simulation-serializer.js');
      const files = await SimulationSerializer.list('.');
      if (files.length > 0) {
        console.log(chalk.cyan('Available simulations:'));
        files.forEach(file => console.log(`  📄 ${file}`));
        console.log();
      }
    } catch {
      // Ignore error
    }
    
    process.exit(0);
  }
  
  const filename = args[0];
  console.log(chalk.bold.cyan(`\n🎮 LOADING SIMULATION: ${filename}\n`));
  
  try {
    const runtime = new SimulationRuntime();
    await runtime.loadFromFile(filename);
    
    console.log(chalk.green('\n✅ Simulation loaded successfully!'));
    console.log(chalk.yellow('Type "help" for commands, "start" to begin, or "exit" to quit.\n'));
    
    // Interactive command loop
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('player> ')
    });
    
    rl.prompt();
    
    rl.on('line', async (input) => {
      const trimmed = input.trim().toLowerCase();
      const parts = trimmed.split(' ');
      const command = parts[0];
      const args = parts.slice(1);
      
      switch (command) {
        case 'start':
          runtime.start();
          console.log(chalk.green('🚀 Simulation started!'));
          break;
          
        case 'stop':
          runtime.stop();
          console.log(chalk.yellow('⏹️  Simulation stopped.'));
          break;
          
        case 'step':
          runtime.step();
          break;
          
        case 'reset':
          runtime.reset();
          break;
          
        case 'stats':
          const stats = runtime.getWorldStats();
          console.log(chalk.cyan('\n📊 Simulation Stats:'));
          console.log(`   Components: ${stats.componentCount}`);
          console.log(`   Systems: ${stats.systemCount}`);
          console.log(`   Running: ${stats.isRunning ? '✅' : '❌'}`);
          console.log(`   Tick Rate: ${stats.tickRate} FPS\n`);
          break;
          
        case 'components':
          const components = runtime.listComponents();
          console.log(chalk.cyan('\n📦 Components:'));
          components.forEach(comp => console.log(`   - ${comp}`));
          console.log();
          break;
          
        case 'systems':
          const systems = runtime.listSystems();
          console.log(chalk.cyan('\n⚙️  Systems:'));
          systems.forEach(sys => console.log(`   - ${sys}`));
          console.log();
          break;
          
        case 'query':
          if (args.length === 0) {
            console.log(chalk.red('Usage: query <component1> [component2] ...'));
            break;
          }
          try {
            const entities = runtime.queryEntities(args);
            console.log(chalk.cyan(`\n🔍 Found ${entities.length} entities with [${args.join(', ')}]:`));
            entities.slice(0, 10).forEach(eid => console.log(`   Entity ${eid}`));
            if (entities.length > 10) {
              console.log(`   ... and ${entities.length - 10} more`);
            }
            console.log();
          } catch (error) {
            console.log(chalk.red(`Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
          break;
          
        case 'help':
          console.log(chalk.yellow('\n📖 Available Commands:'));
          console.log(chalk.gray('  start      - Start the simulation loop'));
          console.log(chalk.gray('  stop       - Stop the simulation loop'));
          console.log(chalk.gray('  step       - Execute one simulation step'));
          console.log(chalk.gray('  reset      - Reset simulation to initial state'));
          console.log(chalk.gray('  stats      - Show simulation statistics'));
          console.log(chalk.gray('  components - List all components'));
          console.log(chalk.gray('  systems    - List all systems'));
          console.log(chalk.gray('  query <c1> [c2] - Find entities with components'));
          console.log(chalk.gray('  exit       - Exit the player\n'));
          break;
          
        case 'exit':
        case 'quit':
          runtime.stop();
          console.log(chalk.yellow('\nExiting simulation player. Goodbye! 👋\n'));
          process.exit(0);
          break;
          
        case '':
          // Empty input, just re-prompt
          break;
          
        default:
          console.log(chalk.red(`Unknown command: ${command}. Type "help" for available commands.`));
      }
      
      rl.prompt();
    });
    
    rl.on('close', () => {
      runtime.stop();
      console.log(chalk.yellow('\nGoodbye! 👋\n'));
      process.exit(0);
    });
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to load simulation: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    process.exit(1);
  }
}

main();