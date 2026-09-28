/**
 * Inspection Demo
 * Shows god agents inspecting the world
 */

import { createWorld } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsInspect } from '../actions/inspect.js';
import { GodMode } from '../components/god-components.js';

async function runInspectionDemo() {
  console.log(chalk.bold.cyan('\n🔍 God Agent Inspection Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create various gods
  console.log(chalk.yellow('\n📍 Creating god agents...'));
  
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  const naturalist = createGodAgent(world, GOD_PRESETS.NATURALIST);
  const economist = createGodAgent(world, GOD_PRESETS.ECONOMIST);
  
  // Have the architect inspect the world
  console.log(chalk.yellow('\n🔍 The Architect inspects the world...\n'));
  
  const worldInspection = await ecsInspect(world, { target: 'world' }, architect);
  console.log(chalk.cyan('World Overview:'));
  console.log(`  ${worldInspection.summary}`);
  console.log(chalk.gray(JSON.stringify(worldInspection.data, null, 2)));
  
  // Inspect entities in detail
  console.log(chalk.yellow('\n🔍 Inspecting entities in detail...\n'));
  
  const entityInspection = await ecsInspect(world, { 
    target: 'entities',
    detailed: true 
  }, architect);
  
  console.log(chalk.cyan('Entity Details:'));
  entityInspection.data.forEach((entity: any) => {
    console.log(`\n  Entity ${entity.eid}:`);
    console.log(`    Name: ${entity.name || 'N/A'}`);
    console.log(`    Role: ${entity.role || 'N/A'}`);
    console.log(`    Components: ${entity.components.join(', ')}`);
    console.log(`    God Level: ${entity.godLevel || 0}`);
  });
  
  // Inspect components
  console.log(chalk.yellow('\n🔍 Inspecting available components...\n'));
  
  const componentInspection = await ecsInspect(world, {
    target: 'components',
    detailed: true
  }, architect);
  
  console.log(chalk.cyan('Components:'));
  if (componentInspection.data.length === 0) {
    console.log('  No components registered yet');
  } else {
    componentInspection.data.forEach((comp: any) => {
      console.log(`  ${comp.name}: ${comp.description}`);
    });
  }
  
  // Demonstrate filtering
  console.log(chalk.yellow('\n🔍 Searching for specific entities...\n'));
  
  const filteredInspection = await ecsInspect(world, {
    target: 'entities',
    filter: 'Architect',
    detailed: true
  }, architect);
  
  console.log(chalk.cyan('Search Results for "Architect":'));
  console.log(`  Found ${filteredInspection.data.length} matching entities`);
  
  // Show god statistics
  console.log(chalk.yellow('\n📊 God Statistics:\n'));
  
  const gods = [
    { eid: architect, name: 'The Architect' },
    { eid: naturalist, name: 'Gaia' },
    { eid: economist, name: 'Plutus' }
  ];
  
  gods.forEach(god => {
    console.log(`  ${god.name}:`);
    console.log(`    Level: ${GodMode.level[god.eid]}`);
    console.log(`    Created: ${GodMode.createdCount[god.eid]} items`);
    console.log(`    Last Creation: ${
      GodMode.lastCreation[god.eid] 
        ? new Date(GodMode.lastCreation[god.eid]).toLocaleString() 
        : 'Never'
    }`);
  });
  
  console.log(chalk.green('\n✅ Inspection demo complete!\n'));
}

// Run the demo
runInspectionDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});