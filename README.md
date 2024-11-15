# TinySim: ECS-Based Agent Simulation Framework

TinySim is a powerful Entity-Component-System (ECS) based framework for simulating intelligent agents in complex environments. Built on BitECS, it provides a flexible, performant foundation for creating realistic agent-based simulations.

## Key Features

- **ECS Architecture**: Built on BitECS for optimal performance and flexibility
- **Cognitive Agents**: Rich agent modeling with memory, emotions, and decision-making
- **Tool System**: Extensible tool framework for agent capabilities
- **Relationship Management**: Complex social and hierarchical relationships
- **Event System**: Robust event handling and temporal simulation
- **Plugin Architecture**: Easy extension through plugins and custom components

## Quick Start

### Installation

Install via npm:

    npm install tinysim

### Basic Usage

See examples/quickstart.ts for a basic example:

    examples/quickstart.ts

## Core Concepts

TinySim is built around several key concepts:

### Entities

- Unique numerical identifiers
- Can represent agents, objects, or abstract concepts
- Defined by their components

### Components

- Pure data containers
- Define entity attributes and capabilities
- Stored in efficient Structure of Arrays (SoA) format

### Systems

- Process entities with specific components
- Handle logic and behavior
- Run in a deterministic order

### Relationships

- Connect entities meaningfully
- Support hierarchies and complex social networks
- Enable dynamic interactions

## Documentation Structure

The documentation is organized into several key sections:

1. **Core Concepts**

   - ECS Architecture Overview
   - Component System
   - Entity Relationships
   - System Architecture

2. **Agent Architecture**

   - Cognitive Model
   - Memory Systems
   - Tool Usage
   - Social Interaction

3. **World Architecture**

   - State Management
   - Rule Systems
   - Event Handling
   - Time Management

4. **Tool System**

   - Tool Components
   - Tool Composition
   - Creating New Tools
   - Tool Integration

5. **Extension Guide**
   - Creating Components
   - Building Systems
   - Tool Development
   - Plugin Architecture

## Examples

Find complete examples in the /examples directory:

- Basic agent creation
- Multi-agent interactions
- Custom tool development
- Complex scenarios
- Performance optimization

## Contributing

We welcome contributions! Please see our Contributing Guide (docs/contributing/overview.md) for:

- Development setup
- Code standards
- Testing guidelines
- Documentation rules

## Performance Considerations

TinySim is designed for high performance:

- Uses Structure of Arrays (SoA) for optimal memory layout
- Efficient component queries
- Minimal garbage collection impact
- Support for parallel processing

## License

MIT License - see LICENSE file for details.

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: Comprehensive guides and API reference
- Community: Join our Discord for discussions

## Roadmap

See our project roadmap (docs/roadmap.md) for upcoming features and improvements.
