# Shot-local H3 direction

Implemented September 11, 2026. Offline prompt-contract validation only; this
is not evidence that H3 has stopped swapping voices or inventing speech.

## Scope and ownership

The existing `SitcomDirector` still selects committed source windows.
`buildSitcomPerformance` still owns performance durations, action visibility
budgets, speech boundaries and the immutable source-to-media map. The new pure
`directPerformance` compiler groups that existing evidence into chronological
audiovisual intervals. It is not another simulation controller or a spirit that
can author events. No cognition, models, transport settings or ECS rules changed.

The production `SitcomScreenwriter` invokes it; the resulting prompt follows the
existing server/client path to H3. `Screenplay.directedIntervals` preserves the
visible cast, speaker binding, cue onsets and continuations in saved screenplay
evidence. This records instructions issued, not successful visual performance.

## Decisions

- Replace separate camera and dialogue decks with interval-local directions.
  Each interval specifies location, visible actors, on/offscreen speaker,
  silent listeners, cue starts and continuing cues.
- Keep committed speech text exactly once per packet. Camera cuts refer back to
  the same version-qualified cue ID; they do not quote or restart its words.
  Phrase-boundary, interruption and exact-word evidence instructions remain.
- Keep essential phone/pickup/pour/drink coverage. While another person speaks,
  a phone insert explicitly identifies the offscreen speaker and forbids the
  pictured reader from lip-syncing that voice.
- Keep the camera through quiet gaps instead of inserting short wide-shot cuts.
  Timing boundaries do not themselves imply camera cuts.
- Bind characters to S-labels using world/entity/lifetime identity, not name.
  Labels survive rename and lazy stable-ID assignment. Actual lifetime reuse
  gets a new label. Candidate compilations clone the registry; only an issued
  candidate commits it.
- Preserve established vocal identity rather than inventing accent, pitch or
  biographical traits: the public character snapshot currently has no authored
  voice profile. These are textual speaker labels, not native voice controls.
- Restrict visible actors to the recorded shot room. If committed speech from
  another room overlaps a required visual action, label it an editorial audio
  bridge, not a conversation heard by the pictured characters. No world
  perception or knowledge is changed by that editorial choice.
- Preserve all cue onsets, including terminal point receipts and sounds.
  No new notification is implied by a quiet interval. Prompt size remains capped
  at 12,000 characters; no source evidence is silently dropped to fit.
- Keep quoted scene data escaped, private thoughts/message bodies excluded,
  source history immutable, and the ending silent hold intact.

## Validation

Commands (using the existing Node runtime):

```sh
npm test -- --runInBand --silent 'src/demo/__tests__/sitcom-.*\.test\.ts$' src/rendering/__tests__
npm run typecheck
```

The focused regressions cover speaker-close-up → phone-insert → return-shot,
alternating speakers without a camera cut, exact-once dialogue/sounds/receipts,
room isolation, silence, same-name characters, escaped strings, lifetime reuse,
candidate rollback, and keeping the camera across quiet gaps. Existing suites
continue to cover privacy, source coverage, generated rooms, phone choreography,
presentation synchronization and ten-minute virtual-provider pacing.

Final result: **32 suites / 286 tests passed** (17.63s); `npm run typecheck`
passed. Earlier checkpoints passed 55 tests in five focused suites, then 282 and
285 tests as new regressions were added. No failing run was discarded or
acceptance threshold loosened. The runtime emitted existing npm/Node-alpha and
ts-jest deprecation warnings; no test or type errors were reported.

## Remaining gate: rendered audiovisual fidelity

No paid H3 session or server restart was performed in this pass. Reload/restart
the demo server before expecting an existing session to use the changed compiler.

Next run should be a short, controlled two-character sequence, not another long
episode: alternate exact lines, insert a silent phone-reader while the other
character speaks, then return to the original speaker. Save the issued prompts,
directed intervals, chunk metadata and recording. Check actual words, face/voice
attribution, mouth silence, phone gesture coverage, cuts and end silence against
the same committed evidence. Do not score success from prompt strings alone.

Fal's newer timed-script and supplied-audio controls remain deferred pending a
separate bounded provider-contract test. Script offsets are not simulation time;
adopting them without validating the playback map would risk breaking the sync
we are preserving. MiniMax base-model markup is likewise not assumed to survive
Fal's prompt expansion unchanged. The current adapter remains plain prompt updates.

September 11 pacing follow-up: [the queued-handoff adapter](H3-PACING-REPAIR.md)
adds an opt-in native script path. Plain prompt updates remain the default until
that adapter's audiovisual contract is verified. The shot-local compiler and
actual playback mapping remain shared, not replaced by a second director.

The broader ten-trial cognition baseline and ten-minute live endurance gates are
not replaced or claimed passed by these offline rendering regressions.
