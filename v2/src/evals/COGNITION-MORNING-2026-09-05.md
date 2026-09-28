# Argos cognition — morning report, 5 September 2026

Subsequent work: [cognition and temporal foundations](COGNITION-TEMPORAL-2026-09-05.md)
changes speech duration and dispatch admission. The live results below describe
the earlier frozen source, not the new temporal implementation.

## Status

The hard multi-NPC escape-room testbed is working. The final frozen live pair
both escaped on different dependency graphs and recovered from a real power cut
during the final unlock. This is promising evidence, not “golden”
cognition: review still finds stale mental claims and unfinished coordination
bookkeeping even when the physical puzzle succeeds.

The overnight schedule is paused after its 09:00 Vancouver cutoff. The user then
asked to continue; the final repair/verification pass is complete. All **12 of
12 bounded campaign trials** have finished; no live process or lock remains.
The source stayed frozen through the final pair; the overnight schedule remains
paused. The trial ceiling has been reached—no more campaign model runs.
No H3/FAL, UI work, builders, publishing, commits or purchases were performed.

## Last completed live pair

Both recorded `gemini-3.8-flash` for shared cognition, background planning and
reflection, with God/builders disabled so they could not solve the fixture by
rewriting its rules. The relay puzzle requires private clue acquisition,
remembered codes, actual item handling, exclusive power routing, two-person timed
pumping, optical calibration, a simultaneous helper at the final release, and
three real exits. Physical receipts—not speech—establish completion.

| Trial / seed | Physical escape | Layout | Whole foreground attempt median / p95 |
| --- | --- | --- | --- |
| 11 / 60793 | **105 simulated seconds** | Relay; Archive accessible before powered drainage | Mara 1.474 / 3.109 s; Ivo 1.193 / 5.079 s; Sera 1.195 / 4.262 s |
| 12 / 80471 | **121.5 simulated seconds** | Observatory; Archive inaccessible until drainage | Mara 1.160 / 3.626 s; Ivo 1.138 / 3.649 s; Sera 1.139 / 5.417 s |

Evidence: `recordings/escape-room-KWX2kn` and `recordings/escape-room-Ed0l5T`.
Both had exactly one failed physical action: the deliberately interrupted unlock.
Both recovered using fresh operations under the original helper's hold deadline.
First foreground thoughts arrived at 2.5s and 2s; no video latency is included.
Timing includes deterministic choices and complete foreground attempts; it is
not isolated model latency. Earlier trials used evolving implementations and
must not be presented as a controlled twelve-run success-rate benchmark. The
previous relay pair also exercised opposite branch orders (trials 9/10, 106.5/111s),
but predates this pass's changes.

## General repairs verified by the final pair

- Shared visual surfaces now gate sensory prose, current-scene headings,
  affordance menus, planner state, inspection memory and working-memory facts.
  Hidden people, sealed interiors and another actor's private state must not leak
  through a different prompt section. Direct own possessions remain known through
  touch without revealing unread screens or unseen descriptions.
- Real open tabletops and open containers are traversable; closed/locked state
  overrides stale open traits. The phone desk is now a typed ECS surface, and
  native pickup follows the same enclosure rules as perception and planning.
- Malformed replies, invalid ownership references, superseded decisions,
  cancellations and provider failures are non-executing discards. They no longer
  manufacture successful waits, advance plans or create physical learning proof.
  Bounded operator diagnostics preserve the reason and issued reference catalog.
- Wait metrics now explicitly distinguish raw executed wait/rest receipts from
  unavailable model-intent attribution. A failed request is not voluntary idling.
- Native visual inspection, explicit inspection aliases and the legacy room
  formatter use the same surface boundary. Packages cannot bypass it with an
  explicit visual command. Specialized authored reads retain their own physical
  rules. Recovery hints reveal only actually visible names.
- Stored plan-step descriptions remain in plan history rather than being
  republished as newly reasoned current thoughts. Deterministic execution and
  physical progress continue; tests separately require real foreground thoughts
  during replanning and while a background planner is stalled.

The final integrated offline run is green: **176 suites, 2,107 tests passed,
10 existing opt-in tests skipped**, with a clean typecheck and whitespace check.
The additional executor bypass is repaired, with 14 new actual-dispatch/legacy
projection regressions. Tests no longer equate stored plan prose with fresh
cognition. The final pair ran on exactly this frozen source.

Across the final pair, **48 discarded decisions produced zero action/movement
receipts**. All 13 executed waits matched actual admitted model choices by exact
request ID, actor and action type—not timing proximity. This manual cross-tape
check supplements the generic evaluator, which still reports intent attribution
unavailable without that additional provenance. It exposes remaining real waiting
rather than making the metrics look better by misclassifying errors.

New diagnostics identify a concrete binding problem: Mara twice returned an
issued undertaking UUID without its `speech:` prefix, and once supplied a prior
own speech ID that was not an admitted undertaking. All three were rejected
without execution. This supports improving structured reference ergonomics while
preserving exact current ownership—not accepting arbitrary speech as work proof.

## Remaining quality work

1. Admit current mental claims separately from a still-valid physical action.
   Narrow target checks preserve useful action during busy scenes, but an
   accompanying thought can still describe outdated broader state. The next
   architectural step is a staged mental-update envelope (thought, new goal,
   reviews, attention acknowledgment and learning reasoning), rechecked against
   its issued local evidence at both response and dispatch. A stale envelope must
   not starve an independent valid body command; an action depending on a newly
   proposed goal/undertaking must reject with that envelope. Preflight mutations
   before commit rather than dropping only the displayed thought. This establishes
   freshness, not semantic truth of otherwise fresh prose. Trial 12 directly
   reproduces the gap: Mara at 111.5s thinks she is waiting for power, although
   power and her local notification arrived at 110s; her actual observation is
   correctly powered. She also invents a possible rule that someone must remain
   beside the router. Freshness alone cannot correct that unsupported causality.
2. Keep historical reflection honest about source type. An owned speech citation
   or old intention does not prove that a physical event happened.
3. Give promises explicit, evidence-backed terminal criteria and reconcile work
   accomplished by someone else. Physical escape can coexist with lingering
   in-progress undertakings and unnecessary repeat investigation. Trial 11 Ivo
   asked Sera to restore power, then followed her to do the same job. Trial 12 Ivo
   repeated six intentional wait decisions from 75.5–88s while awaiting news.
   Real physical evidence barriers were used in both trials; they are not universal
   protection against repetitive foreground waiting.
4. Decision admission is not an arbitrary ECS transaction: a goal/review already
   accepted before a later commit rejection is not rolled back. Rejection proves
   no execution, not that every prior cognition mutation was undone.
5. Broader modality modeling and nested owned-inventory access still need review.
   Public authored sound labels are not a general recognition model. Guarded
   learned procedures remain barred from flattening evidence waits.
   Direct callers of the low-level effect executor also need their own admission
   contract; the repaired shared `executeActions` entrypoint does not make every
   lower-level API safe for arbitrary observer use.

Background planning remains conservative and expensive: final trials requested
50/58 plans and admitted 10/17; each recording ends with one outstanding planning
request whose terminal cancellation is missing from the stopped trace. Keep
shutdown accounting and dependency-specific revalidation on the optimization list.
Expired heard-evidence tokens can also be swept by another actor before their
owner reevaluates them, producing safe `invalid_barrier` rather than useful
`timeout` diagnostics. Neither case is evidence that the awaited event happened.

Detailed chronological evidence, acceptance gates and trial ledger:
`src/evals/COGNITION-OVERNIGHT.md`.
