# Agent Simulation Todo List

## Unorganzied

[] - Seperate out systems into 2 loops
[] - Spawn subagents to handle tasks
[] - Options as to whether an agent can update its own goals

## Internal Stimuli & Perception System

Internal stimuli are how agents perceive their internal state (emotions, thoughts, goals, etc). These get processed into perceptions and experiences that agents can use based on relevance to their goals.

- [ ] Process internal stimuli alongside external stimuli
- [ ] Ensure actions generate internal cognitive stimuli

## Core Systems

- [ ] Clean up stimulus system, types, etc.
- [ ] Clean up LLM code and refactor into folder
- [ ] Create scalable relationship handling system
- [ ] Colocate component sync functionality with components
- [ ] Implement Prompt Manager
- [ ] Simplify client messages to single type (type + content fields)
- [x] Refactor perception/experience systems
- [x] Clean up action system

## Agent Capabilities

- [ ] Support agents across multiple rooms
- [ ] Enable physical actions perceived by other agents
- [ ] Add goals and planning
- [ ] Enable agent collaboration toward goals
- [ ] Add world perception (sight, sound, smell, etc)
- [x] Handle appearance with relationships
- [x] Show realtime appearance data
- [x] Improve agent alternation handling

## World & Time

- [ ] Implement global simulation time
- [ ] Add time control system
- [ ] Generate initial world from text prompt
- [ ] Model world as entity relationships
- [ ] Create narrative agent for world modification

## Memory & Tools

- [ ] Add core agent memories (childhood, etc)
- [ ] Create world modification/query tools
- [ ] Add tools for agents to create channels
- [ ] Add tools for agents to create new agents
- [ ] Implement long-term DB persistence

## Discord Integration
- [x] Add discord.js library
- [x] Create Discord service to connect to Discord
- [x] Implement !report command to trigger a report
- [x] Create a reporting system to gather data and send reports
- [x] Integrate reporting system into the simulation
