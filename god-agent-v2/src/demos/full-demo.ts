/**
 * Full God Agent Demo
 * Shows the complete workflow: components → systems → entities → execution
 */

import { createWorld } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsInspect } from '../actions/inspect.js';
import { ecsGenerateComponent } from '../actions/generate-component.js';
import { ecsGenerateSystem } from '../actions/generate-system.js';
import { ecsComposeEntity, inspectEntity } from '../actions/compose-entity.js';
import { globalRegistry } from '../components/registry.js';
import { GodMode } from '../components/god-components.js';

async function runFullDemo() {
  console.log(chalk.bold.cyan('\n🌟 God Agent Complete Workflow Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create a high-level god agent
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  console.log(chalk.green('✓ Created The Architect (Level 100)\n'));
  
  // Step 1: Create fundamental components
  console.log(chalk.yellow('🔨 Step 1: Creating fundamental components...\n'));
  
  await ecsGenerateComponent(world, {
    description: 'A 2D position component with x and y coordinates for spatial location',
    examples: ['Entity at origin (0,0)', 'Entity at (100, 200)']
  }, architect);
  
  await ecsGenerateComponent(world, {
    description: 'Health component with current HP, maximum HP, and regeneration rate',
    constraints: [
      'Current HP cannot exceed maximum',
      'Regeneration can be negative for damage over time'
    ]
  }, architect);
  
  await ecsGenerateComponent(world, {
    description: 'Velocity component for movement with x and y speed components',
    examples: ['Stationary (0,0)', 'Moving right (5,0)', 'Falling (-1,-3)']
  }, architect);
  
  console.log(chalk.green(`✅ Created ${globalRegistry.listComponents().length} components\n`));
  
  // Step 2: Create systems that operate on these components
  console.log(chalk.yellow('⚙️ Step 2: Creating systems...\n'));
  
  await ecsGenerateSystem(world, {
    description: 'Movement system that updates positions based on velocity',
    requiredComponents: ['Position', 'Velocity'],
    behavior: 'Add velocity to position each frame, with simple boundary wrapping',
    constraints: [
      'Wrap positions at world boundaries (0-500)',
      'Use delta time if available'
    ]
  }, architect);
  
  await ecsGenerateSystem(world, {
    description: 'Healing system that regenerates health over time',
    requiredComponents: ['Health'],
    behavior: 'Apply regeneration rate to current health, clamped to maximum',
    constraints: [
      'Health cannot exceed maximum',
      'Negative regeneration causes damage'
    ]
  }, architect);
  
  console.log(chalk.green(`✅ Created ${globalRegistry.listSystems().length} systems\n`));
  
  // Step 3: Compose complex entities using the components
  console.log(chalk.yellow('🎯 Step 3: Composing entities...\n'));
  
  // Create a warrior
  const warriorResult = await ecsComposeEntity(world, {
    description: 'A strong warrior character with good health and moderate movement',
    purpose: 'Combat entity that can move around and sustain damage',
    traits: ['Strong', 'Durable', 'Mobile'],
    behavior: 'Moves around the battlefield, regenerates health slowly',
    examples: ['A knight with heavy armor', 'A barbarian warrior']
  }, architect);
  
  // Create a scout
  const scoutResult = await ecsComposeEntity(world, {
    description: 'A fast scout with lower health but high mobility',
    purpose: 'Reconnaissance unit that moves quickly but is fragile',
    traits: ['Fast', 'Agile', 'Fragile'],
    behavior: 'Moves quickly to explore, has minimal health regeneration'
  }, architect);
  
  // Create a healer
  const healerResult = await ecsComposeEntity(world, {
    description: 'A healing character with high regeneration but slow movement',
    purpose: 'Support unit that can recover health quickly',
    traits: ['Regenerative', 'Slow', 'Supportive'],
    behavior: 'Moves slowly but has strong health regeneration'
  }, architect);
  
  console.log(chalk.green(`✅ Composed ${[warriorResult, scoutResult, healerResult].filter(r => r.success).length} entities\n`));
  
  // Step 4: Inspect the created entities
  console.log(chalk.yellow('🔍 Step 4: Inspecting entities...\n'));
  
  const entities = [warriorResult, scoutResult, healerResult]
    .filter(r => r.success && r.entityId)
    .map(r => ({ name: r.design?.name || 'Unknown', id: r.entityId! }));
  
  for (const entity of entities) {
    const inspection = inspectEntity(entity.id);
    console.log(chalk.cyan(`${entity.name} (Entity ${entity.id}):`));
    console.log(`  Components: ${inspection.components.join(', ')}`);
    
    for (const [compName, data] of Object.entries(inspection.data)) {
      const values = Object.entries(data as Record<string, any>)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      console.log(`    ${compName}: ${values}`);
    }
    console.log();
  }
  
  // Step 5: Show the complete architecture
  console.log(chalk.yellow('🏗️ Step 5: Complete architecture overview...\n'));
  
  const worldInspection = await ecsInspect(world, { target: 'world' }, architect);
  console.log(chalk.cyan('World State:'));
  console.log(`  ${worldInspection.summary}\n`);
  
  // Component details
  const componentInspection = await ecsInspect(world, { target: 'components', detailed: true }, architect);
  console.log(chalk.cyan('Generated Components:'));
  componentInspection.data.forEach((comp: any) => {
    console.log(`  ${comp.name}: ${comp.description}`);
    console.log(`    Properties: ${comp.properties.map((p: any) => `${p.name}(${p.type})`).join(', ')}`);
  });
  console.log();
  
  // System details
  const systemInspection = await ecsInspect(world, { target: 'systems', detailed: true }, architect);
  console.log(chalk.cyan('Generated Systems:'));
  systemInspection.data.forEach((sys: any) => {
    console.log(`  ${sys.name}: ${sys.description}`);
    console.log(`    Uses: ${sys.requiredComponents.join(', ')}`);
  });
  console.log();
  
  // Step 6: Simulate system execution
  console.log(chalk.yellow('🏃 Step 6: Simulating system execution...\n'));
  
  console.log(chalk.cyan('Before system execution:'));
  entities.forEach(entity => {
    const inspection = inspectEntity(entity.id);
    const position = inspection.data.Position;
    const health = inspection.data.Health;
    if (position && health) {
      console.log(`  ${entity.name}: Pos(${position.x},${position.y}) HP(${health.currentHp}/${health.maxHp})`);
    }
  });
  
  // Simulate a few ticks (systems would actually run here)
  console.log(chalk.gray('\nSimulating 3 ticks of system execution...'));
  for (let tick = 1; tick <= 3; tick++) {
    console.log(chalk.gray(`  Tick ${tick}: MovementSystem and HealingSystem would execute`));
  }
  
  console.log(chalk.cyan('\nAfter system execution (simulated):'));
  entities.forEach(entity => {
    const inspection = inspectEntity(entity.id);
    const position = inspection.data.Position;
    const health = inspection.data.Health;
    if (position && health) {
      console.log(`  ${entity.name}: Pos(${position.x},${position.y}) HP(${health.currentHp}/${health.maxHp})`);
    }
  });
  
  // Final statistics
  console.log(chalk.yellow('\n📊 Final Statistics:\n'));
  console.log(`  The Architect (God Level ${GodMode.level[architect]}):`);
  console.log(`    Total Creations: ${GodMode.createdCount[architect]}`);
  console.log(`    Components: ${globalRegistry.listComponents().length}`);
  console.log(`    Systems: ${globalRegistry.listSystems().length}`);
  console.log(`    Entities: ${entities.length}`);
  
  console.log(chalk.green('\n✅ Complete workflow demo finished!\n'));
  console.log(chalk.gray('This demonstrates the full God Agent pipeline:'));
  console.log(chalk.gray('  1. Generate components from descriptions'));
  console.log(chalk.gray('  2. Generate systems that use those components'));
  console.log(chalk.gray('  3. Compose entities with appropriate component values'));
  console.log(chalk.gray('  4. Inspect and understand the created architecture'));
  console.log(chalk.gray('  5. Execute systems to run the simulation\n'));
}

// Run the demo
runFullDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});