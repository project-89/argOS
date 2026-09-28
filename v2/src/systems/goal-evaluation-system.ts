import { stampSimulationTime } from "../ecs/temporal-age";
import type { World } from "../ecs/world";
import type { SystemContext } from "../ecs/dynamic-systems";
import { entityExists, hasComponent, getRelationTargets, query } from "bitecs";
import { Agent, Goal, GoalLifecycle, KanbanBoard, KanbanCard, KanbanColumn, LastAction, LastToolResult, Name, Needs, Plan, Room, ToolResult, Traits, WikiDoc } from "../ecs/components";
import { maintainGoalLifecycles } from "../cognition/goal-lifecycle";
import { retireGoalPlans } from "../cognition/plan-state";
import { HasGoal, HasPlan, HasToolResult } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { getDynamicComponent } from "../ecs/dynamic-components";
import { getComponent } from "../ecs/component-registry";
import { compileCompletedPlanToProceduralMacro, compileSuccessfulGoalActionsToProceduralMacro } from "../cognition/plan-compiler";
import { getSuccessfulGoalActions, onGoalCompleted } from "../cognition/goal-learning";
import { readGoalSuccessContract, type GoalSuccessV1 } from "../cognition/goal-contract";
import { readProductiveGoalTime } from "../world/productive-work";

function safeParseJson<T>(raw: string): T | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseTraitsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function actorHasTrait(world: World, agentEid: number, wantedTrait: string): boolean {
  const wanted = normalize(wantedTrait);
  if (!wanted) return false;
  if (!hasComponent(world as any, agentEid, Traits as any)) return false;
  return parseTraitsJson(Traits.active[agentEid]).some((t) => normalize(t) === wanted);
}

function roomNameMatches(current: string, expected: string): boolean {
  const c = normalize(current);
  const e = normalize(expected);
  if (!c || !e) return false;
  if (c === e) return true;
  // Preserve only the legacy leading article alias, never substring identity
  // ("Basement" is not "Basement Landing", nor "Office" the "Office Annex").
  return c.replace(/^the /, "") === e.replace(/^the /, "");
}

function lastInteractMatches(world: World, agentEid: number, goalEid: number, targetName: string, affordance: string): boolean {
  if (!hasComponent(world as any, agentEid, LastAction as any)) return false;
  if (String(LastAction.type[agentEid] || "").toLowerCase() !== "interact") return false;
  if (!LastAction.success[agentEid]) return false;

  const targetOk = normalize(LastAction.target[agentEid] || "") === normalize(targetName);
  if (!targetOk) return false;

  const content = String(LastAction.content[agentEid] || "").trim();
  const first = content.split(/\s+/)[0]?.toLowerCase() || "";
  if (first !== normalize(affordance)) return false;

  const createdAt = Goal.createdAt[goalEid] || 0;
  const ts = LastAction.timestamp[agentEid] || 0;
  // Enforce "happened during this goal": if goal has a createdAt, require a timestamped action at/after it.
  if (createdAt > 0) {
    if (ts <= 0) return false;
    if (ts < createdAt) return false;
  }

  return true;
}

function lastInteractAffordanceMatches(world: World, agentEid: number, goalEid: number, affordance: string): boolean {
  if (!hasComponent(world as any, agentEid, LastAction as any)) return false;
  if (String(LastAction.type[agentEid] || "").toLowerCase() !== "interact") return false;
  if (!LastAction.success[agentEid]) return false;

  const content = String(LastAction.content[agentEid] || "").trim();
  const first = content.split(/\s+/)[0]?.toLowerCase() || "";
  if (first !== normalize(affordance)) return false;

  const createdAt = Goal.createdAt[goalEid] || 0;
  const ts = LastAction.timestamp[agentEid] || 0;
  if (createdAt > 0) {
    if (ts <= 0) return false;
    if (ts < createdAt) return false;
  }

  return true;
}

function lastActionTypeMatches(world: World, agentEid: number, goalEid: number, actionType: string, targetName?: string): boolean {
  if (!hasComponent(world as any, agentEid, LastAction as any)) return false;
  if (!LastAction.success[agentEid]) return false;

  const lastType = String(LastAction.type[agentEid] || "").toLowerCase();
  if (lastType !== String(actionType || "").toLowerCase()) return false;

  if (targetName && String(targetName || "").trim()) {
    if (normalize(LastAction.target[agentEid] || "") !== normalize(targetName)) return false;
  }

  const createdAt = Goal.createdAt[goalEid] || 0;
  const ts = LastAction.timestamp[agentEid] || 0;
  if (createdAt > 0) {
    if (ts <= 0) return false;
    if (ts < createdAt) return false;
  }

  return true;
}

function readNeedValue(world: World, agentEid: number, need: "hunger" | "energy" | "social" | "comfort"): number | undefined {
  if (!hasComponent(world as any, agentEid, Needs as any)) return undefined;
  if (need === "hunger") return Needs.hunger[agentEid];
  if (need === "energy") return Needs.energy[agentEid];
  if (need === "social") return Needs.social[agentEid];
  if (need === "comfort") return Needs.comfort[agentEid];
  return undefined;
}

function isContainedBy(world: World, eid: number, ancestorEid: number, maxDepth: number = 32): boolean {
  let current = eid;
  for (let depth = 0; depth < maxDepth; depth++) {
    const container = getDirectContainer(world as any, current);
    if (container === undefined) return false;
    if (container === ancestorEid) return true;
    current = container;
  }
  return false;
}

function inventoryContainsNamedItem(world: World, agentEid: number, itemName: string): boolean {
  const wanted = String(itemName || "").trim();
  if (!wanted) return false;
  for (const eid of query(world, [Name])) {
    if (String(Name.value[eid] || "") !== wanted) continue;
    if (isContainedBy(world, eid, agentEid)) return true;
  }
  return false;
}

/** Read current attached state, never stale sparse-array residue or a fuzzy name
 * match. Own data properties avoid invoking arbitrary accessors during proof. */
function entityComponentEquals(
  world: World,
  node: Extract<GoalSuccessV1, { type: "entity_component_equals" }>
): boolean {
  if (typeof node.entityName !== "string" || !node.entityName.trim() ||
      typeof node.component !== "string" || !node.component.trim() ||
      typeof node.field !== "string" || !node.field.trim() ||
      !["string", "number", "boolean"].includes(typeof node.equals) ||
      (typeof node.equals === "number" && !Number.isFinite(node.equals))) return false;

  const matches = Array.from(query(world, [Name])).filter(eid =>
    entityExists(world, eid) && Name.value[eid] === node.entityName);
  // A duplicate name is ambiguous even if only one duplicate has the component.
  if (matches.length !== 1) return false;
  const eid = matches[0];
  // Retained tombstones (including contents of removed containers) are history,
  // not current world-state proof. Preserve the name ambiguity check above.
  if (!isEntityPresent(world, eid)) return false;
  const component = getComponent(node.component);
  if (!component || typeof component !== "object" || !hasComponent(world, eid, component)) return false;
  const field = Object.getOwnPropertyDescriptor(component, node.field);
  if (!field || !("value" in field) || !field.value || typeof field.value !== "object") return false;
  const value = Object.getOwnPropertyDescriptor(field.value, String(eid));
  if (!value || !("value" in value)) return false;
  const actual: unknown = value.value;
  if (!["string", "number", "boolean"].includes(typeof actual) ||
      (typeof actual === "number" && !Number.isFinite(actual))) return false;
  return actual === node.equals;
}

function repoFileContains(world: World, path: string, includes: string): boolean {
  const RepoFile = getDynamicComponent("RepoFile");
  if (!RepoFile) return false;
  const wantedPath = String(path || "").trim();
  if (!wantedPath) return false;
  for (const eid of query(world, [RepoFile])) {
    const p = RepoFile.path?.[eid];
    if (typeof p === "string" && p === wantedPath) {
      const content = String(RepoFile.content?.[eid] ?? "");
      return content.includes(includes);
    }
  }
  return false;
}

function findNamedEntityWithComponent(world: World, name: string, component: any): number | undefined {
  const wanted = String(name || "").trim();
  if (!wanted) return undefined;
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    if (String(Name.value[eid] || "") !== wanted) continue;
    if (!hasComponent(world as any, eid, component as any)) continue;
    return eid;
  }
  return undefined;
}

function kanbanCardInColumn(
  world: World,
  boardName: string | undefined,
  cardTitle: string,
  columnName: string
): boolean {
  const wantedTitle = String(cardTitle || "").trim();
  const wantedCol = String(columnName || "").trim();
  if (!wantedTitle || !wantedCol) return false;

  const boardEid = boardName ? findNamedEntityWithComponent(world, boardName, KanbanBoard as any) : undefined;
  if (boardName && boardEid === undefined) return false;

  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    if (!hasComponent(world as any, eid, KanbanCard as any)) continue;
    if (String(Name.value[eid] || KanbanCard.title[eid] || "") !== wantedTitle) continue;
    const colEid = getDirectContainer(world, eid);
    if (colEid === undefined) continue;
    if (!hasComponent(world as any, colEid, KanbanColumn as any)) continue;
    if (String(Name.value[colEid] || KanbanColumn.name[colEid] || "") !== wantedCol) continue;

    if (boardEid !== undefined) {
      const parent = getDirectContainer(world, colEid);
      if (parent === undefined || parent !== boardEid) continue;
    }

    return true;
  }

  return false;
}

function docContains(world: World, title: string, includes: string): boolean {
  const docEid = findNamedEntityWithComponent(world, title, WikiDoc as any);
  if (docEid === undefined) return false;
  const body = String(WikiDoc.body[docEid] || "");
  return body.includes(includes);
}

function lastToolMatches(
  world: World,
  agentEid: number,
  goalEid: number,
  toolId: string,
  commandIncludes?: string
): boolean {
  if (!hasComponent(world as any, agentEid, LastToolResult as any)) return false;
  const timestamp = Number(LastToolResult.timestamp[agentEid] || 0);
  if (timestamp <= 0 || timestamp < Number(Goal.createdAt[goalEid] || 0)) return false;
  // The legacy cache may mirror a modern result belonging to another goal.
  // Do not let falling back to the cache bypass explicit evidence ownership.
  if (getRelationTargets(world, agentEid, HasToolResult).some(eid =>
    hasComponent(world, eid, ToolResult) && Number(ToolResult.timestamp[eid]) === timestamp &&
    ToolResult.toolId[eid] === LastToolResult.toolId[agentEid] &&
    String(ToolResult.command[eid] || "") === String(LastToolResult.command[agentEid] || "") &&
    Number(ToolResult.goalEid[eid]) !== 0 && Number.isFinite(ToolResult.goalEid[eid]) && Number(ToolResult.goalEid[eid]) !== goalEid)) return false;
  if (String(LastToolResult.toolId[agentEid] || "") !== toolId) return false;
  if (commandIncludes && commandIncludes.trim()) {
    const cmd = String(LastToolResult.command[agentEid] || "");
    if (!cmd.includes(commandIncludes)) return false;
  }
  return true;
}

function findMatchingToolEvidence(
  world: World,
  agentEid: number,
  goalEid: number,
  toolId: string,
  commandIncludes?: string
): number | undefined {
  const createdAt = Number(Goal.createdAt[goalEid] || 0);
  const targets = getRelationTargets(world as any, agentEid, HasToolResult as any)
    .filter((eid: number) => entityExists(world as any, eid))
    .filter((eid: number) => hasComponent(world as any, eid, ToolResult as any))
    .filter((eid: number) => !Number(ToolResult.goalEid[eid]) || Number(ToolResult.goalEid[eid]) === goalEid)
    .filter((eid: number) => {
      const ts = Number(ToolResult.timestamp[eid] || 0);
      return createdAt <= 0 ? ts > 0 : ts >= createdAt;
    })
    .filter((eid: number) => String(ToolResult.toolId[eid] || "") === toolId)
    .filter((eid: number) => {
      if (!commandIncludes || !commandIncludes.trim()) return true;
      const cmd = String(ToolResult.command[eid] || "");
      return cmd.includes(commandIncludes);
    })
    .sort((a: number, b: number) => (ToolResult.timestamp[b] || 0) - (ToolResult.timestamp[a] || 0));

  if (!targets.length) return undefined;

  // Prefer evidence explicitly associated with this goal (when available).
  const direct = targets.find((eid: number) => Number(ToolResult.goalEid[eid]) === Number(goalEid));
  return direct ?? targets[0];
}

function evaluateSuccessNode(world: World, agentEid: number, goalEid: number, node: GoalSuccessV1, depth = 0): { satisfied: boolean; reason?: string } {
  if (!node || typeof node !== "object" || depth > 32) return { satisfied: false };
  if (node.type === "productive_time") {
    if (typeof node.roomName !== "string" || !node.roomName.trim() || !Number.isFinite(node.atLeastMs)
      || node.atLeastMs <= 0 || node.atLeastMs > 24 * 3600_000) return { satisfied: false };
    return { satisfied: readProductiveGoalTime(world, agentEid, goalEid, node.roomName) >= node.atLeastMs, reason: "productive_time" };
  }
  if (node.type === "all_of") {
    const conds = Array.isArray(node.conditions) ? node.conditions : [];
    if (conds.length === 0) return { satisfied: false };
    for (const c of conds) {
      const res = evaluateSuccessNode(world, agentEid, goalEid, c, depth + 1);
      if (!res.satisfied) return { satisfied: false };
    }
    return { satisfied: true, reason: "all_of" };
  }
  if (node.type === "any_of") {
    const conds = Array.isArray(node.conditions) ? node.conditions : [];
    for (const c of conds) {
      const res = evaluateSuccessNode(world, agentEid, goalEid, c, depth + 1);
      if (res.satisfied) return { satisfied: true, reason: "any_of" };
    }
    return { satisfied: false };
  }

  // Leaf nodes reuse evaluateGoalSuccess by temporarily swapping successJson is too hacky; just inline:
  if (node.type === "in_room") {
    const roomEid = getRoomForEntity(world as any, agentEid);
    if (roomEid === undefined) return { satisfied: false };
    const currentName = String(Name.value[roomEid] || "");
    return { satisfied: roomNameMatches(currentName, node.roomName), reason: `in_room:${node.roomName}` };
  }
  if (node.type === "has_trait") {
    return { satisfied: actorHasTrait(world, agentEid, node.trait), reason: `has_trait:${node.trait}` };
  }
  if (node.type === "did_action_type") {
    return {
      satisfied: lastActionTypeMatches(world, agentEid, goalEid, node.actionType, node.targetName),
      reason: `did_action_type:${node.actionType}${node.targetName ? `:${node.targetName}` : ""}`,
    };
  }
  if (node.type === "did_interact") {
    return {
      satisfied: lastInteractMatches(world, agentEid, goalEid, node.targetName, node.affordance),
      reason: `did_interact:${node.affordance}:${node.targetName}`,
    };
  }
  if (node.type === "did_interact_affordance") {
    return {
      satisfied: lastInteractAffordanceMatches(world, agentEid, goalEid, node.affordance),
      reason: `did_interact_affordance:${node.affordance}`,
    };
  }
  if (node.type === "need_at_most") {
    const v = readNeedValue(world, agentEid, node.need);
    if (!Number.isFinite(v)) return { satisfied: false };
    return { satisfied: Number(v) <= Number(node.atMost), reason: `need_at_most:${node.need}:${node.atMost}` };
  }
  if (node.type === "need_at_least") {
    const v = readNeedValue(world, agentEid, node.need);
    if (!Number.isFinite(v)) return { satisfied: false };
    return { satisfied: Number(v) >= Number(node.atLeast), reason: `need_at_least:${node.need}:${node.atLeast}` };
  }
  if (node.type === "in_inventory") {
    return { satisfied: inventoryContainsNamedItem(world, agentEid, node.itemName), reason: `in_inventory:${node.itemName}` };
  }
  if (node.type === "entity_in_room") {
    if (typeof node.entityName !== "string" || !node.entityName.trim() || typeof node.roomName !== "string" || !node.roomName.trim()
      || (node.uncarried !== undefined && typeof node.uncarried !== "boolean")) return { satisfied: false };
    const matches = Array.from(query(world, [Name])).filter(eid => Name.value[eid] === node.entityName);
    const rooms = Array.from(query(world, [Room, Name])).filter(eid => Name.value[eid] === node.roomName);
    if (matches.length !== 1 || rooms.length !== 1 || getRoomForEntity(world, matches[0]) !== rooms[0]) return { satisfied: false };
    if (node.uncarried && Array.from(query(world, [Agent])).some(actor => isContainedBy(world, matches[0], actor))) return { satisfied: false };
    return { satisfied: true, reason: `entity_in_room:${node.entityName}:${node.roomName}` };
  }
  if (node.type === "entity_component_equals") {
    return entityComponentEquals(world, node)
      ? { satisfied: true, reason: `entity_component_equals:${node.entityName}:${node.component}.${node.field}` }
      : { satisfied: false };
  }
  if (node.type === "repo_file_contains") {
    return { satisfied: repoFileContains(world, node.path, node.includes), reason: `repo_file_contains:${node.path}` };
  }
  if (node.type === "kanban_card_in_column") {
    return {
      satisfied: kanbanCardInColumn(world, node.boardName, node.cardTitle, node.columnName),
      reason: `kanban_card_in_column:${node.cardTitle}:${node.columnName}`,
    };
  }
  if (node.type === "doc_contains") {
    return { satisfied: docContains(world, node.title, node.includes), reason: `doc_contains:${node.title}` };
  }
  if (node.type === "tool_exit_code_equals") {
    const evidence = findMatchingToolEvidence(world, agentEid, goalEid, node.toolId, node.commandIncludes);
    if (evidence !== undefined) {
      const exitCode = ToolResult.exitCode[evidence];
      return { satisfied: Number(exitCode) === Number(node.equals), reason: `tool_exit_code_equals:${node.toolId}` };
    }
    // Legacy fallback: allow older tests/contracts that only populate LastToolResult.
    if (!lastToolMatches(world, agentEid, goalEid, node.toolId, node.commandIncludes)) return { satisfied: false };
    const exitCode = LastToolResult.exitCode[agentEid];
    return { satisfied: Number(exitCode) === Number(node.equals), reason: `tool_exit_code_equals:${node.toolId}` };
  }
  if (node.type === "tool_stdout_includes") {
    const evidence = findMatchingToolEvidence(world, agentEid, goalEid, node.toolId, node.commandIncludes);
    if (evidence !== undefined) {
      const stdout = String(ToolResult.stdout[evidence] || "");
      return { satisfied: stdout.includes(node.includes), reason: `tool_stdout_includes:${node.toolId}` };
    }
    // Legacy fallback: allow older tests/contracts that only populate LastToolResult.
    if (!lastToolMatches(world, agentEid, goalEid, node.toolId, node.commandIncludes)) return { satisfied: false };
    const stdout = String(LastToolResult.stdout[agentEid] || "");
    return { satisfied: stdout.includes(node.includes), reason: `tool_stdout_includes:${node.toolId}` };
  }
  return { satisfied: false };
}

export function evaluateGoalSuccessContract(world: World, agentEid: number, goalEid: number): { satisfied: boolean; reason?: string } {
  const success = readGoalSuccessContract(goalEid);
  if (!success) return { satisfied: false };
  if (success.type === "custom") return { satisfied: false };
  return evaluateSuccessNode(world, agentEid, goalEid, success);
}

/** State-only preview for engine-supplied completion options; no event-history proof. */
export function evaluateCurrentStateCondition(world: World, agentEid: number, condition: GoalSuccessV1): boolean {
  const stateOnly = (node: GoalSuccessV1, depth = 0): boolean => !!node && typeof node === "object" && depth < 8 && (
    ["in_room", "in_inventory", "entity_in_room", "entity_component_equals", "need_at_most", "need_at_least", "has_trait"].includes(node.type)
    || ((node.type === "all_of" || node.type === "any_of") && Array.isArray(node.conditions) && node.conditions.length > 0 && node.conditions.length <= 12 && node.conditions.every(n => stateOnly(n, depth + 1))));
  return stateOnly(condition) && evaluateSuccessNode(world, agentEid, -1, condition).satisfied;
}

function findCompletedPlanForGoal(world: World, agentEid: number, goalEid: number): number | undefined {
  const planEids = getRelationTargets(world as any, agentEid, HasPlan as any) as number[];
  return planEids
    .filter(peid => entityExists(world as any, peid) && hasComponent(world as any, peid, Plan as any))
    .filter(peid => Number(Plan.goalEid[peid]) === Number(goalEid) && String(Plan.status[peid] || "") === "completed")
    .sort((a, b) => (Number(Plan.lastUpdated[b] || Plan.createdAt[b] || 0) - Number(Plan.lastUpdated[a] || Plan.createdAt[a] || 0)) || b - a)[0];
}

export function goalEvaluationSystem(world: World, ctx: Pick<SystemContext, "query" | "getRelationTargets" | "log" | "emit">): void {
  const agents = Array.from(ctx.query(world as any, [Agent, Name] as any)).filter((eid) => entityExists(world as any, eid));

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    const goalEids = ctx.getRelationTargets(world as any, agentEid, HasGoal as any);
    for (const goalEid of goalEids) {
      if (!entityExists(world as any, goalEid)) continue;
      if (!hasComponent(world as any, goalEid, Goal as any)) continue;
      if (String(Goal.status[goalEid] || "") !== "active") continue;

      const evaluated = evaluateGoalSuccessContract(world, agentEid, goalEid);
      if (!evaluated.satisfied) continue;

      const successfulActions = getSuccessfulGoalActions(world, agentEid, goalEid);
      Goal.status[goalEid] = "completed";
      Goal.progress[goalEid] = 100;
      // The world proved the objective, not every remaining step of its plan.
      // Retire those stale instructions without fabricating their execution.
      retireGoalPlans(world, goalEid, ctx.getRelationTargets(world, agentEid, HasPlan));
      if (hasComponent(world, goalEid, GoalLifecycle)) {
        GoalLifecycle.settledAt[goalEid] = Date.now();
        stampSimulationTime(world, goalEid, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goalEid]);
        GoalLifecycle.reason[goalEid] = evaluated.reason || "Verified by world state.";
      }

      // Learn the accepted episode, not whichever partial plan happened to be
      // first in insertion order. Replanning can spread a successful goal over
      // failed, completed and still-active Plan entities.
      let compiled = successfulActions.length > 0
        ? compileSuccessfulGoalActionsToProceduralMacro(world, agentEid, goalEid, successfulActions)
        : undefined;
      if (!compiled?.ok) {
        const planEid = findCompletedPlanForGoal(world, agentEid, goalEid);
        if (planEid !== undefined) compiled = compileCompletedPlanToProceduralMacro(world, agentEid, goalEid, planEid);
      }
      if (compiled?.ok) {
        ctx.log(`[Learning] ${Name.value[agentEid]} compiled verified actions into macro (post-eval): ${compiled.signature}`);
      }

      // Goal-aware BT compilation: compile the action sequence into a reusable skill
      try {
        onGoalCompleted(world, agentEid, goalEid);
      } catch { /* goal-learning not available */ }

      ctx.emit("goal_completed", {
        agent: Name.value[agentEid],
        goal: Goal.description[goalEid] || "",
        reason: evaluated.reason || "success",
      });
      ctx.log(`[GoalEvaluation] ${Name.value[agentEid]} completed: ${Goal.description[goalEid] || ""}`);
    }
    maintainGoalLifecycles(world, agentEid, (type, data) => ctx.emit(type, data));
  }
}
