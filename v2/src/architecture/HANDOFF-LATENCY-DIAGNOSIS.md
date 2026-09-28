# Handoff correction latency: iGtco0

Source: retained `recordings/sitcom-handoff-boyfriend-iGtco0` event and cognitive
frames. This is an observed timeline, not a counterfactual estimate of what an
actor should have chosen. No new simulation or provider call was needed.

| Simulation time | Evidence |
| --- | --- |
| 28.0s / 28.2s | Correction queued / delivered and notification emitted. |
| 28.96s | Elaine's existing speech finishes. |
| 28.5–30s | Foreground request chooses wait to finish her statement; 1549ms wall. |
| 32–33s | Actual observe action. |
| 31.5–37.36s | Jerry speaks. Elaine's requests at33s and34.5s choose listening waits; 1247/2021ms wall. |
| 37.5–39s | Foreground chooses to vent to Jerry; 1549ms wall. |
| 39–44.34s | Elaine's resulting speech. |
| 44.5–52s | Foreground request chooses phone read; 7448ms wall. Request integrates successfully. |
| 52–53.2s | Actual phone read, its declared1200ms physical duration. |

No decision-rejection event occurs in this interval. The last action starts when
the slow decision integrates, rather than waiting again for executor admission.
Jerry is speaking49.5–54.96s while Elaine actually reads52–53.2s, so a blanket
other-speaker/room lock does not explain the final read delay. Her own speech and
chosen listening occupy earlier portions of the interval. Do not sum speech and
decision durations: they overlap.

The measured25.2s queue-to-read interval therefore includes behavioral selection,
one long foreground response, and physical execution. It is not25.2s of provider
latency or a single stalled control loop. “Listen” and “vent” are actual chosen
purposes, not inferred from dialogue keywords. The original notification was not
read knowledge of the correction until53.2s.

## Next useful measurement

Foreground currently uses an8s deadline, no retries, max1800outputtokens, and
Google low thinking. The successful7448ms request was close to the deadline;
shortening that deadline alone would discard useful decisions, not make this
response arrive sooner. Do not change model/defaults based on this sample.

The existing logs measure complete foreground request duration but do not retain
provider duration, output/usage counts and finish reason together per request.
Add bounded operator-only metadata at the provider return boundary, correlated by
the existing request ID, to distinguish time spent producing a large response
from network/provider tails and post-response admission. Record no raw output,
prompt, credentials or provider error bodies. Include timeout/error cases without
inventing token counts. This measurement must not alter action/mental admission,
world evidence, or publish private reasoning to peers or the renderer.

Separately, the two listening requests within one voice deserve inspection of
explicit `listeningTo` admission and wake reasons. Do not infer an execution ID
from a model's prose, auto-bind ordinary waits to a speaker, or silence an actor
to manufacture a faster read. Handoff non-adoption remains a legitimate outcome;
we are measuring responsiveness, not commanding obedience.

## Instrumentation implemented

Foreground provider return now emits `foreground_provider_result` through the
operator chronicle, correlated by the existing request fence. It includes elapsed
wall milliseconds, output character count, known finish reason and available
input/output/reasoning/cache-read token counts. Unsupported or absent counts are
omitted, not zero. Provider throw/timeout/cancellation emits only outcome/duration;
a returned but subsequently rejected response remains a provider return, not an
admitted action. Parsing and action validation retain their existing verdicts.

The apartment journal uses its existing world/actor/request ownership filter and
copies only the numeric/enum whitelist into operator-visible disposition data.
No prompt, provider body, error message or raw output is copied. Renderer scenes
and NPC perception do not receive this metadata. Model settings and deadlines
are unchanged. A new measured trial is still needed to diagnose provider tails;
this instrumentation is not itself a latency optimization.

## First measured run: DqygQc

120s/core-only/situated handoff, label foreground-timing-diagnostic-01. All56
provider observations returned normally; Elaine29 samples median1432ms/p956916ms,
Jerry27 median1631ms/p955053ms. These are provider durations, not total foreground
operation durations. Every observed cached-input count was0.

Slowest: Elaine at53s,7480ms,12589input/155output/0reasoning tokens,321outputchars,
finishReasonstop. Next: Elaine at36.5s,6916ms,12067input/224output/0reasoning,
571chars. Jerry at35s,5706ms,10005input/147output/0reasoning. By contrast Elaine
at22s took4246ms with963output/760reasoning tokens. Thus large generated output
or reported reasoning volume does not explain the worst tail in this sample.
No claim of causal input-size/latency correlation from these few requests.

Input counts ranged5491–13890 for Elaine and5258–12021 for Jerry. Next inspect
prompt assembly and repeated material before shrinking output budgets, reducing
deadlines or changing models. Preserve actual source knowledge, private/public
boundaries and goal authority; a compact prompt must not be a less capable agent.
Provider/network tail remains a possible cause independently of prompt size.

## Context consolidation and listening recheck (2026-09-07)

The assembled actor context duplicated action-receipt summaries in physical
working memory and the coordination-review source list. It now prints the full
receipt ID and prose in working memory, then references that exact ID from the
review list. Standalone coordination formatting remains self-contained. The
windows differ (last eight actions versus last eight receipts of any kind), so
only the actual intersection is consolidated. Unique observations, failed action
results, older retained actions and all memory state remain unchanged. This is
not a measured token or latency improvement; short receipts may save little.
Fresh local perception and last-known evidence remain separate deliberately.

Rechecked the repeated-listening interval in iGtco0 using the actual action
payloads rather than purpose prose. Both waits at34s and36.5s explicitly bind
listeningTo=execution:e3201bb0-68ae-42ab-919f-e8964e5335cc. Between the first wait
and the next request at34.5s, the phone buzzes at34.2s and Elaine receives the
familiar-vibration/unread-notification perception (events190–191). A heard
excerpt also arrives at34.5s. Thus this interval includes genuine competing
attention; it is not evidence of a speech-progress-only wake defect. The journal
does not record the scheduler's exact readiness reason, so do not claim that
the buzz was its exclusive cause. Existing listening tests explicitly cover
new-attention interruption while suppressing only trusted same-utterance progress.

Do not suppress notifications to manufacture lower request counts. The remaining
behavior question is how the actor weighs the notification and existing activity,
separate from provider tail latency and the executor's listening binding.
