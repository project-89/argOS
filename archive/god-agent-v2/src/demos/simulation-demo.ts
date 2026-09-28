/**
 * Full Simulation Generation Demo
 * Shows god agents creating entire simulations
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
import { callLLM } from '../llm/interface.js';

async function runSimulationDemo() {
  console.log(chalk.bold.cyan('\n🌍 God Agent Full Simulation Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create multiple gods
  const architect = createGodAgent(world, GOD_PRESETS.ARCHITECT);
  const naturalist = createGodAgent(world, GOD_PRESETS.NATURALIST);
  console.log(chalk.green('✓ Created The Architect and Gaia\n'));
  
  // Phase 1: Design the simulation
  console.log(chalk.yellow('📋 Phase 1: Designing the ecosystem simulation...\n'));
  
  const simulationPrompt = `Design a simple ecosystem simulation with the following:
1. Plants that grow and reproduce
2. Herbivores that eat plants and move around
3. Basic energy transfer between organisms
4. Simple spatial movement

List the key components and systems needed.`;

  const design = await callLLM(simulationPrompt);
  console.log(chalk.cyan('Simulation Design:'));
  console.log(chalk.gray(design.substring(0, 500) + '...\n'));
  
  // Phase 2: Create core components
  console.log(chalk.yellow('🔨 Phase 2: Creating core components...\n'));
  
  // Position component
  await ecsGenerateComponent(world, {
    description: 'A 2D position component for spatial location',
    examples: ['Entity at (0,0)', 'Entity at (100.5, -50.2)']
  }, architect);
  
  // Energy component
  await ecsGenerateComponent(world, {
    description: 'Energy level component for living organisms',
    constraints: [
      'Energy cannot be negative',
      'Has current and maximum energy',
      'Can track energy gain/loss rate'
    ]
  }, naturalist);
  
  // Organism type component
  await ecsGenerateComponent(world, {
    description: 'Component to identify organism type (plant, herbivore, carnivore)',
    constraints: [
      'Use numeric constants for types: 0=plant, 1=herbivore, 2=carnivore',
      'Include growth stage (0-100)'
    ]
  }, naturalist);
  
  // Movement component
  await ecsGenerateComponent(world, {
    description: 'Movement capability with speed and direction',
    examples: [
      'Stationary plant (speed 0)',
      'Slow herbivore (speed 0.5)',
      'Fast predator (speed 2.0)'
    ]
  }, architect);
  
  console.log(chalk.green(`✅ Created ${globalRegistry.listComponents().length} components\n`));
  
  // Phase 3: Create systems
  console.log(chalk.yellow('⚙️ Phase 3: Creating ecosystem systems...\n'));
  
  // Growth system for plants
  await ecsGenerateSystem(world, {
    description: 'System that makes plants grow and gain energy from photosynthesis',
    requiredComponents: ['OrganismType', 'Energy'],
    behavior: 'Plants (type 0) gain energy over time and increase their growth stage',
    constraints: [
      'Only affects plants (OrganismType.type === 0)',
      'Energy gain rate of 0.1 per tick',
      'Growth increases by 1 per tick until stage 100'
    ]
  }, naturalist);
  
  // Movement system
  await ecsGenerateSystem(world, {
    description: 'System that moves entities based on their movement component',
    requiredComponents: ['Position', 'Movement'],
    behavior: 'Update position based on speed and direction, with simple random walk',
    constraints: [
      'Wrap around world boundaries at 0-500',
      'Add small random variation to direction'
    ]
  }, architect);
  
  // Feeding system
  await ecsGenerateSystem(world, {
    description: 'System where herbivores eat nearby plants',
    requiredComponents: ['Position', 'Energy', 'OrganismType'],
    behavior: 'Herbivores gain energy by consuming nearby plants',
    constraints: [
      'Herbivores (type 1) can eat plants (type 0) within distance 10',
      'Transfer 50% of plant energy to herbivore',
      'Remove plant when energy reaches 0'
    ]
  }, naturalist);
  
  console.log(chalk.green(`✅ Created ${globalRegistry.listSystems().length} systems\n`));
  
  // Phase 4: Populate the world
  console.log(chalk.yellow('🌱 Phase 4: Populating the ecosystem...\n'));
  
  // Create plants
  const plants = [];
  for (let i = 0; i < 10; i++) {
    const plant = addEntity(world);
    
    // Add all components manually since we need specific setup
    const posComp = globalRegistry.getComponent('Position')?.component;
    const energyComp = globalRegistry.getComponent('Energy')?.component;
    const orgComp = globalRegistry.getComponent('OrganismType')?.component;
    
    if (posComp && energyComp && orgComp) {
      addComponent(world, plant, posComp);
      addComponent(world, plant, energyComp);
      addComponent(world, plant, orgComp);
      
      // Set random position
      posComp.x[plant] = Math.random() * 500;
      posComp.y[plant] = Math.random() * 500;
      
      // Set energy
      if ('current' in energyComp) energyComp.current[plant] = 50;
      if ('max' in energyComp) energyComp.max[plant] = 100;
      
      // Set as plant
      if ('type' in orgComp) orgComp.type[plant] = 0; // Plant
      if ('growthStage' in orgComp) orgComp.growthStage[plant] = 0;
      
      plants.push(plant);
    }
  }
  console.log(chalk.green(`✅ Created ${plants.length} plants`));
  
  // Create herbivores
  const herbivores = [];
  for (let i = 0; i < 5; i++) {
    const herbivore = addEntity(world);
    
    const posComp = globalRegistry.getComponent('Position')?.component;
    const energyComp = globalRegistry.getComponent('Energy')?.component;
    const orgComp = globalRegistry.getComponent('OrganismType')?.component;
    const moveComp = globalRegistry.getComponent('Movement')?.component;
    
    if (posComp && energyComp && orgComp && moveComp) {
      addComponent(world, herbivore, posComp);
      addComponent(world, herbivore, energyComp);
      addComponent(world, herbivore, orgComp);
      addComponent(world, herbivore, moveComp);
      
      // Set random position
      posComp.x[herbivore] = Math.random() * 500;
      posComp.y[herbivore] = Math.random() * 500;
      
      // Set energy
      if ('current' in energyComp) energyComp.current[herbivore] = 75;
      if ('max' in energyComp) energyComp.max[herbivore] = 100;
      
      // Set as herbivore
      if ('type' in orgComp) orgComp.type[herbivore] = 1; // Herbivore
      if ('growthStage' in orgComp) orgComp.growthStage[herbivore] = 50;
      
      // Set movement
      if ('speed' in moveComp) moveComp.speed[herbivore] = 0.5;
      if ('direction' in moveComp) moveComp.direction[herbivore] = Math.random() * Math.PI * 2;
      
      herbivores.push(herbivore);
    }
  }
  console.log(chalk.green(`✅ Created ${herbivores.length} herbivores\n`));
  
  // Phase 5: Run simulation
  console.log(chalk.yellow('🏃 Phase 5: Running ecosystem simulation...\n'));
  
  // Show initial state
  const initialInspection = await ecsInspect(world, { target: 'world' }, architect);
  console.log(chalk.cyan('Initial State:'));
  console.log(`  ${initialInspection.summary}\n`);
  
  // Run simulation for a few ticks
  console.log(chalk.yellow('Running 5 simulation ticks...\n'));
  
  for (let tick = 1; tick <= 5; tick++) {
    console.log(chalk.cyan(`Tick ${tick}:`));
    
    // Execute all systems
    globalRegistry.listSystems().forEach(sysName => {
      executeDynamicSystem(world, sysName);
    });
    
    // Sample one entity's state
    if (plants[0]) {
      const posComp = globalRegistry.getComponent('Position')?.component;
      const energyComp = globalRegistry.getComponent('Energy')?.component;
      const orgComp = globalRegistry.getComponent('OrganismType')?.component;
      
      if (posComp && energyComp && orgComp && 'current' in energyComp) {
        console.log(`  Plant 0: Energy ${energyComp.current[plants[0]]?.toFixed(1) || 0}`);
      }
    }
  }
  
  // Final inspection
  console.log(chalk.yellow('\n📊 Final Simulation State:\n'));
  
  const finalInspection = await ecsInspect(world, { target: 'world' }, architect);
  console.log(chalk.cyan('Final State:'));
  console.log(`  ${finalInspection.summary}`);
  
  // God statistics
  console.log(chalk.yellow('\n📈 God Creation Statistics:\n'));
  
  const gods = [
    { eid: architect, name: 'The Architect' },
    { eid: naturalist, name: 'Gaia' }
  ];
  
  gods.forEach(god => {
    console.log(`  ${god.name}:`);
    console.log(`    Level: ${GodMode.level[god.eid]}`);
    console.log(`    Creations: ${GodMode.createdCount[god.eid]}`);
  });
  
  // Component and System summary
  console.log(chalk.yellow('\n🎯 Generated Architecture:\n'));
  console.log(`  Components: ${globalRegistry.listComponents().join(', ')}`);
  console.log(`  Systems: ${globalRegistry.listSystems().join(', ')}`);
  
  console.log(chalk.green('\n✅ Ecosystem simulation demo complete!\n'));
  console.log(chalk.gray('Note: System execution is simulated. In production, systems would actually modify component data.\n'));
}

// Run the demo
runSimulationDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});