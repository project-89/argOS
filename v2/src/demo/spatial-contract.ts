/** Transport-only projection. No renderer receives mutation authority or private NPC memory.
 * Operator thoughts/phone records are deliberately separate from public scene entities. */
export interface SpatialViewEntity {
  id: number; key: string; name: string; kind: "actor" | "prop"; roomId: number;
  position: { x: number; y: number; z: number }; rotationY?: number;
  asset: string; /** Catalog model path under /assets/, when the kind has one. */ model?: string;
  /** Presentation hint: the kind gives off light (tagged "light" in the catalog). */ light?: boolean;
  size?: { x: number; y: number; z: number }; color?: string;
  state?: string; heldBy?: number;
  /** Confirmed public physical state from the admitted generated mechanic. */
  wetness?: number;
  /** Newly installed public scalar mechanics; presentation, not action authority. */
  details?: Array<{ component: string; field: string; value: number | boolean }>;
  activity?: { executionId?: string; action: string; status: "pending" | "succeeded" | "failed";
    targetId?: number; startedAtSimMs?: number; completedAtSimMs?: number;
    /** A timed craft under way: when it is due and how long it takes (presentation: how far along it is). */
    work?: { dueAtSimMs: number; durationMs: number } };
  /** What a person is visibly under ("tipsy"), from a body condition the world tracks. */
  condition?: string;
  /** A building plot (or a building raised on one): its parts in order, how many stand, and whether someone is building now. */
  construction?: { structure: string; stages: string[]; standing: number; building: boolean };
}
export interface SpatialViewRoom {
  id: number; key: string; name: string; bounds: { x: number; z: number; width: number; depth: number };
  floor?: string;
  environment?: "indoor" | "outdoor";
  building?: { style: "cottage" | "cafe" | "workshop"; wallColor: string; roofColor: string; front: "north" | "south" };
}
export interface SpatialOperatorActor {
  id: number; key: string; name: string; room: string;
  thought?: { text: string; atSimMs: number }; action?: string; unread: number;
  canText?: boolean;
  needs?: { hunger: number; energy: number };
  focus?: { description: string; kind: "activity" | "goal"; status: string };
  goals?: Array<{ id: number; key: string; description: string; status: string; priority: number }>;
  messages: Array<{ id: number; from: string; text: string; atSimMs: number;
    direction: "in" | "out"; status: "delivered" | "read" | "sent" }>;
}
/** Ephemeral public presentation of something that actually happened. Not a
 * command, a private thought/message, or a predicted action completion. */
export interface SpatialSceneCue {
  id: string; kind: "speech" | "action" | "sound"; entityKey: string; text: string;
  atSimMs: number; updatedAtSimMs: number; expiresAtSimMs: number;
}
export interface SpatialWeatherView {
  condition: "clear" | "cloudy" | "rain"; revision: number; changedAtSimMs: number;
  rooms: Array<{ roomId: number; condition: "clear" | "cloudy" | "rain" }>;
}
/** Operator-only explanations. Public renderers receive weather, not these reports. */
export interface SpatialTownLifeView {
  enabled: boolean; summary: string; weather: SpatialWeatherView;
  spirits: Array<{ name: string; status: string }>;
  changes: Array<{ id: string; atSimMs: number; spirit: string;
    status: "proposed" | "approved" | "applied" | "rejected" | "failed" | "used" | "observed"; summary: string }>;
  growth: { remaining: number; summary: string };
  mechanic?: { status: string; summary: string; remaining: number };
  story?: { style: string; premise: string; lastReviewAtSimMs?: number; phase?: string; tension?: number;
    observedEvents?: number; interventions?: number; remainingEvents: number };
}
export interface SpatialDevelopmentView {
  enabled: boolean; available: boolean; busy: boolean; status: string;
  limits: { maxBuildJobs: number; maxRequests: number };
  jobs: Array<{ id: string; status: string; summary: string }>;
  messages: Array<{ id: string; role: "operator" | "god"; text: string;
    status: "queued" | "working" | "completed" | "failed" | "cancelled"; atSimMs: number }>;
  capabilities: string[];
}
/** Operator-only view of the body the operator currently drives (Inhabit mode).
 * `heard` comes from that body's own social memory: only speech it really heard. */
export interface SpatialControlView {
  actorKey: string; name: string; visitor: boolean;
  /** Things within ~3 m and the native verbs this body can use on each now. */
  nearby: Array<{ key: string; name: string; kind: "actor" | "prop"; distance: number; verbs: string[] }>;
  /** Newest last, at most 20. */
  heard: Array<{ id: string; speaker: string; text: string; atSimMs: number; speakerKey?: string; distance?: number }>;
  /** How far a voice carries for this body. */
  earshotMetres?: number;
  /** Utterances being spoken right now within this body's earshot. */
  speaking?: Array<{ executionId: string; speakerKey: string; speaker: string; distance: number;
    startedAtSimMs: number; expectedEndSimMs: number; addressedToYou: boolean }>;
}
export interface SpatialViewState {
  sourceId: string; atSimMs: number; tick: number; running: boolean;
  status: "ready" | "running" | "stopped";
  mode: "live" | "manual";
  scenario?: { id: "blackout"; title: string; power: "off" | "on"; phase: string; complete: boolean }
    | { id: "town" | "household"; title: string; phase: string; theme?: "lovecraft"; power?: never; complete?: never };
  worldControl?: { available: boolean; busy: boolean; summary: string };
  townLife?: SpatialTownLifeView;
  development?: SpatialDevelopmentView;
  weather?: SpatialWeatherView;
  rooms: SpatialViewRoom[]; entities: SpatialViewEntity[];
  actors: SpatialOperatorActor[];
  cues: SpatialSceneCue[];
  events: Array<{ id: number; atSimMs: number; text: string; kind: string }>;
  /** The Narrator's story prose: a presentation feed, never resident knowledge. */
  storyFeed?: Array<{ id: string; atSimMs: number; text: string; spirit: string; phase?: string; tension?: number }>;
  growth: { status: "available" | "built" | "gated"; summary: string };
  limits: { seconds: number; ai: boolean; autonomousGrowth: boolean };
  /** Present while the operator drives a body. Operator-only (not in /api/scene). */
  control?: SpatialControlView;
  /** Simulation time and minds are frozen by the operator. */
  paused: boolean;
}
