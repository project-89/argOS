#!/usr/bin/env node
/**
 * Visualization Demo - Show LLM-powered simulation with real-time visualization
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { startVisualizationServer, getVisualizationServer } from './src/visualization/visualization-server.js';
import chalk from 'chalk';

async function demonstrateVisualization() {
  console.log(chalk.bold.magenta('\n🎨 VISUALIZATION DEMONSTRATION\n'));
  console.log(chalk.gray('Creating a living simulation with real-time visualization'));
  console.log(chalk.gray('─'.repeat(60)));
  
  const god = createAutonomousGod();
  
  // Start visualization server
  console.log(chalk.cyan('\n🖥️  Starting visualization server...'));
  const vizServer = startVisualizationServer(god.world, 8080);
  
  console.log(chalk.green(`✨ Visualization available at: http://localhost:8080`));
  console.log(chalk.yellow('   Open this URL in your browser to see the simulation!'));
  
  console.log(chalk.yellow('\n1. Creating Visual Components\n'));
  
  // Create components that are good for visualization
  await processAutonomousInput(god, `
    Create these components for visualization:
    
    1. Position component with x, y coordinates
    2. NPCMind component with personality, thoughts, and emotions
    3. Dialogue component with text and active status
    4. Movement component with velocity and destination
    
    Make sure Position uses clear x,y properties for easy visualization.
  `);
  
  console.log(chalk.yellow('\n2. Creating Visual Entities\n'));
  
  await processAutonomousInput(god, `
    Create 5 interesting NPCs with distinct personalities and positions:
    
    1. Alice the Baker at position (100, 100) - curious and friendly
    2. Bob the Blacksmith at position (300, 150) - grumpy but skilled  
    3. Sarah the Merchant at position (200, 200) - wise and helpful
    4. Tom the Farmer at position (400, 300) - hardworking and simple
    5. Luna the Scholar at position (150, 350) - intellectual and mysterious
    
    Give each NPC different personality traits and starting thoughts.
  `);
  
  console.log(chalk.yellow('\n3. Creating AI-Powered Movement System\n'));
  
  await processAutonomousInput(god, `
    Create a MovementSystem that uses AI to decide where NPCs should move.
    The system should:
    - Look at NPC personality and current thoughts
    - Consider nearby NPCs and interesting locations
    - Use AI to decide if they should move toward someone or somewhere
    - Update Position based on AI decisions
    - Make movement smooth and realistic
  `);
  
  console.log(chalk.yellow('\n4. Creating Conversation System\n'));
  
  await processAutonomousInput(god, `
    Create a ConversationSystem that uses AI for natural dialogue.
    When NPCs are near each other, they should:
    - Use AI to decide if they want to talk
    - Generate contextual greetings and responses
    - Consider their personality and relationship
    - Update Dialogue components with AI-generated speech
    - Remember conversations in their thoughts
  `);
  
  // Start emitting visualization events
  console.log(chalk.yellow('\n5. Starting Live Simulation\n'));
  
  // Emit world updates for visualization
  const updateVisualization = () => {
    const vizServer = getVisualizationServer();
    if (vizServer) {
      vizServer.emitWorldUpdate();
    }
  };
  
  // Start the live simulation
  await processAutonomousInput(god, `
    Start live mode with 2 FPS so we can watch the NPCs move and think.
  `);
  
  // Update visualization periodically
  console.log(chalk.green('\n✨ Simulation running with visualization!'));
  console.log(chalk.cyan(`
🎨 Visualization Features:
   • Real-time entity positions and movements
   • AI thought bubbles above NPCs
   • System execution indicators
   • Live conversation display
   • Entity relationship networks

🔥 What you'll see:
   • NPCs moving around based on AI decisions
   • Thought bubbles showing AI reasoning
   • Dynamic conversations between characters
   • Real-time system performance metrics
   
Open http://localhost:8080 in your browser to explore!
  `));
  
  // Keep updating visualization
  setInterval(updateVisualization, 500);
  
  console.log(chalk.gray('\nPress Ctrl+C to stop the simulation and visualization server'));
  
  // Keep the process alive
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n👋 Stopping visualization demo...'));
    process.exit(0);
  });
}

// Run the demonstration
demonstrateVisualization().catch(console.error);