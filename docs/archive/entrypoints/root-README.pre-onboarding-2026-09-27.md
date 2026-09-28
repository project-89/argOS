# Project 89 - ArgOS

> 🚀 **Cutting-Edge Experimental Technology**
>
> ArgOS represents the bleeding edge of autonomous agent architectures, pushing the boundaries of what's possible in artificial consciousness and emergent behavior. This is highly experimental technology that explores uncharted territories in cognitive architectures and multi-agent systems.
>
> ⚠️ **Note**: This project is in active development and should be considered alpha software. Features and APIs may change rapidly as we discover new approaches and paradigms.

A sophisticated agent simulation system built on BitECS, featuring autonomous agents with advanced cognitive architectures, capable of dynamic interactions, self-spawning, and emergent narrative generation.

## Overview

ArgOS is an experimental platform for creating and running autonomous agent simulations. It represents a radical departure from traditional AI architectures, implementing a novel cognitive framework that enables genuine agent autonomy and emergence.

### Key Innovations

- **Cognitive Architecture**: A groundbreaking approach to agent consciousness that goes beyond simple prompt-response patterns
- **Emergent Behavior**: Agents develop their own personalities, relationships, and narratives through dynamic interactions
- **Scalable Architecture**: Built on BitECS for unprecedented performance in large-scale agent simulations
- **Memory Systems**: Advanced hierarchical memory structures that enable genuine learning and adaptation

### Future Trajectory

ArgOS is evolving towards becoming a complete framework for artificial consciousness research and autonomous agent development. Our roadmap includes:

- **Artificial Consciousness**: Developing deeper models of self-awareness and consciousness
- **Emergent Societies**: Enabling large-scale agent interactions that form complex social structures
- **Cross-Reality Integration**: Bridging virtual and physical worlds through agent embodiment
- **Autonomous Evolution**: Allowing agents to modify their own cognitive architectures
- **Narrative Intelligence**: Creating rich, dynamic storylines through agent interactions

### Use Cases

- **Research**: Studying emergence, consciousness, and collective intelligence
- **Gaming & Entertainment**: Creating dynamic, evolving narratives and characters
- **Social Simulation**: Modeling complex human systems and behaviors
- **Training & Education**: Developing adaptive learning environments
- **Creative Applications**: Generating stories, art, and other creative works through agent collaboration

## Current Features

- **Entity Component System (BitECS)**

  - Efficient agent state management
  - Component-based architecture
  - Fast query system

- **Agent Systems**

  - Thinking System (cognitive processing)
  - Room System (environment management)
  - Action System (behavior execution)
  - Perception System (stimuli processing)

- **Memory Management**

  - Thought history
  - Experience tracking
  - Context awareness

- **Action Framework**
  - Speech capabilities
  - Environment interaction
  - Tool usage system

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Run the basic conversation example:

```bash
npm run start
```

This will start a simulation with two agents in a room, demonstrating basic interaction capabilities.

Some features may require the project to be built before running. Use the following command to compile TypeScript (if applicable):

```bash
npm run build
```

## Cloning the Repository

```bash
git clone https://github.com/project-89/argOS.git
```

Navigate to the project directory:

```bash
cd argOS
```

## Configuring the Environment

Environment Variables:

1. Check if the repository includes a .env.example file. If so, rename it to .env:

```bash
cp .env.example .env
```

2. Populate the .env file with the required values. For example:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
```

## Architecture

The system is built on several core components:

1. **World State**

   - Resource management
   - Narrative state tracking
   - Population management

2. **Agent Components**

   - Core agent properties
   - Memory systems
   - Action capabilities
   - Relationship tracking

3. **Systems**
   - Cognitive processing
   - Environmental interaction
   - Action execution
   - State management

For a detailed architectural overview, see `DESIGN_DOC.md`.

## Development Status

Currently implemented:

- [x] Basic agent interactions and conversations
- [x] Simple Thought generation with LLM integration
- [x] Basic Environment awareness and room system
- [x] Basic action and perception system
- [x] Simple Memory tracking (thoughts and experiences)
- [x] Speech and examination tools

In progress:

- [ ] Physical actions and body awareness
- [ ] Enhanced agent perception (sight, sound, smell)
- [ ] Long term vector memory
- [ ] Goal setting and planning system
- [ ] Multi-agent coordination
- [ ] Core memory systems (childhood, significant experiences)
- [ ] Relationship formation and tracking

Planned features:

- [ ] Self-spawning capabilities (agent reproduction)
- [ ] Dynamic narrative generation
- [ ] World generation from text prompts
- [ ] World state as entity relationships
- [ ] Meta-agent for narrative control
- [ ] Tool system for world modification
- [ ] Long-term persistence and database integration
- [ ] Advanced memory hierarchies
  - Working memory
  - Episodic memory
  - Semantic memory
  - Procedural memory

## Running Examples

The project includes several example scenarios:

- `basic-conversation.ts`: Two agents engaging in basic interaction

## Contributing

This is an experimental project in active development. Feel free to explore and experiment with the codebase.

## License

MIT
