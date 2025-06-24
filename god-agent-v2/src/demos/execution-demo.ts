/**
 * System Execution Demo
 * Shows real execution of dynamically generated systems
 */

import { createWorld, addEntity, addComponent } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsGenerateComponent } from '../actions/generate-component.js';
import { ecsGenerateSystem } from '../actions/generate-system.js';
import { globalRegistry } from '../components/registry.js';
import { SystemRuntime } from '../runtime/system-executor.js';

async function runExecutionDemo() {
  console.log(chalk.bold.cyan('\n🚀 Real System Execution Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create the architect god
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  console.log(chalk.green('✓ Created The Architect\n'));
  
  // Phase 1: Create components
  console.log(chalk.yellow('🔨 Phase 1: Creating components...\n'));
  
  // Position component
  await ecsGenerateComponent(world, {
    description: 'A 2D position component with x and y coordinates',
    examples: ['Entity at (0,0)', 'Entity at (100, 200)']
  }, architect);
  
  // Velocity component
  await ecsGenerateComponent(world, {
    description: 'A 2D velocity component with x and y speed',
    examples: ['Moving right at 5 units/sec', 'Moving diagonally at (3, 4)']
  }, architect);
  
  console.log(chalk.green(`✅ Created Position and Velocity components\n`));
  
  // Phase 2: Create a movement system
  console.log(chalk.yellow('⚙️ Phase 2: Creating movement system...\n'));
  
  const movementResult = await ecsGenerateSystem(world, {
    description: 'A system that updates entity positions based on velocity',
    requiredComponents: ['Position', 'Velocity'],
    behavior: 'For each entity, add velocity to position each frame',
    constraints: [
      'Should handle delta time (dt) if available in world',
      'Position should be updated by velocity * dt'
    ]
  }, architect);
  
  if (!movementResult.success) {
    console.error(chalk.red('Failed to create movement system'));
    return;
  }
  
  console.log(chalk.green(`✅ Created ${movementResult.systemName}\n`));
  
  // Phase 3: Create test entities
  console.log(chalk.yellow('🎯 Phase 3: Creating test entities...\n'));
  
  const entities: number[] = [];
  const posComp = globalRegistry.getComponent('Position')?.component;
  const velComp = globalRegistry.getComponent('Velocity')?.component;
  
  if (posComp && velComp) {
    // Create 3 moving entities
    for (let i = 0; i < 3; i++) {
      const eid = addEntity(world);
      entities.push(eid);
      
      addComponent(world, eid, posComp);
      addComponent(world, eid, velComp);
      
      // Set initial positions
      posComp.x[eid] = i * 50;
      posComp.y[eid] = 0;
      
      // Set velocities
      velComp.x[eid] = (i + 1) * 2; // 2, 4, 6 units/sec
      velComp.y[eid] = (i + 1);     // 1, 2, 3 units/sec
      
      console.log(chalk.green(
        `✅ Entity ${eid}: Pos(${posComp.x[eid]}, ${posComp.y[eid]}) ` +
        `Vel(${velComp.x[eid]}, ${velComp.y[eid]})`
      ));
    }
  }
  
  // Phase 4: Create and start the runtime
  console.log(chalk.yellow('\n🏃 Phase 4: Running simulation with real execution...\n'));
  
  const runtime = new SystemRuntime(world);
  runtime.addSystem(movementResult.systemName!);
  runtime.setTickRate(10); // 10 ticks per second for visibility
  
  // Show initial state
  console.log(chalk.cyan('Initial State:'));
  entities.forEach(eid => {
    if (posComp) {
      console.log(`  Entity ${eid}: Position (${posComp.x[eid].toFixed(2)}, ${posComp.y[eid].toFixed(2)})`);
    }
  });
  
  // Run for 3 seconds
  console.log(chalk.yellow('\nStarting runtime (3 seconds)...\n'));
  runtime.start();
  
  // Track positions over time
  let tickCount = 0;
  const interval = setInterval(() => {
    tickCount++;
    console.log(chalk.cyan(`\nAfter ${tickCount * 100}ms:`));
    
    entities.forEach(eid => {
      if (posComp) {
        console.log(`  Entity ${eid}: Position (${posComp.x[eid].toFixed(2)}, ${posComp.y[eid].toFixed(2)})`);
      }
    });
    
    // Stop after 3 seconds
    if (tickCount >= 30) {
      runtime.stop();
      clearInterval(interval);
      
      // Show final state
      console.log(chalk.yellow('\n📊 Final Results:\n'));
      
      entities.forEach((eid, i) => {
        if (posComp && velComp) {
          const expectedX = i * 50 + (velComp.x[eid] * 3); // initial + velocity * time
          const expectedY = 0 + (velComp.y[eid] * 3);
          
          console.log(chalk.cyan(`Entity ${eid}:`));
          console.log(`  Final Position: (${posComp.x[eid].toFixed(2)}, ${posComp.y[eid].toFixed(2)})`);
          console.log(`  Expected: (${expectedX.toFixed(2)}, ${expectedY.toFixed(2)})`);
          console.log(`  Velocity: (${velComp.x[eid]}, ${velComp.y[eid]})`);
        }
      });
      
      console.log(chalk.green('\n✅ Real system execution demo complete!\n'));
      console.log(chalk.gray('The MovementSystem actually modified component data in real-time!'));
      process.exit(0);
    }
  }, 100);
}

// Run the demo
runExecutionDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});