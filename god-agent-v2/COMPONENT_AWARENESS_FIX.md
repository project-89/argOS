# Component Awareness Fix

## Problem
The God Agent was creating systems that couldn't find components because:
1. Components were being created with names like `EnergyComponent`, `PositionComponent`
2. Systems were trying to reference them as `Energy`, `Position`
3. The AI had no visibility into what components actually existed

## Root Cause
System generation prompts did NOT include the list of available components from the registry. The AI was essentially blind to what components existed and had to guess names.

## Solution Implemented

### Updated System Generation
All system generation actions now inject the list of available components:

```typescript
// Get list of all available components
const availableComponents = globalRegistry.listComponents();
const componentDescriptions = availableComponents.map(name => {
  const comp = globalRegistry.getComponent(name);
  const props = comp?.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
  return `  - ${name} (${props})`;
}).join('\n');

// Add to prompt
## AVAILABLE COMPONENTS IN THE SYSTEM:
${componentDescriptions}

## IMPORTANT: You MUST use the exact component names from the available list above!
```

### Files Updated
1. `generate-system.ts` - Shows available components when creating systems
2. `generate-llm-system.ts` - Shows available components for LLM systems
3. `modify-system.ts` - Shows available components when modifying systems

## Impact

Now the AI can:
- ✅ See all registered components with their properties
- ✅ Use exact component names instead of guessing
- ✅ Avoid "Required component X does not exist" errors
- ✅ Make informed decisions about which components to use

## Example Output

When generating a system, the AI now sees:
```
## AVAILABLE COMPONENTS IN THE SYSTEM:
  - Position (x: number, y: number, z: number)
  - Velocity (dx: number, dy: number, dz: number)
  - Health (current: number, max: number)
  - Plant (species: string, age: number)
  - GrowthRate (rate: number)
  - FoodLevel (amount: number)

## IMPORTANT: You MUST use the exact component names from the available list above!
```

## Testing

Try creating a simulation now:
```
Create a plant ecosystem with growing plants
```

The systems should now correctly reference the actual component names!