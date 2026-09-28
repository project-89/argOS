#!/usr/bin/env node
/**
 * Debug Visualization Test
 * Simple test to see why entities aren't showing up
 */

import { createWorld, addEntity, addComponent, query } from 'bitecs';
import { globalRegistry } from './src/components/registry.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import { storeString } from './src/components/god-components.js';
import chalk from 'chalk';

async function debugVisualization() {
  console.log(chalk.bold.yellow('\n🔍 VISUALIZATION DEBUG TEST\n'));
  
  // Create a world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create a simple component using BitECS SoA pattern
  const TestComponent = {
    value: [] as number[],
    nameHash: [] as number[]
  };
  console.log(chalk.green('✓ Created TestComponent'));
  
  // Register the component
  globalRegistry.registerComponent('TestComponent', {
    name: 'TestComponent',
    schema: {
      description: 'Test component for debugging',
      properties: [
        { name: 'value', type: 'number', description: 'Test value' },
        { name: 'name', type: 'string', description: 'Test name' }
      ]
    },
    component: TestComponent,
    timestamp: Date.now()
  });
  console.log(chalk.green('✓ Registered component'));
  
  // Create an entity
  const eid = addEntity(world);
  console.log(chalk.green(`✓ Created entity ${eid}`));
  
  // Add component to entity
  addComponent(world, eid, TestComponent);
  TestComponent.value[eid] = 42;
  TestComponent.nameHash[eid] = storeString('TestEntity');
  console.log(chalk.green('✓ Added component to entity'));
  
  // Verify entity exists in query
  const entities = query(world, [TestComponent]);
  console.log(chalk.blue(`Query found ${entities.length} entities with TestComponent`));
  
  // Test empty query (all entities)
  const allEntities = query(world, []);
  console.log(chalk.blue(`Empty query found ${allEntities.length} total entities`));
  
  // Start visualization
  console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
  const viz = startTerminalVisualization(world, {
    refreshRate: 1000,
    compact: false
  });
  
  // Wait a bit then add another entity
  setTimeout(() => {
    console.log(chalk.yellow('\n➕ Adding another entity...'));
    const eid2 = addEntity(world);
    addComponent(world, eid2, TestComponent);
    TestComponent.value[eid2] = 99;
    TestComponent.nameHash[eid2] = storeString('TestEntity2');
    console.log(chalk.green(`✓ Added entity ${eid2}`));
    
    const entities = query(world, [TestComponent]);
    console.log(chalk.blue(`Now have ${entities.length} entities with TestComponent`));
  }, 3000);
  
  // Keep running
  process.on('SIGINT', () => {
    viz.stop();
    console.log(chalk.yellow('\n👋 Stopped'));
    process.exit(0);
  });
  
  setInterval(() => {}, 1000);
}

debugVisualization().catch(console.error);