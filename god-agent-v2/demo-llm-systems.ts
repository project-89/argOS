#!/usr/bin/env node
/**
 * Demo: LLM-Powered Systems - Meta-Cognitive Architecture
 * Shows how God can create systems that themselves use AI
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function demonstrateLLMSystems() {
  console.log(chalk.bold.magenta('\n🧠 LLM-POWERED SYSTEMS DEMONSTRATION\n'));
  console.log(chalk.gray('Demonstrating meta-cognitive architecture where God creates AI-powered systems'));
  console.log(chalk.gray('─'.repeat(60)));
  
  const god = createAutonomousGod();
  
  // Demo 1: Create a living village with AI-powered NPCs
  console.log(chalk.yellow('\n1. Creating a Living Village with Conscious NPCs\n'));
  
  await processAutonomousInput(god, `
    Create a village simulation where each villager has AI-driven consciousness.
    
    First, create these components:
    - NPCMind with personality, currentGoal, memoryBank, lastThought properties
    - Position with x, y coordinates
    - Dialogue with text and active properties
    - Relationship with type and strength
    
    Then create 3 villagers:
    - Alice: a curious baker who loves gossip
    - Bob: a grumpy blacksmith who secretly writes poetry  
    - Sarah: a wise merchant who gives advice
    
    Finally, create an NPCConsciousnessSystem that uses AI to:
    - Let each NPC think about their situation
    - Decide what to say based on personality
    - Remember past interactions
    - Form opinions about other NPCs
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Demo 2: Run the consciousness system
  console.log(chalk.yellow('2. Running the Village Consciousness\n'));
  
  await processAutonomousInput(god, `
    Run the NPCConsciousnessSystem 5 times and show me what the villagers are thinking and saying
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Demo 3: Create an adaptive ecosystem
  console.log(chalk.yellow('3. Creating an Adaptive AI Ecosystem\n'));
  
  await processAutonomousInput(god, `
    Create an ecosystem where animals use AI to adapt their behavior.
    
    Create these components:
    - AnimalMind with species, hunger, fear, curiosity levels
    - Behavior with currentAction and motivation
    
    Create some animals: rabbits, wolves, and birds
    
    Then create an AnimalBehaviorSystem that uses AI to:
    - Analyze the animal's current state
    - Consider nearby threats and opportunities
    - Choose appropriate behaviors (flee, hunt, explore, rest)
    - Learn from outcomes over time
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Demo 4: Meta-level AI coordination
  console.log(chalk.yellow('4. Creating a Director AI System\n'));
  
  await processAutonomousInput(god, `
    Create a StoryDirectorSystem that uses AI to:
    - Monitor all NPCs and animals
    - Identify interesting potential interactions
    - Subtly influence behaviors to create dramatic moments
    - Ensure narrative coherence across the simulation
    
    This is a meta-AI that orchestrates other AIs!
  `);
  
  console.log(chalk.green('\n✨ LLM-Powered Systems Demonstration Complete!'));
  console.log(chalk.cyan('\nKey Concepts Demonstrated:'));
  console.log('  • NPCs with AI-driven consciousness and decision-making');
  console.log('  • Animals that adapt behavior using AI reasoning');
  console.log('  • Meta-level AI systems that coordinate other AI systems');
  console.log('  • Emergent narratives from AI interactions');
  console.log(chalk.gray('\nThis shows how we can extract living simulations from LLM latent space!'));
}

// Run the demonstration
demonstrateLLMSystems().catch(console.error);