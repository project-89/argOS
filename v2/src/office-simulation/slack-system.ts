/**
 * In-Simulation Slack System
 *
 * A simulated Slack-like messaging system that agents can use
 * to communicate asynchronously. Can also bridge to real Slack
 * via MCP for external integration.
 *
 * Features:
 * - Channels (public, private)
 * - Direct messages
 * - Threads
 * - Reactions
 * - Message history
 * - Notifications as stimuli
 */

import type { World } from "../ecs/world";
import { queueStimulus } from "../cognition/cognition-system";

// =============================================================================
// TYPES
// =============================================================================

export interface SlackMessage {
  id: string;
  channelId: string;
  threadId?: string; // If this is a reply
  authorEid: number;
  authorName: string;
  content: string;
  timestamp: number;
  reactions: Map<string, number[]>; // emoji -> [eid1, eid2, ...]
  edited?: boolean;
  editedAt?: number;
}

export interface SlackChannel {
  id: string;
  name: string;
  type: "public" | "private" | "dm";
  description?: string;
  members: number[]; // Agent EIDs
  messages: SlackMessage[];
  createdAt: number;
  topic?: string;
  pinnedMessages: string[]; // Message IDs
}

export interface SlackWorkspace {
  id: string;
  name: string;
  channels: Map<string, SlackChannel>;
  userPresence: Map<number, "active" | "away" | "dnd">;
  unreadCounts: Map<string, Map<number, number>>; // channelId -> (eid -> unreadCount)
}

export interface SlackNotification {
  type: "message" | "mention" | "dm" | "reaction" | "channel_invite";
  channelId: string;
  channelName: string;
  messageId?: string;
  from: string;
  preview: string;
  timestamp: number;
}

// =============================================================================
// STATE
// =============================================================================

let workspace: SlackWorkspace | null = null;
let messageIdCounter = 0;
let channelIdCounter = 0;

// Notification queue per agent
const pendingNotifications = new Map<number, SlackNotification[]>();

// External Slack bridge callback (for MCP integration)
let externalBridgeCallback: ((message: SlackMessage, channel: SlackChannel) => Promise<void>) | null = null;

// =============================================================================
// WORKSPACE MANAGEMENT
// =============================================================================

/**
 * Initialize the Slack workspace
 */
export function initializeSlackWorkspace(name: string): SlackWorkspace {
  workspace = {
    id: `workspace_${Date.now()}`,
    name,
    channels: new Map(),
    userPresence: new Map(),
    unreadCounts: new Map(),
  };

  // Create default channels
  createChannel("general", "public", "General discussion for the whole team");
  createChannel("random", "public", "Non-work banter and water cooler chat");
  createChannel("announcements", "public", "Important company announcements");

  console.log(`[Slack] Workspace "${name}" initialized with default channels`);

  return workspace;
}

/**
 * Get the workspace
 */
export function getWorkspace(): SlackWorkspace | null {
  return workspace;
}

// =============================================================================
// CHANNEL MANAGEMENT
// =============================================================================

/**
 * Create a new channel
 */
export function createChannel(
  name: string,
  type: SlackChannel["type"],
  description?: string,
  members?: number[]
): SlackChannel {
  if (!workspace) {
    throw new Error("Workspace not initialized");
  }

  const channel: SlackChannel = {
    id: `channel_${++channelIdCounter}_${Date.now()}`,
    name,
    type,
    description,
    members: members || [],
    messages: [],
    createdAt: Date.now(),
    pinnedMessages: [],
  };

  workspace.channels.set(channel.id, channel);
  workspace.unreadCounts.set(channel.id, new Map());

  console.log(`[Slack] Channel #${name} created`);

  return channel;
}

/**
 * Create a DM channel between two agents
 */
export function createDMChannel(agent1Eid: number, agent2Eid: number, agent1Name: string, agent2Name: string): SlackChannel {
  if (!workspace) {
    throw new Error("Workspace not initialized");
  }

  // Check if DM already exists
  for (const channel of workspace.channels.values()) {
    if (channel.type === "dm" &&
        channel.members.includes(agent1Eid) &&
        channel.members.includes(agent2Eid)) {
      return channel;
    }
  }

  const channel: SlackChannel = {
    id: `dm_${agent1Eid}_${agent2Eid}_${Date.now()}`,
    name: `${agent1Name}-${agent2Name}`,
    type: "dm",
    members: [agent1Eid, agent2Eid],
    messages: [],
    createdAt: Date.now(),
    pinnedMessages: [],
  };

  workspace.channels.set(channel.id, channel);
  workspace.unreadCounts.set(channel.id, new Map());

  return channel;
}

/**
 * Join a channel
 */
export function joinChannel(channelId: string, agentEid: number): boolean {
  if (!workspace) return false;

  const channel = workspace.channels.get(channelId);
  if (!channel) return false;

  if (!channel.members.includes(agentEid)) {
    channel.members.push(agentEid);
    console.log(`[Slack] Agent ${agentEid} joined #${channel.name}`);
  }

  return true;
}

/**
 * Leave a channel
 */
export function leaveChannel(channelId: string, agentEid: number): boolean {
  if (!workspace) return false;

  const channel = workspace.channels.get(channelId);
  if (!channel) return false;

  channel.members = channel.members.filter(eid => eid !== agentEid);
  return true;
}

/**
 * Get channel by name
 */
export function getChannelByName(name: string): SlackChannel | null {
  if (!workspace) return null;

  for (const channel of workspace.channels.values()) {
    if (channel.name === name) {
      return channel;
    }
  }
  return null;
}

/**
 * Get channels for an agent
 */
export function getAgentChannels(agentEid: number): SlackChannel[] {
  if (!workspace) return [];

  return Array.from(workspace.channels.values()).filter(
    channel => channel.members.includes(agentEid)
  );
}

// =============================================================================
// MESSAGING
// =============================================================================

/**
 * Send a message to a channel
 */
export function sendMessage(
  world: World,
  channelId: string,
  authorEid: number,
  authorName: string,
  content: string,
  threadId?: string
): SlackMessage | null {
  if (!workspace) return null;

  const channel = workspace.channels.get(channelId);
  if (!channel) {
    console.warn(`[Slack] Channel ${channelId} not found`);
    return null;
  }

  // Check if author is a member
  if (!channel.members.includes(authorEid)) {
    console.warn(`[Slack] Agent ${authorEid} is not a member of #${channel.name}`);
    return null;
  }

  const message: SlackMessage = {
    id: `msg_${++messageIdCounter}_${Date.now()}`,
    channelId,
    threadId,
    authorEid,
    authorName,
    content,
    timestamp: Date.now(),
    reactions: new Map(),
  };

  channel.messages.push(message);

  console.log(`[Slack] ${authorName} in #${channel.name}: ${content.slice(0, 50)}${content.length > 50 ? "..." : ""}`);

  // Notify other members
  for (const memberEid of channel.members) {
    if (memberEid === authorEid) continue;

    // Update unread count
    const channelUnreads = workspace.unreadCounts.get(channelId);
    if (channelUnreads) {
      channelUnreads.set(memberEid, (channelUnreads.get(memberEid) || 0) + 1);
    }

    // Check for @mention
    const isMentioned = content.includes(`@${memberEid}`) || content.includes("@here") || content.includes("@channel");

    // Create notification
    const notification: SlackNotification = {
      type: isMentioned ? "mention" : channel.type === "dm" ? "dm" : "message",
      channelId,
      channelName: channel.name,
      messageId: message.id,
      from: authorName,
      preview: content.slice(0, 100),
      timestamp: Date.now(),
    };

    const agentNotifications = pendingNotifications.get(memberEid) || [];
    agentNotifications.push(notification);
    pendingNotifications.set(memberEid, agentNotifications);

    // Queue as stimulus if it's a DM or mention
    if (notification.type === "dm" || notification.type === "mention") {
      queueStimulus({
        targetEid: memberEid,
        type: "notification",
        content: `[Slack ${notification.type === "dm" ? "DM" : "mention"}] ${authorName}: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`,
        source: "slack",
      } as any);
    }
  }

  // Bridge to external Slack if configured
  if (externalBridgeCallback) {
    externalBridgeCallback(message, channel).catch(err => {
      console.error("[Slack] External bridge error:", err);
    });
  }

  return message;
}

/**
 * Edit a message
 */
export function editMessage(
  channelId: string,
  messageId: string,
  newContent: string,
  editorEid: number
): boolean {
  if (!workspace) return false;

  const channel = workspace.channels.get(channelId);
  if (!channel) return false;

  const message = channel.messages.find(m => m.id === messageId);
  if (!message) return false;

  // Only author can edit
  if (message.authorEid !== editorEid) return false;

  message.content = newContent;
  message.edited = true;
  message.editedAt = Date.now();

  return true;
}

/**
 * Add reaction to a message
 */
export function addReaction(
  channelId: string,
  messageId: string,
  emoji: string,
  reactorEid: number
): boolean {
  if (!workspace) return false;

  const channel = workspace.channels.get(channelId);
  if (!channel) return false;

  const message = channel.messages.find(m => m.id === messageId);
  if (!message) return false;

  const reactors = message.reactions.get(emoji) || [];
  if (!reactors.includes(reactorEid)) {
    reactors.push(reactorEid);
    message.reactions.set(emoji, reactors);
  }

  return true;
}

/**
 * Get messages from a channel
 */
export function getChannelMessages(
  channelId: string,
  limit: number = 50,
  before?: number
): SlackMessage[] {
  if (!workspace) return [];

  const channel = workspace.channels.get(channelId);
  if (!channel) return [];

  let messages = channel.messages;

  if (before) {
    messages = messages.filter(m => m.timestamp < before);
  }

  return messages.slice(-limit);
}

/**
 * Get thread messages
 */
export function getThreadMessages(channelId: string, threadId: string): SlackMessage[] {
  if (!workspace) return [];

  const channel = workspace.channels.get(channelId);
  if (!channel) return [];

  const parentMessage = channel.messages.find(m => m.id === threadId);
  if (!parentMessage) return [];

  const replies = channel.messages.filter(m => m.threadId === threadId);
  return [parentMessage, ...replies];
}

// =============================================================================
// NOTIFICATIONS & UNREAD
// =============================================================================

/**
 * Get pending notifications for an agent
 */
export function getPendingNotifications(agentEid: number): SlackNotification[] {
  return pendingNotifications.get(agentEid) || [];
}

/**
 * Clear notifications for an agent
 */
export function clearNotifications(agentEid: number): void {
  pendingNotifications.set(agentEid, []);
}

/**
 * Mark channel as read
 */
export function markChannelAsRead(channelId: string, agentEid: number): void {
  if (!workspace) return;

  const channelUnreads = workspace.unreadCounts.get(channelId);
  if (channelUnreads) {
    channelUnreads.set(agentEid, 0);
  }
}

/**
 * Get unread count for an agent
 */
export function getUnreadCount(agentEid: number): number {
  if (!workspace) return 0;

  let total = 0;
  for (const channelUnreads of workspace.unreadCounts.values()) {
    total += channelUnreads.get(agentEid) || 0;
  }
  return total;
}

/**
 * Get unread count per channel
 */
export function getUnreadByChannel(agentEid: number): Map<string, number> {
  const result = new Map<string, number>();
  if (!workspace) return result;

  for (const [channelId, channelUnreads] of workspace.unreadCounts) {
    const count = channelUnreads.get(agentEid) || 0;
    if (count > 0) {
      const channel = workspace.channels.get(channelId);
      result.set(channel?.name || channelId, count);
    }
  }

  return result;
}

// =============================================================================
// PRESENCE
// =============================================================================

/**
 * Set user presence
 */
export function setPresence(agentEid: number, status: "active" | "away" | "dnd"): void {
  if (!workspace) return;
  workspace.userPresence.set(agentEid, status);
}

/**
 * Get user presence
 */
export function getPresence(agentEid: number): "active" | "away" | "dnd" | "offline" {
  if (!workspace) return "offline";
  return workspace.userPresence.get(agentEid) || "offline";
}

// =============================================================================
// CONTEXT FOR AGENT PROMPTS
// =============================================================================

/**
 * Format Slack context for agent prompt
 */
export function formatSlackContextForPrompt(agentEid: number): string {
  if (!workspace) return "";

  const lines: string[] = ["## Slack"];

  // Unread counts
  const unreads = getUnreadByChannel(agentEid);
  if (unreads.size > 0) {
    lines.push("\n### Unread Messages:");
    for (const [channelName, count] of unreads) {
      lines.push(`- #${channelName}: ${count} new`);
    }
  }

  // Pending notifications (urgent ones)
  const notifications = getPendingNotifications(agentEid);
  const urgentNotifs = notifications.filter(n => n.type === "dm" || n.type === "mention");
  if (urgentNotifs.length > 0) {
    lines.push("\n### Recent Notifications:");
    for (const notif of urgentNotifs.slice(0, 3)) {
      lines.push(`- [${notif.type.toUpperCase()}] ${notif.from} in #${notif.channelName}: "${notif.preview.slice(0, 50)}..."`);
    }
  }

  // Channels
  const channels = getAgentChannels(agentEid);
  if (channels.length > 0) {
    lines.push("\n### Your Channels:");
    for (const channel of channels.filter(c => c.type !== "dm").slice(0, 5)) {
      lines.push(`- #${channel.name}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Format recent messages for agent prompt
 */
export function formatRecentMessagesForPrompt(agentEid: number, channelName: string, limit: number = 10): string {
  const channel = getChannelByName(channelName);
  if (!channel) return `Channel #${channelName} not found`;

  const messages = getChannelMessages(channel.id, limit);
  if (messages.length === 0) return `No messages in #${channelName}`;

  const lines: string[] = [`Recent messages in #${channelName}:`];
  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`[${time}] ${msg.authorName}: ${msg.content}`);
  }

  return lines.join("\n");
}

// =============================================================================
// EXTERNAL BRIDGE
// =============================================================================

/**
 * Set callback for bridging to external Slack
 */
export function setExternalBridge(
  callback: (message: SlackMessage, channel: SlackChannel) => Promise<void>
): void {
  externalBridgeCallback = callback;
  console.log("[Slack] External bridge configured");
}

/**
 * Callback for when external messages arrive (set by office simulation)
 */
let externalMessageCallback: ((memberEid: number, authorName: string, content: string, channelName: string) => void) | null = null;

/**
 * Set callback for handling external messages
 */
export function setExternalMessageHandler(
  callback: (memberEid: number, authorName: string, content: string, channelName: string) => void
): void {
  externalMessageCallback = callback;
}

/**
 * Handle incoming message from external Slack
 */
export function handleExternalMessage(
  world: World,
  channelName: string,
  authorName: string,
  content: string
): void {
  if (!workspace) return;

  const channel = getChannelByName(channelName);
  if (!channel) {
    console.warn(`[Slack] External message for unknown channel: ${channelName}`);
    return;
  }

  const message: SlackMessage = {
    id: `ext_${++messageIdCounter}_${Date.now()}`,
    channelId: channel.id,
    authorEid: -1, // External user
    authorName: `${authorName}`,
    content,
    timestamp: Date.now(),
    reactions: new Map(),
  };

  channel.messages.push(message);

  console.log(`[Slack] External message in #${channelName} from ${authorName}: "${content.slice(0, 50)}..."`);

  // Notify all members via callback (adds perceptions and working memory)
  for (const memberEid of channel.members) {
    if (externalMessageCallback) {
      externalMessageCallback(memberEid, authorName, content, channelName);
    } else {
      // Fallback to stimulus queue
      queueStimulus({
        targetEid: memberEid,
        type: "notification",
        content: `[Slack #${channelName}] ${authorName}: "${content}"`,
        source: "slack_external",
      } as any);
    }
  }
}

// =============================================================================
// SUMMARY
// =============================================================================

export function getSlackSummary(): string {
  if (!workspace) return "Slack workspace not initialized";

  const channels = Array.from(workspace.channels.values());
  const totalMessages = channels.reduce((sum, ch) => sum + ch.messages.length, 0);

  return `Slack Workspace: ${workspace.name}
- Channels: ${channels.filter(c => c.type !== "dm").length}
- DM Conversations: ${channels.filter(c => c.type === "dm").length}
- Total Messages: ${totalMessages}
- Active Users: ${workspace.userPresence.size}`;
}
