# Attention continuity: ordinary conversation and renewed postponement

## Scope and preserved evidence

Bounded cognition repair; no model changes, new controller, forced phone action,
H3 generation, or expansion of builder authority. Existing dirty-worktree work
is retained. This pass does not replace ten-trial or endurance acceptance gates.

The failing source remains `recordings/sitcom-live-k8oRLC`. Its final world,
frames, decisions, renderer records and raw video are unchanged. The preceding
successful run `recordings/sitcom-live-8PvJUC` remains available too. Different
generated conversations and actor locations mean these are not controlled A/B
trials.

## Causal trace

The dinner notification arrived at simulation 34.7s and remained unread at 120s.
Elaine perceived the familiar phone cue. Fifteen buzzes were not lost. Seven
explicit foreground reviews renewed her deferral:

| Choice time | Chosen revisit | Her stated reason (abridged) |
| --- | --- | --- |
| 38.5s | 48.5s | Finish dealing with George's excuse |
| 50s | 65s | Pin George down on the cookie |
| 68s | 83s | Check right after this exchange |
| 77s | 92s | See Jerry finish calling him out |
| 84s | 99s | Check once this excuse unravels |
| 92s | 107s | Hear George's current sentence |
| 98.5s | 113.5s | Pin down his new wind-shear claim |

This is not the previously repaired bug where merely showing a cue reset its
chosen deadline. These were admitted model choices. The broad `heard_evidence`
wake offers review after any new personally heard completed dialogue. It does
not establish that a question was answered or that an exchange is finished.

The attention row retained only the latest reason and review count. Ordinary
context omitted the count; only the due header showed it. Each successive
conversational hook therefore replaced the earlier stated boundary without a
compact record of the actor's successive postponements. This is a supported
architectural gap, not proof that it alone determines model behavior.

The final ongoing activity was still finding out what happened to the cookie.
The immediate continuation was waiting for George's answer. It had no explicit
`nextPurpose` to check the phone. Deferral prose is not an executable commitment;
we preserve that distinction rather than parse "after this" into a forced move.

A second, deterministic timing defect was reproduced: a heard-evidence reminder
at 102.5s set backoff to 132.5s, masking the actor's 113.5s timeout. A miniature
regression reproduced the same failure at 4s/15s.

## Keep / change

- Keep one existing attention ledger and foreground action selector; keep the
  actor's freedom to postpone, ignore, listen, work, or investigate.
- Keep repeated sensory emission distinct from a new decision, and consideration
  distinct from trusted resolution. No unread-message contents are revealed.
- Retain at most three prior review memories per cue in the existing ECS JSON:
  earliest retained choice plus two recent predecessors. Preserve original
  reasons/times/deadlines, report omitted history, and do not invent legacy data.
- Project that history in ordinary and due attention context. A due dialogue
  wake shows its earliest still-retained completed heard receipt, not merely
  "somebody said something new." It is explicitly not proof of goal progress.
- Cap early reminder backoff at a still-future actor-chosen deadline. After
  presenting that deadline, ordinary backoff resumes without a per-tick loop.
- Fence pending reviews against changed review history and clock rewind.

No forced closure, increasing urgency score, deferral quota, keyword/similarity
classifier, or new model-output field was added.

## Verification so far

- Red test run: 35 passed, 2 failed. Failures were the masked chosen deadline and
  absent previous review history; both failures reproduced before implementation.
- Focused regression: 6 suites, 240 tests passed, including full foreground
  projection/admission, healthy deliberate waiting, private ownership, historical
  memory versus epoch-bound wake authority, stale updates, and exact resolution.
- TypeScript check passed after correcting optional timestamp narrowing; its
  initial type failure was not a runtime/test success.
- Broader cognition regression: 141 suites passed; 2,814 tests passed and 10
  skipped. Logs are preserved with the live diagnostic below.

The new `phone-attention-pass.cjs --live --dinner-notification` variant uses the
same dinner text at 34.5s, the unchanged GUI launch profile and David relationship,
120 simulated seconds, 240 wall seconds and at most 350 provider attempts. It
records prompts, results, private state, native outcomes, and cleanup accounting.
No H3. Existing appointment diagnostic variants are unchanged.

## Behavioral gate

Assess whether she actually preserves/reconsiders prior choices; distinguish
received model output from admitted decisions and native pickup/read/reply.
A voluntary answer is encouraging, not proof the postponement loop is solved.
If she never defers in this one run, it does not exercise renewal under banter.
Do not run until a success appears or erase a failure. Further work should target
recorded decision boundaries before adding another cognition mechanism.

## Completed single live diagnostic

Evidence directory: `recordings/phone-attention-live-kWU5nU`.

The process completed 120 simulated seconds in 135.8 wall seconds, with 295
provider attempts, none denied or incomplete, no pending requests or residual
processes, and unchanged source hashes. Full private prompts, responses, world
checkpoints, lifecycle and native outcomes are retained. No repeat was launched.

Elaine made these admitted choices:

- 42.5s: defer 15s to deal with George hoarding her cookie.
- 61s: defer 15s to retrieve the cookie; activity review explicitly recognized
  that arguing would not retrieve it and chose opening the tin instead.
- 61.8s: actually opened the tin; 65.3s: actually picked up the cookie.
- 70.5s: "I retrieved the cookie, so I can check my notification." Her foreground
  prompt included both prior deferral records (provider request 166).
- 71.3s: actually picked up her phone; 74.7s: actually read the message.
- 90.21s: finished typing; 90.41s: delivered "Eight sounds great. See you there!"
- 106s: actually ate the cookie. Final state: unread=0, phone held by Elaine.

The delivery-to-read delay was still 40 simulated seconds. The important
observed difference is bounded postponement with actual progress and follow-up,
not guaranteed immediate notification handling. This trial did not exercise
Elaine's early heard-evidence timeout path (she chose plain timed deferrals);
that repair is verified deterministically, not attributed to this outcome.

There is no controlled proof that the history change caused this result: this
conversation/location trajectory differed from the saved failing episode.
The pre-existing activity review also contributed visibly. Do not declare
cognition "golden" or upgrade baseline/endurance gates from this one result.

Remaining evidence: three Elaine decisions were rejected (one `control` schema
at 12.5s, two `goalReview.schema` at 91.5s/93.5s). Other stale dialogue/local-view
decisions were safely discarded. None of the three schema failures was an
attention-history admission failure; they remain in the audit, not patched away
as part of this scoped change.

Next targeted gate: evaluate repeated "after this answer" renewal from saved
decision-boundary fixtures, including an intentionally worthwhile long wait,
and review the model's assessment of its prior choice. Preserve refusal and
failure outcomes. Keep schema-admission follow-up separate; do not add another
controller or demand a phone reply to make a trial pass.
