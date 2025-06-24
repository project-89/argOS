/**
 * Neuron Communication Simulation Demo
 * Shows God Agent creating a cellular-level neuron simulation
 */

import { createWorld } from 'bitecs';
import chalk from 'chalk';
import { createGodAgent, GOD_PRESETS } from '../agents/god-factory.js';
import { ecsGenerateComponent } from '../actions/generate-component.js';
import { ecsGenerateSystem } from '../actions/generate-system.js';
import { ecsGenerateRelationship } from '../actions/generate-relationship.js';
import { ecsComposeEntity } from '../actions/compose-entity.js';
import { SystemRuntime } from '../runtime/system-executor.js';
import { globalRegistry } from '../components/registry.js';

async function runNeuronDemo() {
  console.log(chalk.bold.cyan('\n🧬 Neuron Communication Simulation Demo\n'));
  
  // Create world
  const world = createWorld();
  console.log(chalk.green('✓ Created world'));
  
  // Create a naturalist god who understands biological systems
  const naturalist = createGodAgent(world, GOD_PRESETS.NATURALIST);
  console.log(chalk.green('✓ Created Gaia (Naturalist God)\n'));
  
  // Phase 1: Create neuron components
  console.log(chalk.yellow('🧪 Phase 1: Creating cellular components...\n'));
  
  // Neuron component
  await ecsGenerateComponent(world, {
    description: 'A neuron cell with membrane potential, threshold, and refractory state',
    constraints: [
      'Membrane potential ranges from -70mV (resting) to +40mV (peak action potential)',
      'Threshold is typically around -55mV',
      'Refractory period prevents immediate re-firing'
    ],
    examples: [
      'Resting neuron at -70mV',
      'Excited neuron approaching threshold',
      'Neuron in refractory period after firing'
    ]
  }, naturalist);
  
  // Synapse component  
  await ecsGenerateComponent(world, {
    description: 'A synaptic connection storing neurotransmitter levels and release probability',
    constraints: [
      'Neurotransmitter amount between 0-100 units',
      'Release probability 0-1',
      'Synaptic strength/weight for signal transmission'
    ],
    examples: [
      'Strong synapse with high neurotransmitter reserves',
      'Depleted synapse after repeated firing',
      'Inhibitory synapse with negative weight'
    ]
  }, naturalist);
  
  // Ion channels
  await ecsGenerateComponent(world, {
    description: 'Ion channels controlling sodium and potassium flow',
    constraints: [
      'Sodium channels open during depolarization',
      'Potassium channels open during repolarization',
      'Channel states: closed (0), open (1), inactivated (2)'
    ]
  }, naturalist);
  
  // Neurotransmitter
  await ecsGenerateComponent(world, {
    description: 'Neurotransmitter molecules in synaptic cleft',
    constraints: [
      'Concentration in synaptic cleft',
      'Type: glutamate (excitatory) or GABA (inhibitory)',
      'Decay rate for clearance'
    ]
  }, naturalist);
  
  console.log(chalk.green('✅ Created neuron components\n'));
  
  // Phase 2: Create relationships
  console.log(chalk.yellow('🔗 Phase 2: Creating synaptic relationships...\n'));
  
  await ecsGenerateRelationship(world, {
    description: 'Synaptic connection from presynaptic to postsynaptic neuron',
    purpose: 'Models the connection between neurons for signal transmission',
    cardinality: 'many-to-many',
    constraints: [
      'Each neuron can have multiple incoming and outgoing synapses',
      'Synaptic weight determines signal strength',
      'Can be excitatory (positive) or inhibitory (negative)'
    ]
  }, naturalist);
  
  console.log(chalk.green('✅ Created synaptic relationships\n'));
  
  // Phase 3: Create systems for neuron behavior
  console.log(chalk.yellow('⚙️ Phase 3: Creating neuron systems...\n'));
  
  // Membrane potential system
  const membranePotentialResult = await ecsGenerateSystem(world, {
    description: 'Updates neuron membrane potential based on ion channel states and synaptic input',
    requiredComponents: ['Neuron', 'IonChannel'],
    behavior: 'Calculate membrane potential changes from sodium/potassium conductance and synaptic currents',
    constraints: [
      'Apply Hodgkin-Huxley equations simplified',
      'Leak current pulls toward resting potential -70mV',
      'Sodium influx causes depolarization',
      'Potassium efflux causes repolarization'
    ]
  }, naturalist);
  
  // Action potential system
  const actionPotentialResult = await ecsGenerateSystem(world, {
    description: 'Detects threshold crossing and triggers action potentials',
    requiredComponents: ['Neuron'],
    behavior: 'When membrane potential exceeds threshold, initiate action potential spike',
    constraints: [
      'Threshold typically -55mV',
      'Spike to +40mV',
      'Enter refractory period after spike',
      'Cannot fire during refractory period'
    ]
  }, naturalist);
  
  // Synaptic transmission system
  const synapticTransmissionResult = await ecsGenerateSystem(world, {
    description: 'Handles neurotransmitter release and postsynaptic effects',
    requiredComponents: ['Synapse', 'Neurotransmitter'],
    behavior: 'When presynaptic neuron fires, release neurotransmitters that affect postsynaptic potential',
    constraints: [
      'Release probability determines if vesicles release',
      'Neurotransmitter amount depletes with use',
      'Excitatory increases postsynaptic potential',
      'Inhibitory decreases postsynaptic potential'
    ]
  }, naturalist);
  
  console.log(chalk.green('✅ Created neuron behavior systems\n'));
  
  // Phase 4: Create neurons
  console.log(chalk.yellow('🧬 Phase 4: Creating neurons...\n'));
  
  // Create presynaptic neuron
  const neuron1Result = await ecsComposeEntity(world, {
    description: 'Presynaptic excitatory neuron that will send signals',
    purpose: 'Generate action potentials and transmit to connected neurons',
    traits: ['Excitatory', 'Regular spiking', 'Pyramidal cell type'],
    behavior: 'Fires when stimulated, releases glutamate'
  }, naturalist);
  
  // Create postsynaptic neuron
  const neuron2Result = await ecsComposeEntity(world, {
    description: 'Postsynaptic neuron that receives signals',
    purpose: 'Integrate incoming signals and potentially fire',
    traits: ['Can be excited or inhibited', 'Integrates multiple inputs'],
    behavior: 'Sums inputs and fires if threshold reached'
  }, naturalist);
  
  console.log(chalk.green('✅ Created two neurons\n'));
  
  // Phase 5: Simulate!
  console.log(chalk.yellow('🎬 Phase 5: Running neuron simulation...\n'));
  
  // Create runtime
  const runtime = new SystemRuntime(world);
  
  // Add all neuron systems
  if (membranePotentialResult.success) {
    runtime.addSystem(membranePotentialResult.systemName!);
  }
  if (actionPotentialResult.success) {
    runtime.addSystem(actionPotentialResult.systemName!);
  }
  if (synapticTransmissionResult.success) {
    runtime.addSystem(synapticTransmissionResult.systemName!);
  }
  
  // Get component references for monitoring
  const neuronComp = globalRegistry.getComponent('Neuron')?.component;
  const neuron1 = neuron1Result.entityId!;
  const neuron2 = neuron2Result.entityId!;
  
  console.log(chalk.cyan('Initial State:'));
  if (neuronComp && 'membranePotential' in neuronComp) {
    console.log(`  Neuron 1: ${neuronComp.membranePotential[neuron1]}mV`);
    console.log(`  Neuron 2: ${neuronComp.membranePotential[neuron2]}mV`);
  }
  
  // Stimulate neuron 1
  console.log(chalk.yellow('\n⚡ Stimulating Neuron 1...\n'));
  if (neuronComp && 'membranePotential' in neuronComp) {
    // Inject current to depolarize
    neuronComp.membranePotential[neuron1] = -50; // Above threshold
  }
  
  // Run simulation
  runtime.setTickRate(100); // 100Hz for neural timescale
  runtime.start();
  
  // Monitor for 100ms
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    
    if (ticks % 10 === 0) { // Every 10ms
      console.log(chalk.cyan(`\nTime: ${ticks}ms`));
      if (neuronComp && 'membranePotential' in neuronComp) {
        console.log(`  Neuron 1: ${neuronComp.membranePotential[neuron1]?.toFixed(1)}mV`);
        console.log(`  Neuron 2: ${neuronComp.membranePotential[neuron2]?.toFixed(1)}mV`);
      }
    }
    
    if (ticks >= 100) {
      runtime.stop();
      clearInterval(interval);
      
      console.log(chalk.green('\n✅ Neuron simulation complete!\n'));
      console.log(chalk.gray('The God Agent successfully created:'));
      console.log(chalk.gray('  • Biologically accurate neuron components'));
      console.log(chalk.gray('  • Ion channel dynamics'));
      console.log(chalk.gray('  • Synaptic transmission mechanisms'));
      console.log(chalk.gray('  • Action potential propagation'));
      console.log(chalk.gray('  • Real-time cellular simulation!\n'));
      
      process.exit(0);
    }
  }, 10);
}

// Run the demo
runNeuronDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});