# Voice (Gemini TTS / STT)

God and every resident speak with a cast Gemini prebuilt voice, and the
operator can talk by voice. Contract: `src/demo/INHABIT-CONTRACT.md` (Voice).

## Models (found with ListModels on 2026-09-28)

| Use | Model id | Method | Notes |
| --- | --- | --- | --- |
| Text-to-speech (God, interviews, `/speak`) | `gemini-3.8-flash-tts` | Interactions API `POST /v1beta/interactions` (also lists `generateContent`) | 3.8-generation TTS. Override with `ARGOS_TTS_MODEL`. |
| Text-to-speech (in-world resident lines, `/utterance`) | `gemini-3.8-flash-lite-tts` | same | Faster (see latency below). Override with `ARGOS_TTS_DIALOGUE_MODEL`. |
| Speech-to-text | `gemini-3.8-flash` | `generateContent` with inline audio | Override with `ARGOS_STT_MODEL`. `gemini-3.5-transcribe-live` and `gemini-3.8-live` are bidi (Live) only. |

Older TTS ids still listed: `gemini-3.1-flash-tts-preview`, `gemini-3.1-flash-tts-eap`,
`gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`.

Gemini 3.8 TTS reads the input text **verbatim**, so the delivery direction is
not put in the text. It goes in `content[].annotations[{ type: "speech_metadata", style }]`,
and the voice goes in `generation_config.speech_config[{ voice }]`. Requests set
`store: false`, so spoken lines are not kept in server-side interaction history.
Unary output is 24 kHz mono 16-bit PCM WAV. The client also accepts
`audio/L16;rate=…` PCM and re-wraps everything in a clean 44-byte header.

## Files

- `gemini-voice.ts`: REST client (`synthesize`, `transcribe`), WAV helpers,
  `VoiceError` (status and retry hint). It uses the shared `googleProviderFetch`,
  with timeouts, abort signals and size caps: 600 chars per line, 8 MB / 60 s audio.
- `casting.ts`: the 30 prebuilt voices, deterministic LLM-free casting
  (pronouns → gender, age words → age, the persona's "HOW YOU TALK" notes →
  manner tags and the style text). Voices are kept distinct across the cast.
  `VoiceCastBook` keeps voices stable for the session.
- `voice-service.ts`: per-session budgets (`ARGOS_VOICE_BUDGET`, default 300
  synthesized lines; `ARGOS_VOICE_STT_BUDGET`, default 100), an LRU cache keyed by
  sha256(voice, style, text) (160 entries / 64 MB), de-duplication of identical
  in-flight lines, and at most 3 provider calls in flight (12 may queue).
- `routes.ts`: `mountVoiceRoutes(app, { demo, token })`, mounted in `spatial-server.ts`.

## HTTP

All routes need `Authorization: Bearer <session token>`.

- `POST /api/voice/speak`: JSON `{ text, speakerKey }` or `{ text, voice: "god" }`
  (exactly one of the two). Returns `audio/wav` (24 kHz, mono, s16le). Headers:
  `X-Voice`, `X-Voice-Cache: hit|miss`, `X-Voice-Budget-Remaining`,
  `X-Audio-Duration-Ms`, `X-Audio-Sample-Rate`, `X-Voice-Latency-Ms`.
- `POST /api/voice/transcribe`: the raw audio body with its `Content-Type`
  (`audio/webm`, `audio/ogg`, `audio/wav`, `audio/mp4`, `audio/mpeg`, `audio/aac`,
  `audio/flac`; codec params allowed). Maximum 8 MB, and WAV must be ≤ 60 s.
  Returns `{ text }`.
- `GET /api/voice/cast`: `{ enabled, models, format, voices: { [actorKey]: { voice, style, name } }, god: { voice, style }, usage? }`.

Errors are JSON `{ error, retryAfterSeconds? }`:

- 400: bad body.
- 404: unknown `speakerKey`.
- 413 / 415: audio too large / unsupported audio type.
- 429: provider rate limit, spent budget or a full queue. Sends `Retry-After` when known.
- 502: provider error or rejection.
- 503: no `GOOGLE_GENERATIVE_AI_API_KEY`.
- 504: provider timeout.

### Client notes

- The spatial page's CSP (`default-src 'self'`) has no `media-src`, so
  `<audio src="blob:…">` is blocked. Play the response with WebAudio instead:
  `ctx.decodeAudioData(await res.arrayBuffer())`. The alternative is for the server to add `media-src 'self' blob:`.
- Ask only for lines that will play. Cached repeats are free and do not use budget.
- WAV transcription was checked live. Browser `audio/webm;codecs=opus` is
  passed through to Gemini as `audio/webm` but has not been checked live yet.

## Voice and speech together (voice gate)

Measured in a live run: a resident's audio arrived 4.5–8.5 s after the line
started, while lines last about 3–5 s, so the viewer dropped most of it as stale.
Two changes fix this:

1. **Faster dialogue model.** `/api/voice/utterance` renders with
   `VOICE_MODELS.dialogue` (`gemini-3.8-flash-lite-tts` by default). God and the
   interview chair keep `gemini-3.8-flash-tts` via `/speak`. The model is part of
   the cache key.
2. **Speakers draw breath.** `setUtteranceVoiceGate(world, gate)` in
   `src/cognition/timed-speech.ts` is off by default. When the gate returns a
   promise, the utterance is admitted immediately and holds the voice and floor.
   Its first word waits until the audio resolves, or for
   `VOICE_GATE_CAP_MS` = 2500 simulated ms, whichever is first. Resolution
   arrives in wall time, and the start is then scheduled at the current
   simulation time on the shared timeline. Word offsets are scaled to the audio
   duration, clamped to 0.6x–1.8x of the authored duration, so text and voice
   finish together. While the speaker draws breath, `getSpeakingActivity`
   reports a provisional `expectedEndSimMs` (start + cap + 1.8x authored). It
   reports the real `startedAtSimMs` / `expectedEndSimMs` once the line starts.
   An utterance that is cancelled, interrupted, cleared or replaced never starts
   later. If the gate declines, throws or rejects, the line keeps authored
   timing.

`mountVoiceRoutes` registers the gate through `demo.setUtteranceVoiceGate`
(`SpatialDemo` exposes it). The gate is active only when all of these hold:

- a client asked for line audio within `LISTENING_WINDOW_MS`;
- the speaker's `readAttention` tier is `presence`;
- the controlled body can actually hear the line (`audibleUtterance`), which
  excludes the operator's own body and Watch mode.

The client's `/utterance` request joins the same in-flight render. The viewer
(`positional-voice.mjs`) refreshes both `startedAtSimMs` and `expectedEndSimMs`
on each snapshot, so audio that is ready at line start plays at once.

### TTS latency (2026-09-28, 6 real calls, unary Interactions API, same client)

Style direction: a Saltmere persona line, as cast.

| Line (words) | Authored | flash-tts latency | flash audio | flash-lite-tts latency | lite audio |
| --- | --- | --- | --- | --- | --- |
| Mara, 12 words | 5.46 s | 3.52 s | 3.80 s | 2.85 s | 4.28 s |
| Leon, 21 words | 8.94 s | 4.62 s | 7.96 s | 3.03 s | 8.24 s |
| Ivo, 14 words | 6.26 s | 3.76 s | 5.48 s | 1.89 s | 4.44 s |
| **Mean** | | **3.97 s** | | **2.59 s** (about 35% faster) | |

Both models produced complete 24 kHz WAV with plausible pacing: lite's audio
lengths are within 0.5 s of flash for the same text. Nobody has listened to
compare the quality by ear yet. Lite still sometimes misses the 2.5 s cap; the
line then starts on time with authored pacing, and its audio arrives about 0.5 s
into the line, well inside the viewer's 70% staleness window.

**Streaming:** ListModels lists only `generateContent`, `countTokens` and
`batchGenerateContent` for both TTS models. It does not list
`streamGenerateContent`, but it omits that for the text models too, so this
check does not settle whether streaming is supported. Streaming was not tested
with a paid call. If it works, streaming the first audio chunk would cut the
breath further. That would need the viewer to play chunked PCM, which it does
not do today.

## Saltmere cast (deterministic)

| Resident | Voice | Why |
| --- | --- | --- |
| God | Charon | reserved; "warm and vast, slightly amused, utterly unhurried" |
| Mara | Kore (firm) | "Quick, low and direct" |
| Ivo | Achird (friendly) | "big warm laugh and jokes" |
| Tess | Pulcherrima (forward) | "Performer's patter … teasing" |
| Ada | Erinome (clear) | "Clipped and exact … sarcasm" |
| Leon | Sadaltager (knowledgeable) | elderly; "Old-fashioned and lyrical, a storyteller's cadence" |
| Eli | Iapetus (clear) | young; "Polite, a little formal, an inland accent" |
| Sera | Despina (smooth) | "Soft, vivid, speaks in images" |
| Noor | Sulafat (warm) | "Brisk nurse's plainness, dark jokes" |
| Bea | Gacrux (mature) | "Slow, sparing, old sayings … plain as bread" |
| Otis | Sadachbia (lively) | "Salesman's charm … gets louder" |

Each style reads `Speak as <Name>, <age> <woman/man> from Saltmere, a small
English coastal town, in natural conversation.` followed by the resident's own
voice notes.

## Smoke (2026-09-28, 3 real calls)

| Call | Result |
| --- | --- |
| God (Charon) | 7.0 s of audio, 336 KB, 4.7 s latency |
| Leon (Sadaltager), "The sea takes what it's given." | 2.84 s of audio, 136 KB, 2.2 s latency |
| STT of Leon's WAV | "The sea takes what it's given," in 1.3 s |
