# Narrative mind: feelings are not tasks

The opt-in `narrativeMind` layer separates an emotional experience, its private
autobiographical interpretation, and a chosen executable intention. It does not
replace world facts, the action executor, or the cognition controller.

```ts
const sim = await createSimulation({
  // Other world / runtime configuration stays unchanged.
  narrativeMind: true,
  experienceReconsideration: true,
  enableReflection: true,
});

getEmotionalEpisodes(sim.world, actorId);
emotionalActivation(sim.world, actorId);
getNarrativeHistory(sim.world, actorId, { limit: 20 });
```

The library and apartment fixture default to the existing behavior unless opted
in. The controller remains an independent choice. The first live experiment
coupled narration to looser situated selection and regressed attention; that
coupling was removed. Existing priority/plan execution and its evidence checks
remain intact.

## Data and ownership

- `EmotionalLife`: actor-owned semantic threads with first-person meaning,
  mixed feelings, potentially conflicting desires, activation at appraisal,
  stance, and exact experienced-event IDs. An existing thread can be revised
  across channels; a phone and a later conversation need not be separate lives.
- `EmotionalDynamics`: simulation-time activation anchor. Current activation
  relaxes exponentially toward 0.2 with a 60-second simulated half-life.
  These are initial simulation parameters, not a validated psychological model.
  Equal elapsed simulation time produces equal recovery regardless of step size.
  Appraisal and salient perceived inputs can change the anchor. Recovery never
  implies forgiveness, a changed interpretation, facial expression or goal success.
- `NarrativeEntry` + `HasNarrative`: separate, private autobiographical entities.
  Each has first-person prose, a kind (`thought`, `experience`, `recollection`,
  `learning`), stable ID, source excerpts, source/authoring times, and optional
  emotional-episode snapshot. Revising an episode does not rewrite its earlier
  narrated meaning.

Owned stable identities, not display names or recycled numeric entity IDs,
govern retrieval. Full world persistence restores the relations, records,
emotional state, mode, and simulation clock across entity remapping.
These are internal/operator APIs, not a network access-control boundary. Do not
expose one actor's private journal in another actor's prompt or public video state.

## Flow

1. A trusted engine producer admits a personally experienced receipt. Unread
   messages and another actor's hidden mind are not experiences of this actor.
2. The existing appraisal call writes a private monologue and may create/revise
   an emotional thread. In narrative mode its schema **cannot create a goal**.
   Optional reconsideration can release/reprioritize eligible owned intentions;
   it cannot complete physical tasks or invent replacement work.
3. Foreground cognition sees its ongoing episodes and bounded remembered
   narration. It can choose concrete intentions through existing mechanisms.
   Its admitted reasoning is archived as a thought, not proof its action happened.
   Planted whispers are not automatically archived as self-authored thought.
4. Existing background reflection retrieves ordinary evidence plus up to five
   private autobiographical records. It authors sourced first-person recollections
   and learning. Exact source and owner checks still apply when the model returns.
   Recalling an interpretation is not independent corroboration of that belief.
   Existing interaction-memory extraction also writes first-person recollections
   or learning, alongside structured memory/belief records. Its source text is
   captured before inference, its output validated before any writes, and its
   lifetime is bounded to eight seconds and the current actor/runtime. Stopping
   or replacing a simulation cancels pending extraction rather than accepting
   memories after the save boundary.
   Completed speech extraction carries its exact owned speech receipt plus up
   to six preceding personally heard/spoken turns (at most two simulated minutes,
   stopping at a room change or a one-minute gap). Context is captured before
   inference: later speech cannot rewrite what was known. Primary source and
   contextual evidence are labeled separately; a remote transcript or forged
   speech ID cannot supply missing knowledge. The complete normalized content
   must match the receipt, not just its prefix. Belief attribution follows the
   validated speaker, never the listener or an interacted-with object.
5. In narrative mode, ready reflection gets the subconscious slot before another
   autonomous-goal proposal. Planning keeps its own scheduling. No extra model
   stage is added to the foreground decision.

Raw sensory evidence, structured working memory, ordinary episodic/semantic
memories and learned executable skills remain. They are not retroactively
rewritten into invented autobiography. Reflection is where those records can
become first-person memories or realizations. Narrative learning is revisable
understanding; it does not silently install a verified procedural skill.

## Time, bounds, and remaining limits

Appraisal/source and journal-authoring simulation times are separate. Historical
receipts that only have wall-domain time keep their wall timestamp and a labeled
`legacy-estimate` of simulation time; no frame-accurate time is claimed for them.
New phone/heard experience receipts use their actual simulation timestamps.

Ordinary memory prunes to 50 records and immediate thought context to 10. The
narrative archive is separate: those pruning operations do not erase it.
Retrieval pages at most 200 records; prompt selection considers the last 100
non-thought records, then picks three recent and two earlier important records.
Thought volume cannot crowd out this meaningful-history selection. This is
bounded further to one recall group per emotional episode or identical primary
source. A typed group contains the latest real archival record plus at most
three related interpretations with their original IDs and source/authoring
times. This retains distinct takeaways from one utterance without treating
revisions or reflections as independent corroboration. Related meanings prefer
directly sourced takeaways over repeated reflections, then importance and
recency; exact repeated wording appears only once. Their prompt excerpts are
capped at 1,000 characters each, with explicit excerpt and omitted-entry notices.
The archive is unchanged, and the representative-only selection API still
returns the same latest records. Context-only shared dialogue does not merge
separate experiences. This is bounded retrieval, not semantic search across the
entire autobiography or semantic reconciliation of contradictory interpretations.

The live episode catalogue holds 12 threads. It will not silently evict an open
thread; a new thread at capacity needs an existing settled slot, or revision of
an existing thread. Archival records retain the earlier snapshots. An `open`
thread does not settle merely because time passes; semantic changes require a
new admitted appraisal.

The archive grows with the simulation and full snapshots include it. It is not
yet a disk-paged long-running storage engine; production-scale worlds need
indexed/disk-backed archival retrieval rather than keeping an unlimited lifetime
of entries in ECS. Provenance proves what a model interpreted, not that the
interpretation is true. Rich prose also does not prove sustained behavioral
change: measure decisions and completed effects separately.

## Checks

`src/cognition/__tests__/narrative-mind.test.ts` covers source/owner fences,
cross-channel episode continuity, atomic rejection, conflicting desires without
tasks, clock recovery during inference, timestep equivalence, private retrieval,
memory pruning, pagination, save/remapping, and sourced recollection/learning.
`src/cognition/__tests__/narrative-recall-groups.test.ts` checks distinct takeaways
from one interaction, correlated revisions/reflections, original IDs/times,
unchanged archives, and explicit retrieval/excerpt bounds.

Text-only production trial (two fixed stimuli, no H3, forced reaction or narrator):

```sh
npm run eval:sitcom:breakup:live -- --seconds=120 --reconsideration=on --narrative-mind=on
```

Add `--condition=neutral` for the content control. Reports include source hashes,
private cognitive frames, a transcript, exact phone delivery/read/reply times,
and a saved ECS world containing the full journal. These runs are single trials,
not a statistically established benchmark.
