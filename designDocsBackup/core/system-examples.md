# TinySim System Examples and Categories

While our system architecture document explains the theory, this guide provides concrete examples and a comprehensive listing of TinySim's systems. Understanding these systems and how they work together is crucial for building sophisticated simulations.

## Core Processing Systems

These fundamental systems handle the basic operations that keep our simulation running. They're the workhorses of TinySim, processing the most frequently updated components.

### MovementSystem

The MovementSystem demonstrates the elegance of ECS design. Here's a simplified version:

    import { defineSystem, defineQuery } from 'bitecs'
    import { Position, Velocity } from '../components'

    const movementQuery = defineQuery([Position, Velocity])

    export const MovementSystem = defineSystem((world) => {
        const entities = movementQuery(world)

        for (const eid of entities) {
            Position.x[eid] += Velocity.x[eid] * world.time.delta
            Position.y[eid] += Velocity.y[eid] * world.time.delta
        }

        return world
    })

This system is beautifully simple, yet it scales efficiently to handle thousands of moving entities. The separation of concerns means it doesn't need to know anything about what the entities are - they could be agents, projectiles, or floating debris.

### TransformSystem

Handles hierarchical transformations when entities are parented to others. For example, when a tool is held by an agent, its position needs to be updated relative to the agent's position and rotation:

    import { defineSystem, defineQuery } from 'bitecs'
    import { Transform, Parent } from '../components'

    const transformQuery = defineQuery([Transform, Parent])

    export const TransformSystem = defineSystem((world) => {
        const entities = transformQuery(world)

        for (const eid of entities) {
            const parentId = Parent.id[eid]
            Transform.worldX[eid] = Transform.localX[eid] + Transform.worldX[parentId]
            Transform.worldY[eid] = Transform.localY[eid] + Transform.worldY[parentId]
            Transform.worldRotation[eid] = Transform.localRotation[eid] + Transform.worldRotation[parentId]
        }

        return world
    })

### Other Core Systems

- **LifecycleSystem**: Handles entity creation and destruction
- **TagSystem**: Manages entity tags and categories
- **QuerySystem**: Optimizes and caches common queries
- **StateSystem**: Manages entity state machines

## Agent Systems

Agent systems are where TinySim's sophistication really shines. These systems work together to create believable, intelligent behavior.

### CognitiveSystem

The cognitive system orchestrates an agent's mental processes. Here's a glimpse at its complexity:

    import { defineSystem, defineQuery } from 'bitecs'
    import { CognitiveState, Memory, Attention, Goals } from '../components'

    const cognitiveQuery = defineQuery([CognitiveState, Memory, Attention, Goals])

    export const CognitiveSystem = defineSystem((world) => {
        const entities = cognitiveQuery(world)

        for (const eid of entities) {
            // Process sensory input
            processPerceptions(world, eid)

            // Update emotional state
            updateEmotions(world, eid)

            // Update memory
            consolidateMemories(world, eid)

            // Update goals based on current state
            updateGoals(world, eid)

            // Make decisions
            makeDecisions(world, eid)
        }

        return world
    })

### MemorySystem

The memory system handles both short-term and long-term memory management:

    import { defineSystem, defineQuery } from 'bitecs'
    import { Memory, Experience } from '../components'

    const memoryQuery = defineQuery([Memory, Experience])

    export const MemorySystem = defineSystem((world) => {
        const entities = memoryQuery(world)

        for (const eid of entities) {
            // Decay old memories
            decayMemories(world, eid)

            // Consolidate short-term to long-term memory
            consolidateMemories(world, eid)

            // Prune irrelevant memories
            pruneMemories(world, eid)

            // Link related memories
            linkMemories(world, eid)
        }

        return world
    })

### Other Agent Systems

- **EmotionalSystem**: Updates emotional states
- **AttentionSystem**: Manages focus and awareness
- **GoalSystem**: Handles goal generation and tracking
- **SocialSystem**: Manages relationships and interactions
- **PersonalitySystem**: Influences behavior based on traits
- **LearningSystem**: Updates knowledge and skills
- **DecisionSystem**: Makes choices based on current state

## Environmental Systems

Environmental systems create and manage the world our agents inhabit.

### PhysicsSystem

The physics system handles spatial relationships and physical interactions:

    import { defineSystem, defineQuery } from 'bitecs'
    import { Position, Collider, RigidBody } from '../components'

    const physicsQuery = defineQuery([Position, Collider, RigidBody])

    export const PhysicsSystem = defineSystem((world) => {
        // Update spatial partitioning
        updateSpatialGrid(world)

        const entities = physicsQuery(world)

        // Broad phase collision detection
        const potentialCollisions = broadPhaseCollision(world, entities)

        // Narrow phase collision detection and resolution
        resolveCollisions(world, potentialCollisions)

        // Update positions and velocities
        integratePhysics(world, entities)

        return world
    })

### Other Environmental Systems

- **WeatherSystem**: Simulates environmental conditions
- **PathfindingSystem**: Handles navigation and routing
- **ResourceSystem**: Manages world resources
- **TimeSystem**: Controls simulation time flow
- **VisibilitySystem**: Determines what entities can see
- **SoundSystem**: Handles audio propagation
- **TerrainSystem**: Manages world geometry

## System Interaction Examples

Let's look at how these systems work together in common scenarios:

### Tool Usage Scenario

When an agent uses a tool, multiple systems coordinate:

1. **DecisionSystem** decides to use the tool
2. **AttentionSystem** focuses on the tool
3. **MotorSystem** controls reaching and gripping
4. **TransformSystem** updates tool position
5. **ToolSystem** applies tool effects
6. **MemorySystem** records the experience

### Social Interaction Scenario

During a conversation between agents:

1. **PerceptionSystem** notices the other agent
2. **EmotionalSystem** updates emotional state
3. **SocialSystem** retrieves relationship data
4. **MemorySystem** recalls relevant information
5. **DecisionSystem** chooses responses
6. **CommunicationSystem** handles the interaction

These examples show how TinySim's systems work together to create complex, emergent behaviors from simple, focused components.
