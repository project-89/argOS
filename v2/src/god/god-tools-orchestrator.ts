/**
 * GodAI Orchestrator Tools
 *
 * A reduced, focused toolset for GodAI's orchestration role.
 * GodAI should NOT handle low-level operations - those are delegated to spirits.
 *
 * Tool Distribution:
 *
 * GodAI (Orchestrator): ~25 tools
 *   - Spirit management & coordination
 *   - Narrative control & story direction
 *   - High-level world oversight
 *   - Strategic interventions
 *   - Simulation lifecycle
 *
 * Artificer Spirit: System maintenance & repair
 * Architect Spirit: System design & creation
 * Watcher Spirit: Monitoring & alerting
 * Manager Spirit: Agent mood & behavior
 * Visual Spirit: Rendering & sprites
 * Object Designer Spirit: World object definitions
 */

import { tool } from "ai";
import { z } from "zod/v3";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { InterventionRegistry } from "../ecs/interventions";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import type { SpiritState } from "../spirits/types";
import { spiritRouter, spiritDirective, getMessagesForGodAI } from "../spirits/spirit-messaging";
import { query } from "bitecs";
import { Agent, Name, Description, Mind } from "../ecs/components";

// =============================================================================
// TOOL CREATION
// =============================================================================

export interface OrchestratorToolsConfig {
  world: World;
  systemRegistry: SystemRegistry;
  interventionRegistry: InterventionRegistry;
  spiritRegistry: SpiritRegistry;
  narrativeState: {
    tension: number;
    goals: string[];
    currentBeat?: string;
  };
  simulationId?: string;
}

/**
 * Create the reduced GodAI orchestrator toolset (~25 tools)
 */
export function createOrchestratorTools(config: OrchestratorToolsConfig) {
  const { world, spiritRegistry, interventionRegistry, narrativeState } = config;

  return {
    // =========================================================================
    // SPIRIT MANAGEMENT (Core GodAI responsibility)
    // =========================================================================

    getSpiritHierarchy: tool({
      description: "Get the complete spirit hierarchy showing all spirits, their types, domains, and reporting structure",
      inputSchema: z.object({}),
      execute: async () => {
        const hierarchy: Record<string, any> = {
          archangels: [],
          angels: [],
          daemons: [],
        };

        for (const spirit of spiritRegistry.spirits.values()) {
          const info = {
            eid: spirit.eid,
            name: spirit.definition.name,
            domain: spirit.definition.domain,
            rank: spirit.definition.rank,
            superiorEid: spirit.superiorEid,
          };

          switch (spirit.definition.rank) {
            case "archangel":
              hierarchy.archangels.push(info);
              break;
            case "angel":
              hierarchy.angels.push(info);
              break;
            case "daemon":
              hierarchy.daemons.push(info);
              break;
          }
        }

        return {
          success: true,
          spiritCount: spiritRegistry.spirits.size,
          hierarchy,
        };
      },
    }),

    getSpiritReports: tool({
      description: "Get all pending reports from spirits awaiting GodAI's attention",
      inputSchema: z.object({
        clearAfterRead: z.boolean().optional().describe("Clear messages after reading (default: true)"),
      }),
      execute: async ({ clearAfterRead = true }) => {
        const messages = clearAfterRead
          ? spiritRouter.popGodAIMessages()
          : spiritRouter.getGodAIMessages();

        const reports = messages.filter(m => m.type === "report");
        const alerts = messages.filter(m => m.type === "alert");
        const directives = messages.filter(m => m.type === "directive");

        return {
          success: true,
          totalMessages: messages.length,
          reports: reports.map(r => ({
            from: r.fromName,
            subject: r.subject,
            content: r.content,
            priority: r.priority,
            timestamp: r.timestamp,
            data: r.data,
          })),
          alerts: alerts.map(a => ({
            from: a.fromName,
            subject: a.subject,
            content: a.content,
            timestamp: a.timestamp,
          })),
          pendingDirectives: directives.length,
        };
      },
    }),

    sendDirectiveToSpirit: tool({
      description: "Send a directive to a specific spirit with instructions",
      inputSchema: z.object({
        spiritName: z.string().describe("Name of the target spirit"),
        subject: z.string().describe("Subject of the directive"),
        instruction: z.string().describe("The instruction or command"),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        data: z.any().optional().describe("Optional structured data"),
      }),
      execute: async ({ spiritName, subject, instruction, priority = "normal", data }) => {
        // Find spirit by name
        let targetSpirit: SpiritState | undefined;
        for (const spirit of spiritRegistry.spirits.values()) {
          if (spirit.definition.name.toLowerCase() === spiritName.toLowerCase()) {
            targetSpirit = spirit;
            break;
          }
        }

        if (!targetSpirit) {
          return { success: false, error: `Spirit '${spiritName}' not found` };
        }

        const message = spiritDirective(
          "godai",
          targetSpirit,
          subject,
          instruction,
          data
        );

        return {
          success: true,
          messageId: message.id,
          sentTo: spiritName,
          subject,
        };
      },
    }),

    getSpiritStatus: tool({
      description: "Get detailed status of a specific spirit including recent observations and actions",
      inputSchema: z.object({
        spiritName: z.string().describe("Name of the spirit to inspect"),
      }),
      execute: async ({ spiritName }) => {
        let spirit: SpiritState | undefined;
        for (const s of spiritRegistry.spirits.values()) {
          if (s.definition.name.toLowerCase() === spiritName.toLowerCase()) {
            spirit = s;
            break;
          }
        }

        if (!spirit) {
          return { success: false, error: `Spirit '${spiritName}' not found` };
        }

        return {
          success: true,
          spirit: {
            name: spirit.definition.name,
            rank: spirit.definition.rank,
            domain: spirit.definition.domain,
            superiorEid: spirit.superiorEid,
            lastObservation: spirit.lastObservationTime,
            recentObservations: spirit.observations.slice(-5),
            pendingMessages: spiritRouter.hasPendingMessages(spirit.eid),
          },
        };
      },
    }),

    broadcastToSpirits: tool({
      description: "Broadcast a message to all spirits or spirits in a specific domain",
      inputSchema: z.object({
        subject: z.string(),
        content: z.string(),
        domain: z.string().optional().describe("Optional: limit to spirits in this domain"),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      }),
      execute: async ({ subject, content, domain, priority = "normal" }) => {
        let recipients = 0;

        for (const spirit of spiritRegistry.spirits.values()) {
          if (domain && spirit.definition.domain !== domain) continue;

          spiritDirective("godai", spirit, subject, content);
          recipients++;
        }

        return {
          success: true,
          recipientCount: recipients,
          domain: domain || "all",
        };
      },
    }),

    // =========================================================================
    // NARRATIVE CONTROL (Core GodAI responsibility)
    // =========================================================================

    getNarrativeTension: tool({
      description: "Get the current narrative tension level and factors affecting it",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          success: true,
          tension: narrativeState.tension,
          tensionLevel: narrativeState.tension < 0.3 ? "low" :
                       narrativeState.tension < 0.6 ? "moderate" :
                       narrativeState.tension < 0.8 ? "high" : "critical",
          currentGoals: narrativeState.goals,
          currentBeat: narrativeState.currentBeat,
        };
      },
    }),

    setNarrativeGoals: tool({
      description: "Set the current narrative goals for the simulation",
      inputSchema: z.object({
        goals: z.array(z.string()).describe("List of narrative goals to pursue"),
        clearExisting: z.boolean().optional().describe("Clear existing goals first"),
      }),
      execute: async ({ goals, clearExisting = false }) => {
        if (clearExisting) {
          narrativeState.goals = goals;
        } else {
          narrativeState.goals.push(...goals);
        }

        return {
          success: true,
          activeGoals: narrativeState.goals,
        };
      },
    }),

    injectEnvironmentalEvent: tool({
      description: "Inject a world-level event that all agents can perceive",
      inputSchema: z.object({
        eventType: z.string().describe("Type of event (weather, disaster, announcement, etc)"),
        description: z.string().describe("Description of the event"),
        affectedArea: z.string().optional().describe("Area/room affected, or 'global'"),
        duration: z.number().optional().describe("Duration in ticks, or undefined for instant"),
      }),
      execute: async ({ eventType, description, affectedArea = "global", duration }) => {
        // This would integrate with stimulus system
        return {
          success: true,
          event: {
            type: eventType,
            description,
            area: affectedArea,
            duration,
            injectedAt: Date.now(),
          },
          note: "Event will be perceived by agents in affected area",
        };
      },
    }),

    broadcastAnnouncement: tool({
      description: "Make a divine announcement that all agents hear",
      inputSchema: z.object({
        message: z.string().describe("The announcement message"),
        tone: z.enum(["neutral", "warning", "blessing", "ominous"]).optional(),
      }),
      execute: async ({ message, tone = "neutral" }) => {
        return {
          success: true,
          announcement: {
            message,
            tone,
            timestamp: Date.now(),
          },
          note: "All agents will receive this as a divine message",
        };
      },
    }),

    // =========================================================================
    // WORLD OVERSIGHT (Read-only, high-level)
    // =========================================================================

    getWorldSummary: tool({
      description: "Get a high-level summary of the world state",
      inputSchema: z.object({}),
      execute: async () => {
        const agents = query(world, [Agent]);
        const agentCount = agents.length;

        // Get agent moods summary
        const moodCounts = { calm: 0, excited: 0, stressed: 0, curious: 0 };
        for (const eid of agents) {
          const mode = Mind.mode[eid] || "calm";
          if (mode in moodCounts) {
            moodCounts[mode as keyof typeof moodCounts]++;
          }
        }

        return {
          success: true,
          summary: {
            agentCount,
            moodDistribution: moodCounts,
            narrativeTension: narrativeState.tension,
            activeGoals: narrativeState.goals.length,
            spiritCount: spiritRegistry.spirits.size,
          },
        };
      },
    }),

    listAgents: tool({
      description: "List all agents with their basic info",
      inputSchema: z.object({
        limit: z.number().optional().describe("Max agents to return"),
      }),
      execute: async ({ limit = 20 }) => {
        const agents = query(world, [Agent]);
        const result = [];

        for (const eid of agents.slice(0, limit)) {
          result.push({
            eid,
            name: Name.value[eid] || `Agent_${eid}`,
            mood: Mind.mode[eid] || "unknown",
          });
        }

        return {
          success: true,
          totalAgents: agents.length,
          agents: result,
        };
      },
    }),

    // =========================================================================
    // INTERVENTIONS (Strategic level only)
    // =========================================================================

    listActiveInterventions: tool({
      description: "List all currently active interventions",
      inputSchema: z.object({}),
      execute: async () => {
        const interventions = Array.from(interventionRegistry.interventions.values());
        const active = interventions.filter((i: any) => i.active);

        return {
          success: true,
          totalInterventions: interventions.length,
          activeInterventions: active.map((i: any) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            priority: i.priority,
            triggerCount: i.triggerCount,
          })),
        };
      },
    }),

    toggleIntervention: tool({
      description: "Activate or deactivate an intervention by ID",
      inputSchema: z.object({
        interventionId: z.string(),
        active: z.boolean(),
      }),
      execute: async ({ interventionId, active }) => {
        const intervention = interventionRegistry.interventions.get(interventionId);
        if (!intervention) {
          return { success: false, error: `Intervention '${interventionId}' not found` };
        }

        (intervention as any).active = active;

        return {
          success: true,
          interventionId,
          active,
        };
      },
    }),

    // =========================================================================
    // AGENT CONTROL (Limited - high-level only)
    // =========================================================================

    pauseAgent: tool({
      description: "Pause an agent's cognition temporarily",
      inputSchema: z.object({
        agentEid: z.number().describe("Entity ID of the agent"),
        reason: z.string().optional(),
      }),
      execute: async ({ agentEid, reason }) => {
        const name = Name.value[agentEid] || `Agent_${agentEid}`;
        // Would set Agent.paused component
        return {
          success: true,
          agent: name,
          paused: true,
          reason,
        };
      },
    }),

    resumeAgent: tool({
      description: "Resume a paused agent",
      inputSchema: z.object({
        agentEid: z.number(),
      }),
      execute: async ({ agentEid }) => {
        const name = Name.value[agentEid] || `Agent_${agentEid}`;
        return {
          success: true,
          agent: name,
          paused: false,
        };
      },
    }),

    // =========================================================================
    // SPIRIT DELEGATION REQUESTS
    // =========================================================================

    requestSystemRepair: tool({
      description: "Request the Artificer spirit to repair a system (delegates to spirit)",
      inputSchema: z.object({
        systemName: z.string(),
        issue: z.string().describe("Description of the issue"),
        urgency: z.enum(["low", "normal", "high", "urgent"]).optional(),
      }),
      execute: async ({ systemName, issue, urgency = "normal" }) => {
        // Find Artificer spirit by looking for one in systems domain
        let artificer: SpiritState | undefined;
        for (const spirit of spiritRegistry.spirits.values()) {
          if (spirit.definition.canBakeSystems) {
            artificer = spirit;
            break;
          }
        }

        if (!artificer) {
          return { success: false, error: "No Artificer spirit available" };
        }

        const message = spiritDirective(
          "godai",
          artificer,
          `Repair System: ${systemName}`,
          `Please investigate and repair the following issue with ${systemName}: ${issue}`,
          { systemName, issue }
        );

        return {
          success: true,
          delegatedTo: artificer.definition.name,
          messageId: message.id,
          note: "Artificer will report back when repair is complete",
        };
      },
    }),

    requestSystemDesign: tool({
      description: "Request the Architect spirit to design a new system (delegates to spirit)",
      inputSchema: z.object({
        purpose: z.string().describe("Purpose of the new system"),
        requirements: z.array(z.string()).optional(),
      }),
      execute: async ({ purpose, requirements }) => {
        // Find a spirit that can bake systems
        let architect: SpiritState | undefined;
        for (const spirit of spiritRegistry.spirits.values()) {
          if (spirit.definition.canBakeSystems) {
            architect = spirit;
            break;
          }
        }

        if (!architect) {
          return { success: false, error: "No Architect spirit available" };
        }

        const message = spiritDirective(
          "godai",
          architect,
          `Design New System`,
          `Please design a new system for the following purpose: ${purpose}`,
          { purpose, requirements }
        );

        return {
          success: true,
          delegatedTo: architect.definition.name,
          messageId: message.id,
          note: "Architect will submit a proposal for approval",
        };
      },
    }),

    requestHealthCheck: tool({
      description: "Request a spirit to perform a system health check (delegates to spirit)",
      inputSchema: z.object({
        focus: z.string().optional().describe("Specific area to focus on"),
      }),
      execute: async ({ focus }) => {
        // Find any angel spirit
        let watcher: SpiritState | undefined;
        for (const spirit of spiritRegistry.spirits.values()) {
          if (spirit.definition.rank === "angel") {
            watcher = spirit;
            break;
          }
        }

        if (!watcher) {
          return { success: false, error: "No Watcher spirit available" };
        }

        const message = spiritDirective(
          "godai",
          watcher,
          "Health Check Request",
          focus ? `Please check the health of: ${focus}` : "Please perform a full system health check",
          { focus }
        );

        return {
          success: true,
          delegatedTo: watcher.definition.name,
          messageId: message.id,
        };
      },
    }),
  };
}

// =============================================================================
// TOOL CATEGORY REFERENCE
// =============================================================================

/**
 * Tools delegated to spirits (NOT in GodAI's orchestrator set):
 *
 * ARTIFICER SPIRIT (system_maintenance):
 *   - listSystems, inspectSystem, getSystemCode
 *   - repairSystem, enableSystem, disableSystem
 *   - clearSystemErrors, adjustSystemFrequency
 *   - reportToGodAI
 *
 * ARCHITECT SPIRIT (system_design):
 *   - proposeSystem, bakeSystem, validateSystem
 *   - createComponent, listComponents
 *   - submitProposal
 *
 * WATCHER SPIRIT (monitoring):
 *   - queryAgents, getSystemHealth, getErrorLogs
 *   - reportAnomaly
 *
 * MANAGER SPIRIT (agent_control):
 *   - modifyAgentMood, injectStimulus
 *   - getAgentState, monitorAgent
 *
 * VISUAL SPIRIT (rendering):
 *   - All sprite/animation tools
 *   - All worldMap/grid tools
 *   - Character rig tools
 *
 * OBJECT DESIGNER SPIRIT (world_building):
 *   - defineObjectType, defineAffordance, defineRule
 *   - listObjectTypes, listAffordances, listRules
 */

export type OrchestratorTools = ReturnType<typeof createOrchestratorTools>;
