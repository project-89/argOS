# Batch02 logistics follow-through diagnosis

Evidence source: recordings/sitcom-logistics-boyfriend-lAxQUo, episode7.
No new model calls or source changes during this audit.

The dinner preparation goal24 remains active priority7; phone concern29 is
priority8 and remains selected for background planning repeatedly after the
42.69s confirmation. No departure goal or motor sequence exists in final state.
Completed dinner-prefix plans58/134 cover Kitchen arrival/observation and cookie
pickup/tin close only. These are correctly not whole-goal completion.

Phone plan167 admitted46s: observe phone then wait for a fresh unread notification.
Further phone planning requests86s/95s; plan28 admitted98s also waits for unread
notification. Next dinner-goal planning request is118.5s, admitted120s as plan142:
listen to Jerry's parting remark. No departure execution admitted. Foreground
continues actual delivered banter. Source does not support a schedule-only cause:
this episode stays Kitchen, unlike episode3 which switches to notebook work.

Code findings:

- planningGoals sorts active goals by priority and, with focusActiveGoal, slices
  to one BEFORE shouldPlanGoal readiness filtering. A standing higher-priority
  concern can monopolize planning consideration even when its plan is waiting.
- Typed evidence waits remain Plan.status=active while evaluatePlanEvidenceBarrier
  returns waiting. maintainGoalLifecycles treats active plans as working and only
  separately recognizes awaiting_evidence. The two meanings need reconciliation;
  do not assume awaiting_evidence currently describes every typed wait.
- Runtime execution is actor-owned: getNextPlannedAction filters to the selected
  goal. Do not fix planner starvation by automatically executing a lower goal or
  forcing departure. Background preparation and foreground authority are distinct.
- Final stored plan28 has timeoutMs15000 at step root, while PlanWaitUntil and
  barrier implementation read condition.timeoutMs. Default is also15s here, so
  this mismatch does NOT explain the observed delay, but needs schema cleanup.

Next bounded repair/test: reproduce background planning starvation with a
high-priority evidence-waiting concern and a second owned goal needing a plan.
Allow readiness-aware background preparation without changing current execution
ownership. Prove incoming evidence still wakes the concern and lower-plan
completion cannot confer action authority. Then inspect whether foreground purpose
selection properly distinguishes waiting concerns from executable commitments.
This is a candidate causal repair, not proof it alone restores natural departure.
Do not add lexical reply-to-goal extraction, forced goals or banter quotas.

## Readiness repair checkpoint

Reproduced with deterministic injected planning: both new tests failed before
the patch (no background request for the lower owned goal). Background candidate
selection now filters readiness before taking its priority head. Admission uses
the same readiness criterion for higher-priority competitors; a newly ready
higher goal still invalidates the pending proposal. Non-background selection
and foreground execution selection are unchanged.

41 focused tests pass across planning telemetry and evidence boundaries. The
typed physical-wait regression proves another plan can be admitted without
advancing either plan, the selected wait still returns no executable action,
and real local evidence wakes that wait without executing the lower plan.
Initial TypeScript check passed; full regression underway. No new live episode
or behavioral improvement claimed at this checkpoint.

Lifecycle qualification: maintainGoalLifecycles' active-plan working check is
inside the exploratory-mode branch. Standing social intentions are social mode,
so that branch must not be called the demonstrated cause for the standing phone
concern without inspecting its actual lifecycle component. Do not retire social
desires merely because they currently wait. Next inspect selected-purpose
continuity and run a bounded logistics diagnostic after regression, before a new
prospective acceptance batch.

Saved world confirmation: goal24 is social/episodic; goal29 social/standing.
Goal29's actor-authored deferral occurs at118000ms, reason all incoming messages
read/answered, wake on that phone experience channel, until148000ms. Thus the
exploratory lifecycle branch is not responsible for either goal here. Preserve
the actor's capacity to defer a standing concern; preparation readiness should
not itself change Goal.status or manufacture such a choice.

## Live readiness diagnostic 01 — not an acceptance batch

Full prerequisite passed274suites/3394tests/10skipped,297.631s; TypeScript clean.
Logs /tmp/argos-planning-readiness-{red,green,full,types}.log.
Then120s core-only logistics, unchanged models/motives/inputs, no H3:
recordings/sitcom-logistics-boyfriend-xyr8Ja, exit0, failednull.

Reads13.7/36.2s; delivered confirmations24.04/40.56s. Actual cookiepickup69.8s,
tinclose76.3s. Dinnergoal24 now receives planning27.5/31/73.5/82s (admitted33,
75,84.5), unlike the prior118.5s drought. This does not isolate a live causal
effect: the actor also lowered phonepriority to6 in this run. The deterministic
regressions, not between-run anecdotes, establish the selection repair.

Follow-through remains NON-PASS: no departure, continued reservation banter and
LivingRoom89.5s/notebook interactions91.7/96.85s. Crucially dinnerplan84 itself
imports afternoon work/notes into preparing for dinner: move LivingRoom, observe
notes, think about settling schedule. Goal37 is a separate afternoon-work routine
priority7. This is not merely the executor selecting the wrong higher goal:
the dinner planner authored the detour under goal24. Next inspect planning
context goal separation and action relevance/continuation before adding prompts
or suppressing routines. Do not label a new authored prerequisite legitimate
solely because the plan says it is needed.

Foreground p95Jerry2066/Elaine3392ms (Elaine max8017),avg tick5.07ms,0slowticks.
Offline reasonnull/errornull,cursor119500 of120000,16versions,no reported tail.
Do not describe that as full120000 coverage; inspect final500ms separately if
needed. No H3/provider result. No new acceptance batch started, no live job left.

## Planner scope diagnostic and phone chronology

Planning context now names assigned goal ID/kind and separates other goals as
competing intentions, not prerequisites. Replaced broad “propose intentions”
role with preparation for one intention; no forced choice, hidden routines or
lexical rejection.54 focused tests/TypeScript pass. This interface check does
not prove semantic adherence.

120s noH3 logistics diagnostic planning-scope-diagnostic-01:
recordings/sitcom-logistics-boyfriend-oy62zx,exit0/failednull. STILL NON-PASS:
reads19.7/54.2s,replies39.28/68.335s,ongoing banter through120,no departure.
p95Jerry4123/Elaine5008ms (Elaine exceeds5s target),avg5.49ms,0slowticks.
Offlinecursor120000reasonnull. /tmp/argos-planning-scope-live.log.

New grounded defect: secondtext delivered28.2s BEFORE firstreply39.28s, but
appraisal56.5s treats it as questioning her already-sent confirmation. The read
experience omitted transport timestamps, persistent read receipt had only
readAtSimMs and repliedboolean. Cannot attribute all emotion to this omission,
but model lacked relevant causal ordering and the interpretation is unsupported.

Added observed sentAtSimMs/deliveredAtSimMs to completed private read experiences
and immutable inbox receipts; repliedAtSimMs recorded only on completed typing.
Context exposes those stored values, not mutable transport aliases. Optional
receipt fields preserve legacy unknown timing rather than invent it. Regression
proves secondarrival<firstreply<secondread, unread privacy, peer isolation and
later transport edits cannot rewrite remembered timing.45 apartment tests pass,
TypeScript clean; /tmp/argos-phone-chronology-{tests,types}.log. No full suite
or live run after this chronology patch yet. All sessions terminal.

Next: full regression, then bounded behavioral check if warranted. Still inspect
planner mandatory1–7steps/no explicit abstention and foreground conversational
continuation: clear scope alone did not solve loop. Avoid declaring improved
follow-through or model quality based on data-contract tests.

## Chronology replay and next architectural boundary

Full chronology checkpoint274suites/3396tests/10skipped,192.043s,
/tmp/argos-chronology-full.log. Then noticed appraisal lacks foreground inbox
context: completed read detail now also carries at most4 remembered own completed
reply IDs/sent times, from immutable private receipts. No public delivery or
other actor memory synthesized.107focused apartment/appraisal tests and types
pass (/tmp/argos-chronology-appraisal-{tests,types}.log); this final small addition
has not had a subsequent full suite.

chronology-diagnostic-01,c1m1Nq,120s core-only/noH3,exit0/failednull:
reads14.7/34.7,replies18.345/44.58. Here firstreply PRECEDES secondarrival28.2,
so annoyance at followup is chronologically plausible; this run does NOT test
the delayed-read misinterpretation from oy62zx. Follow-through STILL NONPASS:
banter through115.6,no demonstrateddeparture. p95Jerry3428/Elaine3387,
avg4.47ms/0slow;offline120000reasonnull. No new acceptance batch.

Read oy62zx cognitive frames (not final stopped snapshot, whose continuation is
absent by design): actor chooses independent banter47s, goal29waits76.5s onward,
alternating independent retorts and phone/listening. Final purpose is retort,
not engine-forced speech. False chronological reading created a plausible but
unsupported wait-for-Alex rationale; don't assume all looping is mechanical.

Next concrete source boundary: coordination-memory speech() only consumes
getSocialDialogue/getSocialExchanges; undertake/report require an own speechId.
Apartment reply completion records private reply_typed event but action receipt
only says reply sent; it does not register a private communication source with
coordination. c1m1Nq Elaine has NO CoordinationMemory component. A text promise
cannot currently receive the same semantic undertaking support as spoken words.
This is a missing capability, NOT proof all characters should adopt every text
as a binding goal.

Next implement/test generalized private communication evidence (sent/read exact
body, durable source identity, actor ownership, transport/read timestamps),
semantic coordination reviews over that source, and persistence. Do NOT fake
audible SocialDialogue turns: publish() currently distributes speech-backed
undertakings to listeners. Text reviews must remain private unless a real read
or disclosure authorizes a recipient. Preserve sent≠delivered≠read, no forced
undertakings, no lexical extraction of “on my way”. General library capability,
not a dinner-specific reply rule. Test actual sent promise can be reviewed and
linked while unread/unsent/peer/changed-source inputs cannot leak or authorize.
All tools/processes terminal; goal active. No new live run until this is scoped.

## Private communication implementation and live diagnostic

Implemented CommunicationMemory ECS/schema/restoration and library
communication-memory.ts. Trusted completed sent/read adapter; actor/source and
time checks;64receipt bound; copy-on-read; duplicate identity cannot overwrite;
private text source union in coordination (not added to SocialDialogue).
Publication explicitly excludes private-text reviews. Foreground evidence filter
and optional review wording now accept actual own sent sources, still using the
compatibility field speechId. Apartment actual completion invokes the adapter;
unsent/canceled work cannot produce sent evidence. See
PRIVATE-COMMUNICATION-EVIDENCE.md for scope and remaining recipient limitations.

75 integration tests pass incl real phone completion, semantic foreground review,
no peer/audio/public-event leak, invalid/stale/replayed input, and ECS restore.
Full275suites/3401passed/10skipped189.535s,TypeScriptclean.
/tmp/argos-private-communication-{tests,integration,types,full}.log.
Then added new communication and coordination source hashes to trial capture.

private-commitment-diagnostic-01,recordings/sitcom-logistics-boyfriend-lDkF0E:
120score/noH3,exit0/failednull. Private store correctly has incoming reads17.2/
31.2 and outgoing35.36. Reply delivered35.56 confirms both requests semantically;
no separate reply to first ID, not automatically a failure for an already answered
question. Cookiepickup36.3,tinclose37.3,coffee drink53.5/drop66.1,LivingRoom70.5.
No departure; still banter. CoordinationMemory remains ABSENT: model did not opt
to review its text as an undertaking. Capability wired, autonomous uptake not
demonstrated. Do NOT declare sustained-intention success. p95Jerry3152/Elaine4858,
avg5.5ms/0slow;offline120000reasonnull. All sessions terminal.

Next inspect a bounded background semantic coordination review over NEW owned
communication, rather than relying exclusively on an optional foreground JSON
field. Current code has no such background consumer. It must be allowed to return
no undertaking, preserve actor ownership, exact sources, stale-admission fences,
private/public distinctions, and avoid repeated inference on unchanged evidence.
This is a candidate next design, not implemented or proven. Do not auto-create
goals by matching text words. Also retain scenario caveat: initial simulation is
16:00/afternoon, dinner “this evening”, and initial perception explicitly allows
conversation. No exact departure deadline exists. Do not reinterpret all two-minute
delay as physical failure; retain prior acceptance results, but separate whether
an actual immediate commitment was made from later-evening preparation.
