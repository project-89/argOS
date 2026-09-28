# Inhabit, Analysis and Voice — shared contract (2026-09-28)

The operator can **watch** the world, **inhabit** it (walk, act and talk as a
body), **pause** it to talk with God and **interview** any resident, and hear
God and the residents speak. Everything is ECS-grounded: control is a component,
bodies are ordinary residents, speech is ordinary committed speech. Residents
perceive a controlled body exactly as they perceive anyone else.

All endpoints live on the existing spatial server, require the session bearer
token, take/return JSON unless noted, and fail with `{ error }` (4xx/5xx).

## Control (possession) — engine

A `Controlled` ECS component `{ controller: "operator", sinceSimMs }` on an Agent
means a human drives it. While present:

- The resident's own foreground cognition, subconscious work and daemon whispers
  do not run for that body (it is not an NPC while possessed). Its memories,
  perceptions and relationships keep accumulating normally.
- Its available verbs come from the same world capabilities any resident gets
  (object affordances, story verbs, phone, etc.). Control confers no extra power.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/control/visitor` | `{ name?: string, persona?: string }` | Spawns a visitor Agent at the town entry (no AI mind) and takes control. `{ actorKey }` |
| POST | `/api/control/take` | `{ actorKey }` | Possess any resident. `{ actorKey }` |
| POST | `/api/control/release` | `{}` | Release; a possessed resident resumes its own mind; a visitor stays, idle. |
| POST | `/api/control/walk` | `{ x, y }` **or** `{ dx, dy }` (unit direction, walk ~1.2 m) | Native walk toward a ground point through the same planner/collisions. `{ ok, reason? }` |
| POST | `/api/control/act` | `{ type, targetKey?, content? }` | Any native action as the controlled body (sit, open, read, take, give, knock, write_note, examine, eat, move to room, **speak**). |
| POST | `/api/control/say` | `{ text, targetKey? }` | Shorthand for speak: real, audible committed speech. |

Snapshot additions (`/api/state`):

```ts
control?: { actorKey: string; name: string; visitor: boolean;
  nearby: Array<{ key: string; name: string; kind: "actor" | "prop"; distance: number; verbs: string[] }>; // within ~3 m, what E can do
  heard: Array<{ id: string; speaker: string; text: string; atSimMs: number }>;                          // speech this body heard, newest last (≤ 20)
};
paused: boolean;
```

## Pause, God and the interview — engine

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/pause` | `{}` | Freeze simulation time and all minds ("freeze all motor functions"). |
| POST | `/api/resume` | `{}` | Resume. |
| POST | `/api/god/ask` | `{ text, requestId }` | God (available in every live session) answers with omniscient read tools: where everyone is, what each resident wants/fears/hides/believes, recent thoughts, the Narrator's ledger, why something happened. Construction/event tools only where the profile grants them. `{ reply, receipts? }` |
| POST | `/api/interview` | `{ actorKey, text, mode: "in_character" \| "analysis", remember?: boolean, sessionId }` | Talk with one resident's mind. **in_character**: they meet you as a stranger in a quiet moment, with their real memories and secrets (they may lie). **analysis**: diagnostic register — candid about motives, secrets, beliefs about others, and why they did things. Off the record unless `remember: true` (in_character only), which stores it as a private conversation they lived. `{ reply, mood?, sessionId }` |

Interviews work paused or running; they never create world actions.

## Voice — voice module

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/voice/speak` | `{ text, speakerKey?: string, voice?: "god" }` | `audio/wav` of the line in that speaker's cast voice (God's voice for `voice:"god"`). |
| POST | `/api/voice/transcribe` | `audio/webm` or `audio/wav` body (≤ 60 s) | `{ text }` |
| GET | `/api/voice/cast` | — | `{ voices: Record<speakerKey, { voice: string; style: string }>, god: {...} }` |

Voices are cast once per resident from persona (age, manner, voice notes) and
are stable for the session. Synthesis is budgeted per session; the client asks
only for lines it will actually play (near the viewer/controlled body, God,
interviews).

## Experience — client

Three modes: **Watch** (diorama overview, story feed, residents), **Inhabit**
(third-person/first-person behind your body: WASD/arrows walk, mouse look, E to
interact with the nearest thing, Enter to talk, hold V to speak; subtitles for
speech you hear; residents' voices), **Analysis** (paused world; God console;
interview chair with a selected resident; in-character/analysis toggle;
remember toggle; voices). Any resident card offers **Take control**. VR (WebXR)
reuses Inhabit.
