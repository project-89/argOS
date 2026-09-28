# Activity-driven cognition

The model chooses a purpose and the simulation carries its execution. Perception
continues between decisions; another heard word is not automatically another
decision to keep listening.

## Decision boundaries

- Timed speech records every word at its physical emission boundary. Only the
  heard prefix is available to an observer. Sentence/turn boundaries invite
  deliberation; a long unfinished sentence also notifies after four simulated
  seconds. A departing/interrupted listener receives the remaining heard prefix,
  never a fabricated complete turn.
- An explicit `wait.listeningTo` selects an execution from the actor's actually
  heard, currently audible voices. That accepted listen lasts until the actual
  execution ends, with a thirty-simulated-second reconsideration cap. Ordinary
  four-second prefix updates still enter perception and memory, but do not
  restart the same decision. Sentence/turn boundaries, fresh attention, a real
  local change, critical need, actionable plan, or the voice stopping/leaving
  remain reasons to reconsider sooner. An unbound legacy `wait` retains its
  five-second listening horizon; `observe` remains inspection, not a secretly
  substituted listen. The offered execution identities disclose neither future
  words nor planned speech duration.
- Progress suppression requires an in-process hearing receipt bound to the
  listener's identity, world/source epoch and exact excerpt envelope. Forged
  JSON grants no suppression. Authentic stale/corrupted deliveries are rejected
  before perception; a departed speaker's already-heard words remain valid
  historical evidence, but no longer keep listening active. These receipts are
  runtime capabilities, not serialized authority in a saved world.
- The idle signature excludes token counts, observation timestamps, continuous
  needs drift, goal progress estimates and equivalent planner rewrites. Typed
  semantic changes remain visible: senses, completed/notified dialogue, working
  memory, public state fields, goal contracts and actual plan steps.
- Pending conversational wording retains the integrated purpose but is checked
  against actual new relevant dialogue/attention and its dependencies. It is
  never permission to replay stale words when a floor becomes free.
- Successful timed native observation retains the quiet backoff its executor
  recorded; resource cleanup is not another decision. Failure and independent
  incoming stimuli still wake the actor. A peer's incidental inspection remains
  visible, but does not repeatedly invalidate grounded speech about that peer.
  The explicit `activity:<entity-key>` dependency keeps exact activity checks
  when the chosen action depends on it. Movement, possession, phone operations,
  expressions, new dialogue and entity identity remain distinct evidence.
- `presence:<entity-key>` binds to the same locally observable person, not to
  their entire changing physical snapshot. A reply to heard words can remain
  valid while that person reads, types or closes something. `entity:<key>` still
  binds full current state/expression/activity, and `activity:<key>` binds the
  exact public activity. Presence is not permission to speak to a replacement
  or someone who has left; executor authority, target access and new relevant
  dialogue remain checked. The engine does not infer dependencies from prose.

## Immediate reaction and slower interpretation

An ordinary foreground action response does not require `innerThought`. The
controller's purpose and action still commit when expression is omitted, empty
or whitespace-only. A nonblank authored thought is stored exactly as authored;
there is no text-similarity filter, and real repeated rumination remains valid.
Omission creates no Thought, empty reasoning summary, or replacement monologue.
The focused audience view retains the last genuine thought with its original
timestamp; repeated snapshots of that thought are not fresh thought events.

Rich experience appraisal runs in the subconscious lane. A pending appraisal
does not block foreground perception, choice or physical execution. Appraisal
interprets an immutable, personally experienced receipt and its captured context.

When the actor's current meaning, affect, goals or continuing purpose have
changed, a hard-source-valid appraisal may archive one explicitly historical
interpretation. It cannot overwrite current emotion, expression, intention or
episode meaning. Identity/source/stop/cancellation failures do not archive
anything. The UI must not promote a historical recollection to a present thought.

## Activity review without forced closure

An actual completed own utterance opens the actor's local encounter. Further
completed own and personally heard turns become its evidence. The encounter is
bound to the actor identity/persona, world source and room identity, not a
selected goal or the next action. Goal/null changes therefore retain its prior
expectation and review history; current purpose and goal are context, not reset
keys. This is local engagement continuity, not a semantic claim that every
utterance shares one topic. Merely reading a prompt or hearing others cannot
create an encounter on the actor's behalf.

The existing controller receives a due review after two completed own
contributions over twenty simulated seconds, or four completed own
contributions since its last review. These thresholds make review eligible;
they do not impose a speech quota or require withdrawal. The bounded prompt
includes exact completed own and heard words with their receipt IDs, the actor's
own private contribution purposes, the previous expectation and review, and
unresolved signal status. Partial or proposed speech and another actor's private
purpose are not completed-outcome evidence.

The actor chooses `continue`, `pause` or `close`, citing offered completed
receipts including at least one of its own contributions. If a prior expectation
exists, the review must assess it as `sustained`, `unresolved` or `changed` before
choosing another. This is an evidenced personal interpretation, not an automatic
verdict that the intended effect occurred. Continued companionship, listening
and venting are valid; novelty, phone replies and emotional completion are not
mandatory.

Pause and closure are unilateral choices: an unanswered own contribution can
justify withdrawing without inventing a response or consent. Pause keeps the
encounter; new actual own speech resumes it. Closure records a private personal
engagement closure in SocialMemory; the next actual own contribution opens a new
encounter. Neither disposition completes a goal or changes a peer's state.
Objective completion still needs executor evidence, and subjective goal settling
retains its separate, stricter own-and-heard evidence contract.

Prompt capture does not create, reset or consume review state. Its immutable
in-process issuance binds the actor, source, encounter and review revision;
only an admitted review commits a new baseline. Competing stale reviews,
cancellation and clock rewind cannot overwrite a newer result. Continue consumes
only the captured receipts, leaving later contributions available for review;
pause/close are rejected if new observed turns arrived after capture. Encounter
intake uses one-use completed-speech producer receipts, so replaying saved or
copied dialogue cannot reopen an encounter.

The runtime encounter cursor, review count and previous expectation are
intentionally **not persisted across restore/source replacement**. SocialMemory's
dialogue, private contribution purposes and personal closures do persist. A new
actual own completion starts fresh runtime continuity without counting inherited
dialogue as a new exchange. This is not yet full persisted encounter resumption.

## Attention reconsideration versus reminder delivery

An actor-chosen `reconsiderAtSimMs` is separate from the engine's
`nextPresentationAtSimMs` reminder backoff. Presenting an overdue matter again
does not rewrite its chosen deadline or pretend the actor deferred it anew.
Incidental prompt inclusion cannot slide reminder eligibility indefinitely;
actual explicit review can choose a shorter or longer delay. Prepared attention
reviews are immutable and revision-fenced, including competing updates in the
same simulation tick. No reminder mechanism forces reading, replying or goal
resurrection.

An early heard-dialogue reminder cannot back off beyond a still-future chosen
timeout. Once that timeout is actually presented, ordinary reminder backoff
resumes; the cue does not spin every tick.

Each accepted attention review retains a bounded private history in the existing
Attention ECS row: the earliest retained review and two recent predecessors,
with their original reasons, simulation times and chosen deadlines. Projections
show the total review count and omitted history explicitly. Legacy rows do not
invent missing reviews. A fresh reason no longer erases the actor's earlier
"after this" choices, but those words remain memories, not executable intentions.
The due projection identifies the earliest still-retained personally heard
completed turn satisfying a chosen dialogue wake. Hearing a new line is evidence
for reconsideration, not evidence that the actor's question was answered or a
goal completed. No similarity classifier, deferral quota or compulsory action
is introduced; the actor may deliberately keep working, listening or waiting.

## Scoped narrative suggestions

Narrator-to-daemon suggestions use `queueNarrativeNudge` with an explicit world
and actor scope. An in-process, single-use receipt binds the exact registry,
daemon object, actor identity/persona, source epoch, issuance time and payload.
Restart, replacement, cancellation or clock rewind cannot turn an old suggestion
into a fresh whisper. A reserved scoped ID marks saved/copied rows for rejection;
serialized data does not carry admission authority.
An optional trusted `isCurrent` callback retains the issuer's captured-evidence
and plan validity through queueing and cooldown. It is kept only in the opaque
runtime receipt, checked at issuance and consumption, and fails closed if it
returns false or throws.

The native daemon cycle admits at most two eligible scoped suggestions directly
to the recipient's private `daemon_whisper` perception, before any model await,
using the ordinary whisper cooldown and narrative constraints. Each item is
revalidated, including after the preceding perception callback. Delivery adds an
optional idea, not a goal, memory of something that happened, public event or
physical action. The normal actor controller decides whether to use it.

The unscoped queue/conversion helper remains an explicit legacy API. Native
cycles do not newly deliver that legacy backlog; it has not acquired the scoped
path's provenance guarantees. Neither queued suggestions nor their serialization
prove that a character received, adopted or acted on them.

## Diagnostics and limits

`snapshotForegroundCognitionDiagnostics(world, eid)` records actual foreground
dispatches, not repeated scheduler probes. It exposes counts and the last
admission's typed reason, changed signature fields, wake cause/stimulus type and
bounded listening execution IDs. It contains no raw messages or memory bodies.
`snapshotActivityReview` adds encounter identity/status, due status, elapsed
simulation time, completed contribution count and the last committed expectation
and review without creating or consuming a review. These actor-private review
summaries belong in operator diagnostics, not public speech or another NPC's
perception. `activity_review` telemetry records actual admitted reviews, not
merely issued prompts.

Dispatch and continuation failures can include `localDependencyChange`: the
engine-issued dependency IDs, kinds and changed field categories. No physical
description values, private text or model JSON are copied into these diagnostics.
This distinguishes an actual target disappearance from overbinding a reply to
the recipient's routine changing activity.

Mocked regressions establish evidence and pacing boundaries, not naturalistic
quality. Live trials must still measure responsiveness, unnecessary repeat
decisions, task progress, and autonomy separately. A choice not to reply is not
an unread failure; a missing exit/action affordance is not a cognition failure.

Focused production-path regressions live in `__tests__/listening-continuation.test.ts`,
`__tests__/optional-expressed-thought.test.ts`, `__tests__/activity-review.test.ts`
and `__tests__/actor-controller.test.ts`. Audience retention/private-public
boundaries are also exercised in `../demo/__tests__/optional-thought-view.test.ts`.
The ordered live validation record is
`../architecture/CONTINUITY-AND-PROGRESSION-GOAL.md`; passing these deterministic
contracts alone does not establish natural dialogue progression.
