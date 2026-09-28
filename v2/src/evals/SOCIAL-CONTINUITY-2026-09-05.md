# Social continuity: implementation and live evidence

## Implemented

- Private importance survives a goal being deferred: bounded, actor-owned,
  source-timed `PersonalConcerns`, produced only at successful appraisal commit.
- Completed speech remembers its actual original private purpose. Pending,
  rejected, or interrupted speech does not become a completed contribution;
  listeners receive words, never this metadata.
- Explicitly self-directed opening desires may be relinquished, not falsely
  completed. Assigned objectives and physical success contracts stay protected.
- Important new experiences can trigger bounded background personal-goal
  reconsideration despite routine active goals. This uses subconscious capacity,
  allows `goal:null`, and cannot propose executable physical work.

No runtime rule refers to breakup, David, Elaine, cookie ownership, disclosure,
or a desired emotional response. The only scenario authoring change marks the
four opening subjective desires as personally owned rather than assigned tasks.
Foreground instructions now reconsider personal priorities before pursuing them.

Architecture: `src/cognition/SOCIAL-CONTINUITY.md`.

## Live experiments

All three episodes used the existing two fixed boyfriend messages, production
Google `gemini-3.8-flash`, 120 simulated seconds, no H3 and no world evolution.
Source fingerprints and private cognitive frames are saved per episode.

1. `recordings/sitcom-breakup-boyfriend-HJze7G/` (`social-continuity-v1`):
   both messages read and answered, but no public breakup disclosure. Elaine
   returns to the cookie dispute. The records correctly retain her concern and
   prior speech purposes, but that alone does not establish good social choice.
2. `recordings/sitcom-breakup-boyfriend-xXNM9V/` (`social-continuity-v2`):
   clarified priority-review ordering, still no public breakup disclosure within
   120 seconds. Both replies arrive; public conversation remains about the cookie.
3. `recordings/sitcom-breakup-boyfriend-y7URO2/` (`social-reconsideration-v1`):
   includes the background scheduling correction. The episode pivots publicly.

### Final episode: actual events, not intended actions

- First message read at **23.20s**, reply delivered at **32.575s**.
- At **40.46s**, Elaine tells George: “No, George, everything is distinctly not okay.”
- Second message read at **42.70s**, reply delivered at **55.33s**. She rejects
  the proposed return of belongings rather than repeating her demand for a call.
  This is a typed reply, not execution of disposal or any external-world action.
- At **62.86s**, Elaine tells George that David dumped her over text.
- At **90.64s**, she explicitly redirects Jerry: “Jerry, forget the crumbs—David just broke up with me over a text message!”
- Jerry responds at **98.14s**; George at **103.16s**; Kramer at **108.16s**.
  Their conversation turns to the breakup. Jerry then responds to Kramer's
  interpretation at **116.58s**.

Elaine retained 27 integrated foreground purposes and 21 post-read foreground
thoughts. Her 29 recorded foreground decision-task durations had median
**1,383ms**, p95 **2,522ms**, maximum **3,092ms**. Across 128 cast decision tasks:
median **1,339ms**, p95 **3,078ms**, maximum **5,520ms**. These are task wall
durations, not pure provider latency or event-to-displayed-video latency.

Three personal-review tasks ran in the final episode (approximately 775ms,
3,353ms, 2,633ms). No additional committed autonomous goal was logged there.
Do not attribute the successful pivot specifically to the new review lane:
these stochastic examples change multiple mechanisms and are not matched-seed
causal evidence. Deterministic tests establish the lane's availability/admission;
the final episode establishes that this runtime can produce the desired turn.

## Verification and remaining limits

Final full suite: **216 passed; 2,655 tests passed, 10 skipped**.
Typecheck passes. Logs: `/tmp/argos-social-final-full.log` (130.87s) and
`/tmp/argos-social-final-typecheck.log`. No UI/H3 server was restarted.

New regressions cover private concern persistence and isolation; deferral without
erasing significance; explicit reappraisal; source ownership; completed versus
interrupted speech purposes; the original purpose surviving a later thought;
self-directed withdrawal without success; background reviews despite routine
goals; quiet no-goal decisions; stale sources/goals/concerns; bounded capacity;
and rejection of physical work through the personal-review channel.

**Not golden:** two earlier episodes still drifted. The successful final episode
still took 90 seconds to redirect the whole group. Public speech admission,
semantic repetition, and meaningful alternative goals need repeated matched
evaluation. No claim is made that H3 timing improved or that every important
experience should be publicly disclosed.
