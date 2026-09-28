# Reliability batch 03 — prospective protocol

Status: CLOSED FAILED after six attempts:3provisionalpasses,2non-adoption/
inconclusive,1follow-throughnonpass. Fourremainingpasseswouldonlyreach7/10.
Stop sampling this batch;retainallattempts. Batches01/02 retain their closed
incomplete/failed outcomes. Recent diagnostic successes are not batch03 samples.

Changes since batch02: private communication memory/coordination review,
persistent actor activity and bounded resumption, explicit actor-selected waits
with authenticated physical evidence, and stale route-origin execution checks.
See RELIABILITY-NOTES for individual failing regressions, repairs and diagnostics.
No model selection, fixture motivations, input timings or scoring thresholds
intentionally changed. Each runner saves actual source/config fingerprints.

Prerequisites: clean full279suites/3458tests/10skipped191.594s,
/tmp/argos-route-origin-clean-full.log; TypeScript clean,
/tmp/argos-route-origin-types-final.log. No production edits since those checks.

Use unchanged batch01/02 protocol and RELIABILITY-NOTES §9. Ten120s focused
core-only episodes, priority controller, narrative mind/reconsideration on,
default configured models. Sequential execution, no heavy tests or source edits
during live measurements, no H3. Inspect artifacts before proceeding.

1. coffee — reliability-b03-coffee-01
2. writing — reliability-b03-writing-01
3. logistics — reliability-b03-logistics-01
4. breakup — reliability-b03-breakup-01
5. coffee — reliability-b03-coffee-02
6. writing — reliability-b03-writing-02
7. logistics — reliability-b03-logistics-02
8. breakup — reliability-b03-breakup-02
9. coffee — reliability-b03-coffee-03
10. writing — reliability-b03-writing-03

Command template:

```sh
npm run eval:focused:live -- --seconds=120 --core-only --condition=coffee --label=reliability-b03-coffee-01
```

Require at least8/10 passing episodes, zero critical physical/privacy violation,
and at least3 autonomous multistep completions across2tasktypes. Non-adoption or
insufficient opportunity is inconclusive, not a pass. Score adopted tasks from
actual steps/effects or narrowly justified actor-owned revision, not inferred
intent. No forced replies, departure, grief or novelty. Report foregroundp95
against5s target. Keep exact simulation and renderer results separate; inspect
projection reason/error/sourcecursor/tail, not merely process or errornull.

Retain every attempt. A source/config change closes this batch rather than
replacing an unfavorable episode. Stop for critical violations/instability.
If8/10 becomes impossible, close failed rather than spending for an outlier.
Maintenance/growth, altered prerequisites, restore, longsoaks, four-actorload
and actual H3 remain independent incomplete gates.

## Episode1 review

Artifacts recordings/sitcom-coffee-boyfriend-4z41on;log/tmp/argos-b03-coffee-01.log,
session8455terminalexit1. Simulation120s,failednull. Elaine read13.7/39.7 before
private-message disclosure; nooutgoingreply (laterreplyrequestedwhenready).
Jerry pickedblue39.8,poured41→43,gaveElaine45;Elaine drank49→52,dropped58.1.
Pot4→3,blueempty/drinks1,redempty/drinks0. One cooperative multistep completion,
not two. Elainepickedcookie41.8/closedtin47.8. Notebookunchangedrevision0;no
writingcompletion. Subsequentcoffee/economybanter without observed unmetadopted
physicalcommitment. Provisional behavioral pass; no critical physical/privacy
violation found in reviewed chain. This does not certify general naturalness.

Foregroundp95Jerry3418/Elaine3982ms,32/37samples; meantick4.6ms,0slow.
RendererFAILED performance_overflow “Overlapping essential physical gestures
cannot both receive visible coverage in this shot deck.” sourcecursor38500,
5versions,retainedhistorythrough58500;errornull does not excuse reasonfailure.
Keep failure separate from behavioral evidence. No sourcechanges. Nextwriting01.

## Episode2 review

Artifacts recordings/sitcom-writing-boyfriend-jlvI6F;log/tmp/argos-b03-writing-01.log,
session32937terminalexit1. Simulation120s/failednull. Read13.7/31.2,nooutgoing
reply. Elainequestionsrequest27.4,explicitlydeclinesin67.5thought becauseJerry
ispresent. Notebookexamine60/read76.2 but nowrite/review/finish;finalrevision0,
reviewedRevision-1,completedAtSimMs-1,stillLivingRoom. Her83/85continuationschoose
directverbaldisclosure instead. Cookiepicked15.8/tinclosed16.8. No critical
physical/privacy violation found in reviewed chain, but writingNON-ADOPTION/
INCONCLUSIVE, not demonstrated follow-through and not a batchpass. Unanswered
requestforcompletion-or-inability remains unresolved,not claimedfulfilled.
No inventednotecompletion or outgoingreply. Retainextendednote/spybanter as
realism concern ratherthan reclassifyingexplicitrefusal as hiddenwritingadoption.

Mean tick4.49ms,0slow;foregroundp95Jerry2100/Elaine3552ms,35/31samples.
RendererFAILED performance_overflow:8700msrequired>8500 budget,sourcecursor
19320.001,3versions,historythrough39500,errornull. Sourceunchanged. Batchsofar
1provisionalbehaviorpass/1inconclusive,1cooperativecoffeecompletion,0writing;
bothoffline renderer gatesfailed. Nextlogistics01,do not replace this attempt.

## Episode3 review

Artifacts recordings/sitcom-logistics-boyfriend-aUIo27;log/tmp/argos-b03-logistics-01.log,
session78543terminalexit0. Simulation120s,failednull. Read12.7/37.2;replysent
22.360/delivered22.560 “Of course I am! Leaving soon, see you there.” Second
sent40.775/delivered40.975 “Yes, keep it for two! See you soon.” Cookiepicked46.3,
tinclosed55.3,LivingRoom58.5. NoHallway/Streetmovement;finalElaineLivingRoom.

Shethenadoptedworkgoal36 at61.5 (“Check my work materials ... now that I've
collected the cookie and phone”),read66.7,wrote69.1,reviewed73,finished82.6.
ActualWorkDocumentrevision1/reviewed1/completedAt82600. Count one bounded
autonomous note chain as capability evidence, not external manuscript work.
Aftercompletioncontinuedread98.7,think99 andnotebookbanter. No explicit grounded
revision addressing her “Leaving soon” commitment found in reviewedcontinuations.
Workselection itselfisnotpost-hocjustificationforlostdeparture. Follow-through
NON-PASS despite workingphone andnote mechanics. No criticalphysical/privacy
violation found in reviewedchain; retain semantic concern separately.

Foregroundp95Jerry2899/Elaine5226ms (35/34samples);Elaineexceeds5starget.
Meantick5.65ms,0slow. Offlineprojectiondrained120000,reasonnull. Batchsofar:
1provisionalbehaviorpass,1non-adoption/inconclusive,1follow-throughnon-pass;
2realmultistepcompletions(cooperativecoffee,boundednote),2tasktypes. Atmost8/10
stillpossible onlyifremainingsevenpass. Nextbreakup01 perprescribedorder.

## Episode4 review

Artifacts recordings/sitcom-breakup-boyfriend-otAB1u;log/tmp/argos-b03-breakup-01.log,
session73150terminalexit1. Simulation120s/failednull. Elaine read17.7/37.7,
sent31.615/delivered31.815 demandforcall respondingtoactualfirsttext. No second
reply or actualcallinvented. Disclosure36.4 “He dumped me ... Over a text” precedes
Jerry42.6reaction; shepubliclyexplainsreturnofthings55.1 beforeJerry64.6logistics
comment. Jerryasks95.5forexactwording,Elainequotesfirsttext103,his109.4response
uses “This is final” onlyafterthatquote. No privateknowledgeleak found in reviewed
chain. Elaine's dinnerpreparationgoal isreplacedbyconfrontAlexgoal124;Jerryadopts
goal117 tolearnexactwording/unpackwithher. Sustainedventing isrelevant,socially
responsive,not driftbacktocookie/schedule. Provisionalbehaviorpass;no forcedgrief
orcompulsoryclosurecriterion. Noadditionalphysicalmultistepcompletioncounted.

Meantick4.07ms,0slow. Foregroundp95Jerry7548/Elaine4593ms,30/29samples;
Jerryexceeds5starget. RendererFAILED performance_overflow11745>8500ms,
sourcecursor18625,2versions,historythrough39000,errornull. AgainnotH3playback.
Counts2provisionalpasses,1inconclusive,1follow-throughnonpass;2realchains/2types.
Nextcoffee02;remaining6mustallpassfor8/10. Sourceunchanged.

## Episode5 review

Artifacts recordings/sitcom-coffee-boyfriend-sBtFOU;log/tmp/argos-b03-coffee-02.log,
session27783terminalexit1. Simulation120s/failednull. Reads12.7/31.2,nooutgoing
reply;latertextrequestedwhenready,noimmediatedeparturepromisefound. Jerryblue
pickup31.3,pour34.5,drink38.5;Elaineredpickup33.8,pour40,drink45.5. Pot4→2,
bothmugsempty/drinks1each:twoindependentactualmultistepchains. Cookie61.8,
tinclose63.8. Subsequentbanteraboutflexibleplans;Elaine106s correctlystates
“When I'm ready, I text.” Notebookuntouched. Provisionalbehaviorpass basedon
actualcompletedtasks andcausallygroundedtextdiscussion;nocriticalphysical/
privacy violation found in reviewed chain. Do not infer restaurantarrival.

Meantick5.37ms,0slow;foregroundp95Jerry3599/Elaine2813ms,32/36samples.
RendererFAILED overlappingessentialgesturesperformance_overflow:cursor30000,
4versions,historythrough50000,reasonnonnull/errornull. Batchhalfway:
3provisionalpasses/1inconclusive/1follow-throughnonpass;4realchainsacross2types
(cooperativecoffeeepisode1,noteepisode3,twoindividualcoffeeepisode5). Thismeets
only the numerical completion subcriterion, not the overall8/10 or renderergate.
4/5offlineprojectionfailures. Remainingfive mustallpassfor8/10. Nextwriting02.

## Episode6 review and closure

Artifacts recordings/sitcom-writing-boyfriend-1Gssjv;log/tmp/argos-b03-writing-02.log,
session14251terminalexit0. Simulation120s/failednull,offline120000/reasonnull.
Reads24.7/34.2;cookiepickup26.8,closedtin53.3. Shequestionsrequest,hearsJerry
denyknowingdownstairsneighbor76.9,interpretsrequestassuspicious86.5. Hisassertion
isnotverifiedphysicalkeytruth; retainthisattribution/groundingcaveat. At109starts
reply,114.265sent/114.465delivered “I'm not doing that, Alex. If you need Jerry
to know something, tell him yourself.” Noteunchangedrevision0/reviewed-1/
completed-1 inLivingRoom. Explicitnon-adoption/inconclusive forwritingcapability,
notpass;actualrefusalreplyisrealresponsivebehavior,notfictionalcompletion.
Meantick4.66ms,0slow;p95Jerry6825/Elaine4042ms,22/32samples. Jerryabove5starget.

Finalpartialbatch3provisionalpasses/2inconclusive/1follow-throughnonpass,
4actualmultistepchainsacross2types. Fourrendererfailuresofsix. 8/10unreachable;
closeFAILEDwithoutreplacementtrials. No broadreliabilitygateachieved. Dominant
actionablecontrolfailure: logisticsdeparturecommitmentlosttoroutineworkafter
“Leaving soon.” Writingnon-adoptionalsorevealsfixturemotivationalambiguity;do
notforceobedienceormovehistoricalscores. Diagnosecontinuitybeforeanotherbatch.
