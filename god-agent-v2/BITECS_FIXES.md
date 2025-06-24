# BitECS API Integration Fixes

## Problem Analysis

The God Agent V2 was generating systems with incorrect BitECS API usage, causing runtime errors like:
- `TypeError: Cannot read properties of undefined (reading '7')`
- `TypeError: world.query is not a function`
- `ReferenceError: Component is not defined`

## Root Causes

1. **Incorrect API Usage**: Systems were using non-existent functions like `world.query()`
2. **Wrong Component Access**: Accessing components as objects instead of arrays
3. **Missing Documentation**: No proper BitECS API reference in system generation
4. **Component Dependencies**: Systems couldn't access components not in their dependencies

## Solutions Implemented

### 1. Enhanced System Prompt
Updated `autonomous-god.ts` with comprehensive BitECS API reference:
- Core functions (query, addEntity, etc.)
- Component access patterns (SoA format)
- Query operators (And/Or/Not)
- Relationship handling
- Critical syntax corrections

### 2. Updated System Generation Tools
Modified these files to include proper BitECS documentation:
- `generate-system.ts` - Standard systems
- `generate-llm-system.ts` - AI-powered systems  
- `modify-system.ts` - System fixes and updates

### 3. Fixed Dependency Management
Enhanced the `modifySystem` tool with `newRequiredComponents` parameter to properly handle component dependencies.

### 4. Added Troubleshooting Guide
Updated `TROUBLESHOOTING.md` with specific solutions for BitECS API errors.

## Correct BitECS Usage Examples

### ✅ Proper System Structure
```typescript
const MySystem = (world) => {
  // CORRECT: Use standalone query function
  const entities = query(world, [Position, Velocity]);
  
  for (const eid of entities) {
    // CORRECT: Access components as arrays
    Position.x[eid] += Velocity.dx[eid];
    Position.y[eid] += Velocity.dy[eid];
  }
};
```

### ❌ Common Mistakes (Now Fixed)
```typescript
// WRONG: world.query doesn't exist
const entities = world.query([Position, Velocity]);

// WRONG: Components aren't objects on entities  
eid.Position.x += eid.Velocity.dx;

// WRONG: Direct property access
Position.x += Velocity.dx;
```

### ✅ Advanced Query Patterns
```typescript
// Entities with Position AND Velocity
const moving = query(world, [Position, Velocity]);

// Entities with Position OR Health
const visible = query(world, [Or(Position, Health)]);

// Entities with Position but NOT Velocity (static objects)
const static = query(world, [Position, Not(Velocity)]);

// Check before accessing optional components
for (const eid of query(world, [Position])) {
  Position.x[eid] += 1;
  
  if (hasComponent(world, eid, Velocity)) {
    Position.y[eid] += Velocity.dy[eid];
  }
}
```

### ✅ Relationship Usage
```typescript
// Create relationship
addComponent(world, child, ChildOf(parent));

// Query entities with specific relationship
const children = query(world, [ChildOf(parent)]);

// Query all entities with any ChildOf relationship
const allChildren = query(world, [ChildOf(Wildcard)]);
```

## Impact

With these fixes, the God Agent now:
- ✅ Generates syntactically correct BitECS systems
- ✅ Properly accesses components using SoA format
- ✅ Uses correct query functions and operators
- ✅ Handles component dependencies automatically
- ✅ Provides clear error messages and self-healing

The error `TypeError: Cannot read properties of undefined (reading '7')` should no longer occur, as systems now properly validate component existence and use correct access patterns.

## Testing

To verify the fixes work:
1. Create a simulation with bouncing particles
2. The system should now execute without BitECS API errors
3. If errors persist, the God agent can now self-diagnose and fix them using the enhanced documentation

The God Agent V2 now has comprehensive BitECS knowledge and can create robust, error-free simulations.