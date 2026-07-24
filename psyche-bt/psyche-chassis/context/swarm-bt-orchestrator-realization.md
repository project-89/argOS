---
# PROJECT 89 DOCUMENT METADATA
doc_id: swarm-bt-realization-001
version: 1.0.0
last_updated: 2026-04-09
status: draft
author: Gemini Next
contributors: []

# DOCUMENT RELATIONSHIPS
parent_docs: []
child_docs: []
related_docs: []

# CONTENT CLASSIFICATION
domain: intelligence
sub_domain: architecture
keywords: swarm, behavior-tree, meta-learning, orchestrator

# SYNCHRONIZATION
last_sync: 2026-04-09
sync_notes: Initial capture of the Swarm-BT orchestrator realization
---

# Swarm-BT Orchestrator: Interpreting Swarms as Behavior Trees

## 1. The Core Realization: Orchestration as a Deterministic Graph
The fundamental breakthrough in this architecture is realizing that **multi-agent orchestration does not need to be hardcoded imperative logic**. 

Instead of standard procedural fallbacks (`if simple try single-shot, else spawn swarm, else escalate`), the entire multi-agent strategy is represented as an interpretable **Behavior Tree**. A convergent swarm is simply a deterministic sequence of custom BT nodes operating in parallel or sequence, sharing data through a structured Blackboard. 

This bridges the gap between "fuzzy" generative multi-agent systems and "rigid" classical AI determinism.

---

## 2. System Architecture Refactors

To enable long-running, highly parallel LLM calls directly inside a tree traversal without blocking the main thread or losing state context, the core architecture underwent two major structural upgrades:

1. **Fully Asynchronous Traversal**: 
   The entire Behavior Tree evaluator (`evaluator.ts`, `standard-nodes.ts`, `node-registry.ts`) was refactored to be fully `async`. This allows custom decorator nodes (like `retry` or `parallel`) to properly await asynchronous tool execution and multi-agent network responses.

2. **Structured Blackboard State Management**:
   Rather than relying purely on prompt-based history, nodes now share a structured `blackboard` object during evaluation. This allows a planning node to securely write its generated JSON plan to a specific memory register, which an execution node can immediately query without polluting the LLM context window.

---

## 3. Modular Swarm Nodes

The system introduces custom Behavior Tree nodes explicitly designed for multi-agent orchestration:

* **`SwarmPlanNode` (`swarm_plan`)**: 
  Spawns an independent swarm of agents to solve a complex problem in parallel, clusters their logic, measures agreement against a configurable `convergenceThreshold`, and writes the winning plan directly to the Blackboard.
* **`ExecutePlanNode` (`execute_plan`)**: 
  Retrieves a structured plan from the Blackboard and routes it to specialized execution swarms, managing state preservation across sequential steps.

---

## 4. Strategic Implications: Meta-Learning & Self-Improvement

Representing orchestration as a Behavior Tree unlocks advanced meta-learning capabilities for the system:

* **Dynamic Resizing**: The tree can dynamically modify the parameters of a `swarm_plan` node (e.g., increasing the instance count from 3 to 5) based on the detected complexity of a task.
* **Tree Mutability**: The cognitive engine can experiment by inserting new branches into its own orchestrator graph, testing new swarm management techniques, racing conditions, or validation strategies autonomously.
