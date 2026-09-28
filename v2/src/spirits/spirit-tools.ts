/**
 * Spirit Tools - Specialized toolsets for different spirit types
 *
 * Instead of giving spirits access to all 80+ GodAI tools, each spirit type
 * gets a focused set of 5-15 tools relevant to their domain. This:
 * - Reduces cognitive load on the LLM
 * - Prevents spirits from overstepping their authority
 * - Creates clear separation of concerns
 *
 * Tool sets:
 * - Artificer: System maintenance (inspect, repair, enable/disable)
 * - Architect: System creation (design, propose, create components)
 * - Watcher: Observation only (query, inspect, report)
 * - Narrator: Narrative control (inject events, modify tension)
 * - Manager: Coordination (send directives, modify moods)
 */

import { tool } from "ai";
import { getWorldRuntimeHealth } from "../runtime/fast-system-health";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { z } from "zod";
import type { World } from "../ecs/world";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import {
  listSystems,
  getSystem,
  activateSystem,
  deactivateSystem,
} from "../ecs/dynamic-systems";
import { bakeSystem } from "../god/system-baker";
import { queueStimulus } from "../cognition/cognition-system";
import { hasComponent, query } from "bitecs";
import { Agent, GodAgent, Mind, Name } from "../ecs/components";
import type { SpiritRegistry } from "./spirit-registry";
import { getActiveSpirits, reportToSuperior } from "./spirit-registry";
import type { SpiritState } from "./types";
import { captureSpiritCycleScope } from "./spirit-cycle-scope";
import { bindSpiritMessageDelivery, isCurrentSpiritMessage } from "./spirit-message-delivery";
import { readSimulationTime } from "../ecs/simulation-time";

// =============================================================================
// ARTIFICER TOOLS - System Maintenance
// =============================================================================

export function createArtificerTools(
  world: World,
  systemRegistry: SystemRegistry,
  options: { autoFixEnabled?: boolean; ignoreSystems?: string[];
    /** Trusted host binding, never model-authored routing or authority. */
    reporting?: { registry: SpiritRegistry; spirit: SpiritState } } = {}
) {
  const source = getCommittedEvents(world), signal = getSimulationTaskSignal();
  const reporting = options.reporting;
  const reportScope = reporting?.registry.world === world && reporting.registry.spirits.get(reporting.spirit.eid) === reporting.spirit
    ? captureSpiritCycleScope(world, reporting.spirit, reporting.registry) : undefined;
  const observedAtSimMs = readSimulationTime(world), expiresAtSimMs = observedAtSimMs + 120_000;
  const versions = new Map([...systemRegistry.systems].map(([name, system]) => [name,
    { system, code: system.code, fn: system.compiledFn }]));
  const allowed = (name: string) => {
    const now = getCommittedEvents(world), before = versions.get(name), system = systemRegistry.systems.get(name);
    if (!source.sourceId || now.stopped || now.sourceId !== source.sourceId || signal?.aborted)
      return { success: false, systemName: name, error: "Maintenance source/task expired" };
    if (reporting && (!reportScope?.sourceCurrent() || !getActiveSpirits(reporting.registry).includes(reporting.spirit)))
      return { success: false, systemName: name, error: "Maintenance spirit is inactive or replaced" };
    if (options.ignoreSystems?.includes(name)) return { success: false, systemName: name, error: "System excluded from maintenance" };
    if (before && (system !== before.system || system?.code !== before.code || system?.compiledFn !== before.fn))
      return { success: false, systemName: name, error: "Maintenance target version changed" };
    if (!before && system) return { success: false, systemName: name, error: "Target was not in this maintenance observation" };
  };
  return {
    listSystems: tool({
      description: "List all systems and their current status (active/inactive, last run, error count)",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(systemRegistry);
        return systems.map(s => ({
          name: s.name,
          active: s.active,
          frequency: s.frequency,
          lastRun: s.lastRun,
          hasCode: !!s.code,
          managed: getCodingDaemon(world)?.ownsSystem(s.name) ?? false,
          consecutiveErrors: s.consecutiveErrors ?? 0,
          totalErrors: s.totalErrors ?? 0,
          disabledReason: s.disabledReason,
          lastError: s.lastError,
          description: s.description?.slice(0, 100),
        }));
      },
    }),

    inspectSystem: tool({
      description: "Get detailed information about a specific system including its code, error history, and execution stats",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to inspect"),
      }),
      execute: async ({ systemName }) => {
        const system = getSystem(systemRegistry, systemName);
        if (!system) {
          return { error: `System not found: ${systemName}` };
        }
        const now = Date.now();
        const errorCount = systemRegistry.errorCounts.get(systemName) || 0;
        const recentErrors = systemRegistry.errors
          .filter(e => e.systemName === systemName && now - e.timestamp < 300000)
          .slice(-5);
        return {
          name: system.name,
          description: system.description,
          pseudocode: system.pseudocode,
          frequency: system.frequency,
          active: system.active,
          lastRun: system.lastRun,
          code: system.code?.slice(0, 500) + (system.code && system.code.length > 500 ? "..." : ""),
          errorLog: errorCount > 0 ? { totalErrors: errorCount, recentErrors } : null,
        };
      },
    }),

    getSystemCode: tool({
      description: "Get the full source code of a system for analysis",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
      }),
      execute: async ({ systemName }) => {
        const system = getSystem(systemRegistry, systemName);
        if (!system) {
          return { error: `System not found: ${systemName}` };
        }
        return {
          name: system.name,
          code: system.code || "(no code - builtin system)",
        };
      },
    }),

    repairSystem: tool({
      description: "Queue a managed, isolated repair. Queued/validated/activated do not mean recovered. Unmanaged systems require host migration.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to repair"),
        fixDescription: z.string().describe("What needs to be fixed (e.g., 'Add null checks for entity existence', 'Fix the loop that causes infinite iteration')"),
      }),
      execute: async ({ systemName, fixDescription }) => {
        const denied=allowed(systemName);if(denied)return denied;
        if(options.autoFixEnabled===false)return {success:false,systemName,error:"Automatic repair disabled"};
        try {
          const daemon=getCodingDaemon(world);
          if(!daemon || daemon.registry!==systemRegistry)throw Error("No matching managed coding daemon; unmanaged migration requires host approval");
          const job=daemon.requestRepair(systemName,`Repair ${systemName}: ${fixDescription}. Preserve the admitted contract and add a regression test.`);
          return {success:false,queued:true,systemName,jobId:job.id,stage:daemon.getRepairStatus(job.id)?.stage,
            message:"Repair queued; native execution must demonstrate recovery."};
        } catch(error) {return {success:false,systemName,error:String(error)};}
      },
    }),

    getRepairStatus: tool({
      description: "Inspect retained managed repair jobs and native recovery evidence; polling does not run or activate a candidate.",
      inputSchema: z.object({}),
      execute: async () => {
        const daemon=getCodingDaemon(world);
        return daemon?.registry===systemRegistry ? daemon.getStatus().jobs.filter(job=>job.repairOfJobId)
          .map(job=>daemon.getRepairStatus(job.id)) : [];
      },
    }),

    enableSystem: tool({
      description: "Activate a system so it starts running",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to enable"),
      }),
      execute: async ({ systemName }) => {
        const denied=allowed(systemName);if(denied)return denied;
        if(getCodingDaemon(world)?.ownsSystem(systemName))return {success:false,systemName,error:"Managed activation belongs to the coding daemon"};
        const success = activateSystem(systemRegistry, systemName);
        return {
          systemName,
          success,
          message: success
            ? `Enabled ${systemName}`
            : `Failed to enable ${systemName} (not found)`,
        };
      },
    }),

    disableSystem: tool({
      description: "Deactivate a system to stop it from running (useful for broken systems)",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to disable"),
      }),
      execute: async ({ systemName }) => {
        const denied=allowed(systemName);if(denied)return denied;
        const success = deactivateSystem(systemRegistry, systemName);
        return {
          systemName,
          success,
          message: success
            ? `Disabled ${systemName}`
            : `Failed to disable ${systemName} (not found)`,
        };
      },
    }),

    clearSystemErrors: tool({
      description: "Acknowledge retained error evidence. This does not erase history or prove recovery.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
      }),
      execute: async ({ systemName }) => {
        return { success: true, message: `Historical errors for ${systemName} are retained. Recovery requires successful native execution.` };
      },
    }),

    adjustSystemFrequency: tool({
      description: "Change how often a system runs (in milliseconds)",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
        newFrequency: z.number().describe("New frequency in milliseconds (e.g., 5000 for 5 seconds)"),
      }),
      execute: async ({ systemName, newFrequency }) => {
        const denied=allowed(systemName);if(denied)return denied;
        if(!Number.isFinite(newFrequency) || newFrequency<0 || getCodingDaemon(world)?.ownsSystem(systemName))
          return {success:false,systemName,error:"Invalid frequency or managed contract; requires explicit host change"};
        const system = getSystem(systemRegistry, systemName);
        if (!system) {
          return { error: `System not found: ${systemName}` };
        }
        const oldFrequency = system.frequency;
        system.frequency = newFrequency;
        return {
          success: true,
          message: `Changed ${systemName} frequency from ${oldFrequency}ms to ${newFrequency}ms`,
        };
      },
    }),

    reportToGodAI: tool({
      description: "Queue a source-bound maintenance report for the current GodAI. A queued report is not proof of review, repair or approval.",
      inputSchema: z.object({
        systemName: z.string().min(1).max(200).describe("Name of the problematic system"),
        issue: z.string().min(1).max(4000).describe("Description of the issue"),
        recommendation: z.string().min(1).max(4000).describe("Your recommended solution"),
        severity: z.enum(["low", "medium", "high", "critical"]).describe("How urgent is this?"),
      }).strict(),
      execute: async ({ systemName, issue, recommendation, severity }) => {
        const denied = allowed(systemName); if (denied) return denied;
        if (!versions.has(systemName)) return { success: false, systemName, error: "System was not in this maintenance observation" };
        if (!reporting || !reportScope || reportScope.destination === undefined
          || reportScope.destination !== reporting.registry.godAgentEid
          || reporting.registry.spirits.has(reportScope.destination) || !hasComponent(world, reportScope.destination, GodAgent))
          return { success: false, systemName, error: "God reporting is unavailable for this maintenance source" };
        // Invocation belongs to this cycle; accepted advice survives the next
        // inspection, but not changed code, producer/recipient, task or lifetime.
        const current = () => reportScope.sourceCurrent() && !allowed(systemName) && readSimulationTime(world) <= expiresAtSimMs;
        if (!reportScope.isCurrent() || !current())
          return { success: false, systemName, error: "Maintenance report source, target or observation expired" };
        const message = reportToSuperior(reporting.registry, reporting.spirit.eid, `System maintenance: ${systemName}`,
          `Issue: ${issue}\nRecommendation: ${recommendation}`,
          severity === "critical" ? "urgent" : severity === "medium" ? "normal" : severity,
          { systemName, issue, recommendation, severity, sourceId: source.sourceId, observedAtSimMs });
        if (!message) return { success: false, systemName, error: "God reporting is unavailable" };
        bindSpiritMessageDelivery(reporting.registry, message, current, { expiresAtSimMs });
        if (!isCurrentSpiritMessage(reporting.registry, message, reportScope.destination))
          return { success: false, systemName, error: "Maintenance report delivery expired" };
        return {
          success: true, status: "queued", systemName, messageId: message.id,
          message: `Report queued for GodAI: ${systemName} (${severity}); not yet reviewed or repaired.`,
        };
      },
    }),
  };
}

// =============================================================================
// ARCHITECT TOOLS - System Creation & Design
// =============================================================================

export function createArchitectTools(
  world: World,
  systemRegistry: SystemRegistry
) {
  return {
    listSystems: tool({
      description: "List all existing systems to understand what already exists",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(systemRegistry);
        return systems.map(s => ({
          name: s.name,
          description: s.description?.slice(0, 100),
          active: s.active,
        }));
      },
    }),

    proposeSystem: tool({
      description: "Propose a new system design. This creates a formal proposal for GodAI to review.",
      inputSchema: z.object({
        name: z.string().describe("Name for the new system (e.g., 'TensionDecay')"),
        description: z.string().describe("What the system does"),
        logic: z.string().describe("Pseudocode or description of the system's logic"),
        frequency: z.number().describe("How often it should run (ms)"),
        rationale: z.string().describe("Why this system is needed"),
      }),
      execute: async ({ name, description, logic, frequency, rationale }) => {
        // Creates a proposal - doesn't actually build the system
        return {
          proposalId: `proposal_${Date.now()}`,
          type: "system",
          name,
          description,
          logic,
          frequency,
          rationale,
          status: "pending_approval",
          message: "Proposal submitted. Awaiting GodAI approval.",
        };
      },
    }),

    bakeSystem: tool({
      description: "Design and build a new system using AI. Only use after proposal is approved. Describe what the system should do including its name and frequency.",
      inputSchema: z.object({
        description: z.string().describe("Full natural language description including system name, what it does, and how often it should run"),
      }),
      execute: async ({ description }) => {
        const daemon=getCodingDaemon(world);
        if(daemon) return {success:true,queued:true,job:daemon.enqueue({source:"The Weaver",instruction:description}),message:"Queued, not yet active"};
        const result = await bakeSystem(
          description,
          world,
          systemRegistry
        );
        return {
          success: result.success,
          error: result.error,
          systemName: result.system?.name,
          message: result.success
            ? `Created system: ${result.system?.name}`
            : `Failed to create: ${result.error}`,
        };
      },
    }),

    inspectSystemDesign: tool({
      description: "Look at an existing system's design to learn from it or identify improvements",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to inspect"),
      }),
      execute: async ({ systemName }) => {
        const system = getSystem(systemRegistry, systemName);
        if (!system) {
          return { error: `System not found: ${systemName}` };
        }
        return {
          name: system.name,
          description: system.description,
          pseudocode: system.pseudocode,
          frequency: system.frequency,
          codePreview: system.code?.slice(0, 300),
        };
      },
    }),

    proposeComponent: tool({
      description: "Propose a new component type for entities",
      inputSchema: z.object({
        name: z.string().describe("Component name (e.g., 'Reputation')"),
        properties: z.record(z.string()).describe("Property names and types (e.g., {value: 'number', faction: 'string'})"),
        rationale: z.string().describe("Why this component is needed"),
      }),
      execute: async ({ name, properties, rationale }) => {
        return {
          proposalId: `proposal_${Date.now()}`,
          type: "component",
          name,
          properties,
          rationale,
          status: "pending_approval",
          message: "Component proposal submitted. Awaiting GodAI approval.",
        };
      },
    }),
  };
}

// =============================================================================
// WATCHER TOOLS - Observation Only (Read-Only)
// =============================================================================

export function createWatcherTools(
  world: World,
  systemRegistry: SystemRegistry
) {
  return {
    queryAgents: tool({
      description: "Get information about agents in the simulation",
      inputSchema: z.object({
        limit: z.number().optional().describe("Max agents to return (default 10)"),
      }),
      execute: async ({ limit = 10 }) => {
        const agents = Array.from(query(world, [Agent, Mind, Name])).slice(0, limit);
        return agents.map(eid => ({
          name: Name.value[eid],
          arousal: Mind.arousal[eid],
          
          focus: Mind.focus[eid],
        }));
      },
    }),

    getSystemHealth: tool({
      description: "Inspect registered ECS system status and separate native fast-loop failure telemetry. A returned callback is not proof that its child systems succeeded.",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(systemRegistry);
        return {
          runtimeHealth: getWorldRuntimeHealth(world),
          total: systems.length,
          active: systems.filter(s => s.active).length,
          inactive: systems.filter(s => !s.active).length,
          systems: systems.map(s => ({
            name: s.name,
            active: s.active,
            lastRun: s.lastRun,
          })),
        };
      },
    }),

    inspectSystem: tool({
      description: "Get information about a specific system",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
      }),
      execute: async ({ systemName }) => {
        const system = getSystem(systemRegistry, systemName);
        if (!system) {
          return { error: `System not found: ${systemName}` };
        }
        return {
          name: system.name,
          description: system.description,
          active: system.active,
          frequency: system.frequency,
          lastRun: system.lastRun,
        };
      },
    }),

    reportObservation: tool({
      description: "Report an observation to your superior spirit",
      inputSchema: z.object({
        observation: z.string().describe("What you observed"),
        severity: z.enum(["low", "medium", "high"]).describe("How important is this?"),
        recommendation: z.string().optional().describe("Optional recommendation"),
      }),
      execute: async ({ observation, severity, recommendation }) => {
        console.log(`[Watcher Report] ${severity}: ${observation}`);
        if (recommendation) console.log(`  Recommendation: ${recommendation}`);
        return { success: true, message: "Observation reported" };
      },
    }),
  };
}

// =============================================================================
// MANAGER TOOLS - Coordination & Intervention
// =============================================================================

export function createManagerTools(
  world: World,
  systemRegistry: SystemRegistry
) {
  return {
    queryAgents: tool({
      description: "Get information about agents",
      inputSchema: z.object({}),
      execute: async () => {
        const agents = Array.from(query(world, [Agent, Mind, Name]));
        return agents.map(eid => ({
          eid,
          name: Name.value[eid],
          arousal: Mind.arousal[eid],
          focus: Mind.focus[eid],
        }));
      },
    }),

    modifyAgentMood: tool({
      description: "Adjust an agent's arousal/mood level",
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent"),
        arousalDelta: z.number().describe("Change in arousal (-1 to 1)"),
        reason: z.string().describe("Why you're making this change"),
      }),
      execute: async ({ agentName, arousalDelta, reason }) => {
        const agents = Array.from(query(world, [Agent, Mind, Name]));
        const agent = agents.find(eid => Name.value[eid] === agentName);
        if (!agent) {
          return { error: `Agent not found: ${agentName}` };
        }
        const oldArousal = Mind.arousal[agent];
        Mind.arousal[agent] = Math.max(0, Math.min(1, oldArousal + arousalDelta));
        return {
          success: true,
          agent: agentName,
          oldArousal,
          newArousal: Mind.arousal[agent],
          reason,
        };
      },
    }),

    injectStimulus: tool({
      description: "Send a stimulus to an agent (intuition, environmental perception)",
      inputSchema: z.object({
        agentName: z.string().describe("Target agent name"),
        content: z.string().describe("The stimulus content"),
        type: z.enum(["intuition", "environmental", "social"]).describe("Type of stimulus"),
        intensity: z.number().optional().describe("Intensity 0-1 (default 0.5)"),
      }),
      execute: async ({ agentName, content, type, intensity = 0.5 }) => {
        const agents = Array.from(query(world, [Agent, Name]));
        const agent = agents.find(eid => Name.value[eid] === agentName);
        if (!agent) {
          return { error: `Agent not found: ${agentName}` };
        }
        const accepted = queueStimulus(world, {
          targetEid: agent,
          type: type === "intuition" ? "cognitive" : type,
          modality: type === "intuition" ? "cognitive" : "auditory",
          content,
          source: "spirit_intervention",
          intensity,
        });
        return {
          success: accepted,
          message: accepted ? `Queued ${type} stimulus for ${agentName}: "${content}"` : `Stimulus for ${agentName} was rejected; no input was delivered.`,
        };
      },
    }),

    sendDirective: tool({
      description: "Send a directive to a subordinate spirit",
      inputSchema: z.object({
        spiritName: z.string().describe("Name of the subordinate spirit"),
        directive: z.string().describe("What you want them to do"),
        priority: z.enum(["low", "normal", "high"]).describe("Priority level"),
      }),
      execute: async ({ spiritName, directive, priority }) => {
        console.log(`[Manager Directive] To ${spiritName} (${priority}): ${directive}`);
        return {
          success: true,
          message: `Directive sent to ${spiritName}`,
        };
      },
    }),
  };
}

// =============================================================================
// TOOL SET REGISTRY
// =============================================================================

export type SpiritToolSet = ReturnType<typeof createArtificerTools>
  | ReturnType<typeof createArchitectTools>
  | ReturnType<typeof createWatcherTools>
  | ReturnType<typeof createManagerTools>;

export function getToolsForSpiritType(
  spiritType: string,
  world: World,
  systemRegistry: SystemRegistry
): SpiritToolSet | null {
  switch (spiritType) {
    case "artificer":
      return createArtificerTools(world, systemRegistry);
    case "architect":
      return createArchitectTools(world, systemRegistry);
    case "watcher":
      return createWatcherTools(world, systemRegistry);
    case "manager":
      return createManagerTools(world, systemRegistry);
    case "coordinator":
      return createManagerTools(world, systemRegistry); // Coordinators use manager tools
    default:
      return null;
  }
}

/**
 * Get tool descriptions for a spirit's system prompt
 */
export function getToolDescriptions(tools: SpiritToolSet): string {
  const lines: string[] = ["Available tools:"];
  for (const [name, t] of Object.entries(tools)) {
    const toolDef = t as any;
    lines.push(`- ${name}: ${toolDef.description || "No description"}`);
  }
  return lines.join("\n");
}
