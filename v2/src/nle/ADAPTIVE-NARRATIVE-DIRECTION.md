# Adaptive narrative direction

The director revises **possible futures**, not lived history. It reads a bounded,
world-local evidence snapshot and may retain a pending beat by omission, retire
it, or replace it with a grounded new pending alternative. Every change cites
issued evidence IDs. Model judgment about whether a premise is stale remains
fallible; a retirement is an advisory planning decision, not a new world fact.

## Evidence and authority

The global review receives named physical places, exact actor identities and
presence, genuinely visible objects/actors, and each observer's personally
recorded **completed** dialogue. Speech remains an attributed statement. Several
observers' copies of one receipt are correlated, not independent corroboration.
Historical dialogue is a durable record, not proof of a new current-source
action; historical speaker names are labels and are not rebound to new entities.
Private messages, phone contacts, thoughts, emotions, goals, role secrets, model
system prompts, unfinished speech prefixes and the process-global chronicle are
not read into either director prompt.

The director has no tools for physical edits, broadcasts, memory insertion,
goal changes or action execution. Legacy `prepare_world`, `mark_triggered` and
`beatTriggered` outputs are rejected. It no longer calls the integrity healer.
`setDirectorGodAgent` remains a compatibility no-op. Explicit God/evolution
world-building and `godCommand(..., { authority: "narrative-growth" })` continue
independently; same-cycle director scenery preparation is intentionally removed.

A replacement preserves the original beat as `retired`, allocates a host-owned
ID for the new `pending` beat, and records source, simulation time, evidence,
reason and exact participant keys. The original tension description stays
archival; its new `advisoryDescription` is the active possibility shown to future
director reviews and the DM formatter. One replacement per tension per response
avoids conflicting active premises. Retiring all remaining pending beats makes
the tension dormant, **not resolved**. Neither beat completion nor the current
act is promoted. The beat detector likewise provides candidate telemetry only;
keyword overlap cannot assert that a proposed event happened.

## Character-level follow-through

After a successful reconciliation, at most one separate request can suggest an
optional possibility to an active character selected from a cited observer.
That request sees **only the selected recipient's local evidence**: no global
beat, global assessment, role, private persona, other observer's words, global
actor catalog or global place catalog. It may abstain. Exact local evidence IDs
are required for a suggestion, which reaches the actor through the safe advisory
`nudgeNpc` path. It never becomes an imposed goal, memory or public event.

The new pending plan is visible through the existing DM scaffold formatter.
God and spirits do not currently consume every revised beat automatically.
Actor-local opportunity review is the bounded follow-through here, not a claim
that the entire global plot is installed into each character's mind.

## Timing, bounds and stale-work rejection

Reviews run at most once per 45 **simulated** seconds per world, coalesce while
in flight, and can retry discarded stale work after five simulated seconds.
Issuance is task-scope guarded and immutable. Commit requires the same source,
non-stopped runtime, exact scaffold entity/revision/content, actor identities and
capability/persona bindings, completed dialogue and current physical evidence.
Elapsed-time changes and unfinished prefix progress alone do not invalidate it.

The optional suggestion uses a separate recipient-only context lease, so remote
unheard speech cannot invalidate local work. Recipient changes, source stop or
restart, scaffold revision, reset, or a later director cycle revoke the lease,
including during daemon cooldown. This conservatively drops stale suggestions
instead of turning them into timeless instructions.

Bounds: 16 actors, 32 places, 16 visible targets and eight completed dialogue
turns per actor, 192 evidence records, 32 issued pending beats, six changes to
**one selected tension** per response, 64 beats per tension, and at most one actor suggestion. Responses over
32,000 characters or malformed/unknown IDs, fields and dispositions are rejected atomically.
Old adaptation history is preserved; new diagnostic entries stop after 256.

Both model calls use the existing low-thinking Flash configuration with no
automatic provider retries. Reconciliation has a 1,600-output-token budget and
requests terse reasons and at most one replacement; optional actor review has
500 tokens. These budgets intentionally do not promise to fit every maximally
long schema-valid response: truncated or invalid JSON still cannot mutate ECS.
Provider `finishReason: "length"` is an explicit `output_limit` rejection even
when a complete-looking JSON fragment can be extracted from the partial output.
Scaffolds exceeding 32 pending beats rotate input windows on every dispatch,
including stale, invalid and abstaining responses. Within a window, the model
chooses the tension needing revision; equal service among those tensions is not
guaranteed. Outcome telemetry logs only source/issued IDs, counts, duration and
result classes, never prompt or dialogue bodies. Suggestion admission or queuing
is distinguished from actual later daemon delivery.

Legacy worlds without a committed source may reconcile existing physical and
historical evidence without starting a source implicitly. Their snapshot has
`sourceId: null`; later source creation invalidates that issuance. Stopped worlds
cannot issue or apply director work. Restored data never restores in-flight
authority: runtime scaffold revisions and leases are newly established.

## Remaining limits

This is not proof of natural pacing or compelling prose; live quality still
needs measurement. Conservative semantic fences can discard reviews during
rapid physical/dialogue changes. Invalid or ungrounded model proposals abstain;
the director does not repair them by fabricating events.

The first Stage 4 maintenance trial (`sitcom-breakup-boyfriend-axS1ql`, 120 seconds,
no H3) demonstrated this liveness failure: all eight original beats remained
pending, with no adaptations. Four post-disclosure model calls took 12.324,
15.962, 18.806 and 10.801 seconds; all four correctly rejected stale evidence.
The initial call took 4.079 seconds without applying a change. Those calls used
the middleware's default medium thinking and no explicit output-token limit.
The low-thinking/compact-output patch above addresses that measured latency;
its live improvement must be checked in a subsequent trial. No evidence fence
was relaxed to obtain a passing result.

The subsequent 120s maintenance trial `sitcom-breakup-boyfriend-g5ctqT`
demonstrated actual retirement: four pre-date/departure beats retired at 80s,
with the tension dormant rather than resolved and the act unchanged. Reviews
took 2.53–3.327s; four were still stale before one applied. The model chose no
replacement in this trial. A separate 870ms Jerry suggestion was queued, but
later delivery is not evidenced. Repeated banter remained; plan repair is not
equivalent to compelling autonomous behavior. See the continuity goal log.

The repository's scalar ECS component arrays are process-global while legacy
world factories can reuse numeric entity IDs. Concurrent same-process worlds
with overlapping IDs can therefore overwrite each other's component values.
The new identity fences reject observed in-flight overwrites, but cannot make
the underlying worlds physically isolated. Use separate processes for live
independent simulations until allocator/store isolation is addressed separately.
No allocator redesign, live H3 run or H3 synchronization claim is part of this
change.

Deterministic gates: `narrative-reconciliation.test.ts`,
`narrative-preparation.test.ts`, `sitcom-director-reconciliation.test.ts`,
`npc-nudge-authority.test.ts`, and the public-receipt beat detector regressions.
