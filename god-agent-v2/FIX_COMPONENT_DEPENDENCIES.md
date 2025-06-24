# Fixing Component Dependencies - Complete Guide

## The Core Problem

Every system error you're seeing follows this pattern:
```
ReferenceError: [ComponentName] is not defined
```

This happens because:
1. The system code uses a component (like `Thought`, `Synapse`, etc.)
2. But that component is NOT listed in `requiredComponents`
3. Only components in `requiredComponents` are available in the sandbox

## Real Examples From Your Errors

### NPCThoughtSystem
```javascript
// WRONG - Current
requiredComponents: ["Name", "NPCComponent"]
// Code tries to use: Thought component
// Result: ReferenceError: Thought is not defined

// CORRECT - Should be
requiredComponents: ["Name", "NPCComponent", "Thought"]
```

### NeuronActivationSystem
```javascript
// WRONG - Current  
requiredComponents: ["Neuron"]
// Code tries to use: Synapse component
// Result: ReferenceError: Synapse is not defined

// CORRECT - Should be
requiredComponents: ["Neuron", "Synapse"]
```

### AddThoughtSystem
```javascript
// WRONG - Current
requiredComponents: ["Name"]
// Code tries to use: Thought component
// Result: ReferenceError: Thought is not defined

// CORRECT - Should be
requiredComponents: ["Name", "Thought"]
```

## The Solution

### Quick Fix
Tell the God agent to fix specific systems:
```
Fix NPCThoughtSystem to include Thought in its required components
Fix NeuronActivationSystem to include Synapse in its required components
Fix AddThoughtSystem to include Thought in its required components
```

### Better: Global Fix
```
Check all systems and update their requiredComponents to include ALL components they reference in their code
```

### Best: Proactive Prevention
When creating new systems, be explicit:
```
Create a system that gives NPCs thoughts. 
It should use these components: Name, NPCComponent, Thought
Make sure ALL these components are in requiredComponents
```

## Why This Keeps Happening

The AI often:
1. Focuses on the "main" component (like `Neuron`)
2. Forgets to declare "secondary" components it queries or modifies
3. Doesn't realize the sandbox requires explicit declaration

## Technical Explanation

The sandbox injection works like this:

```javascript
// In system-executor.ts
for (const compName of requiredComponents) {
  const compDef = globalRegistry.getComponent(compName);
  if (compDef && compDef.component) {
    context[compName] = compDef.component; // Only these are available!
  }
}
```

If a component isn't in `requiredComponents`, it won't be in the context, so it's undefined.

## Verification

After fixing, you can verify with:
```
Inspect the NPCThoughtSystem and show me its requiredComponents
```

It should show ALL components the system uses in its code.