/**
 * Global Simulation State
 *
 * Central state that spans ALL agents and spirits in the simulation.
 * God controls this state; all spirits receive it as context.
 *
 * This enables:
 * - Global mood/tension that affects all behavior
 * - Time scaling (slow-mo to fast-forward)
 * - Pinned directives that all spirits respect
 * - Pacing controls to prevent chaos
 * - Preset modes for different simulation styles
 */

// =============================================================================
// TIME MANAGEMENT
// =============================================================================

export interface SimulationTime {
  /** Current simulation time */
  simTime: Date;

  /** Real-world timestamp when simulation started */
  realTimeStart: number;

  /** Time scale multiplier: 1.0 = realtime, 0.1 = slow, 10 = fast */
  timeScale: number;

  /** Current phase of the day */
  dayPhase: "dawn" | "morning" | "midday" | "afternoon" | "evening" | "night";

  /** Current hour (0-23) in simulation time */
  hour: number;

  /** Current day number since simulation start */
  dayNumber: number;

  /** Is it a "work day" or "rest day"? */
  dayType: "work" | "rest" | "festival" | "crisis";
}

// =============================================================================
// MOOD & ATMOSPHERE
// =============================================================================

export interface SimulationMood {
  /**
   * Current narrative tension (0-1)
   * 0.0 = completely peaceful, routine
   * 0.3 = normal daily life with minor concerns
   * 0.5 = moderate tension, something brewing
   * 0.7 = high tension, conflict emerging
   * 0.9+ = crisis mode, dramatic events
   */
  tension: number;

  /** Target tension we're moving toward */
  targetTension: number;

  /** How fast tension changes (per tick) */
  tensionVelocity: number;

  /**
   * Overall atmosphere affecting NPC behavior
   * - peaceful: Agents are relaxed, social, routine-focused
   * - busy: Agents are task-focused, less social
   * - festive: Agents are celebratory, social, generous
   * - ominous: Agents are cautious, suspicious, alert
   * - tense: Agents are on edge, reactive, defensive
   * - chaotic: Agents are panicked, survival-focused
   */
  atmosphere: "peaceful" | "busy" | "festive" | "ominous" | "tense" | "chaotic";

  /**
   * Emotional undercurrent
   * Affects how agents interpret events and express themselves
   */
  emotionalTone: "hopeful" | "content" | "melancholy" | "anxious" | "fearful" | "angry";

  /** Recent mood history for trend analysis */
  moodHistory: Array<{ timestamp: number; tension: number; atmosphere: string }>;
}

// =============================================================================
// GOD'S DIRECTIVES
// =============================================================================

export interface GlobalDirectives {
  /**
   * Current narrative focus - what should spirits pay attention to?
   * This gets injected into ALL spirit prompts.
   */
  narrativeFocus: string;

  /**
   * Current narrative phase
   * Affects pacing, intervention style, and acceptable drama levels
   */
  narrativePhase: "exposition" | "rising_action" | "development" | "complication" | "climax" | "falling_action" | "resolution" | "epilogue";

  /**
   * What kinds of interventions are currently allowed?
   * Spirits will only use these intervention types.
   */
  allowedInterventions: string[];

  /**
   * What should NOT happen right now?
   * Hard blocks that spirits must respect.
   */
  forbiddenActions: string[];

  /**
   * Specific characters or elements to focus on
   */
  focusCharacters: string[];

  /**
   * Themes to emphasize
   */
  activeThemes: string[];

  /**
   * Custom directive text that gets appended to all spirit contexts
   */
  customDirective: string;
}

// =============================================================================
// PACING CONTROLS
// =============================================================================

export interface PacingControls {
  /**
   * Minimum milliseconds between ANY spirit intervention
   * Prevents spirits from overwhelming the simulation
   */
  interventionCooldown: number;

  /**
   * Minimum ms between new system creation (Architect)
   * Prevents system bloat
   */
  systemBakingCooldown: number;

  /**
   * Minimum ms between dramatic events (Narrator)
   * Prevents drama fatigue
   */
  dramaCooldown: number;

  /**
   * Minimum ms between daemon challenges
   * Lets agents breathe
   */
  challengeCooldown: number;

  /**
   * Maximum spirits that can act per tick
   */
  maxSpiritsPerTick: number;

  /**
   * Timestamps of last actions (for cooldown checking)
   */
  lastIntervention: number;
  lastSystemBake: number;
  lastDramaEvent: number;
  lastChallenge: number;
}

// =============================================================================
// NARRATIVE ARCS
// =============================================================================

export interface GlobalNarrativeArc {
  id: string;
  name: string;
  type: "main" | "subplot" | "background";

  /** Current phase of this arc */
  phase: "setup" | "development" | "complication" | "crisis" | "resolution";

  /** Progress through current phase (0-1) */
  phaseProgress: number;

  /** Key characters involved */
  involvedCharacters: string[];

  /** Seeds planted for future payoff */
  foreshadowing: Array<{
    hint: string;
    plantedAt: number;
    payoffReady: boolean;
  }>;

  /** Beats that must happen */
  requiredBeats: Array<{
    description: string;
    completed: boolean;
    completedAt?: number;
  }>;

  /** When this arc started */
  startedAt: number;

  /** Expected duration in sim-time (ms) */
  expectedDuration: number;
}

// =============================================================================
// THE GLOBAL STATE
// =============================================================================

export interface GlobalSimulationState {
  /** Time management */
  time: SimulationTime;

  /** Mood and atmosphere */
  mood: SimulationMood;

  /** God's current directives */
  directives: GlobalDirectives;

  /** Pacing controls */
  pacing: PacingControls;

  /** Active narrative arcs */
  activeArcs: GlobalNarrativeArc[];

  /** Current preset being used */
  preset: SimulationPreset;

  /** Version for change detection */
  version: number;

  /** Last update timestamp */
  lastUpdate: number;
}

// =============================================================================
// PRESETS
// =============================================================================

export interface SimulationPreset {
  name: string;
  description: string;

  // Time settings
  timeScale: number;
  /** Real ms per simulation day (default: 86400000 = real-time) */
  realMsPerSimDay: number;

  // Mood defaults
  baseTension: number;
  maxTension: number;
  tensionDecayRate: number; // Per tick
  defaultAtmosphere: SimulationMood["atmosphere"];

  // Spirit behavior
  /** 0-1, how aggressively spirits intervene */
  spiritAggression: number;
  /** Ms between architect system baking */
  architectCooldown: number;
  /** Ms between narrator drama events */
  narratorCooldown: number;
  /** 0-1, how often daemons push challenges vs. support */
  daemonChallengeRate: number;

  // Narrative style
  narrativeStyle: "chaotic" | "dramatic" | "slice_of_life" | "slow_burn" | "mystery" | "thriller";
  allowedArcTypes: string[];
  /** How long arcs should last (multiplier) */
  arcDurationMultiplier: number;

  // Agent behavior modifiers
  /** 0-1, how proactive agents are vs reactive */
  agentProactivity: number;
  /** 0-1, how often agents seek social interaction */
  socialFrequency: number;
  /** 0-1, how strongly agents follow routines */
  routineStrength: number;
  /** Ticks before "stuck" detection triggers */
  stuckThreshold: number;
}

// =============================================================================
// PRESET DEFINITIONS
// =============================================================================

export const PRESET_CHAOS: SimulationPreset = {
  name: "Chaos",
  description: "High drama, frequent interventions, rapid pacing. Good for stress tests.",

  timeScale: 10.0,
  realMsPerSimDay: 3600000, // 1 hour real = 1 day sim

  baseTension: 0.5,
  maxTension: 1.0,
  tensionDecayRate: 0.001,
  defaultAtmosphere: "tense",

  spiritAggression: 0.8,
  architectCooldown: 60000,    // 1 minute
  narratorCooldown: 30000,     // 30 seconds
  daemonChallengeRate: 0.7,

  narrativeStyle: "chaotic",
  allowedArcTypes: ["disaster", "conflict", "mystery", "romance", "betrayal"],
  arcDurationMultiplier: 0.5,

  agentProactivity: 0.8,
  socialFrequency: 0.6,
  routineStrength: 0.2,
  stuckThreshold: 3,
};

export const PRESET_DRAMATIC: SimulationPreset = {
  name: "Dramatic",
  description: "Classic storytelling with clear acts. Drama with structure.",

  timeScale: 5.0,
  realMsPerSimDay: 7200000, // 2 hours real = 1 day sim

  baseTension: 0.3,
  maxTension: 0.9,
  tensionDecayRate: 0.005,
  defaultAtmosphere: "busy",

  spiritAggression: 0.5,
  architectCooldown: 300000,   // 5 minutes
  narratorCooldown: 120000,    // 2 minutes
  daemonChallengeRate: 0.4,

  narrativeStyle: "dramatic",
  allowedArcTypes: ["conflict", "mystery", "romance", "growth", "betrayal"],
  arcDurationMultiplier: 1.0,

  agentProactivity: 0.6,
  socialFrequency: 0.5,
  routineStrength: 0.4,
  stuckThreshold: 5,
};

export const PRESET_SLICE_OF_LIFE: SimulationPreset = {
  name: "Slice of Life",
  description: "Quiet, peaceful simulation. Daily routines, gentle interpersonal drama.",

  timeScale: 2.0,
  realMsPerSimDay: 14400000, // 4 hours real = 1 day sim

  baseTension: 0.15,
  maxTension: 0.5,
  tensionDecayRate: 0.02,
  defaultAtmosphere: "peaceful",

  spiritAggression: 0.15,
  architectCooldown: 1800000,  // 30 minutes
  narratorCooldown: 600000,    // 10 minutes
  daemonChallengeRate: 0.1,

  narrativeStyle: "slice_of_life",
  allowedArcTypes: ["romance", "friendship", "growth", "daily_life", "seasonal"],
  arcDurationMultiplier: 2.0,

  agentProactivity: 0.3,
  socialFrequency: 0.7,
  routineStrength: 0.8,
  stuckThreshold: 15,
};

export const PRESET_SLOW_BURN: SimulationPreset = {
  name: "Slow Burn",
  description: "Long-form intrigue. Tensions build over days/weeks. Corporate drama, political machinations.",

  timeScale: 1.0, // Real-time
  realMsPerSimDay: 86400000, // Real-time

  baseTension: 0.2,
  maxTension: 0.8,
  tensionDecayRate: 0.001,
  defaultAtmosphere: "busy",

  spiritAggression: 0.2,
  architectCooldown: 3600000,  // 1 hour
  narratorCooldown: 1800000,   // 30 minutes
  daemonChallengeRate: 0.2,

  narrativeStyle: "slow_burn",
  allowedArcTypes: ["intrigue", "romance", "betrayal", "power_struggle", "mystery"],
  arcDurationMultiplier: 5.0,

  agentProactivity: 0.4,
  socialFrequency: 0.5,
  routineStrength: 0.7,
  stuckThreshold: 20,
};

export const PRESET_MURDER_MYSTERY: SimulationPreset = {
  name: "Murder Mystery",
  description: "Closed-room mystery. Limited cast, rising suspicion, dramatic reveal.",

  timeScale: 3.0,
  realMsPerSimDay: 10800000, // 3 hours real = 1 day sim

  baseTension: 0.4,
  maxTension: 0.95,
  tensionDecayRate: 0.002,
  defaultAtmosphere: "ominous",

  spiritAggression: 0.4,
  architectCooldown: 600000,   // 10 minutes (limited new systems)
  narratorCooldown: 180000,    // 3 minutes
  daemonChallengeRate: 0.5,

  narrativeStyle: "mystery",
  allowedArcTypes: ["mystery", "suspicion", "revelation", "accusation"],
  arcDurationMultiplier: 1.5,

  agentProactivity: 0.5,
  socialFrequency: 0.6,
  routineStrength: 0.3,
  stuckThreshold: 8,
};

export const PRESET_CORPORATE: SimulationPreset = {
  name: "Corporate",
  description: "Office politics, meetings, watercooler drama. Professional masks hiding personal lives.",

  timeScale: 1.5,
  realMsPerSimDay: 28800000, // 8 hours real = 1 day sim (work day focus)

  baseTension: 0.25,
  maxTension: 0.7,
  tensionDecayRate: 0.008,
  defaultAtmosphere: "busy",

  spiritAggression: 0.25,
  architectCooldown: 1200000,  // 20 minutes
  narratorCooldown: 900000,    // 15 minutes
  daemonChallengeRate: 0.25,

  narrativeStyle: "slow_burn",
  allowedArcTypes: ["intrigue", "romance", "rivalry", "ambition", "scandal"],
  arcDurationMultiplier: 3.0,

  agentProactivity: 0.5,
  socialFrequency: 0.4,
  routineStrength: 0.75,
  stuckThreshold: 12,
};

export const ALL_PRESETS: Record<string, SimulationPreset> = {
  chaos: PRESET_CHAOS,
  dramatic: PRESET_DRAMATIC,
  slice_of_life: PRESET_SLICE_OF_LIFE,
  slow_burn: PRESET_SLOW_BURN,
  murder_mystery: PRESET_MURDER_MYSTERY,
  corporate: PRESET_CORPORATE,
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

/**
 * Create initial global simulation state with a preset
 */
export function createGlobalState(preset: SimulationPreset = PRESET_DRAMATIC): GlobalSimulationState {
  const now = Date.now();

  return {
    time: {
      simTime: new Date(),
      realTimeStart: now,
      timeScale: preset.timeScale,
      dayPhase: "morning",
      hour: 8,
      dayNumber: 1,
      dayType: "work",
    },

    mood: {
      tension: preset.baseTension,
      targetTension: preset.baseTension,
      tensionVelocity: 0,
      atmosphere: preset.defaultAtmosphere,
      emotionalTone: "content",
      moodHistory: [],
    },

    directives: {
      narrativeFocus: "Establish the world and characters",
      narrativePhase: "exposition",
      allowedInterventions: ["nudge", "stimulus", "mood_shift"],
      forbiddenActions: [],
      focusCharacters: [],
      activeThemes: [],
      customDirective: "",
    },

    pacing: {
      interventionCooldown: Math.round(60000 / preset.spiritAggression),
      systemBakingCooldown: preset.architectCooldown,
      dramaCooldown: preset.narratorCooldown,
      challengeCooldown: Math.round(120000 / preset.daemonChallengeRate),
      maxSpiritsPerTick: 3,
      lastIntervention: 0,
      lastSystemBake: 0,
      lastDramaEvent: 0,
      lastChallenge: 0,
    },

    activeArcs: [],
    preset,
    version: 1,
    lastUpdate: now,
  };
}

/**
 * Update simulation time based on real time elapsed and time scale
 */
export function updateSimulationTime(state: GlobalSimulationState, realDeltaMs: number): void {
  const simDeltaMs = realDeltaMs * state.time.timeScale;
  const newSimTime = new Date(state.time.simTime.getTime() + simDeltaMs);

  state.time.simTime = newSimTime;
  state.time.hour = newSimTime.getHours();

  // Update day phase
  const hour = state.time.hour;
  if (hour >= 5 && hour < 8) state.time.dayPhase = "dawn";
  else if (hour >= 8 && hour < 12) state.time.dayPhase = "morning";
  else if (hour >= 12 && hour < 14) state.time.dayPhase = "midday";
  else if (hour >= 14 && hour < 18) state.time.dayPhase = "afternoon";
  else if (hour >= 18 && hour < 21) state.time.dayPhase = "evening";
  else state.time.dayPhase = "night";

  state.lastUpdate = Date.now();
  state.version++;
}

/**
 * Update mood/tension with decay toward target
 */
export function updateMood(state: GlobalSimulationState): void {
  const mood = state.mood;
  const preset = state.preset;

  // Move tension toward target
  if (mood.tension < mood.targetTension) {
    mood.tension = Math.min(mood.targetTension, mood.tension + Math.abs(mood.tensionVelocity));
  } else if (mood.tension > mood.targetTension) {
    mood.tension = Math.max(mood.targetTension, mood.tension - Math.abs(mood.tensionVelocity));
  }

  // Natural decay toward base tension
  if (mood.targetTension === mood.tension) {
    const decayDirection = mood.tension > preset.baseTension ? -1 : 1;
    mood.tension += decayDirection * preset.tensionDecayRate;
    mood.tension = Math.max(0, Math.min(preset.maxTension, mood.tension));
  }

  // Clamp tension
  mood.tension = Math.max(0, Math.min(1, mood.tension));

  // Record history (keep last 100)
  mood.moodHistory.push({
    timestamp: Date.now(),
    tension: mood.tension,
    atmosphere: mood.atmosphere,
  });
  if (mood.moodHistory.length > 100) {
    mood.moodHistory.shift();
  }

  state.version++;
}

/**
 * Check if an action type is allowed by current cooldowns
 */
export function canPerformAction(
  state: GlobalSimulationState,
  actionType: "intervention" | "systemBake" | "drama" | "challenge"
): boolean {
  const now = Date.now();
  const pacing = state.pacing;

  switch (actionType) {
    case "intervention":
      return now - pacing.lastIntervention >= pacing.interventionCooldown;
    case "systemBake":
      return now - pacing.lastSystemBake >= pacing.systemBakingCooldown;
    case "drama":
      return now - pacing.lastDramaEvent >= pacing.dramaCooldown;
    case "challenge":
      return now - pacing.lastChallenge >= pacing.challengeCooldown;
    default:
      return true;
  }
}

/**
 * Record that an action was performed (updates cooldown timestamp)
 */
export function recordAction(
  state: GlobalSimulationState,
  actionType: "intervention" | "systemBake" | "drama" | "challenge"
): void {
  const now = Date.now();

  switch (actionType) {
    case "intervention":
      state.pacing.lastIntervention = now;
      break;
    case "systemBake":
      state.pacing.lastSystemBake = now;
      break;
    case "drama":
      state.pacing.lastDramaEvent = now;
      break;
    case "challenge":
      state.pacing.lastChallenge = now;
      break;
  }

  state.version++;
}

/**
 * Set tension with optional velocity for gradual change
 */
export function setTension(
  state: GlobalSimulationState,
  target: number,
  velocity: number = 0.01
): void {
  state.mood.targetTension = Math.max(0, Math.min(state.preset.maxTension, target));
  state.mood.tensionVelocity = velocity;
  state.version++;
}

/**
 * Set atmosphere
 */
export function setAtmosphere(
  state: GlobalSimulationState,
  atmosphere: SimulationMood["atmosphere"]
): void {
  state.mood.atmosphere = atmosphere;
  state.version++;
}

/**
 * Update God's directives
 */
export function setDirectives(
  state: GlobalSimulationState,
  directives: Partial<GlobalDirectives>
): void {
  Object.assign(state.directives, directives);
  state.version++;
}

/**
 * Switch to a different preset (resets pacing, keeps narrative state)
 */
export function switchPreset(state: GlobalSimulationState, preset: SimulationPreset): void {
  state.preset = preset;
  state.time.timeScale = preset.timeScale;

  // Update pacing
  state.pacing.interventionCooldown = Math.round(60000 / preset.spiritAggression);
  state.pacing.systemBakingCooldown = preset.architectCooldown;
  state.pacing.dramaCooldown = preset.narratorCooldown;
  state.pacing.challengeCooldown = Math.round(120000 / preset.daemonChallengeRate);

  // Adjust mood constraints
  state.mood.targetTension = Math.min(state.mood.targetTension, preset.maxTension);
  state.mood.tension = Math.min(state.mood.tension, preset.maxTension);

  state.version++;
}

/**
 * Generate context string for spirits
 * This gets injected into ALL spirit prompts so they understand global state
 */
export function generateSpiritContext(state: GlobalSimulationState): string {
  const { time, mood, directives, preset } = state;

  const lines = [
    `=== GLOBAL SIMULATION CONTEXT ===`,
    ``,
    `SIMULATION MODE: ${preset.name}`,
    `Style: ${preset.narrativeStyle}`,
    ``,
    `TIME: Day ${time.dayNumber}, ${time.dayPhase} (${time.hour}:00)`,
    `Time scale: ${time.timeScale}x`,
    ``,
    `MOOD:`,
    `  Tension: ${(mood.tension * 100).toFixed(0)}% (target: ${(mood.targetTension * 100).toFixed(0)}%)`,
    `  Atmosphere: ${mood.atmosphere}`,
    `  Emotional tone: ${mood.emotionalTone}`,
    ``,
    `NARRATIVE PHASE: ${directives.narrativePhase}`,
    `Focus: ${directives.narrativeFocus}`,
  ];

  if (directives.focusCharacters.length > 0) {
    lines.push(`Focus characters: ${directives.focusCharacters.join(", ")}`);
  }

  if (directives.activeThemes.length > 0) {
    lines.push(`Active themes: ${directives.activeThemes.join(", ")}`);
  }

  if (directives.forbiddenActions.length > 0) {
    lines.push(``, `FORBIDDEN (do NOT do these):`);
    directives.forbiddenActions.forEach(a => lines.push(`  - ${a}`));
  }

  if (directives.customDirective) {
    lines.push(``, `SPECIAL DIRECTIVE:`, directives.customDirective);
  }

  lines.push(
    ``,
    `PACING GUIDANCE:`,
    `  Spirit aggression: ${(preset.spiritAggression * 100).toFixed(0)}%`,
    `  Interventions should be: ${preset.spiritAggression < 0.3 ? "rare and subtle" : preset.spiritAggression < 0.6 ? "measured and purposeful" : "active and dramatic"}`,
  );

  if (preset.narrativeStyle === "slice_of_life") {
    lines.push(`  Remember: Contentment is VALID. Not every moment needs conflict.`);
  }

  if (preset.narrativeStyle === "slow_burn") {
    lines.push(`  Remember: Plant seeds for later. Payoffs come in days, not minutes.`);
  }

  return lines.join("\n");
}

/**
 * Get a summary of current state for logging/display
 */
export function getStateSummary(state: GlobalSimulationState): string {
  const { time, mood, directives, preset, activeArcs } = state;

  return [
    `[${preset.name}] Day ${time.dayNumber} ${time.dayPhase}`,
    `Tension: ${(mood.tension * 100).toFixed(0)}% | Atmosphere: ${mood.atmosphere}`,
    `Phase: ${directives.narrativePhase} | Arcs: ${activeArcs.length}`,
    directives.narrativeFocus ? `Focus: ${directives.narrativeFocus}` : "",
  ].filter(Boolean).join(" | ");
}
