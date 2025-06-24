#!/usr/bin/env node
/**
 * How LLM Systems Work - Step by Step Explanation
 */

import chalk from 'chalk';

console.log(chalk.bold.cyan('\n🧠 HOW LLM-POWERED SYSTEMS WORK\n'));

console.log(chalk.yellow('1. God Creates the System Structure'));
console.log(chalk.gray('   When you ask God to create an LLM-powered system, it generates code like this:\n'));

console.log(chalk.white(`
// Example: God generates this NPCConsciousnessSystem
async function NPCConsciousnessSystem(world) {
  // 1. Query for entities with the right components
  const npcs = query(world, [NPCMind, Position, Dialogue]);
  
  for (const npc of npcs) {
    // 2. Gather context from ECS components
    const personality = getString(NPCMind.personality[npc]);
    const memories = getString(NPCMind.memoryBank[npc]);
    const location = \`x:\${Position.x[npc]}, y:\${Position.y[npc]}\`;
    const nearbyEntities = findNearby(world, npc, 100);
    
    // 3. Construct AI prompt with context
    const prompt = \`
You are \${personality}.
Your memories: \${memories}
Your location: \${location}
You see: \${describeEntities(nearbyEntities)}

Generate a JSON response with:
{
  "thought": "what you're thinking",
  "action": "what you want to do",
  "speech": "what you say out loud"
}
    \`;
    
    // 4. Call the mini-LLM (Gemini Flash)
    const response = await miniLLM(prompt);
    
    // 5. Parse and apply AI decision
    try {
      const decision = JSON.parse(response);
      
      // Update ECS components based on AI
      NPCMind.lastThought[npc] = setString(decision.thought);
      NPCMind.currentGoal[npc] = setString(decision.action);
      Dialogue.text[npc] = setString(decision.speech);
      Dialogue.active[npc] = decision.speech ? 1 : 0;
      
    } catch (error) {
      console.error(\`NPC \${npc} AI error:\`, error);
    }
  }
}
`));

console.log(chalk.yellow('\n2. The Runtime Execution'));
console.log(chalk.gray('   When the system runs, here\'s what happens:\n'));

console.log(chalk.cyan('   Step 1: World Query'));
console.log(chalk.gray('   • System finds all entities with NPCMind + Position + Dialogue'));
console.log(chalk.gray('   • Each entity represents an individual NPC\n'));

console.log(chalk.cyan('   Step 2: Context Gathering'));
console.log(chalk.gray('   • Read personality from NPCMind.personality[npc]'));
console.log(chalk.gray('   • Get memories from NPCMind.memoryBank[npc]'));
console.log(chalk.gray('   • Check position and find nearby entities'));
console.log(chalk.gray('   • Build complete situational awareness\n'));

console.log(chalk.cyan('   Step 3: AI Reasoning'));
console.log(chalk.gray('   • Construct prompt with personality + situation'));
console.log(chalk.gray('   • Call miniLLM() (Gemini Flash) for fast response'));
console.log(chalk.gray('   • AI generates thoughts/actions based on context\n'));

console.log(chalk.cyan('   Step 4: State Update'));
console.log(chalk.gray('   • Parse AI response (JSON format)'));
console.log(chalk.gray('   • Update ECS components with new thoughts/goals'));
console.log(chalk.gray('   • NPC behavior changes based on AI decision\n'));

console.log(chalk.yellow('3. The Magic: Multiple Intelligence Levels'));
console.log(chalk.white(`
God Agent (Gemini 2.5 Pro)     → Creates the system architecture
     ↓
NPC System (Gemini Flash)      → Individual NPC consciousness  
     ↓
Alice: "I'm curious about..."  → Unique personality-driven thoughts
Bob: "That anvil needs work"   → Individual goals and reactions
Sarah: "Perhaps you should..." → Contextual advice and wisdom
`));

console.log(chalk.yellow('\n4. Key Advantages'));
console.log(chalk.green('   ✓ True Autonomy: NPCs make genuine AI decisions'));
console.log(chalk.green('   ✓ Emergent Behavior: Unpredictable but coherent interactions'));
console.log(chalk.green('   ✓ Scalable: Use fast models for many entities'));
console.log(chalk.green('   ✓ Contextual: AI sees the full ECS world state'));
console.log(chalk.green('   ✓ Persistent: Decisions update permanent component data'));

console.log(chalk.yellow('\n5. Example Interaction Flow'));
console.log(chalk.white(`
Time Step 1:
• Alice (curious baker): AI thinks "I wonder what Bob is making"
• Bob (grumpy smith): AI thinks "Need to focus on this horseshoe" 
• Sarah (wise merchant): AI thinks "These two should meet"

Time Step 2:  
• Alice: AI decides to walk toward Bob's shop
• Bob: AI notices Alice approaching, decides to greet
• Sarah: AI sees potential for interesting interaction

Time Step 3:
• Alice: "Good morning Bob! What are you working on?"
• Bob: "Just a horseshoe... though it's giving me trouble"
• Sarah: AI generates idea to suggest Alice's baking skills
`));

console.log(chalk.cyan('\n💡 The key insight: We\'re not scripting behaviors - we\'re giving entities'));
console.log(chalk.cyan('   genuine AI consciousness that reasons about their world!'));

console.log(chalk.gray('\n' + '─'.repeat(60)));
console.log(chalk.magenta('This is what "extracting simulations from LLM latent space" means:'));
console.log(chalk.white('We\'re materializing the compressed knowledge of human behavior,'));
console.log(chalk.white('social dynamics, and storytelling into executable, living worlds.'));