# Saltmere live diagnosis — 2026-09-27

Read-only diagnosis of the operator's run. No production changes, new model
requests or new simulation run were made during this investigation.

Evidence: `recordings/spatial-CyN3yn/{session,world}.json` and
`/tmp/argos-saltmere-20260927.esd05x/server-final.log`. Preserve the complete
outcome; the previous offline tests did not establish live narrative quality.

## Confirmed problems

### Phone ownership became a permanent organizing goal

`spatial-demo.ts:164` exempts only household residents without authored contacts
from creating a communication motivation. Every town resident with a phone gets
one. Seven receive the literal generic "Stay reachable while choosing how to
spend my time."; three receive contact-specific variants. These are real active,
priority-five standing goals (`communication-motivation.ts`), not UI placeholders.
All ten remain active at the end. Six final focus cards display the generic text,
three a contact variant, and only Otis a specific investigative purpose.

Foreground actions actually bind these goals, including Tess waiting at 277.4s,
Eli at 273.2s and Leon at 256.9s. The UI additionally prefers the organizing goal
over the immediate purpose; its stopped snapshot invalidates ongoing activity
and can hide an equally ranked newer intention. This is both an agenda problem
and a presentation problem, not merely a mislabeled display.

The planner also treats these standing motivations as ordinary plannable work:
25 of 52 logged plan starts target communication goals (16 the exact generic
phrase). Retained examples include a failed unread-message plan without a
message, and completed plans to think/observe while staying available. This
demonstrably creates background demand, though it cannot alone explain every
queue delay. There were 14 distinct autonomous goal admissions; goal formation
is not wholly broken. Standing goals consume one of the normal three active
slots, but the evidence does not quantify how many alternative goals were
suppressed or declined.

### A biography is not a livelihood

The cast has private histories and does form new intentions. But its working
opportunities are short inspections, conversations, finite snacks, seats,
phones and a supplies box. The gardener cannot tend a plant, the illustrator
cannot produce anything, and the repairer starts without a real repair project.
The snapshot contains no WorkDocument/ProductiveWork entities or work goals.

Cognitive initialization supplies ten identical default schedules. Everyone is
in the 17:00–20:00 leisure block. The run only advances from 18:00 to 18:04:40;
hunger/energy drift is deliberately on ordinary hourly rates. Later scheduled
locations fall back to current/start rooms rather than authored homes. New
biographical text did not replace this generic routine or create vocational work.

One capability bug also surfaced: Mara's goal 613 requires "Lantern House sofa
is occupied", but sofa 73 is examine-only. `getGoalCompletionOptions` in
`goal-lifecycle.ts` offers generic object-type states without verifying an
executable transition under the spatial host. Validation against a catalogue is
not sufficient if the catalogue itself advertises unreachable outcomes.

### This host is a furnishing sandbox, not open-ended world growth

The active hierarchy is Watcher, Arbiter, Narrator and Weaver. Steward, Tinker,
Crafter and Lawgiver are deactivated. Coding is off. God reviews messages and
observed proposals; it is not independently building a village economy here.
Weaver is limited to approved catalog furnishings at four registered sites.
The Narrator can suggest considerations or use bounded weather/branch grants.

Actual outcome over 280 simulated seconds:

- Eight accepted Narrator reviews, all reporting exposition.
- One accepted optional nudge at 223.4s: Otis could ask Ada what she and Leon
  discussed about the box. This is not a physical world change.
- Four Weaver need reviews, each producing zero suggestions.
- Zero builds, zero weather changes, zero branch incidents. All physical event
  and furnishing budgets remained unused.

These were not observed proposals rejected at the construction gate: Weaver
returned no candidates. Broader production/repair mechanics could not execute
under the current host grants even if it proposed them.

### Health does not currently measure a flat story

The legacy `stagnationScore` now intentionally measures repeated native physical
failures, not lack of meaningful purpose. The Watcher's stuck detection likewise
requires repeated failed attempts. This protects legitimate waiting and finite
consumption, but leaves a gap: a whole town can successfully wait without being
physically broken. Narrator phase/tension is an interpretation, not demonstrated
progress, and another review is not an intervention.

### Queue pressure compounds thin agendas

The runtime advanced 280 simulated seconds in 293.5 wall seconds (~0.95x), with
861 slow ticks and average tick time 63.25ms. It was not frozen. Logs contain
302 admitted model choices, including 174 waits and 17 rests (~63% combined).
These are admissions, not a full committed-action ledger. Eight actors end
seated. The retained last 100 UI events include 73 successful waits.

Both two-slot cognition lanes were near capacity. Estimated median foreground
queue delay was ~3.1s; background planning/coordination/subconscious work waited
~17s, sometimes ~39s. Completed foreground task execution median was 1.379s;
planning provider requests median 5.338s. Sixteen plans were invalidated or
failed, adding some replanning. No pre-stop provider timeout or queue failure
was found. Terminal AbortErrors are cancellation evidence, not an earlier outage.
The footer's completed-task total is a rolling retention statistic, not the run
total. The spatial UI does not expose the available runtime queue diagnostics.

## Proposed next pass — not implemented

1. Stop manufacturing an active task merely because an actor owns a phone.
   Keep notification recognition/private delivery and meaningful contact drives.
   Separate standing motivations, chosen undertakings and current activity in
   both selection and UI; do not turn this into a rule to obey every message.
2. Filter completion outcomes through native executable capabilities. Regress
   the examine-only sofa. Bind schedules to actual homes and usable work sites.
3. Install one real sustained project and one maintained physical process using
   existing planning/execution owners. The native document-work testbed already
   demonstrates read/write/review/finalize; a grounded repair chain offers a
   physical complement. Give residents different reasons to participate or refuse.
4. Add a bounded advisory liveness review to the existing monitoring/Narrator
   path: concrete purposes, follow-through, unresolved opportunities, meaningful
   consequences and builder usefulness. Distinguish chosen rest from depleted
   opportunities, missing capabilities and queue-delayed reconsideration. A quiet
   interval alone must not force activity, emotions, disasters or a new goal.
5. Enable one scoped, validated mechanic-improvement path under God review so
   an evidenced need can result in more than furniture. Keep source identity,
   privacy, execution authority, spatial registration and acceptance tests.
6. Measure/deduplicate background work before increasing request volume. Expose
   queue delay and freshness separately from narrative judgments in the UI.

Use a bounded repeat with explicit evidence for completion → chosen next purpose,
interruption → resumption, a native narrative consequence, and another resident
using a built capability. Do not claim success from more prose, more LLM calls,
more objects, or forced motion. Existing ten-trial/endurance gates remain open.
