# Psyche Chassis — Self-Improving Cognitive Agent Architecture

## What Is This?

Psyche Chassis is the evolution of two prototypes:

1. **Psyche-BT** (reasoning-tree) — Self-improving BT compilation for cost-efficient reasoning
2. **Nanobot/CC** — Rich cognitive agent with hypotheses, intentions, metacognition, and dreaming

This chassis merges them: **every cognitive module learns and improves through BT compilation**.

## Architecture

```
soul/           Identity (SOUL.md + overlay + inner life)
skills/         Capability definitions (*.skill.md)
src/
  bt/           Behavior tree core (from reasoning-tree — unchanged)
  compiler/     System 2→1 compilation pipeline (from reasoning-tree — extended)
  engine/       Conversation loop + heartbeat (from reasoning-tree — extended)
  cognition/    NEW: Higher cognitive functions
    hypothesis-bt.ts    BT-native hypothesis management (replaces expensive LLM analysis)
    intention-bt.ts     BT-native intention generation & execution
    metacognition.ts    Self-reflection via calibration + domain-adaptive exploration
    heartbeat.ts        Real-time proactive loop (adaptive tick frequency)
    context-builder.ts  Budget-aware context assembly from attention-weighted memories
  ecs/          Entity-Component-System person model (from reasoning-tree — extended)
  swarm/        Collective learning + nightly trainer (from reasoning-tree — unchanged)
  models/       LLM integration (from reasoning-tree — unchanged)
  tools/        Action capability (from reasoning-tree — extended)
  persistence/  State storage (from reasoning-tree — extended)
  surfaces/     Multi-surface integration (NEW)
```

## Key Innovation

Every cognitive module compiles its patterns into the BT:
- **Hypotheses**: Observation patterns compile into hypothesis-updating branches
- **Intentions**: Proactive patterns compile into intention-generating branches
- **Metacognition**: Meta-maintenance adapts pruning, exploration, and soul overlay
- **Dreaming**: Nightly trainer already IS dreaming — consolidates, prunes, discovers

The result: **cognitive cost converges toward zero** as compiled patterns handle the 80% case.

## Commands

```bash
npm install           # Install dependencies
npm run dev           # Interactive chat (REPL)
npm run nightly       # Run nightly training cycle
npm test              # Run test suite
```

## Ported From

- `04_wonderlab/03_prototypes/reasoning-tree/` — BT core, compiler, swarm, engine
- `04_wonderlab/03_prototypes/nanobot/` — Soul, hypothesis channels, intention lifecycle, metacognition, heartbeat
