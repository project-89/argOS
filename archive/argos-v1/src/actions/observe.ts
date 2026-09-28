import { z } from "zod";
import { Agent, Perception, WorkingMemory, ReasoningContext } from "../components";
import { getAgentRoom } from "../utils/queries";
import { getRoomAgents, getRoomStimuli } from "../utils/room-queries";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { World, hasComponent, setComponent } from "bitecs";
import { ActionResultType } from "../components";

export const schema = z.object({
  focus: z.enum([
    "environment",
    "agents", 
    "specific_agent",
    "stimuli",
    "patterns",
    "changes"
  ]).describe("What aspect to focus observation on"),
  target: z.string().optional().describe("Specific target to observe (e.g., agent name)"),
  depth: z.enum(["surface", "detailed", "analytical"]).describe("How deeply to observe"),
});

export const action = {
  name: "observe",
  description: "Actively observe and analyze the environment, other agents, or specific aspects of the situation",
  parameters: ["focus", "target", "depth"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
): Promise<ActionResultType> {
  const roomId = getAgentRoom(world, eid);
  if (!roomId) {
    return {
      success: false,
      action: "observe",
      result: "Cannot observe - agent not in a room",
      timestamp: Date.now(),
      data: { metadata: { error: "No room found" } },
    };
  }

  const { focus, target, depth } = parameters;
  const agentName = Agent.name[eid];
  
  // Gather observation data based on focus
  let observations: any = {
    focus,
    depth,
    timestamp: Date.now(),
  };

  switch (focus) {
    case "environment":
      observations.environment = observeEnvironment(world, roomId);
      break;
      
    case "agents":
      observations.agents = observeAgents(world, roomId, eid);
      break;
      
    case "specific_agent":
      if (target) {
        observations.targetAgent = observeSpecificAgent(world, roomId, target);
      } else {
        observations.error = "No target specified for specific agent observation";
      }
      break;
      
    case "stimuli":
      observations.stimuli = observeStimuli(world, roomId);
      break;
      
    case "patterns":
      observations.patterns = observePatterns(world, eid);
      break;
      
    case "changes":
      observations.changes = observeChanges(world, eid);
      break;
  }

  // Apply depth of observation
  if (depth === "analytical") {
    observations.analysis = analyzeObservations(observations, world, eid);
  }

  // Update working memory with observations
  if (hasComponent(world, eid, WorkingMemory)) {
    // TODO: Fix WorkingMemory structure
    const workingMemory = {
      items: [],
      capacity: 20
    };
    if (true) {
      const observationItem = {
        type: "observation" as const,
        content: JSON.stringify(observations),
        timestamp: Date.now(),
        importance: depth === "analytical" ? 0.9 : 0.7,
        source: `observe_${focus}`,
      };
      
      // TODO: Update WorkingMemory properly
      // workingMemory.items = [...workingMemory.items, observationItem].slice(-20);
      // setComponent(world, eid, WorkingMemory, workingMemory);
    }
  }

  // Update reasoning context if in analytical mode
  if (depth === "analytical" && hasComponent(world, eid, ReasoningContext)) {
    ReasoningContext.mode[eid] = "exploratory";
  }

  logger.agent(eid, `Observing ${focus}${target ? ` (${target})` : ""} at ${depth} depth`, agentName);

  // Emit observation event
  eventBus.emitRoomEvent(
    roomId,
    "observation",
    {
      agentName,
      focus,
      target,
      depth,
      summary: generateObservationSummary(observations),
    },
    String(eid)
  );

  return {
    success: true,
    action: "observe",
    result: generateObservationSummary(observations),
    timestamp: Date.now(),
    data: {
      observations,
      metadata: {
        focus,
        target,
        depth,
      },
    },
  };
}

function observeEnvironment(world: World, roomId: number): any {
  const roomAgents = getRoomAgents(world, roomId);
  const roomStimuli = getRoomStimuli(world, roomId);
  
  return {
    agentCount: roomAgents.length,
    stimuliCount: roomStimuli.length,
    activity: roomStimuli.filter(s => Date.now() - s.timestamp < 30000).length,
    atmosphere: determineAtmosphere(roomStimuli),
  };
}

function observeAgents(world: World, roomId: number, observerEid: number): any {
  const roomAgents = getRoomAgents(world, roomId);
  
  return roomAgents
    .filter(agentEid => agentEid !== observerEid)
    .map(agentEid => ({
      name: Agent.name[agentEid],
      active: Agent.active[agentEid],
      lastActivity: getLastActivity(world, agentEid),
    }));
}

function observeSpecificAgent(world: World, roomId: number, targetName: string): any {
  const roomAgents = getRoomAgents(world, roomId);
  const targetEid = roomAgents.find(eid => Agent.name[eid] === targetName);
  
  if (!targetEid) {
    return { error: `Agent ${targetName} not found in room` };
  }
  
  return {
    name: Agent.name[targetEid],
    active: Agent.active[targetEid],
    attention: Agent.attention[targetEid],
    lastActivity: getLastActivity(world, targetEid),
    appearance: getAgentAppearance(world, targetEid),
  };
}

function observeStimuli(world: World, roomId: number): any {
  const stimuli = getRoomStimuli(world, roomId);
  
  return stimuli.map(stimulus => ({
    type: stimulus.type,
    content: stimulus.content,
    source: stimulus.source,
    age: Date.now() - stimulus.timestamp,
  }));
}

function observePatterns(world: World, eid: number): any {
  // Look for patterns in perception history
  if (!hasComponent(world, eid, Perception)) return { patterns: [] };
  
  const perceptions = Perception.currentStimuli[eid] || [];
  
  // Simple pattern detection
  const typeFrequency: Record<string, number> = {};
  perceptions.forEach(p => {
    typeFrequency[p.type] = (typeFrequency[p.type] || 0) + 1;
  });
  
  return {
    dominantStimuli: Object.entries(typeFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3),
    repetitions: detectRepetitions(perceptions),
  };
}

function observeChanges(world: World, eid: number): any {
  // Compare current state with working memory
  if (!hasComponent(world, eid, WorkingMemory)) return { changes: [] };
  
  const workingMemory = WorkingMemory.items[eid] || [];
  const recentMemories = workingMemory.slice(-5);
  
  return {
    recentChanges: recentMemories
      .filter(m => m.type === "observation" || m.type === "perception")
      .map(m => ({
        type: m.type,
        age: Date.now() - m.timestamp,
        summary: m.content.substring(0, 100),
      })),
  };
}

function analyzeObservations(observations: any, world: World, eid: number): any {
  // Perform deeper analysis based on observation type
  const analysis: any = {
    insights: [],
    questions: [],
    hypotheses: [],
  };
  
  if (observations.patterns) {
    if (observations.patterns.dominantStimuli.length > 0) {
      analysis.insights.push(`High frequency of ${observations.patterns.dominantStimuli[0][0]} stimuli`);
    }
  }
  
  if (observations.environment) {
    if (observations.environment.activity > 5) {
      analysis.insights.push("Environment is highly active");
      analysis.questions.push("What is causing this increased activity?");
    }
  }
  
  if (observations.agents && observations.agents.length > 0) {
    const inactiveAgents = observations.agents.filter((a: any) => !a.active).length;
    if (inactiveAgents > 0) {
      analysis.hypotheses.push(`${inactiveAgents} agents may be reflecting or waiting`);
    }
  }
  
  return analysis;
}

function generateObservationSummary(observations: any): string {
  const parts: string[] = [];
  
  if (observations.environment) {
    parts.push(`Environment: ${observations.environment.atmosphere} atmosphere with ${observations.environment.agentCount} agents`);
  }
  
  if (observations.agents) {
    parts.push(`Observed ${observations.agents.length} other agents`);
  }
  
  if (observations.targetAgent && !observations.targetAgent.error) {
    parts.push(`${observations.targetAgent.name} appears ${observations.targetAgent.active ? 'active' : 'inactive'}`);
  }
  
  if (observations.patterns) {
    parts.push(`Patterns detected in stimuli`);
  }
  
  if (observations.analysis) {
    parts.push(`Generated ${observations.analysis.insights.length} insights`);
  }
  
  return parts.join(". ") || "Observation complete";
}

function determineAtmosphere(stimuli: any[]): string {
  const recentStimuli = stimuli.filter(s => Date.now() - s.timestamp < 60000);
  
  if (recentStimuli.length === 0) return "quiet";
  if (recentStimuli.length < 3) return "calm";
  if (recentStimuli.length < 10) return "active";
  return "bustling";
}

function getLastActivity(world: World, agentEid: number): string {
  // This would check action history or recent stimuli
  return "Unknown"; // Placeholder
}

function getAgentAppearance(world: World, agentEid: number): any {
  // This would get appearance component data
  return { description: "Default appearance" }; // Placeholder
}

function detectRepetitions(perceptions: any[]): number {
  // Simple repetition detection
  const contents = perceptions.map(p => p.content);
  const uniqueContents = new Set(contents);
  return contents.length - uniqueContents.size;
}