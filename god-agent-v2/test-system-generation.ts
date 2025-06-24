import { createWorld, addEntity, addComponent } from 'bitecs';
import { createGodAgent, GOD_PRESETS } from './src/agents/god-factory.js';
import { ecsGenerateComponent } from './src/actions/generate-component.js';
import { ecsGenerateSystem } from './src/actions/generate-system.js';
import { globalRegistry } from './src/components/registry.js';
import chalk from 'chalk';

async function testSystemGeneration() {
  console.log(chalk.bold.cyan('\n🧪 Testing System Generation\n'));
  
  const world = createWorld();
  const naturalist = createGodAgent(world, GOD_PRESETS.NATURALIST);
  
  // First create the required components
  console.log(chalk.yellow('Creating components...'));
  
  await ecsGenerateComponent(world, {
    description: 'Component to identify organism type (plant, herbivore, carnivore)',
    constraints: [
      'Use numeric constants for types: 0=plant, 1=herbivore, 2=carnivore',
      'Include growth stage (0-100)'
    ]
  }, naturalist);
  
  await ecsGenerateComponent(world, {
    description: 'Energy level component for living organisms',
    constraints: [
      'Energy cannot be negative',
      'Has current and maximum energy'
    ]
  }, naturalist);
  
  console.log(chalk.green(`✅ Created ${globalRegistry.listComponents().length} components\n`));
  
  // Now try to create the PlantGrowthSystem
  console.log(chalk.yellow('Creating PlantGrowthSystem...'));
  
  const result = await ecsGenerateSystem(world, {
    description: 'System that makes plants grow and gain energy from photosynthesis',
    requiredComponents: ['OrganismType', 'Energy'],
    behavior: 'Plants (type 0) gain energy over time and increase their growth stage',
    constraints: [
      'Only affects plants (OrganismType.type === 0)',
      'Energy gain rate of 0.1 per tick',
      'Growth increases by 1 per tick until stage 100'
    ]
  }, naturalist);
  
  console.log(chalk.cyan('\nResult:'), result);
  
  if (!result.success) {
    console.log(chalk.red('\n❌ System generation failed!'));
    console.log(chalk.red('Error:'), result.error);
    if (result.code) {
      console.log(chalk.yellow('\nGenerated code:'));
      console.log(chalk.gray(result.code));
    }
  } else {
    console.log(chalk.green('\n✅ System generated successfully!'));
    console.log(chalk.green('System name:'), result.systemName);
  }
  
  console.log(chalk.cyan(`\n📊 Final registry state:`));
  console.log(`  Components: ${globalRegistry.listComponents().join(', ')}`);
  console.log(`  Systems: ${globalRegistry.listSystems().join(', ')}`);
}

testSystemGeneration().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});