# Personal review: a typed intention, not a forgiving action parser

This is an I/O repair inside `autonomous-goals`, not a new cognition controller.
`personal-review-response` owns the provider/local response contract only. The
existing lane continues to own scheduling and source checks; GoalLifecycle and
coordination preflight continue to own intention/link/deferral admission. Native
executors alone own actions and their outcomes. Legacy idle goal parsing is not
changed by this pass.

## Evidence

Failed Elaine trial `elaine-growth-integration-4kqrI7` did read the invitation,
send an acknowledgement and form dinner goal44. After that unused goal expired,
13 follow-up HTTP attempts produced seven string-valued followUp fields, five
incomplete JSON envelopes and one shutdown abort. Some wanted to choose dinner;
others returned goal:null with an unsupported timer. None was admitted.

Offline reproduction also found that goal:null with unrelated timer/action fields
could pass the old tolerant parser as a deliberate no-op. A rejected proposal
must not be confused with choosing to do nothing.

## One contract, two alternatives

- Exactly `{ "goal": null }`: a deliberate choice to create no new intention.
  It cannot silently carry a follow-up, action or timer.
- A concise goal, motivation, integer priority 1–10, kind `social`, and optional
  `followUp: { undertakingId, reviewAtSimMs?, reason? }`. A timer and its reason
  occur together inside followUp, not at the root. This is a concrete owned
  intention optionally deferred through existing GoalLifecycle, never an
  appointment, mutual agreement, automatically queued action or success proof.

The installed SDK requests this schema from the existing model. Local admission
independently parses one complete bare JSON object or whole JSON code fence and
validates the same strict branches. No substring extraction, coercion, repair of
partial output, or unknown keys. Provider schema dialects may omit constraints;
local source/authority checks remain mandatory. The actual undertaking must still
be current, own, and unrepresented; time remains anchored to its original source,
not inference completion. Cancellation and source/persona/context changes still
prevent admission. All effects are preflighted before synchronous commits.

## Failure handling, not a second deliberation mechanism

`personal_review_result` records structural outcome, allowed finish reason, text
length, parse/schema codes and retry delay. No raw output, error messages, private
field names, provider causes or reasoning appear in this new diagnostic. Ordinary
existing operator goal/admission logs retain their existing semantics. A completed
background function is not necessarily an admitted intention.
Since Chronicle is process-global, these diagnostics carry the captured source
and actor identity plus request simulation time. A late response is never
relabeled as belonging to a replacement actor or restarted source.

Repeated malformed JSON/schema output for the same owner/source/evidence batch
backs off 5, 10, 20, then at most 30 **wall-clock** seconds. Evidence stays pending;
failure is not acknowledged as refusal or completion. New admitted evidence is
not held by the old batch penalty (the ordinary five-second cooldown/backoff still
applies). Valid admission/no-op clears format failure state. This transient
world-local scheduling state is not saved as a cognitive fact or simulated timer.
It reduces churn, not a guaranteed bound on lifetime retries or provider costs.

## What this does not solve

The dinner decision was actually projected in 18 Elaine foreground prompts
(requests134–265), all choosing cookie goal31 instead; none reviewed that proposal.
The initial formatting failure cannot explain this earlier nonexecution. Two
offline controller regressions explicitly choose a lower-priority phone decision
while cookie activity remains and verify native reply completion; they show no
mandatory priority lock, not that a live model will make that choice.
The authored intention also narrowed the invitation to selecting/texting a
meeting place; it did not explicitly adopt going there to eat. Request52's
motivation assumed Alex could join after work, though the source said not to wait
for him. That is model interpretation, not an established arrangement. Merely
executing this narrower plan would not prove a complete dining departure.

No forced departure, expiry extension, new priority rule, model change, new
controller, or H3 run. The cookie-loop behavior remains failed evidence for the
next authorized bounded trial. Ten-trial baseline and >=600 actual-wall AND
simulated-second endurance requirements remain unchanged and unpassed.
