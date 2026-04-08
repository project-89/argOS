# Psyche-BT

Continuous learning agent architecture using behavior trees, plan compilation, and swarm convergence. Domain-agnostic framework for making cheap models smarter through structured experience.

**Core idea:** Expensive models reason once. The reasoning compiles into behavior trees and multi-step plans. Cheap models (Gemini Flash Lite) execute the compiled structure forever. A swarm of cheap instances explores variations, converges on the best approaches, and compiles them overnight. The system gets better every day without expensive models in the loop.

## Quick Start

```bash
cp .env.example .env
# Add your GOOGLE_GENERATIVE_AI_API_KEY

npm install

# Interactive chat — watch the BT learn in real-time
npm run chat

# Automated eval — measure learning over 20 turns
npm run eval

# Swarm convergence test — prove collective learning works
npx tsx src/cli/swarm.ts

# Nightly training — batch improvement for a person
npx tsx src/cli/nightly.ts --person=alice

# Run tests
npm test
```

## How It Works

```
User message arrives
     |
     v
  BT evaluates (compiled plans + strategies + bootstrap)
     |
     |-- MATCH: compiled plan    --> execute tool sequence      $0.0001
     |-- MATCH: compiled strategy --> Flash Lite generates      $0.0001
     |-- NO MATCH --> Runtime Swarm (8 Flash Lite instances)    $0.0008
     |       |-- CONVERGE --> deliver + record trace for compilation
     |       |-- NO CONVERGENCE --> fall through
     |-- LAST RESORT --> expensive model                        $0.01+
     |       --> captures decision for compilation
```

Three escalation tiers, each cheaper than the last. Every success at tier 2+ feeds tier 1: swarm successes become tomorrow's compiled plans.

## Architecture

### Compilation Targets

The system compiles expensive reasoning into three forms:

| Target | Compiles from | Flash Lite executes as |
|--------|--------------|----------------------|
| **Strategy** | Successful single response | Generation from intent + approach + tone |
| **Plan** | Multi-step tool sequence | Deterministic tool chain with variable binding |
| **Composed plan** | Sequence of named plans | Recursive sub-plan execution |

### Plan Composition (Voyager-style)

Plans compose into plans, enabling hierarchical skill building:

```
Level 0: Tools        file_read, draft, make_checklist, run_tests
Level 1: Plans        gather_notes = [file_read -> summarize]
Level 2: Composed     prepare_presentation = [gather_notes -> draft_outline -> make_checklist]
Level 3: Workflows    quarterly_cycle = [prepare_presentation -> schedule_meeting -> send_materials]
```

### Quality Control (Immune System)

Not everything compiles. Four gates prevent bad patterns:

- **Quality scoring** -- response must be relevant, appropriate, and helpful (>= 6.0/10)
- **Specificity scoring** -- conditions must be precise enough (>= 4 points)
- **Negative sentiment guard** -- user rejection blocks compilation
- **Swarm convergence** -- independent instances must agree (Condorcet's jury theorem)

### Swarm Learning

Parallel instances explore task variations. Convergent patterns (discovered independently by multiple instances) are strong quality signals. Two modes:

- **Nightly swarm** -- batch training, explores weak spots, merges species patterns
- **Runtime swarm** -- spawn-at-point-of-failure, 8 instances try different approaches in parallel

### Tree Maintenance

The nightly cycle also prunes and cleans the tree:
- Deduplicate conflicting branches (same conditions -> keep best)
- Prune stale branches (unused 30+ days or <30% success rate)
- Remove legacy noise (chance nodes from old compilation)

## Model Configuration

Uses the official Google Generative AI SDK (`@google/genai`):

```
Flash Lite (gemini-3.1-flash-lite-preview)  -->  Runtime: compiled plans + strategies
Flash (gemini-3-flash-preview)              -->  Reasoning: novel situations
Pro (gemini-3.1-pro-preview)                -->  Teacher: periodic deep analysis
```

Gemini-specific features: structured outputs (`responseSchema`), thinking (`thinkingConfig`), caching (`cachedContent`).

## CLI Commands (Interactive Chat)

| Command | Description |
|---------|-------------|
| `/stats` | Learning metrics (tree size, escalation rate, compiled branches) |
| `/tree` | Show the behavior tree structure |
| `/save` | Save agent state to disk |
| `/reset` | Start fresh |
| `/quit` | Exit (auto-saves) |

## CLI Tools

| Script | Purpose |
|--------|---------|
| `npx tsx src/cli/chat.ts` | Interactive chat with learning |
| `npx tsx src/cli/eval.ts` | 20-turn scripted evaluation |
| `npx tsx src/cli/benchmark.ts` | Benchmark suite with comparison |
| `npx tsx src/cli/swarm.ts` | Swarm convergence (hypotheses H1-H5) |
| `npx tsx src/cli/nightly.ts` | Nightly batch training |
| `npx tsx src/cli/battle-test.ts` | 6-battery stress test suite |
| `npx tsx src/cli/convergence-test.ts` | Cross-domain plan convergence |
| `npx tsx src/cli/paper-eval.ts` | Statistical evaluation for paper |
| `npx tsx src/cli/plan-demo.ts` | Plan compilation demo |
| `npx tsx src/cli/runtime-swarm-demo.ts` | Runtime swarm demo |

## Project Structure

```
src/
  bt/           Behavior tree: types, evaluator, conditions, bootstrap, templates
  compiler/     Compilation: single-action, plans, immune system, tree maintenance
  engine/       Conversation loop, benchmark system, plan execution
  ecs/          Agent state types and CRUD operations
  models/       Google Generative AI SDK configuration and handlers
  swarm/        Task generator, swarm runner, harvester, clusterer,
                species merger, nightly trainer, runtime swarm
  tools/        Tool registry and built-in tools
  persistence/  JSON file storage
  cli/          All runnable scripts
  __tests__/    Jest test suites

docs/
  DESIGN.md           Full architecture specification
  PAPER.md            Academic paper with experimental results
  FORMAL-FRAMEWORK.md Rigorous mathematical formalization
```

## Documentation

- **[DESIGN.md](docs/DESIGN.md)** -- Complete architecture specification
- **[PAPER.md](docs/PAPER.md)** -- "Crystallized Reasoning" academic paper
- **[FORMAL-FRAMEWORK.md](docs/FORMAL-FRAMEWORK.md)** -- Mathematical framework with convergence proofs
