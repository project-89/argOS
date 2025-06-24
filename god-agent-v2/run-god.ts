#!/usr/bin/env tsx
/**
 * God Agent V2 - Full Featured Runner
 * Combines web visualization with all CLI features
 */

import { createAutonomousGod, processAutonomousInput, AutonomousGodState } from './src/agents/autonomous-god.js';
import { startUniversalVisualization } from './src/visualization/universal-visualizer.js';
import { startTerminalVisualization, TerminalVisualizer } from './src/visualization/terminal-visualizer.js';
import { setModelOverride, getCurrentModel, modelNames, models } from './src/llm/model-selector.js';
import readline from 'readline';
import chalk from 'chalk';

async function runGod() {
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        GOD AGENT V2 - READY TO CREATE      ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════╝\n'));
  
  // Use Flash 2.5 by default for speed
  setModelOverride('flash25');
  console.log(chalk.yellow('⚡ Using Gemini 2.0 Flash for optimal speed\n'));
  
  let god = createAutonomousGod();
  let terminalViz: TerminalVisualizer | null = null;
  
  // Start web visualization on port 8081
  console.log(chalk.cyan('🌐 Starting web visualization...'));
  let webViz = startUniversalVisualization(god.world, 8081);
  
  // Update web viz frequently
  let updateInterval = setInterval(() => webViz.emitUpdate(), 500);
  
  console.log(chalk.green(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   📺 Open: http://localhost:8081                   ║
║                                                    ║
║   The visualizer adapts to any simulation type!   ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `));
  
  console.log(chalk.yellow('Commands:'));
  console.log(chalk.gray('  /inspect - Inspect the current world state'));
  console.log(chalk.gray('  /model [name] - Switch AI model or show current'));
  console.log(chalk.gray('  /live - Toggle live simulation mode'));
  console.log(chalk.gray('  /watch - Toggle terminal visualization'));
  console.log(chalk.gray('  /save <filename> - Save simulation to .godsim file'));
  console.log(chalk.gray('  /load <filename> - Load simulation from .godsim file'));
  console.log(chalk.gray('  /list - List available .godsim files'));
  console.log(chalk.gray('  /clear - Start fresh with a new world'));
  console.log(chalk.gray('  /ui - Generate custom UI for your simulation'));
  console.log(chalk.gray('  /help - Show this help message'));
  console.log(chalk.gray('  /exit - Exit the program\n'));
  
  console.log(chalk.cyan('Examples to try:'));
  console.log(chalk.gray('  • Create 5 bouncing particles with physics'));
  console.log(chalk.gray('  • Build a chat room with 3 NPCs that talk to each other'));
  console.log(chalk.gray('  • Simulate neurons firing in a simple brain'));
  console.log(chalk.gray('  • Create a text adventure game with 3 rooms\n'));
  
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
    
    // Handle commands
    if (trimmed.startsWith('/')) {
      const result = await handleCommand(trimmed, god, webViz, terminalViz);
      if (result.god) god = result.god;
      if (result.webViz) webViz = result.webViz;
      if (result.terminalViz !== undefined) terminalViz = result.terminalViz;
      rl.prompt();
      return;
    }
    
    // Process with God
    try {
      console.log();
      await processAutonomousInput(god, trimmed);
      console.log();
      webViz.emitUpdate();
    } catch (error: any) {
      if (error.message?.includes('unregistered callers')) {
        console.error(chalk.red('\n❌ API Key Error: Please check your .env file'));
        console.log(chalk.yellow('Make sure GOOGLE_GENERATIVE_AI_API_KEY is set\n'));
      } else {
        console.error(chalk.red('\n❌ Error:', error.message || error));
      }
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    if (terminalViz) {
      terminalViz.stop();
    }
    webViz.stop();
    console.log(chalk.yellow('\n\n✨ Thanks for creating! Goodbye!\n'));
    process.exit(0);
  });
  
  async function handleCommand(command: string, currentGod: AutonomousGodState, viz: any, tViz: TerminalVisualizer | null): Promise<{god?: AutonomousGodState, webViz?: any, terminalViz?: TerminalVisualizer | null}> {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    switch (cmd) {
      case '/inspect':
        console.log(chalk.cyan('\n🔍 Inspecting world...\n'));
        await processAutonomousInput(currentGod, 'Please inspect the current world state and show me what exists.');
        return {};
      
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
        return {};
      
      case '/live':
        console.log(chalk.cyan('\n🔄 Toggling live mode...\n'));
        await processAutonomousInput(currentGod, 'Toggle live simulation mode. If it\'s off, turn it on. If it\'s on, turn it off.');
        return {};
      
      case '/watch':
        if (tViz) {
          tViz.stop();
          console.log(chalk.yellow('\n📺 Stopped terminal visualization\n'));
          return { terminalViz: null };
        } else {
          console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
          console.log(chalk.gray('(This will take over your terminal. Press Ctrl+C to return to CLI)\n'));
          const newTerminalViz = startTerminalVisualization(currentGod.world, {
            refreshRate: 500,
            showSystems: true,
            showThoughts: true,
            compact: false
          });
          return { terminalViz: newTerminalViz };
        }
      
      case '/save':
        if (args.length === 0) {
          console.log(chalk.red('\n❌ Please provide a filename: /save <filename>\n'));
          return {};
        }
        console.log(chalk.cyan(`\n💾 Saving simulation to ${args[0]}...\n`));
        await processAutonomousInput(currentGod, `Save the current simulation to "${args[0]}".godsim with name "${args[0]}" and description "User-created simulation"`);
        return {};
      
      case '/load':
        if (args.length === 0) {
          console.log(chalk.red('\n❌ Please provide a filename: /load <filename>\n'));
          return {};
        }
        try {
          const { SimulationRuntime } = await import('./src/runtime/simulation-runtime.js');
          const runtime = new SimulationRuntime();
          await runtime.loadFromFile(args[0]);
          console.log(chalk.green(`\n✅ Simulation loaded from ${args[0]}`));
          console.log(chalk.yellow('Note: This loads into a separate runtime. Use /clear and rebuild to modify.\n'));
        } catch (error) {
          console.log(chalk.red(`\n❌ Failed to load ${args[0]}: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
        }
        return {};
      
      case '/list':
        try {
          const { SimulationSerializer } = await import('./src/persistence/simulation-serializer.js');
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
        return {};
        
      case '/clear':
        console.log(chalk.yellow('\n🌊 Creating new world...\n'));
        
        // Stop the old web visualizer
        webViz.stop();
        clearInterval(updateInterval);
        
        // Create new god
        god = createAutonomousGod();
        
        // Start new web visualizer with the new world
        webViz = startUniversalVisualization(god.world, 8081);
        
        // Update the interval reference
        updateInterval = setInterval(() => webViz.emitUpdate(), 500);
        
        console.log(chalk.green('✨ A fresh world awaits your commands!\n'));
        return { god: god, webViz: webViz };
      
      case '/ui':
        console.log(chalk.yellow('\n🎨 To generate custom UI, tell me what kind of UI you want!'));
        console.log(chalk.gray('Example: "Generate a particle visualization UI with trails"'));
        console.log(chalk.gray('Example: "Create an interactive game UI with health bars"\n'));
        return {};
      
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
        console.log(chalk.gray('  • /inspect - See what exists in the world'));
        console.log(chalk.gray('  • /model [name] - Switch AI model'));
        console.log(chalk.gray('  • /live - Toggle live mode (systems run continuously)'));
        console.log(chalk.gray('  • /watch - Toggle terminal visualization'));
        console.log(chalk.gray('  • /save <name> - Save current simulation'));
        console.log(chalk.gray('  • /load <name> - Load saved simulation'));
        console.log(chalk.gray('  • /list - Show available simulations'));
        console.log(chalk.gray('  • /clear - Start with a fresh world'));
        console.log(chalk.gray('  • /ui - Generate custom UI'));
        console.log(chalk.gray('  • /help - Show this help'));
        console.log(chalk.gray('  • /exit - Exit the program\n'));
        return {};
      
      case '/exit':
      case '/quit':
        rl.close();
        return {};
        
      default:
        console.log(chalk.red(`\n❌ Unknown command: ${cmd}`));
        console.log(chalk.gray('Type /help for available commands\n'));
        return {};
    }
  }
}

runGod().catch(console.error);