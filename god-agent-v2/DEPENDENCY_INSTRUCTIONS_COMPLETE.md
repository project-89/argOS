# Complete Dependency Instructions Update

## What Was Missing

We were NOT being explicit enough about component dependencies. The AI was creating systems that failed with `ReferenceError` because it didn't understand the critical rule:

**EVERY component referenced in system code MUST be in requiredComponents**

## What We Fixed

### 1. Tool Parameter Descriptions
Updated the tool definitions to emphasize dependencies:
- `requiredComponents: 'ALL components the system will use in its code (for queries, property access, etc). Missing components cause ReferenceErrors!'`

### 2. System Generation Prompts
Added explicit section in all prompts:
```
## CRITICAL REQUIREMENT FOR requiredComponents:
The requiredComponents array MUST include EVERY component that your system code references.
If your system uses query(world, [A, B]) or accesses A.x[eid] or hasComponent(world, eid, C), 
then A, B, and C MUST ALL be in requiredComponents: ["A", "B", "C"]

Example: If your system code contains:
- query(world, [Position, Velocity])
- Neuron.charge[eid] 
- hasComponent(world, eid, Synapse)
Then requiredComponents MUST be: ["Position", "Velocity", "Neuron", "Synapse"]

REMEMBER: Any component not in requiredComponents will be undefined and cause a ReferenceError!
```

### 3. Modify System Prompt
Added specific guidance for fixing dependency errors:
```
Common Fix: If you see "ReferenceError: ComponentName is not defined", add ComponentName to requiredComponents!
```

## Files Updated

1. `autonomous-god.ts` - Tool parameter descriptions now emphasize "ALL components"
2. `generate-system.ts` - Added CRITICAL REQUIREMENT section
3. `generate-llm-system.ts` - Added CRITICAL REQUIREMENT section  
4. `modify-system.ts` - Added common fix guidance

## Impact

Now the AI:
- ✅ Understands it must list ALL components used in code
- ✅ Has clear examples of what "used in code" means
- ✅ Knows exactly how to fix ReferenceErrors
- ✅ Won't create systems with missing dependencies

## Testing

Try creating a simulation now - the systems should include all necessary components in their requiredComponents arrays from the start!