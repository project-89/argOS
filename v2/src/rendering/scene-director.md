# The camera spirit

`SceneDirector` consumes public, committed room snapshots. `observeWorld(rooms)`
chooses one room from fresh speech, movement, wardrobe and interaction cues;
`observe(room)` fixes the observation to a particular room. All rooms in one
world observation must share `sourceId`, `sourceTick` and `elapsedMs`.

The director starts with a painterly three-quarter establishing view, then can
request a wide shot, two-shot, over-the-shoulder exchange, character close-up or
prop insert. The default minimum dwell is four seconds. A missing subject or a
room change can require an immediate new composition. Repeated observation of
the same visible state and event does not generate another shot.

Every prompt contains the selected room's full local actor/prop manifest. Actor
IDs anchor identity; current appearance snapshots supply clothing, actual worn
garments, validated held objects, posture and condition. Mere possession does
not make a pocket's contents visible. Explicit allowlists exclude memories,
thoughts, message bodies, remote actors and future events. Event text enters a
prompt only as committed public speech. Pending or failed actions cannot
authorize successful outcomes.

```ts
const director = new SceneDirector();
director.observeWorld(committedRoomSnapshots);
const shot = director.next();
// Feed shot.prompt to a renderer. After that exact version finishes:
const latest = director.next(shot.version);
```

`configure(lastRenderedVersion)` is an alternative to `next()` that returns the
existing H3 configuration envelope. It has the same issue/acknowledgement
semantics; acknowledge only a version whose rendering has actually finished.

`next()` pins one issued version until it is acknowledged. At most one newer
prompt waits behind it; newer observations replace that pending prompt. Returned
objects are copies, so a renderer cannot rewrite the source audit. The audit
retains 128 shots by default. Each local scene permits at most 24 actors and 64
props, and the generated prompt must fit 50,000 characters. Oversized input is
rejected explicitly rather than silently dropping a character.

This is a deterministic editorial testbed, not a learned filmmaker. Camera
requests preserve an established action axis but do not solve a 3D camera pose,
occlusion or lens geometry. The caller supplies accurate room membership and
public physical state. Old pending shots can be skipped, and the bounded audit
is not a persistent recording. The H3 envelope is compatible with the existing
director configuration contract; no network call or generated-video quality
claim is made here. Rendering cannot change ECS state, and requesting a shot
does not prove that a generative video model obeyed it.
