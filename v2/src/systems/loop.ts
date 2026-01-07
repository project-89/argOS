import { getAgentIds, isAgentActive, getAgent, ArgosWorld } from "../core/ecs";
import {
  getActiveStimuli,
  filterByAttention,
  decayStimuli,
  markStimulusProcessed,
  deliverStimulus,
  createStimulus,
} from "./stimulus";
import {
  createPerceptionEvent,
  createThoughtEvent,
  createDecisionEvent,
  getMode,
  setMode,
  getFocus,
  setFocus,
  adjustArousal,
  setSaturation,
  getCapacity,
  calculateNextLoopDelay,
  getArousal,
} from "./mind";
import {
  addNode,
  addEdge,
  queryNodes,
  decayKnowledge,
} from "./knowledge";
import {
  queueAction,
  getNextPendingAction,
  startExecutingAction,
  completeAction,
  failAction,
  getActionHandler,
} from "./action";
import { runCognition } from "../llm/cognition";
import type { CognitiveMode } from "../core/types";

interface LoopState {
  running: boolean;
  lastTick: Map<number, number>;
  loopTimeouts: Map<number, NodeJS.Timeout>;
}

const state: LoopState = {
  running: false,
  lastTick: new Map(),
  loopTimeouts: new Map(),
};

export async function runAgentCognitiveLoop(world: ArgosWorld, eid: number): Promise<void> {
  if (!isAgentActive(world, eid)) return;

  const agent = getAgent(world, eid);
  const name = agent?.name ?? "Unknown";
  console.log(`\n[${name}] Starting cognitive tick...`);

  decayStimuli(world, eid);

  const allStimuli = getActiveStimuli(world, eid);
  const focus = getFocus(world, eid);
  const capacity = getCapacity(world, eid);
  const attendedStimuli = filterByAttention(allStimuli, focus, [], capacity);

  console.log(`[${name}] Active stimuli: ${allStimuli.length}, Attended: ${attendedStimuli.length}`);

  const saturation = attendedStimuli.length / capacity;
  setSaturation(world, eid, saturation);

  if (attendedStimuli.length > 3) {
    adjustArousal(world, eid, 0.1);
  } else if (attendedStimuli.length === 0) {
    adjustArousal(world, eid, -0.05);
  }

  const output = await runCognition(world, eid, attendedStimuli);

  const eventIds: string[] = [];

  if (output.perception && attendedStimuli.length > 0) {
    for (const stimulus of attendedStimuli) {
      const percEvent = createPerceptionEvent(world, eid, stimulus, output.perception.interpretation);
      if (percEvent) eventIds.push(percEvent.id);
      markStimulusProcessed(world, eid, stimulus.id);
    }
  }

  for (const thought of output.thoughts) {
    const causedBy = thought.causedBy.length > 0 ? thought.causedBy : eventIds;
    const thoughtEvent = createThoughtEvent(world, eid, thought.content, causedBy, thought.confidence);
    if (thoughtEvent) eventIds.push(thoughtEvent.id);
  }

  if (output.decision.action) {
    const causedBy = output.decision.causedBy.length > 0 ? output.decision.causedBy : eventIds;
    const decisionEvent = createDecisionEvent(
      world,
      eid,
      `Decided: ${output.decision.action}`,
      output.decision.reasoningText,
      causedBy
    );
    if (decisionEvent) eventIds.push(decisionEvent.id);

    queueAction(world, eid, {
      type: output.decision.action,
      parameters: output.decision.parameters,
      motivatedBy: causedBy,
      expectedOutcome: output.decision.reasoningText,
    });
  }

  const nodeIdMap: Map<string, string> = new Map();

  for (const nodeSpec of output.learning.nodes) {
    const node = addNode(world, eid, {
      type: nodeSpec.type,
      content: nodeSpec.content,
      source: nodeSpec.source,
    });
    if (node) {
      const contentKey = typeof nodeSpec.content === "string" 
        ? nodeSpec.content 
        : JSON.stringify(nodeSpec.content);
      nodeIdMap.set(contentKey, node.id);
      console.log(`[${name}] Learned: [${node.type}] ${contentKey}`);
    }
  }

  for (const edgeSpec of output.learning.edges) {
    const fromNode = nodeIdMap.get(edgeSpec.from) || 
      queryNodes(world, eid, { contentMatch: edgeSpec.from })[0]?.id;
    const toNode = nodeIdMap.get(edgeSpec.to) ||
      queryNodes(world, eid, { contentMatch: edgeSpec.to })[0]?.id;

    if (fromNode && toNode) {
      addEdge(world, eid, {
        type: edgeSpec.type,
        from: fromNode,
        to: toNode,
      });
      console.log(`[${name}] Linked: ${edgeSpec.from} --[${edgeSpec.type}]--> ${edgeSpec.to}`);
    }
  }

  if (output.stateUpdates.focus !== undefined) {
    setFocus(world, eid, output.stateUpdates.focus);
  }

  if (output.stateUpdates.mode) {
    setMode(world, eid, output.stateUpdates.mode as CognitiveMode);
  }

  if (output.stateUpdates.arousalDelta) {
    adjustArousal(world, eid, output.stateUpdates.arousalDelta);
  }

  const pendingAction = getNextPendingAction(world, eid);
  if (pendingAction) {
    const handler = getActionHandler(pendingAction.type);
    if (handler) {
      startExecutingAction(world, eid, pendingAction.id);
      try {
        const result = await handler.execute(world, eid, pendingAction.parameters, { world });
        const completed = completeAction(world, eid, result.result, result.outcome);
        console.log(`[${name}] Action completed: ${completed?.type} -> ${result.outcome}`);

        if (pendingAction.type === "speak") {
          const speechStimulus = createStimulus({
            type: "auditory",
            source: name,
            content: pendingAction.parameters.content,
            salience: 0.8,
            urgency: 0.5,
            novelty: 0.6,
          });

          const allAgents = getAgentIds(world);
          for (const otherEid of allAgents) {
            if (otherEid !== eid) {
              deliverStimulus(world, otherEid, { ...speechStimulus });
            }
          }
        }

        if (pendingAction.type === "setMode" && pendingAction.parameters.mode) {
          setMode(world, eid, pendingAction.parameters.mode as CognitiveMode);
        }

        if (pendingAction.type === "focus" && pendingAction.parameters.target) {
          setFocus(world, eid, pendingAction.parameters.target);
        }

        if (pendingAction.type === "remember") {
          addNode(world, eid, {
            type: pendingAction.parameters.type,
            content: pendingAction.parameters.content,
            source: "deliberate memory",
          });
        }
      } catch (error) {
        failAction(world, eid, String(error));
        console.error(`[${name}] Action failed:`, error);
      }
    }
  }

  decayKnowledge(world, eid, 0.001);

  const nextDelay = calculateNextLoopDelay(world, eid, allStimuli.length);
  console.log(`[${name}] Mode: ${getMode(world, eid)}, Arousal: ${(getArousal(world, eid) * 100).toFixed(0)}%, Next tick: ${nextDelay}ms`);

  if (state.running) {
    const timeout = setTimeout(() => {
      runAgentCognitiveLoop(world, eid);
    }, nextDelay);
    state.loopTimeouts.set(eid, timeout);
  }
}

export function startCognitiveLoops(world: ArgosWorld): void {
  if (state.running) return;
  state.running = true;

  const agents = getAgentIds(world);
  console.log(`Starting cognitive loops for ${agents.length} agents...`);

  for (const eid of agents) {
    runAgentCognitiveLoop(world, eid);
  }
}

export function stopCognitiveLoops(): void {
  state.running = false;

  for (const timeout of state.loopTimeouts.values()) {
    clearTimeout(timeout);
  }
  state.loopTimeouts.clear();

  console.log("Cognitive loops stopped.");
}

export function isRunning(): boolean {
  return state.running;
}
