# Handoff correction diagnostic

This is a new condition, not a replacement for the historical writing request or
its failed/inconclusive scores. Batch03 remains closed failed. Both controllers
repeatedly rejected leaving Jerry a note while he was present; that tests adoption
under an awkward request, but supplies little evidence of writing execution.

The handoff condition keeps the same actors, relationship, world mechanics and
input times (8s and28s). Only the two outside texts differ. A building manager is
the intended future recipient, absent from the current scene. The second text
corrects both the appointment time and the object to be inspected. This adds a
changing-information dependency rather than injecting a goal or action sequence.
No manager/plumber NPC or future visit is fabricated in ECS.

## Prospective review

- First determine whether the actor adopts, questions, declines or defers the task.
  Non-adoption is not writing completion; do not force compliance or reclassify
  historical refusal as a pass.
- Track actual delivery/read of each text separately. Unread correction contents
  must not leak into another actor's knowledge or the draft.
- Inspect the final document content for the corrected11AM bathroom-tap details.
  An original10AM kitchen-sink instruction cannot remain the operative instruction
  after a claimed correction. Explicitly marked history may remain.
- Trace write/review/finish revisions. A statement about a finished note is not
  proof. If a finished draft is revised, the new revision requires its own review
  and finish according to the existing mechanics.
- Verify actual document placement in Kitchen, not merely a promise to leave it.
- Verify any completion reply against the artifact and location at its send time.
  A refusal/status reply is allowed but cannot be counted as completed handoff.
- Appointment details are attributed information from Alex's messages. Completing
  a note does not establish that a plumber is booked or a manager has read it.
- Retain all timing, unsuccessful actions, refusals and renderer failures. This
  diagnostic alone cannot satisfy the repeated or longer reliability gates.

Run after validation using the existing focused no-H3 runner:

```sh
npm run eval:focused:live -- --seconds=120 --core-only --condition=handoff --controller=situated --label=handoff-correction-diagnostic-01
```

No live run at document creation. Offline plumbing30s completed with fixed texts
delivered, no cognition/read/actions claimed: sitcom-handoff-boyfriend-AxuZPb.

## First live diagnostic — incomplete handoff

Retained run: `recordings/sitcom-handoff-boyfriend-t1W7ox`, 120s, core-only,
situated controller. Terminal exit0, failed:null; offline projection reached
120000ms without a reported error. This is not an acceptance-batch sample.

Elaine read the original request at16.2s and the correction at30.7s. She wrote
revision1 at54.35s using11AM/bathroom-tap details, carried the notebook and dropped
it in Kitchen at92.1s. A reply delivered at101.555s said:
“Left the updated note on the kitchen counter for the plumber at 11.”

The final artifact has the corrected details, but remains draft, reviewedRevision
-1 and completedAtSimMs -1. No review/finish action occurred. LocatedIn identifies
Kitchen, not Kitchen counter. Therefore actual adoption, correction and room
placement are positive evidence, but this is NOT a completed handoff; the reply's
support-surface specificity is not grounded. No future visit or recipient reading
is established. Foreground p95 Jerry4692ms/Elaine4889ms; mean tick4.27ms,0slowticks.

Source review found that a native Finalize completion option already exists.
Do not add a duplicate goal type. A separate regression reproduced a mismatch:
that option requires WikiDoc.status while native observation admitted only
ObjectState.current. Repairing that evidence boundary does not establish the
cause of this run's skipped review/finish or prove improved autonomous behavior.

The prospective revised-finished-document case is not exercised here: correction
arrived before writing. Current native mechanics offer no editing after finish;
that lifecycle limitation remains open rather than claiming this case is covered.

## Second live diagnostic — completed artifact, delivery cutoff unresolved

`recordings/sitcom-handoff-boyfriend-9FX5ww`, label handoff-correction-diagnostic-02,
same120s/core-only/situated input contract. Source includes document-status
observation, wait-disposition preservation and native lifecycle information.
These changes are bundled; one sample cannot attribute a causal effect to one.

Original read16.2s; correction read47.2s (19.2s queue-to-read). Native successful
document actions: read83.2, write89.8, review94.5, finish106.6. Final content is
“Building Manager: Plumber scheduled for tomorrow at 11 AM to inspect the bathroom
tap.” Revision1/reviewedRevision1/statusfinished/completedAtSimMs106600. Pickup107.8,
Kitchen arrival112, drop114.6; final directLocatedIn Kitchen. This is an actual
completed multistep artifact-and-placement chain, unlike the first diagnostic.

Reply created119.835s: “Left the updated note in the kitchen for tomorrow at 11 AM.”
Its location claim matches the room relation; the private drop-purpose still said
counter, which remains more specific than the actual effect. Reply remains queued
at120s/deliveredMs-1. Do not extend/relabel this run to turn expected delivery into
observed delivery. Therefore NOT a fully completed end-to-end handoff test.

Runtime failed:null/terminalexit0,avg tick6.03ms/0slowticks. Foreground Jerry29
samples median1476ms/p958018ms; Elaine35 samples median1325ms/p953514ms. Offline
compiler16versions reaches120000/reasonnull, no H3/provider/playback test. There is
still prolonged pre-work banter and slow correction uptake; artifact success does
not establish natural pacing or overall reliability. Historical batches unchanged.

## Third live diagnostic — artifact repeats, post-task notification absent

`recordings/sitcom-handoff-boyfriend-OL57JR`, same source/settings/120s as diagnostic02,
label handoff-correction-diagnostic-03. No source edits or heavy tests during run.
Original read21.7s; adoption reply delivered28.270s (“Sure, I'll write the handoff
note for the plumber and leave it in the kitchen.”). Correction read31.2s;
acknowledgment delivered35.475s (“Got it, 11 AM for the bathroom tap.”).

Native read68.2/write75.55/review85.5/finish87.1. Final revision1/reviewed1/finished,
correct11AM/bathroomtap body; pickup99.8/Kitchen103/drop106.6. This repeats the
complete artifact chain. At108.5 she chooses to return to the Living Room for work
and banter, arriving111.5. No ready/completion reply was sent after placement.
The two earlier delivered acknowledgments do not satisfy that final communication.
Therefore this remains an incomplete end-to-end handoff despite successful work.

Runtime reaches120000,failed:null,mean tick5.31ms/0slowticks. Jerry32samples
median1602/p954787ms; Elaine35samples median1421/p954099ms. Terminal exit1 due to
offline renderer: performance_overflow, overlapping essential physical gestures,
sourcecursor31500/4versions/historythrough51500. No H3 call. Preserve this rendering
failure independently of the repeated behavioral capability.

## Causal correction after diagnostic03

The missing post-task text was not solely an intention-retention problem.
Apartment phone verbs removed reply once all personally read messages had been
answered. Admission and completion additionally rejected an incoming message with
any existing outgoing reply. Diagnostic03 acknowledged both messages, so a later
ready-notification was mechanically unavailable even if the actor wanted it.
The original request, including “text me once it's ready,” remained in the actor's
read-message context. No missing-memory field is needed to explain this boundary.

A production regression reproduced acknowledgment → absent reply affordance.
The repair keeps personally read conversations replyable; each follow-up still
requires fresh choice, its own typing interval and live source/identity/location/
possession/power/message guards. It sends nothing automatically and grants no
knowledge to peers. Existing outcomes remain unchanged; a new live run must test
whether the actor actually uses the newly available capability.

## Fourth live diagnostic — explicit refusal, no follow-up opportunity

`recordings/sitcom-handoff-boyfriend-iGtco0`, same120s/core-only/situated condition,
label handoff-correction-diagnostic-04, after phone follow-up repair. Reads16.2/
53.2s; correction queue-to-read25.2s. Elaine appraises the request as being treated
like a secretary and sends a refusal, delivered75.010s: “I can't leave a note.
You'll have to handle the building manager yourself.” She tells Jerry she declined.
Final notebook blank/revision0/draft/reviewed-1/completed-1. No artifact or
post-completion follow-up opportunity; do not count refusal as work completion or
keep retrying to force adoption. Here “can't” is her expressed refusal, not an
engine verdict that writing is impossible.

Terminalexit0,failed:null,avg tick5.36ms/0slowticks; Jerry32samples median1386/
p954950ms, Elaine27 median1758/p957456ms. Offline reaches120000/reasonnull. No H3.
The follow-up repair has deterministic execution evidence but remains unexercised
as an autonomous second reply in this run. Repeated handoff samples demonstrate
both real artifact capability and autonomous non-adoption; they are not a passed
reliability batch. Slow correction uptake and foreground latency remain open.

## Instrumented timing sample — DqygQc

Label foreground-timing-diagnostic-01, same120s/core-only/situated input contract.
Originalread11.7/correction64.7,second36.7squeue-to-read. Earlier references to10AM
precede reading the correction; do not call them forgetting a known update.
Final notebook revision2/reviewed2/finished/completed104100; body contains an
unrelated routine-work paragraph plus correct11AM/bathroomtap details, no operative
old10AM/kitchensink instruction. ActualKitchenarrival108.5/drop110.6.
Replydelivered117.315: “Note is updated for 11 AM bathroom tap and left on the
kitchen counter.” The task's room-level placement is real, but counter is not
supported by LocatedIn Kitchen. Retain that overstatement; do not count perfect
grounding or infer a counter relation. No initialack-plus-followup was exercised.

Runtime120000failednull/terminalexit0,mean5.88ms/0slowticks,offlinecursor120000/
reasonnull. Provider timing in HANDOFF-LATENCY-DIAGNOSIS.md. Artifact/reply success
does not erase slow attention or spatial overstatement; no acceptance pass.

## Appraisal-journal diagnostic01 — JjduLX (2026-09-07)

Fixed120s/core-only/situated handoff, label appraisal-journal-diagnostic-01;
recordings/sitcom-handoff-boyfriend-JjduLX. Source included receipt-context
consolidation, appraisal execution-status normalization and complete appraisal
operator journal. No H3/default-model/controller changes. This diagnostic was
predeclared for journal completeness and causal tracing, not an acceptance batch.

Original read13.2s, correction read33.7s: queue-to-read5.2s/5.7s. Chosen write
completed55.45s with exactly “Building Manager: Plumber visit is tomorrow at
11 AM to check the bathroom tap.” Pickup56.3, review60, finish61.6. Saved note
WikiDoc.status=finished, WorkDocument.revision=reviewedRevision=1,
completedAtSimMs=61600. Kitchen arrival76, drop79.6, saved LocatedIn Kitchen.
Reply created85.660/delivered85.860: “Left the note in the kitchen with the
11 AM bathroom tap update.” This matches the actual room-level state, without
claiming an unsupported counter placement. Cookie subsequently eaten90.5.
No initial acknowledgment-plus-follow-up sequence; that autonomous case remains
unexercised. One successful handoff, not evidence the repeated acceptance gate passed.

Journal captures all three appraisal attempts: requested15s → timeout19s
(4011ms); retry requested22s → current admitted24.5s (2339ms, affectrevision2,
release goal29); correction requested34s → current admitted36.5s (2527ms,
affectrevision3). Both original receipts handled; timeout retained, not hidden.
Runtime mean tick7ms/0slow, terminalexit0/failednull; offline sourcecursor120000,
reasonnull. Foreground provider samples E27 median1657/p953059/max4139ms;
J36 median1314/p954770/max8003ms, including one8s timeout. These are provider
durations, not total response latency. No causal speedup claim from one sample.
