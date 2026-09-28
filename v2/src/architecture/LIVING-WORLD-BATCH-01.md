# Reliability batch 01 — prospective protocol

Status: CLOSED INCOMPLETE after episodes1–3. Episode3 exposed a cancellation
receipt bug; production source changed to fix it. Retain all attempts and start
a separately labeled successor only after validation. No batch gate achieved.

Diagnosis: final public event129 is Jerry's `reading` interval, execution
8d429705-944e-4563-a9a6-8acc15f83f10, started119000, expected120200. No terminal
receipt before source seal120000. This is not an unfinished spoken sentence.
The native timeline cancel callback only cleans up; safeSpeechBoundaries correctly
excludes the cut through the unclosed protected action. Director's default reason
mislabels it incomplete_utterance. Pause batch here for lifecycle regression/fix;
if source changes, close this batch incomplete and begin a separately labeled
successor rather than blending fixed and unfixed runs.

Episode 1 runtime: exec session 74806, log `/tmp/argos-b01-coffee-01.log`,
artifacts `recordings/sitcom-coffee-boyfriend-Uw7dlU`. Re-poll this existing
process before any restart. Episode 1 is now terminal (exit 0).

## Episode 1 review

Evidence: `sitcom-coffee-boyfriend-Uw7dlU/sitcom-events.jsonl`, world.json,
result.json. Both texts read at13.2s/38.7s before subsequent disclosure. Jerry
offers mug choice28.1s; Elaine chooses blue37.2s. Jerry picks up42.8s, finishes
pour50.5s, gives51.5s; Elaine finishes drink61s. Final pot3 portions (initial4),
blue mug drinks1/filledfalse, red0. One shared multistep coffee completion, not
two independent completions. Elaine also writes88.4s, reviews92.5s, finishes94.6s
Evening notes revision1; actual commands succeeded. This is a bounded note, not
proof of reviewing external manuscripts mentioned in its text.

Runtime:120s,240ticks,mean tick3.41ms,zero slow ticks. Foreground scheduler p95
Jerry3148ms/Elaine2838ms; completed33/31,failed0/0. Phone queue-to-read5.2s/10.7s.
No outgoing message. Offline18segments reach120s, no reported compiler error;
not H3 playback evidence.

Provisional pass: observed cooperative physical completion and subsequent note
completion, no critical physical/privacy violation found in reviewed chain.
Caveat:104s Elaine says “once he texts” although Alex asked her to text when ready.
No clear adopted departure commitment was found, so do not infer a mandatory
reply failure; retain this as a prospective-memory concern for subsequent trials.
Planning also discarded an unavailable pour plan at70s rather than executing it.
Do not call this perfect cognition or the batch gate achieved.

## Episode 2 review

Artifacts `recordings/sitcom-writing-boyfriend-nzEHUk`; terminal exit0.
Reads18.7s/31.2s. Elaine explicitly rejects the usefulness of writing for someone
present (33.5s thought,41s appraisal), verbally communicates the key location45.4s,
then sends an actual reply77.075s: “Jerry was right here, so I just told him.
Got the cookie, ready for dinner!” Cookie pickup48.8s corroborates that claim;
reply links to actual second message28. Notebook remains blank/draft,revision0,
reviewedRevision-1,completedAtSimMs-1. No writing completion claimed or counted.

Writing follow-through inconclusive: deliberate non-adoption/alternative choice,
not demonstrated ability to finish requested writing. Do not promote this to a
task-completion pass merely because conversation is plausible. Continued key/
notarization banter occurs after the alternative disclosure/reply, not instead of
an observed adopted writing plan. Key ownership becomes “his” in dialogue despite
the original text not specifying ownership; retain as an attribution caveat.
No critical ECS/privacy violation found in reviewed chain.

120s/240ticks,mean tick3.75ms,0slow;foreground p95Jerry2579/Elaine2851ms,
failed0/0. Offline16segments reach120s,errornull. No H3 playback evidence.

## Episode 3 review

Artifacts `recordings/sitcom-logistics-boyfriend-zvTRxi`; terminal EXIT1, not a
clean runner pass. Simulation failednull,120s; offline projection reason
incomplete_utterance: “No complete speech boundary fits the bounded source
horizon.” Fifteen segments, source cursor119000 of120000. errornull alone is
insufficient: reason is the authoritative failed gate. Investigate retained tail.

Behavior evidence: reads14.7s/30.7s, actual replies19.125s/35.605s confirm dinner.
Declines coffee28.6s to leave; cookie pickup41.3s, tin close46.8s, farewell48.5s,
Living Room52.5s,Hallway56.5s,Street62.5s. Subsequent thought91s correctly says
outside; no claim of restaurant arrival. Jerry remains behind and works on notes.
This supports sustained departure intent and real phone delivery, not endless
banter. Provisional behavioral pass only, renderer failed; no critical physical/
privacy violation found in reviewed chain. p95Jerry2473/Elaine2110ms,0failed,
mean tick3.38ms,0slow. No further episode launched this turn.

Purpose: evaluate the existing fast foreground/background cognition and native
action contracts after the recent reliability changes. Keep production source,
model selection and initial conditions fixed throughout the batch. Record every
attempt, including failures. If a source fix is needed, end this batch explicitly
and label its successor; do not replace unfavorable trials.

Prerequisite: current full deterministic suite and TypeScript pass. No H3.
Do not run CPU-heavy test suites alongside latency measurements. Run one episode
at a time with the existing focused runner. Each episode is 120 simulation seconds,
core-only, default configured model, priority controller, narrative mind and
experience reconsideration on (focused wrapper defaults). No injected thoughts,
action sequences or forced replies. Existing fixed texts at 8s and 28s remain.

Order and labels:

1. coffee — reliability-b01-coffee-01
2. writing — reliability-b01-writing-01
3. logistics — reliability-b01-logistics-01
4. breakup — reliability-b01-breakup-01
5. coffee — reliability-b01-coffee-02
6. writing — reliability-b01-writing-02
7. logistics — reliability-b01-logistics-02
8. breakup — reliability-b01-breakup-02
9. coffee — reliability-b01-coffee-03
10. writing — reliability-b01-writing-03

Command template (replace condition/label with the listed values):

```sh
npm run eval:focused:live -- --seconds=120 --core-only --condition=coffee --label=reliability-b01-coffee-01
```

Retain each runner artifact directory and its configuration/source fingerprints,
frames, events, phone chain, final ECS world, scheduler latencies and failures.
For each review cite exact event/frame times for adoption, each committed step,
completion or actor-authored revision; distinguish public evidence from private
thought. Record received/read/replied independently. No reply is not inherently
a failure; no adopted task is not evidence of follow-through. Offline projection
failure remains a separate renderer failure, never erase the simulation evidence.

Acceptance is exactly NOTES §9: at least 8/10 passing episodes with no critical
integrity/privacy violation anywhere, plus at least three autonomous multistep
completions across two task types. Foreground scheduler p95 target <=5s; report
actual measurements. Non-adoption and insufficient opportunity are inconclusive.
No lexical novelty score substitutes for review of repeated banter displacing an
adopted intention. Review before the next run; stop for a critical violation or
runtime instability, diagnose, and retain the partial batch as failed/incomplete.

This core batch does not close maintenance, changed-prerequisite, restore,
world-growth or long-soak gates. Those retain their independent requirements.
