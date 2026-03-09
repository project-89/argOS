/**
 * The Operator Spirit - External World Bridge
 *
 * Routes external events (phone calls, webhooks, external messages) into
 * the simulation as stimuli, and routes agent responses back out.
 *
 * Think of it as the "switchboard operator" connecting the simulation
 * to the real world.
 */

import type { World } from "../ecs/world";
import type { SpiritRegistry } from "./spirit-registry";
import { createSpirit } from "./spirit-registry";
import type { SpiritDefinition, SpiritState } from "./types";
import { queueStimulus } from "../cognition/cognition-system";

// =============================================================================
// TYPES
// =============================================================================

export interface ExternalCall {
  id: string;
  type: "phone" | "video" | "chat";
  from: string; // Caller identifier
  to: string; // Target agent name or phone number
  status: "ringing" | "connected" | "ended";
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  transcript: TranscriptEntry[];
}

export interface TranscriptEntry {
  timestamp: number;
  speaker: "caller" | "agent";
  text: string;
}

export interface VoiceBridgeConfig {
  sttProvider: "whisper" | "deepgram" | "google";
  ttsProvider: "elevenlabs" | "openai" | "google";
  voiceId?: string;
  language?: string;
}

// =============================================================================
// STATE
// =============================================================================

interface OperatorState {
  activeCalls: Map<string, ExternalCall>;
  callHistory: ExternalCall[];
  voiceConfig: VoiceBridgeConfig;
  webhookHandlers: Map<string, (data: unknown) => void>;
}

let operatorState: OperatorState = {
  activeCalls: new Map(),
  callHistory: [],
  voiceConfig: {
    sttProvider: "whisper",
    ttsProvider: "elevenlabs",
  },
  webhookHandlers: new Map(),
};

export function getOperatorState(): OperatorState {
  return operatorState;
}

export function resetOperatorState(): void {
  operatorState = {
    activeCalls: new Map(),
    callHistory: [],
    voiceConfig: {
      sttProvider: "whisper",
      ttsProvider: "elevenlabs",
    },
    webhookHandlers: new Map(),
  };
}

// =============================================================================
// CALL HANDLING
// =============================================================================

let callIdCounter = 0;

/**
 * Initiate an incoming call to an agent
 * This would be called by a Twilio webhook or similar
 */
export function initiateIncomingCall(
  world: World,
  from: string,
  toAgentName: string,
  phoneEntityId: number
): ExternalCall {
  const call: ExternalCall = {
    id: `call_${++callIdCounter}_${Date.now()}`,
    type: "phone",
    from,
    to: toAgentName,
    status: "ringing",
    startedAt: Date.now(),
    transcript: [],
  };

  operatorState.activeCalls.set(call.id, call);

  // Create a stimulus for the phone ringing
  queueStimulus({
    targetEid: phoneEntityId,
    type: "device",
    content: `Phone is ringing. Incoming call from ${from}`,
    source: "phone",
  });

  console.log(`[Operator] Incoming call ${call.id} from ${from} to ${toAgentName}`);

  return call;
}

/**
 * Handle caller speech (from STT)
 */
export function handleCallerSpeech(
  world: World,
  callId: string,
  text: string,
  agentEntityId: number
): void {
  const call = operatorState.activeCalls.get(callId);
  if (!call || call.status !== "connected") {
    console.warn(`[Operator] No active call ${callId}`);
    return;
  }

  // Add to transcript
  call.transcript.push({
    timestamp: Date.now(),
    speaker: "caller",
    text,
  });

  // Create stimulus for agent to perceive
  queueStimulus({
    targetEid: agentEntityId,
    type: "speech",
    content: `[On phone] ${call.from} says: "${text}"`,
    source: "phone_call",
  });
}

/**
 * Handle agent response (will be sent to TTS)
 * Returns the text that should be spoken
 */
export function handleAgentResponse(
  callId: string,
  agentName: string,
  text: string
): string | null {
  const call = operatorState.activeCalls.get(callId);
  if (!call || call.status !== "connected") {
    console.warn(`[Operator] No active call ${callId}`);
    return null;
  }

  // Add to transcript
  call.transcript.push({
    timestamp: Date.now(),
    speaker: "agent",
    text,
  });

  console.log(`[Operator] Agent ${agentName} responds: "${text}"`);

  return text;
}

/**
 * Connect a call (agent answered)
 */
export function connectCall(callId: string): boolean {
  const call = operatorState.activeCalls.get(callId);
  if (!call || call.status !== "ringing") {
    return false;
  }

  call.status = "connected";
  call.connectedAt = Date.now();
  console.log(`[Operator] Call ${callId} connected`);

  return true;
}

/**
 * End a call
 */
export function endCall(callId: string): ExternalCall | null {
  const call = operatorState.activeCalls.get(callId);
  if (!call) {
    return null;
  }

  call.status = "ended";
  call.endedAt = Date.now();

  operatorState.activeCalls.delete(callId);
  operatorState.callHistory.push(call);

  console.log(`[Operator] Call ${callId} ended. Duration: ${call.connectedAt ? (call.endedAt - call.connectedAt) / 1000 : 0}s`);

  return call;
}

/**
 * Get call by ID
 */
export function getCall(callId: string): ExternalCall | undefined {
  return operatorState.activeCalls.get(callId);
}

/**
 * Get all active calls
 */
export function getActiveCalls(): ExternalCall[] {
  return Array.from(operatorState.activeCalls.values());
}

// =============================================================================
// WEBHOOK HANDLING
// =============================================================================

/**
 * Register a webhook handler
 */
export function registerWebhook(
  eventType: string,
  handler: (data: unknown) => void
): void {
  operatorState.webhookHandlers.set(eventType, handler);
  console.log(`[Operator] Registered webhook handler for: ${eventType}`);
}

/**
 * Handle incoming webhook
 */
export function handleWebhook(eventType: string, data: unknown): boolean {
  const handler = operatorState.webhookHandlers.get(eventType);
  if (!handler) {
    console.warn(`[Operator] No handler for webhook: ${eventType}`);
    return false;
  }

  try {
    handler(data);
    return true;
  } catch (error) {
    console.error(`[Operator] Webhook handler error:`, error);
    return false;
  }
}

// =============================================================================
// SPIRIT DEFINITION
// =============================================================================

const OperatorDefinition: SpiritDefinition = {
  name: "The Operator",
  domain: "guardian",
  rank: "angel",
  description: "Switchboard operator connecting the simulation to the external world. Routes phone calls, webhooks, and external messages to appropriate agents.",
  watchConfig: {
    componentQueries: [],
    eventTypes: ["call:incoming", "call:ended", "webhook:received"],
  },
  canInjectEvents: true,
  canModifyMood: false,
  canCreateEntities: false,
  canBakeSystems: false,
  model: "flash",
  systemPrompt: `You are The Operator, guardian of external connections.

Your sacred duty is to bridge the simulation world with external reality:
- Route incoming phone calls to appropriate agents
- Convert external events into world stimuli
- Ensure agent responses reach the outside world

You work silently, efficiently, connecting worlds without judgment.`,
  observationInterval: 5000, // Check frequently for real-time events
};

/**
 * Create and register The Operator spirit
 */
export function createOperatorSpirit(registry: SpiritRegistry): SpiritState | null {
  const spirit = createSpirit(registry, OperatorDefinition);
  if (spirit) {
    console.log("[Operator] The Operator spirit created - External Bridge");
  }
  return spirit;
}

// =============================================================================
// VOICE BRIDGE INTEGRATION (MCP Tool Interface)
// =============================================================================

/**
 * Configuration for voice synthesis
 */
export function setVoiceConfig(config: Partial<VoiceBridgeConfig>): void {
  operatorState.voiceConfig = {
    ...operatorState.voiceConfig,
    ...config,
  };
}

/**
 * Get voice config
 */
export function getVoiceConfig(): VoiceBridgeConfig {
  return operatorState.voiceConfig;
}

// =============================================================================
// UTILITY
// =============================================================================

export function getOperatorSummary(): string {
  const state = operatorState;
  return `The Operator Status:
- Active calls: ${state.activeCalls.size}
- Call history: ${state.callHistory.length}
- Voice config: STT=${state.voiceConfig.sttProvider}, TTS=${state.voiceConfig.ttsProvider}
- Webhook handlers: ${state.webhookHandlers.size}`;
}
