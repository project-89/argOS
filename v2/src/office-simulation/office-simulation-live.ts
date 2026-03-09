/**
 * Office Simulation - LIVE SLACK VERSION
 *
 * Same as office-simulation.ts but connected to real Slack.
 * Agent messages appear in your actual Slack workspace.
 *
 * Run with: npx tsx src/office-simulation/office-simulation-live.ts
 *
 * Before running:
 * 1. Create channels in your Slack workspace: #argos-general, #argos-engineering
 * 2. Invite the bot to those channels: /invite @YourBotName
 * 3. The script will auto-map channels by name
 */

import "dotenv/config";
import { createWorld, query, hasComponent, getRelationTargets } from "bitecs";
import { Agent, Name, Description } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import {
  initializeSlackWorkspace,
  createChannel,
  joinChannel,
  sendMessage,
  getChannelByName,
  getChannelMessages,
  formatSlackContextForPrompt,
  getPendingNotifications,
  clearNotifications,
  getSlackSummary,
  setPresence,
  setExternalMessageHandler,
} from "./slack-system";
import {
  initializeEnhancedAgent,
  initializeEnhancedAgentSystem,
} from "../cognition/enhanced-agent";
import { addPerception, type AgentAction } from "../cognition/agent-mind";
import { queueStimulus } from "../cognition/cognition-system";
import {
  groundedThink,
  recordSpeech,
  recordHeardSpeech,
  recordSlackMessage,
  recordAction,
  getRecentEvents,
} from "../cognition/grounded-cognition";
import {
  initializeSlackBridge,
  startSlackBridge,
  stopSlackBridge,
  autoMapChannels,
  mapChannel,
  sendToSlack,
} from "./slack-bridge";
import { setDynamicComponentValue, createDynamicComponent, getDynamicComponent } from "../ecs/dynamic-components";

// =============================================================================
// TERMINAL COLORS
// =============================================================================

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const log = {
  header: (s: string) => console.log(`${c.bright}${c.white}${s}${c.reset}`),
  success: (s: string) => console.log(`${c.green}${s}${c.reset}`),
  error: (s: string) => console.log(`${c.red}${s}${c.reset}`),
  info: (s: string) => console.log(`${c.cyan}${s}${c.reset}`),
  thought: (s: string) => console.log(`${c.dim}${s}${c.reset}`),
  action: (s: string) => console.log(`${c.yellow}${s}${c.reset}`),
  agent: (name: string, s: string) => console.log(`${c.magenta}[${name}]${c.reset} ${s}`),
  slack: (s: string) => console.log(`${c.blue}[Slack]${c.reset} ${s}`),
};

// =============================================================================
// TYPES
// =============================================================================

interface OfficeAgent {
  eid: number;
  name: string;
  role: string;
  phoneEid: number;
}

interface OfficeWorld {
  world: any;
  rooms: Map<string, number>;
  agents: Map<string, OfficeAgent>;
}

// =============================================================================
// SLACK ACTION EXECUTION
// =============================================================================

interface SlackAction {
  type: "slack_send" | "slack_read" | "slack_check_notifications";
  channel?: string;
  message?: string;
}

function executeSlackAction(
  ow: OfficeWorld,
  agentEid: number,
  action: SlackAction
): string {
  const agent = Array.from(ow.agents.values()).find(a => a.eid === agentEid);
  if (!agent) return "Error: Agent not found";

  switch (action.type) {
    case "slack_send": {
      if (!action.channel || !action.message) {
        return "Error: Need channel and message";
      }
      const channel = getChannelByName(action.channel);
      if (!channel) return `Error: Channel #${action.channel} not found`;
      const msg = sendMessage(ow.world, channel.id, agentEid, agent.name, action.message);
      return msg ? `Posted in #${action.channel}: "${action.message}"` : "Failed to send message";
    }

    case "slack_read": {
      if (!action.channel) return "Error: Need channel name";
      const channel = getChannelByName(action.channel);
      if (!channel) return `Error: Channel #${action.channel} not found`;
      const messages = channel.messages.slice(-5);
      if (messages.length === 0) return `No messages in #${action.channel}`;
      const formatted = messages.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString();
        return `[${time}] ${m.authorName}: ${m.content}`;
      }).join("\n");
      return `Recent messages in #${action.channel}:\n${formatted}`;
    }

    case "slack_check_notifications": {
      const notifications = getPendingNotifications(agentEid);
      if (notifications.length === 0) return "No new notifications";
      const formatted = notifications.slice(0, 5).map(n => {
        return `[${n.type}] ${n.from} in #${n.channelName}: "${n.preview.slice(0, 50)}..."`;
      }).join("\n");
      clearNotifications(agentEid);
      return `Notifications:\n${formatted}`;
    }

    default:
      return "Unknown Slack action";
  }
}

// =============================================================================
// OFFICE SETUP
// =============================================================================

function ensureDeviceComponent(): void {
  if (!getDynamicComponent("Device")) {
    createDynamicComponent({
      name: "Device",
      description: "Electronic device with owner and state",
      properties: { owner: "number", type: "string", state: "string", battery: "number" },
    });
  }
}

function createSmartphone(ow: OfficeWorld, ownerEid: number, ownerName: string): number {
  const phoneEid = createObjectEntity(ow.world, {
    name: `${ownerName}'s Smartphone`,
    description: `A modern smartphone belonging to ${ownerName}. Has Slack installed.`,
    material: "aluminum",
    weight: 0.2,
    portable: true,
    traits: ["device", "communication", "usable"],
  });
  ensureDeviceComponent();
  setDynamicComponentValue("Device", phoneEid, "owner", ownerEid);
  setDynamicComponentValue("Device", phoneEid, "type", "smartphone");
  setDynamicComponentValue("Device", phoneEid, "state", "powered_on");
  setDynamicComponentValue("Device", phoneEid, "battery", 100);
  return phoneEid;
}

function createOfficeWorker(
  ow: OfficeWorld,
  config: {
    name: string;
    role: string;
    roomName: string;
    personality: string;
    currentWork: string;
    goals: string[];
  }
): OfficeAgent {
  const roomEid = ow.rooms.get(config.roomName.toLowerCase());
  const eid = createAgentEntity(ow.world, {
    name: config.name,
    role: config.role,
    systemPrompt: `You are ${config.name}, ${config.role} at Argos Simulations.

## COMPANY CONTEXT
Argos Simulations is a cutting-edge simulation company that leverages the Argos Engine -
a powerful multi-agent simulation platform - to solve crucial problems for clients.
We build custom simulations for clients in healthcare, urban planning, logistics, and defense.

## YOUR PERSONALITY
${config.personality}

## YOUR CURRENT WORK
${config.currentWork}

## YOUR GOALS TODAY
${config.goals.map(g => `- ${g}`).join("\n")}

## TEAM
- Alex (Engineering Manager) - Oversees the engineering team, coordinates sprints
- Maya (Senior Developer) - Lead developer on the Argos Engine, expert in agent systems
- Casey (Junior Developer) - New hire, learning the codebase, eager to contribute
- Jordan (Product Manager) - Handles client relationships, defines requirements

## COMMUNICATION
You have Slack on your phone. Use it for async communication.
For quick conversations with people in the same room, just speak to them directly.
Be substantive - discuss actual work, problems, and solutions.`,
    description: `${config.name}, ${config.role}`,
    roomId: roomEid,
  });

  const phoneEid = createSmartphone(ow, eid, config.name);
  const agent: OfficeAgent = { eid, name: config.name, role: config.role, phoneEid };
  ow.agents.set(config.name, agent);
  initializeEnhancedAgent(eid);
  return agent;
}

function initializeOfficeWorld(): OfficeWorld {
  const world = createWorld();
  initializePrefabs(world as any);
  initializeEnhancedAgentSystem();

  const ow: OfficeWorld = { world: world as any, rooms: new Map(), agents: new Map() };

  // Create rooms
  const rooms = [
    { name: "Lobby", description: "The main entrance" },
    { name: "Open Office", description: "Open-plan workspace" },
    { name: "Break Room", description: "Coffee and snacks" },
    { name: "Meeting Room", description: "Glass-walled meeting room" },
    { name: "Engineering Corner", description: "Engineering team area" },
  ];

  for (const roomConfig of rooms) {
    const roomEid = createRoomEntity(ow.world, {
      name: roomConfig.name,
      description: roomConfig.description,
      capacity: 10,
      ambience: "office",
    });
    ow.rooms.set(roomConfig.name.toLowerCase(), roomEid);
  }

  // Initialize simulation Slack
  initializeSlackWorkspace("Argos Tech");
  createChannel("engineering", "public", "Engineering discussions");

  return ow;
}

function createOfficeTeam(ow: OfficeWorld): void {
  createOfficeWorker(ow, {
    name: "Alex",
    role: "Engineering Manager",
    roomName: "Engineering Corner",
    personality: "Organized, methodical, focused on team productivity and hitting deadlines. Direct communicator who prefers Slack for async updates. Gets concerned when blockers aren't raised early.",
    currentWork: `You're managing the sprint for the Meridian Health simulation project - a hospital patient flow simulation that predicts ER wait times. The client demo is in 3 days and there are still issues with the agent memory system causing unrealistic patient behavior. You need to check in with Maya about the memory fix, and make sure Casey is making progress on the documentation that Jordan requested.`,
    goals: [
      "Check on Maya's progress with the memory system fix",
      "Make sure Casey has what they need to complete the API documentation",
      "Coordinate with Jordan about demo readiness",
      "Post a sprint status update to #engineering",
    ],
  });

  createOfficeWorker(ow, {
    name: "Maya",
    role: "Senior Developer",
    roomName: "Engineering Corner",
    personality: "Deep technical thinker who enjoys mentoring junior developers. Sometimes gets absorbed in code and forgets to communicate progress. Values clean architecture and thorough testing.",
    currentWork: `You're debugging a critical issue in the Argos Engine's episodic memory system. Agents in the Meridian Health simulation are "forgetting" recent events after 10 ticks, causing them to repeat the same behaviors. You've traced it to a buffer overflow in the memory consolidation function. You think you have a fix but need to test it thoroughly. Casey asked you yesterday to review their API documentation PR - you haven't gotten to it yet.`,
    goals: [
      "Fix the episodic memory buffer overflow issue",
      "Run the memory regression tests to validate the fix",
      "Review Casey's documentation PR (you promised yesterday)",
      "Update Alex on your progress",
    ],
  });

  createOfficeWorker(ow, {
    name: "Casey",
    role: "Junior Developer",
    roomName: "Open Office",
    personality: "Eager to learn but sometimes hesitant to ask questions. Wants to prove themselves but also aware they're new. Gets excited about interesting technical problems.",
    currentWork: `You're writing API documentation for the Argos Engine's public interfaces. Jordan needs this for the Meridian Health sales materials. You've been studying the codebase and have questions about how the perception system works - specifically how stimuli are filtered before reaching agents. You submitted a PR yesterday but Maya hasn't reviewed it yet. You're not sure if you should ping her or wait.`,
    goals: [
      "Finish the perception system documentation section",
      "Get Maya's review on your documentation PR",
      "Understand how stimulus filtering works (you're confused about priority levels)",
      "Make sure your documentation is accurate - ask questions if unsure",
    ],
  });

  createOfficeWorker(ow, {
    name: "Jordan",
    role: "Product Manager",
    roomName: "Meeting Room",
    personality: "Client-focused and deadline-conscious. Good at translating technical concepts for stakeholders. Sometimes anxious about deliverables. Appreciates proactive communication from the team.",
    currentWork: `You're preparing for the Meridian Health client demo in 3 days. The client is considering a $400K contract if the demo goes well. You need to create the presentation deck and make sure the simulation is stable enough to show. You've heard there might be memory issues - you need an update from engineering. You also need Casey's API documentation for the technical appendix.`,
    goals: [
      "Get a status update from Alex on the memory bug fix",
      "Check with Casey on the API documentation progress",
      "Prepare talking points for the Meridian demo",
      "Make sure the team understands the stakes of this demo",
    ],
  });

  // Join channels - everyone joins general, PM joins engineering too for cross-team visibility
  for (const agent of ow.agents.values()) {
    const generalChannel = getChannelByName("general");
    if (generalChannel) joinChannel(generalChannel.id, agent.eid);

    // Engineering team + PM (for project coordination) join #engineering
    const engChannel = getChannelByName("engineering");
    if (engChannel) joinChannel(engChannel.id, agent.eid);

    setPresence(agent.eid, "active");
  }

  log.success("\nOffice team created:");
  for (const agent of ow.agents.values()) {
    log.info(`  - ${agent.name} (${agent.role})`);
  }
}

// =============================================================================
// ROOM & SPEECH HELPERS
// =============================================================================

/**
 * Get the room an agent is in
 */
function getAgentRoom(ow: OfficeWorld, agentEid: number): number | null {
  for (const [roomName, roomEid] of ow.rooms) {
    if (hasComponent(ow.world, agentEid, OccupiesRoom(roomEid))) {
      return roomEid;
    }
  }
  return null;
}

/**
 * Get all agents in the same room as the given agent
 */
function getAgentsInSameRoom(ow: OfficeWorld, agentEid: number): OfficeAgent[] {
  const agentRoom = getAgentRoom(ow, agentEid);
  if (!agentRoom) return [];

  const result: OfficeAgent[] = [];
  for (const agent of ow.agents.values()) {
    if (agent.eid !== agentEid && hasComponent(ow.world, agent.eid, OccupiesRoom(agentRoom))) {
      result.push(agent);
    }
  }
  return result;
}

/**
 * Propagate speech to all agents in the same room
 */
function propagateSpeech(ow: OfficeWorld, speakerEid: number, speakerName: string, speech: string): void {
  const listeners = getAgentsInSameRoom(ow, speakerEid);

  // Record that speaker spoke
  recordSpeech(speakerEid, speakerName, speech);

  for (const listener of listeners) {
    // Add perception
    addPerception(ow.world, listener.eid, {
      type: "speech",
      content: `${speakerName} says: "${speech}"`,
      source: speakerName,
    });

    // Record in listener's working memory
    recordHeardSpeech(listener.eid, speakerName, speech);

    log.thought(`  (${listener.name} hears ${speakerName})`);
  }
}

// =============================================================================
// SLACK HISTORY HELPER
// =============================================================================

/**
 * Get recent Slack channel history formatted for agent context
 */
function getSlackHistoryContext(channelName: string, limit: number = 15): string {
  const channel = getChannelByName(channelName);
  if (!channel) return "";

  const messages = getChannelMessages(channel.id, limit);
  if (messages.length === 0) return "";

  const formatted = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `  [${time}] ${m.authorName}: ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`;
  }).join("\n");

  return `## Recent Slack #${channelName} History (what's been said - DON'T REPEAT)\n${formatted}\n\nIMPORTANT: Read the history above. DO NOT repeat what others have already said. Add something NEW to the conversation or ask a follow-up question.\n`;
}

// =============================================================================
// SIMULATION LOOP
// =============================================================================

async function runAgentCycle(ow: OfficeWorld, agent: OfficeAgent): Promise<AgentAction | null> {
  // Process Slack notifications into perceptions
  const notifications = getPendingNotifications(agent.eid);
  for (const notif of notifications.slice(0, 3)) {
    addPerception(ow.world, agent.eid, {
      type: "slack_notification",
      content: `[Slack] ${notif.from} in #${notif.channelName}: "${notif.preview}"`,
      source: "phone",
    });
    recordSlackMessage(agent.eid, notif.from, notif.preview);
  }
  clearNotifications(agent.eid);

  // Get agent's original system prompt with their work context
  const agentSystemPrompt = Agent.systemPrompt[agent.eid] || "";

  try {
    // Get Slack channel history so agent can see what's been said
    const slackHistory = getSlackHistoryContext("general", 20);

    // Use grounded thinking with the agent's ACTUAL work context
    const action = await groundedThink(ow.world, agent.eid, {
      // Pass the agent's full system prompt (with work context, goals, etc.)
      systemPrompt: agentSystemPrompt,
      availableActions: ["speak", "observe", "think", "wait", "move", "use", "reflect"],
      additionalContext: `
${slackHistory}
## IMPORTANT: YOUR ACTUAL WORK
Review your current work and goals above. When someone asks about blockers or status:
- Reference your ACTUAL current tasks and challenges
- Don't just say "no blockers" if your work description mentions issues
- Be specific about what you're working on
- If you have questions or need help, ask for it

## Slack Integration
You have a smartphone with Slack. The channels are #general and #engineering.
- To check messages: action type "use", content "Check Slack #general"
- To post: action type "use", content "Post to #engineering: your message here"

## INTERACTION GUIDELINES
- If someone speaks to you, respond to what they actually said
- Reference your actual work when discussing status or blockers
- Use Slack for async communication, direct speech for in-person conversation
- Be substantive - discuss actual problems, ask real questions, give helpful answers
- Don't just observe or wait endlessly - take initiative on your work
- If you have a blocker, raise it to the relevant person
- AVOID repeating what others have already said in the Slack history above
- Build on the conversation - ask follow-ups, share different perspectives, offer help
`,
    });

    // Handle Slack-related actions
    if (action && (action.type === "use" || action.content?.toLowerCase().includes("slack"))) {
      const content = action.content?.toLowerCase() || "";
      const hasQuotedContent = action.content?.includes("'") || action.content?.includes('"');
      const isPostIntent = content.includes("post") || content.includes("send");

      if (isPostIntent) {
        const channelMatch = content.match(/#(\w+)/);
        const channel = channelMatch ? channelMatch[1] : "general";

        // Extract message - handle various quoting styles
        let messageContent: string;
        const originalContent = action.content || "";

        // Try double quotes first (most reliable)
        const doubleQuoteMatch = originalContent.match(/"([^"]+)"/);
        // Try single quotes that span to end (handles apostrophes inside)
        const singleQuoteMatch = originalContent.match(/'([^']*(?:'\w[^']*)*)'(?:\s*$|\s*[^'])/);
        // Try content after colon (common pattern: "Post to #general: message here")
        const colonMatch = originalContent.match(/(?:#\w+)?:\s*['"]?(.+?)['"]?\s*$/);

        if (doubleQuoteMatch) {
          messageContent = doubleQuoteMatch[1];
        } else if (colonMatch) {
          // Clean up any outer quotes from the colon match
          messageContent = colonMatch[1].replace(/^['"]|['"]$/g, "").trim();
        } else if (singleQuoteMatch) {
          messageContent = singleQuoteMatch[1];
        } else {
          // Last resort: take everything after "Post to #channel" or similar
          const afterChannelMatch = originalContent.match(/#\w+[:\s]+(.+)$/i);
          messageContent = afterChannelMatch ? afterChannelMatch[1].trim() : originalContent;
        }

        const result = executeSlackAction(ow, agent.eid, {
          type: "slack_send",
          channel,
          message: messageContent,
        });
        log.slack(`${agent.name}: ${result}`);
        recordAction(agent.eid, agent.name, `posted to #${channel}: "${messageContent.slice(0, 50)}..."`);

      } else if (content.includes("check") || content.includes("read") || content.includes("slack")) {
        const channelMatch = content.match(/#(\w+)/);
        const channel = channelMatch ? channelMatch[1] : "general";
        const result = executeSlackAction(ow, agent.eid, { type: "slack_read", channel });
        log.slack(`${agent.name}: ${result}`);
        recordAction(agent.eid, agent.name, `checked Slack #${channel}`);
      }
    }

    // Record the action in working memory
    if (action && action.type !== "wait" && action.type !== "think") {
      recordAction(agent.eid, agent.name, `${action.type}${action.content ? `: ${action.content.slice(0, 50)}` : ""}`);
    }

    return action;
  } catch (error) {
    log.error(`  Error for ${agent.name}: ${error}`);
    return null;
  }
}

async function runSimulation(ow: OfficeWorld, maxCycles: number = 5): Promise<void> {
  log.header("\n" + "=".repeat(70));
  log.header("  LIVE OFFICE SIMULATION - CONNECTED TO REAL SLACK");
  log.header("=".repeat(70) + "\n");

  // Send startup message to real Slack
  await sendToSlack("general", "☕ *Morning standup time at Argos Simulations* - Team is online");

  const alex = ow.agents.get("Alex")!;
  const generalChannel = getChannelByName("general")!;
  sendMessage(ow.world, generalChannel.id, alex.eid, alex.name,
    "Morning everyone! Quick reminder - Meridian Health demo is in 3 days. Let's sync up on blockers today.");

  const agents = Array.from(ow.agents.values());

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    log.header(`\n${"─".repeat(50)}`);
    log.header(`  CYCLE ${cycle}/${maxCycles}`);
    log.header(`${"─".repeat(50)}`);

    for (const agent of agents) {
      log.agent(agent.name, `thinking... (${agent.role})`);
      const action = await runAgentCycle(ow, agent);

      if (action) {
        const actionStr = action.content
          ? `${action.type}: "${action.content.slice(0, 60)}${action.content.length > 60 ? "..." : ""}"`
          : action.type;
        log.action(`  → ${actionStr}`);

        // Propagate speech to other agents in the same room
        if (action.type === "speak" && action.content) {
          propagateSpeech(ow, agent.eid, agent.name, action.content);
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    log.thought(`\n  ${getSlackSummary()}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Send shutdown message
  await sendToSlack("general", "🌙 *End of day at Argos Simulations* - Team signing off. See you tomorrow!");

  log.header("\n" + "=".repeat(70));
  log.header("  SIMULATION COMPLETE");
  log.header("=".repeat(70));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log.header("\n╔" + "═".repeat(58) + "╗");
  log.header("║" + "  ARGOS OFFICE - LIVE SLACK CONNECTION  ".padStart(42).padEnd(58) + "║");
  log.header("╚" + "═".repeat(58) + "╝");

  // Check env vars
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
    log.error("\n❌ Slack credentials not set. Need SLACK_BOT_TOKEN and SLACK_APP_TOKEN");
    process.exit(1);
  }

  log.info("\nInitializing office world...");
  const ow = initializeOfficeWorld();
  log.success("✓ Office world created");

  log.info("\nCreating office team...");
  createOfficeTeam(ow);

  log.info("\nConnecting to Slack...");
  try {
    await initializeSlackBridge(ow.world);
    await startSlackBridge();
    log.success("✓ Connected to Slack!");

    // Register handler for external Slack messages
    setExternalMessageHandler((memberEid, authorName, content, channelName) => {
      // Get agent name for logging
      const agentName = Name.value[memberEid] || `Agent-${memberEid}`;

      // Add as perception so agent sees it
      addPerception(ow.world, memberEid, {
        type: "slack_message",
        content: `[Slack #${channelName}] ${authorName}: "${content}"`,
        source: "slack_external",
      });
      // Record in working memory
      recordSlackMessage(memberEid, authorName, content);
      log.slack(`📨 ${agentName} received message from ${authorName} in #${channelName}: "${content.slice(0, 60)}..."`);
    });

    // Auto-map channels
    log.info("\nAuto-mapping channels...");
    const mapped = await autoMapChannels();

    if (mapped === 0) {
      log.info("\nNo channels auto-mapped. You can manually map them:");
      log.info("  1. Create #argos-general and #argos-engineering in Slack");
      log.info("  2. Invite your bot to those channels");
      log.info("  3. Or manually map: mapChannel('general', 'C0123456789')");
      log.info("\nContinuing without real Slack bridge...");
    }

  } catch (error) {
    log.error(`\n❌ Failed to connect to Slack: ${error}`);
    log.info("Continuing in simulation-only mode...");
  }

  // Run simulation
  const cycles = parseInt(process.env.SIMULATION_CYCLES || "3");

  try {
    await runSimulation(ow, cycles);
  } finally {
    await stopSlackBridge();
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  log.info("\n\nShutting down...");
  await stopSlackBridge();
  process.exit(0);
});

main().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
