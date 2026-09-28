# Phone contacts and communication motivation

The sitcom receiver's **Who are you to Elaine?** drawer configures the outside
sender, not Elaine's name. Set a name, a relationship (including custom labels),
and optional shared context, then choose **Apply contact**. Profiles can be
changed before or during a run; stopped worlds and saved replays are read-only.
Draft edits are visibly unapplied until saved. The current local test remains
bounded to two minutes, independently of the provider account's session limit.

## World data, not just chat labels

`POST /contact` accepts `{name, relationship, context}` through the receiver's
existing authentication boundary. Names are 1–60 characters, relationships
1–40, context 0–300; ordinary multiline context is supported. Profile fields are
literal world data, not HTML or model instructions.

- The current profile is an ECS `SitcomContact` on the phone.
- Each incoming `SitcomMessage` stores its own profile and revision. Changing
  the current profile does not rewrite earlier messages.
- An actor's completed-read receipt preserves the exact contact and text they
  personally read. Another actor's knowledge or a remote edit cannot rewrite it.
- Replies use the contact of the selected, personally read incoming message,
  even if the current UI profile has since changed.
- Contact identity is revalidated during reading and typing, alongside message
  body, entity lifetime, location and continued possession.
- A vibration reveals a notification, not sender identity, relationship or body.
  The renderer does not receive private contact cards or unread texts.
- Relationships are explicitly anchored to Elaine. Someone borrowing her phone
  does not acquire her boss or boyfriend as their own relationship.
- The scheduled fallback demo text has its own unknown-sender identity and is
  suppressed after a human text. It must not impersonate a configured contact.

Existing recordings without contact metadata display **Unknown sender**. Both
the live viewer and saved HTML replay use per-message labels. Incoming operator
texts can appear immediately; read receipts and delivered replies follow the
displayed scene when H3 is on.

## A motive rather than an obedience rule

`createCommunicationMotivation` creates an ordinary owned social goal and a
first-person memory. Elaine wants to stay reachable without letting a phone
run her evening. Her existing cookie goal remains in place.

The communication goal has baseline priority 6; an actually perceived familiar
notification raises it to 8. A personal read restores the baseline. Silent,
unpowered or unheard notifications do not raise it. Retired, detached, inactive
or replaced actors/goals cannot be reactivated by this helper.

This changes deliberation's competing priorities. It does not dispatch a pickup,
read, reply or movement action. The character can defer, question a claim or
decline to reply. A contact marked boss or police does not gain direct ECS
authority. Different relationships and shared context become available to
cognition after the actual read; model behavior is not guaranteed by a label.

## Live check, 2026-09-05

`recordings/sitcom-live-QpxggQ` preserves a 56-second production-cognition check,
using Gemini 3.8 Flash, with no H3 session. Via the browser, the operator applied
Marion / boss with meeting context and sent a meeting-time question.

| Simulation time | Observed event |
| --- | --- |
| 5.5s | Operator sent the question. |
| 5.7s | Phone received it and emitted an audible notification. |
| 17.0s | Elaine thought about picking up the buzzing phone. |
| 20.2s | She completed a physical read. |
| 28.0s | She thought: “I've got the cookie, and Marion needs a quick confirmation text for our 10 AM meeting.” |
| 30.275s | She finished typing: “Yes, 10 tomorrow works fine for me.” |
| 30.475s | Her reply reached the outside sender. |

She continued the cookie dispute and ate the actual cookie. All episode gates
were observed, including a delivered reply. This single check demonstrates a
causal two-way exchange, not a controlled comparison proving that a particular
relationship always elicits a response.

The same check exposed the scheduled demo text incorrectly borrowing Marion's
profile at 25s. That integration bug was fixed afterward with offline
regressions; the original run artifacts were deliberately not rewritten. The
remaining inner-thought admission and H3 timing issues from the previous run
are separate work, not claimed solved here.

Final verification after the scheduled-sender fix: **204 test suites passed,
2,401 tests passed, 10 skipped; typecheck passed.** Browser checks covered
profile application, live message submission, the delivered reply and a fresh
ready-to-run editor. The last sender correction was verified with deterministic
regressions; the live check was not rerun or relabeled afterward.

See [extended-session readiness](../rendering/H3-EXTENDED-SESSIONS.md) for what
must change before exposing longer local recordings. Fal's higher account cap
does not remove the current receiver's storage/history bounds.
