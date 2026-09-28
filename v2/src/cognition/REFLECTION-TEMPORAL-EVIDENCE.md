# Reflection: past interpretation versus current understanding

An asynchronous reflection can be obsolete before it arrives. Trial 5 contained
an insight about awaiting a code already heard; trial 6 contained a social insight
about everyone being together after the others had left. Category-based guards
were insufficient: a social or self interpretation can contain physical claims,
and matching object labels in prose does not resolve “we,” “they,” or “here.”

## Current interpretations

All categories now use the same conservative admission fence. A current insight
is admitted only while the actor's owned physical values, latest own physical
outcome, actual dialogue ledger, and coordination interpretation are unchanged.
The exact rendered own knowledge summary and current description are also fenced:
the summary can expose beliefs, impressions, and non-procedural memories that are
not among the raw newest five memory entities. Its rendered source selection, not
an approximate duplicate selector, is authoritative for current admission.
It also requires the original bounded context sources to remain owned and intact.
The engine never queries another actor's remote location, private possessions,
thoughts, or private memory to make this decision. An unseen remote change is not
automatically known. Same-value observation refreshes alone do not invalidate reflection.

Trial 8 exposed a separate gap: unchanged remembered facts could still describe
companions who had visibly departed while the reflecting actor was walking. The
old observation recorded generic `idle` state while the public activity display
already showed the companion walking toward a doorway. Unchanged working memory
was not sufficient evidence that the present local situation was unchanged.

Reflection now explicitly senses a `CognitiveLocalView` before assembling the
request's working-memory ledger and source catalogue. The formatted current view
is placed after the remembered evidence, clearly distinguished from last-known
records. Its public local membership, body/activity, state, routes and package
lifetime are rechecked at generation return and immediately before storage.
Those endpoint checks are pure: they do not create identities, observations or
receipts, nor do they refresh a departed person's remote location. A missing view
cannot authorize current claims. Historical cited insights remain independent of
the current-view check, including when the actor is busy or changes rooms.
The sensing admission itself uses the same strict local visibility boundary:
concealed objects and package-listed contents behind closed containers cannot
leak through the older working-memory ledger even when the new view omits them.

Missing legacy `temporalScope` defaults to this current-state fence, including
`self` insights. A category no longer provides an exemption. Questions use the
same conservative current fence, without attempting to interpret their pronouns.
The actual heard/spoken dialogue ledger is now included in the reflection context,
bounded to eight recent turns and labelled as claims rather than physical proof.

## Historical interpretations

The output schema adds `temporalScope: "historical" | "current"` and `sourceIds`.
Historical interpretations must cite 1–8 exact references from the request's
source catalogue: selected memories, physical receipts, or personally heard/spoken
events. The issuer binds their original contents, timestamps, and actor ownership.
Unknown, foreign, duplicated, newly arrived, and mutated references fail closed.
Removing a memory relation invalidates its reference even if the entity remains.

A historical insight only depends on its cited immutable records. Movement, new
speech, coordination changes, or correction of an unrelated uncited memory do
not discard it. Both the semantic memory and emitted thought visibly say they
are looking back at earlier experiences, give the latest cited source time, and
mark the result as retrospective interpretation. Exact reference IDs remain in
the actor's private reflection metadata. A present-tense sentence cannot gain
current authority simply by being labelled historical.

The schema explanation is a short addition to the existing request, not another
model call or an instruction list for puzzle-specific behavior. The model should
split a mixed historical/current conclusion into separate insights.

## Issuance and commit

Generated results have private in-process provenance binding them to their world,
stable actor identity, issued source catalogue, and original insight bytes. The
same checks run at generation return and again immediately before storage. A
newly heard answer between those boundaries cannot be missed; changing the output
scope or text after generation does not create a new authorized insight.

`storeReflectionResults` returns whether anything was admitted for storage. Its
existing direct trusted-call API remains available for integrations that supply
their own results; these callers are responsible for their own provenance.
`maybeReflect` keeps its lifecycle/state and cancellation checks, preserves new
importance that accumulated while reflection ran, and does not add an extra LLM
request. Source validity is per insight so useful cited history is not discarded
because a different selected record was corrected.

## Limits

Sources are evidence of experiences, not a proof that the model's interpretation
is correct. This does not establish semantic entailment, verify a spoken claim,
or guarantee that an otherwise fresh model answer will never misunderstand an
available message. Current/legacy admission may conservatively discard an insight
after an unrelated current-state change; explicit sourced historical scope is the
path for preserving past/self reflection. No actor-private provenance is published
to bystander perception. Prior live trials remain baseline evidence, not proof of
this new mechanism's autonomous uptake.

Offline regressions cover all-category/pronoun staleness, same-tick hearing,
private reads without public facts, heard-context privacy, unseen changes,
unchanged refresh ages, fresh request-time local sensing, departures during busy
movement, public activity changes, local state races without ledger refresh,
identity-free admission checks, retained unrelated history, retrospective thought framing,
source mutation/removal/reuse/ownership, issuance and storage races, and no network
or model calls.
