/**
 * Affordance-Tool Binding System
 *
 * Connects physical object affordances to MCP tools and actions.
 * When an agent interacts with an object, the affordance determines
 * what tools/actions become available.
 *
 * Example:
 * - Phone object has affordance "make_call" → binds to voice_bridge MCP tool
 * - Computer object has affordance "browse_web" → binds to web_fetch tool
 * - Filing cabinet has affordance "search_files" → binds to file_search tool
 */

import type { World } from "../ecs/world";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A tool binding connects an affordance to an executable capability
 */
export interface ToolBinding {
  /** The affordance name this binds to */
  affordance: string;
  /** Type of tool: mcp = external MCP server, internal = ArgOS action */
  type: "mcp" | "internal";
  /** The tool/action identifier */
  toolId: string;
  /** MCP server name (if type is "mcp") */
  mcpServer?: string;
  /** Description shown to agents */
  description: string;
  /** Parameters the tool accepts */
  parameters?: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
  /** Constraints on tool usage */
  constraints?: {
    /** Requires object to be in a specific state */
    requiresState?: string[];
    /** Requires user to have specific trait */
    requiresTrait?: string[];
    /** Cooldown between uses (ms) */
    cooldown?: number;
    /** Maximum uses per day */
    dailyLimit?: number;
  };
}

/**
 * An object's tool interface - what tools it provides
 */
export interface ObjectToolInterface {
  objectType: string;
  tools: ToolBinding[];
}

/**
 * Record of tool usage for rate limiting
 */
interface ToolUsageRecord {
  entityId: number;
  affordance: string;
  lastUsed: number;
  usesToday: number;
  dailyResetTime: number;
}

// =============================================================================
// STATE
// =============================================================================

interface AffordanceToolState {
  /** Registered tool bindings by affordance name */
  bindings: Map<string, ToolBinding>;
  /** Object type to tool interface mapping */
  objectInterfaces: Map<string, ObjectToolInterface>;
  /** Usage records for rate limiting */
  usageRecords: Map<string, ToolUsageRecord>;
}

let state: AffordanceToolState = {
  bindings: new Map(),
  objectInterfaces: new Map(),
  usageRecords: new Map(),
};

export function resetAffordanceToolState(): void {
  state = {
    bindings: new Map(),
    objectInterfaces: new Map(),
    usageRecords: new Map(),
  };
}

// =============================================================================
// TOOL BINDING REGISTRATION
// =============================================================================

/**
 * Register a tool binding for an affordance
 */
export function registerToolBinding(binding: ToolBinding): void {
  state.bindings.set(binding.affordance, binding);
  console.log(`[AffordanceTools] Registered: ${binding.affordance} → ${binding.toolId}`);
}

/**
 * Register multiple tool bindings
 */
export function registerToolBindings(bindings: ToolBinding[]): void {
  for (const binding of bindings) {
    registerToolBinding(binding);
  }
}

/**
 * Get tool binding for an affordance
 */
export function getToolBinding(affordance: string): ToolBinding | undefined {
  return state.bindings.get(affordance);
}

/**
 * Get all registered tool bindings
 */
export function getAllToolBindings(): ToolBinding[] {
  return Array.from(state.bindings.values());
}

// =============================================================================
// OBJECT INTERFACE REGISTRATION
// =============================================================================

/**
 * Register the complete tool interface for an object type
 */
export function registerObjectInterface(objectType: string, tools: ToolBinding[]): void {
  // Register individual bindings
  for (const tool of tools) {
    state.bindings.set(tool.affordance, tool);
  }

  // Register the interface
  state.objectInterfaces.set(objectType, {
    objectType,
    tools,
  });

  console.log(`[AffordanceTools] Registered object interface: ${objectType} with ${tools.length} tools`);
}

/**
 * Get tools available for an object type
 */
export function getObjectTools(objectType: string): ToolBinding[] {
  const interface_ = state.objectInterfaces.get(objectType);
  return interface_?.tools || [];
}

// =============================================================================
// BUILT-IN OBJECT INTERFACES
// =============================================================================

/**
 * Standard phone interface
 */
export const PHONE_INTERFACE: ToolBinding[] = [
  {
    affordance: "make_call",
    type: "mcp",
    toolId: "voice_bridge_call",
    mcpServer: "voice-bridge",
    description: "Make a phone call to someone",
    parameters: {
      recipient: { type: "string", description: "Who to call (name or number)", required: true },
    },
    constraints: {
      requiresState: ["powered_on"],
    },
  },
  {
    affordance: "answer_call",
    type: "mcp",
    toolId: "voice_bridge_answer",
    mcpServer: "voice-bridge",
    description: "Answer an incoming phone call",
    constraints: {
      requiresState: ["ringing"],
    },
  },
  {
    affordance: "send_text",
    type: "mcp",
    toolId: "sms_send",
    mcpServer: "messaging",
    description: "Send a text message",
    parameters: {
      recipient: { type: "string", description: "Who to text", required: true },
      message: { type: "string", description: "Message content", required: true },
    },
  },
  {
    affordance: "check_messages",
    type: "internal",
    toolId: "check_phone_messages",
    description: "Check text messages and voicemail",
  },
  {
    affordance: "browse_social",
    type: "mcp",
    toolId: "social_media_browse",
    mcpServer: "social-media",
    description: "Browse social media feeds",
  },
];

/**
 * Standard computer interface
 */
export const COMPUTER_INTERFACE: ToolBinding[] = [
  {
    affordance: "browse_web",
    type: "mcp",
    toolId: "web_fetch",
    mcpServer: "web-tools",
    description: "Browse the web and search for information",
    parameters: {
      url: { type: "string", description: "URL to visit or search query" },
    },
  },
  {
    affordance: "send_email",
    type: "mcp",
    toolId: "email_send",
    mcpServer: "email",
    description: "Send an email",
    parameters: {
      to: { type: "string", description: "Recipient email", required: true },
      subject: { type: "string", description: "Email subject", required: true },
      body: { type: "string", description: "Email body", required: true },
    },
  },
  {
    affordance: "check_email",
    type: "mcp",
    toolId: "email_check",
    mcpServer: "email",
    description: "Check inbox for new emails",
  },
  {
    affordance: "write_document",
    type: "internal",
    toolId: "create_document",
    description: "Write or edit a document",
    parameters: {
      title: { type: "string", description: "Document title" },
      content: { type: "string", description: "Document content" },
    },
  },
  {
    affordance: "search_files",
    type: "internal",
    toolId: "file_search",
    description: "Search through local files",
    parameters: {
      query: { type: "string", description: "Search query", required: true },
    },
  },
  {
    affordance: "run_program",
    type: "mcp",
    toolId: "execute_program",
    mcpServer: "system",
    description: "Run a program or script",
    parameters: {
      program: { type: "string", description: "Program to run", required: true },
    },
  },
];

/**
 * Standard filing cabinet interface
 */
export const FILING_CABINET_INTERFACE: ToolBinding[] = [
  {
    affordance: "search_records",
    type: "internal",
    toolId: "search_physical_records",
    description: "Search through physical records and files",
    parameters: {
      query: { type: "string", description: "What to search for", required: true },
    },
  },
  {
    affordance: "file_document",
    type: "internal",
    toolId: "file_physical_document",
    description: "File a document in the cabinet",
    parameters: {
      document: { type: "string", description: "Document to file", required: true },
      category: { type: "string", description: "Filing category" },
    },
  },
  {
    affordance: "retrieve_document",
    type: "internal",
    toolId: "retrieve_physical_document",
    description: "Retrieve a specific document",
    parameters: {
      documentId: { type: "string", description: "Document identifier", required: true },
    },
  },
];

/**
 * Standard workstation interface (computer + extras)
 */
export const WORKSTATION_INTERFACE: ToolBinding[] = [
  ...COMPUTER_INTERFACE,
  {
    affordance: "video_call",
    type: "mcp",
    toolId: "video_conference",
    mcpServer: "video-bridge",
    description: "Start or join a video call",
    parameters: {
      meeting: { type: "string", description: "Meeting ID or person to call" },
    },
  },
  {
    affordance: "share_screen",
    type: "mcp",
    toolId: "screen_share",
    mcpServer: "video-bridge",
    description: "Share your screen in a call",
  },
  {
    affordance: "access_crm",
    type: "mcp",
    toolId: "crm_access",
    mcpServer: "crm",
    description: "Access customer relationship management system",
  },
];

/**
 * Initialize standard object interfaces
 */
export function initializeStandardInterfaces(): void {
  registerObjectInterface("phone", PHONE_INTERFACE);
  registerObjectInterface("smartphone", PHONE_INTERFACE);
  registerObjectInterface("computer", COMPUTER_INTERFACE);
  registerObjectInterface("laptop", COMPUTER_INTERFACE);
  registerObjectInterface("workstation", WORKSTATION_INTERFACE);
  registerObjectInterface("filing_cabinet", FILING_CABINET_INTERFACE);

  console.log("[AffordanceTools] Standard interfaces initialized");
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

/**
 * Check if a tool can be used (rate limiting, state requirements)
 */
export function canUseTool(
  entityId: number,
  affordance: string,
  objectState?: string[]
): { allowed: boolean; reason?: string } {
  const binding = state.bindings.get(affordance);
  if (!binding) {
    return { allowed: false, reason: `Unknown affordance: ${affordance}` };
  }

  // Check state requirements
  if (binding.constraints?.requiresState && objectState) {
    const hasRequiredState = binding.constraints.requiresState.some(
      s => objectState.includes(s)
    );
    if (!hasRequiredState) {
      return {
        allowed: false,
        reason: `Object must be in state: ${binding.constraints.requiresState.join(" or ")}`,
      };
    }
  }

  // Check rate limits
  const usageKey = `${entityId}:${affordance}`;
  const usage = state.usageRecords.get(usageKey);

  if (usage && binding.constraints?.cooldown) {
    const timeSinceUse = Date.now() - usage.lastUsed;
    if (timeSinceUse < binding.constraints.cooldown) {
      const waitTime = Math.ceil((binding.constraints.cooldown - timeSinceUse) / 1000);
      return { allowed: false, reason: `Cooldown: wait ${waitTime}s` };
    }
  }

  if (usage && binding.constraints?.dailyLimit) {
    // Reset daily counter if needed
    const now = Date.now();
    if (now > usage.dailyResetTime) {
      usage.usesToday = 0;
      usage.dailyResetTime = getNextMidnight();
    }

    if (usage.usesToday >= binding.constraints.dailyLimit) {
      return { allowed: false, reason: `Daily limit reached (${binding.constraints.dailyLimit})` };
    }
  }

  return { allowed: true };
}

/**
 * Record tool usage for rate limiting
 */
export function recordToolUsage(entityId: number, affordance: string): void {
  const usageKey = `${entityId}:${affordance}`;
  const existing = state.usageRecords.get(usageKey);

  if (existing) {
    existing.lastUsed = Date.now();
    existing.usesToday++;
  } else {
    state.usageRecords.set(usageKey, {
      entityId,
      affordance,
      lastUsed: Date.now(),
      usesToday: 1,
      dailyResetTime: getNextMidnight(),
    });
  }
}

function getNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// =============================================================================
// AGENT TOOL CONTEXT
// =============================================================================

/**
 * Get available tools for an agent based on objects they can access
 */
export function getAgentAvailableTools(
  accessibleObjects: Array<{ type: string; state?: string[]; entityId: number }>
): Array<{ tool: ToolBinding; objectType: string; objectEid: number }> {
  const availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }> = [];

  for (const obj of accessibleObjects) {
    const interface_ = state.objectInterfaces.get(obj.type);
    if (!interface_) continue;

    for (const tool of interface_.tools) {
      const check = canUseTool(obj.entityId, tool.affordance, obj.state);
      if (check.allowed) {
        availableTools.push({
          tool,
          objectType: obj.type,
          objectEid: obj.entityId,
        });
      }
    }
  }

  return availableTools;
}

/**
 * Format available tools for inclusion in agent prompt
 */
export function formatToolsForPrompt(
  availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }>
): string {
  if (availableTools.length === 0) {
    return "No special tools available from nearby objects.";
  }

  const lines: string[] = ["Available tools from objects you can access:"];

  // Group by object type
  const byObject = new Map<string, ToolBinding[]>();
  for (const { tool, objectType } of availableTools) {
    const existing = byObject.get(objectType) || [];
    existing.push(tool);
    byObject.set(objectType, existing);
  }

  for (const [objectType, tools] of Array.from(byObject.entries())) {
    lines.push(`\n[${objectType}]`);
    for (const tool of tools) {
      lines.push(`  - ${tool.affordance}: ${tool.description}`);
      if (tool.parameters) {
        const params = Object.entries(tool.parameters)
          .map(([k, v]) => `${k}${(v as { required?: boolean }).required ? "*" : ""}`)
          .join(", ");
        lines.push(`    params: ${params}`);
      }
    }
  }

  return lines.join("\n");
}

// =============================================================================
// SUMMARY
// =============================================================================

export function getAffordanceToolsSummary(): string {
  return `Affordance-Tool System:
- Registered bindings: ${state.bindings.size}
- Object interfaces: ${state.objectInterfaces.size}
- Usage records: ${state.usageRecords.size}

Object Types:
${Array.from(state.objectInterfaces.entries())
  .map(([type, iface]) => `  - ${type}: ${iface.tools.length} tools`)
  .join("\n")}`;
}
