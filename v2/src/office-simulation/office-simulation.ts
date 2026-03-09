/**
 * Office Simulation
 *
 * A small office environment where agents have smartphones with Slack access.
 * Agents can communicate asynchronously via channels and DMs.
 *
 * Features:
 * - Multiple office workers with different roles
 * - Smartphones bound to each agent
 * - In-simulation Slack with channels
 * - Enhanced cognition for planning and research
 *
 * Run with: npx tsx src/office-simulation/office-simulation.ts
 */

import "dotenv/config";
import { createWorld, addEntity, addComponent, query, hasComponent } from "bitecs";
import {
  Agent, Mind, Name, Needs, Room, Description, Health, Inventory, GridPosition,
} from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import {
  initializeSlackWorkspace,
  createChannel,
  createDMChannel,
  joinChannel,
  sendMessage,
  getChannelByName,
  formatSlackContextForPrompt,
  getAgentChannels,
  getPendingNotifications,
  clearNotifications,
  getSlackSummary,
  setPresence,
  type SlackChannel,
} from "./slack-system";
import {
  initializeEnhancedAgent,
  runEnhancedCognition,
  assignGoal,
  getEnhancedAgentStatus,
  initializeEnhancedAgentSystem,
  setCognitiveMode,
} from "../cognition/enhanced-agent";
import { addPerception, agentThink, type AgentAction } from "../cognition/agent-mind";
import { queueStimulus } from "../cognition/cognition-system";
import { getDynamicComponentValue, setDynamicComponentValue, createDynamicComponent, getDynamicComponent } from "../ecs/dynamic-components";

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
  slackChannels: Map<string, SlackChannel>;
}

// =============================================================================
// SLACK ACTIONS - Tools agents can use via their phones
// =============================================================================

interface SlackAction {
  type: "slack_send" | "slack_read" | "slack_check_notifications" | "slack_join_channel";
  channel?: string;
  message?: string;
  recipient?: string; // For DMs
}

/**
 * Execute a Slack action for an agent
 */
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
      if (!channel) {
        // Try DM
        if (action.recipient) {
          const recipientAgent = ow.agents.get(action.recipient);
          if (recipientAgent) {
            const dmChannel = createDMChannel(agentEid, recipientAgent.eid, agent.name, recipientAgent.name);
            const msg = sendMessage(ow.world, dmChannel.id, agentEid, agent.name, action.message);
            return msg ? `Sent DM to ${action.recipient}: "${action.message}"` : "Failed to send DM";
          }
        }
        return `Error: Channel #${action.channel} not found`;
      }
      const msg = sendMessage(ow.world, channel.id, agentEid, agent.name, action.message);
      return msg ? `Posted in #${action.channel}: "${action.message}"` : "Failed to send message";
    }

    case "slack_read": {
      if (!action.channel) {
        return "Error: Need channel name";
      }
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

    case "slack_join_channel": {
      if (!action.channel) return "Error: Need channel name";
      const channel = getChannelByName(action.channel);
      if (!channel) return `Error: Channel #${action.channel} not found`;
      joinChannel(channel.id, agentEid);
      return `Joined #${action.channel}`;
    }

    default:
      return "Unknown Slack action";
  }
}

// =============================================================================
// OFFICE SETUP
// =============================================================================

/**
 * Ensure Device dynamic component exists for phones
 */
function ensureDeviceComponent(): void {
  if (!getDynamicComponent("Device")) {
    createDynamicComponent({
      name: "Device",
      description: "Electronic device with owner and state",
      properties: {
        owner: "number",
        type: "string",
        state: "string",
        battery: "number",
      },
    });
  }
}

/**
 * Create a smartphone for an agent
 */
function createSmartphone(ow: OfficeWorld, ownerEid: number, ownerName: string): number {
  const phoneEid = createObjectEntity(ow.world, {
    name: `${ownerName}'s Smartphone`,
    description: `A modern smartphone belonging to ${ownerName}. Has Slack installed.`,
    material: "aluminum",
    weight: 0.2,
    portable: true,
    traits: ["device", "communication", "usable", "browsable", "callable", "textable"],
  });

  ensureDeviceComponent();
  setDynamicComponentValue("Device", phoneEid, "owner", ownerEid);
  setDynamicComponentValue("Device", phoneEid, "type", "smartphone");
  setDynamicComponentValue("Device", phoneEid, "state", "powered_on");
  setDynamicComponentValue("Device", phoneEid, "battery", 100);

  return phoneEid;
}

/**
 * Create an office worker agent
 */
function createOfficeWorker(
  ow: OfficeWorld,
  config: {
    name: string;
    role: string;
    roomName: string;
    personality: string;
    goals?: string[];
  }
): OfficeAgent {
  const roomEid = ow.rooms.get(config.roomName.toLowerCase());

  const eid = createAgentEntity(ow.world, {
    name: config.name,
    role: config.role,
    systemPrompt: `You are ${config.name}, ${config.role} at Argos Tech Company.

${config.personality}

You have a smartphone with Slack installed. You can:
- Check Slack for messages from colleagues
- Post messages to channels like #general, #engineering, #random
- Send direct messages to specific people
- Join new channels

When communicating via Slack, be professional but friendly. Use the phone to coordinate with others.

Available Slack channels: #general, #engineering, #random, #announcements
Your colleagues: Check who else is in the office and coordinate with them.`,
    description: `${config.name}, ${config.role}`,
    roomId: roomEid,
  });

  // Create and bind smartphone
  const phoneEid = createSmartphone(ow, eid, config.name);

  const agent: OfficeAgent = {
    eid,
    name: config.name,
    role: config.role,
    phoneEid,
  };

  ow.agents.set(config.name, agent);

  // Initialize enhanced cognition
  initializeEnhancedAgent(eid);

  // Assign goals if provided
  if (config.goals && config.goals.length > 0) {
    for (const goal of config.goals) {
      assignGoal(eid, goal, `${config.name} is ${config.role}. ${config.personality}`);
    }
  }

  return agent;
}

/**
 * Initialize the office world
 */
function initializeOfficeWorld(): OfficeWorld {
  const world = createWorld();
  initializePrefabs(world as any);
  initializeEnhancedAgentSystem();

  const ow: OfficeWorld = {
    world: world as any,
    rooms: new Map(),
    agents: new Map(),
    slackChannels: new Map(),
  };

  // Create office rooms
  const rooms = [
    { name: "Lobby", description: "The main entrance with a reception desk and comfortable seating" },
    { name: "Open Office", description: "A modern open-plan workspace with standing desks and plants" },
    { name: "Break Room", description: "A cozy break room with coffee machine, snacks, and a ping-pong table" },
    { name: "Meeting Room", description: "A glass-walled meeting room with a large screen and whiteboard" },
    { name: "Engineering Corner", description: "The engineering team's area with dual monitors and whiteboards" },
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

  // Initialize Slack workspace
  const workspace = initializeSlackWorkspace("Argos Tech");

  // Create additional channels
  createChannel("engineering", "public", "Engineering team discussions");
  createChannel("watercooler", "public", "Casual chat and office banter");
  createChannel("project-alpha", "private", "Confidential project discussions");

  // Store channel references
  ow.slackChannels.set("general", getChannelByName("general")!);
  ow.slackChannels.set("engineering", getChannelByName("engineering")!);
  ow.slackChannels.set("random", getChannelByName("random")!);
  ow.slackChannels.set("watercooler", getChannelByName("watercooler")!);

  return ow;
}

/**
 * Create the office team
 */
function createOfficeTeam(ow: OfficeWorld): void {
  // Engineering Manager - Organized, likes structure
  const alex = createOfficeWorker(ow, {
    name: "Alex",
    role: "Engineering Manager",
    roomName: "Engineering Corner",
    personality: `You're organized, methodical, and care about team productivity.
You often check in on your team's progress and coordinate via Slack.
You like to keep discussions in appropriate channels.`,
    goals: ["Check on the team's progress for this sprint", "Make sure everyone knows about the standup meeting"],
  });

  // Senior Developer - Helpful, technical
  const Maya = createOfficeWorker(ow, {
    name: "Maya",
    role: "Senior Developer",
    roomName: "Engineering Corner",
    personality: `You're a skilled developer who enjoys helping juniors.
You're active on Slack, sharing knowledge and answering questions.
Sometimes you share interesting tech articles in #engineering.`,
    goals: ["Help Casey with their code review question", "Share an update on the API refactoring"],
  });

  // Junior Developer - Eager, asks questions
  const casey = createOfficeWorker(ow, {
    name: "Casey",
    role: "Junior Developer",
    roomName: "Open Office",
    personality: `You're new to the company and eager to learn.
You ask questions when stuck and try to be proactive.
You like using Slack to reach out to more experienced colleagues.`,
    goals: ["Ask Maya about the code review feedback", "Find out when the next team meeting is"],
  });

  // Product Manager - Communicative, deadline-focused
  const jordan = createOfficeWorker(ow, {
    name: "Jordan",
    role: "Product Manager",
    roomName: "Meeting Room",
    personality: `You keep the team aligned on product goals and deadlines.
You communicate frequently via Slack about priorities and blockers.
You often organize meetings and post updates in #general.`,
    goals: ["Share the updated project timeline", "Schedule a sync with engineering"],
  });

  // Have everyone join the relevant channels
  for (const agent of ow.agents.values()) {
    const generalChannel = getChannelByName("general");
    const randomChannel = getChannelByName("random");

    if (generalChannel) joinChannel(generalChannel.id, agent.eid);
    if (randomChannel) joinChannel(randomChannel.id, agent.eid);

    // Engineering folks join #engineering
    if (["Engineering Manager", "Senior Developer", "Junior Developer"].includes(agent.role)) {
      const engChannel = getChannelByName("engineering");
      if (engChannel) joinChannel(engChannel.id, agent.eid);
    }

    // Set everyone as active
    setPresence(agent.eid, "active");
  }

  log.success("\nOffice team created:");
  for (const agent of ow.agents.values()) {
    log.info(`  - ${agent.name} (${agent.role})`);
  }
}

// =============================================================================
// SIMULATION LOOP
// =============================================================================

/**
 * Run a single simulation cycle for an agent
 */
async function runAgentCycle(
  ow: OfficeWorld,
  agent: OfficeAgent,
  cycleNum: number
): Promise<AgentAction | null> {
  // Build context including Slack status
  const slackContext = formatSlackContextForPrompt(agent.eid);
  const notifications = getPendingNotifications(agent.eid);

  // Add Slack notifications as perceptions
  for (const notif of notifications.slice(0, 3)) {
    queueStimulus({
      targetEid: agent.eid,
      type: "notification",
      content: `[Slack ${notif.type}] ${notif.from}: "${notif.preview.slice(0, 60)}..."`,
      source: "phone",
    } as any);
  }

  try {
    // Use standard cognition with Slack context appended
    const action = await agentThink(ow.world, agent.eid);

    // Process the action
    if (action) {
      // If the agent mentions Slack in their action, interpret it
      if ((action.type as string) === "use_device" || action.type === "use" || action.content?.toLowerCase().includes("slack")) {
        // Parse for Slack intent
        const content = action.content?.toLowerCase() || "";

        // Determine intent more carefully
        // If the content starts with "post" or "send", it's a send action
        // If there's quoted content, it's likely a send action
        const hasQuotedContent = action.content?.includes("'") || action.content?.includes('"');
        const startsWithPost = content.startsWith("post") || content.startsWith("send");
        const isPostIntent = startsWithPost || hasQuotedContent || content.includes("post ") || content.includes("send ");

        // Post/send actions (check first if there's clear post intent)
        if (isPostIntent) {
          // Extract channel and message - look for quoted text
          const channelMatch = content.match(/#(\w+)/);
          const channel = channelMatch ? channelMatch[1] : "general";

          // Try to find a message in quotes (single or double)
          const quotedMatch = action.content?.match(/['"]([^'"]+)['"]/);
          let messageContent: string;

          if (quotedMatch) {
            messageContent = quotedMatch[1];
          } else if (content.includes(":")) {
            // Message might be after a colon
            messageContent = action.content?.split(":").slice(1).join(":").trim() || "Hello team!";
          } else {
            messageContent = action.content?.replace(/#\w+/g, "").replace(/post|send|message|slack|to|on/gi, "").trim() || "Hello team!";
          }

          const result = executeSlackAction(ow, agent.eid, {
            type: "slack_send",
            channel,
            message: messageContent,
          });
          log.slack(`${agent.name}: ${result}`);
        }
        // Check/read actions
        else if (content.includes("check") || content.includes("read") || content.includes("view")) {
          const channelMatch = content.match(/#(\w+)/);
          const channel = channelMatch ? channelMatch[1] : "general";

          const result = executeSlackAction(ow, agent.eid, {
            type: "slack_read",
            channel,
          });
          log.slack(`${agent.name}: ${result}`);
        }
        // Just using phone for Slack - show notifications
        else if (content.includes("slack") || content.includes("notification")) {
          const result = executeSlackAction(ow, agent.eid, {
            type: "slack_check_notifications",
          });
          log.slack(`${agent.name}: ${result}`);
        }
      }
    }

    return action;
  } catch (error) {
    log.error(`  Error for ${agent.name}: ${error}`);
    return null;
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

  for (const listener of listeners) {
    queueStimulus({
      targetEid: listener.eid,
      type: "speech",
      content: `${speakerName} says: "${speech}"`,
      source: speakerName,
    } as any);
    log.thought(`  (${listener.name} hears ${speakerName})`);
  }
}

/**
 * Run the office simulation
 */
async function runSimulation(ow: OfficeWorld, maxCycles: number = 10): Promise<void> {
  log.header("\n" + "=".repeat(70));
  log.header("  OFFICE SIMULATION - STARTING");
  log.header("=".repeat(70) + "\n");

  // Seed some initial Slack activity
  const alex = ow.agents.get("Alex")!;
  const generalChannel = getChannelByName("general")!;

  sendMessage(ow.world, generalChannel.id, alex.eid, alex.name,
    "Good morning team! Don't forget we have standup at 10am. Please update your status on Slack.");

  log.slack(`Alex kicked off the day with a message in #general\n`);

  const agents = Array.from(ow.agents.values());

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    log.header(`\n${"─".repeat(50)}`);
    log.header(`  CYCLE ${cycle}/${maxCycles}`);
    log.header(`${"─".repeat(50)}`);

    for (const agent of agents) {
      log.agent(agent.name, `thinking... (${agent.role})`);

      const action = await runAgentCycle(ow, agent, cycle);

      if (action) {
        const actionStr = action.content
          ? `${action.type}: "${action.content.slice(0, 80)}${action.content.length > 80 ? "..." : ""}"`
          : action.type;
        log.action(`  → ${actionStr}`);

        // Propagate speech to other agents in the same room
        if (action.type === "speak" && action.content) {
          propagateSpeech(ow, agent.eid, agent.name, action.content);
        }
      }

      // Small delay between agents
      await new Promise(r => setTimeout(r, 500));
    }

    // Show Slack summary after each cycle
    log.thought(`\n  ${getSlackSummary()}`);

    // Pause between cycles
    await new Promise(r => setTimeout(r, 1000));
  }

  log.header("\n" + "=".repeat(70));
  log.header("  SIMULATION COMPLETE");
  log.header("=".repeat(70));

  // Final Slack summary
  log.info("\nFinal Slack Activity:");
  log.info(getSlackSummary());
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log.header("\n╔" + "═".repeat(58) + "╗");
  log.header("║" + "  ARGOS OFFICE SIMULATION WITH SLACK  ".padStart(42).padEnd(58) + "║");
  log.header("╚" + "═".repeat(58) + "╝");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    log.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    log.info("Please set the API key in your .env file");
    process.exit(1);
  }

  log.info("\nInitializing office world...");
  const ow = initializeOfficeWorld();
  log.success("✓ Office world created");
  log.info(`  Rooms: ${Array.from(ow.rooms.keys()).join(", ")}`);

  log.info("\nCreating office team...");
  createOfficeTeam(ow);

  log.info("\nSlack workspace ready:");
  log.info(getSlackSummary());

  // Run the simulation
  const cycles = parseInt(process.env.SIMULATION_CYCLES || "5");
  await runSimulation(ow, cycles);
}

main().catch(error => {
  log.error(`Fatal error: ${error}`);
  if (error instanceof Error) {
    console.error(error.stack);
  }
  process.exit(1);
});
