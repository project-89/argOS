#!/usr/bin/env node
/**
 * Terminal ASCII Visualization Demo
 * Shows any simulation in beautiful ASCII format
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import chalk from 'chalk';

async function terminalVisualizationDemo() {
  console.log(chalk.bold.green('\n🖥️  TERMINAL ASCII VISUALIZATION DEMO\n'));
  console.log(chalk.gray('Universal visualization for any ECS simulation'));
  console.log(chalk.gray('Works with spatial AND non-spatial simulations'));
  console.log(chalk.gray('─'.repeat(60)));
  
  const god = createAutonomousGod();
  
  // Start terminal visualization
  console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
  const termViz = startTerminalVisualization(god.world, {
    refreshRate: 2000, // 2 second updates
    maxEntities: 15,
    showThoughts: true,
    showSystems: true,
    compact: false
  });
  
  console.log(chalk.yellow('⏳ Creating simulation in 3 seconds...'));
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Create a non-spatial simulation (abstract concepts)
  await processAutonomousInput(god, `
    Create an abstract knowledge simulation with these components:
    
    1. Concept component with name, abstractness_level, and connection_strength
    2. Memory component with importance, recency, and emotional_weight  
    3. Thought component with content, complexity, and creativity_score
    
    Create entities representing abstract ideas:
    - Mathematics (high abstractness, strong connections)
    - Love (medium abstractness, high emotional weight) 
    - Programming (medium abstractness, high complexity)
    - Music (low abstractness, high creativity)
    
    Create a ThoughtEvolutionSystem that uses AI to evolve ideas over time.
  `);
  
  // Let it run for a bit
  console.log(chalk.green('\n✨ Simulation running! Watch the ASCII visualization above.'));
  console.log(chalk.cyan('The visualization shows:'));
  console.log('  👤 NPCs with AI consciousness');
  console.log('  🐾 Animals with behaviors');
  console.log('  👑 God entities');
  console.log('  📦 Objects and concepts');
  console.log('  💭 Recent AI thoughts');
  console.log('  🤖 LLM-powered systems');
  
  console.log(chalk.gray('\nThis works for ANY simulation - spatial or abstract!'));
  console.log(chalk.gray('Press Ctrl+C to stop'));
  
  // Keep the process alive
  process.on('SIGINT', () => {
    termViz.stop();
    console.log(chalk.yellow('\n\n👋 Terminal visualization stopped'));
    process.exit(0);
  });
  
  // Keep running
  setInterval(() => {}, 1000);
}

terminalVisualizationDemo().catch(console.error);