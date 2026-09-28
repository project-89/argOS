# Memory, reasoning and policy prompt review

This pass covers `knowledge-graph.ts`, `memory-consolidation.ts`,
`enhanced-memory.ts`, `extended-reasoning.ts`, `research-agent.ts`,
`task-queue.ts` and `policy-generator.ts`. It preserves the response schemas,
model selection, execution budgets, cancellation, validation and storage paths.
No live model calls were made for this review.

| Area | Finding | Change |
| --- | --- | --- |
| Interaction extraction | Heard statements were described as subject/predicate/object facts, and impressions as observed personality traits. | Keep speakers and uncertainty in memories; distinguish reported claims, hypotheses and completed observations. Empty output is valid. Belief summaries now expose their stored source. |
| Episodic consolidation | A quota of 2–5 factual statements encouraged invention and confident generalizations about people. | Up to five supported statements, including none; retain attribution and distinguish repeated retellings from independent evidence. |
| Memory projection | Sources existed in storage but disappeared in prompts headed “What I Know.” Working conclusions looked established. | Show sources/references and stored confidence, label working conclusions and hypotheses, and present semantic items as stored knowledge. |
| Extended reasoning | The loop requested confidence as its endpoint; hypothesis tools asked general knowledge to supply evidence. The prompt omitted `task.context`, losing task-specific receipts/tool context. | Allow an unresolved conclusion, keep deductions conditional and hypothesis checks evidence-based, allow empty suggestions, and include task context without repeating an identical agent-context prefix. |
| Research | Question/report prompts encouraged comprehensive output; recalled findings omitted their sources. | Ask only useful unanswered questions, preserve finding/answer sources, and allow empty conclusions/recommendations with explicit limitations. |
| Task proposals | Priority prompts asked about deadlines and dependencies while omitting those fields from the task list. | Include real deadline/dependency metadata, propose only justified changes, and allow empty tasks/priority updates. |
| Behavior policies | Forced node counts, interaction quotas, mandatory activity types and a ban on waiting could create activity without a reason. Evolution demanded a different structure regardless of the defect. | Keep decision structure proportional to the setting, use actual vocabulary and guards, allow quiet fallback/waiting, and request targeted changes to the defective branches. The nested JSON schema examples remain. |

The important structural change is carrying existing context and provenance to
the consumer. A sentence asking a model to remember is not a substitute for a
recorded conversation or a validated physical action. This pass does not add a
second conversation ledger or change the foreground action authority.

Several existing storage semantics remain limitations outside this prompt pass:

- `clearWorkingMemory` and reasoning/research paths can store generated findings
  or conclusions under the semantic category `fact`. The revised projections
  expose their sources and do not treat the category as verification, but the
  storage type itself has not acquired an evidence-status field.
- `addSemanticMemory` raises confidence for an existing subject/predicate/object
  match; repeated derivation need not constitute independent evidence. This
  accumulation policy was not changed.
- `quickResearch` may return a high-confidence cached item without checking new
  contradictory context. This pass changes its model prompt and source display,
  not that cache policy.
- Some research-tool paths return adapter or placeholder receipts. Prompt
  wording does not turn those receipts into external measurements. Actual tool
  execution and outcome verification remain separate concerns.
- The auxiliary reasoning `success` and memory confidence values remain model
  estimates. They are not ECS goal-completion proof.

Offline regression tests cover attributed recall, empty extraction/research/task
results, preservation of task-specific context, unresolved reasoning and valid
quiet policies. Existing policy validation, bounded reasoning and memory tests
remain part of the verification. These checks establish prompt/host behavior,
not natural conversation quality from a live model.
