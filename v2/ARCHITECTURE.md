# ArgOS v2: Self-Evolving Cognitive Architecture

## Vision

An ECS-based cognitive substrate where LLM agents don't just *use* a fixed architecture—they *build* their own mental structures. The ECS provides composable primitives; the LLM provides intelligence and self-modification capabilities.

## Core Principles

### 1. ECS as Cognitive Substrate
Everything is entities, components, and relations. Thoughts, memories, beliefs, goals, perceptions—all are first-class ECS citizens that can be queried, related, and modified.

### 2. LLM as Architect
The LLM doesn't just respond to prompts. It has tools to:
- Create new types of mental constructs
- Build knowledge graph structures
- Define relationships between concepts
- Modify its own cognitive patterns

### 3. Unified Cognitive Stream
One continuous stream of cognitive events with full causal tracking. No fragmented systems writing to disconnected data stores.

### 4. Stimulus-Based Perception
All input arrives as typed stimuli with salience, source, and decay. The agent's attention system filters what gets processed.

### 5. Emergent Structure
The architecture starts minimal. Complex structures (memory hierarchies, belief systems, mental models) emerge from the agent's use of its tools.

---

## Core Components

### Mind
The central cognitive state of an agent. Contains:
- `stream`: Array of CognitiveEvents (the unified chain of thought)
- `attention`: Current focus and filters
- `arousal`: Overall cognitive activation level (affects processing depth)
- `mode`: Current cognitive mode (reactive, deliberative, reflective, creative)

```typescript
interface Mind {
  stream: CognitiveEvent[];
  attention: {
    focus: string | null;      // Current primary focus
    filters: string[];         // What to attend to
    capacity: number;          // How much can be processed
    saturation: number;        // Current load (0-1)
  };
  arousal: number;             // 0-1, affects processing
  mode: 'reactive' | 'deliberative' | 'reflective' | 'creative';
}
```

### CognitiveEvent
The universal unit of cognition. Everything that happens in the mind is a CognitiveEvent.

```typescript
interface CognitiveEvent {
  id: string;
  type: 'stimulus' | 'perception' | 'thought' | 'insight' | 'decision' | 'intention' | 'reflection';
  content: string;
  timestamp: number;
  
  // Causal chain
  causedBy: string[];          // IDs of events that led to this
  causes: string[];            // IDs of events this led to (updated later)
  
  // Salience and relevance
  salience: number;            // How attention-grabbing (0-1)
  relevance: number;           // How relevant to current focus (0-1)
  confidence: number;          // How certain (0-1)
  
  // Rich metadata
  metadata: Record<string, any>;
}
```

### Stimulus
External or internal input to the cognitive system.

```typescript
interface Stimulus {
  id: string;
  type: 'visual' | 'auditory' | 'proprioceptive' | 'interoceptive' | 'social' | 'memory' | 'thought';
  source: string;              // Where it came from
  content: string;             // The actual content
  
  // Temporal properties
  timestamp: number;
  duration: number;            // How long it lasts
  decay: number;               // How fast it fades (0-1 per second)
  
  // Attention properties
  salience: number;            // Intrinsic attention-grabbing quality
  urgency: number;             // Time-sensitivity
  novelty: number;             // How new/unexpected
  
  // Processing state
  processed: boolean;
  suppressedUntil?: number;    // Can be temporarily ignored
}
```

### Knowledge (Graph-Based)
Knowledge is stored as a graph of entities and relations. The LLM can create new node types, edge types, and structures.

```typescript
interface KnowledgeNode {
  id: string;
  type: string;                // LLM-definable types
  content: any;
  confidence: number;
  source: string;              // How we know this
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
}

interface KnowledgeEdge {
  id: string;
  type: string;                // LLM-definable relation types
  from: string;
  to: string;
  weight: number;
  confidence: number;
  metadata: Record<string, any>;
}
```

### Action
Output from the cognitive system to the world.

```typescript
interface Action {
  id: string;
  type: string;
  parameters: Record<string, any>;
  
  // Causal chain
  motivatedBy: string[];       // CognitiveEvent IDs that led to this
  expectedOutcome: string;
  
  // Execution state
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  actualOutcome?: string;
}
```

---

## The Cognitive Loop

One unified cycle that runs at adaptive intervals:

```
┌─────────────────────────────────────────────────────────┐
│                    COGNITIVE LOOP                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. RECEIVE                                              │
│     └─ Gather all active stimuli                         │
│                                                          │
│  2. ATTEND                                               │
│     └─ Filter by salience, relevance, capacity           │
│     └─ Update attention focus                            │
│                                                          │
│  3. PERCEIVE                                             │
│     └─ Transform stimuli into perceptions                │
│     └─ Link to relevant knowledge                        │
│     └─ Create CognitiveEvents                            │
│                                                          │
│  4. INTEGRATE                                            │
│     └─ Add to cognitive stream                           │
│     └─ Update causal links                               │
│     └─ Activate related knowledge                        │
│                                                          │
│  5. REASON (LLM)                                         │
│     └─ Process current cognitive state                   │
│     └─ Generate thoughts, insights, decisions            │
│     └─ Optionally modify architecture                    │
│                                                          │
│  6. ACT                                                  │
│     └─ Execute decided actions                           │
│     └─ Generate action stimuli (for self and others)     │
│                                                          │
│  7. LEARN                                                │
│     └─ Update knowledge graph                            │
│     └─ Strengthen/weaken connections                     │
│     └─ Consolidate important events to memory            │
│                                                          │
│  8. ADAPT                                                │
│     └─ Adjust loop timing based on cognitive load        │
│     └─ Shift mode if appropriate                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## LLM Architecture Tools

The LLM has access to tools that let it modify its own cognitive architecture:

### Knowledge Tools
- `createNodeType(name, schema)` - Define a new type of knowledge node
- `createEdgeType(name, schema)` - Define a new type of relation
- `addKnowledge(node)` - Add a knowledge node
- `linkKnowledge(from, to, type, weight)` - Create a relation
- `queryKnowledge(pattern)` - Query the knowledge graph
- `strengthenLink(edgeId, amount)` - Reinforce a connection
- `weakenLink(edgeId, amount)` - Weaken a connection

### Memory Tools
- `consolidate(eventIds, summary)` - Compress events into a memory
- `recall(query)` - Retrieve relevant memories
- `forget(nodeId)` - Mark knowledge for decay
- `protect(nodeId)` - Prevent decay of important knowledge

### Attention Tools
- `focus(target)` - Direct attention
- `addFilter(pattern)` - Add attention filter
- `removeFilter(pattern)` - Remove attention filter
- `suppress(stimulusId, duration)` - Temporarily ignore something

### Meta-Cognitive Tools
- `reflect(topic)` - Trigger deliberate reflection
- `setMode(mode)` - Change cognitive mode
- `createConstruct(name, schema)` - Create a new mental construct type
- `introspect()` - Examine own cognitive state

### World Tools
- `speak(content)` - Generate speech
- `act(action, params)` - Take physical action
- `observe(target)` - Direct attention to something
- `wait(reason)` - Explicitly choose to wait

---

## Adaptive Timing

The loop doesn't run at fixed intervals. Instead:

```typescript
function calculateNextLoopDelay(mind: Mind, stimuli: Stimulus[]): number {
  const baseDelay = 1000; // 1 second base
  
  // High arousal = faster processing
  const arousalFactor = 1 - (mind.arousal * 0.8); // 0.2 to 1.0
  
  // Urgent stimuli = faster processing
  const maxUrgency = Math.max(...stimuli.map(s => s.urgency), 0);
  const urgencyFactor = 1 - (maxUrgency * 0.9); // 0.1 to 1.0
  
  // High saturation = slower (overwhelmed)
  const saturationFactor = 1 + (mind.attention.saturation * 2); // 1.0 to 3.0
  
  // Mode affects timing
  const modeFactor = {
    reactive: 0.5,
    deliberative: 1.5,
    reflective: 2.0,
    creative: 1.0,
  }[mind.mode];
  
  return baseDelay * arousalFactor * urgencyFactor * saturationFactor * modeFactor;
}
```

---

## Example: Agent Builds Its Own Belief System

1. Agent receives stimuli about another agent's behavior
2. LLM decides to track beliefs about this agent
3. Uses `createNodeType('belief', { subject, predicate, object, confidence })`
4. Uses `createEdgeType('supports', { strength })` and `createEdgeType('contradicts', { strength })`
5. Adds beliefs as nodes, links supporting/contradicting evidence
6. Later, when reasoning, queries `queryKnowledge({ type: 'belief', subject: 'AgentX' })`
7. Updates beliefs based on new evidence using `strengthenLink` / `weakenLink`

The belief system wasn't pre-built—it *emerged* from the agent's use of its tools.

---

## Implementation Plan

### Phase 1: Core Foundation
- [ ] Basic ECS setup with BitECS
- [ ] Core components (Mind, Stimulus, Knowledge, Action)
- [ ] Unified cognitive loop
- [ ] Simple LLM integration

### Phase 2: LLM Tools
- [ ] Knowledge graph tools
- [ ] Memory tools
- [ ] Attention tools
- [ ] Meta-cognitive tools

### Phase 3: Adaptive Systems
- [ ] Dynamic loop timing
- [ ] Cognitive mode switching
- [ ] Salience-based attention

### Phase 4: Multi-Agent
- [ ] Stimulus propagation between agents
- [ ] Shared environment
- [ ] Social perception

### Phase 5: Emergence
- [ ] Let agents build complex structures
- [ ] Observe what patterns emerge
- [ ] Document and learn

---

## Key Differences from v1

| v1 | v2 |
|----|-----|
| Fragmented systems | Unified cognitive loop |
| Fixed components | LLM-extensible architecture |
| Time-based processing | Adaptive, load-based timing |
| Array-sliced memory | Graph-based knowledge with decay |
| Separate thought/perception/action | Continuous cognitive stream |
| LLM as brain | LLM as architect + reasoner |
| Pre-built structures | Emergent mental constructs |

---

## Philosophy

The goal isn't to pre-build a perfect cognitive architecture. It's to provide minimal, powerful primitives and let intelligence emerge from the agent's use of them.

We're not building a brain. We're building the substrate from which a brain can grow.
