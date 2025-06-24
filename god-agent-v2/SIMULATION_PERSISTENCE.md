# Simulation Persistence and Runtime Architecture

## The Problem

Currently, God Agent creates simulations that exist only in memory:
- ✅ Components are generated and registered
- ✅ Systems are created and can execute
- ✅ Entities are spawned with data
- ❌ **Everything disappears when the process ends**
- ❌ **No way to share simulations**
- ❌ **No standalone runtime**

## Proposed Solution: `.godsim` File Format

### Simulation as Portable Files

```
my_ecosystem.godsim
my_neural_network.godsim
particle_physics.godsim
```

Each file contains:
1. **Component Definitions** (schema + generated code)
2. **System Implementations** (executable JavaScript)
3. **Entity Data** (serialized world state)
4. **Relationship Networks** (connections between entities)
5. **Metadata** (description, author, creation date)

## File Format Structure

### JSON-Based Format (Human Readable)
```json
{
  "metadata": {
    "name": "Neural Network MNIST",
    "description": "3-layer neural network for digit classification",
    "created": "2024-01-15T10:30:00Z",
    "godAgent": "The Autonomous Creator v2.0",
    "version": "1.0"
  },
  "components": {
    "NeuronValue": {
      "schema": { "activation": "number", "bias": "number", "gradient": "number" },
      "code": "export const NeuronValue = { activation: [], bias: [], gradient: [] };"
    },
    "LayerInfo": {
      "schema": { "layerId": "number", "neuronCount": "number" },
      "code": "export const LayerInfo = { layerId: [], neuronCount: [] };"
    }
  },
  "relationships": {
    "ConnectsTo": {
      "schema": { "weight": "number", "gradient": "number" },
      "cardinality": "many-to-many",
      "code": "export const ConnectsTo = createRelation({ store: () => ({ weight: [], gradient: [] }) });"
    }
  },
  "systems": {
    "ForwardPassSystem": {
      "description": "Propagates activations forward through the network",
      "requiredComponents": ["NeuronValue", "LayerInfo"],
      "code": "export function ForwardPassSystem(world) { /* generated code */ }"
    },
    "BackpropSystem": {
      "description": "Backpropagates gradients for learning",
      "requiredComponents": ["NeuronValue"],
      "code": "export function BackpropSystem(world) { /* generated code */ }"
    }
  },
  "entities": [
    { "id": 1, "components": { "NeuronValue": { "activation": 0.5, "bias": -0.1 }, "LayerInfo": { "layerId": 0 } } },
    { "id": 2, "components": { "NeuronValue": { "activation": 0.0, "bias": 0.2 }, "LayerInfo": { "layerId": 1 } } }
  ],
  "relationships": [
    { "from": 1, "to": 2, "type": "ConnectsTo", "data": { "weight": 0.75, "gradient": 0.0 } }
  ],
  "initializers": {
    "setupMNIST": "function setupMNIST(world) { /* initialization code */ }"
  },
  "runtime": {
    "defaultSystems": ["ForwardPassSystem", "BackpropSystem"],
    "tickRate": 60,
    "maxEntities": 10000
  }
}
```

### Binary Format (Performance)
```
.godsim.bin
├── Header (metadata)
├── Component Schemas
├── System Bytecode
├── Entity Data (packed)
└── Relationship Graph
```

## Standalone Runtime Architecture

### 1. God Agent (Creator)
```typescript
// God creates and saves
const simulation = await god.createSimulation("Build a neural network...");
await simulation.save("neural_network.godsim");
```

### 2. Simulation Runtime (Player)
```typescript
// Anyone can load and run
import { SimulationRuntime } from '@god-agent/runtime';

const runtime = new SimulationRuntime();
const sim = await runtime.load("neural_network.godsim");

// Run the simulation
sim.start();
sim.step(); // Single step
sim.pause();
sim.reset();

// Inspect state
const neurons = sim.query(['NeuronValue']);
const weights = sim.getRelationships('ConnectsTo');
```

### 3. Web Runtime (Browser)
```html
<script src="godsim-runtime.js"></script>
<script>
  GodSim.load('ecosystem.godsim').then(sim => {
    sim.onUpdate((entities) => {
      renderVisualization(entities);
    });
    sim.start();
  });
</script>
```

## Implementation Plan

### Phase 1: Serialization
```typescript
// Add to autonomous-god.ts
export class SimulationSerializer {
  static async save(god: AutonomousGodState, filename: string) {
    const simulation = {
      metadata: this.generateMetadata(god),
      components: this.serializeComponents(god),
      systems: this.serializeSystems(god),
      entities: this.serializeEntities(god),
      relationships: this.serializeRelationships(god)
    };
    
    await fs.writeFile(filename, JSON.stringify(simulation, null, 2));
  }
  
  static async load(filename: string): Promise<AutonomousGodState> {
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    return this.deserializeSimulation(data);
  }
}
```

### Phase 2: Standalone Runtime
```typescript
export class SimulationRuntime {
  private world: World;
  private systems: Map<string, Function>;
  private running: boolean = false;
  
  async load(filename: string) {
    const data = await this.loadSimulationFile(filename);
    this.world = this.createWorldFromData(data);
    this.systems = this.compileSystems(data.systems);
  }
  
  start() {
    this.running = true;
    this.gameLoop();
  }
  
  private gameLoop() {
    if (!this.running) return;
    
    // Execute all systems
    for (const [name, system] of this.systems) {
      system(this.world);
    }
    
    requestAnimationFrame(() => this.gameLoop());
  }
}
```

### Phase 3: Distribution
```bash
# NPM package
npm install @god-agent/runtime

# CLI tool
npx godsim run my_simulation.godsim
npx godsim inspect my_simulation.godsim
npx godsim validate my_simulation.godsim
```

## Use Cases

### 1. Research Sharing
```bash
# Researcher A creates simulation
god> /save ecosystem_model.godsim

# Researcher B runs it
godsim run ecosystem_model.godsim
```

### 2. Educational Distribution
```bash
# Professor creates physics demo
god> "Create a gravity simulation with 3 planets"
god> /save solar_system.godsim

# Students explore
godsim run solar_system.godsim --interactive
```

### 3. Simulation Libraries
```bash
# Community repository
godsim publish neural_network.godsim
godsim search "economics"
godsim install predator_prey.godsim
```

### 4. Web Integration
```html
<!-- Embed simulation in research paper -->
<godsim-player src="./figures/neural_network.godsim" 
               width="800" height="600" 
               controls="play,pause,step,reset">
</godsim-player>
```

## Advanced Features

### Version Control
```bash
git add ecosystem_v1.godsim
git commit -m "Add predator-prey dynamics"

# Diff simulations
godsim diff ecosystem_v1.godsim ecosystem_v2.godsim
```

### Simulation Composition
```typescript
// Combine multiple simulations
const hybrid = SimulationComposer
  .load('neural_network.godsim')
  .merge('physics_engine.godsim')
  .connect('neuron_output', 'physics_input')
  .save('neuro_physics.godsim');
```

### Live Editing
```typescript
// Modify running simulation
const sim = runtime.load('ecosystem.godsim');
sim.start();

// Add new component at runtime
sim.addComponent('Mutation', { rate: [], type: [] });
sim.addSystem('MutationSystem', (world) => { /* live code */ });
```

## Benefits

1. **Portability**: Simulations run anywhere
2. **Reproducibility**: Exact replication of results
3. **Collaboration**: Easy sharing between researchers
4. **Education**: Students can explore pre-built simulations
5. **Version Control**: Track simulation evolution
6. **Performance**: Optimized runtime without God overhead
7. **Integration**: Embed in papers, websites, applications

This transforms God Agent from a toy into a **simulation ecosystem**!