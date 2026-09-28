# Breakup episode baseline — 2026-09-05

Read-only audit of `recordings/sitcom-live-WdSm2T`. No saved artifact was changed, no simulation was advanced, and no model/H3 call was made. This is the user's actual run, not a scripted reproduction or a claim that the subsequent fixes work.

## Finding

The phone physics worked, but the experience did not. Elaine read all four messages from Sam and physically typed four replies. Her first response took **85.32 simulation seconds from the breakup text**, however, and the render transport added a growing delay. The relationship crisis became a narrow “reply to a message” task, then evaporated back into the cookie argument. Generic phone-action projection and unchanged visible expression gave the renderer too little evidence to show the inner event.

The existing success gates all passed. They establish delivery, ownership, actual read-before-reply, and some autonomous cognition; **they do not establish responsiveness, lasting emotional consequences, narrative progression, or audiovisual fidelity**.

## Evidence and clocks

- [Private/operator journal](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/sitcom-events.jsonl): 4,297 ordered events. `sequence` values below identify the original records.
- [Public committed journal](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/public-events.jsonl): 1,068 events, including 481 speech slices belonging to 35 completed turns and one final partial turn.
- [Audience frames](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/audience-frames.jsonl): 1,534 samples; no journal fault or dropped frames reported.
- [Playback metadata](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/playback.json), [segment metadata](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/segments.json), [final world](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/world.json), and [result](/Users/parzival/workspace/oneirocom/project89/argos/v2/recordings/sitcom-live-WdSm2T/result.json) supply the other measurements.

The world reached **356.000s** and stopped manually. `ffprobe` measured **341.914s raw video** and **341.950s UI composition**, both H.264/AAC. Media positions below are the interface's expected positions obtained from the **first occurrence of the actual prompt version**, with the existing within-window retiming. They are not frame-exact observations of generated acting or spoken audio.

## Phone chronology

Sam's contact profile was set at **28.5s**, journal 349: `boyfriend`, shared context `You had a date tonight`. The earlier automatic message keeps its original unknown sender correctly.

| Incoming text | Sent, source s | Actually read, source s | Reply delivered, source s | Expected read / reply position in video |
|---|---:|---:|---:|---:|
| Automatic audience/cookie reveal | 25.000 | 27.700 | No reply | 29.325 / — |
| “We are breaking up!” | 73.000 | 81.200 | 158.320 | 99.825 / 202.445 |
| “Elaine where are you?” | 122.500 | 130.700 | 166.895 | 166.325 / 211.020 |
| “Hello???” | 167.000 | 170.700 | 176.495 | 214.825 / 220.620 |
| “Dont come.  We are done.” | 245.500 | 248.700 | 255.470 | 326.825 / 333.595 |

Each message was delivered after 200ms. Seven actual phone vibrations occurred, including six-second repeats while unread. Read and reply records have no observed read-before-delivery or reply-before-read violation. Elaine acquired the phone at **8.3s**, returned to the Living Room at **20s**, and retained it throughout the later exchange.

The actual replies were:

1. **158.320s**: “Sam, what are you talking about? I'm at Jerry's!” — reply to the breakup, journals 1792/1820/1823. Typing occupied **155.000–158.120s**.
2. **166.895s**: “Sam, I am so sorry! I got caught up in total chaos here. Please don't break up with me, let me explain!” — reply to the location question, journals 1858/1937/1940. Typing occupied **160.000–166.695s**, executed from a stored plan.
3. **176.495s**: “I'm at Jerry's, leaving right now! Hold on!” — reply to “Hello???”, journals 2074/2077. She did **not** subsequently leave the room. The fixture only supplies Living Room and Kitchen; it has no reachable date location or apartment exit.
4. **255.470s**: “Sam, wait! I got completely held up, please don't do this!” — journals 3083/3117/3120. Typing occupied **251.500–255.270s**.

Thus “no response” is not the final ECS outcome. The first response was very late, and scene-synchronized chat deferred its visibility until roughly **3:22 of the video**. The last response was deferred until **5:34**, near the end of this recording.

## Cognition: missed transitions, not just a slow model

Elaine's median foreground request duration was **1,009ms**, p95 **2,697ms**. The long pauses came from admission starvation and priorities, not a single 30-second inference.

Her first admitted reasoning thought occurred at **46s** (expected video 47.625s), versus Jerry 1.5s, George 5s, and Kramer 10s. Then **no new reasoning thought survived between 46s and 114.5s**.

Between the breakup read at 81.2s and the first admitted acknowledgment at 114.5s, the event journal contains:

| Outcome in source interval [81.2, 114.5) | Count |
|---|---:|
| Whole decision superseded: `local_view_changed` | 7 |
| Whole decision superseded: `body_availability_changed` | 1 |
| Independent body action admitted, mental envelope omitted: `local_view_changed` | 3 |
| Independent body action admitted, mental envelope omitted: `dialogue_changed` | 1 |
| Admitted mental update | **0** |

For example, the request at **84s** returned a `think` selection at **85.5s**, discarded for `local_view_changed` (journal 971). Further `speak`, `wait`, and inspection-adjacent mental responses were discarded while the others continued discussing maritime law. Counts describe dispositions in the interval, not an assertion that every rejected draft concerned the breakup; rejected private draft text is not recorded.

Across the run, Elaine had **129 request-identified dispositions**: 15 full mental admissions; 43 independent body admissions with the mental update omitted (20 local-view, 23 dialogue); 70 whole supersessions (55 local-view, 7 body, 6 dialogue, 1 target, 1 location); one suppressed selection. Her full mental-admission rate was **11.6%**. Across all four characters it was **97/547 = 17.7%**. Start-event counts additionally include native selections and unfinished/unmatched requests and should not be used as the same denominator.

At **114.5s** she finally thought: “...plus Sam dumped me!” (journal 1291), but her immediately following spoken turn still addressed the cookie concealment. The saved goal's simulation-age metadata dates **“Reply to Sam to address the date and breakup text” to 153.5s**, priority 7. At 155s she explicitly prioritized Sam; at **159s**, immediately after sending, her next thought was already back to observing George's defenses.

The second firm breakup was processed better: read 248.7s, relevant thought 251.5s, delivered reply 255.47s. Nevertheless, at **265.5s** she returned to George's cookie excuse. At **287.5s** the social-goal resolution was: **“I have replied to Sam's text and there are no unread notifications right now.”** The goal is completed in the saved world, followed by a new cookie-confrontation goal at 289s. That resolves message handling, **not the relationship rupture**. There is no saved continuing relationship-repair or departure goal.

A stale planned reply to already answered message 241 was attempted at **273.5s**, roughly 96.5s after its plan was created. Physics rejected the duplicate correctly (journal 3347). The failure still cost a decision/action opportunity; the plan's premise should have been invalidated when the first answer committed.

## What the other characters and renderer could actually know

Elaine never audibly disclosed Sam's breakup: reconstructed committed speech remains about cookies, concealment, preservation, climate control, and maritime law. The friends correctly did **not** inherit private phone text. Their failure to react is not evidence that they forgot a breakup they heard. A useful narrative test must first produce a voluntary disclosure or an observable reaction, then evaluate friends' perception and response.

The baseline also lacks a visible reaction channel. The saved Elaine `Appearance` is still **`attentive`, `standing`**; its last-update timestamp corresponds to the early phone pickup. No public appearance/emotion event appears in the journal. There is no dedicated emotion component on the saved actor; `Mind.focus` remains `hungry`. These facts do not establish that no private affect existed transiently, but they do establish that this run persisted no corresponding visible expressive change.

Phone animation was under-specified despite real physical use:

- Every committed read/reply receipt was the generic **`action: "interact"`, target 16**. It contained no public read-versus-type operation.
- Audience body state did record **`operation: "reading"`** at 80–81.2s, but recorded **`operation: "inspecting"` during all sampled reply intervals** (156s, 165s, 175s, 254s), not typing.
- Thus the renderer needed a better public physical operation, not private message text or an invented phone action. Keeping phone contents private is correct.

## Render delay and speech

The continuous H3 stream produced **40 metadata chunks but only 31 distinct applied source versions**. Nine chunks reused a previous version: indices **8, 10, 13, 15, 22, 27, 32, 35, 37**. They account for **76.5 seconds** during which the UI deliberately holds the end of that already represented source window. This describes repeated prompt context, not proof that the provider replayed identical footage.

At the final represented boundary the video had covered **263.5s of lived source**, while the world had reached **356s**: **92.5s ahead**. Version 32, covering 263.5–272s, was sent but has no represented chunk. The last 92.5s of simulated events therefore cannot be assessed from this video's pixels.

For 30 represented prompt updates, send-to-`prompt_applied` latency was median **6.609s**, p95 **15.440s**, maximum **15.824s**. Five provider deadline misses were logged. The client sent each next prompt almost immediately after the prior version first appeared, but provider update timing still sometimes retained the earlier context for another window. Faster client polling alone will not remove this backlog.

The source transcript is grammatical, but narratively repetitive: maritime-law defenses recur from **68.7s** to the closing dialogue after **346s**. Elaine's 288.2s “not the Atlantic Ocean” objection revisits George's 78.7s objection. This is a genuine cognition/narrative loop independent of H3. The user's reported gibberish and literal audio repetition need a separate listening/alignment audit; they are **not independently verified here**. Provider context repetition and speech sliced across source windows are concrete rendering risks, but do not prove the exact words spoken by the generated audio.

## Minimal safe next work

1. **Durable, actor-owned appraisal of personally perceived events.** Keep a read receipt unhandled until its significance has been processed. Admission should be tied to that immutable receipt and conversation revision, not unrelated people beginning/ending inspections. Persist changed priorities/affect/intent when justified; answering a message must not imply the underlying conflict is repaired.
2. **Separate physical validity from mental freshness without erasing the fences.** The current foreground implementation compares the whole visible activity signature and every newly notified coherent speech span. Existing tests correctly protect changed targets, routes, ownership, command availability, newer directed dialogue, and stale scene claims. Do not globally ignore these changes. A receipt-based appraisal lane can survive unrelated activity; a present-tense scene decision and any physical command must retain their appropriate current-source checks. Historical thoughts, if separately admitted, must be explicitly source-dated and cannot carry current goal/coordination mutations by implication.
3. **Invalidate settled message plans and test behavior under social load.** Reproduce the 81.2–114.5s starvation with concurrent speech/inspection, test contradictory follow-up messages and cancelled/replaced actors, assert one meaningful private reaction and durable issue tracking without forcing a reply, then test voluntary disclosure and peer uptake.
4. **Publish actual physical expression.** Correct typing operation and committed room-local body/appearance evidence. Neither emotion labels nor camera directions may leak the phone's contents to other NPCs.
5. **Only then test H3 again.** Keep render transport/speech fidelity gates distinct from cognition success. Measure represented source age, repeated versions, complete utterance continuity, and visual phone use separately.

Baseline code paths inspected: `agentThink` / `checkMentalSources` in `agent-mind.ts`, `checkForegroundDecision` in `foreground-action-admission.ts`, `readSurface` in `cognitive-local-view.ts`, their admission/mental-envelope tests, and `SitcomPlayback` / `sitcomAudienceMessages`. Current code may be changing concurrently; the measurements and chronology above derive from the preserved run artifacts, not a reconstruction using those newer implementations.

## Implemented architecture for the controlled follow-up

These changes describe the candidate implementation, **not measured candidate outcomes**. The follow-up evaluation is responsible for establishing latency, sustained changes in priorities, natural dialogue, and peer response. No H3 generation is needed for those cognition checks.

- **Immutable personal experience:** `experience-appraisal.ts` accepts trusted executor receipts only after a phone read actually completes. It copies the exact experienced content, coalesces newer receipts from the same channel, and retains unsuccessful batches for bounded-backoff retry. Its small private context contains the actor's own persona, memories, intentions, and affect—not a live survey of other minds or the room. A successful appraisal creates a source-timed episodic memory and private `appraisal` thought; optional changes are a self-reported feeling and a subjective social intention. Neutral appraisal is valid. No reply, sadness, disclosure, action, or objective completion is forced.
- **Persistent affect, optional visible expression:** `affect-state.ts` stores actor-owned affect in ECS, with identity/revision checks and ordinary world persistence. The character may preserve a composed face. A chosen facial expression comes from a closed physical-description vocabulary, not unrestricted prose containing private causes. The appearance emitter delivers changed facial expressions only to observers with direct visual access, using the existing sight/containment gates. Seeing “lips pressed” does not confer knowledge of Sam, a breakup, or a message body; those facts require actual disclosure or another legitimate observation.
- **Actual motor evidence:** completed phone reads and replies retain their real executor chronology. Public action receipts and body reservations distinguish `reading` from `typing`; they never carry private reply arguments. The renderer can project a portable, directly possessed phone into an `activeHand` only during the identity-bound manual operation. That projection expires with the reservation and cannot survive a replaced target or become a second inventory object.
- **Existing safety boundaries remain:** appraisal admission checks actor lifetime, source epoch/stop, persona, own affect and goal basis, task cancellation, and newer evidence in the same channel. Unrelated room activity or speech does not invalidate an already lived private receipt. This exception does **not** loosen foreground action, target/ownership, working-memory, dialogue, or present-scene freshness checks. No phone-message facts are broadcast to peers.

Appraisal uses the foreground lane at critical priority, ahead of new ordinary cognition; slower planning and reflection remain separate. Ready or running appraisal temporarily gates new main cognition, but retry backoff, AI opt-out, or missing credentials must not park the character. This priority is **non-preemptive**: it cannot interrupt requests already occupying foreground slots. With the existing foreground requests honoring their 8-second model deadline, one blocked appraisal may still take roughly the remaining foreground deadline **plus its own 4-second deadline**, with scheduler overhead; that is an architectural latency budget, not a measured guarantee. An already-running self-update can safely invalidate an appraisal and require another attempt, extending the end-to-end time. The trial must measure retries and queue delay explicitly.

For the controlled test, guardian daemons remain enabled independently. Narrator and God/world-evolution processes are disabled so autonomous world changes and authored story pressure do not obscure the cognition comparison. Passing executor or schema tests alone would still not demonstrate a convincing emotional or narrative episode.
