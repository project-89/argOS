# Cognition prompt review — 4 September 2026

The design rule for this pass: **give the agent a clear job and trustworthy
context; enforce continuity, authority and completion in the runtime.** A longer
list of instructions to “be natural” is not a memory or a social system.

## Scope

Every model-call file under `src/cognition` was reviewed: `agent-mind`,
`planning-system`, `autonomous-goals`, `reflection-system`, `schedule-system`,
`grounded-cognition`, `knowledge-graph`, `memory-consolidation`,
`extended-reasoning`, `research-agent`, `task-queue` and `policy-generator`.
Supporting memory, sensory, action and persona projections were reviewed too,
along with the advisory daemon and spirit-narration prompts. This is a cognition
review, not a claim to have audited all God/code-generation/rendering prompts.

Detailed findings:

- [Planning, goals, reflection and advisory spirits](PROMPT-REVIEW-PLANNING.md)
- [Memory, reasoning, research, tasks and policies](PROMPT-REVIEW-MEMORY.md)
- [Perception, grounded cognition, schedules and persona](PROMPT-REVIEW-CONTEXT.md)

## What changed

The foreground prompt now specifies one decision, evidence boundaries, current
priorities and a compact JSON contract. It no longer repeats the entire world
capability context and perception list, supplies unrelated fictional examples,
or requires acknowledgment before personal activity. Per-person social context
is data, not a trust/disclosure ladder. Image reflection no longer turns every
perceived image into a compulsory product-design assignment.

Background prompts no longer demand a quota of facts, novelty, policy nodes,
social activity or insights when the evidence does not warrant them. An empty
reflection is distinct from a malformed response. Source labels and uncertainty
remain visible. Daemon suggestions can be declined; narration cannot manufacture
an arrival to make a movement event sound less repetitive.

### Mechanisms, not prompt patches

| Failure | Runtime change |
| --- | --- |
| An already-heard answer disappears from a small perception buffer | Actor-owned `SocialMemory` stores committed, local, audible speech; bounded question/response excerpts survive recent-turn turnover and ECS save/restore. |
| Model prompts mentioning a person count as conversation | Social context counts actual spoken exchanges, not `ConversationTurn` model history. |
| A queued question survives the answer it was meant to obtain | New heard dialogue invalidates stale social plans; a late foreground speech result is reconsidered before admission. Physical work does not require a silent room. |
| A personal desire keeps generating the same exhausted plan | Social-only plans have a bounded reconsideration cadence. Explicit subjective social goals may settle on cited own/heard exchanges; physical proof contracts cannot use that path. |
| A delivered sentence becomes a reusable conversational reflex | Single-decision BT learning excludes literal speech. Physical learning remains enabled; authored dialogue policies and other macro-learning paths are not globally disabled or migrated. |
| Every utterance installs a command to respond | Speech raises attention, but the focus records hearing rather than an obligation to reply. |

The dialogue ledger is attributed recall, **not semantic fact extraction**. A
question/response pair is a temporal association, not proof that an answer is
correct or complete. Hearing “I have the key” neither transfers the key nor proves
possession. The ledger retains at most 48 recent turns and 16 paired excerpts;
it is not an unlimited autobiographical memory.

## Verification and pressure test

Offline regressions cover source ownership, remote/deaf-listener exclusion from
the dialogue ledger, persistence with remapped IDs, stale replies/plans,
subjective versus physical completion, optional empty outputs and unchanged
action schemas. The harder Storm House fixture adds a leak, locked supplies,
timed drying, a separate panel holder and timed installation. Removing a needed
item, moving an actor or releasing the panel interrupts real work.

Run it without H3:

```sh
npm run demo:agents -- --challenge             # scripted mechanics only
npm run eval:agents:live -- --seconds=120      # autonomous baseline
npm run eval:agents:live -- --challenge --seconds=180
```

Each run writes public speech, private thoughts/perceptions, physical receipts,
actor-owned dialogue, ECS state and an `evaluation.json`. Repetition diagnostics
include excerpts and distinguish lexical/topic candidates from proven hearing.
No silence-as-success gate is used. A single successful run cannot establish
long-horizon social quality or renderer synchronization.

## Remaining architectural work

Follow-up: [the cognitive-system implementation review](COGNITIVE-SYSTEM-REVIEW.md)
records the subsequent goal-lifecycle, event-driven pacing, perception admission,
rest and persistence fixes. The original live observations below remain as the
pre-fix baseline, not claims about current defects.

- A compact, source-aware working belief model should distinguish observation,
  reported claim and derived hypothesis in storage, not only in prompt labels.
  Repeated derivation currently can inflate semantic-memory confidence, and a
  high-confidence research cache may bypass fresh contradictory evidence.
- Dialogue learning needs parameterized social intentions and fresh listener
  context before literal conversation can safely become reusable behavior.
- Speech is still delivered as an instantaneous text event, not simulated
  articulation over time. Transcript pacing is measured explicitly; rapid text
  turns are not evidence that the conversation could be spoken at that speed.
- Auxiliary/legacy cognition paths have weaker parsing and world isolation than
  the main foreground path. See the context review for exact locations.
- NPC roles and initial facts in this testbed are authored. Prompt-to-world
  generation, open-ended world growth and H3 fidelity need separate evaluations.
- Ad hoc coordination goals can remain active after the shared objective is
  proved complete. Goal dependency/obsolescence is not the same as permission to
  declare a physical task complete. The baseline exposed this lifecycle gap.
- The new ledger respects auditory capabilities, but the older structured
  pending-stimulus path can still admit speech despite a deaf sensory profile.
  Sensory delivery needs one shared capability filter.

## Live observations

The archived baseline `recordings/generative-agents-Gyg3F4` had 129 speech turns
in 119.5 seconds, three information rechecks after recorded hearing, and first
light at 21.5 seconds. The first cleaned run,
`recordings/generative-agents-CoAISC`, had 40 speech turns, no information-recheck
candidates at the same thresholds, and first light at 14 seconds. Per-actor
decision p95 was 1.98–2.86 seconds. This is one before/after sample, not a
controlled causal estimate of any individual change.

Human review still found repetitive thoughts, stale wait-for-answer plan steps,
and invented pantry/corridor details. The run also exposed a parser-interface
bug: some social reviews copied the exact UUID without its display namespace and
were silently rejected. Namespace normalization now accepts that same owned UUID
without accepting guesses, truncation or another actor's private evidence.
Subjective satisfaction has its own `social_goal_satisfied` artifact event, so it
cannot be mistaken for an objective lamp-repair receipt. Subsequent challenge
results are recorded in the testbed notes.

The subsequent three-minute challenge `recordings/generative-agents-YRABVL`
completed the leak/drying/two-person repair at 41 seconds. All three authored
social desires settled at 44–58 seconds. It still exposed unretired generated
intentions and repetitive idle thoughts; see [the full testbed evidence and
limits](../demo/GENERATIVE-AGENTS.md). Final verification: 117 suites / 980 tests
passed, 10 live tests skipped; typecheck and whitespace checks passed.
