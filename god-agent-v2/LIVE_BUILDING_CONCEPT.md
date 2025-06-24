# Live Building Mode Concept

## Current: Build Then Run
```
God> Create Position component
God> Create Velocity component  
God> Create MovementSystem
God> Create entity with Position/Velocity
God> runSystem MovementSystem 10  // Manual execution
```

## Option 1: Live Building Mode
```
God> /live on  // Start background simulation loop

God> Create Position component
God> Create Velocity component
God> Create MovementSystem     // Auto-starts running immediately
God> Create entity with Position/Velocity  // Starts moving immediately!

// You see position values changing in real-time as God builds
```

## Option 2: Build-and-Test Mode  
```
God> Create ecosystem simulation

// God autonomously:
// 1. Creates components
// 2. Creates systems  
// 3. Creates entities
// 4. Runs tests automatically
// 5. Shows "rabbit population: 50, grass coverage: 75%"
// 6. Continues building based on results
```

## Implementation for Live Mode

### Add to AutonomousGodState:
```typescript
export interface AutonomousGodState {
  world: World;
  godEid: number;
  messages: CoreMessage[];
  entityMap: Map<string, number>;
  mode: 'building' | 'simulating';
  liveMode: boolean;        // NEW
  gameLoop?: NodeJS.Timer;  // NEW
  tickRate: number;         // NEW
}
```

### Background Game Loop:
```typescript
function startLiveMode(god: AutonomousGodState) {
  if (god.gameLoop) return; // Already running
  
  god.liveMode = true;
  god.gameLoop = setInterval(() => {
    // Run all registered systems
    for (const systemName of globalRegistry.listSystems()) {
      try {
        executeSystem(god.world, systemName);
      } catch (error) {
        // Silent fail - don't interrupt God's building
      }
    }
  }, 1000 / god.tickRate); // 60 FPS default
}
```

### Auto-System Registration:
```typescript
// In generateSystem tool
export async function ecsGenerateSystem(...) {
  // ... existing code ...
  
  // If in live mode, start running the system immediately
  if (god.liveMode) {
    console.log(chalk.green(`🔄 System ${result.name} now running live!`));
  }
  
  return result;
}
```