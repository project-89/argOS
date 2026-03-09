/**
 * Slack Bridge - Connects simulation Slack to real Slack
 *
 * Bridges messages between the in-simulation Slack and a real Slack workspace.
 * - Agent messages appear in real Slack channels
 * - Real Slack messages become stimuli for agents
 */

import { App, LogLevel } from "@slack/bolt";
import {
  setExternalBridge,
  handleExternalMessage,
  getChannelByName,
  joinChannel,
  type SlackChannel,
} from "./slack-system";
import type { World } from "../ecs/world";

// =============================================================================
// CONFIGURATION
// =============================================================================

// Map simulation channel names to real Slack channel IDs
const CHANNEL_MAP: Record<string, string> = {
  "general": "C0A962VUK4H",  // #sim-general in real Slack
};

// Reverse map for incoming messages (real Slack channel ID → simulation channel name)
const REVERSE_CHANNEL_MAP: Record<string, string> = {
  "C0A962VUK4H": "general",  // #sim-general → general
};

// Cache for user names
const userNameCache = new Map<string, string>();

// =============================================================================
// SLACK APP
// =============================================================================

let app: App | null = null;
let world: World | null = null;
let bridgeEnabled = false;

/**
 * Initialize the Slack bridge
 */
export async function initializeSlackBridge(
  simulationWorld: World,
  channelMapping?: Record<string, string>
): Promise<App> {
  world = simulationWorld;

  // Use provided mapping or default
  if (channelMapping) {
    Object.assign(CHANNEL_MAP, channelMapping);
  }

  // Build reverse map
  for (const [simName, realId] of Object.entries(CHANNEL_MAP)) {
    REVERSE_CHANNEL_MAP[realId] = simName;
  }

  // Create Slack app
  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.WARN, // Reduced from DEBUG to avoid noise
  });

  // Log ALL incoming events for debugging
  app.use(async ({ event, next }: any) => {
    if (event) {
      console.log(`[SlackBridge] 🔔 RAW EVENT: type=${event.type}, channel=${(event as any).channel || 'N/A'}`);
    }
    await next();
  });

  // Set up outgoing bridge (simulation → real Slack)
  setExternalBridge(async (message, channel) => {
    if (!bridgeEnabled || !app) return;

    const realChannelId = CHANNEL_MAP[channel.name];
    if (!realChannelId) {
      console.log(`[SlackBridge] No mapping for channel: ${channel.name}`);
      return;
    }

    try {
      // With chat:write.customize scope, username and icon_emoji will display properly
      await app.client.chat.postMessage({
        channel: realChannelId,
        text: message.content,
        username: `${message.authorName} (AI)`,
        icon_emoji: ":robot_face:",
      });
      console.log(`[SlackBridge] → Real Slack #${channel.name}: ${message.authorName}: ${message.content.slice(0, 50)}...`);
    } catch (error) {
      console.error(`[SlackBridge] Error posting to Slack:`, error);
    }
  });

  // Set up incoming bridge (real Slack → simulation)
  app.message(async ({ message, client }) => {
    console.log(`[SlackBridge] 📨 Received message event from channel: ${message.channel}`);

    if (!bridgeEnabled || !world) {
      console.log(`[SlackBridge] Bridge not ready (enabled=${bridgeEnabled}, world=${!!world})`);
      return;
    }

    // Ignore bot messages and message edits
    if (message.subtype) {
      console.log(`[SlackBridge] Ignoring message with subtype: ${message.subtype}`);
      return;
    }
    if (!("user" in message) || !("text" in message)) {
      console.log(`[SlackBridge] Message missing user or text`);
      return;
    }

    // Get channel name
    const simChannelName = REVERSE_CHANNEL_MAP[message.channel];
    if (!simChannelName) {
      console.log(`[SlackBridge] Channel ${message.channel} not mapped. Known mappings:`, REVERSE_CHANNEL_MAP);
      return;
    }

    // Get user name
    let userName = userNameCache.get(message.user);
    if (!userName) {
      try {
        const userInfo = await client.users.info({ user: message.user });
        userName = userInfo.user?.real_name || userInfo.user?.name || "Unknown";
        userNameCache.set(message.user, userName);
      } catch {
        userName = "Unknown";
      }
    }

    console.log(`[SlackBridge] ← INCOMING from Real Slack #${simChannelName}: ${userName}: "${message.text}"`);

    // Inject into simulation
    handleExternalMessage(world, simChannelName, userName, message.text || "");
  });

  // Handle app mentions
  app.event("app_mention", async ({ event, client }) => {
    if (!bridgeEnabled || !world) return;

    const simChannelName = REVERSE_CHANNEL_MAP[event.channel];
    if (!simChannelName) return;

    const userId = event.user || "unknown";
    let userName = userNameCache.get(userId);
    if (!userName) {
      try {
        const userInfo = await client.users.info({ user: userId });
        userName = userInfo.user?.real_name || userInfo.user?.name || "Unknown";
        userNameCache.set(userId, userName);
      } catch {
        userName = "Unknown";
      }
    }

    console.log(`[SlackBridge] ← Mention in #${simChannelName}: ${userName}: ${event.text?.slice(0, 50)}...`);
    handleExternalMessage(world, simChannelName, userName, event.text || "");
  });

  console.log("[SlackBridge] Initialized");
  return app;
}

/**
 * Start the Slack bridge (connect to Slack)
 */
export async function startSlackBridge(): Promise<void> {
  if (!app) {
    throw new Error("Slack bridge not initialized. Call initializeSlackBridge first.");
  }

  await app.start();
  bridgeEnabled = true;
  console.log("[SlackBridge] Connected to Slack! Bridge is now active.");

  // Verify channel mapping on startup
  try {
    const result = await app.client.conversations.list({ types: "public_channel", limit: 100 });
    console.log("[SlackBridge] Verifying channel mappings...");
    for (const [simName, realId] of Object.entries(CHANNEL_MAP)) {
      const channel = result.channels?.find(c => c.id === realId);
      if (channel) {
        console.log(`[SlackBridge] ✓ ${simName} → #${channel.name} (${realId})`);
      } else {
        console.log(`[SlackBridge] ✗ ${simName} → ${realId} (NOT FOUND - check channel ID!)`);
      }
    }
  } catch (err) {
    console.log("[SlackBridge] Could not verify channels:", err);
  }
}

/**
 * Stop the Slack bridge
 */
export async function stopSlackBridge(): Promise<void> {
  bridgeEnabled = false;
  if (app) {
    await app.stop();
    console.log("[SlackBridge] Disconnected from Slack");
  }
}

/**
 * Check if bridge is active
 */
export function isBridgeActive(): boolean {
  return bridgeEnabled;
}

/**
 * Add a channel mapping
 */
export function mapChannel(simChannelName: string, realChannelId: string): void {
  CHANNEL_MAP[simChannelName] = realChannelId;
  REVERSE_CHANNEL_MAP[realChannelId] = simChannelName;
  console.log(`[SlackBridge] Mapped #${simChannelName} ↔ ${realChannelId}`);
}

/**
 * Auto-discover and map channels by name
 */
export async function autoMapChannels(): Promise<number> {
  if (!app) {
    throw new Error("Slack bridge not initialized");
  }

  let mapped = 0;

  try {
    const result = await app.client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
    });

    for (const channel of result.channels || []) {
      if (channel.name && channel.id) {
        // Skip if we already have a mapping for this simulation channel
        if (CHANNEL_MAP[channel.name]) {
          console.log(`[SlackBridge] Skipping auto-map for #${channel.name} (already mapped)`);
          continue;
        }

        // Check if we have a simulation channel with this name
        const simChannel = getChannelByName(channel.name);
        if (simChannel) {
          mapChannel(channel.name, channel.id);
          mapped++;
        }
      }
    }

    console.log(`[SlackBridge] Auto-mapped ${mapped} channels`);
  } catch (error) {
    console.error("[SlackBridge] Error auto-mapping channels:", error);
  }

  return mapped;
}

/**
 * Send a direct message to Slack (utility function)
 */
export async function sendToSlack(channelName: string, text: string, username?: string): Promise<boolean> {
  if (!app) return false;

  const channelId = CHANNEL_MAP[channelName];
  if (!channelId) {
    console.log(`[SlackBridge] No mapping for channel: ${channelName}`);
    return false;
  }

  try {
    await app.client.chat.postMessage({
      channel: channelId,
      text,
      username: username || "Argos Simulation",
      icon_emoji: ":robot_face:",
    });
    return true;
  } catch (error) {
    console.error("[SlackBridge] Error sending message:", error);
    return false;
  }
}
