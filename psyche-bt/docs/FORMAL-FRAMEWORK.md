# Crystallized Reasoning: A Formal Framework for Continuous Agent Learning Through Behavior Tree Compilation

## Abstract

We present a formal framework for a self-improving agent architecture in which expensive model reasoning is compiled into deterministic behavior tree (BT) policies executable by cheap models. The framework comprises: (1) a typed behavior tree calculus with plan nodes and composition; (2) a compilation operator that maps interaction traces to tree branches; (3) an immune system providing quality-gated learning with provable false positive bounds; (4) a swarm convergence mechanism that provides non-parametric quality estimation via Condorcet's jury theorem; and (5) a composition algebra over plans enabling hierarchical skill building. We prove that the compiled policy converges toward handling all recurring task types, bounded only by the immune system's conservatism, with O(1) execution cost per task regardless of accumulated knowledge.

---

## 1. Preliminaries

### 1.1 Notation

| Symbol | Meaning |
|--------|---------|
| S | Agent state space (domain-specific components + skills + policy) |
| M | Message space (user inputs) |
| A | Action space |
| A_esc ∈ A | Escalation action (no pattern matches) |
| T | Tool space (registered tools) |
| π | Policy (BT mapping S × M → A) |
| τ | Interaction trace |
| N | Swarm size |
| K | Number of structural task families in distribution D |
| t | Discrete time (training epochs, e.g., nightly runs) |

### 1.2 State Space

The **agent state** is a tuple of typed, queryable components:

$$S = (X_1, X_2, \ldots, X_n, \text{Sk}, \Pi)$$

where:
- $X_1, \ldots, X_n$ are **domain-specific state components** — structured data that conditions evaluate against
- $\text{Sk}: \text{name} \rightarrow \text{BT\_node}$ is the named skill library (compiled sub-trees)
- $\Pi = (\text{tree}, \text{version}, \text{stats})$ is the behavior policy (the BT itself)

The framework is agnostic to what the domain components contain. Conditions are predicates over $S$; as long as the predicates can be evaluated in O(1), the framework applies.

**Example instantiation — Personal Assistant (Psyche):**

$$S_\text{psyche} = (H, \text{Mem}, E, I, P, \text{Cal}, \text{Sty}, \text{Conv}, \text{Sk}, \Pi)$$

| Component | Type | Description |
|-----------|------|-------------|
| H | {(d, c, conf, ev, src)} | Hypotheses about the person (Bayesian beliefs) |
| Mem | {(type, content, imp, topics)} | Long-term memory entries |
| E | {(name, type, mentions, ctx)} | Known entities (people, projects, places) |
| I | {(claim, scope, status, plan)} | Active intentions and goals |
| P | {(content, conf, outcome)} | Testable predictions |
| Cal | {(domain, accuracy, trend)} | Per-domain calibration |
| Sty | (formality, humor, length) | Communication style preferences |
| Conv | (messages, topics, emotion, depth) | Current conversation state |

**Example instantiation — Coding Assistant:**

$$S_\text{code} = (\text{Proj}, \text{Files}, \text{Err}, \text{Tests}, \text{Git}, \text{Deps}, \text{Sk}, \Pi)$$

| Component | Type | Description |
|-----------|------|-------------|
| Proj | (name, lang, framework, structure) | Project metadata |
| Files | {(path, lang, modified, size)} | File index |
| Err | {(type, message, file, line, resolved)} | Error history |
| Tests | {(suite, status, last_run, failures)} | Test state |
| Git | (branch, uncommitted, recent_commits) | Version control state |
| Deps | {(name, version, outdated)} | Dependency state |

**Example instantiation — Workflow Orchestrator:**

$$S_\text{workflow} = (\text{Cal}, \text{Tasks}, \text{Contacts}, \text{Docs}, \text{Services}, \text{Sk}, \Pi)$$

| Component | Type | Description |
|-----------|------|-------------|
| Cal | {(event, time, attendees, status)} | Calendar state |
| Tasks | {(title, priority, deadline, status)} | Task tracker |
| Contacts | {(name, role, availability)} | People and roles |
| Docs | {(name, type, location, modified)} | Document registry |
| Services | {(name, endpoint, auth_status)} | Connected services |

The condition library $\mathcal{C}$ is defined per-instantiation, with predicates that query the domain-specific components.

### 1.3 Action Space

$$A = A_\text{respond} \cup A_\text{tool} \cup A_\text{plan} \cup A_\text{strategy} \cup \{A_\text{esc}\}$$

where:

- $A_\text{respond}$ = {(respond, content)} — direct response
- $A_\text{tool}$ = {(tool_call, name, params)} — invoke a registered tool
- $A_\text{plan}$ = {(plan, steps, bindings)} — execute a multi-step procedure
- $A_\text{strategy}$ = {(strategy, intent, approach, tone, ctx)} — generation directive for cheap model
- $A_\text{esc}$ — escalation signal (no compiled pattern matches)

---

## 2. Behavior Tree Calculus

### 2.1 Node Types

A behavior tree node $n$ is defined inductively:

$$n ::= \text{sel}(n_1, \ldots, n_k) \mid \text{seq}(n_1, \ldots, n_k) \mid \text{wrand}(w_1:n_1, \ldots, w_k:n_k)$$
$$\quad\mid\; \text{cond}(p) \mid \text{act}(a) \mid \text{strat}(\sigma) \mid \text{plan}(\rho) \mid \text{skill}(\text{name}) \mid \text{esc} \mid \text{noop}$$

where:
- $p: S \times M \rightarrow \{0, 1\}$ is a condition predicate
- $a \in A$ is an action
- $\sigma \in A_\text{strategy}$ is a response strategy
- $\rho$ is a compiled plan (Definition 2.4)
- name is a skill identifier

### 2.2 Evaluation Semantics

Evaluation is a function $\text{eval}: n \times S \times M \rightarrow R$ where result $R = \text{success}(a) \mid \text{fail}$.

**Selector** (try children, return first success):

$$\text{eval}(\text{sel}(n_1, \ldots, n_k), s, m) = \begin{cases} \text{eval}(n_1, s, m) & \text{if } \text{eval}(n_1, s, m) = \text{success}(a) \\ \text{eval}(\text{sel}(n_2, \ldots, n_k), s, m) & \text{otherwise} \\ \text{fail} & \text{if } k = 0 \end{cases}$$

**Sequence** (all must succeed, return last):

$$\text{eval}(\text{seq}(n_1, \ldots, n_k), s, m) = \begin{cases} \text{fail} & \text{if } \exists i: \text{eval}(n_i, s, m) = \text{fail} \land n_i = \text{cond}(\cdot) \\ \text{eval}(n_k, s, m) & \text{if } \forall i < k: n_i = \text{cond}(\cdot) \Rightarrow \text{eval}(n_i, s, m) = \text{success}(\cdot) \end{cases}$$

**Weighted Random** (probabilistic selection):

$$P(\text{eval}(\text{wrand}(\ldots), s, m) = \text{eval}(n_i, s, m)) = \frac{w_i}{\sum_j w_j}$$

**Condition** (predicate check):

$$\text{eval}(\text{cond}(p), s, m) = \begin{cases} \text{success}(\text{wait}) & \text{if } p(s, m) = 1 \\ \text{fail} & \text{otherwise} \end{cases}$$

**Terminal nodes**:

$$\text{eval}(\text{act}(a), s, m) = \text{success}(a)$$
$$\text{eval}(\text{strat}(\sigma), s, m) = \text{success}(\sigma)$$
$$\text{eval}(\text{plan}(\rho), s, m) = \text{success}(\rho)$$
$$\text{eval}(\text{esc}, s, m) = \text{success}(A_\text{esc})$$

### 2.3 Condition Predicate Library

A condition predicate $c \in \mathcal{C}$ is a function $c: S \times M \rightarrow \{0, 1\}$ that queries the agent state or input message. Each predicate has an associated **specificity weight** $w(c) \in \mathbb{Z}_{\geq 0}$ reflecting how narrowly it constrains activation.

The **specificity** of a condition set $C$ is:

$$\text{Spec}(C) = \sum_{c \in C} w(c)$$

The condition library is **domain-specific** — each instantiation defines predicates over its state components. The framework requires only that predicates are O(1) to evaluate and have assigned specificity weights.

**Predicate design principle**: Low-weight predicates match broadly (many tasks fire them). High-weight predicates match narrowly (few tasks fire them). The specificity threshold $\tau_s$ ensures compiled branches are not too broad.

**Example conditions — Personal Assistant:**

| Predicate | Queries | Weight |
|-----------|---------|--------|
| has_topic(t) | Conv.topics | 3 |
| has_state(e) | Conv.emotion | 1 |
| entity_known(n) | E | 5 |
| memory_contains(q) | Mem | 4 |
| hypothesis_above(d, θ) | H | 4 |
| intention_active(d) | I | 3 |
| msg_includes(w) | M | 4 |

**Example conditions — Coding Assistant:**

| Predicate | Queries | Weight |
|-----------|---------|--------|
| error_type(t) | Err | 4 |
| file_language(l) | Files | 2 |
| has_test_failure | Tests | 3 |
| in_file_scope(pattern) | Files | 5 |
| dependency_outdated(d) | Deps | 3 |
| branch_is(b) | Git | 2 |
| msg_includes(w) | M | 4 |

**Example conditions — Workflow Orchestrator:**

| Predicate | Queries | Weight |
|-----------|---------|--------|
| event_type(t) | Cal | 3 |
| participant_count_above(n) | Cal | 2 |
| task_overdue | Tasks | 4 |
| service_connected(s) | Services | 3 |
| has_document(type) | Docs | 4 |
| msg_includes(w) | M | 4 |

### 2.4 Compiled Plans

A **compiled plan** is a tuple:

$$\rho = (g, [s_1, \ldots, s_n], \phi, \sigma)$$

where:
- $g$ is the goal description
- Each step $s_i = (\text{id}_i, \alpha_i, \beta_i, \chi_i, \text{fail}_i)$ with:
  - $\alpha_i \in A_\text{tool} \cup A_\text{respond} \cup A_\text{generate} \cup A_\text{sub\_plan}$ — the step action
  - $\beta_i$ — output variable binding (optional)
  - $\chi_i$ — success check predicate
  - $\text{fail}_i \in \{\text{skip}, \text{abort}, \text{retry}, \text{escalate}\}$ — failure policy
- $\phi$ — overall success condition
- $\sigma$ — strategy description for cheap model context

**Variable binding** operates over a binding environment $\Gamma: \text{VarName} \rightarrow \text{String}$:

$$\text{exec}(s_i, \Gamma, s) = \begin{cases} (\Gamma[\beta_i \mapsto \text{out}], \text{out}) & \text{if } \chi_i(\text{out}) = 1 \\ \text{handle}(\text{fail}_i) & \text{otherwise} \end{cases}$$

where $\text{out} = \text{execute}(\alpha_i[\Gamma])$ and $\alpha_i[\Gamma]$ denotes substitution of variables in $\alpha_i$'s parameters using bindings from $\Gamma$.

---

## 3. Compilation Operator

### 3.1 Interaction Traces

An **interaction trace** is a record of a successful agent interaction:

$$\tau = (m, r, \text{reason}, \text{topics}, \text{emotion}, \text{steps}, \text{outcome})$$

where:
- $m \in M$ — user message
- $r$ — agent response
- reason — the reasoning that produced $r$
- topics ⊆ TopicSpace — detected topics
- emotion ∈ EmotionSpace — detected emotional state
- steps = $[(\text{tool}_i, \text{params}_i, \text{output}_i)]$ — tool calls executed (possibly empty)
- outcome ∈ {success, failure}

### 3.2 Condition Extraction

Given a trace $\tau$, extract conditions:

$$\text{Extract}(\tau) = \{\ \text{has\_topic}(t) \mid t \in \tau.\text{topics}_{[:2]}\ \}$$
$$\cup\ \{\ \text{has\_state}(\tau.\text{emotion}) \mid \tau.\text{emotion} \neq \text{neutral}\ \}$$
$$\cup\ \{\ \text{msg\_includes}(k) \mid k = \text{goal\_keyword}(\tau.m)\ \}$$

### 3.3 Strategy Extraction

From the reasoning, extract a generation directive:

$$\text{ExtractStrategy}(\tau) = (\text{intent}(\tau.\text{reason}),\ \tau.\text{reason}_{[:150]},\ \text{tone}(\tau.\text{emotion}),\ \tau.\text{topics})$$

### 3.4 Branch Compilation

**Single-action compilation** (for traces with |steps| ≤ 1):

$$\text{Compile}_1(\tau) = \text{seq}(\text{Extract}(\tau),\ \text{strat}(\text{ExtractStrategy}(\tau)))$$

**Plan compilation** (for traces with |steps| ≥ 2):

$$\text{Compile}_P(\tau) = \text{seq}(\text{Extract}(\tau),\ \text{plan}(\text{TraceToPlan}(\tau)))$$

where $\text{TraceToPlan}$ generalizes specific values into variable references:

$$\text{TraceToPlan}(\tau) = (\ \tau.m,\ [\text{Generalize}(s_i, [s_1, \ldots, s_{i-1}], \tau) \mid s_i \in \tau.\text{steps}],\ \phi_\text{last},\ \tau.\text{reason}\ )$$

### 3.5 Tree Growth

Insertion places compiled branches at specific priority positions:

$$\text{Insert}(\text{sel}(n_1, \ldots, n_k), b, \text{priority}) = \text{sel}(n_1, \ldots, n_{\text{priority}-1}, b, n_\text{priority}, \ldots, n_k)$$

- **Plans** insert at position 0 (highest priority — most specific conditions)
- **Strategies** insert at position $k - 1$ (before escalation node, after bootstrap)

This ensures the evaluation order: compiled plans → compiled strategies → bootstrap → escalation.

---

## 4. Immune System

The immune system $\mathcal{I}$ is a composition of three independent filters:

### 4.1 Quality Filter

$$Q(\tau) = \frac{\text{Relevant}(\tau) + \text{Appropriate}(\tau) + \text{Helpful}(\tau)}{3}$$

where each component scores in $[0, 10]$:

$$\text{Relevant}(\tau) = 3 + 7 \cdot \frac{|\text{words}(m) \cap \text{words}(r)|}{|\text{words}(m)|}$$

$$\text{Appropriate}(\tau) = \begin{cases} 2 & \text{if harmful}(r) \\ 3 & \text{if dismissive}(r) \\ 7 & \text{otherwise} \end{cases}$$

The quality gate accepts iff:

$$Q(\tau) \geq \tau_q \quad \land \quad \text{Appropriate}(\tau) \geq 4$$

### 4.2 Specificity Filter

$$\text{Spec}(\text{Extract}(\tau)) \geq \tau_s$$

with $\tau_s = 4$ in the reference implementation. This prevents overly broad patterns (e.g., pure `chance` or `always` conditions) from compiling.

### 4.3 Sentiment Guard

$$\neg\text{Negative}(\text{followup})$$

where Negative is a pattern-matching classifier over the user's next message.

### 4.4 Combined Acceptance

$$\text{Accept}(\tau) = \big[Q(\tau) \geq \tau_q\big] \land \big[\text{Spec}(\text{Extract}(\tau)) \geq \tau_s\big] \land \big[\neg\text{Negative}(\text{followup})\big]$$

**Proposition 4.1** (Immune System Error Bounds). Let $\alpha$ be the false positive rate (bad patterns accepted) and $\beta$ be the false negative rate (good patterns rejected). Then:
- $\alpha \leq P(Q \geq \tau_q \mid \text{bad}) \cdot P(\text{Spec} \geq \tau_s \mid \text{bad}) \cdot P(\neg\text{Neg} \mid \text{bad})$
- Since the filters are independent, $\alpha$ is the product of individual false positive rates.
- Higher thresholds $\tau_q, \tau_s$ decrease $\alpha$ but increase $\beta$ (fewer patterns compiled).

### 4.5 Exploration Rate (ε-Greedy)

Even when the BT matches, exploration forces occasional escalation:

$$P(\text{explore} \mid \text{source}, d) = \min\left(0.5,\ \epsilon(\text{source}) \cdot \gamma(d)\right)$$

where:

| Source | ε(source) |
|--------|-----------|
| bootstrap | 0.30 |
| compiled | 0.10 |
| composed | 0.05 |
| species | 0.08 |

and $\gamma(d) = \begin{cases} 2.0 & d < 5 \\ 1.5 & 5 \leq d < 10 \\ 1.0 & d \geq 10 \end{cases}$ is the depth multiplier (explore more in early conversations).

---

## 5. Swarm Dynamics

### 5.1 Batch Training Swarm (Nightly Cycle)

Given an agent state $s$ and task distribution $D$:

1. **Generate**: Sample $N$ task variants $\{m_1, \ldots, m_N\} \sim D_\text{focused}(s)$ — biased toward the agent's weak spots (high-escalation state regions)
2. **Spawn**: For each $m_i$, create instance $\pi_i$ initialized from $s.\Pi$ (the agent's current BT)
3. **Execute**: Run each instance through its task, collecting traces $\{\tau_1, \ldots, \tau_N\}$
4. **Harvest**: Extract compiled branches $B = \{b_i \mid \text{Accept}(\tau_i)\}$
5. **Cluster**: Group $B$ by similarity into clusters $\{C_1, \ldots, C_L\}$
6. **Merge**: Build species branches from convergent clusters, insert into $s.\Pi$
7. **Validate**: Benchmark the modified policy; reject if regression exceeds threshold

### 5.2 Similarity and Clustering

**Branch similarity** is a weighted combination:

$$\text{sim}(b_i, b_j) = w_c \cdot J(\text{conds}(b_i), \text{conds}(b_j)) + w_\iota \cdot J(\text{intent}(b_i), \text{intent}(b_j)) + w_t \cdot J(\text{topics}(b_i), \text{topics}(b_j))$$

where $J(A, B) = \frac{|A \cap B|}{|A \cup B|}$ is the Jaccard index and $(w_c, w_\iota, w_t) = (0.4, 0.35, 0.25)$.

**Agglomerative clustering** with average linkage merges cluster pairs with similarity above threshold $\theta_\text{cluster} = 0.35$ until no more merges are possible.

### 5.3 Convergence Score

The **convergence score** of a cluster $C_j$ is:

$$\text{Conv}(C_j) = \frac{|\text{unique\_instances}(C_j)|}{N}$$

Clusters with $\text{Conv}(C_j) > 0$ from multiple independent instances represent patterns discovered through convergent exploration — a strong quality signal independent of the immune system.

### 5.4 Species Tree Construction

For each cluster $C_j$:
- If $|C_j| = 1$: use centroid branch directly
- If $|C_j| > 1$: create $\text{wrand}$ node from strategy variants, weighted by instance count

The species tree has structure:

$$\Pi_\text{species} = \text{sel}(\text{species}_1, \ldots, \text{species}_L, \text{bootstrap}_1, \ldots, \text{bootstrap}_B, \text{esc})$$

### 5.5 Runtime Swarm (Spawn-at-Point-of-Failure)

When $\text{eval}(\Pi, s, m) = \text{success}(A_\text{esc})$ (BT escalates):

1. **Spawn** $N_r$ instances, each with a different approach strategy $\sigma_i$:

$$a_i = \text{FlashLite}(m, s, \sigma_i) \quad \text{for } i \in \{1, \ldots, N_r\}$$

2. **Cluster** responses by word-level similarity
3. **Select** the largest cluster's centroid as the response
4. **Converge** iff $|\text{largest\_cluster}| \geq \theta_\text{converge}$
5. **Record** the successful trace for nightly compilation

**Cost**: $N_r$ Flash Lite calls $\approx$ cost of 1 Flash call $\approx$ 1/40th of Pro call.

---

## 6. Composition Algebra

### 6.1 Plans as State Transformers

A plan $\rho$ defines a function:

$$\rho: S \times \Gamma \rightarrow S \times \Gamma \times \text{Result}$$

where $\Gamma$ is the variable binding environment and Result ∈ {success, failure}.

### 6.2 Sequential Composition

Given plans $\rho_1: S \rightarrow S'$ and $\rho_2: S' \rightarrow S''$:

$$(\rho_1 \circ \rho_2)(s, \Gamma) = \rho_2(\rho_1(s, \Gamma))$$

Variable binding is the glue: $\rho_1$'s output bindings extend $\Gamma$, which $\rho_2$'s inputs reference.

### 6.3 Hierarchical Composition

Plans compose into levels:

| Level | Description | Example |
|-------|-------------|---------|
| L₀ | Atomic tools | file_read, run_tests |
| L₁ | Compiled plans (single traces) | gather_notes = [file_read → summarize] |
| L₂ | Composed plans (plans of plans) | prepare_presentation = [gather_notes → draft → checklist] |
| L₃+ | Workflows (deeper composition) | quarterly_cycle = [prepare → schedule → distribute] |

**Definition 6.1** (Plan Level). The level of a plan is:

$$\text{level}(\rho) = \begin{cases} 0 & \text{if } \rho \text{ is an atomic tool call} \\ 1 + \max_{s_i \in \rho.\text{steps}} \text{level}(s_i.\alpha) & \text{otherwise} \end{cases}$$

### 6.4 The sub_plan Action

A step action of type sub_plan invokes a named plan from the skill library:

$$\text{exec}(\text{sub\_plan}(\text{name}, \text{params}), \Gamma, s) = \text{exec}(s.\text{Sk}[\text{name}], \Gamma[\text{params}], s)$$

This enables recursive plan execution with arbitrary nesting depth.

---

## 7. Convergence Theory

### 7.1 Task Distribution

Let $D$ be a distribution over tasks with $K$ **structural families** $\{F_1, \ldots, F_K\}$. Each family has:
- A characteristic condition set $C_k$
- A characteristic tool sequence $T_k$
- Probability mass $p_k = P(m \in F_k)$ where $\sum_k p_k \leq 1$ (some tasks may be novel)

### 7.2 Discovery Probability

For a single swarm instance facing a task from family $F_k$:
- Let $q_k$ = probability that the instance produces a compilable trace for $F_k$
- This depends on: Flash Lite capability, immune system thresholds, exploration rate

**Lemma 7.1** (Family Discovery). The probability that at least one instance in a swarm of size $N$ discovers family $F_k$ is:

$$P(\text{discover } F_k \mid N) = 1 - (1 - q_k)^{N \cdot p_k}$$

where $N \cdot p_k$ is the expected number of instances facing tasks from $F_k$.

### 7.3 Swarm Quality via Condorcet's Jury Theorem

**Theorem 7.2** (Swarm Convergence Quality). If each Flash Lite instance independently produces a correct approach with probability $p > 0.5$, then the majority-vote response from $N$ instances is correct with probability:

$$P(\text{majority correct}) = \sum_{k=\lceil N/2 \rceil}^{N} \binom{N}{k} p^k (1-p)^{N-k} \xrightarrow{N \to \infty} 1$$

*Proof*: Direct application of Condorcet's jury theorem. The sum is the CDF of a Binomial($N$, $p$) evaluated at $N/2$. For $p > 0.5$, the mean $Np > N/2$, and by the law of large numbers, the fraction of correct instances converges to $p > 0.5$. $\square$

**Corollary 7.3**. For $p = 0.6$ and $N = 8$: $P(\text{majority correct}) \approx 0.83$. For $N = 15$: $P \approx 0.92$.

### 7.4 Coupon Collector Bound on Pattern Discovery

**Theorem 7.4** (Saturation). If the task space has $K$ structural families, the expected number of total instance-task encounters to discover all $K$ families follows the coupon collector distribution:

$$E[N_\text{total}] = \frac{K}{q_\text{min}} \cdot H_K = \frac{K}{q_\text{min}} \sum_{i=1}^{K} \frac{1}{i}$$

where $q_\text{min} = \min_k q_k$ is the hardest family's discovery probability and $H_K$ is the $K$-th harmonic number.

*This explains the observed diminishing returns*: clusters saturated at 5 while instances grew to 40, because $H_5 \approx 2.28$ — you need roughly $2.28 \times K / q_\text{min}$ encounters to cover all families.

### 7.5 Main Convergence Theorem

**Theorem 7.5** (Policy Convergence). Let $\pi_t$ be the compiled policy after $t$ nightly training epochs, each with swarm size $N$. Let $D$ have $K$ structural families. Let $\alpha$ be the immune system's false positive rate per family. Then the fraction of tasks from $D$ handled without escalation satisfies:

$$f(t) = \sum_{k=1}^{K} p_k \cdot \big[1 - (1 - q_k (1 - \alpha))^{Nt}\big] \cdot (1 - \epsilon_k)$$

where $\epsilon_k$ is the exploration rate for compiled patterns from family $k$.

**As $t \to \infty$**:

$$f(t) \to \sum_{k=1}^{K} p_k \cdot (1 - \epsilon_k) = \left(\sum_{k=1}^{K} p_k\right)(1 - \bar{\epsilon})$$

where $\bar{\epsilon}$ is the average exploration rate.

*In plain English*: the system converges toward handling all recurring task types, with the residual escalation rate determined by the exploration rate (which is intentional — it enables continued learning).

**Proof sketch**: Each epoch provides $N$ independent opportunities per family. The probability that family $F_k$ remains undiscovered after $t$ epochs is $(1 - q_k(1-\alpha))^{Nt}$, which goes to 0 exponentially. Once discovered, the compiled pattern handles future tasks from $F_k$ with probability $1 - \epsilon_k$ (exploration occasionally overrides). $\square$

### 7.6 Cost Convergence

**Corollary 7.6** (Monotonically Decreasing Cost). The expected cost per task at time $t$ is:

$$\text{Cost}(t) = f(t) \cdot c_\text{lite} + (1 - f(t)) \cdot \big[\gamma \cdot N_r \cdot c_\text{lite} + (1 - \gamma) \cdot c_\text{expensive}\big]$$

where:
- $c_\text{lite}$ = cost of one Flash Lite call
- $c_\text{expensive}$ = cost of one expensive model call
- $N_r$ = runtime swarm size
- $\gamma$ = swarm convergence rate

Since $f(t)$ is monotonically increasing and $c_\text{lite} \ll c_\text{expensive}$, cost decreases over time:

$$\frac{d}{dt}\text{Cost}(t) < 0$$

---

## 8. Scaling Analysis

### 8.1 Computational Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| BT evaluation | O(D) | D = tree depth. Independent of compiled branches if balanced. |
| Condition check | O(1) | Each predicate is a direct state lookup. |
| Plan execution | O(L) | L = number of plan steps. Each step is O(1) + tool cost. |
| Single-action compilation | O(1) | Condition extraction + branch insertion. |
| Plan compilation | O(L) | L = trace length. Generalization is O(L). |
| Nightly swarm training | O(N · T) | N instances × T turns each. Parallelizable. |
| Branch clustering | O(B²) | B = total branches. Pairwise similarity. |
| Runtime swarm | O(N_r) | N_r independent Flash Lite calls. Parallelizable. |

### 8.2 Space Complexity

$$\text{Space}(\Pi_t) = O(K \cdot \bar{L})$$

where $K$ is the number of discovered structural families and $\bar{L}$ is the average plan length. Critically, this is $O(K)$, **not** $O(T)$ where $T$ is total interactions — the tree stores *patterns*, not *instances*.

### 8.3 Cost Per Task Over Time

| Time Period | Dominant Source | Cost Per Task |
|-------------|----------------|---------------|
| Day 1 | Expensive model | $c_\text{expensive}$ |
| Week 1 | Runtime swarm | $N_r \cdot c_\text{lite}$ |
| Month 1+ | Compiled BT | $c_\text{lite}$ |

The ratio $c_\text{lite} / c_\text{expensive} \approx 1/40$ means the steady-state system is 40× cheaper than always calling the expensive model.

---

## 9. Algorithm Specifications

### 9.1 Main Turn Processing

```
FUNCTION ProcessTurn(m, s):
  s.conv ← Analyze(m)                    // lightweight topic/emotion detection
  
  IF HasPendingCompilation():
    τ_prev ← GetPendingTrace()
    IF Accept(τ_prev, m):                 // immune system check with m as follow-up
      b ← Compile(τ_prev)
      s.Π ← Insert(s.Π, b)
  
  r ← Eval(s.Π, s, m)                    // BT evaluation
  
  IF r ≠ A_esc AND Explore(r.source, s.conv.depth):
    r ← A_esc                             // ε-greedy override
  
  SWITCH r:
    CASE success(strategy):  RETURN FlashLite.Generate(strategy, s)
    CASE success(plan):      RETURN ExecutePlan(plan, s, m)
    CASE success(action):    RETURN Execute(action)
    CASE A_esc:
      IF RuntimeSwarmEnabled:
        swarm_result ← RuntimeSwarm(m, s, N_r)
        IF swarm_result.converged:
          RecordTrace(swarm_result)
          RETURN swarm_result.response
      RETURN ExpensiveModel(m, s)         // last resort
```

### 9.2 Runtime Swarm

```
FUNCTION RuntimeSwarm(m, s, N):
  approaches ← SelectDiverseApproaches(N)
  attempts ← []
  
  FOR i IN 1..N:                          // parallelizable
    a_i ← FlashLite.Generate(m, s, approaches[i])
    attempts.append(a_i)
  
  clusters ← AgglomerativeCluster(attempts, sim_threshold)
  winner ← ArgMax(clusters, |cluster|)
  
  IF |winner| ≥ convergence_threshold:
    RETURN (centroid(winner), converged=True)
  ELSE:
    RETURN (∅, converged=False)
```

### 9.3 Nightly Training

```
FUNCTION BatchTrain(agent_id, N):
  s ← Load(agent_id)
  signals ← ExtractTrainingSignals(s)     // high-escalation regions, weak spots
  scripts ← GenerateTargetedScripts(signals, N)
  
  baseline ← Benchmark(s)
  
  instances ← []
  FOR script IN scripts:
    s_i ← Clone(s)                        // start from agent's current tree
    FOR m IN script.messages:
      ProcessTurn(m, s_i)
    instances.append(s_i)
  
  branches ← Harvest(instances)
  clusters ← Cluster(branches, N)
  species_branches ← BuildSpecies(clusters)
  
  FOR b IN species_branches[:max_new]:
    s.Π ← Insert(s.Π, b, priority=FRONT)
  
  improved ← Benchmark(s)
  IF improved.escalation_rate > baseline.escalation_rate + regression_threshold:
    REJECT changes
  ELSE:
    Save(s)
```

### 9.4 Plan Composition

```
FUNCTION Compose(name, goal, sub_plan_names):
  steps ← []
  FOR i, plan_name IN enumerate(sub_plan_names):
    steps.append(PlanStep(
      id = "composed_" + i,
      action = SubPlan(plan_name, params={context: "{composed_" + (i-1) + "}"}),
      output_binding = "composed_" + i,
      on_failure = ABORT
    ))
  
  RETURN Plan(goal, steps, success=LAST_STEP_PASS, strategy=name)
```

---

## 10. Implementation Constants

Reference values from the working implementation:

| Constant | Value | Meaning |
|----------|-------|---------|
| τ_q | 6.0 | Quality compilation threshold |
| τ_s | 4 | Specificity compilation threshold |
| ε_bootstrap | 0.30 | Bootstrap exploration rate |
| ε_compiled | 0.10 | Compiled pattern exploration rate |
| θ_cluster | 0.35 | Nightly swarm clustering threshold |
| θ_runtime | 0.15 | Runtime swarm clustering threshold |
| N_nightly | 15 | Nightly swarm instance count |
| N_runtime | 8 | Runtime swarm instance count |
| θ_converge | 3 | Minimum cluster size for convergence |
| max_new | 10 | Maximum new branches per nightly run |
| regression_pp | 5 | Maximum regression (pp) before rejection |

---

## 11. Empirical Validation Summary

### 11.1 Swarm Convergence (Hypothesis Testing)

| N | Branches | Clusters | Convergent | Avg Cluster Size |
|---|----------|----------|------------|-----------------|
| 5 | 3 | 3 | 0 | 1.0 |
| 10 | 4 | 3 | 1 | 1.3 |
| 20 | 11 | 5 | 2 | 2.4 |
| 40 | 23 | 5 | 5 | 4.6 |

Clusters saturate (diminishing returns), convergent clusters grow (more confirmation). Consistent with Theorem 7.4 (coupon collector).

### 11.2 Cross-Domain Convergence

| Domain | Expected Structure | Convergence | Replay |
|--------|-------------------|-------------|--------|
| Productivity | read → draft → checklist | 100% | YES |
| Software Engineering | analyze → read → edit → test | 100% | YES |
| Knowledge Work | search → summarize → draft | 100% | YES |

Plan compilation generalizes across domains. The mechanism is domain-agnostic.

### 11.3 Nightly Training (Real Gemini)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Tree nodes | 44 | 88 | +44 |
| Compiled branches | 3 | 10 | +7 |
| Escalation rate | 91% | 88% | -3pp |
| Clusters (convergent) | — | 7 (4) | — |
| Topics covered | — | 16 | — |
| Wall time | — | 597s | — |

### 11.4 Runtime Swarm

| Metric | With Swarm | Without Swarm |
|--------|-----------|---------------|
| Source | swarm | escalation |
| Expensive model called | No | Yes |
| Flash Lite calls | 8 | 0 |
| Cost | $0.0008 | $0.0010 |
| Convergence | 3/8 agreed | N/A |

---

## 12. Reproducibility

The complete implementation is available at `psyche-bt/src/` with the following module structure:

```
bt/           — Behavior tree types, evaluator, conditions, bootstrap
compiler/     — Single-action compiler, plan compiler, immune system
engine/       — Conversation loop, benchmark, plan execution
swarm/        — Task generator, swarm runner, harvester, clusterer, 
                species merger, nightly trainer, runtime swarm
ecs/          — Agent state types and operations (reference: personal assistant domain)
tools/        — Tool registry and built-in tools
cli/          — Runners: chat, eval, benchmark, swarm, nightly,
                convergence test, plan demo, runtime swarm demo
```

All experiments are reproducible via:
```bash
npx tsx src/cli/swarm.ts                  # Swarm convergence (H1-H4)
MODE=multiscale npx tsx src/cli/swarm.ts  # Scaling analysis (H5)
npx tsx src/cli/convergence-test.ts       # Cross-domain convergence
npx tsx src/cli/nightly.ts --person=alice  # Batch training (personal assistant domain)
npx tsx src/cli/runtime-swarm-demo.ts     # Runtime swarm
```
