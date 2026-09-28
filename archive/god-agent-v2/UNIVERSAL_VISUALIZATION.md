# Universal Visualization System

## Problem Solved

You identified two key limitations with traditional visualization:

1. **No data showing** - The web dashboard was too rigid, looking for specific component patterns
2. **Spatial limitation** - Visualizations shouldn't assume x,y coordinates for all simulations

## Solution: Multi-Modal Visualization

We've created two complementary visualization systems that work for **any** ECS simulation:

### 1. 🌐 Web Dashboard (Generic)
- **Port**: 8080-8081 (configurable)
- **Features**: Real-time 2D view, thought bubbles, system monitoring
- **Best for**: Spatial simulations, mouse interaction, detailed inspection

### 2. 🖥️ Terminal ASCII Visualizer (Universal)
- **Works everywhere**: No browser needed, works over SSH, in any terminal
- **Completely generic**: Shows ANY components, ANY entities, ANY systems
- **Beautiful ASCII**: Colored boxes, borders, icons, live updates
- **Perfect for**: Abstract simulations, debugging, server environments

## Terminal Visualization Features

```
╔═══════════════════════════════════════════════════════════════╗
║                 GOD AGENT SIMULATION VIEWER                  ║
╚═══════════════════════════════════════════════════════════════╝

⏰ 12:54:23 │ 🌍 5 entities │ ⚙️ 3 systems │ 🤖 2 AI-powered

ENTITIES:
────────────────────────────────────────────────────────────────
👤 Entity 1 (npc)
  └─ NPCMind: personality="curious baker", thoughts="I wonder..."
  └─ Position: x=200, y=150

🐾 Entity 2 (animal)  
  └─ AnimalMind: species="rabbit", hunger=3, fear=1

👑 Entity 3 (god)
  └─ GodMode: level=100, power=999

SYSTEMS:
────────────────────────────────────────────────────────────────
🤖 NPCConsciousnessSystem [ASYNC]
  └─ Uses: NPCMind, Position, Dialogue

⚙️ MovementSystem
  └─ Uses: Position, Velocity

RECENT AI THOUGHTS:
────────────────────────────────────────────────────────────────
💭 Entity 1 (2s ago): I should greet Bob at the blacksmith...
💭 Entity 2 (5s ago): That human looks friendly, maybe...
```

## How It Works

### Universal Entity Detection
```typescript
// Doesn't assume specific properties - finds ANY component data
for (const prop in component) {
  if (component[prop] && Array.isArray(component[prop])) {
    const value = component[prop][entityId];
    if (value !== undefined && value !== 0) {
      // Found data! Display it.
    }
  }
}
```

### Smart Type Detection
- 👤 **NPCs**: Any component with "npc" or "mind" in name
- 🐾 **Animals**: Components with "animal" in name  
- 👑 **God**: Components with "god" in name
- 📦 **Objects**: Everything else
- 🤖 **LLM Systems**: Systems with `usesLLM: true`

### Works For Any Simulation Type

#### ✅ Spatial Simulations
- Village with NPCs moving around
- Physics simulations with particles
- Game worlds with players and objects

#### ✅ Abstract Simulations  
- Knowledge graphs with concepts
- Neural networks with neurons
- Economic models with agents
- Philosophical idea networks
- AI reasoning chains

#### ✅ Mixed Simulations
- Characters with both physical and mental properties
- Hybrid spatial-conceptual worlds
- Multi-dimensional state spaces

## Usage

### Quick Start
```bash
# Terminal visualization (works anywhere)
npx tsx demo-terminal-viz.ts

# Web visualization (browser required)  
npx tsx demo-visualization.ts
```

### Integration
```typescript
import { startTerminalVisualization } from './src/visualization/terminal-visualizer.js';

const god = createAutonomousGod();
startTerminalVisualization(god.world, {
  refreshRate: 1000,    // 1 second updates
  maxEntities: 20,      // Show up to 20 entities
  showThoughts: true,   // Display AI thoughts
  showSystems: true,    // Show system info
  compact: false        // Full detail mode
});
```

## Benefits

### 🎯 **Universal Compatibility**
- Works with ANY ECS structure
- No assumptions about component names or properties
- Automatically adapts to new component types

### 🚀 **Performance**
- Lightweight terminal rendering
- Configurable refresh rates
- Handles large simulations gracefully

### 🎨 **Beautiful Display**
- Colored ASCII art with Unicode symbols
- Clear hierarchical information display
- Real-time updates with smooth refresh

### 🔧 **Developer Friendly**
- Great for debugging ECS systems
- Works over SSH for remote development
- No browser dependencies

### 📊 **Comprehensive Information**
- Entity counts and types
- System activity monitoring  
- AI thought streams
- Component data inspection
- Performance metrics

## Future Enhancements

### Phase 1: Enhanced Interactivity
- Arrow key navigation between entities
- Detailed entity inspection mode
- System execution controls (pause/step)

### Phase 2: Advanced Displays
- Network graph ASCII rendering for relationships
- Timeline view for simulation history
- Performance profiling displays

### Phase 3: Integration Features
- Export to various formats (JSON, CSV, graphs)
- Screenshot/recording capabilities
- Integration with external monitoring tools

## Conclusion

The Universal Visualization System solves the fundamental problem of ECS visualization: **How do you show what you don't know exists?**

By being completely generic and adaptive, it can visualize:
- Simulations we haven't built yet
- Component structures we haven't designed  
- AI behaviors we haven't predicted
- Abstract concepts without physical form

This makes it the perfect companion for God Agent simulations, where the very nature of the simulation emerges from AI creativity rather than predetermined design.