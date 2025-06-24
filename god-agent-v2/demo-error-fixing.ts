#!/usr/bin/env node
/**
 * Demo: God Agent Error Detection and Fixing
 * Shows how God can detect system errors and fix them automatically
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import chalk from 'chalk';

async function demonstrateErrorFixing() {
  console.log(chalk.bold.red('\n🔧 ERROR DETECTION AND FIXING DEMO\n'));
  console.log(chalk.gray('Demonstrating how God can detect and fix system errors'));
  console.log(chalk.gray('─'.repeat(60)));
  
  const god = createAutonomousGod();
  
  // Step 1: Create a simulation with an intentionally buggy system
  console.log(chalk.yellow('\n1. Creating a Simulation with a Buggy System\n'));
  
  await processAutonomousInput(god, `
    Create an NPC dialogue simulation:
    
    1. Create NPCMind component with personality and currentThought
    2. Create Dialogue component with text and active status
    3. Create Bob the philosopher with personality "deep thinker"
    
    Now create a BuggyDialogueSystem that uses LLM to generate dialogue,
    but intentionally has a bug where it uses 'prompt' as a variable name
    (which will conflict with the function parameter).
    
    The system should:
    - Query NPCs with NPCMind and Dialogue
    - Use AI to generate philosophical thoughts
    - BUT have the bug: const prompt = buildPrompt(...)
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Step 2: Try to run the buggy system
  console.log(chalk.yellow('2. Running the Buggy System (This Should Fail)\n'));
  
  await processAutonomousInput(god, `
    Run the BuggyDialogueSystem once to see what happens
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Step 3: Check for errors
  console.log(chalk.yellow('3. Checking for System Errors\n'));
  
  await processAutonomousInput(god, `
    Check if any systems have errors using checkSystemErrors
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Step 4: Fix the error
  console.log(chalk.yellow('4. God Fixes the Error Automatically\n'));
  
  await processAutonomousInput(god, `
    The BuggyDialogueSystem has an error. Use modifySystem to fix it.
    Look at the error message and fix the variable naming conflict.
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Step 5: Run the fixed system
  console.log(chalk.yellow('5. Running the Fixed System\n'));
  
  await processAutonomousInput(god, `
    Now run the BuggyDialogueSystem again to see if it works
  `);
  
  console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
  
  // Step 6: Create another error scenario
  console.log(chalk.yellow('6. Creating a Type Error Scenario\n'));
  
  await processAutonomousInput(god, `
    Create a MathSystem that has a type error:
    - It should try to add a string to a number
    - This will cause a runtime error
    
    Then run it, check for errors, and fix it.
  `);
  
  console.log(chalk.green('\n✨ Error Detection and Fixing Demo Complete!'));
  console.log(chalk.cyan('\nKey Concepts Demonstrated:'));
  console.log('  • System errors are captured and stored');
  console.log('  • God can check for errors with checkSystemErrors');
  console.log('  • modifySystem allows fixing bugs in existing systems');
  console.log('  • Errors include full stack traces for debugging');
  console.log('  • God learns from errors to write better code');
  console.log(chalk.gray('\nThis self-healing capability makes simulations more robust!'));
}

// Run the demonstration
demonstrateErrorFixing().catch(console.error);