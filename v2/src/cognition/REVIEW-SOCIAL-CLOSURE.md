# Social continuity and closure — 4 September 2026

## What the live run exposed

`recordings/generative-agents-WvTkem` contained real subjective social-goal
completion receipts, followed later by a new goal to discuss substantially the
same house routine. Completed Goal entities are eventually cleaned up; an
episodic sentence about the completion competes with ordinary recollections.
There was no compact, durable projection of what the actor had already decided
was socially satisfied.

The foreground async guard also treated newly heard dialogue as relevant only
when the selected action was `speak`. An answer arriving during a `wait`
decision could therefore leave an already-obsolete thought about waiting for
the answer. That thought then entered the next prompt ahead of actual dialogue.

## Mechanism changes

- A validated `socialGoalReview` records an actor-owned, bounded social closure:
  description, reason, time and the frozen own/heard speech evidence already
  required by the review contract. No raw Goal EID is retained. Closures survive
  Goal cleanup, dialogue turnover and save/restore remapping. Legacy saves and
  first admission to a new actor clear missing/stale closure storage.
- The existing shared dialogue context supplies the five latest settled
  desires to foreground cognition, planning and autonomous goal formation.
  A closure remains the actor's subjective assessment; it is neither physical
  success proof nor a claim about another person's private agreement.
- Actual dialogue now precedes historical thoughts. Exact executor-produced
  speech echoes in the perception list become compact delivery/source-ID
  markers; the words remain once in dialogue recall. Arbitrary perception text
  is not semantically rewritten, discarded or acknowledged by formatting.
- An answer followed by a counterquestion can be retained as a question/reply
  excerpt. A remark addressed to someone else cannot be paired as that reply.
  Association still does not assert that the question was answered.
- Newly heard relevant dialogue invalidates dependent foreground thoughts,
  quiet/social actions and social-goal drafts before admission. Other-addressed
  chatter, unrelated ambient speech and unreceived remote speech do not cancel
  an independent targeted reply. Independent physical work can proceed.

## Verification boundaries

Offline tests cover closure evidence ownership, bounds, goal cleanup, dialogue
turnover, detached getters, checkpoint compatibility, source presentation and
concurrent-answer races. No live provider or H3 calls were made for this pass.

This does not semantically ban gratitude, decide that a particular answer was
adequate, automatically complete every conversational goal, or make unbounded
conversation memory. A fresh review can still be mistaken within its expressly
subjective authority. Name-based dependency matching does not resolve every
pronoun or infer the subject of unrelated ambient speech. New live runs must
establish whether the combined mechanisms improve natural behavior.
