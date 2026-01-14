/**
 * Spirit Messaging System
 *
 * A complete messaging infrastructure for spirit-to-spirit communication.
 * Supports:
 * - Hierarchical messaging (reports up, directives down)
 * - Peer-to-peer messaging (request/response)
 * - Cross-domain communication
 * - Event subscriptions
 * - Message routing and tracking
 *
 * Message Flow:
 * - Reports: Spirit → Superior → GodAI
 * - Directives: GodAI → Archangels → Angels → Daemons
 * - Requests: Any spirit → Any spirit (with authority check)
 * - Broadcasts: Spirit → All spirits in domain/hierarchy
 */

import type { SpiritRegistry, SpiritState } from "./spirit-registry";

// =============================================================================
// MESSAGE TYPES
// =============================================================================

export type MessageType =
  | "report"      // Observation report (upward)
  | "directive"   // Command from superior (downward)
  | "request"     // Request for info/action (any direction)
  | "response"    // Response to request
  | "alert"       // Urgent notification
  | "broadcast"   // To all in scope
  | "query"       // Simple data query
  | "status";     // Status update

export type MessagePriority = "low" | "normal" | "high" | "urgent";

export interface SpiritMessage {
  id: string;
  type: MessageType;
  from: number;           // Sender spirit EID
  fromName: string;       // Sender name for logging
  to: number | "godai" | "broadcast";  // Recipient EID, godai, or broadcast
  toName?: string;        // Recipient name
  domain?: string;        // For domain-scoped broadcasts

  subject: string;
  content: string;
  data?: any;             // Structured payload

  priority: MessagePriority;
  timestamp: number;

  // Request/response correlation
  correlationId?: string; // Links responses to requests
  requiresResponse?: boolean;
  responseDeadline?: number;

  // Tracking
  acknowledged?: boolean;
  processedAt?: number;
}

export interface PendingRequest {
  message: SpiritMessage;
  resolve: (response: SpiritMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// =============================================================================
// MESSAGE ROUTER
// =============================================================================

// =============================================================================
// SERVICE/CAPABILITY TYPES
// =============================================================================

export type SpiritCapability =
  | "system_maintenance"    // Can repair/modify systems (Artificer)
  | "system_design"         // Can design/create new systems (Architect)
  | "monitoring"            // Watches and reports anomalies (Watcher)
  | "agent_control"         // Can modify agent states (Manager)
  | "narrative_control"     // Controls story/tension (Narrator)
  | "social_dynamics"       // Tracks relationships (Sociologist)
  | "environment"           // Controls weather/ecology
  | "visual"                // Handles rendering/sprites
  | string;                 // Custom capabilities

export interface ServiceRegistration {
  spiritEid: number;
  spiritName: string;
  capability: SpiritCapability;
  priority: number;         // Higher = preferred when multiple handlers
  description?: string;
}

// =============================================================================
// MESSAGE ROUTER
// =============================================================================

class SpiritMessageRouter {
  private messageIdCounter = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageLog: SpiritMessage[] = [];
  private subscriptions = new Map<string, Set<number>>(); // event -> spirit EIDs
  private registry: SpiritRegistry | null = null;

  // Message queues by recipient
  private queues = new Map<number | string, SpiritMessage[]>();
  private godAIQueue: SpiritMessage[] = [];

  // Service/Capability registry for intelligent routing
  private services = new Map<SpiritCapability, ServiceRegistration[]>();
  private spiritCapabilities = new Map<number, Set<SpiritCapability>>(); // eid -> capabilities

  setRegistry(registry: SpiritRegistry): void {
    this.registry = registry;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${++this.messageIdCounter}`;
  }

  // ---------------------------------------------------------------------------
  // CORE MESSAGING
  // ---------------------------------------------------------------------------

  /**
   * Send a message to a specific recipient
   */
  send(message: Omit<SpiritMessage, "id" | "timestamp">): SpiritMessage {
    const fullMessage: SpiritMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: Date.now(),
    };

    // Route to appropriate queue
    if (fullMessage.to === "godai") {
      this.godAIQueue.push(fullMessage);
    } else if (fullMessage.to === "broadcast") {
      this.broadcastMessage(fullMessage);
    } else {
      const queue = this.queues.get(fullMessage.to) || [];
      queue.push(fullMessage);
      this.queues.set(fullMessage.to, queue);
    }

    // Log for audit
    this.messageLog.push(fullMessage);
    if (this.messageLog.length > 1000) {
      this.messageLog = this.messageLog.slice(-500);
    }

    console.log(`[SpiritMsg] ${fullMessage.fromName} → ${fullMessage.toName || fullMessage.to}: ${fullMessage.subject}`);

    return fullMessage;
  }

  /**
   * Send a request and wait for response (with timeout)
   */
  async request(
    message: Omit<SpiritMessage, "id" | "timestamp" | "correlationId" | "requiresResponse">,
    timeoutMs: number = 30000
  ): Promise<SpiritMessage> {
    const correlationId = this.generateCorrelationId();

    const fullMessage = this.send({
      ...message,
      type: "request",
      correlationId,
      requiresResponse: true,
      responseDeadline: Date.now() + timeoutMs,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout: ${message.subject}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, {
        message: fullMessage,
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Send a response to a request
   */
  respond(originalMessage: SpiritMessage, response: {
    content: string;
    data?: any;
    from: number;
    fromName: string;
  }): SpiritMessage {
    if (!originalMessage.correlationId) {
      throw new Error("Cannot respond to message without correlationId");
    }

    const responseMessage = this.send({
      type: "response",
      from: response.from,
      fromName: response.fromName,
      to: originalMessage.from,
      toName: originalMessage.fromName,
      subject: `RE: ${originalMessage.subject}`,
      content: response.content,
      data: response.data,
      priority: originalMessage.priority,
      correlationId: originalMessage.correlationId,
    });

    // Resolve pending request if exists
    const pending = this.pendingRequests.get(originalMessage.correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(responseMessage);
      this.pendingRequests.delete(originalMessage.correlationId);
    }

    return responseMessage;
  }

  // ---------------------------------------------------------------------------
  // HIERARCHICAL MESSAGING
  // ---------------------------------------------------------------------------

  /**
   * Report to superior (upward communication)
   */
  report(
    from: SpiritState,
    subject: string,
    content: string,
    data?: any,
    priority: MessagePriority = "normal"
  ): SpiritMessage {
    const to = from.superiorEid || "godai";
    const toName = to === "godai" ? "GodAI" :
      this.registry?.spirits.get(to)?.definition.name || "Superior";

    return this.send({
      type: "report",
      from: from.eid,
      fromName: from.definition.name,
      to,
      toName,
      subject,
      content,
      data,
      priority,
    });
  }

  /**
   * Send directive to subordinate (downward communication)
   */
  directive(
    from: SpiritState | "godai",
    to: SpiritState,
    subject: string,
    content: string,
    data?: any,
    priority: MessagePriority = "normal"
  ): SpiritMessage {
    const fromEid = from === "godai" ? 0 : from.eid;
    const fromName = from === "godai" ? "GodAI" : from.definition.name;

    return this.send({
      type: "directive",
      from: fromEid,
      fromName,
      to: to.eid,
      toName: to.definition.name,
      subject,
      content,
      data,
      priority,
    });
  }

  // ---------------------------------------------------------------------------
  // PEER-TO-PEER MESSAGING
  // ---------------------------------------------------------------------------

  /**
   * Query another spirit for information
   */
  async query(
    from: SpiritState,
    to: SpiritState | number,
    question: string,
    data?: any,
    timeoutMs: number = 10000
  ): Promise<SpiritMessage> {
    const toEid = typeof to === "number" ? to : to.eid;
    const toSpirit = this.registry?.spirits.get(toEid);

    return this.request({
      type: "query",
      from: from.eid,
      fromName: from.definition.name,
      to: toEid,
      toName: toSpirit?.definition.name || `Spirit_${toEid}`,
      subject: "Query",
      content: question,
      data,
      priority: "normal",
    }, timeoutMs);
  }

  /**
   * Send alert to specific spirit or broadcast
   */
  alert(
    from: SpiritState,
    to: SpiritState | number | "broadcast",
    subject: string,
    content: string,
    data?: any,
    domain?: string
  ): SpiritMessage {
    const toValue = typeof to === "object" ? to.eid : to;
    const toName = typeof to === "object" ? to.definition.name :
      to === "broadcast" ? `Broadcast(${domain || "all"})` :
        this.registry?.spirits.get(to)?.definition.name || `Spirit_${to}`;

    return this.send({
      type: "alert",
      from: from.eid,
      fromName: from.definition.name,
      to: toValue,
      toName,
      domain,
      subject,
      content,
      data,
      priority: "urgent",
    });
  }

  // ---------------------------------------------------------------------------
  // BROADCAST & SUBSCRIPTIONS
  // ---------------------------------------------------------------------------

  /**
   * Broadcast message to all spirits in scope
   */
  private broadcastMessage(message: SpiritMessage): void {
    if (!this.registry) return;

    const recipients: SpiritState[] = [];

    if (message.domain) {
      // Domain-scoped broadcast - byDomain stores eid arrays
      const domainEids = this.registry.byDomain.get(message.domain as any);
      if (domainEids) {
        for (const eid of domainEids) {
          if (eid !== message.from) {
            const spirit = this.registry.spirits.get(eid);
            if (spirit) recipients.push(spirit);
          }
        }
      }
    } else {
      // Global broadcast
      for (const spirit of this.registry.spirits.values()) {
        if (spirit.eid !== message.from) {
          recipients.push(spirit);
        }
      }
    }

    // Send to each recipient
    for (const spirit of recipients) {
      const queue = this.queues.get(spirit.eid) || [];
      queue.push({ ...message, to: spirit.eid });
      this.queues.set(spirit.eid, queue);
    }
  }

  /**
   * Subscribe to events from other spirits
   */
  subscribe(spiritEid: number, eventType: string): void {
    const subs = this.subscriptions.get(eventType) || new Set();
    subs.add(spiritEid);
    this.subscriptions.set(eventType, subs);
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(spiritEid: number, eventType: string): void {
    const subs = this.subscriptions.get(eventType);
    if (subs) {
      subs.delete(spiritEid);
    }
  }

  /**
   * Emit event to subscribers
   */
  emit(eventType: string, from: SpiritState, data: any): void {
    const subscribers = this.subscriptions.get(eventType);
    if (!subscribers || subscribers.size === 0) return;

    for (const subscriberEid of subscribers) {
      if (subscriberEid === from.eid) continue;

      this.send({
        type: "broadcast",
        from: from.eid,
        fromName: from.definition.name,
        to: subscriberEid,
        toName: this.registry?.spirits.get(subscriberEid)?.definition.name,
        subject: `Event: ${eventType}`,
        content: `Event notification: ${eventType}`,
        data,
        priority: "normal",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // QUEUE MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Get messages for a spirit
   */
  getMessages(spiritEid: number): SpiritMessage[] {
    return this.queues.get(spiritEid) || [];
  }

  /**
   * Get and clear messages for a spirit
   */
  popMessages(spiritEid: number): SpiritMessage[] {
    const messages = this.queues.get(spiritEid) || [];
    this.queues.set(spiritEid, []);
    return messages;
  }

  /**
   * Get messages for GodAI
   */
  getGodAIMessages(): SpiritMessage[] {
    return this.godAIQueue;
  }

  /**
   * Get and clear GodAI messages
   */
  popGodAIMessages(): SpiritMessage[] {
    const messages = [...this.godAIQueue];
    this.godAIQueue = [];
    return messages;
  }

  /**
   * Check if spirit has pending messages
   */
  hasPendingMessages(spiritEid: number): boolean {
    const queue = this.queues.get(spiritEid);
    return queue ? queue.length > 0 : false;
  }

  /**
   * Get pending requests (awaiting response)
   */
  getPendingRequests(): SpiritMessage[] {
    return Array.from(this.pendingRequests.values()).map(p => p.message);
  }

  // ---------------------------------------------------------------------------
  // LOGGING & DEBUG
  // ---------------------------------------------------------------------------

  /**
   * Get recent message log
   */
  getMessageLog(limit: number = 50): SpiritMessage[] {
    return this.messageLog.slice(-limit);
  }

  /**
   * Get messages between two spirits
   */
  getConversation(spirit1Eid: number, spirit2Eid: number, limit: number = 20): SpiritMessage[] {
    return this.messageLog
      .filter(m =>
        (m.from === spirit1Eid && m.to === spirit2Eid) ||
        (m.from === spirit2Eid && m.to === spirit1Eid)
      )
      .slice(-limit);
  }

  /**
   * Get summary for debugging
   */
  getSummary(): string {
    const lines = [
      "=== Spirit Messaging Summary ===",
      `Total messages logged: ${this.messageLog.length}`,
      `Pending requests: ${this.pendingRequests.size}`,
      `GodAI queue: ${this.godAIQueue.length}`,
      "",
      "Queue sizes:",
    ];

    for (const [spiritEid, queue] of this.queues) {
      if (queue.length > 0) {
        const name = this.registry?.spirits.get(spiritEid as number)?.definition.name || spiritEid;
        lines.push(`  ${name}: ${queue.length} messages`);
      }
    }

    lines.push("", "Subscriptions:");
    for (const [event, subs] of this.subscriptions) {
      lines.push(`  ${event}: ${subs.size} subscribers`);
    }

    return lines.join("\n");
  }

  /**
   * Clear all state (for testing)
   */
  reset(): void {
    this.messageIdCounter = 0;
    this.pendingRequests.clear();
    this.messageLog = [];
    this.subscriptions.clear();
    this.queues.clear();
    this.godAIQueue = [];
    // Note: Don't clear services - they persist across resets
  }

  // ---------------------------------------------------------------------------
  // SERVICE REGISTRY - Capability-based Routing
  // ---------------------------------------------------------------------------

  /**
   * Register a spirit's capability (what services it provides)
   */
  registerCapability(
    spirit: SpiritState,
    capability: SpiritCapability,
    priority: number = 1,
    description?: string
  ): void {
    const registration: ServiceRegistration = {
      spiritEid: spirit.eid,
      spiritName: spirit.definition.name,
      capability,
      priority,
      description,
    };

    // Add to capability -> spirits map
    const handlers = this.services.get(capability) || [];
    // Remove existing registration for this spirit+capability
    const filtered = handlers.filter(h => h.spiritEid !== spirit.eid);
    filtered.push(registration);
    // Sort by priority (highest first)
    filtered.sort((a, b) => b.priority - a.priority);
    this.services.set(capability, filtered);

    // Add to spirit -> capabilities map
    const caps = this.spiritCapabilities.get(spirit.eid) || new Set();
    caps.add(capability);
    this.spiritCapabilities.set(spirit.eid, caps);

    console.log(`[SpiritService] ${spirit.definition.name} registered: ${capability} (priority: ${priority})`);
  }

  /**
   * Unregister a spirit's capability
   */
  unregisterCapability(spiritEid: number, capability: SpiritCapability): void {
    const handlers = this.services.get(capability);
    if (handlers) {
      const filtered = handlers.filter(h => h.spiritEid !== spiritEid);
      if (filtered.length > 0) {
        this.services.set(capability, filtered);
      } else {
        this.services.delete(capability);
      }
    }

    const caps = this.spiritCapabilities.get(spiritEid);
    if (caps) {
      caps.delete(capability);
    }
  }

  /**
   * Find spirits that can handle a specific capability
   */
  findHandlers(capability: SpiritCapability): ServiceRegistration[] {
    return this.services.get(capability) || [];
  }

  /**
   * Get the best handler for a capability (highest priority)
   */
  getBestHandler(capability: SpiritCapability): ServiceRegistration | undefined {
    const handlers = this.services.get(capability);
    return handlers?.[0]; // Already sorted by priority
  }

  /**
   * Get all capabilities a spirit has registered
   */
  getSpiritCapabilities(spiritEid: number): SpiritCapability[] {
    const caps = this.spiritCapabilities.get(spiritEid);
    return caps ? Array.from(caps) : [];
  }

  /**
   * Route a message to the best handler for a capability
   * Returns the sent message, or undefined if no handler found
   */
  routeToCapability(
    from: SpiritState,
    capability: SpiritCapability,
    subject: string,
    content: string,
    data?: any,
    priority: MessagePriority = "normal"
  ): SpiritMessage | undefined {
    const handler = this.getBestHandler(capability);
    if (!handler) {
      console.log(`[SpiritRouter] No handler found for capability: ${capability}`);
      return undefined;
    }

    const targetSpirit = this.registry?.spirits.get(handler.spiritEid);
    if (!targetSpirit) {
      console.log(`[SpiritRouter] Handler spirit ${handler.spiritEid} not found in registry`);
      return undefined;
    }

    return this.send({
      type: "request",
      from: from.eid,
      fromName: from.definition.name,
      to: handler.spiritEid,
      toName: handler.spiritName,
      subject: `[${capability}] ${subject}`,
      content,
      data: { ...data, requestedCapability: capability },
      priority,
    });
  }

  /**
   * Send a request to a capability handler and wait for response
   */
  async requestFromCapability(
    from: SpiritState,
    capability: SpiritCapability,
    subject: string,
    content: string,
    data?: any,
    timeoutMs: number = 30000
  ): Promise<SpiritMessage | undefined> {
    const handler = this.getBestHandler(capability);
    if (!handler) {
      console.log(`[SpiritRouter] No handler found for capability: ${capability}`);
      return undefined;
    }

    return this.request({
      type: "request",
      from: from.eid,
      fromName: from.definition.name,
      to: handler.spiritEid,
      toName: handler.spiritName,
      subject: `[${capability}] ${subject}`,
      content,
      data: { ...data, requestedCapability: capability },
      priority: "normal",
    }, timeoutMs);
  }

  /**
   * Get a summary of all registered services
   */
  getServicesSummary(): string {
    const lines = [
      "=== Spirit Services Registry ===",
      `Total capabilities: ${this.services.size}`,
      "",
    ];

    for (const [capability, handlers] of this.services) {
      lines.push(`${capability}:`);
      for (const h of handlers) {
        lines.push(`  - ${h.spiritName} (priority: ${h.priority})${h.description ? ` - ${h.description}` : ""}`);
      }
    }

    return lines.join("\n");
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const spiritRouter = new SpiritMessageRouter();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Initialize the router with a spirit registry
 */
export function initializeSpiritMessaging(registry: SpiritRegistry): void {
  spiritRouter.setRegistry(registry);
}

/**
 * Spirit reports to their superior
 */
export function spiritReport(
  from: SpiritState,
  subject: string,
  content: string,
  data?: any,
  priority?: MessagePriority
): SpiritMessage {
  return spiritRouter.report(from, subject, content, data, priority);
}

/**
 * Send directive from GodAI or superior spirit
 */
export function spiritDirective(
  from: SpiritState | "godai",
  to: SpiritState,
  subject: string,
  content: string,
  data?: any
): SpiritMessage {
  return spiritRouter.directive(from, to, subject, content, data);
}

/**
 * Query another spirit (async with timeout)
 */
export async function spiritQuery(
  from: SpiritState,
  to: SpiritState | number,
  question: string,
  data?: any
): Promise<SpiritMessage> {
  return spiritRouter.query(from, to, question, data);
}

/**
 * Respond to a query/request
 */
export function spiritRespond(
  originalMessage: SpiritMessage,
  from: SpiritState,
  content: string,
  data?: any
): SpiritMessage {
  return spiritRouter.respond(originalMessage, {
    from: from.eid,
    fromName: from.definition.name,
    content,
    data,
  });
}

/**
 * Broadcast alert
 */
export function spiritAlert(
  from: SpiritState,
  subject: string,
  content: string,
  data?: any,
  domain?: string
): SpiritMessage {
  return spiritRouter.alert(from, "broadcast", subject, content, data, domain);
}

/**
 * Subscribe to events
 */
export function spiritSubscribe(spirit: SpiritState, eventType: string): void {
  spiritRouter.subscribe(spirit.eid, eventType);
}

/**
 * Emit event to subscribers
 */
export function spiritEmit(from: SpiritState, eventType: string, data: any): void {
  spiritRouter.emit(eventType, from, data);
}

/**
 * Get pending messages for a spirit to process
 */
export function getMessagesForSpirit(spiritEid: number): SpiritMessage[] {
  return spiritRouter.popMessages(spiritEid);
}

/**
 * Get pending messages for GodAI
 */
export function getMessagesForGodAI(): SpiritMessage[] {
  return spiritRouter.popGodAIMessages();
}

// =============================================================================
// CAPABILITY-BASED ROUTING FUNCTIONS
// =============================================================================

/**
 * Register a spirit's capability (what services it provides)
 */
export function registerSpiritCapability(
  spirit: SpiritState,
  capability: SpiritCapability,
  priority: number = 1,
  description?: string
): void {
  spiritRouter.registerCapability(spirit, capability, priority, description);
}

/**
 * Find all spirits that can handle a capability
 */
export function findCapabilityHandlers(capability: SpiritCapability): ServiceRegistration[] {
  return spiritRouter.findHandlers(capability);
}

/**
 * Get the best handler for a capability
 */
export function getBestCapabilityHandler(capability: SpiritCapability): ServiceRegistration | undefined {
  return spiritRouter.getBestHandler(capability);
}

/**
 * Route a message to whatever spirit handles a capability
 * Example: routeToCapability(watcher, "system_maintenance", "Help needed", "System X is broken")
 */
export function routeToCapability(
  from: SpiritState,
  capability: SpiritCapability,
  subject: string,
  content: string,
  data?: any
): SpiritMessage | undefined {
  return spiritRouter.routeToCapability(from, capability, subject, content, data);
}

/**
 * Request from a capability handler and wait for response
 */
export async function requestFromCapability(
  from: SpiritState,
  capability: SpiritCapability,
  subject: string,
  content: string,
  data?: any,
  timeoutMs?: number
): Promise<SpiritMessage | undefined> {
  return spiritRouter.requestFromCapability(from, capability, subject, content, data, timeoutMs);
}

/**
 * Get a summary of all registered services
 */
export function getServicesRegistry(): string {
  return spiritRouter.getServicesSummary();
}
