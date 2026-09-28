/**
 * System Generation Demo
 * Shows god agents creating new systems
 */

import { createWorld, addEntity, addComponent } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsInspect } from '../actions/inspect.js';
import { 
  ecsGenerateComponent
} from '../actions/generate-component.js';
import {
  ecsGenerateSystem,
  executeDynamicSystem
} from '../actions/generate-system.js';
import { globalRegistry } from '../components/registry.js';
import { GodMode } from '../components/god-components.js';

async function runSystemDemo() {
  console.log(chalk.bold.cyan('\n⚙️ God Agent System Generation Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create the architect god
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  console.log(chalk.green('✓ Created The Architect\n'));
  
  // First, create some components
  console.log(chalk.yellow('🔨 Creating components for the system...\n'));
  
  // Create Position component
  const positionResult = await ecsGenerateComponent(world, {
    description: 'A 2D position component with x and y coordinates',
    examples: ['Entity at origin (0,0)', 'Entity at (100, 200)']
  }, architect);
  
  // Create Velocity component
  const velocityResult = await ecsGenerateComponent(world, {
    description: 'A 2D velocity component with x and y speed values',
    examples: ['Entity moving right at 5 units/sec', 'Entity falling at -10 units/sec']
  }, architect);
  
  if (!positionResult.success || !velocityResult.success) {
    console.error(chalk.red('Failed to create required components'));
    return;
  }
  
  console.log(chalk.green(`✅ Created ${positionResult.componentName} and ${velocityResult.componentName}\n`));
  
  // Now create a Movement system
  console.log(chalk.yellow('⚙️ The Architect creates a Movement system...\n'));
  
  const movementResult = await ecsGenerateSystem(world, {
    description: 'A system that updates entity positions based on their velocities',
    requiredComponents: ['Position', 'Velocity'],
    behavior: 'For each entity with Position and Velocity, add the velocity to the position each frame',
    constraints: [
      'Should handle delta time if provided',
      'Position updates should be applied after velocity calculation'
    ],
    examples: [
      'Entity at (0,0) with velocity (1,0) moves to (1,0)',
      'Entity at (10,10) with velocity (-2,3) moves to (8,13)'
    ]
  }, architect);
  
  if (movementResult.success) {
    console.log(chalk.green(`✅ Successfully created ${movementResult.systemName}!`));
    console.log(chalk.cyan('\nGenerated Code:'));
    console.log(chalk.gray(movementResult.code));
  } else {
    console.log(chalk.red(`❌ Failed to create Movement system: ${movementResult.error}`));
  }
  
  // Create another system
  console.log(chalk.yellow('\n⚙️ The Architect creates a Gravity system...\n'));
  
  // First create a Mass component
  const massResult = await ecsGenerateComponent(world, {
    description: 'A component representing the mass of an entity in kilograms',
    examples: ['Light object with 0.5kg', 'Heavy object with 100kg']
  }, architect);
  
  if (massResult.success) {
    const gravityResult = await ecsGenerateSystem(world, {
      description: 'A system that applies gravity to entities with mass',
      requiredComponents: ['Velocity', 'Mass'],
      behavior: 'Apply downward acceleration to all entities with mass, modifying their y velocity',
      constraints: [
        'Gravity constant should be -9.81 units/sec²',
        'Heavier objects should not fall faster (realistic physics)',
        'Should work with delta time'
      ]
    }, architect);
    
    if (gravityResult.success) {
      console.log(chalk.green(`✅ Successfully created ${gravityResult.systemName}!`));
    }
  }
  
  // Create some test entities
  console.log(chalk.yellow('\n🎯 Creating test entities...\n'));
  
  const entity1 = addEntity(world);
  const posComp = globalRegistry.getComponent('Position')?.component;
  const velComp = globalRegistry.getComponent('Velocity')?.component;
  const massComp = globalRegistry.getComponent('Mass')?.component;
  
  if (posComp && velComp) {
    addComponent(world, entity1, posComp);
    addComponent(world, entity1, velComp);
    
    posComp.x[entity1] = 0;
    posComp.y[entity1] = 100;
    velComp.x[entity1] = 5;
    velComp.y[entity1] = 0;
    
    console.log(chalk.green(`✅ Created entity ${entity1} at (0, 100) with velocity (5, 0)`));
    
    if (massComp) {
      addComponent(world, entity1, massComp);
      massComp.value[entity1] = 10;
      console.log(chalk.green(`   Added mass of 10kg`));
    }
  }
  
  // Run the systems
  console.log(chalk.yellow('\n🏃 Running systems...\n'));
  
  // Show initial state
  console.log(chalk.cyan('Initial state:'));
  console.log(`  Entity ${entity1}: Position (${posComp?.x[entity1]}, ${posComp?.y[entity1]}), Velocity (${velComp?.x[entity1]}, ${velComp?.y[entity1]})`);
  
  // Execute movement system
  if (movementResult.success) {
    executeDynamicSystem(world, movementResult.systemName!);
    console.log(chalk.green(`\n✅ Executed ${movementResult.systemName}`));
    console.log(`  Entity ${entity1}: Position (${posComp?.x[entity1]}, ${posComp?.y[entity1]}), Velocity (${velComp?.x[entity1]}, ${velComp?.y[entity1]})`);
  }
  
  // Inspect all systems
  console.log(chalk.yellow('\n🔍 Inspecting created systems...\n'));
  
  const systemInspection = await ecsInspect(world, {
    target: 'systems',
    detailed: true
  }, architect);
  
  console.log(chalk.cyan('Registered Systems:'));
  systemInspection.data.forEach((sys: any) => {
    console.log(`\n  ${sys.name}:`);
    console.log(`    Description: ${sys.description}`);
    console.log(`    Required: ${sys.requiredComponents.join(', ')}`);
    console.log(`    Created: ${new Date(sys.timestamp).toLocaleString()}`);
  });
  
  // Show god statistics
  console.log(chalk.yellow('\n📊 God Statistics:\n'));
  console.log(`  The Architect:`);
  console.log(`    Level: ${GodMode.level[architect]}`);
  console.log(`    Components Created: ${globalRegistry.listComponents().length}`);
  console.log(`    Systems Created: ${globalRegistry.listSystems().length}`);
  console.log(`    Total Creations: ${GodMode.createdCount[architect]}`);
  
  console.log(chalk.green('\n✅ System generation demo complete!\n'));
}

// Run the demo
runSystemDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});