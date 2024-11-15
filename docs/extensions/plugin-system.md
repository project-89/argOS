# TinySim Plugin Architecture

The Plugin Architecture in TinySim provides a powerful and flexible way to extend the simulation's capabilities. Rather than modifying core systems, developers can create plugins that seamlessly integrate new behaviors, components, and systems.

## Understanding Plugins

A plugin in TinySim isn't just a module of code - it's a self-contained extension that can:

- Add new components and systems
- Modify existing system behavior
- Add new tools and capabilities
- Provide new types of relationships
- Extend agent cognitive abilities
- Add environmental features

## Core Plugin Structure

### Plugin Base Class

Every plugin extends the base plugin class:

    export class TinyPlugin {
        id: string
        version: string
        dependencies: string[]

        // Core lifecycle methods
        async initialize(world: World): Promise<void> {}
        async enable(): Promise<void> {}
        async disable(): Promise<void> {}
        async cleanup(): Promise<void> {}

        // Registration methods
        registerComponents(): Component[] {}
        registerSystems(): System[] {}
        registerTools(): Tool[] {}
        registerQueries(): Query[] {}
    }

### Plugin Manager

The plugin manager handles plugin lifecycle and dependencies:

    export const PluginManager = defineSystem((world) => {
        const plugins = getRegisteredPlugins(world)

        for (const plugin of plugins) {
            // Check plugin health
            validatePlugin(world, plugin)

            // Handle plugin state changes
            processPluginStateChanges(world, plugin)

            // Update plugin resources
            updatePluginResources(world, plugin)

            // Process plugin events
            handlePluginEvents(world, plugin)
        }

        return world
    })

## Creating Plugins

Here's an example of creating a custom plugin:

    export class WeatherPlugin extends TinyPlugin {
        constructor() {
            super()
            this.id = 'weather-system'
            this.version = '1.0.0'
            this.dependencies = ['core-environment']
        }

        registerComponents() {
            return [
                WeatherState,
                WeatherEffects,
                WeatherAwareness
            ]
        }

        registerSystems() {
            return [
                WeatherUpdateSystem,
                WeatherEffectSystem,
                WeatherPerceptionSystem
            ]
        }

        async initialize(world: World) {
            // Set up initial weather state
            initializeWeather(world)

            // Register weather events
            registerWeatherEvents(world)

            // Set up weather zones
            createWeatherZones(world)
        }
    }

## Plugin Integration

Plugins integrate deeply with TinySim's core systems:

### Component Integration

Plugins can add new components that work seamlessly with existing ones:

    export const WeatherAwareness = defineComponent({
        sensitivity: [] as number[],    // How affected by weather
        protection: [] as number[],     // Weather protection level
        adaptation: [] as number[]      // Ability to adapt to weather
    })

### System Integration

Plugin systems can interact with core systems:

    export const WeatherEffectSystem = defineSystem((world) => {
        const entities = query(world, [
            WeatherAwareness,
            Position,
            PhysicalState
        ])

        for (const eid of entities) {
            // Get local weather conditions
            const weather = getLocalWeather(world, eid)

            // Apply weather effects
            applyWeatherEffects(world, eid, weather)

            // Update entity state
            updateEntityWeatherState(world, eid)
        }

        return world
    })

## Plugin Communication

Plugins can communicate with each other and core systems:

### Event-Based Communication

    export const WeatherEventSystem = defineSystem((world) => {
        const weatherEvents = getWeatherEvents(world)

        for (const event of weatherEvents) {
            // Notify interested systems
            broadcastWeatherEvent(world, event)

            // Update affected areas
            updateAffectedAreas(world, event)

            // Trigger responses
            triggerWeatherResponses(world, event)
        }

        return world
    })

### Resource Sharing

    export const WeatherResourceSystem = defineSystem((world) => {
        const sharedResources = getSharedResources(world)

        // Update shared weather data
        updateWeatherResources(world, sharedResources)

        // Handle resource requests
        processResourceRequests(world)

        // Cleanup unused resources
        cleanupWeatherResources(world)

        return world
    })

## Best Practices

### Plugin Development Guidelines

1. **Isolation**: Plugins should be self-contained and minimize dependencies
2. **Performance**: Follow TinySim's performance patterns
3. **Documentation**: Provide clear documentation and examples
4. **Testing**: Include comprehensive tests
5. **Version Control**: Use semantic versioning
6. **Error Handling**: Implement robust error handling

### Plugin Testing

Example of plugin testing:

    describe('WeatherPlugin', () => {
        let world: World
        let plugin: WeatherPlugin

        beforeEach(() => {
            world = createWorld()
            plugin = new WeatherPlugin()
        })

        test('initializes correctly', async () => {
            await plugin.initialize(world)
            expect(getWeatherState(world)).toBeDefined()
        })

        test('handles weather changes', () => {
            const entity = addEntity(world)
            addComponent(world, entity, WeatherAwareness)

            updateWeather(world, 'rain')
            expect(getEntityWeatherEffects(world, entity))
                .toContain('wet')
        })
    })

## Plugin Distribution

Guidelines for distributing plugins:

1. Package Structure:
