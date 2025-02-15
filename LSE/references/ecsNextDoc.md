# Quick start

`bitECS` is a flexible toolkit for data-oriented design in game development. It offers core ECS concepts without imposing strict rules:

1. Entities are always represented as ID numbers.
2. Component stores can have any structure you prefer.
3. Systems can be implemented in various ways.

For optimal performance:
- Use a [Structure of Arrays (SoA) format](https://en.wikipedia.org/wiki/AoS_and_SoA) for components.
- Implement systems as a series of functions (function pipeline).

These practices enhance data locality and processing efficiency in your ECS architecture.

```ts
import { createWorld, addEntity, addComponent, query } from 'bitecs'

// Define components
const Position = {
x: [] as number[],
y: [] as number[],
}

// Create a world
const world = createWorld()

// Add an entity to the world
const entity = addEntity(world)

// Add component to entity
addComponent(world, Position, entity)

// Set initial values for Position component
Position.x[entity] = 0
Position.y[entity] = 0

// Define a system that moves entities with a Position component
const moveEntity = (world) => {
const entities = query(world, [Position])
    
for (const eid of entities) {
Position.x[eid] += 1
        Position.y[eid] += 1
        }
}

// Run system in a loop
const mainLoop = () => {
moveEntity(world)
    requestAnimationFrame(mainLoop)
    }

mainLoop()
```

## World

A world is a container for ECS data. Entities are created in a world and data is queried based on the existence and shape of entities in a world. Each world is independent of all others.

```ts
const world = createWorld()
```

### Options

`withContext` allows you to use any reference as the world object.

```ts
const world = createWorld(withContext({
    then: 0,
    delta: 0,
}))
```

`withEntityIndex` allows you to provide an entity index which can be used to share and EID space between worlds.

```ts
const entityIndex = createEntityIndex()
const worldA = createWorld(withEntityIndex(entityIndex))
const worldB = createWorld(withEntityIndex(entityIndex))

addEntity(worldA) // 1
addEntity(worldB) // 2
addEntity(worldA) // 3
```

## Entity

Entities are unique numerical identifiers, sometimes called entity IDs or eids for short. Entities are unique across all worlds, unless worlds have a shared entity index.

```ts
const eid = addEntity(world)
removeEntity(world, eid)
```

### Entity ID Recycling

Entity IDs are recycled immediately after removal.

```ts
... (339 lines left)