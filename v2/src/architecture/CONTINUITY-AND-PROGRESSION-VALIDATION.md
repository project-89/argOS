# Continuity and progression validation

## Dated correction: 2026-09-06 reliability follow-up

The earlier persistence description was too broad: SocialMemory contribution
purposes were serialized but omitted by the explicit loader, together with heard
fragments. Fresh-process/recycled-slot tests now reproduce that loss/residue and
the reliability follow-up repairs it. Remembered prefixes restore as historical
excerpts, not active speech or new notifications. Historical live results below
are unchanged. See [the reliability ledger](LIVING-WORLD-RELIABILITY-VALIDATION.md).

Ordered goal requested 2026-09-06. All five mechanisms implemented and trialed;
final regression gates passed, including the maintenance repair below. No H3
calls; the user's existing demo server was not restarted. Existing recordings
and unrelated worktree changes were preserved.

## What changed

- Explicit listening absorbs ordinary progress of the same heard utterance
  without another model decision, while actual sentence/turn endings and new
  sensory evidence remain interruptible.
- Foreground action selection can omit expressed thought. There is no invented
  housekeeping monologue, lexical repetition filter, or synthetic replacement;
  the audience retains the last genuine thought and original timestamp.
- Actor-owned conversation engagement retains its history and expected outcome
  across individual actions and goal changes. Outcome review can continue,
  pause or close an engagement. Presentation of a deferred notification no
  longer silently postpones the actor's chosen reconsideration deadline.
- The narrative director can retire/replace obsolete **future advice**, citing
  issued evidence. It cannot invent lived history or force actions, goals or
  memories. Separate actor-local suggestions cannot read another observer's
  unshared speech or private messages. Stale asynchronous work is discarded.
- The focused world has four connected rooms and a finite coffee/mug resource
  chain. Routes share menu, planner, dispatch and arrival admission. Coffee
  completion checks exact identities, possession, supply and source lifetime.

See the detailed [goal log](CONTINUITY-AND-PROGRESSION-GOAL.md),
[direction contract](../nle/ADAPTIVE-NARRATIVE-DIRECTION.md), and
[world alternatives](../demo/WORLD-ALTERNATIVES.md).

## Deterministic evidence

Final full suite: **261 suites, 3288 tests passed, 10 skipped**, 151.022s.
TypeScript and diff check passed. `/tmp/argos-continuity-final-full-suite-post-steward.log`
and `/tmp/argos-continuity-final-typecheck-post-steward.log` retain results. Final route union
after the frozen-capability adapter repair passed 11 suites / 233 tests; the
overlapping focused unions are not additional tests to sum with the full suite.

Important failure-derived regressions include delayed attention reminders,
replayed thought publication, private thought coercion into public speech,
stale director work, missing scoped-daemon delivery, exact recorded phrase /
typing boundaries, recycled object IDs inheriting old work, and routes closing
during traversal. Full implementation history and log locations are in the goal.

## Behavioral evidence, not a novelty score

All trials below use real configured production cognition, no H3. Inputs are
two fixed operator texts at 8s and 28s. Seeds/model output are stochastic; core
and maintenance configurations differ, so this is not a controlled speed study.

| Trial | Duration / maintenance | Admissions / expressed thoughts / completed turns | Actual phone chain |
| --- | --- | --- | --- |
| Prior logistics `y9M2Vq` | 120s / off | 66 / 61 / 13 | Read 14.7, 32.7s; replies delivered 19.365, 37.190s |
| Prior breakup `gCnpOP` | 120s / on | 76 / 67 / 14 | Read 15.7, 51.7s; no replies |
| Stage 2 breakup `JkivzO` | 120s / off | 85 / 11 / 15 | First read 16.7s; second unread due to sliding reminder deadline |
| Stage 3 breakup `qguqXW` | 120s / off | 70 / 11 / 12 | Read 15.2, 54.7s; replies delivered 76.785, 94.040s |
| Stage 4 breakup `g5ctqT` | 120s / on | 88 / 10 / 14 | Read 16.7, 45.2s; no replies |
| Stage 5 breakup `Fx4yPS` | 240s / on | 148 / 12 / 29 | Read 12.7, 34.2s; explicitly chose silence |
| Stage 5 logistics `W04xMz` | 120s / off | 68 / 4 / 12 | Read 15.7, 42.7s; replies delivered 28.885, 46.975s |

The optional-expression mechanism is demonstrated, but model admissions have
not shown a consistent reduction. Lower thought counts are not proof of richer
behavior. Genuine repeated emotional thoughts are still allowed.

In qguqXW, outcome review retained the encounter while conversation moved from
the wording to logistics and a face-to-face explanation. Two jokes and the
replies still overlapped in meaning. In g5ctqT, the director genuinely retired
four obsolete pre-date beats at 80s, but the dialogue continued extending one
word-count/punctuation/execution riff. All six reviews chose continuation.
No non-wait physical action followed the second read at 45.2s. No explicit
refusal to reply is evidenced; absence of a reply is not proof of chosen refusal.

Stage 4 foreground median/p95 wall latency: Elaine **1194/2929ms**, Jerry
**1301/3364ms**. The initial slow director requests took 10.8–18.8s and all went
stale. Low-thinking bounded reviews in g5ctqT took 2.53–3.327s, still requiring
four stale retries before an accepted retirement. Its optional local suggestion
was queued, not demonstrated as delivered. Replacement is native-integration
tested; this live run selected retirement without replacement.

## Remaining limits

- Natural dialogue and narrative progression are not guaranteed by these gates.
  Continued company, disagreement, grief and not answering a message remain
  legitimate possibilities, but repetitive riffs are still observable failures
  of variety/progression when no new consequence follows.
- Runtime encounter cursors and in-flight authority are not restored as active
  work. Durable dialogue, contribution purposes and private closures persist.
- Keyword beat matches are telemetry, not verified event occurrence. They no
  longer falsely trigger beat completion or advance the act.
- Global revised narrative plans are visible to the DM formatter, but are not
  automatically installed into every God/spirit or NPC. Actor-local review is
  the implemented follow-through; queued is not delivered.
- Room topology is explicitly opted in; legacy worlds retain their semantics.
  Helpers track edge revision, while an unobserved raw ECS remove/re-add has no
  history to prove the intervening closure. Actual deletion/recycled-ID and
  currently removed raw edges are tested. Restored topology needs explicit
  runtime installation; adjacency data itself persists.
- The camera covers the rooms present at attachment. Simulation-created rooms
  can connect and become traversable, but adding their lifetimes dynamically to
  an already attached camera is not implemented here.
- Scalar ECS stores can collide across independent worlds using the same
  numeric IDs in one process. These live trials run in separate processes;
  identity fences are not a replacement for allocator/store isolation.
- Offline screenplay coverage does not verify H3 prompt adherence, audio,
  provider timing, or video/thought synchronization. Some indivisible action /
  speech combinations still exceed a fixed media budget and must fail visibly,
  not silently truncate. g5ctqT covered all 161 words exactly once, but its
  planned media still contained 30.38% ending holds.

## Extended final trial

Fx4yPS finished 240 simulated seconds / 241.164 wall seconds with maintenance
enabled. Mean ECS tick was 12.5ms, zero slow ticks or reported system/operation
failures. Three background operations canceled at shutdown. Elaine foreground
median/p95 was 1368/3472ms; Jerry 1314/2482ms. All source time compiled into 34
contiguous packets; reason/error null, no unfilmed tail, all 342 spoken-word
receipts exactly once. Those packets plan 290.625s of media, including 102.67s
of ending holds (35.33%): compiler fidelity still does not mean good pacing.

Real choices and limits:

- Elaine read and disclosed both messages, declared radio silence at 97.46s,
  reaffirmed it at 158.28s and explicitly paused the communication goal at 206s.
  Unlike the earlier g5ctqT absence, this is evidenced non-response by choice.
- She actually ate the cookie, returned to Living Room and used the generated
  laptop. Closing her engagement at 128/188.5/227s did not make her deaf: she
  subsequently chose new speech, reopening twice. Jerry never closed; his
  expected outcomes kept asking for her next response. The riff changed from
  word counts to report formatting, rainforest and civic duty through 232.86s.
- Jerry chose a coffee intention, reached Kitchen at 184s and picked up Blue
  mug at 188.3s, then returned at 191.5s without pouring. Four portions remained,
  both drink counters zero. No Hallway/Street visits occurred. Complete coffee
  chains and topology traversal are deterministic native-executor evidence, not
  claimed as autonomous accomplishments in these trials.
- There were 16 generic laptop-use actions, three browse actions and one email
  action. Existing schema effects are `in_use` and stimuli, not a report/email
  data product. The spoken "completed report" is not a completed artifact.
  An earlier native scheduled work goal completed after power-on because its
  predicate is merely room + interaction; a four-hour duration is only metadata.
  Later custom manuscript goals stayed exploratory/paused. This known legacy
  work-contract weakness remains, not repaired by adding a finite coffee chain.
- One private recollection claimed a held cookie at 15s, before actual pickup
  at 21.8s. Subjective narrative memory may embellish physical details; it is
  not canonical possession evidence.

World maintenance made 44 entities across three populated rooms; 29 runtime
systems reported no errors. The generated laptop has its real declared Battery
component. No coding jobs, new systems, new components or repairs ran in this
trial; furnishing is not proof of autonomous mechanic engineering. Four director
reconciliations applied at 80/123/169/213.5s, retiring seven beats and creating two
new advisory alternatives; both alternatives later retired against newer words.
No beat was falsely promoted to completed. Two local suggestions queued without
evidenced receipt; five separate native daemon whispers reached actors.

The new hallway exposed a concrete maintenance classifier defect: substring
`hall` made `Hallway` a tavern, creating bar/ale props despite its authored
description. A bounded follow-up uses whole-word matching and carries the actual
room description as primary function, keeping template hints subordinate. This
repair passed 11 focused tests plus the final full suite; it does not retroactively alter the
recorded Fx4yPS world or claim to solve all furnishing/taxonomy quality.

The final 120s core logistics control W04xMz read and replied to both messages,
with complete offline projection (16 packets, source cursor 120000ms, no reason/
error or unfilmed tail) and no reported system errors. It still continued dinner
banter and did not leave via the new routes. Foreground median/p95 was
1591/4162ms for Elaine, 1273/2569ms for Jerry. Maintenance was off, so its timing
is not a controlled comparison to Fx4yPS.

## Bottom line

The five-stage infrastructure work is testable and functioning. The experience
is **not golden**: conversational re-engagement and multi-step follow-through
still need behavioral work, and legacy stimulus-only activities must not stand
in for productive outcomes. These are now concrete remaining targets, not a
reason to claim a visually convincing or fully natural simulation prematurely.
