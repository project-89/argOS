# Ready handoff and inspection-to-reply audit

Scope: user-approved offline follow-up to `project89-gate-9Av1yr`. No live
generation, H3, model change, new controller or candidate-review scheduler.
Existing dirty-worktree changes and live failure artifacts are preserved.

## Finding 1: the ready handoff is strict, but its response example was incomplete

The saved live trace has two matching move proposals rejected at 48.5s and
51.5s. Each selected the phone goal and matching purpose but omitted
`control.nextPurposeReview`. A previously chosen follow-up was ready after
native speech completion. The rejection follows the existing explicit-review
contract; matching a goal is not sufficient to consume that follow-up.

The prompt described take/cancel in prose, distant from a JSON response example
which omitted the required field. Recovery only offered generic invalid-schema
advice. This is an avoidable protocol usability problem, not evidence that the
model consciously chose to ignore the phone.

### Smallest repair implemented

- Keep `prepareNextPurposeUpdate`, native settlement and execution admission
  unchanged. No implicit take, permission inferred from prose, automatic move
  or mandatory reply.
- Move the existing chosen-next-purpose projection immediately before the
  response example. State that review is required even for a matching action.
- Include the current exact review ID and take/cancel field in that example
  only when the follow-up is ready. The actor chooses disposition and reason.
- Add field-specific rejection feedback explaining how to repair the proposal
  and that the rejected proposal did not consume the follow-up. Existing
  owner/source/freshness checks and recovery pacing remain unchanged.

Changed implementation: `actor-continuation.ts` (prompt projection only),
`agent-mind.ts` (prompt layout/example only), `idle-cognition.ts` (feedback only).
These can influence model output, but they do not relax admission or alter
which actions are authorized. Live improvement is not yet measured.

## Finding 2: the reply option was available, not lost

In the delayed-visitor run, Jerry read at 62.7s and native card inspection
completed at 100.5s. His physical inspection plan ended there, correctly:
unread information cannot authorize a prewritten response.

Background planning then provided two fresh-decision proposals:

- 113.5s, phone goal: decide whether to reply or keep to his own plans.
- 146.5s, investigation goal: decide how to ask the sender who they are and why
  the card was placed there.

Both survive in ECS `PlanningDecision` with empty review fields. Every one of
the last ten saved Jerry user prompts includes the first proposal, and the
last seven include both. All ten saved assistant responses parse successfully
and omit both `planDecision` and `control.nextPurpose`.

The same responses show activity reviews choosing `continue`: George's next
reaction is treated as expected useful progress before texting. At 172.260s
Jerry explicitly asks whether he should text back. The standing phone goal
remains active. Thus memory/retrieval and background-to-foreground delivery
worked; a pending option did not become an actor-selected follow-up. This
narrows the next investigation to selection and activity appraisal rather than
adding another memory store or re-sending the same goal.

### Existing responsibilities, kept distinct

- Goal: the actor's enduring concern; it need not dictate every action.
- Ongoing activity: organizing goal plus historical entry choice, not a queue
  or proof that its entry step is still unfinished.
- Current continuation: the latest chosen purpose and immediate action.
- Next purpose: an explicitly chosen prospective switch, reviewed after its
  preceding native step/wait boundary. Narrative "after this" alone is not one.
- Background plan/decision: possible work offered for foreground choice, not
  permission to execute a reply or an obligation to accept the suggestion.
- Native outcome: establishes what physically happened; memory and later
  deliberation may use it, but it does not certify completion of a broader goal.

No responsibilities were merged in this pass. Turning every available plan
into compulsory activity would conceal the behavioral issue and remove autonomy.

## Offline checks and preserved failures

Initial focused run: 87 passed, 2 failed. The two failures predate this repair:
`next-purpose.test.ts` still expected implicit take on a matching action and
rejected a chosen follow-up after a wait. Both contradict the later documented
explicit-review/wait contract and existing integration tests. Updated these to
require explicit review and reject unsupported `think` scheduling instead;
the existing wait take/cancel integration coverage remains. Original failure
log: `/tmp/argos-handoff-offline-before-2026-09-21.log`.

New/expanded regressions exercise:

- Two matching moves without review remain rejected without changing the saved
  follow-up; a fresh explicit take then moves through the native executor.
- The model receives an exact ready-review shape next to/in the response
  example, including corrective retry feedback. Non-ready responses do not
  acquire a mandatory ready-review field.
- Real Project 89 text read, drawer opening, card pickup and native inspection,
  followed by either a prose-only future intention or an explicit next purpose.
  Only the explicit choice persists as a ready follow-up. Unreviewed conversation
  cannot erase it. A fresh chosen phone action delivers a real outgoing message;
  inspection and spoken words alone never do.
- Existing take/cancel, ownership, changed-goal, source, restore, temporal,
  physical action and mental-envelope boundaries remain covered.

These are mocked foreground choices over native ECS execution, not evidence
of improved autonomous selection. They establish that both persistence and
native reply execution work when the actor actually chooses them.

The first expanded run had two test-harness assertion failures: the assertion
read `prompt` instead of the actual `messages[0].content`. Corrected the test,
not engine behavior. Retained log: `/tmp/argos-handoff-offline-after-2026-09-21.log`.
Focused rerun: 92 passed, three suites
(`/tmp/argos-handoff-offline-second-2026-09-21.log`).

Final regression pass after all prompt edits: **923 passed, 5 existing skips,
29 suites passed**, 25.104s
(`/tmp/argos-handoff-offline-final-2026-09-21.log`). This includes the previous
25-suite regression set plus next-purpose, rejection recovery, physical
foreground admission and mental-envelope suites. Final typecheck passed
(`/tmp/argos-handoff-offline-types-final-2026-09-21.log`); scoped diff whitespace
check passed. No acceptance claim is inferred from the test count.

## Remaining gate and next bounded step

Full autonomous two-round phone/visitor acceptance remains failed. Ten-trial
baseline and ten-minute endurance requirements remain outstanding; no changed
fixture or mocked choice upgrades them. Candidate review timeliness remains
separate and deferred.

Next: use the existing activity-review evidence to compare the actor's stated
expected progress with actual new information from successive exchanges.
Determine whether he is genuinely learning something that warrants waiting,
enjoying conversation, or repeatedly granting another exchange the same
unexamined value. Start with an offline replay of those inputs; propose a
minimal change only after distinguishing appraisal from action availability.
Do not make pending planner suggestions mandatory or manufacture a reply goal.
