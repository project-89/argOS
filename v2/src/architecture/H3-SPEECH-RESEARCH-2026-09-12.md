# H3 speech fidelity: research and next bounded experiment

Research only: no production format change or paid generation in this pass.

Follow-up: the user authorized the bounded A/B comparison. Both text-only
variants repeated speech in their first chunk; the following silent chunk stayed
silent according to the blind video audits. See
`recordings/h3-speech-probe-81eoic/REVIEW.md` and its exact prompt/transport/video
evidence. Two paid sessions, no retries; target audio remains untested.

## Evidence from Argos

In `h3-bounded-verification-YYYCNY`, packets5/6 repeat their quoted lines inside
single10s media chunks. Each supplies the line once, one named voice declaration,
and explicit silence. Packet6 contains a complete, unsplit utterance. Their
ending holds are4.20/4.21s. The extra transport repeat begins at70s, outside the
recording. Repeated dialogue is not explained by that extra receipt.

The video and audio observers also hear the speaker name Elaine inserted before
her dialogue. This suggests confusion between instruction data and spoken text.
It does not establish which internal provider stage introduces the error.

## Primary sources checked

- [MiniMax base prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
  separates audiovisual timeline, ambient sound, and score. It puts only actual
  dialogue plus its language marker inside dialogue delimiters, with speaker
  identity outside. This is base-model guidance, not proof that hosted Director
  preserves or requires these delimiters.
- [Fal H3 Max guide](https://fal.ai/learn/tools/how-to-use-minimax-h3-max)
  demonstrates ordinary quoted dialogue and recommends consistent visual
  descriptions across cuts. Thus our quotation syntax is not categorically
  unsupported. A structured alternative is an experiment, not a proven cure.
- [Director overview](https://fal.ai/h3-max-director) describes expansion using
  earlier directions; [Director API](https://fal.ai/models/minimax/h3-max/director/api)
  advertises a prompt-expansion stage. We do not have the resulting expanded
  prompt, so expansion/history interference remains a hypothesis.
- The same API documents target audio at script offsets, with the supplied PCM
  played, rather than merely used as a voice reference. Its exhaustion notice
  says the remainder of that chunk is silent, but later chunks revert to
  unconditioned continuation unless more audio is accepted. Full ongoing audio
  coverage therefore matters. This contract has not been verified live by us.

## Hypotheses, not established causes

1. Long silent tails after visible speech invite additional speech/repetition.
2. Dense control labels, quoted object names and continuation bookkeeping blur
   the distinction between dialogue and description in expansion/generation.
3. Prior audiovisual context can sustain talking despite a new silence request.

## Next experiment

Freeze the actual complete packet6 sentence and appearance; stop using different
live NPC decisions to compare renderers. Compare a compact Fal-style shot brief
against MiniMax's structured format, with equal10s duration, one speaker and
the same final silence. Keep all native evidence in a sidecar, not dialogue.
Test a subsequent silent segment too. Do not infer success from the prompt.

If text-only fidelity fails, separately test supplied exact audio for that line
plus a silent tail through Director's target-audio path. Use original synthetic
voices. Condition the entire media interval, preserve public-only speech/sounds,
and derive its media timing from actual audio before issuing it; never rewrite
issued maps or manufacture native words/actions. Verify provider receipts,
transcribed words, silence, lip sync and speaker identity. Audio rejection must
fail closed, not fall back silently to invented speech.

No broader controller, world-generation, model-switch, or endurance work is
needed to isolate this. These are staged experiments, not permission for an
unbounded series of paid retries.
