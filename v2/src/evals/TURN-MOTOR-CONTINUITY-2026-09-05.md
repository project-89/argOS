# Turn continuity and short motor plans — 2026-09-05

Question: can we reduce the avoidable serial delay behind the earlier 90.64s
breakup disclosure without scripting Elaine's response?

## Implemented

- A runtime-only FIFO turn request independent of the exact queued words.
  Same-audience revisions retain order; execution still rechecks fresh wording.
  Real earlier speakers extend waiting leases. A free floor has a 3s authoring
  grace, with a 30s total bound. Expired requests never revive.
- Explicit, model-chosen interruptions remain possible. No automatic
  breakup/phone/personality rule sets interruption priority.
- Optional 2–4 step local motor plans in the existing foreground response.
  They reuse ECS plans and real completion receipts, not a second executor.
  Preparatory pickup/drop steps end at the first interact/observe boundary.
  No prewritten response to unread information or unseen remote object.
- Exact local target/source bindings reject same-name substitutes, restarts,
  edited commands and expired/restored motor authority.

The actor still decides what matters and whether to speak. A turn request is
not dialogue; a completed physical prefix is not a completed goal.

## Deterministic verification

Regression tests cover retained order across a wording revision, obsolete words
never executing, actual physical completion before the second motor step,
single-inference two-step execution, new attention, source/actor/target changes,
same-name substitutes, expiry/non-revival, queued earlier speakers, explicit
interruptions and speculative motor-plan rejection.

The first live traces exposed a lease bug: waiting behind a queued author could
consume another request's grace before that author's real speech finished. The
new multi-speaker test reproduces this; the final version extends still-live
leases when a real earlier voice starts. It never renews expired requests.

## Live experiments

All trials use the same two fixed boyfriend messages at 8s and 28s, 120s of
production cognition, no H3, no world evolution or injected NPC decisions.
Each artifact directory includes source fingerprints, configuration, full
event journal, cognitive frames, transcript and result. Times below are seconds
from simulation start, not seconds since the message. Model times are complete
foreground task wall durations, not isolated provider measurements.

| Trial | First read | First reply delivered | Second read | Second reply delivered | Breakup disclosed to peers |
|---|---:|---:|---:|---:|---|
| Earlier successful comparison `y7URO2` | 23.2 | 32.575 | 42.7 | 55.33 | George 62.86; Jerry 90.64 |
| Candidate `OjEuf1` | 24.7 | 46.935 | 57.2 | 78.695 | No |
| Target-guard correction `D1ZVgf` | 24.2 | 33.4 | 40.2 | 50.725 | No |
| Final lease correction `xv04J2` | 23.2 | 32.335 | 39.2 | 50.005 | No |

`OjEuf1` and `D1ZVgf` precede the final multi-speaker lease correction. They are
retained failures, not successful validation of the final queue. Elaine's
foreground task median/p95 was 1.464/4.458s and 1.468/5.110s respectively, versus
1.383/2.522s in the earlier comparison. These small stochastic trials do not
establish a provider speedup or behavioral improvement.

In both candidates Elaine understood the breakup and sent angry replies, then
deferred pursuing David's response and returned to the cookie dispute. In the
second, George noticed the intense phone exchange and asked about it at 37.9s;
this did not become a completed breakup disclosure. The later waiting purpose
was explicitly confronting George about the cookie, not sharing the breakup.

This distinction matters: retaining a speaking turn cannot select a different
personal purpose on the actor's behalf. Neither a schema pass nor an angry text
reply meets the desired whole-episode narrative test.

Artifact directories, relative to the repository root:

- `recordings/sitcom-breakup-boyfriend-OjEuf1/` (`turn-motor-v1`)
- `recordings/sitcom-breakup-boyfriend-D1ZVgf/` (`turn-motor-v2`)
- `recordings/sitcom-breakup-boyfriend-xv04J2/` (`turn-motor-v3`)

## Final corrected run

The run completed at 120s with `failed: null`. Elaine's 29 foreground tasks had
a 1.391s median and 2.382s p95. Her pending turns resumed at 66.5s (requested at
60s) and 102.5s (requested at 96.5s), without another inference for those words.
She completed two public utterances, at 71.44s and 108.6s. Both concerned the
cookie. Other pending wording was still appropriately revised when relevant
dialogue or local state changed.

At 110s her private thought included: “David can wait five minutes while I deal
with George's nonsense.” This supports the distinction between forgetting an
experience and choosing a different purpose while deferring it. It does not
prove that this is a desirable choice or that the model's explanation is a
complete causal account of its behavior.

The final journal records **zero `motor_plan_admitted` events**. The optional
motor plan path is demonstrated by offline single-inference execution tests,
not by this live episode. Do not attribute the earlier second reply to that
unused feature or claim a general narrative-speed improvement from these runs.

Verification: **216 suites, 2,674 tests passed, 10 skipped**. The final changed-path
recheck passed **97 tests** across controller, floor and sitcom integration.
Typecheck and scoped whitespace checks were clean. No H3 sessions were started.

Conclusion: conversation mechanics now retain turn ownership through revisions
and actual earlier speakers; short local physical plans have a guarded fast path.
The desired whole-episode breakup pivot was **not achieved in any of these three
trials**. The remaining behavioral bottleneck is choosing and sustaining an
appropriate personal/social purpose after the initial phone response—not a lack
of access to the message or a single long foreground model call. Future work
should evaluate that choice without scripting disclosure as a mandatory rule.
