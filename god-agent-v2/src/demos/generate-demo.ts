/**
 * Component Generation Demo
 * Shows god agents creating new components
 */

import { createWorld } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsInspect } from '../actions/inspect.js';
import { 
  ecsGenerateComponent, 
  createEntityWithComponent 
} from '../actions/generate-component.js';
import { globalRegistry } from '../components/registry.js';
import { GodMode } from '../components/god-components.js';

async function runGenerationDemo() {
  console.log(chalk.bold.cyan('\n🔨 God Agent Component Generation Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create the architect god
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  console.log(chalk.green('✓ Created The Architect\n'));
  
  // Generate a Health component
  console.log(chalk.yellow('🔨 The Architect creates a Health component...\n'));
  
  const healthResult = await ecsGenerateComponent(world, {
    description: 'A component to track entity health, including current HP, maximum HP, and regeneration rate',
    constraints: [
      'Health should not go below 0',
      'Current health should not exceed maximum',
      'Regeneration rate can be negative (for poison/bleeding)'
    ],
    examples: [
      'A player with 100/100 HP regenerating 1 HP per second',
      'A wounded enemy with 45/75 HP',
      'A poisoned creature losing 2 HP per second'
    ]
  }, architect);
  
  if (healthResult.success) {
    console.log(chalk.green(`✅ Successfully created ${healthResult.componentName}!`));
    if (healthResult.design) {
      console.log(chalk.cyan('\nComponent Design:'));
      console.log(`  Name: ${healthResult.design.name}`);
      console.log(`  Description: ${healthResult.design.description}`);
      console.log(`  Reasoning: ${healthResult.design.reasoning}`);
      console.log(`\n  Properties:`);
      healthResult.design.properties.forEach(prop => {
        console.log(`    - ${prop.name} (${prop.type}): ${prop.description}`);
      });
    }
  } else {
    console.log(chalk.red(`❌ Failed to create Health component: ${healthResult.error}`));
  }
  
  // Generate a Position component
  console.log(chalk.yellow('\n🔨 The Architect creates a Position component...\n'));
  
  const positionResult = await ecsGenerateComponent(world, {
    description: 'A component for 2D positioning in the world, with x and y coordinates',
    examples: [
      'An entity at the origin (0, 0)',
      'A moving object at (150.5, -75.3)',
      'Multiple entities sharing the same position'
    ]
  }, architect);
  
  if (positionResult.success) {
    console.log(chalk.green(`✅ Successfully created ${positionResult.componentName}!`));
  }
  
  // Generate a more complex component
  console.log(chalk.yellow('\n🔨 The Architect creates a Relationship component...\n'));
  
  const relationshipResult = await ecsGenerateComponent(world, {
    description: 'A component to track social relationships between entities, including trust level, relationship type, and interaction history',
    constraints: [
      'Trust level should be between -100 and 100',
      'Relationship types could include: friend, enemy, neutral, family, romantic',
      'Should track when the relationship was formed'
    ]
  }, architect);
  
  if (relationshipResult.success) {
    console.log(chalk.green(`✅ Successfully created ${relationshipResult.componentName}!`));
  }
  
  // Inspect the newly created components
  console.log(chalk.yellow('\n🔍 Inspecting created components...\n'));
  
  const componentInspection = await ecsInspect(world, {
    target: 'components',
    detailed: true
  }, architect);
  
  console.log(chalk.cyan('Registered Components:'));
  componentInspection.data.forEach((comp: any) => {
    console.log(`\n  ${comp.name}:`);
    console.log(`    Description: ${comp.description}`);
    console.log(`    Properties: ${comp.propertyCount}`);
    console.log(`    Created: ${new Date(comp.timestamp).toLocaleString()}`);
    if (comp.properties) {
      console.log('    Details:');
      comp.properties.forEach((prop: any) => {
        console.log(`      - ${prop.name} (${prop.type}): ${prop.description}`);
      });
    }
  });
  
  // Create entities using the new components
  if (healthResult.success && positionResult.success) {
    console.log(chalk.yellow('\n🎯 Creating entities with new components...\n'));
    
    const entity1 = createEntityWithComponent(world, healthResult.componentName!, {
      current: 100,
      max: 100,
      regeneration: 1
    });
    
    if (entity1 !== null) {
      console.log(chalk.green(`✅ Created entity ${entity1} with ${healthResult.componentName}`));
      
      // Also add position
      const posComp = globalRegistry.getComponent(positionResult.componentName!);
      if (posComp) {
        const entity2 = createEntityWithComponent(world, positionResult.componentName!, {
          x: 50,
          y: 75
        });
        console.log(chalk.green(`✅ Created entity ${entity2} with ${positionResult.componentName}`));
      }
    }
  }
  
  // Show god statistics
  console.log(chalk.yellow('\n📊 God Statistics:\n'));
  console.log(`  The Architect:`);
  console.log(`    Level: ${GodMode.level[architect]}`);
  console.log(`    Components Created: ${GodMode.createdCount[architect]}`);
  
  // Final world state
  console.log(chalk.yellow('\n🌍 Final World State:\n'));
  const finalInspection = await ecsInspect(world, { target: 'world' }, architect);
  console.log(`  ${finalInspection.summary}`);
  
  console.log(chalk.green('\n✅ Component generation demo complete!\n'));
}

// Run the demo
runGenerationDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});