# Personal importance and completed social contributions

Three states must not be conflated:

- A personal experience matters to an actor.
- The actor is currently able to advance a particular goal about it.
- The actor has actually said something about it.

## Private personal importance

Successful experience appraisal now retains bounded `PersonalConcerns` ECS
state. Each entry has the actual receipt IDs/channel, private appraisal and
significance, importance, and simulation time. Only the trusted appraisal commit
produces it; unread messages and failed/stale model calls do not.

Importance uses the appraisal's affect magnitude/arousal and proposed-goal
priority. It is not a semantic classifier or proof of an event's importance.
Up to eight channels are retained, with three shown in private cognition.
Another appraisal replaces that channel; an explicitly low-significance update
can quiet it. Merely pausing a goal or completing a reply does not clear it.
The prompt labels these as historical self-appraisals, not current facts or
instructions to disclose. Current affect remains a separate state.

The store is bound to actor identity, survives persistence, and never adds a
public event or another actor's knowledge. A changed concern invalidates a
foreground mental update issued against the older private context.

## What I already contributed

The existing control purpose is carried privately through successful foreground
admission and captured by the executor. Only successful speech completion stores
it alongside the speaker's actual dialogue receipt in `SocialMemory`.

This is not another model call or a new required response field. It is not stored
on a public action, copied to listeners, or read from the actor's latest thought
when an older speech finishes. Waiting, rejected, and interrupted speech does
not create a completed contribution. An actual contribution is not proof that
the desired interpersonal effect worked.

The next private dialogue view shows the last six completed purposes, pointing
to their exact spoken receipts. This gives paraphrase-level reconsideration a
compact basis: changing wording need not mean a new conversational point. There
is deliberately no fuzzy-text suppression rule; clarification, correction,
repetition to a new audience, and persistent disagreement can be legitimate.

## Self-directed desires versus assigned objectives

`createPersonalIntention(world, actor, description, priority)` is an explicit
authoring opt-in, exported from the library entry point. Such a subjective desire
may be deferred or relinquished by its owner. Relinquishment means `retired`,
never `completed`; progress is not awarded. Physical success contracts and
ordinary assigned goals keep their existing protections.

The sitcom's four opening desires use this authoring API. No scene-specific
completion/reaction rule was added. Characters can decide that pursuing an
opening disagreement is no longer worth it without falsely saying they won.

## Event-triggered subconscious reconsideration

Ordinary autonomous goal formation still waits for an actor to have no active
goals. A new significant private appraisal now gets a separate, bounded review
opportunity even while routine goals exist. A successful review (including an
explicit `goal:null`) consumes that appraisal revision; room chatter does not
reopen it. Failures and stale replies keep the existing retry backoff.

The personal-review branch proposes only a subjective social intention. It
accepts no physical completion condition or executable `firstAction`. Its source
fence protects actor identity, source epoch, own affect, concerns, and goal
definitions/status/priorities. Unrelated room changes do not erase this private
reconsideration. Normal scene-grounded autonomous generation retains its stricter
existing admission fence. Existing planning/execution gates still own every
physical action and world-state success claim.

`AgentPersonalReview` runs at high priority within the reserved subconscious
lane, not foreground capacity. It shares the actor's subconscious single-flight
guard. That actor's ordinary planner yields while a ready personal review is
pending. Two additional active-goal slots are available to this bounded review,
up to five total, rather than silently ignoring every important experience when
the ordinary three-goal budget is occupied. This is not unlimited goal generation
or a guarantee that a new goal will be desirable.

## Limits

These changes improve representation and available decisions, not their semantic
quality by guarantee. A model can still choose a repetitive point, ignore an
important concern, misjudge a social goal's relevance, or decline to disclose a
private experience. Provider latency, physical durations, and speech-floor
arbitration are unchanged. Evaluate real completed behavior, not just intentions
or successful schema validation.
