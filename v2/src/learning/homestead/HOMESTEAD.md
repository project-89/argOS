# Homestead: learning to build, with less model each time

A small headless world where making things is real: an axe in a shed, trees,
a workbench, a quarry, and a cabin built in parts (foundation, frame, walls,
roof). Recipes are data (`recipes.ts`), so the world can grow.

The resident learns a **skill graph** (`../skill-graph.ts`,
`../skill-runtime.ts`), kept between lives; memories are not.

- **A skill is a small tree** made of acts on *kinds* of things and places
  ("chop a tree", "go where the workbench is") and `ensure` nodes ("have 4
  planks first").
- **Each skill records its own effect.** It keeps what its own acts consumed,
  relied on and produced. What sub-goals made along the way belongs to their
  own skills.
- **Composition is by effect.** An `ensure` is satisfied at run time by
  whichever learned skill gives that item, most reliable first. The cabin
  skill never contains chopping: it ensures planks, planks ensure logs, and
  logs need an axe.
- **The model is asked only for what the graph cannot make.** It plans the
  direct steps for one goal. Anything a step reports missing becomes a
  sub-goal solved the same way. Every act that produced something is kept as
  a skill, even inside a plan that failed.
- **Gaps grow the world.** Something nothing gives is reported to the spirits'
  observation board (`resource_gap`). Here a fixed growth patch stands in for
  the Weaver: flax and rope-spinning appear, and the resident learns to use
  them.

## Run

```
npm run homestead                  # offline: manual stand-in planner (reads the world's manual)
npm run homestead -- --live        # Gemini plans (bounded: ≤30 planner calls per life)
npm run homestead -- --live --graph path/to/graph.json --verbose
```

## First live result (2026-09-29, Gemini 3.8 flash, empty graph)

| life | goal  | land                      | done | model calls | acts | notes |
|------|-------|---------------------------|------|-------------|------|-------|
| 1    | cabin | homestead                 | yes  | 9           | 67   | learned 14 skills |
| 2    | cabin | homestead (fresh)         | yes  | 0           | 54   | 3 skill runs failed and recovered |
| 3    | cabin | other names, no loose stones | yes | 0         | 50   | |
| 4    | raft  | homestead                 | yes  | 7           | 37   | lacked rope → world grew flax + spinning |
| 5    | raft  | other land                | yes  | 0           | 28   | |

In total: 16 model calls and about 16k tokens across five lives. There were
no malformed replies once the output limit left room for thinking.

- **The model's mistakes were believable.** It asked to pick up rope before
  any existed, and it named things by kind instead of by name. The world
  accepts kinds, and walking to a target that stands elsewhere is native.
- **One odd plan became a weak skill** (a pickaxe "that also gives stone",
  1/2 successes). Ranking by success rate keeps it from being used; nothing
  prunes it yet.

## Limits (next steps)

- **Instant acts.** The runtime is synchronous. Real-time worlds need a
  tick-based runner with running/success/failure node state.
- **Separate from the resident's mind.** The graph is not yet wired into the
  spatial town's cognition (offstage driver, procedures) or the cross-session
  library file.
- **Growth patches are fixed data.** The Weaver authoring recipes from
  `resource_gap` reports is the real version.
- **No pruning.** Weak or duplicate skills are not retired, unlike the skill
  library's selection policy.
