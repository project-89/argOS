import type { World } from "../ecs/world";
import type { SystemContext, SystemDefinition } from "../ecs/dynamic-systems";
import { addComponent, addEntity, entityExists, hasComponent, query, removeComponent, getRelationTargets } from "bitecs";
import { Agent, Goal, LastToolResult, Name, PendingToolJob, Plan, ToolResult } from "../ecs/components";
import { HasGoal, HasToolResult } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { drainCompletedOfficeJobs } from "../office-tools/async-jobs";
import { queueStimulus } from "../cognition/stimulus-queue";
import { advanceAgentPlan } from "../cognition/cognition-system";
import { failPlan, getNextPlannedAction, getPlanForGoal } from "../cognition/planning-system";
import { onProcedureActionResult, upsertProceduralSkillFromInteraction } from "../cognition/procedural-skills";

function getTopActiveGoalEid(world: World, agentEid: number): number | undefined {
  const goals = (getRelationTargets(world as any, agentEid, HasGoal as any) as number[])
    .filter((eid) => entityExists(world as any, eid))
    .filter((eid) => hasComponent(world as any, eid, Goal as any))
    .filter((eid) => String(Goal.status[eid] || "") === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goals[0];
  return typeof top === "number" ? top : undefined;
}

function toolIdToAffordance(toolId: string): string {
  const id = String(toolId || "");
  if (id === "terminal.run") return "run_command";
  if (id === "gemini.cli") return "gemini_cli";
  if (id === "nano_banana.generate_image") return "generate_image";
  if (id === "nano_banana.edit_image") return "edit_image";
  if (id === "workspace.git_apply_from_last_gemini") return "git_apply_from_last_gemini";
  if (id === "vision.describe_image") return "describe_image";
  return id;
}

function hasWorkspaceWriteEvidenceForGoal(world: World, actorEid: number, goalEid: number): boolean {
  if (!Number.isFinite(goalEid) || goalEid < 0) return false;
  const toolEids = getRelationTargets(world as any, actorEid, HasToolResult as any) as number[];
  for (const eid of toolEids) {
    if (!hasComponent(world as any, eid, ToolResult as any)) continue;
    if (Number(ToolResult.goalEid[eid] ?? -1) !== Number(goalEid)) continue;
    if (!ToolResult.ok[eid]) continue;
    const toolId = String(ToolResult.toolId[eid] || "");
    if (!toolId.startsWith("workspace.")) continue;
    if (toolId === "workspace.read_file") continue;
    return true;
  }
  return false;
}

function shouldAdvanceToolPlanStep(nextStep: any, resultOk: boolean): boolean {
  if (resultOk) return true;
  if (nextStep && (nextStep.allowFailure === true || nextStep.completeOnToolResult === true)) return true;

  // Heuristic fallback: allow advancing "diagnostic" test runs that are expected to fail,
  // but do not advance explicit verification steps ("confirm"/"verify"/"passes").
  const desc = String(nextStep?.description || "").toLowerCase();
  const content = String(nextStep?.content || "").toLowerCase();
  const looksLikeTest =
    content.includes("npm test") ||
    content.includes("node test") ||
    content.includes("node ci.cjs") ||
    content.includes("pytest") ||
    content.includes("pnpm test") ||
    content.includes("yarn test");

  if (!looksLikeTest) return false;
  const isVerification = desc.includes("verify") || desc.includes("confirm") || desc.includes("passes") || desc.includes("pass");
  if (isVerification) return false;
  const isDiagnostic = desc.includes("observe") || desc.includes("reproduce") || desc.includes("failing") || desc.includes("fail");
  return isDiagnostic;
}

const ASYNC_PLAN_STEP_FAILURE_WINDOW_MS = 30_000;
const MAX_ASYNC_PLAN_STEP_FAILURES_BEFORE_REPLAN = 2;
const recentAsyncPlanStepFailures = new Map<number, { signature: string; count: number; lastAtMs: number }>();

export function createOfficeToolJobSystem(): SystemDefinition {
  return {
    name: "OfficeToolJobSystem",
    description: "Completes async office tool jobs (terminal/CLI) and records tool evidence",
    frequency: 250,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, _ctx: SystemContext) => {
      const completed = drainCompletedOfficeJobs();
      if (!completed.length) return;

      for (const job of completed) {
        const actorEid = job.actorEid;
        if (!entityExists(world as any, actorEid)) continue;

        const result = job.result;
        if (!result) continue;

        // Prefer the original affordance args (stored on the actor as PendingToolJob.command) for contracts/learning.
        // For some async tools we spawn helper processes (e.g. node -e), so job.command may not include the user intent.
        let commandForEvidence = String(job.command || "");
        if (hasComponent(world as any, actorEid, PendingToolJob as any)) {
          const pendingId = String(PendingToolJob.jobId[actorEid] || "");
          if (pendingId === job.jobId) {
            const pendingCmd = String(PendingToolJob.command[actorEid] || "");
            if (pendingCmd.trim()) commandForEvidence = pendingCmd;
          }
        }

        if (!hasComponent(world as any, actorEid, LastToolResult as any)) addComponent(world as any, actorEid, LastToolResult as any);
        LastToolResult.toolId[actorEid] = String(job.toolId || "");
        LastToolResult.command[actorEid] = commandForEvidence;
        LastToolResult.ok[actorEid] = !!result.ok;
        LastToolResult.exitCode[actorEid] = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : (result.ok ? 0 : 1);
        LastToolResult.summary[actorEid] = String(result.summary || "");
        LastToolResult.stdout[actorEid] = String(result.stdout || "");
        LastToolResult.stderr[actorEid] = String(result.stderr || "");
        LastToolResult.timestamp[actorEid] = Date.now();

        // Append-only tool evidence entity for multi-step goal contracts.
        const toolEid = addEntity(world as any);
        addComponent(world as any, toolEid, ToolResult as any);
        const goalEid = getTopActiveGoalEid(world, actorEid);
        ToolResult.toolId[toolEid] = String(job.toolId || "");
        ToolResult.command[toolEid] = commandForEvidence;
        ToolResult.ok[toolEid] = !!result.ok;
        ToolResult.exitCode[toolEid] = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : (result.ok ? 0 : 1);
        ToolResult.summary[toolEid] = String(result.summary || "");
        ToolResult.stdout[toolEid] = String(result.stdout || "");
        ToolResult.stderr[toolEid] = String(result.stderr || "");
        ToolResult.timestamp[toolEid] = Date.now();
        ToolResult.goalEid[toolEid] = typeof goalEid === "number" ? goalEid : -1;
        ToolResult.deviceEid[toolEid] = Number.isFinite(Number(job.deviceEid)) ? Number(job.deviceEid) : -1;
        addComponent(world as any, actorEid, HasToolResult(toolEid) as any);

        // Clear pending marker if it matches.
        if (hasComponent(world as any, actorEid, PendingToolJob as any)) {
          const pendingId = String(PendingToolJob.jobId[actorEid] || "");
          if (pendingId === job.jobId) {
            removeComponent(world as any, actorEid, PendingToolJob as any);
          }
        }

        // Deliver a tool_result stimulus to the actor (like synchronous run_tool did).
        const stdout = String(result.stdout || "");
        const stderr = String(result.stderr || "");
        const maxLen = 1600;
        const clip = (s: string) => (s.length > maxLen ? s.slice(0, maxLen) + "\n…(truncated)" : s);
        const parts: string[] = [];
        parts.push(`[Tool:${job.toolId}] ${result.summary}`);
        if (stdout.trim()) parts.push(`stdout:\n${clip(stdout)}`);
        if (stderr.trim()) parts.push(`stderr:\n${clip(stderr)}`);
        queueStimulus({
          targetEid: actorEid,
          type: "tool_result",
          modality: "cognitive",
          content: parts.join("\n\n"),
          source: Name.value[job.deviceEid] || job.toolId,
        });


        // If a tool produced an image artifact in this room, broadcast it as a VISUAL stimulus.
        // Other agents can then decide to inspect it via describe_image (vision tool) for grounded critique.
        const artifacts = Array.isArray((result as any).artifacts) ? ((result as any).artifacts as any[]) : [];
        const imageUris = artifacts
          .filter((a) => a && a.kind === "image" && typeof a.uri === "string")
          .map((a) => String(a.uri || ""))
          .filter(Boolean);
        if (imageUris.length) {
          const roomEid = getRoomForEntity(world as any, actorEid);
          if (typeof roomEid === "number") {
            const actorName = String(Name.value[actorEid] || "Someone");
            const relPaths = imageUris
              .map((u) => (u.startsWith("workspace://") ? u.slice("workspace://".length) : u))
              .filter(Boolean)
              .slice(0, 4);

            if (relPaths.length) {
              const deviceName = String(Name.value[job.deviceEid] || "device");
              const content =
                `${actorName} produced a new image asset on ${deviceName}: ${relPaths.join(", ")}. ` +
                `Use describe_image {"path":"<path>"} to inspect/critique it.`;

              for (const recipientEid of Array.from(query(world as any, [Agent] as any))) {
                if (!entityExists(world as any, recipientEid)) continue;
                if (!Agent.active[recipientEid]) continue;
                if (getRoomForEntity(world as any, recipientEid) !== roomEid) continue;

                queueStimulus({
                  targetEid: recipientEid,
                  type: "image_asset",
                  modality: "visual",
                  content,
                  source: actorName,
                });
              }
            }
          }
        }

        // Learn procedural skills from the *actual* tool outcome (exitCode/ok),
        // not from the mere fact that a tool job was started.
        const affordance = toolIdToAffordance(job.toolId);
        const targetName = String(Name.value[job.deviceEid] || job.toolId || "").trim();
        const args = commandForEvidence;
        if (affordance && targetName) {
          upsertProceduralSkillFromInteraction(world as any, actorEid, {
            affordance,
            args,
            toolId: String(job.toolId || ""),
            targetName,
            success: !!result.ok,
          });
          onProcedureActionResult(
            world as any,
            actorEid,
            { type: "interact", target: targetName, content: `${affordance}${args ? ` ${args}` : ""}` },
            { success: !!result.ok }
          );
        }

        // If the agent is waiting on a tool step, advance it automatically when the tool finishes successfully.
        const next = getNextPlannedAction(world as any, actorEid);
        if (next && String(next.actionType || "") === "interact") {
          const expected = toolIdToAffordance(job.toolId);
          const content = String(next.content || "").trim();
          const stepAff = content.split(/\s+/)[0] || "";
          const isTicketGoal =
            typeof goalEid === "number" &&
            goalEid >= 0 &&
            hasComponent(world as any, goalEid, Goal as any) &&
            /complete ticket\s*:/i.test(String(Goal.description[goalEid] || ""));
          // If a ticket's *diagnostic* CI run fails, still advance so the agent can move on to fixes.
          // Never advance explicit verification steps ("verify"/"confirm"/"passes"), even if no write evidence is detected.
          const stepDesc = String(next.description || "").toLowerCase();
          const isVerification = stepDesc.includes("verify") || stepDesc.includes("confirm") || stepDesc.includes("passes") || stepDesc.includes("pass");
          const isDiagnostic = stepDesc.includes("observe") || stepDesc.includes("reproduce") || stepDesc.includes("failing") || stepDesc.includes("fail");
          const allowInitialFailAdvance =
            !result.ok &&
            job.toolId === "terminal.run" &&
            stepAff === "run_command" &&
            isTicketGoal &&
            isDiagnostic &&
            !isVerification &&
            !hasWorkspaceWriteEvidenceForGoal(world, actorEid, goalEid as any);

          const matchesStep = stepAff === expected;
          const shouldAdvance = shouldAdvanceToolPlanStep(next, !!result.ok) || allowInitialFailAdvance;
          if (matchesStep && shouldAdvance) {
            advanceAgentPlan(world as any, actorEid);
            const name = String(Name.value[actorEid] || "");
            if (name) {
              console.log(`📋 ${name} completed plan step: ${String(next.description || "").trim()}`);
            }
          } else if (matchesStep && !result.ok) {
            // Async tool failures (e.g. terminal.run CI failures) don't pass through executeActions(),
            // so we must mark the plan step as failed here or agents will spam retries forever.
            const now = Date.now();
            const signature = `${next.actionType}|${String(next.target || "")}|${String(next.content || "")}`;
            const prev = recentAsyncPlanStepFailures.get(actorEid);
            const within = prev && prev.signature === signature && now - prev.lastAtMs < ASYNC_PLAN_STEP_FAILURE_WINDOW_MS;
            const count = within ? prev!.count + 1 : 1;
            recentAsyncPlanStepFailures.set(actorEid, { signature, count, lastAtMs: now });

            if (count >= MAX_ASYNC_PLAN_STEP_FAILURES_BEFORE_REPLAN && typeof goalEid === "number" && goalEid >= 0) {
              const planEid = getPlanForGoal(world as any, actorEid, goalEid);
              if (typeof planEid === "number") {
                failPlan(planEid, `Repeated async plan-step failure: ${String(next.description || "").trim()}`);
                // This replanning loop is deterministic for many goals (e.g. CLI ticket skeletons),
                // so allow immediate retry rather than waiting for the generic 15s backoff.
                Plan.lastUpdated[planEid] = 0;
                queueStimulus({
                  targetEid: actorEid,
                  type: "planning",
                  modality: "cognitive",
                  content: `Plan step failed repeatedly ("${String(next.description || "").trim()}"). Replanning.`,
                  source: "planning",
                });
              }
              recentAsyncPlanStepFailures.delete(actorEid);
            }
          }
        }
      }
    },
  };
}
