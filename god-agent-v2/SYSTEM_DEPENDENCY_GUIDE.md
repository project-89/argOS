# System Component Dependency Guide

## The Problem You're Experiencing

The error `ReferenceError: Synapse is not defined` happens because:
1. The `NeuronActivationSystem` uses the `Synapse` component in its code
2. But `Synapse` is NOT listed in `requiredComponents: ["Neuron"]`
3. Only components in `requiredComponents` are injected into the system sandbox

## How the Sandbox Works

When a system executes, it runs in a sandboxed environment where:
- ✅ BitECS functions are available (query, addEntity, etc.)
- ✅ Components listed in `requiredComponents` are available
- ❌ Components NOT in `requiredComponents` are undefined

## The Fix

Systems must declare ALL components they use:

### ❌ Wrong (current):
```javascript
generateSystem({
  name: "NeuronActivationSystem",
  requiredComponents: ["Neuron"],  // Missing Synapse!
  behavior: "Check synapses and fire neurons"
});

// System code tries to use:
const synapses = query(world, [Synapse]); // ERROR: Synapse is not defined
```

### ✅ Correct:
```javascript
generateSystem({
  name: "NeuronActivationSystem", 
  requiredComponents: ["Neuron", "Synapse"],  // Include ALL used components
  behavior: "Check synapses and fire neurons"
});

// Now system can use:
const synapses = query(world, [Synapse]); // Works!
```

## Quick Fix Commands

Tell the God agent:
```
Fix the NeuronActivationSystem to include Synapse in its required components
```

Or more generally:
```
Check all systems and ensure they declare all components they use in their requiredComponents
```

## Why This Happens

The AI sometimes:
1. Creates a system that queries multiple components
2. But only lists the "main" component in requirements
3. Forgets to include secondary components like relationships

## Best Practice

When creating systems, always specify ALL components:
```
Create a system that processes neurons and their synapses.
Required components should be: Neuron, Synapse, Signal
```

This ensures the system has access to everything it needs!