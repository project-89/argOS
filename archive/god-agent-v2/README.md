# God Agent V2 - Dynamic ECS Generation System

A standalone proof-of-concept for AI agents that can dynamically generate Entity Component System (ECS) architectures using Large Language Models. This system demonstrates "Latent Space Extraction" - the idea that AI models contain simulations that can be extracted through proper prompting.

## Overview

God Agent V2 enables AI agents with varying levels of "creation power" to:
- Dynamically generate new ECS components from natural language descriptions
- Create new systems that operate on those components
- Build entire simulations from high-level specifications
- Inspect and understand existing ECS architectures

## Key Features

- **Dynamic Component Generation**: AI agents can create new BitECS components with proper Structure of Arrays (SoA) patterns
- **Dynamic System Generation**: AI agents can create new systems with behavior logic
- **Component Registry**: Centralized management of all dynamically created components and systems
- **Power Levels**: Different god agents have different creation capabilities
- **Safety Validation**: Generated code is validated for dangerous patterns
- **Full Introspection**: Deep inspection capabilities for world state analysis

## Architecture

### Core Components

- **GodMode**: Tracks god agent capabilities and creation statistics
- **Agent**: Basic agent identity and memory
- **DynamicComponent**: Metadata for AI-generated components
- **DynamicSystem**: Metadata for AI-generated systems

### God Agent Presets

1. **The Architect** (Level 100): Master of structure and systems
2. **Gaia** (Level 85): Nature and life systems specialist
3. **Plutus** (Level 70): Economics and resource systems
4. **Prometheus** (Level 60): Knowledge and learning systems
5. **Morpheus** (Level 50): Basic pattern creator

### Actions

- **ecsInspect**: Deep world introspection
- **ecsGenerateComponent**: Create new components from descriptions
- **ecsGenerateSystem**: Create new systems from behavior specifications

## Installation

```bash
# Clone the repository
cd god-agent-v2

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Add your Google AI API key to .env
GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
```

## Running Demos

```bash
# Run all tests
npm test

# Individual demos
npm run inspect      # Basic world inspection
npm run generate     # Component generation
npm run system       # System generation
npm run simulation   # Full ecosystem simulation
```

## Example Usage

### Creating a Component

```typescript
const healthResult = await ecsGenerateComponent(world, {
  description: 'A component to track entity health with current HP, max HP, and regeneration',
  constraints: [
    'Health should not go below 0',
    'Current health should not exceed maximum'
  ],
  examples: [
    'A player with 100/100 HP regenerating 1 HP per second',
    'A wounded enemy with 45/75 HP'
  ]
}, godAgent);
```

### Creating a System

```typescript
const movementResult = await ecsGenerateSystem(world, {
  description: 'A system that updates entity positions based on velocities',
  requiredComponents: ['Position', 'Velocity'],
  behavior: 'Add velocity to position each frame',
  constraints: ['Handle delta time', 'Wrap at world boundaries']
}, godAgent);
```

## Generated Code Examples

### Component (Health)
```typescript
export const Health = {
  currentHp: [] as number[],     // Current hit points
  maxHp: [] as number[],         // Maximum hit points
  regenRate: [] as number[],     // HP regeneration per second
};
```

### System (Movement)
```typescript
function MovementSystem(world) {
  const entities = query(world, [Position, Velocity]);
  
  for (const eid of entities) {
    const dt = world.dt || 1;
    Position.x[eid] += Velocity.x[eid] * dt;
    Position.y[eid] += Velocity.y[eid] * dt;
  }
}
```

## Current Limitations

1. **System Execution**: Generated systems are validated but not actually executed (sandboxing needed)
2. **Structured Generation**: Gemini sometimes struggles with complex schemas
3. **Component Relationships**: No dynamic relation generation yet
4. **Persistence**: No save/load functionality

## Future Improvements

- Implement safe system execution sandbox
- Add component evolution/modification
- Support for dynamic relations
- Multi-agent collaboration
- Persistent world serialization
- Visual debugging tools

## Technical Stack

- **BitECS**: Entity Component System framework
- **Google Gemini**: LLM for code generation
- **TypeScript**: Type-safe development
- **Zod**: Schema validation
- **Chalk**: Terminal styling

## Design Philosophy

God Agent V2 explores the concept that LLMs contain latent simulations that can be extracted through proper prompting. By giving AI agents the ability to create ECS architectures, we enable them to build their own worlds and systems, limited only by their "power level" and the quality of their design reasoning.

The system emphasizes:
- **Safety**: All generated code is validated
- **Modularity**: Components and systems are independent
- **Transparency**: Full introspection capabilities
- **Flexibility**: Natural language to code generation

## License

MIT