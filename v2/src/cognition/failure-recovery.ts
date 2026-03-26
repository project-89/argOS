import type { World } from "../ecs/world";
import { getRelationTargets, query, hasComponent } from "bitecs";
import { Agent, Name, Perception, Traits, Goal, Plan } from "../ecs/components";
import { HasPerception, HasGoal } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getPlanForGoal } from "./planning-system";

export type RecoveryAction =
  | { type: "pickup"; target: string }
  | { type: "move"; target: string; content?: string }
  | { type: "interact"; target: string; content: string }
  | { type: "observe"; target: string }
  | { type: "speak"; target?: string; content: string }
  | { type: "wait" };

const RECENT_FAILURE_WINDOW_MS = 12_000;
const RECOVERY_DEDUP_WINDOW_MS = 20_000;

type RecoveryEpisode = {
  failureSig: string;
  failureTs: number;
  createdAtMs: number;
  lastUsedAtMs: number;
  triedPickup: Set<string>;
  triedMoves: Set<string>;
  triedContainers: Set<string>;
  triedObservations: Set<string>;
  askedForHelp: boolean;
  attemptedPatchRegen: boolean;
};

// Per-agent recovery episode keyed by the latest failure signature.
const recoveryEpisodes = new Map<number, RecoveryEpisode>();

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

function parseTraitsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasTrait(world: World, eid: number, trait: string): boolean {
  if (!hasComponent(world as any, eid, Traits as any)) return false;
  const wanted = trait.trim().toLowerCase();
  if (!wanted) return false;
  return parseTraitsJson(Traits.active[eid]).some((t) => t.toLowerCase() === wanted);
}

function getLatestCriticalFailure(world: World, agentEid: number): { content: string; source: string; ts: number } | null {
  if (!hasComponent(world as any, agentEid, Agent as any)) return null;
  if (!Agent.active[agentEid]) return null;

  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any));
  let best: { content: string; source: string; ts: number } | null = null;

  for (const peid of perceptionEids) {
    const t = Perception.timestamp[peid] || 0;
    if (t <= 0) continue;
    if (Date.now() - t > RECENT_FAILURE_WINDOW_MS) continue;

    if (String(Perception.type[peid] || "") !== "action_failed") continue;
    const c = String(Perception.content[peid] || "");
    if (!c.includes("FAILED") && !c.includes("🚨 CRITICAL")) continue;

    if (!best || t > best.ts) {
      best = { content: c, source: String(Perception.source[peid] || ""), ts: t };
    }
  }

  return best;
}

function getLatestPerceptionTs(world: World, agentEid: number, type: string, excludeSources: string[] = []): number {
  const excluded = new Set(excludeSources.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .filter((eid: number) => String(Perception.type[eid] || "") === type)
    .filter((eid: number) => {
      if (excluded.size === 0) return true;
      const src = String(Perception.source[eid] || "").trim().toLowerCase();
      return !excluded.has(src);
    })
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 1);
  const peid = perceptionEids[0];
  if (typeof peid !== "number") return 0;
  return Perception.timestamp[peid] || 0;
}

function findEntityByNameInRoom(world: World, roomEid: number | undefined, wantedName: string): number | undefined {
  const wanted = normalizeName(wantedName);
  if (!wanted) return undefined;

  if (roomEid !== undefined) {
    for (const eid of listDirectContents(world as any, roomEid)) {
      if (normalizeName(String(Name.value[eid] || "")) === wanted) return eid;
    }
    // Also allow targeting other agents in the room.
    for (const eid of Array.from(query(world as any, [Agent as any])) as number[]) {
      if (eid === roomEid) continue;
      if (getRoomForEntity(world as any, eid) !== roomEid) continue;
      if (normalizeName(String(Name.value[eid] || "")) === wanted) return eid;
    }
  }

  // Fallback: global scan.
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    const n = Name.value[eid];
    if (typeof n === "string" && normalizeName(n) === wanted) return eid;
  }
  return undefined;
}

function chooseBaseAffordance(available: Array<{ name: string }>, root: string): string | null {
  const r = root.trim().toLowerCase();
  if (!r) return null;
  if (available.some((a) => String(a.name || "").toLowerCase() === r)) return r;
  if (available.some((a) => String(a.name || "").toLowerCase().startsWith(`${r}_`))) return r;
  if (available.some((a) => String(a.name || "").toLowerCase().endsWith(`_${r}`))) return r;
  return null;
}

function parseFirstQuoted(message: string): string | null {
  const m = message.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

function parsePickupHint(message: string): string | null {
  // Example hint:
  //   → PICK UP "Keycard" first to gain hasKeycard
  const m = message.match(/PICK UP\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

function parseActorLacksTrait(message: string): string | null {
  // Example:
  //   Actor lacks trait: hasKeycard (you have: [hasPasscode])
  const m = message.match(/Actor lacks trait:\s*([A-Za-z0-9_:-]+)/i);
  return m ? m[1] : null;
}

function parseInsideHint(message: string): string | null {
  // Example hint:
  //   It appears to be inside "Desk Drawer".
  const m = message.match(/inside\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

function parseVisibleHere(message: string): string[] {
  const m = message.match(/Visible here:\s*([^\n]+)/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function actionSig(a: RecoveryAction): string {
  return JSON.stringify(a);
}

function getOrInitEpisode(agentEid: number, failureSig: string, failureTs: number): RecoveryEpisode {
  const now = Date.now();
  const existing = recoveryEpisodes.get(agentEid);
  if (!existing || existing.failureSig !== failureSig || existing.failureTs !== failureTs || now - existing.lastUsedAtMs > RECOVERY_DEDUP_WINDOW_MS) {
    const ep: RecoveryEpisode = {
      failureSig,
      failureTs,
      createdAtMs: now,
      lastUsedAtMs: now,
      triedPickup: new Set(),
      triedMoves: new Set(),
      triedContainers: new Set(),
      triedObservations: new Set(),
      askedForHelp: false,
      attemptedPatchRegen: false,
    };
    recoveryEpisodes.set(agentEid, ep);
    return ep;
  }
  existing.lastUsedAtMs = now;
  return existing;
}

function tryMoveToEntityRoom(world: World, agentEid: number, targetName: string, ep: RecoveryEpisode): RecoveryAction | null {
  const agentRoom = getRoomForEntity(world as any, agentEid);
  const targetEid = findEntityByNameInRoom(world, undefined, targetName);
  if (targetEid === undefined) return null;
  const targetRoom = getRoomForEntity(world as any, targetEid);
  if (targetRoom === undefined) return null;
  if (agentRoom !== undefined && targetRoom === agentRoom) return null;
  const roomName = String(Name.value[targetRoom] || "").trim();
  if (!roomName) return null;
  const key = normalizeName(roomName);
  if (ep.triedMoves.has(key)) return null;
  ep.triedMoves.add(key);
  return { type: "move", target: roomName, content: `recover access to ${targetName}` };
}

/**
 * Deterministic recovery ladder for recent action_failed stimuli.
 *
 * Goal: when an interaction fails, immediately choose a different grounded tactic:
 * - pick up required tool if hinted
 * - open/unlock container if target appears inside it
 * - observe a nearby object to refresh affordances and update context
 * - ask for help (fallback)
 */
export function selectFailureRecoveryAction(world: World, agentEid: number): RecoveryAction | null {
  const failure = getLatestCriticalFailure(world, agentEid);
  if (!failure) return null;

  // If we have a newer success/action_result/observation, do not keep "recovering" from an older failure.
  // Ignore speech-only "success" so agents don't talk their way out of unresolved grounding failures.
  const latestResultTs = getLatestPerceptionTs(world, agentEid, "action_result", ["speech"]);
  if (latestResultTs >= failure.ts && latestResultTs > 0) return null;
  // Successful observations also count as recovery (observe sends type "observation" not "action_result")
  const latestObsTs = getLatestPerceptionTs(world, agentEid, "observation");
  if (latestObsTs >= failure.ts && latestObsTs > 0) return null;

  const failureSig = `${failure.source}|${failure.content.slice(0, 300)}`;
  const roomEid = getRoomForEntity(world as any, agentEid);
  const ep = getOrInitEpisode(agentEid, failureSig, failure.ts);

  // 0) Workspace coding recovery: if a git_apply_from_last_gemini step failed, regenerate the patch.
  // This prevents loops like: git_apply -> fail -> git_apply -> fail, when the patch hunks don't match the file.
  if (!ep.attemptedPatchRegen && /git_apply_from_last_gemini/i.test(failure.content) && /check failed/i.test(failure.content)) {
    const goals = getRelationTargets(world as any, agentEid, HasGoal)
      .filter((gid) => hasComponent(world as any, gid, Goal) && String(Goal.status[gid] || "") === "active")
      .sort((a, b) => Number(Goal.priority[b] || 0) - Number(Goal.priority[a] || 0));

    for (const goalEid of goals) {
      const planEid = getPlanForGoal(world as any, agentEid, goalEid);
      if (!planEid || !hasComponent(world as any, planEid, Plan)) continue;
      const planStatus = String(Plan.status[planEid] || "");
      if (planStatus !== "active" && planStatus !== "failed") continue;
      let steps: any[] = [];
      try {
        steps = JSON.parse(String(Plan.steps[planEid] || "[]"));
      } catch {
        steps = [];
      }
      const idx = Number(Plan.currentStep[planEid] || 0);
      const cur = steps[idx];
      const prev = idx > 0 ? steps[idx - 1] : undefined;
      const curContent = cur && typeof cur.content === "string" ? cur.content : "";
      const prevContent = prev && typeof prev.content === "string" ? prev.content : "";
      if (cur && String(cur.actionType || "") === "interact" && /^git_apply_from_last_gemini\b/i.test(curContent) && prev && String(prev.actionType || "") === "interact" && /^gemini_cli\b/i.test(prevContent)) {
        ep.attemptedPatchRegen = true;
        const target = String(prev.target || cur.target || "Workstation");
        return { type: "interact", target, content: prevContent };
      }
    }
  }

  // 1) If the engine told us exactly what to pick up, do that.
  const pickupName = parsePickupHint(failure.content);
  if (pickupName) {
    const key = normalizeName(pickupName);
    if (!ep.triedPickup.has(key)) {
      ep.triedPickup.add(key);
      return { type: "pickup", target: pickupName };
    }
    // If we've already tried to pick it up here, try going to where it actually is (if known).
    const move = tryMoveToEntityRoom(world, agentEid, pickupName, ep);
    if (move) return move;
  }

  // 1b) If we lack a tool trait, try to pick up any visible object that provides it.
  const missingTrait = parseActorLacksTrait(failure.content);
  if (missingTrait && roomEid !== undefined) {
    const trait = missingTrait.trim();
    for (const eid of listDirectContents(world as any, roomEid)) {
      const n = String(Name.value[eid] || "").trim();
      if (!n) continue;
      if (!hasTrait(world, eid, trait)) continue;
      const key = normalizeName(n);
      if (!ep.triedPickup.has(key)) {
        ep.triedPickup.add(key);
        return { type: "pickup", target: n };
      }
    }
  }

  // 2) If the target appears to be inside a container, try opening/unlocking it.
  const containerName = parseInsideHint(failure.content);
  if (containerName) {
    const key = normalizeName(containerName);
    const containerEid = findEntityByNameInRoom(world, roomEid, containerName);
    if (containerEid !== undefined) {
      if (!ep.triedContainers.has(key)) {
        ep.triedContainers.add(key);
        const available = getAvailableAffordances(world as any, agentEid, containerEid);
        const base =
          chooseBaseAffordance(available, "unlock") ||
          chooseBaseAffordance(available, "open") ||
          chooseBaseAffordance(available, "pry") ||
          null;

        if (base) return { type: "interact", target: containerName, content: base };
      }

      // If we already tried to open/unlock, observe it for updated affordances/state.
      if (!ep.triedObservations.has(key)) {
        ep.triedObservations.add(key);
        return { type: "observe", target: containerName };
      }
    }
  }

  // 3) If we have a "Visible here" hint, observe something visible to refresh context.
  const visible = parseVisibleHere(failure.content);
  if (visible.length > 0) {
    for (const target of visible) {
      const key = normalizeName(target);
      if (ep.triedObservations.has(key)) continue;
      ep.triedObservations.add(key);
      return { type: "observe", target };
    }
  }

  // 4) Try observing the most likely mentioned target (quoted string) if present.
  const quoted = parseFirstQuoted(failure.content);
  if (quoted) {
    // If the quoted thing exists elsewhere, relocate before continuing.
    const move = tryMoveToEntityRoom(world, agentEid, quoted, ep);
    if (move) return move;

    const key = normalizeName(quoted);
    if (!ep.triedObservations.has(key)) {
      ep.triedObservations.add(key);
      return { type: "observe", target: quoted };
    }
  }

  // 5) If we have a room, observe any object in it.
  if (roomEid !== undefined) {
    const contents = listDirectContents(world as any, roomEid);
    for (const eid of contents) {
      if (eid === agentEid) continue;
      const n = String(Name.value[eid] || "").trim();
      if (!n) continue;
      const key = normalizeName(n);
      if (ep.triedObservations.has(key)) continue;
      ep.triedObservations.add(key);
      return { type: "observe", target: n };
    }
  }

  // 6) Ask for help if other agents are around.
  if (!ep.askedForHelp && roomEid !== undefined) {
    const others = Array.from(query(world as any, [Agent as any])) as number[];
    for (const other of others) {
      if (other === agentEid) continue;
      if (getRoomForEntity(world as any, other) !== roomEid) continue;
      const otherName = String(Name.value[other] || "").trim();
      if (!otherName) continue;
      ep.askedForHelp = true;
      return { type: "speak", target: otherName, content: `Can you help me figure out how to proceed?` };
    }
  }

  // If nothing else, do nothing.
  return { type: "wait" };
}
