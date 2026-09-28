# Explicit goal pursuit and temporary deferral

## Change under test

Foreground control v2 names the goal behind a continuing purpose. An independent
or lower-priority detour requires a reason; the previous goal stays intact.
Agent-generated personal plans can run despite an enabled routine behavior tree.
When no such plan is ready, routine fallback cannot silently replace that goal.

An actor may explicitly defer an owned, generated social/exploratory intention.
The engine preserves priority and progress, pauses the goal, and revisits it on
personally experienced channel evidence, a heard speaker's next turn, or a
bounded simulation-time deadline. Its old proposed plan is retired, not replayed.
A release is retirement, never successful completion. Authored objectives and
physical success contracts are ineligible for these subjective reviews.

This supplies control semantics, not semantic proof that a chosen action is
wise or relevant. A supplied deferral reason is the actor's interpretation, not
an engine-certified external dependency. No breakup, disclosure, emotional
reaction, contact-name, or cookie-specific behavior rule was added.

## Deterministic coverage

Goal-pursuit regressions cover clock separation, bounded deadlines, channel and
speaker specificity, duplicate receipts, stale deliberation, malformed/unknown
conditions, actor/goal ownership, priority and identity changes, non-success
withdrawal, physical/authored protection, source restart, save/restore, and
resumed exploration not immediately re-pausing against an old completed plan.

Controller regressions cover explicit interruption reasons, saved goal identity,
normalization of a newly committed goal, personal-plan priority over routine BTs,
atomic invalid-review rejection, and deferral plus a valid new action in one
mental integration. All existing strict execution-proof tests remain in place.

## Live trial 1 — `goal-pursuit-v1`

Artifacts: `recordings/sitcom-breakup-boyfriend-bT19Lo/`.
Production Google cognition, 120 simulated seconds, no H3, no world evolution,
the existing two fixed outside messages. Source fingerprints are in
`configuration.json`. No runtime failure; complete results/journal were saved.

- First actual read: 20.70s. Reply delivered: 29.925s.
- Second actual read: 42.70s. Reply delivered: 52.635s.
- Elaine explicitly rebuffs the cookie argument at 36.84s and 82.96s.
- Her continuing purpose remains attached to breakup-related goals after the
  first read. It moves from replying, to waiting, to telling Jerry.
- She tells Jerry at 115.94s: “Jerry, David just broke up with me over a text message.”
- 29 integrated foreground purposes; 24 foreground thoughts after the first read.

**Limitation:** she never selected `goalReview`. Repeated goal-bound wait
actions remain from 55–75s. Explicit goal linkage helped expose this failure but
did not cure it. Later disclosure attempts were also delayed by speech/scene
admission. Neither retaining a purpose nor eventually disclosing makes pacing
golden.

## Follow-up

The second trial clarifies one general API instruction: when an actor has done
their part and progress depends on someone else, defer the personal goal rather
than repeatedly selecting wait. This is not a response script. A new-goal
identity fix also uses the actual committed goal ID rather than searching its
description. Trials are stochastic examples, not a controlled performance or
causality claim. Timing improvements require repeated matched evaluation.

## Live trial 2 — `goal-pursuit-v2`

Artifacts: `recordings/sitcom-breakup-boyfriend-mhec3k/`. Same bounded setup,
Google `gemini-3.8-flash`, no H3. No runtime failure; complete event collection.

- First read 23.70s; reply delivered 37.90s.
- At 39.50s, she actually defers her confrontation goal on the personally
  experienced phone channel, preserving its priority and progress.
- Second read 40.70s; the controller reactivates that goal by the 41s frame.
- Second reply delivered 51.815s. No third outgoing message in the episode.
- At 66s, she defers again until 96s or a new personally read channel receipt.
- At exactly 96s the controller reactivates the goal for review. At 97.50s she
  explicitly defers it again: no new reply has arrived. The engine does not
  invent a reply, complete the goal, or resend the request.
- 25 integrated foreground purposes; 19 foreground thoughts after the first
  read. No public breakup disclosure by 120s: she rejoins the cookie dispute
  while her confrontation goal is deliberately on hold.

This trial demonstrates real evidence-driven interruption recovery and timed
review, not just a thought claiming to wait. It does **not** establish a better
story or faster end-to-end cognition. Deferral frees attention; what an actor
chooses to do with that attention remains a semantic/narrative evaluation target.

## Final verification

Final runtime code: **215 suites passed; 2,639 tests passed, 10 skipped**.
`npm run typecheck` passes. Scoped `git diff --check` passes. Both live runs
ended after 120 simulated seconds; no H3 session was allocated or UI restarted.
Test output: `/tmp/argos-goal-pursuit-final-full.log` (117.324s).
Typecheck output: `/tmp/argos-goal-pursuit-final-typecheck.log`.

Remaining work: evaluate whether character motives generate useful alternative
goals while an external dependency is pending; improve social topic progression
and prevent repeated semantic beats. Existing spoken/heard social closure does
not yet cover a subjective desire satisfied by an actual typed exchange.
Physical success must continue to require executor/world evidence.
