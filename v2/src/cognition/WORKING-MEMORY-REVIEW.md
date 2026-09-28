# Physical working memory — 4 September 2026

## The regression being repaired

In the Storm House run `generative-agents-obBRAe`, Ivo actually gave Mara the
Spare fuse at 41 seconds. The physical container was correct, but later dialogue
lost track of the transfer. Mara was occupied holding the access panel, and the
important handoff competed with a short rolling perception list and older
recollections. The first repair took 95.5 seconds. This is a missing durable
working account, not evidence that the renderer should invent smoother actions.

## Contract

Working memory records **what this actor last established**, not an omniscient
query for the truth right now. The ECS remains authoritative for execution.

- Confirmed own actions and actually witnessed actions supply physical receipts.
- An admitted observation can update visible local facts or the actor's own
  possessions. Another person's concealed inventory is not a public observation.
- Failed actions can leave a failure receipt but cannot install their proposed
  effects as facts.
- Speech remains attributed dialogue. A promise, recollection, inference or
  planted thought is not quietly upgraded to a committed transfer.
- Repeated context formatting performs no observation and changes no memory.
  A remote operator edit can make a remembered fact obsolete without making the
  character magically aware of its replacement.

The store is deliberately compact: bounded physical fact slots plus bounded
source receipts, rather than an ever-growing transcript. A new source can
supersede an older value of the same subject/predicate/slot. Replaying the same
source is not independent evidence, and confirming an unchanged value does not
increment the belief revision that would wake quiet cognition.

`working-memory.ts` owns the storage contract. Physical ingestion is centralized
in `working-memory-observation.ts`; producers must establish sensory access and
successful execution before recording evidence. The same production execution
path includes package-owned deferred work, rather than teaching the testbed to
write a special “correct answer” into Mara's thoughts.

## Identity and persistence

`WorkingMemoryIdentity` assigns a durable key at an actual evidence boundary.
Facts retain these keys and observed display labels, not raw ECS numbers. A
world save can therefore remap actors, items and containers without rebinding a
memory to a same-named substitute. Each actor's working-memory owner key must
match that actor's durable identity; copied foreign memory fails closed.

The normal component serializer carries the evidence and identity fields.
The working-memory loader clears absent fields in old numeric-only saves,
preserving the old capacity/load/decay fields but importing no invented
evidence. Loading does not replay an observation, adjust an evidence timestamp,
refresh hidden locations or advance the simulation clock.

## Consumers and immediate actions

Foreground cognition, planning and autonomous goals receive the same compact
last-known evidence alongside separately labelled dialogue and older memories.
Background drafts can be checked against relevant working-memory changes.
Dependency matching uses explicit observed names/keys, not a purported semantic
understanding of every pronoun or arbitrary plan description. It matches fact
**subjects**, not their values: a plan mentioning the Utility Room does not
depend on every item located there, and the word “off” does not bind it to every
inactive appliance. This avoids cancelling useful plans for unrelated changes.

The compact prompt view prioritizes facts about physically acted-on subjects,
especially their latest containment, before routine scene facts. A fresh visual
confirmation does not erase that priority. It reads the actor's own stored
receipts, never hidden ECS state. Full source IDs remain in storage while the
display uses shorter source labels; the selected facts and recent receipts stay
bounded rather than expanding the prompt into a transcript.

Storm House's immediate interaction menu now agrees with its physical executor:
the person who no longer owns the fuse is not offered an immediately executable
repair; a repair also requires isolation, a dry floor and a distinct active
panel holder. A busy holder can release the panel, not perform both jobs.
Object descriptions and world rules still describe future prerequisites, so
the absence of a currently executable action is not the disappearance of the
underlying capability.

## Offline evidence

The persistence regression suite covers:

- actor ownership after ID remapping, including identical display names;
- stable object identity and superseding the same fact slot after restore;
- old last-known facts surviving unseen physical relocation and repeated reads;
- legacy numeric-only saves and actors with no working-memory component;
- rejected foreign-owner evidence and missing identity.

The cooperative testbed regression recreates a handoff while Mara is occupied
holding the panel, then adds more routine observations than the short perception
list can retain. It checks the giver, recipient and local witness. A separate
case moves the fuse remotely, checks that reads and unrelated local observation
do not reveal the new location, then admits a real observation after Ivo returns
to the Store Room. Timed installation retains Mara as the remembered holder at
5.999 seconds and changes the actor and two local witnesses to the Lighting
relay only when the actual part commits at six seconds.

Thirteen additional admission-boundary tests cover:

- actual participants and sighted local witnesses, including blind givers and
  recipients learning their tactile transfer without receiving visual access;
- no hidden-inventory scans or disclosure of a private carried target, its
  state, an installed item's concealed destination or private action arguments;
- directly seeing an item on the floor superseding an older held-item fact,
  without an equal-time “unknown” observation winning by random source order;
- unseen relocation remaining unknown to old witnesses, with only the former
  holder discovering that the item is no longer in their inventory;
- pending and failed actions not installing anticipated effects, ordered
  same-millisecond handoffs and rejection of a same-named replacement object;
- internal work and routine observations not crowding out physical receipts.

The three testbed working-memory cases, seven persistence cases and eight
challenge/affordance cases passed together as an **18-test focused run**.
The final offline regression run passed **133 suites / 1,201 tests**, with
**10 explicitly opt-in live tests skipped**. Typecheck is clean. These are
**authored physical fixtures and mechanism regressions**, not evidence of
autonomous narrative quality or a faster live repair.

Run the focused regressions without provider or renderer calls:

```sh
npm test -- --runInBand --silent \
  src/cognition/__tests__/working-memory.test.ts \
  src/cognition/__tests__/working-memory-observation.test.ts \
  src/cognition/__tests__/working-memory-consumers.test.ts \
  src/persistence/__tests__/working-memory-persistence.test.ts \
  src/demo/__tests__/generative-agents-working-memory.test.ts \
  src/demo/__tests__/generative-agents-challenge.test.ts
```

## Limits

- This is a physical working account, not a complete model of promises,
  obligations, trust, semantic belief revision or long-term autobiographical
  memory. Speech does not yet yield a verified ledger of every commitment.
- A character can still choose poorly even with the relevant fact in context.
  One successful deterministic replay does not certify natural cognition.
- Bounded memory can eventually evict old evidence. It is not an unlimited
  archive and should not replace episodic or long-term memory.
- Actor-owned evidence guards do not make the entire static SoA architecture
  safe for arbitrary simultaneous worlds in one process, nor do ECS saves
  restore package callbacks and external jobs.
- Renderer synchronization and paid H3 output are outside this change.

Live timing and dialogue-quality results belong alongside the run artifacts;
they must not be inferred from these offline tests.

## Bounded live validation

`recordings/generative-agents-WvTkem` ran for 180 wall-clock seconds / 177.5
simulated seconds on the configured `gemini-3.8-flash` roles. This was the
cooperative leak/panel challenge with the real fuse relocated at the planned
120-second intervention. H3, genesis and autonomous world expansion were off.

- The first repair physically committed at 45s; power was switched on at 46s,
  and the world reported the lamp lit at 46.5s.
- After the operator relocation, the lamp went dark at 119.5s. Mara acquired
  the fuse; Ivo acknowledged she had it and held the panel while she installed
  it. The second installation committed at 156.5s and the lamp was lit at 158s:
  38.5s from outage to recovery.
- The run recorded 178 successful terminal action receipts, **zero failed
  actions**, 171 thoughts, 51 spoken turns and two real key handoffs. Successful
  receipts include waits, observations and redundant actions, not 178 novel
  physical accomplishments.
- Foreground decision p95 was Mara 3,112ms, Ivo 3,106ms and Sera 3,391ms.
- Per-actor checkpoint evidence and the new `readiness.json` fuse-location trace
  show ownership and source changes: Ivo's own pickup, Sera's witnessed pickup,
  installation, Mara's later pickup and Ivo's witnessed update. Sera did not
  acquire the remote relocation/pickup as physical knowledge while elsewhere.

The earlier failure run `generative-agents-obBRAe` lit the lamp at 95.5s and
recovered from its intervention in 28s, with nine failed actions. Thus this run
completed the initial task earlier and avoided execution failures, but recovered
more slowly. These are unpaired stochastic runs, with affordance alignment also
changed; they do not isolate a causal speed improvement from working memory.

The exact Ivo-to-Mara fuse handoff that exposed the bug remains covered by the
deterministic regression; the live run instead chose Ivo as the first installer.
Its live handoffs involved the brass key. Do not label that run a live replay of
the exact original fuse handoff.

Remaining observed friction: repeated post-repair compliments and Sera's
tea/supply plan revisiting an already inspected cupboard. Physical possession
continuity is better supported; social closure, inspection outcomes and
commitment follow-through are not certified solved. Lexical repetition metrics
also produced false-positive candidates between the two legitimate repair rounds.

A small, offline 1,000-pass check of sensing plus formatting in the initial
three-character scene averaged about 0.075ms per pass (11 facts, two receipts).
That measures local ledger overhead only, not model latency or large-world scale.

The library entry point exports `getWorkingMemory`, `getWorkingMemoryRevision`
and `formatWorkingMemoryContext` for read-only inspection. Full source IDs remain
in saved evidence; prompt display abbreviates them and prioritizes acted-on items.
