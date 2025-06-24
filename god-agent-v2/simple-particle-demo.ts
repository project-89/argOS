#!/usr/bin/env tsx
/**
 * Simple Particle Simulation Demo
 * Direct creation without AI to test visualization
 */

import { createWorld, addEntity, addComponent } from 'bitecs';
import { globalRegistry } from './src/components/registry.js';
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';
import { storeString } from './src/components/god-components.js';
import chalk from 'chalk';

async function createParticleSimulation() {
  console.log(chalk.bold.cyan('\n🌟 PARTICLE SIMULATION WITH VISUALIZATION\n'));
  
  const world = createWorld();
  
  // Create Position component
  const Position = {
    x: [] as number[],
    y: [] as number[],
    z: [] as number[]
  };
  
  // Create Velocity component
  const Velocity = {
    x: [] as number[],
    y: [] as number[],
    z: [] as number[]
  };
  
  // Create Particle component
  const Particle = {
    mass: [] as number[],
    radius: [] as number[],
    colorHash: [] as number[]
  };
  
  // Register components
  globalRegistry.registerComponent('Position', {
    name: 'Position',
    schema: {
      description: '3D position',
      properties: [
        { name: 'x', type: 'number', description: 'X coordinate' },
        { name: 'y', type: 'number', description: 'Y coordinate' },
        { name: 'z', type: 'number', description: 'Z coordinate' }
      ]
    },
    component: Position,
    timestamp: Date.now()
  });
  
  globalRegistry.registerComponent('Velocity', {
    name: 'Velocity',
    schema: {
      description: '3D velocity',
      properties: [
        { name: 'x', type: 'number', description: 'X velocity' },
        { name: 'y', type: 'number', description: 'Y velocity' },
        { name: 'z', type: 'number', description: 'Z velocity' }
      ]
    },
    component: Velocity,
    timestamp: Date.now()
  });
  
  globalRegistry.registerComponent('Particle', {
    name: 'Particle',
    schema: {
      description: 'Particle properties',
      properties: [
        { name: 'mass', type: 'number', description: 'Particle mass' },
        { name: 'radius', type: 'number', description: 'Particle radius' },
        { name: 'colorHash', type: 'number', description: 'Color identifier' }
      ]
    },
    component: Particle,
    timestamp: Date.now()
  });
  
  console.log(chalk.green('✓ Registered components'));
  
  // Create 5 particles
  const particles: number[] = [];
  const colors = ['red', 'blue', 'green', 'yellow', 'purple'];
  
  for (let i = 0; i < 5; i++) {
    const eid = addEntity(world);
    particles.push(eid);
    
    // Add components
    addComponent(world, eid, Position);
    addComponent(world, eid, Velocity);
    addComponent(world, eid, Particle);
    
    // Set initial position (random in space)
    Position.x[eid] = Math.random() * 100 - 50;
    Position.y[eid] = Math.random() * 100 - 50;
    Position.z[eid] = Math.random() * 100 - 50;
    
    // Set initial velocity
    Velocity.x[eid] = Math.random() * 10 - 5;
    Velocity.y[eid] = Math.random() * 10 - 5;
    Velocity.z[eid] = Math.random() * 10 - 5;
    
    // Set particle properties
    Particle.mass[eid] = 1 + Math.random() * 4;
    Particle.radius[eid] = 0.5 + Math.random() * 1.5;
    Particle.colorHash[eid] = storeString(colors[i]);
    
    console.log(chalk.yellow(`✨ Created particle ${i + 1} (${colors[i]})`));
  }
  
  // Create a simple physics system
  const physicsSystem = (world: any) => {
    for (const eid of particles) {
      // Update positions based on velocity
      Position.x[eid] += Velocity.x[eid] * 0.1;
      Position.y[eid] += Velocity.y[eid] * 0.1;
      Position.z[eid] += Velocity.z[eid] * 0.1;
      
      // Simple boundary bounce
      if (Math.abs(Position.x[eid]) > 50) Velocity.x[eid] *= -1;
      if (Math.abs(Position.y[eid]) > 50) Velocity.y[eid] *= -1;
      if (Math.abs(Position.z[eid]) > 50) Velocity.z[eid] *= -1;
    }
  };
  
  // Register the physics system
  globalRegistry.registerSystem('PhysicsSystem', {
    name: 'PhysicsSystem',
    description: 'Updates particle positions and handles boundaries',
    requiredComponents: ['Position', 'Velocity', 'Particle'],
    systemFn: physicsSystem,
    timestamp: Date.now()
  });
  
  console.log(chalk.green('✓ Created physics system'));
  
  // Start visualization
  console.log(chalk.cyan('\n📺 Starting terminal visualization...'));
  const viz = startTerminalVisualization(world, {
    refreshRate: 500,
    showSystems: true,
    compact: false
  });
  
  // Run physics simulation
  console.log(chalk.yellow('\n🎮 Running simulation (press Ctrl+C to stop)...'));
  
  const simulationLoop = setInterval(() => {
    physicsSystem(world);
  }, 100);
  
  // Handle exit
  process.on('SIGINT', () => {
    clearInterval(simulationLoop);
    viz.stop();
    console.log(chalk.green('\n✅ Simulation stopped'));
    process.exit(0);
  });
}

createParticleSimulation().catch(console.error);