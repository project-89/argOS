# Tool System in TinySim

The tool system in TinySim represents a sophisticated approach to modeling how agents interact with and use objects in their environment. Unlike simple inventory systems, our tool system models not just possession, but understanding, capability, and mastery of tools.

## Understanding Tools

In TinySim, a tool isn't just an object - it's a capability enhancer that changes what an agent can do. When an agent picks up a hammer, they don't just possess a hammer-shaped object; they gain the ability to drive nails, remove nails, and potentially even use it as a lever or weight. This rich modeling of tool capabilities enables emergent behaviors and creative tool use.

## Tool Components

The tool system is built on several specialized components:

### ToolCapability Component

This component defines what a tool can do. For example, a hammer might have capabilities like:

    import { defineComponent } from 'bitecs'

    export const ToolCapability = defineComponent({
        primaryFunction: [] as number[],    // e.g., HAMMER_STRIKE
        secondaryFunctions: [] as number[], // e.g., PRY, WEIGHT
        effectiveness: [] as number[],      // How well it performs its functions
        durability: [] as number[],         // How much use it can take
        complexity: [] as number[]          // How difficult it is to use effectively
    })

### ToolUser Component

This component tracks an agent's ability to use different types of tools:

    export const ToolUser = defineComponent({
        skillLevels: [] as number[],      // Proficiency with different tool types
        experiencePoints: [] as number[],  // Learning progress with tools
        preferredTools: [] as number[],    // Tools the agent is most comfortable with
        toolMemory: [] as number[]         // Past experiences with tools
    })

## Tool Usage Systems

The tool system is managed by several specialized systems that work together:

### ToolInteractionSystem

This system manages how agents interact with tools. It handles:

- Tool discovery and recognition
- Picking up and putting down tools
- Basic tool manipulation
- Tool state updates

Here's a simplified example:

    export const ToolInteractionSystem = defineSystem((world) => {
        const toolUsers = query(world, [ToolUser, Position, Attention])
        const tools = query(world, [ToolCapability, Position])

        for (const userId of toolUsers) {
            // Check if agent is near any tools
            const nearbyTools = findNearbyTools(world, userId, tools)

            // Update tool awareness
            updateToolAwareness(world, userId, nearbyTools)

            // Handle tool interaction attempts
            processToolInteractions(world, userId)
        }

        return world
    })

### ToolLearningSystem

This sophisticated system models how agents learn to use tools better over time:

    export const ToolLearningSystem = defineSystem((world) => {
        const toolUsers = query(world, [ToolUser, Memory])

        for (const userId of toolUsers) {
            // Process recent tool use experiences
            const experiences = getRecentToolExperiences(world, userId)

            // Update skill levels based on experiences
            for (const exp of experiences) {
                updateToolSkill(world, userId, exp)
            }

            // Consolidate tool knowledge
            consolidateToolMemory(world, userId)
        }

        return world
    })

## Tool Categories

TinySim supports various categories of tools, each with their own characteristics:

### Physical Tools

Tools that interact with the physical world:

- Hammers, screwdrivers, wrenches
- Cutting tools
- Construction tools
- Measuring tools

### Information Tools

Tools that help process or store information:

- Books and documents
- Computers and devices
- Communication tools
- Analysis tools

### Social Tools

Tools that facilitate social interaction:

- Communication devices
- Social media platforms
- Meeting spaces
- Collaboration tools

## Advanced Tool Features

### Tool Composition

Tools can be composed to create more complex tools:

    export const CompositeTool = defineComponent({
        components: [] as number[],     // Component tool entities
        assembly: [] as number[],       // How components fit together
        compositeFunctions: [] as number[] // New functions from composition
    })

### Tool States

Tools can exist in different states:

    export const ToolState = defineComponent({
        condition: [] as number[],      // Current physical condition
        configuration: [] as number[],  // How the tool is currently set up
        availability: [] as number[],   // Whether the tool can be used
        activeEffects: [] as number[]   // Any ongoing effects
    })

### Tool Knowledge Transfer

Agents can learn about tools from other agents:

    export const ToolTeaching = defineSystem((world) => {
        const teachingPairs = query(world, [TeacherStudent, ToolKnowledge])

        for (const pairId of teachingPairs) {
            const teacher = TeacherStudent.teacher[pairId]
            const student = TeacherStudent.student[pairId]

            // Transfer tool knowledge
            transferToolKnowledge(world, teacher, student)

            // Update learning progress
            updateLearningProgress(world, student)
        }

        return world
    })

## Integration with Other Systems

The tool system integrates deeply with other TinySim systems:

### Cognitive Integration

Tools become part of an agent's understanding of the world:

- Tools are represented in semantic memory
- Tool use experiences are stored in episodic memory
- Tool proficiency affects confidence and decision-making

### Social Integration

Tool use has social implications:

- Tool sharing and lending
- Teaching and learning tool use
- Collaborative tool use
- Tool-based status and hierarchy

### Environmental Integration

Tools interact with the environment:

- Tools can modify the environment
- Environmental conditions affect tool effectiveness
- Tool availability depends on location
- Tools can wear out or break

## Example Scenarios

Let's look at some complex tool use scenarios:

### Learning to Use a New Tool

    examples/tools/tool_learning.ts

### Collaborative Tool Use

    examples/tools/collaborative_tools.ts

### Tool Innovation

    examples/tools/tool_innovation.ts

These examples demonstrate how the tool system enables rich, emergent behaviors in TinySim simulations.
