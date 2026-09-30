import type { GodAgentState } from "./god-agent";
import type { DivineMessage, MessagePriority } from "../spirits/types";
import { godCommand } from "./god-agent";
import { captureGodMessageDelivery, isScopedSpiritMessage } from "../spirits/spirit-message-delivery";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { hasComponent } from "bitecs";
import { GodAgent, Name, WorkingMemoryIdentity } from "../ecs/components";
import { isEntityPresent } from "../ecs/entity-presence";

export type AutopilotRunResult = {
  ran: boolean;
  reason?: string;
  messagesConsidered: number;
  messagesIncluded: number;
  executed: boolean;
  /** Still-current receipts deferred before inference, never acknowledged. */
  messagesDeferred?: number;
  deferredReason?: "insufficient_review_window";
  error?: string;
  actions?: unknown[];
};

export type GodAutopilotConfig = {
  enabled: boolean;
  minRunIntervalMs: number;
  maxInboxSize: number;
  /** Compatibility ceiling; independently-lived receipts are reviewed singly. */
  maxMessagesPerRun: number;
  minPriority: MessagePriority;
  maxMessageAgeMs: number;
  /** Conservative admission headroom in each clock's own milliseconds, not a
   * latency guarantee. Native/tool/post-inference freshness remains mandatory. */
  minReviewWindowMs?: number;
};

export type GodAutopilotMessage = {
  id: string;
  timestamp: number;
  fromEid: number;
  fromName: string;
  type: DivineMessage["type"];
  domain: DivineMessage["domain"];
  priority: MessagePriority;
  subject: string;
  content: string;
  data?: Record<string, any>;
  requiresResponse: boolean;
  deadline?: number;
};

export type GodAutopilotState = {
  config: GodAutopilotConfig;
  inbox: GodAutopilotMessage[];
  lastRunAt: number;
  consecutiveFailures: number;
  lastError?: string;
  discardedMessages?: number;
  /** Fair service between advisory traffic and isolated proposal review. */
  lastBatchKind?: "reports" | "proposal";
};

/** Private operator evidence of an attempted native review, not a public world
 * event or evidence that a proposal was built/used. Each observer owns its copy. */
export type GodAutopilotReview = {
  sourceId: string | null;
  startedAtSimMs: number;
  completedAtSimMs: number;
  before: GodAutopilotMessage[];
  result: AutopilotRunResult;
};

type ReviewObserver = (review: GodAutopilotReview) => void | Promise<void>;
const reviewObservers = new WeakMap<GodAgentState, { listeners: Set<ReviewObserver>; failures: number }>();

export function subscribeGodAutopilotReviews(god: GodAgentState, observer: ReviewObserver): () => void {
  let state = reviewObservers.get(god);
  if (!state) { state = { listeners: new Set(), failures: 0 }; reviewObservers.set(god, state); }
  state.listeners.add(observer);
  return () => { state.listeners.delete(observer); };
}

export function getGodAutopilotObserverFailures(god: GodAgentState): number {
  return reviewObservers.get(god)?.failures ?? 0;
}

function publishReview(god: GodAgentState, review: GodAutopilotReview): void {
  const state = reviewObservers.get(god);
  if (!state) return;
  for (const observer of [...state.listeners]) {
    try {
      // Isolate nested receipts/actions as well as the envelope. A subscriber
      // cannot edit the inbox, the returned native result, or another observer.
      const pending = observer(structuredClone(review));
      if (pending) void Promise.resolve(pending).catch(() => { state.failures++; });
    } catch { state.failures++; }
  }
}

const DEFAULT_CONFIG: GodAutopilotConfig = {
  enabled: true,
  minRunIntervalMs: 30_000,
  maxInboxSize: 200,
  maxMessagesPerRun: 6,
  // Spirit suggestions (normal) flow to God; the Narrator's requests are high.
  minPriority: "normal",
  maxMessageAgeMs: 120_000,
  minReviewWindowMs: 10_000,
};

/** A fast judge in front of God's review: reads one report and says whether God should take it up now.
 * Declined reports leave the inbox without inference (a judgment, never an action or an acknowledgement
 * of anything done); an unanswered triage falls through to the full review. Urgent reports are never triaged. */
export type GodTriage = (message: GodAutopilotMessage) => Promise<{ act: boolean; why?: string } | undefined>;
const triages = new WeakMap<GodAgentState, GodTriage>();
export function setGodTriage(god: GodAgentState, triage: GodTriage | undefined): void {
  if (triage) triages.set(god, triage); else triages.delete(god);
}

const admissions=new WeakMap<GodAutopilotMessage,()=>boolean>();
const reviewWindows = new WeakMap<GodAutopilotMessage, (headroomMs: number) => boolean>();
const seen=new WeakMap<GodAgentState,Map<string,()=>boolean>>();
const running=new WeakSet<GodAgentState>();
function currentMessage(message:GodAutopilotMessage):boolean {
  try {return admissions.get(message)?.()===true;} catch {return false;}
}
function freezeJson<T>(value:T):T {
  if(value && typeof value==="object") {Object.values(value).forEach(freezeJson);Object.freeze(value);} return value;
}

function priorityRank(p: MessagePriority): number {
  switch (p) {
    case "urgent":
      return 3;
    case "high":
      return 2;
    case "normal":
      return 1;
    case "low":
      return 0;
  }
}

export function initializeGodAutopilot(
  god: GodAgentState,
  config: Partial<GodAutopilotConfig> = {}
): void {
  const existing = god.autopilot;
  const merged: GodAutopilotConfig = { ...DEFAULT_CONFIG, ...config };
  if(!Number.isFinite(merged.maxMessageAgeMs) || merged.maxMessageAgeMs<=0 || merged.maxMessageAgeMs>600_000)
    throw new Error("Autopilot report freshness must be between zero and ten minutes");
  if (!Number.isFinite(merged.minReviewWindowMs ?? 10_000) || (merged.minReviewWindowMs ?? 10_000) < 0)
    throw new Error("Autopilot review window must be finite and non-negative");
  if (!Number.isSafeInteger(merged.maxMessagesPerRun) || merged.maxMessagesPerRun < 1)
    throw new Error("Autopilot maxMessagesPerRun must be a positive safe integer");
  god.autopilot = existing
    ? { ...existing, config: merged }
    : { config: merged, inbox: [], lastRunAt: 0, consecutiveFailures: 0 };
}

export function isGodAutopilotEnabled(god: GodAgentState): boolean {
  return Boolean(god.autopilot?.config.enabled);
}

export function enqueueSpiritMessages(
  god: GodAgentState,
  messages: DivineMessage[],
  resolveFromName: (fromEid: number) => string
): void {
  if (!god.autopilot) initializeGodAutopilot(god);

  const inbox = getAutopilotInbox(god), state=god.autopilot!;
  let history=seen.get(god);if(!history){history=new Map();seen.set(god,history);}
  for(const [id,current] of history) {try{if(!current())history.delete(id);}catch{history.delete(id);}}
  for (const m of messages) {
    const world=god.world,recipient=god.eid;
    const native=captureGodMessageDelivery(world,recipient,m), source=getCommittedEvents(world);
    const timestamp=m.timestamp,deadline=m.deadline;
    const at=readSimulationTime(god.world), receivedAt=Date.now(), owner=workingMemoryEntityRef(god.world,god.eid);
    const current=()=>{
      const live=getCommittedEvents(world), now=readSimulationTime(world), wall=Date.now();
      // Freshness is a pure check, never authority to recreate a deleted identity.
      return god.world===world && god.eid===recipient && isEntityPresent(world,recipient) && hasComponent(world,recipient,GodAgent)
        && !!owner && hasComponent(world,recipient,WorkingMemoryIdentity) && WorkingMemoryIdentity.id[recipient]===owner.key
        && Name.value[recipient]===owner.label && !source.stopped && !live.stopped
        && source.sourceId===live.sourceId && Number.isFinite(now) && now>=at && now>= (native?.at ?? at)
        && now-(native?.at ?? at)<=state.config.maxMessageAgeMs && wall>=receivedAt && wall-timestamp<=state.config.maxMessageAgeMs
        && m.to===god.eid && (!deadline || wall<=deadline) && (!native || native.current());
    };
    if((isScopedSpiritMessage(m)&&!native) || !Number.isFinite(m.timestamp) || m.timestamp>receivedAt || !current()
      || history.has(m.id) || history.size>=state.config.maxInboxSize*2) {
      state.discardedMessages=(state.discardedMessages ?? 0)+1;continue;
    }
    let data:GodAutopilotMessage["data"];
    try {
      const json=JSON.stringify(m.data ?? null);
      if(json.length+m.subject.length+m.content.length>64_000)throw new Error("Report too large");
      data=m.data===undefined?undefined:freezeJson(JSON.parse(json));
    } catch {state.discardedMessages=(state.discardedMessages ?? 0)+1;continue;}
    const receipt:GodAutopilotMessage=Object.freeze({
      id: m.id,
      timestamp: m.timestamp,
      fromEid: m.from,
      fromName: resolveFromName(m.from),
      type: m.type,
      domain: m.domain,
      priority: m.priority,
      subject: m.subject,
      content: m.content,
      data,
      requiresResponse: m.requiresResponse,
      deadline: m.deadline,
    });
    // A trusted binding may have a shorter native lifetime than the mailbox.
    // Do not infer that lifetime from historical/model-authored message.data.
    // Wall and simulation clocks are tested separately; neither advances the other.
    reviewWindows.set(receipt, headroomMs =>
      readSimulationTime(world) + headroomMs <= Math.min((native?.at ?? at) + state.config.maxMessageAgeMs,
        native?.expiresAtSimMs ?? Infinity)
      && Date.now() + headroomMs <= Math.min(timestamp + state.config.maxMessageAgeMs, deadline ?? Infinity));
    admissions.set(receipt,current);history.set(m.id,current);inbox.push(receipt);
  }

  // Sort by priority desc, then recency desc.
  inbox.sort((a, b) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return b.timestamp - a.timestamp;
  });

  // Bound inbox size (drop oldest/lowest priority).
  const max = god.autopilot!.config.maxInboxSize;
  if (inbox.length > max) {
    inbox.length = max;
  }
}

export function getAutopilotInbox(god: GodAgentState): GodAutopilotMessage[] {
  if(!god.autopilot)return [];
  const state=god.autopilot, valid=state.inbox.filter(currentMessage);
  state.discardedMessages=(state.discardedMessages ?? 0)+state.inbox.length-valid.length;
  state.inbox=valid;return valid;
}

function buildAutopilotCommand(messages: GodAutopilotMessage[]): string {
  const lines: string[] = [];
  const story = messages.some(m => m.data?.source === "narrative_directive");
  lines.push(story
    ? "The Narrator is asking you to make something happen in the story. Read the request, check the live world, and make it real with your tools if it serves the story and the residents."
    : "A spirit has reported to you. Read it, check the live world, and act where it helps this world and its people.");
  lines.push("");
  for (const m of messages) {
    const ts = new Date(m.timestamp).toISOString();
    lines.push(`- [${m.priority.toUpperCase()}] ${m.fromName} (${m.domain}) @ ${ts}`);
    lines.push(`  subject: ${m.subject}`);
    lines.push(`  content: ${m.content}`);
    lines.push(`  receipt: ${m.id}`);
    if (m.data) lines.push(`  data: ${JSON.stringify(m.data)}`);
    if (m.deadline) lines.push(`  deadline: ${new Date(m.deadline).toISOString()}`);
  }
  lines.push("");
  lines.push("Ways to act: stageNarrativeEvent (a sound, an arrival, a failing light, a text from an unknown number), placeStoryProp (a letter, a found object), approveProposal/rejectProposal (the Weaver's builds), requestMechanic (a new rule the world lacks), where available.");
  lines.push("Use exact names from the live world. Build forward from what has already happened; only an applied receipt means it happened. Close with one or two sentences on what you did.");
  return lines.join("\n");
}

export async function runGodAutopilotCycle(
  god: GodAgentState,
  options: {
    executeCommand?: (command: string) => Promise<unknown>;
    now?: number;
  } = {}
): Promise<AutopilotRunResult> {
  if (!god.autopilot) initializeGodAutopilot(god);
  const state = god.autopilot!;

  const now = options.now ?? Date.now();
  const inbox = getAutopilotInbox(god);
  if(running.has(god)) return {ran:false,reason:"in_flight",messagesConsidered:inbox.length,messagesIncluded:0,executed:false};
  // Restored or directly edited configuration must not turn a zero/invalid
  // ceiling into permission to dispatch the singleton batch below.
  if (!Number.isSafeInteger(state.config.maxMessagesPerRun) || state.config.maxMessagesPerRun < 1)
    return { ran: false, reason: "invalid_batch_limit", messagesConsidered: inbox.length, messagesIncluded: 0, executed: false };
  const headroomMs = state.config.minReviewWindowMs ?? 10_000;
  if (!Number.isFinite(headroomMs) || headroomMs < 0)
    return { ran: false, reason: "invalid_review_window", messagesConsidered: inbox.length, messagesIncluded: 0, executed: false };

  const minInterval = state.config.minRunIntervalMs;
  if (now - state.lastRunAt < minInterval) {
    return {
      ran: false,
      reason: "throttled",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  if (!state.config.enabled) {
    return {
      ran: false,
      reason: "disabled",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  if (inbox.length === 0) {
    return {
      ran: false,
      reason: "no_messages",
      messagesConsidered: 0,
      messagesIncluded: 0,
      executed: false,
    };
  }

  // Filter by min priority
  const threshold = priorityRank(state.config.minPriority);
  const priorityEligible = inbox.filter((m) => priorityRank(m.priority) >= threshold);
  if (priorityEligible.length === 0) {
    return {
      ran: false,
      reason: "no_eligible_messages",
      messagesConsidered: inbox.length,
      messagesIncluded: 0,
      executed: false,
    };
  }

  const eligible = priorityEligible.filter(message => reviewWindows.get(message)?.(headroomMs) === true);
  const messagesDeferred = priorityEligible.length - eligible.length;
  const deferred = messagesDeferred ? { messagesDeferred, deferredReason: "insufficient_review_window" as const } : {};
  if (!eligible.length) return { ran: false, reason: "insufficient_review_window", messagesConsidered: inbox.length,
    messagesIncluded: 0, executed: false, ...deferred };

  // A proposal and a transient activity report have independent lifetimes.
  // Isolate proposal review BEFORE building the model's context. Once evidence
  // enters that context every included receipt must still remain current; do
  // not weaken an in-flight command to `some(currentMessage)` on expiration.
  // This classifies work, not authority: approval still needs a current native
  // proposal and the original receipt/source guards at every tool boundary.
  const isProposal = (message: GodAutopilotMessage) => typeof message.data?.proposal?.id === "string";
  // Continuous newer activity reports used to keep an older proposal out of
  // every batch. After serving reports, give the oldest eligible proposal one
  // review turn. Genuine urgent reports still preempt; this selects context,
  // never authorizes construction or relaxes any source/receipt checks.
  const oldestProposal = state.lastBatchKind === "reports" && !eligible.some(m=>m.priority === "urgent")
    ? eligible.filter(isProposal).sort((a,b)=>a.timestamp-b.timestamp)[0] : undefined;
  const first = oldestProposal ?? eligible[0];
  // Reports also have independent lifetimes: a near-expiring observation must
  // not invalidate a newer report's entire tool context. Retain all unselected
  // receipts for later review or ordinary expiry; this is not acknowledgement.
  const batch = [first];
  const triage = triages.get(god);
  if (triage && first.priority !== "urgent") {
    running.add(god);
    let verdict: Awaited<ReturnType<GodTriage>>;
    try { verdict = await triage(first); } catch { verdict = undefined; } finally { running.delete(god); }
    if (verdict && !verdict.act) {
      state.inbox = state.inbox.filter(m => m.id !== first.id);
      const at = readSimulationTime(god.world);
      const result: AutopilotRunResult = { ran: true, reason: "triaged", messagesConsidered: inbox.length, messagesIncluded: 1, executed: false, ...deferred };
      publishReview(god, { sourceId: getCommittedEvents(god.world).sourceId, startedAtSimMs: at, completedAtSimMs: at, before: [first], result });
      return result;
    }
    if (!currentMessage(first)) return { ran: false, reason: "expired_during_triage", messagesConsidered: inbox.length, messagesIncluded: 0, executed: false, ...deferred };
  }
  const command = buildAutopilotCommand(batch);

  const signal=getSimulationTaskSignal();
  const current=()=>!signal?.aborted && god.autopilot===state && state.config.enabled && batch.every(currentMessage);
  const executor = options.executeCommand || ((cmd: string) => godCommand(god, cmd,{authority:"spirit-growth",current}));
  const world = god.world;
  const sourceId = getCommittedEvents(world).sourceId;
  const startedAtSimMs = readSimulationTime(world);
  // Admitted messages and their nested data are already immutable snapshots.
  const before = batch.slice();
  let result: AutopilotRunResult | undefined;

  state.lastRunAt = now;
  state.lastBatchKind = isProposal(first) ? "proposal" : "reports";
  running.add(god);
  try {
    if(!current())throw new Error("Autopilot batch expired before inference");
    const output=await executor(command);
    if(!current())throw new Error("Autopilot batch expired during inference");

    // Remove included messages from inbox by id (only those we acted on).
    const acted = new Set(batch.map((m) => m.id));
    state.inbox = state.inbox.filter((m) => !acted.has(m.id));

    state.consecutiveFailures = 0;
    state.lastError = undefined;

    return result = {
      ran: true,
      messagesConsidered: inbox.length,
      messagesIncluded: batch.length,
      executed: true,
      ...deferred,
      actions:Array.isArray(output)?output:undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    state.consecutiveFailures++;
    state.lastError = msg;

    return result = {
      ran: true,
      messagesConsidered: inbox.length,
      messagesIncluded: batch.length,
      executed: false,
      ...deferred,
      error: msg,
    };
  } finally {
    // No readiness/start events: this runs only after the executor actually
    // settles and the native current check has accepted or rejected its result.
    if (result) publishReview(god, { sourceId, startedAtSimMs,
      completedAtSimMs: readSimulationTime(world), before, result });
    running.delete(god);
  }
}
