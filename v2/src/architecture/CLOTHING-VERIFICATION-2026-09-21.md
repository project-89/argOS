# Current-view verification and evidence-reference audit

Follow-up to [known-answer grounding](KNOWN-ANSWER-GROUNDING-2026-09-21.md).
Bound: one 180s real-cognition Project 89 trial, unchanged formative history,
high background reasoning, conditional two-message protocol and visitor request
at 120s. No H3, extra messages, changed models, forced replies or automatic retry.

## Diagnostic addition before the run

Previous failed responses aged out of saved conversation history. Added a
bounded, opt-in operator-only reference audit to the existing returned-decision
diagnostic. It records fingerprints of issued/cited IDs, own/heard/physical
source categories, and whether an invalid reference matches previous-review,
attention, goal, episode, or prefix-stripped speech identity. It never stores
raw unknown strings, dialogue or full provider output. No new evidence authority,
memory, prompt content, normalization, or changed rejection behavior.

67 audit/activity-review tests passed before launch. Post-launch regression:
228 tests across nine suites passed, including rejection recovery and local-view
privacy/freshness. Typecheck passed. Logs:

- `/tmp/argos-reference-audit-unit-2026-09-21.log`
- `/tmp/argos-reference-audit-types-2026-09-21.log`
- `/tmp/argos-clothing-verification-regression-2026-09-21.log`

## Trial

Artifacts: `recordings/project89-gate-8ZNZ8g`.
Console: `/tmp/argos-clothing-verification-live-2026-09-21.log`.
Completed at 180s, exit 0, no interruption or run-level failure. Result, world
and runtime log are all mode 0600. No second trial launched.

| Event | Simulation time |
| --- | --- |
| First delivered / read | 26.2s / 28.7s |
| First reply delivered | 43.815s |
| Follow-up delivered / read | 44.2s / 47.7s |
| Second reply delivered | 77.055s |

Replies:

1. “It says PROJECT 89 — WHO IS WATCHING? with a white rabbit. Who is this?”
2. “If you're outside my world, what am I holding in my hand right now?”

Read-to-reply intervals: 15.115s and 29.355s. First response improved relative
to the preceding sample; the second was slower. No pooled latency or causal
improvement claim is warranted from these different variants/single trials.

### Grounding and action

- Jerry physically picked up the card at 37.3s and typed the second reply at
  76.855s, before handing the card to George at 103.5s. He also held his phone.
  The question therefore has an observable answer, but is ambiguous and not a
  strong proof of an outside observer. George later points out that the phone
  is an obvious answer. Do not call this a definitive simulation-theory test.
- All ten retained Jerry user requests include the actual current clothing:
  `plaid shirt, tan trousers, glasses`. No suede-jacket assertion appeared in
  this run. This verifies projection delivery, not that it caused the different
  question or eliminates future hallucination.
- Early phone checking was voluntary, before real delivery. At 13.5s Jerry
  thought “Nothing on the screen, not even a missed buzz. So much for urgent
  summons.” The “urgent summons” interpretation lacks a prior notification;
  no real early buzz or unread message was created. Preserve that weakly
  grounded flourish rather than declaring all unsupported premises solved.
- One attempted phone operation at 9s failed natively; he then examined the
  phone. No unread contents leaked. Integrated draft duplicates are not counted
  as multiple physical pickups or speech completions.

### Evidence references and other failures

- Eight audited review responses, all citing issued speech/physical receipts,
  all integrated. Five were George's, three Jerry's. **Zero** unissued-evidence
  rejections. The previous seven-rejection sequence did not reproduce.
- The only foreground rejection was Jerry's `invalid_schema/action.target`
  at 107s, while proposing `wait`. His stated purpose was to listen to George
  and await a phone ping. No raw target retained in the diagnostic; do not infer
  its exact malformed value or relax the target contract.
- 273 control-loop diagnostic entries, zero dropped. Jerry foreground p50/p95
  1.442/3.289s; George 1.636/3.008s.
- No God review expiry recorded before stop. Narrator reviewed the visitor at
  136.5s; the Morpheus proposal arrived only at 179s, remained pending, and was
  not built within this bound. Visitor gate remains open.

## Rejection investigation conclusion

The review validator compares selected IDs against the exact issued dialogue
and physical-outcome lists. It deliberately excludes past-review and attention
IDs. Social-memory helpers elsewhere accept an exact UUID without `speech:`,
while this review contract requires its issued form. That is a possible source
of model confusion, **not evidence of what caused the previous run**. The new
audit can distinguish it from stale or unrelated citations without accepting
them. Offline tests reproduce/classify prefix-stripped and unissued references,
retain rejection, and verify no private values or state changes.

No speculative behavioral fix was made. The old artifacts lack the rejected
IDs, and this trial has no corresponding failure. Next recurrence should be
diagnosed by matching the returned-reference audit to its rejected request ID.
Only then adjust the smallest proven projection/formatting gap; preserve
source ownership and exact issued-evidence authority.

## Commit boundary

Git status shows 819 collapsed entries, or 1,199 individual changed/untracked
files when directories are expanded. This is the existing multi-week baseline,
not the size of this patch. It includes engine, cognition, spirits, rendering,
demos, tests, architecture notes, 275 data artifacts and two output files.
The tracked `agent-mind.ts` alone differs from HEAD by over 1,200 additions and
depends on untracked modules. A file-scoped commit of this pass would therefore
silently include earlier changes or leave a non-self-contained tree.

The index was empty on inspection. No broad staging or commit performed.
Asked the user whether the checkpoint should capture the full code/docs baseline
or keep this cognition pass separate. Recommend auditing a full code/docs
checkpoint while excluding runtime recordings, secrets and generated output;
already-versioned generated system source requires explicit review, not blanket
exclusion. No files deleted; failed evidence remains in place. No push requested.

Ten-trial baseline, ten-minute endurance and combined visitor interaction gates
remain open. This bounded check does not satisfy those broader acceptance gates.
