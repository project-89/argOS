# Event System in TinySim

The Event System is the nervous system of our simulation, enabling complex interactions and coordinated behaviors across all other systems. Unlike simple message passing, TinySim's event system provides sophisticated event propagation, temporal management, and causal tracking.

## Understanding Events

In TinySim, events aren't just messages - they're rich objects that capture the full context of what's happening in the simulation. When an agent picks up a tool, for instance, this isn't just a state change. It's an event that carries information about:

- Who initiated the action
- What exactly happened
- When it occurred
- Where it took place
- How it happened
- What other entities were involved
- What conditions enabled it
- What immediate effects it had

This rich contextual information enables sophisticated event processing and reaction systems.

## Core Event Components

### EventData Component

This component stores the fundamental event information:

    export const EventData = defineComponent({
        // Core event data
        type: [] as number[],           // What kind of event
        timestamp: [] as number[],      // When it occurred
        priority: [] as number[],       // How urgent/important
        duration: [] as number[],       // How long it lasts

        // Event context
        location: [] as number[],       // Where it happened
        initiator: [] as number[],      // Who/what started it
        targets: [] as number[],        // Who/what it affects

        // Event metadata
        causality: [] as number[],      // What caused this event
        consequences: [] as number[],    // What this event caused
        probability: [] as number[]      // How likely it was
    })

### EventProcessing Component

This component manages how events are handled:

    export const EventProcessing = defineComponent({
        // Processing state
        status: [] as number[],         // Current processing stage
        handlers: [] as number[],       // Who needs to process it
        responses: [] as number[],      // Collected responses

        // Processing metadata
        startTime: [] as number[],      // When processing began
        deadline: [] as number[],       // When it must complete
        attempts: [] as number[],       // Processing attempts made

        // Error handling
        errors: [] as number[],         // Any problems encountered
        fallbacks: [] as number[]       // Backup handlers
    })

## Event Processing Systems

### EventDispatchSystem

This system manages the core event lifecycle:

    export const EventDispatchSystem = defineSystem((world) => {
        const events = query(world, [EventData, EventProcessing])

        for (const eid of events) {
            // Check event validity
            if (!validateEvent(world, eid)) continue

            // Find relevant handlers
            const handlers = findEventHandlers(world, eid)

            // Dispatch to handlers
            for (const handler of handlers) {
                dispatchEvent(world, eid, handler)
            }

            // Track dispatch status
            updateEventStatus(world, eid)

            // Clean up completed events
            if (isEventComplete(world, eid)) {
                finalizeEvent(world, eid)
            }
        }

        return world
    })

### EventPropagationSystem

This system handles how events spread through the simulation:

    export const EventPropagationSystem = defineSystem((world) => {
        const activeEvents = query(world, [
            EventData,
            EventPropagation
        ])

        for (const eid of activeEvents) {
            // Calculate propagation scope
            const scope = calculatePropagationScope(world, eid)

            // Find affected entities
            const affected = findAffectedEntities(world, eid, scope)

            // Apply event effects
            for (const target of affected) {
                applyEventEffects(world, eid, target)
            }

            // Update propagation state
            updatePropagationState(world, eid)

            // Generate secondary events
            generateSecondaryEvents(world, eid)
        }

        return world
    })

## Event Types and Hierarchies

Events in TinySim are organized into a sophisticated hierarchy:

### Physical Events

- Movement events
- Collision events
- State change events
- Environmental events

### Social Events

- Interaction events
- Relationship events
- Group dynamics events
- Communication events

### Cognitive Events

- Decision events
- Emotional events
- Memory events
- Learning events

### System Events

- Component updates
- Entity lifecycle events
- Resource management events
- Error events

## Temporal Event Management

The event system includes sophisticated temporal management:

### EventSchedulingSystem

    export const EventSchedulingSystem = defineSystem((world) => {
        const scheduledEvents = query(world, [
            EventData,
            EventSchedule
        ])

        for (const eid of scheduledEvents) {
            // Check timing conditions
            if (isEventDue(world, eid)) {
                // Activate the event
                activateScheduledEvent(world, eid)

                // Generate any follow-up schedules
                scheduleFollowupEvents(world, eid)
            }

            // Update schedule status
            updateScheduleStatus(world, eid)
        }

        return world
    })

## Event Causality Tracking

One of the most powerful features is causal chain tracking:

### CausalityTrackingSystem

    export const CausalityTrackingSystem = defineSystem((world) => {
        const events = query(world, [
            EventData,
            CausalityTracking
        ])

        for (const eid of events) {
            // Update causal chains
            updateCausalChains(world, eid)

            // Track consequences
            trackEventConsequences(world, eid)

            // Analyze patterns
            analyzeCausalPatterns(world, eid)

            // Update predictive models
            updatePredictiveModels(world, eid)
        }

        return world
    })

## Integration Examples

### Tool Use Event Chain

    const toolUseEvent = createEvent(world, {
        type: EventTypes.TOOL_USE,
        initiator: agentId,
        tool: toolId,
        // ... other event data
    })

    // Event chain might include:
    // 1. Tool pickup
    // 2. Tool configuration
    // 3. Tool application
    // 4. Effect generation
    // 5. Tool state update
    // 6. Experience recording

### Social Interaction Event Chain

    const socialEvent = createEvent(world, {
        type: EventTypes.SOCIAL_INTERACTION,
        initiator: agent1Id,
        target: agent2Id,
        // ... other event data
    })

    // Event chain might include:
    // 1. Initial contact
    // 2. Emotional response
    // 3. Communication
    // 4. Relationship update
    // 5. Memory formation
    // 6. Goal updates

[Continue with more examples and advanced features...]
