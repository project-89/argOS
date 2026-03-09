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
import { z } from "zod";
import type { World } from "../ecs/world";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import {
  listSystems,
  getSystem,
  activateSystem,
  deactivateSystem,
} from "../ecs/dynamic-systems";
import { modifySystem, bakeSystem } from "../god/system-baker";
import { queueStimulus } from "../cognition/cognition-system";
import { query } from "bitecs";
import { Agent, Mind, Name } from "../ecs/components";
import type { SpiritRegistry } from "./spirit-registry";

// =============================================================================
// ARTIFICER TOOLS - System Maintenance
// =============================================================================

export function createArtificerTools(
  world: World,
  systemRegistry: SystemRegistry
) {
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
      description: "Use AI to repair/modify a system's code. Describe what needs to be fixed.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to repair"),
        fixDescription: z.string().describe("What needs to be fixed (e.g., 'Add null checks for entity existence', 'Fix the loop that causes infinite iteration')"),
      }),
      execute: async ({ systemName, fixDescription }) => {
        const result = await modifySystem(
          systemName,
          fixDescription,
          world,
          systemRegistry
        );
        if (result.success) {
          systemRegistry.errorCounts.delete(systemName);
          systemRegistry.errors = systemRegistry.errors.filter(e => e.systemName !== systemName);
        }
        return {
          success: result.success,
          error: result.error,
          message: result.success
            ? `Successfully repaired ${systemName}`
            : `Failed to repair: ${result.error}`,
        };
      },
    }),

    enableSystem: tool({
      description: "Activate a system so it starts running",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to enable"),
      }),
      execute: async ({ systemName }) => {
        const success = activateSystem(systemRegistry, systemName);
        return {
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
        const success = deactivateSystem(systemRegistry, systemName);
        return {
          success,
          message: success
            ? `Disabled ${systemName}`
            : `Failed to disable ${systemName} (not found)`,
        };
      },
    }),

    clearSystemErrors: tool({
      description: "Clear the error log for a system (use after fixing issues)",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
      }),
      execute: async ({ systemName }) => {
        systemRegistry.errorCounts.delete(systemName);
        systemRegistry.errors = systemRegistry.errors.filter(e => e.systemName !== systemName);
        return { success: true, message: `Cleared error log for ${systemName}` };
      },
    }),

    adjustSystemFrequency: tool({
      description: "Change how often a system runs (in milliseconds)",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system"),
        newFrequency: z.number().describe("New frequency in milliseconds (e.g., 5000 for 5 seconds)"),
      }),
      execute: async ({ systemName, newFrequency }) => {
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
      description: "Send a report to GodAI about a system issue that requires architectural changes",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the problematic system"),
        issue: z.string().describe("Description of the issue"),
        recommendation: z.string().describe("Your recommended solution"),
        severity: z.enum(["low", "medium", "high", "critical"]).describe("How urgent is this?"),
      }),
      execute: async ({ systemName, issue, recommendation, severity }) => {
        // This would integrate with the spirit reporting system
        console.log(`[Artificer Report] ${severity.toUpperCase()}: ${systemName}`);
        console.log(`  Issue: ${issue}`);
        console.log(`  Recommendation: ${recommendation}`);
        return {
          success: true,
          message: `Report submitted to GodAI: ${systemName} (${severity})`,
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
      description: "Get health status of all systems",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(systemRegistry);
        return {
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
        queueStimulus({
          targetEid: agent,
          type: type === "intuition" ? "cognitive" : type,
          modality: type === "intuition" ? "cognitive" : "auditory",
          content,
          source: "spirit_intervention",
          intensity,
        });
        return {
          success: true,
          message: `Sent ${type} stimulus to ${agentName}: "${content}"`,
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
