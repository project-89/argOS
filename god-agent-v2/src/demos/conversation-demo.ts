/**
 * Agent Conversation Demo
 * Shows agents talking, thinking, and interacting
 */

import { createWorld, addComponent } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { 
  createAgentWorld,
  shareKnowledge
} from '../actions/create-agent-world.js';
import {
  talk,
  approach,
  lookAround,
  think,
  createTask
} from '../actions/agent-tools.js';
import { 
  Agent,
  storeString
} from '../components/god-components.js';
import { SystemRuntime } from '../runtime/system-executor.js';

async function runConversationDemo() {
  console.log(chalk.bold.cyan('\n💬 Agent Conversation Demo\n'));
  
  // Create the god world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create a social god
  const socialGod = createGodAgent(world, GOD_PRESETS.SOCIAL_ARCHITECT);
  console.log(chalk.green('✓ Created Concordia (Social Architect)\n'));
  
  // Create agents with their own worlds
  console.log(chalk.yellow('🧑‍🤝‍🧑 Creating agents...\n'));
  
  // Create Alice
  const aliceWorldResult = await createAgentWorld(world, {
    agentName: 'Alice',
    purpose: 'A curious explorer who loves meeting new people',
    initialKnowledge: [
      'I enjoy exploring new places',
      'I am friendly and outgoing',
      'I know about a secret treasure location'
    ]
  }, socialGod);
  
  // Create Bob  
  const bobWorldResult = await createAgentWorld(world, {
    agentName: 'Bob',
    purpose: 'A merchant looking for opportunities',
    initialKnowledge: [
      'I am a merchant seeking rare items',
      'I have connections in many towns',
      'I am always interested in treasures'
    ]
  }, socialGod);
  
  // Create Charlie
  const charlieWorldResult = await createAgentWorld(world, {
    agentName: 'Charlie',
    purpose: 'A scholar interested in knowledge',
    initialKnowledge: [
      'I study ancient civilizations',
      'I collect historical artifacts',
      'I enjoy intellectual conversations'
    ]
  }, socialGod);
  
  if (!aliceWorldResult.success || !bobWorldResult.success || !charlieWorldResult.success) {
    console.error(chalk.red('Failed to create agent worlds'));
    return;
  }
  
  const alice = aliceWorldResult.agentEid!;
  const bob = bobWorldResult.agentEid!;
  const charlie = charlieWorldResult.agentEid!;
  
  // Add names to agents
  addComponent(world, alice, Agent);
  Agent.nameHash[alice] = storeString('Alice');
  Agent.active[alice] = 1;
  
  addComponent(world, bob, Agent);
  Agent.nameHash[bob] = storeString('Bob');
  Agent.active[bob] = 1;
  
  addComponent(world, charlie, Agent);
  Agent.nameHash[charlie] = storeString('Charlie');
  Agent.active[charlie] = 1;
  
  console.log(chalk.green('✅ Created Alice, Bob, and Charlie\n'));
  
  // Create runtime for systems
  const runtime = new SystemRuntime(world);
  runtime.addSystem('TalkingSystem');
  runtime.addSystem('TargetingSystem');
  runtime.setTickRate(2); // Slow for demo visibility
  
  // Start the conversation simulation
  console.log(chalk.yellow('🎬 Starting conversation simulation...\n'));
  runtime.start();
  
  // Simulate a conversation sequence
  await simulateConversation();
  
  async function simulateConversation() {
    // Step 1: Alice looks around
    await delay(1000);
    console.log(chalk.magenta('\n--- Step 1: Alice looks around ---\n'));
    const { descriptions } = lookAround(world, { agentId: alice, radius: 100 });
    
    // Step 2: Alice thinks about what she sees
    await delay(1500);
    console.log(chalk.magenta('\n--- Step 2: Alice processes what she sees ---\n'));
    think(world, {
      agentId: alice,
      thought: `I see ${descriptions.length} people here. Maybe I should talk to them about the treasure.`,
      confidence: 75
    });
    
    // Step 3: Alice approaches Bob
    await delay(1500);
    console.log(chalk.magenta('\n--- Step 3: Alice approaches Bob ---\n'));
    approach(world, {
      agentId: alice,
      targetId: bob,
      reason: 'wants to talk about opportunities'
    });
    
    // Step 4: Alice talks to Bob
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 4: Alice talks to Bob ---\n'));
    talk(world, {
      agentId: alice,
      message: "Hi Bob! I heard you're a merchant. I know about something that might interest you.",
      targetId: bob
    });
    
    // Step 5: Bob thinks and responds
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 5: Bob processes and responds ---\n'));
    think(world, {
      agentId: bob,
      thought: "Alice seems to know about something valuable. I should listen carefully.",
      confidence: 85
    });
    
    talk(world, {
      agentId: bob,
      message: "Hello Alice! I'm always interested in new opportunities. What do you know about?",
      targetId: alice
    });
    
    // Step 6: Charlie overhears and approaches
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 6: Charlie overhears ---\n'));
    think(world, {
      agentId: charlie,
      thought: "They're talking about something interesting. As a scholar, I should investigate.",
      confidence: 70
    });
    
    approach(world, {
      agentId: charlie,
      targetId: alice,
      reason: 'overheard interesting conversation'
    });
    
    // Step 7: Alice shares knowledge
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 7: Alice shares her secret ---\n'));
    talk(world, {
      agentId: alice,
      message: "I discovered an ancient map that shows the location of a lost temple!"
    });
    
    // Share the knowledge between agents
    shareKnowledge(world, alice, bob, 
      "Ancient map location: Northern mountains, past the crystal lake", 90);
    shareKnowledge(world, alice, charlie, 
      "Ancient map location: Northern mountains, past the crystal lake", 90);
    
    // Step 8: Create a task
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 8: Planning an expedition ---\n'));
    
    talk(world, {
      agentId: bob,
      message: "This is amazing! We should organize an expedition. I can provide supplies."
    });
    
    talk(world, {
      agentId: charlie,
      message: "And I can research the history of this temple. This could be a significant discovery!"
    });
    
    createTask(world, 
      "Expedition to Lost Temple",
      "Organize a journey to the northern mountains to find the ancient temple",
      alice
    );
    
    // Step 9: Final thoughts
    await delay(2000);
    console.log(chalk.magenta('\n--- Step 9: Final thoughts ---\n'));
    
    think(world, {
      agentId: alice,
      thought: "I'm glad I shared this information. Together we can succeed!",
      confidence: 95
    });
    
    think(world, {
      agentId: bob,
      thought: "This could be the opportunity I've been waiting for.",
      confidence: 90
    });
    
    think(world, {
      agentId: charlie,
      thought: "The historical significance of this find could be immense!",
      confidence: 88
    });
    
    // End simulation
    await delay(3000);
    runtime.stop();
    
    console.log(chalk.yellow('\n📊 Conversation Summary:\n'));
    console.log(chalk.green('✅ Agents successfully:'));
    console.log('   - Looked around and noticed each other');
    console.log('   - Approached and engaged in conversation');
    console.log('   - Shared knowledge about a treasure');
    console.log('   - Created a collaborative task');
    console.log('   - Formed new relationships');
    
    console.log(chalk.green('\n✅ Agent conversation demo complete!\n'));
    console.log(chalk.gray('This demonstrates dynamic agent interactions with:'));
    console.log(chalk.gray('  • Natural conversation flow'));
    console.log(chalk.gray('  • Thinking and awareness'));
    console.log(chalk.gray('  • Knowledge sharing'));
    console.log(chalk.gray('  • Task creation'));
    console.log(chalk.gray('  • Multi-agent coordination\n'));
    
    process.exit(0);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runConversationDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});