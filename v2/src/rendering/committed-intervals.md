# Render lived intervals, not the newest thought

`attachCommittedSceneRenderer` is a headless adapter from the library's physical
timeline to the existing H3 Director configure envelope. It does not open a
network connection, spend credits, advance the world or alter the current phone
UI. The older phone forecast/compacting director remains a separate legacy path.

```ts
const playback = new SourcePlaybackTimeline();
const film = attachCommittedSceneRenderer(sim.world, {
  roomId: selectedRoom,
  windowMs: 8000,
  captureScenes: () => testbed.scenes(), // authored public room projection
});

// Physics and cognition run normally. Call when the transport is ready.
const next = film.renderer.configure();
if (next.status === "ready") {
  playback.register(next.segment);
  // Send next.configure via the existing Director transport.
  // A transport acknowledgement is NOT evidence of displayed video.
  film.renderer.settle(next.segment.version, true);
} else {
  // Explicit buffering/ended/expired/room_unavailable. Hold or rebuffer.
  // Never skip to the latest world state or fabricate a replacement prompt.
}

// Register each issued segment before interpreting provider metadata.
playback.add({ chunk_index: 0, playback_seconds: 8, prompt_version: 1 });
const shown = playback.at(video.currentTime);
// Only `mapped` supplies a source scene/sequence for the displayed playhead.
```

The source is `world.time.elapsed`, sampled only after all physical and speech
events at the scheduler boundary have committed. Boundary sequence breaks ties
between events at the same simulation timestamp. The public executor event ledger
has its own exact event sequence and stable actor/room/target identities. These
are not wall-clock timestamps, inferred frame numbers or model decision IDs.
The adapter also takes a bounded, read-only local witness at public event
publication. This preserves an admission in the origin room even when one coarse
physics advance ends after the actor has departed. Its actual event sequence is
retained; the enclosing post-physics boundary supplies the capture sequence.
It never advances the clock or changes cognition. Active admission witnesses
remain within the event budget while later visual snapshots are evicted.
Events retain their witnessed public actor name and stable identity key; reusing
a numeric entity ID cannot assign old dialogue to the replacement character.

Each source window contains the baseline, subsequent room-local states, the
committed public event sequence, and actual action interval portions. End state
cannot become opening state. Pending expected deadlines never become completion
proof. Only committed speech slices supply words; a continuing voice can span
several windows without repeating or compressing its script. Private thoughts,
plans, message bodies and concealed possessions are not a camera input. Remote
terminal receipts can end an already-observed local departure as `out_of_view`;
their room, text, targets and success/failure verdict are not imported.

The default public history retains at most 512 captures, 2,048 events and roughly
120 seconds plus one baseline predecessor. Returned windows are deeply immutable.
An issued window remains pinned independently of later history eviction. If
retention removes required events or baseline state, the adapter reports an
expired interval instead of silently omitting evidence. A checkpoint restores as
historical-only: it cannot restart physical callbacks or append a resumed world.
Library stop seals the source; restart allocates a new source epoch. Existing
attachments never bridge the epochs or relabel historical entity IDs.

Provider chunk metadata is resolved in gap-free index order. Duplicate indices
cannot stretch the tape. Default mapping is one simulation second per displayed
second; a duration mismatch is `unmapped`, not implicit time compression. The
caller can explicitly supply `sourceRate` for a deliberate editorial retiming.
A repeated prompt version would replay the same interval and is reported as a
source discontinuity. Past the known tape, presentation is buffering, not the
live world's future. These mappings describe requested source correspondence;
they do not prove that the generated image followed the prompt.

The consumer must align its requested source interval with the provider's actual
playable duration, including any continuation trimming. This adapter does not
guess that duration, silently fill an underrun, or promise byte/frame-perfect H3
semantics. A partial final source window needs an explicitly chosen shorter
interval; it is not automatically padded to a full chunk.

Package `scenes()` supplies visual state, but legacy rolling cue lists are not
merged with the public executor ledger: those sequences have another authority.
Packages should publish their actual admission/completion through
`publishCommittedEvent`, without private read payloads. Gaps in that bounded
ledger stop capture explicitly. The generic snapshot `SceneDirector` remains
available for editorial room/shot selection; this first interval adapter fixes
one selected room per run and does not claim an autonomous filmmaker.
