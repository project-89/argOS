# Project 89 - ArgOS

A sophisticated agent simulation system built on BitECS, featuring autonomous agents with advanced cognitive architectures, capable of dynamic interactions, self-spawning, and emergent narrative generation.

## Overview

ArgOS is an experimental platform for creating and running autonomous agent simulations. It uses a custom cognitive architecture that enables agents to:

- Process sensory input and context
- Maintain different types of memory (working, episodic, semantic, procedural)
- Execute complex cognitive functions (planning, reasoning, decision making)
- Generate contextual responses and actions
- Maintain emotional states and belief systems
- Interact with other agents and their environment

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
- `thinking-agent.ts`: Demonstration of the cognitive architecture

## Contributing

This is an experimental project in active development. Feel free to explore and experiment with the codebase.

## License

MIT
