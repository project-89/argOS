# Neural Network in ECS - Architecture

## Components (Structure of Arrays)

```typescript
// Neuron data
const NeuronValue = {
  activation: new Float32Array(10000),  // Current activation
  bias: new Float32Array(10000),       // Bias term
  gradient: new Float32Array(10000),    // For backprop
  layerId: new Uint8Array(10000),      // Which layer (0,1,2)
};

// Layer identification
const InputNeuron = {};   // Tag component
const HiddenNeuron = {};  // Tag component  
const OutputNeuron = {};  // Tag component

// Weight data stored in relationships
const ConnectsTo = createRelation({
  store: () => ({
    weight: new Float32Array(1000000),      // Connection weights
    gradient: new Float32Array(1000000),    // Weight gradients
  })
});
```

## Systems

```typescript
// Forward propagation
const ForwardPassSystem = (world) => {
  // Layer 0 → Layer 1
  const hidden = query(world, [HiddenNeuron, NeuronValue]);
  for (const neuron of hidden) {
    let sum = NeuronValue.bias[neuron];
    
    // Sum all incoming connections
    const inputs = getRelationTargets(world, neuron, ConnectsTo);
    for (const input of inputs) {
      sum += NeuronValue.activation[input] * ConnectsTo(input).weight[neuron];
    }
    
    // ReLU activation
    NeuronValue.activation[neuron] = Math.max(0, sum);
  }
  
  // Layer 1 → Layer 2 (with softmax)
  // Similar process...
};

// Backpropagation
const BackpropSystem = (world) => {
  // Calculate gradients layer by layer
  // Update weight gradients in relationships
};

// Weight update
const WeightUpdateSystem = (world) => {
  const learningRate = 0.01;
  // Update all weights using gradients
};
```

## The Numbers

For MNIST (28×28 images):
- **Input Layer**: 784 entities
- **Hidden Layer**: 128 entities  
- **Output Layer**: 10 entities
- **Total Neurons**: 922 entities
- **Connections**: 784×128 + 128×10 = **101,632 relationships**

## Why This Works

1. **Memory Efficiency**: SoA layout perfect for vectorized operations
2. **Cache Performance**: Sequential memory access patterns
3. **Parallelizable**: Each neuron computed independently
4. **Flexible**: Easy to add dropout, batch norm, etc. as components
5. **Debuggable**: Can inspect any neuron/weight as an entity

## Example Training Loop

```typescript
const trainNetwork = (world) => {
  for (let epoch = 0; epoch < 100; epoch++) {
    for (const batch of trainingData) {
      // Load input
      loadInputSystem(world, batch.images);
      
      // Forward pass
      executeSystem(world, 'ForwardPassSystem');
      
      // Calculate loss
      executeSystem(world, 'LossCalculationSystem');
      
      // Backward pass
      executeSystem(world, 'BackpropSystem');
      
      // Update weights
      executeSystem(world, 'WeightUpdateSystem');
    }
  }
};
```

## Advantages Over Traditional NN Libraries

1. **Transparency**: Every neuron and weight is inspectable
2. **Modularity**: Mix neural components with other ECS systems
3. **Experimentation**: Easy to try novel architectures
4. **Visualization**: Can render the network in real-time
5. **Integration**: Neural networks as part of larger simulations

## Real Performance?

While not as optimized as PyTorch/TensorFlow for pure training, ECS neural networks excel at:
- **Hybrid Systems**: Neurons that also have Position, Velocity, etc.
- **Explainable AI**: Track individual neuron behaviors
- **Novel Architectures**: Spiking networks, cellular automata hybrids
- **Living Networks**: Networks that grow/prune during runtime

## The God Agent Can Build This!

Given the prompt, the agent would:
1. Generate all necessary components
2. Create the relationship types for connections
3. Build the forward/backward propagation systems
4. Spawn all 922 neurons
5. Create 101,632 weighted connections
6. Implement the training loop
7. Run it to show it works!

This is the power of autonomous ECS generation!