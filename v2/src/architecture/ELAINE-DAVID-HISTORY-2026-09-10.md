# Cookie scene: Elaine has a life with David

## Why this variant exists

The preserved `elaine-growth-integration-q0cyfl` trial read the invitation at
15.2s but did not reply or depart by the 243s provider stop. Elaine remembered
Alex's request, later formed a dinner goal and had a planner decision available.
However, the fixture gave her a high-importance cookie grievance and no authored
shared past with Alex. A restaurant-growth failure is not sufficient evidence
that a character's preference to stay with friends is cognitively defective.

This pass changes character initialization, not the controller. It uses the
existing `AgentEntityConfig.past` → `initializeCharacterNarrative` path. David is
an outside participant, not an embodied NPC. His contact card alone does not
create memories: the private past is explicitly supplied at Elaine's creation.

## Authored life

`src/demo/cookie-character-history.ts` supplies a two-year relationship, private
publishing/work background and three enduring drives. Four recollections have
emotional tone, importance, remembered self-beliefs and retrieval cues:

- First date: bad soup, laughter, books, and feeling accepted without self-editing.
- Support after a work disappointment: being listened to without being managed.
- A missed evening and subsequent apology: hurt, repaired trust, and mutual
  consideration without either person having to put life on hold.
- Celebrating work with Jerry, George and Kramer: genuine fondness alongside
  exasperation; romance is not her only attachment or source of meaning.

These are authored past events with explicit provenance, not events claimed to
have occurred during the episode. They are not instructions, action plans,
current read receipts, automatic emotional updates, or additional priority goals.
Only Elaine receives these recollections. Others may learn something if she
actually tells them. Contact edits never rename her remembered boyfriend.

## Explicit selection and comparison boundaries

The original `scenario: "cookie"` remains `cookieHistory: "legacy"` by default;
the existing Alex duet is unchanged. Select the new variant with:

```ts
await ApartmentSitcom.create({
  scenario: "cookie", cookieHistory: "david", openNeighborhood: true,
  narrativeMind: true, experienceReconsideration: true,
  outsideTextAtMs: null,
});
```

This creation example has AI off by default. The bounded live evaluator supplies
`live: true`, the existing priority controller and original growth limits.

The cookie memory, all four initial cookie goals/priorities, physical puzzle,
standing phone motivation, dialogue/action machinery and invitation body remain
unchanged. The message still says the sender is at work and not to wait for him.
No rendezvous time or deadline is added. This is a bundled characterization
comparison (name, background, drives, memories), not a one-variable causal proof.

After a current-source offline readiness pass, the new bounded mode is:

```sh
node src/evals/continued-growth-pass.cjs --elaine-growth-david recordings/<current-readiness-directory>
```

The legacy comparator is still `--elaine-growth` with its original Alex contact.
Each runs in its own process and creates a fresh evidence directory. The David
mode records `elaine-phone-growth-david-history-v1` and `cookieHistory: "david"`;
configuration and initial-world artifacts record the actual contact and past.
Limits remain 450 HTTP attempts, 420s wall, 360s simulated, 512MiB heap, 2GiB RSS,
96MiB artifacts and 10s cleanup. No H3; no model changes. Existing independent
travel, native read/reply, useful growth, service and privacy gates are unchanged.

## What to assess, without prescribing the story

1. Did she actually read the text? Did the personally experienced receipt reach
   appraisal with the relevant shared memories? Was new message content kept
   separate from what she already knew about David?
2. What significance did she assign to the invitation in her own inner life?
   Distinguish postponing/declining from forgetting, indecision and repeated
   promises of "one more turn" without follow-through.
3. Did her chosen intention lead to an actual action, communication or an
   explicit decision to remain? A relationship does not confer execution authority.
4. Report growth-gate outcome separately from behavioral plausibility. Staying
   may be coherent behavior, but it does not pass the restaurant-growth gate.

Offline checks use mocked responses to establish plumbing and preserved freedom
of action, not improved live judgment. Prior failures, ten-trial baseline and
>=600s wall plus >=600s simulated endurance requirements remain unchanged/HOLD.
Do not silently replace the old baseline or infer a reliable improvement from
one stochastic episode. No new live run is part of this authoring pass.
