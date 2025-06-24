/**
 * Living Knowledge Graph Demo
 * Shows nested agent worlds, relationships, and dynamic knowledge
 */

import { createWorld, addEntity, addComponent, query } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsInspect } from '../actions/inspect.js';
import { ecsGenerateComponent } from '../actions/generate-component.js';
import { ecsGenerateRelationship, createRelationship, queryRelationship } from '../actions/generate-relationship.js';
import { 
  createAgentWorld, 
  addKnowledgeToAgent, 
  addAwareness, 
  shareKnowledge,
  getAgentAwareness 
} from '../actions/create-agent-world.js';
import { globalRegistry } from '../components/registry.js';
import { 
  getString,
  storeString 
} from '../components/god-components.js';

async function runKnowledgeGraphDemo() {
  console.log(chalk.bold.cyan('\n🧠 Living Knowledge Graph Demo\n'));
  
  // Create the God world
  const godWorld = createWorld();
  console.log(chalk.green('✓ Created God world'));
  
  // Create god agents
  const architect = createGodAgent(godWorld, GOD_PRESETS.ARCHITECT);
  const socialArchitect = createGodAgent(godWorld, GOD_PRESETS.SOCIAL_ARCHITECT);
  console.log(chalk.green('✓ Created The Architect and Concordia\n'));
  
  // Phase 1: Create fundamental components and relationships
  console.log(chalk.yellow('🔨 Phase 1: Creating knowledge graph components...\n'));
  
  // Create Person component
  await ecsGenerateComponent(godWorld, {
    description: 'A component representing a person with name, age, and profession',
    examples: ['A merchant named Bob', 'A warrior named Alice']
  }, architect);
  
  // Create Location component
  await ecsGenerateComponent(godWorld, {
    description: 'A component representing a location with name and type',
    examples: ['A tavern called The Prancing Pony', 'A forest called Darkwood']
  }, architect);
  
  // Create relationships
  const knowsResult = await ecsGenerateRelationship(godWorld, {
    description: 'Represents that one person knows another person',
    purpose: 'Track social connections and familiarity between people',
    cardinality: 'many-to-many',
    examples: [
      'Alice knows Bob from childhood',
      'Bob knows the tavern keeper professionally'
    ]
  }, socialArchitect);
  
  const livesInResult = await ecsGenerateRelationship(godWorld, {
    description: 'Represents that a person lives in a specific location',
    purpose: 'Track where people reside',
    cardinality: 'one-to-many',
    examples: [
      'Alice lives in the village',
      'The merchant family lives in the city'
    ]
  }, socialArchitect);
  
  const trustsResult = await ecsGenerateRelationship(godWorld, {
    description: 'Represents trust level between people',
    purpose: 'Track how much one person trusts another',
    cardinality: 'many-to-many',
    constraints: ['Trust level should be 0-100'],
    examples: [
      'Alice trusts Bob completely (100)',
      'Bob is suspicious of strangers (25)'
    ]
  }, socialArchitect);
  
  console.log(chalk.green(`✅ Created components and relationships\n`));
  
  // Phase 2: Create agent worlds (living knowledge graphs)
  console.log(chalk.yellow('🌍 Phase 2: Creating agent worlds...\n'));
  
  // Create Alice's world
  const aliceWorldResult = await createAgentWorld(godWorld, {
    agentName: 'Alice',
    purpose: 'A curious warrior who explores and meets people',
    initialKnowledge: [
      'I am a skilled warrior',
      'I live in a small village',
      'I enjoy exploring new places'
    ]
  }, architect);
  
  // Create Bob's world  
  const bobWorldResult = await createAgentWorld(godWorld, {
    agentName: 'Bob',
    purpose: 'A friendly merchant who trades and socializes',
    initialKnowledge: [
      'I am a merchant who sells goods',
      'I have a shop in the marketplace',
      'I enjoy meeting new customers'
    ]
  }, architect);
  
  console.log(chalk.green(`✅ Created agent worlds for Alice and Bob\n`));
  
  // Phase 3: Create entities in the God world
  console.log(chalk.yellow('👥 Phase 3: Creating entities in God world...\n'));
  
  // Create Alice in God world
  const aliceEid = addEntity(godWorld);
  const personComp = globalRegistry.getComponent('Person')?.component;
  const locationComp = globalRegistry.getComponent('Location')?.component;
  
  if (personComp) {
    addComponent(godWorld, aliceEid, personComp);
    // Set properties based on actual component structure
    const props = Object.keys(personComp);
    console.log(`Person component properties: ${props.join(', ')}`);
    
    if ('name' in personComp) personComp.name[aliceEid] = storeString('Alice');
    if ('age' in personComp) personComp.age[aliceEid] = 25;
    if ('profession' in personComp) personComp.profession[aliceEid] = storeString('Warrior');
  }
  
  // Create Bob in God world
  const bobEid = addEntity(godWorld);
  if (personComp) {
    addComponent(godWorld, bobEid, personComp);
    if ('name' in personComp) personComp.name[bobEid] = storeString('Bob');
    if ('age' in personComp) personComp.age[bobEid] = 35;
    if ('profession' in personComp) personComp.profession[bobEid] = storeString('Merchant');
  }
  
  // Create village location
  const villageEid = addEntity(godWorld);
  if (locationComp) {
    addComponent(godWorld, villageEid, locationComp);
    const locProps = Object.keys(locationComp);
    console.log(`Location component properties: ${locProps.join(', ')}`);
    
    if ('name' in locationComp) locationComp.name[villageEid] = storeString('Peaceful Village');
    if ('nameHash' in locationComp) locationComp.nameHash[villageEid] = storeString('Peaceful Village');
    if ('type' in locationComp) locationComp.type[villageEid] = storeString('settlement');
    if ('typeHash' in locationComp) locationComp.typeHash[villageEid] = storeString('settlement');
  }
  
  console.log(chalk.green(`✅ Created Alice, Bob, and Village entities\n`));
  
  // Phase 4: Create relationships in God world
  console.log(chalk.yellow('🔗 Phase 4: Creating relationships...\n'));
  
  if (knowsResult.success && livesInResult.success && trustsResult.success) {
    // Alice lives in the village
    createRelationship(godWorld, 'LivesIn', aliceEid, villageEid);
    
    // Bob lives in the village  
    createRelationship(godWorld, 'LivesIn', bobEid, villageEid);
    
    // Alice knows Bob
    createRelationship(godWorld, 'Knows', aliceEid, bobEid, { 
      familiarity: 60,
      duration: 365 
    });
    
    // Bob knows Alice
    createRelationship(godWorld, 'Knows', bobEid, aliceEid, {
      familiarity: 60, 
      duration: 365
    });
    
    // Alice trusts Bob moderately
    createRelationship(godWorld, 'TrustRelationship', aliceEid, bobEid, {
      trustLevel: 75
    });
    
    // Bob trusts Alice highly
    createRelationship(godWorld, 'TrustRelationship', bobEid, aliceEid, {
      trustLevel: 90
    });
  }
  
  console.log(chalk.green(`✅ Created relationships between entities\n`));
  
  // Phase 5: Populate agent worlds with their perspectives
  console.log(chalk.yellow('🧠 Phase 5: Adding knowledge to agent worlds...\n'));
  
  if (aliceWorldResult.success && bobWorldResult.success) {
    const aliceWorld = aliceWorldResult.world!;
    const bobWorld = bobWorldResult.world!;
    
    // In Alice's world, create her representation of Bob
    const bobInAlicesWorld = addEntity(aliceWorld);
    if (personComp) {
      addComponent(aliceWorld, bobInAlicesWorld, personComp);
      if ('name' in personComp) personComp.name[bobInAlicesWorld] = storeString('Bob');
      if ('age' in personComp) personComp.age[bobInAlicesWorld] = 35;
      if ('profession' in personComp) personComp.profession[bobInAlicesWorld] = storeString('Merchant');
    }
    
    // In Bob's world, create his representation of Alice
    const aliceInBobsWorld = addEntity(bobWorld);
    if (personComp) {
      addComponent(bobWorld, aliceInBobsWorld, personComp);
      if ('name' in personComp) personComp.name[aliceInBobsWorld] = storeString('Alice');
      if ('age' in personComp) personComp.age[aliceInBobsWorld] = 25;
      if ('profession' in personComp) personComp.profession[aliceInBobsWorld] = storeString('Warrior');
    }
    
    // Alice's knowledge about Bob
    addKnowledgeToAgent(aliceWorld, aliceWorldResult.agentEid!, {
      type: 'social',
      content: 'Bob is a reliable merchant who sells quality goods',
      confidence: 85,
      source: aliceWorldResult.agentEid!
    });
    
    addKnowledgeToAgent(aliceWorld, aliceWorldResult.agentEid!, {
      type: 'location',
      content: 'Bob has a shop in the village marketplace',
      confidence: 95,
      source: aliceWorldResult.agentEid!
    });
    
    // Bob's knowledge about Alice
    addKnowledgeToAgent(bobWorld, bobWorldResult.agentEid!, {
      type: 'social', 
      content: 'Alice is a brave warrior who protects the village',
      confidence: 90,
      source: bobWorldResult.agentEid!
    });
    
    addKnowledgeToAgent(bobWorld, bobWorldResult.agentEid!, {
      type: 'business',
      content: 'Alice sometimes buys weapons and armor from me',
      confidence: 100,
      source: bobWorldResult.agentEid!
    });
  }
  
  console.log(chalk.green(`✅ Populated agent worlds with knowledge\n`));
  
  // Phase 6: Demonstrate awareness and knowledge sharing
  console.log(chalk.yellow('🔄 Phase 6: Demonstrating knowledge dynamics...\n'));
  
  if (aliceWorldResult.success && bobWorldResult.success) {
    // Make Alice aware of Bob in the God world
    addAwareness(godWorld, aliceWorldResult.agentEid!, bobEid, 85, 'friend and merchant');
    
    // Make Bob aware of Alice in the God world  
    addAwareness(godWorld, bobWorldResult.agentEid!, aliceEid, 80, 'customer and protector');
    
    // Share knowledge between agents
    shareKnowledge(
      godWorld,
      aliceWorldResult.agentEid!,
      bobWorldResult.agentEid!,
      'There are bandits on the eastern road - merchants should be careful',
      95
    );
    
    shareKnowledge(
      godWorld,
      bobWorldResult.agentEid!,
      aliceWorldResult.agentEid!,
      'The blacksmith in the next town has rare metals for sale',
      85
    );
  }
  
  console.log(chalk.green(`✅ Knowledge shared between agents\n`));
  
  // Phase 7: Query and inspect the living knowledge graph
  console.log(chalk.yellow('🔍 Phase 7: Inspecting the knowledge graph...\n'));
  
  // Query relationships
  console.log(chalk.cyan('God World Relationships:'));
  const knowsRelations = queryRelationship('Knows');
  const trustsRelations = queryRelationship('TrustRelationship');
  queryRelationship('LivesIn');
  
  console.log(`  Knows relationships: ${knowsRelations.length}`);
  knowsRelations.forEach(rel => {
    const subjectName = personComp && 'name' in personComp ? getString(personComp.name[rel.subject]) : 'Unknown';
    const targetName = personComp && 'name' in personComp ? getString(personComp.name[rel.target]) : 'Unknown';
    console.log(`    ${subjectName} knows ${targetName} (familiarity: ${rel.properties.familiarity || 'N/A'})`);
  });
  
  console.log(`  Trust relationships: ${trustsRelations.length}`);
  trustsRelations.forEach(rel => {
    const subjectName = personComp && 'name' in personComp ? getString(personComp.name[rel.subject]) : 'Unknown';
    const targetName = personComp && 'name' in personComp ? getString(personComp.name[rel.target]) : 'Unknown';
    console.log(`    ${subjectName} trusts ${targetName} (level: ${rel.properties.trustLevel || 'N/A'})`);
  });
  
  // Show agent awareness
  if (aliceWorldResult.success && bobWorldResult.success) {
    console.log(chalk.cyan('\nAgent Awareness:'));
    
    const aliceAwareness = getAgentAwareness(aliceWorldResult.agentEid!);
    console.log(`  Alice is aware of ${aliceAwareness.length} entities:`);
    aliceAwareness.forEach(awareness => {
      const targetName = personComp && 'name' in personComp ? getString(personComp.name[awareness.target]) : 'Unknown';
      console.log(`    - ${targetName} (strength: ${awareness.strength}, context: ${awareness.context})`);
    });
    
    const bobAwareness = getAgentAwareness(bobWorldResult.agentEid!);
    console.log(`  Bob is aware of ${bobAwareness.length} entities:`);
    bobAwareness.forEach(awareness => {
      const targetName = personComp && 'name' in personComp ? getString(personComp.name[awareness.target]) : 'Unknown';
      console.log(`    - ${targetName} (strength: ${awareness.strength}, context: ${awareness.context})`);
    });
  }
  
  // Final statistics
  console.log(chalk.yellow('\n📊 Final Knowledge Graph Statistics:\n'));
  
  const worldInspection = await ecsInspect(godWorld, { target: 'world' }, architect);
  console.log(chalk.cyan('God World:'));
  console.log(`  ${worldInspection.summary}`);
  
  console.log(chalk.cyan('\nGenerated Architecture:'));
  console.log(`  Components: ${globalRegistry.listComponents().length}`);
  console.log(`  Relationships: ${globalRegistry.listRelationships().length}`);
  console.log(`  Systems: ${globalRegistry.listSystems().length}`);
  
  if (aliceWorldResult.success && bobWorldResult.success) {
    const aliceWorld = aliceWorldResult.world!;
    const bobWorld = bobWorldResult.world!;
    
    const aliceEntities = query(aliceWorld, []);
    const bobEntities = query(bobWorld, []);
    
    console.log(chalk.cyan('\nAgent Worlds:'));
    console.log(`  Alice's world: ${aliceEntities.length} entities`);
    console.log(`  Bob's world: ${bobEntities.length} entities`);
  }
  
  console.log(chalk.green('\n✅ Living Knowledge Graph demo complete!\n'));
  console.log(chalk.gray('This demonstrates:'));
  console.log(chalk.gray('  • Dynamic relationship generation'));
  console.log(chalk.gray('  • Nested agent worlds for personal knowledge'));
  console.log(chalk.gray('  • Multi-perspective reality (each agent has their own truth)'));
  console.log(chalk.gray('  • Knowledge sharing between agents'));
  console.log(chalk.gray('  • Awareness tracking and context'));
  console.log(chalk.gray('  • Living knowledge graph that evolves over time\n'));
}

// Run the demo
runKnowledgeGraphDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});