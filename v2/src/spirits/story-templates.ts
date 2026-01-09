/**
 * Story Arc Templates
 *
 * Pre-defined narrative structures that the Narrator can use to guide simulations.
 * Each template defines:
 * - Story beats (key moments that should happen)
 * - Phase characteristics (what each phase should feel like)
 * - Intervention triggers (when to nudge the story)
 * - Resolution patterns (how stories can end)
 */

import type {
  NarrativePhase,
  StoryBeat,
  PlotThread,
  CharacterArc,
} from "./types";

// =============================================================================
// TEMPLATE TYPES
// =============================================================================

export interface StoryTemplate {
  id: string;
  name: string;
  description: string;
  genre: StoryGenre;

  // Structure
  acts: ActTemplate[];
  requiredRoles: CharacterRole[];
  optionalRoles: CharacterRole[];

  // Pacing
  idealDuration: number;           // Estimated ticks for full story
  tensionCurve: TensionPoint[];    // Target tension at each phase
  pacingGuidelines: PacingGuideline[];

  // Beats
  keyBeats: BeatTemplate[];
  optionalBeats: BeatTemplate[];

  // Intervention triggers
  stagnationThreshold: number;     // Ticks before nudging
  interventionSuggestions: InterventionSuggestion[];

  // Themes
  themes: string[];
  motifs: string[];
}

export type StoryGenre =
  | "mystery"
  | "romance"
  | "adventure"
  | "tragedy"
  | "comedy"
  | "horror"
  | "slice_of_life"
  | "conflict"
  | "discovery"
  | "transformation";

export interface ActTemplate {
  number: 1 | 2 | 3;
  name: string;
  purpose: string;
  targetTension: [number, number];  // [start, end] tension range
  phases: NarrativePhase[];
  typicalDuration: number;          // Percentage of total story
  keyObjectives: string[];
}

export interface CharacterRole {
  role: string;
  description: string;
  arcType: "growth" | "fall" | "flat" | "transformation";
  motivations: string[];
  conflicts: string[];
}

export interface TensionPoint {
  phase: NarrativePhase;
  targetTension: number;
  tolerance: number;                // How much variance is ok
}

export interface PacingGuideline {
  condition: string;
  action: string;
  priority: number;
}

export interface BeatTemplate {
  id: string;
  name: string;
  description: string;
  phase: NarrativePhase;
  type: "plot" | "character" | "thematic";

  // Conditions
  prerequisites: string[];          // Beat IDs that must happen first
  requiredRoles: string[];          // Roles that must be present
  triggerConditions: string[];      // Natural language conditions

  // Effects
  tensionChange: number;            // -1 to 1
  establishes: string[];            // What this beat sets up

  // Flexibility
  optional: boolean;
  alternatives: string[];           // Alternative beat IDs
}

export interface InterventionSuggestion {
  trigger: string;                  // When to suggest this
  type: "inject_stimulus" | "modify_mood" | "introduce_npc" | "environmental";
  templates: string[];              // Example interventions
  targetPhase?: NarrativePhase;
}

// =============================================================================
// CLASSIC THREE-ACT STRUCTURE
// =============================================================================

export const ClassicThreeActTemplate: StoryTemplate = {
  id: "classic_three_act",
  name: "Classic Three-Act Structure",
  description: "The foundational Western narrative structure: Setup, Confrontation, Resolution",
  genre: "adventure",

  acts: [
    {
      number: 1,
      name: "Setup",
      purpose: "Establish characters, setting, and the world's normal state before disruption",
      targetTension: [0.1, 0.3],
      phases: ["exposition", "inciting"],
      typicalDuration: 25,
      keyObjectives: [
        "Introduce protagonist and their world",
        "Establish stakes and what matters",
        "Create inciting incident that disrupts status quo",
        "End with protagonist's decision to act",
      ],
    },
    {
      number: 2,
      name: "Confrontation",
      purpose: "Rising action, complications, and the midpoint reversal",
      targetTension: [0.3, 0.8],
      phases: ["rising", "crisis"],
      typicalDuration: 50,
      keyObjectives: [
        "Protagonist faces escalating obstacles",
        "Midpoint revelation changes everything",
        "Stakes become personal",
        "All seems lost moment",
      ],
    },
    {
      number: 3,
      name: "Resolution",
      purpose: "Climax, falling action, and new equilibrium",
      targetTension: [0.8, 0.2],
      phases: ["climax", "falling", "resolution", "denouement"],
      typicalDuration: 25,
      keyObjectives: [
        "Final confrontation",
        "Protagonist transformed by journey",
        "Loose ends resolved",
        "New normal established",
      ],
    },
  ],

  requiredRoles: [
    {
      role: "protagonist",
      description: "The main character who drives the story and undergoes change",
      arcType: "growth",
      motivations: ["desire", "need", "goal"],
      conflicts: ["internal_flaw", "external_obstacle"],
    },
    {
      role: "antagonist",
      description: "The force that opposes the protagonist",
      arcType: "flat",
      motivations: ["opposing_goal", "different_values"],
      conflicts: ["protagonist_conflict"],
    },
  ],

  optionalRoles: [
    {
      role: "mentor",
      description: "Guide who helps the protagonist",
      arcType: "flat",
      motivations: ["help_protagonist", "past_connection"],
      conflicts: ["limited_time", "own_past"],
    },
    {
      role: "ally",
      description: "Companion who supports the protagonist",
      arcType: "growth",
      motivations: ["friendship", "shared_goal"],
      conflicts: ["loyalty_test", "own_arc"],
    },
    {
      role: "trickster",
      description: "Unpredictable character who adds chaos",
      arcType: "flat",
      motivations: ["self_interest", "fun"],
      conflicts: ["unreliable", "hidden_agenda"],
    },
  ],

  idealDuration: 100,
  stagnationThreshold: 10,  // 10 ticks before nudging

  tensionCurve: [
    { phase: "exposition", targetTension: 0.2, tolerance: 0.1 },
    { phase: "inciting", targetTension: 0.35, tolerance: 0.1 },
    { phase: "rising", targetTension: 0.5, tolerance: 0.15 },
    { phase: "crisis", targetTension: 0.75, tolerance: 0.1 },
    { phase: "climax", targetTension: 0.95, tolerance: 0.05 },
    { phase: "falling", targetTension: 0.6, tolerance: 0.15 },
    { phase: "resolution", targetTension: 0.3, tolerance: 0.1 },
    { phase: "denouement", targetTension: 0.1, tolerance: 0.1 },
  ],

  pacingGuidelines: [
    { condition: "tension_flat_too_long", action: "introduce_complication", priority: 1 },
    { condition: "tension_rising_too_fast", action: "add_quiet_moment", priority: 2 },
    { condition: "no_character_interaction", action: "force_encounter", priority: 1 },
    { condition: "protagonist_passive", action: "threaten_stakes", priority: 1 },
    { condition: "antagonist_absent", action: "remind_of_threat", priority: 2 },
  ],

  keyBeats: [
    {
      id: "opening_image",
      name: "Opening Image",
      description: "First impression of the world and protagonist",
      phase: "exposition",
      type: "thematic",
      prerequisites: [],
      requiredRoles: ["protagonist"],
      triggerConditions: ["story_begins"],
      tensionChange: 0,
      establishes: ["setting", "protagonist_status_quo"],
      optional: false,
      alternatives: [],
    },
    {
      id: "inciting_incident",
      name: "Inciting Incident",
      description: "Event that disrupts the protagonist's world",
      phase: "inciting",
      type: "plot",
      prerequisites: ["opening_image"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["protagonist_established", "world_established"],
      tensionChange: 0.2,
      establishes: ["central_conflict", "stakes"],
      optional: false,
      alternatives: [],
    },
    {
      id: "first_threshold",
      name: "Crossing the First Threshold",
      description: "Protagonist commits to the journey",
      phase: "rising",
      type: "plot",
      prerequisites: ["inciting_incident"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["protagonist_must_decide"],
      tensionChange: 0.15,
      establishes: ["protagonist_commitment", "new_world"],
      optional: false,
      alternatives: [],
    },
    {
      id: "midpoint",
      name: "Midpoint",
      description: "Major revelation or reversal",
      phase: "rising",
      type: "plot",
      prerequisites: ["first_threshold"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["story_halfway", "rising_tension"],
      tensionChange: 0.2,
      establishes: ["raised_stakes", "new_understanding"],
      optional: false,
      alternatives: [],
    },
    {
      id: "all_is_lost",
      name: "All Is Lost",
      description: "Protagonist's lowest point",
      phase: "crisis",
      type: "character",
      prerequisites: ["midpoint"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["approaching_climax", "high_tension"],
      tensionChange: 0.1,
      establishes: ["dark_moment", "transformation_seed"],
      optional: false,
      alternatives: [],
    },
    {
      id: "climax",
      name: "Climax",
      description: "Final confrontation",
      phase: "climax",
      type: "plot",
      prerequisites: ["all_is_lost"],
      requiredRoles: ["protagonist", "antagonist"],
      triggerConditions: ["protagonist_ready", "stakes_highest"],
      tensionChange: 0.2,
      establishes: ["resolution_direction"],
      optional: false,
      alternatives: [],
    },
    {
      id: "resolution",
      name: "Resolution",
      description: "Aftermath and new equilibrium",
      phase: "resolution",
      type: "thematic",
      prerequisites: ["climax"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["climax_resolved"],
      tensionChange: -0.5,
      establishes: ["new_normal", "character_growth"],
      optional: false,
      alternatives: [],
    },
  ],

  optionalBeats: [
    {
      id: "meet_mentor",
      name: "Meeting the Mentor",
      description: "Protagonist receives guidance",
      phase: "exposition",
      type: "character",
      prerequisites: ["inciting_incident"],
      requiredRoles: ["protagonist", "mentor"],
      triggerConditions: ["protagonist_needs_help"],
      tensionChange: -0.1,
      establishes: ["guidance", "tools_for_journey"],
      optional: true,
      alternatives: ["discovery_moment"],
    },
    {
      id: "tests_allies_enemies",
      name: "Tests, Allies, Enemies",
      description: "Protagonist learns who to trust",
      phase: "rising",
      type: "character",
      prerequisites: ["first_threshold"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["in_new_world"],
      tensionChange: 0.1,
      establishes: ["relationships", "rules_of_world"],
      optional: true,
      alternatives: [],
    },
    {
      id: "reward",
      name: "Reward/Seizing the Sword",
      description: "Protagonist gains key resource",
      phase: "rising",
      type: "plot",
      prerequisites: ["midpoint"],
      requiredRoles: ["protagonist"],
      triggerConditions: ["after_midpoint_victory"],
      tensionChange: -0.1,
      establishes: ["tool_for_climax"],
      optional: true,
      alternatives: [],
    },
  ],

  interventionSuggestions: [
    {
      trigger: "stagnation_in_exposition",
      type: "inject_stimulus",
      templates: [
        "A stranger arrives with urgent news",
        "An unexpected sound breaks the silence",
        "Someone discovers something they shouldn't have",
      ],
      targetPhase: "exposition",
    },
    {
      trigger: "protagonist_passive",
      type: "inject_stimulus",
      templates: [
        "A threat to something the protagonist cares about",
        "An opportunity that won't wait",
        "A challenge to the protagonist's identity",
      ],
    },
    {
      trigger: "tension_too_low_rising",
      type: "environmental",
      templates: [
        "Weather turns ominous",
        "Time pressure introduced",
        "Resources become scarce",
      ],
      targetPhase: "rising",
    },
    {
      trigger: "antagonist_absent",
      type: "inject_stimulus",
      templates: [
        "Evidence of antagonist's actions appears",
        "A message or threat from the antagonist",
        "Someone affected by the antagonist arrives",
      ],
    },
    {
      trigger: "approaching_climax_not_ready",
      type: "modify_mood",
      templates: [
        "Increase protagonist's arousal and focus",
        "Create sense of urgency",
        "Trigger fight-or-flight response",
      ],
      targetPhase: "crisis",
    },
  ],

  themes: ["transformation", "courage", "sacrifice", "growth"],
  motifs: ["journey", "threshold", "darkness_to_light", "mentor_knowledge"],
};

// =============================================================================
// MYSTERY TEMPLATE
// =============================================================================

export const MysteryTemplate: StoryTemplate = {
  id: "mystery",
  name: "Mystery/Investigation",
  description: "A puzzle to solve through investigation, clues, and revelation",
  genre: "mystery",

  acts: [
    {
      number: 1,
      name: "The Crime",
      purpose: "Establish the mystery and the detective's involvement",
      targetTension: [0.3, 0.5],
      phases: ["exposition", "inciting"],
      typicalDuration: 20,
      keyObjectives: [
        "Present the mystery/crime",
        "Introduce the investigator",
        "Establish the stakes",
        "First clues planted",
      ],
    },
    {
      number: 2,
      name: "The Investigation",
      purpose: "Gather clues, interview suspects, follow leads",
      targetTension: [0.4, 0.7],
      phases: ["rising"],
      typicalDuration: 55,
      keyObjectives: [
        "Red herrings introduced",
        "Multiple suspects emerge",
        "Investigator faces obstacles",
        "Key revelation that changes understanding",
      ],
    },
    {
      number: 3,
      name: "The Solution",
      purpose: "The truth revealed and justice served",
      targetTension: [0.7, 0.3],
      phases: ["crisis", "climax", "resolution"],
      typicalDuration: 25,
      keyObjectives: [
        "Final piece falls into place",
        "Confrontation with culprit",
        "Truth revealed to all",
        "Order restored",
      ],
    },
  ],

  requiredRoles: [
    {
      role: "detective",
      description: "The investigator seeking truth",
      arcType: "flat",
      motivations: ["justice", "truth", "curiosity"],
      conflicts: ["obstacles", "deception", "time_pressure"],
    },
    {
      role: "culprit",
      description: "The one responsible for the mystery",
      arcType: "transformation",
      motivations: ["hidden_motive", "self_preservation"],
      conflicts: ["covering_tracks", "guilt"],
    },
  ],

  optionalRoles: [
    {
      role: "victim",
      description: "The one affected by the crime",
      arcType: "flat",
      motivations: ["justice", "revenge", "closure"],
      conflicts: ["vulnerability", "secrets"],
    },
    {
      role: "suspect",
      description: "Someone who appears guilty but isn't",
      arcType: "growth",
      motivations: ["clearing_name", "own_secrets"],
      conflicts: ["suspicion", "past_mistakes"],
    },
    {
      role: "witness",
      description: "Someone who knows something",
      arcType: "flat",
      motivations: ["fear", "loyalty", "truth"],
      conflicts: ["danger", "conflicting_loyalties"],
    },
  ],

  idealDuration: 80,
  stagnationThreshold: 8,  // 8 ticks before nudging

  tensionCurve: [
    { phase: "exposition", targetTension: 0.4, tolerance: 0.1 },
    { phase: "inciting", targetTension: 0.5, tolerance: 0.1 },
    { phase: "rising", targetTension: 0.55, tolerance: 0.15 },
    { phase: "crisis", targetTension: 0.75, tolerance: 0.1 },
    { phase: "climax", targetTension: 0.9, tolerance: 0.1 },
    { phase: "falling", targetTension: 0.5, tolerance: 0.15 },
    { phase: "resolution", targetTension: 0.25, tolerance: 0.1 },
    { phase: "denouement", targetTension: 0.15, tolerance: 0.1 },
  ],

  pacingGuidelines: [
    { condition: "no_new_clues", action: "reveal_clue", priority: 1 },
    { condition: "too_obvious", action: "add_red_herring", priority: 2 },
    { condition: "detective_stuck", action: "new_witness_appears", priority: 1 },
    { condition: "culprit_too_hidden", action: "suspicious_behavior", priority: 2 },
    { condition: "suspects_too_few", action: "expand_suspect_pool", priority: 3 },
  ],

  keyBeats: [
    {
      id: "discovery",
      name: "The Discovery",
      description: "The mystery/crime is revealed",
      phase: "exposition",
      type: "plot",
      prerequisites: [],
      requiredRoles: [],
      triggerConditions: ["story_begins"],
      tensionChange: 0.3,
      establishes: ["central_mystery", "stakes"],
      optional: false,
      alternatives: [],
    },
    {
      id: "detective_involved",
      name: "Detective Takes the Case",
      description: "Investigator commits to solving the mystery",
      phase: "inciting",
      type: "character",
      prerequisites: ["discovery"],
      requiredRoles: ["detective"],
      triggerConditions: ["mystery_established"],
      tensionChange: 0.1,
      establishes: ["investigator_commitment"],
      optional: false,
      alternatives: [],
    },
    {
      id: "first_clue",
      name: "First Real Clue",
      description: "A genuine lead emerges",
      phase: "rising",
      type: "plot",
      prerequisites: ["detective_involved"],
      requiredRoles: ["detective"],
      triggerConditions: ["investigation_begun"],
      tensionChange: 0.1,
      establishes: ["investigation_direction"],
      optional: false,
      alternatives: [],
    },
    {
      id: "red_herring",
      name: "Red Herring",
      description: "A false lead that misdirects",
      phase: "rising",
      type: "plot",
      prerequisites: ["first_clue"],
      requiredRoles: ["detective", "suspect"],
      triggerConditions: ["investigation_progressing"],
      tensionChange: 0.15,
      establishes: ["complexity", "doubt"],
      optional: false,
      alternatives: [],
    },
    {
      id: "key_revelation",
      name: "Key Revelation",
      description: "Information that changes understanding",
      phase: "crisis",
      type: "plot",
      prerequisites: ["red_herring"],
      requiredRoles: ["detective"],
      triggerConditions: ["investigation_advanced"],
      tensionChange: 0.2,
      establishes: ["true_direction", "raised_stakes"],
      optional: false,
      alternatives: [],
    },
    {
      id: "confrontation",
      name: "Confrontation with Culprit",
      description: "Detective faces the truth",
      phase: "climax",
      type: "plot",
      prerequisites: ["key_revelation"],
      requiredRoles: ["detective", "culprit"],
      triggerConditions: ["truth_known"],
      tensionChange: 0.2,
      establishes: ["resolution_path"],
      optional: false,
      alternatives: [],
    },
    {
      id: "reveal",
      name: "The Reveal",
      description: "Truth exposed to all",
      phase: "resolution",
      type: "plot",
      prerequisites: ["confrontation"],
      requiredRoles: ["detective", "culprit"],
      triggerConditions: ["confrontation_resolved"],
      tensionChange: -0.3,
      establishes: ["justice", "closure"],
      optional: false,
      alternatives: [],
    },
  ],

  optionalBeats: [
    {
      id: "witness_interview",
      name: "Witness Interview",
      description: "Gathering information from witnesses",
      phase: "rising",
      type: "character",
      prerequisites: ["detective_involved"],
      requiredRoles: ["detective", "witness"],
      triggerConditions: ["need_information"],
      tensionChange: 0.05,
      establishes: ["new_information"],
      optional: true,
      alternatives: [],
    },
    {
      id: "suspect_interrogation",
      name: "Suspect Interrogation",
      description: "Confronting a suspect",
      phase: "rising",
      type: "character",
      prerequisites: ["first_clue"],
      requiredRoles: ["detective", "suspect"],
      triggerConditions: ["suspect_identified"],
      tensionChange: 0.15,
      establishes: ["suspect_cleared_or_implicated"],
      optional: true,
      alternatives: [],
    },
  ],

  interventionSuggestions: [
    {
      trigger: "investigation_stalled",
      type: "inject_stimulus",
      templates: [
        "A new piece of evidence surfaces",
        "An anonymous tip arrives",
        "A witness comes forward",
      ],
    },
    {
      trigger: "tension_too_low",
      type: "inject_stimulus",
      templates: [
        "The culprit takes action to cover tracks",
        "Time pressure is introduced",
        "Another incident occurs",
      ],
    },
    {
      trigger: "culprit_too_obvious",
      type: "inject_stimulus",
      templates: [
        "Evidence points away from obvious suspect",
        "New suspect emerges",
        "Alibi is established",
      ],
    },
  ],

  themes: ["truth", "justice", "deception", "observation"],
  motifs: ["clues", "secrets", "masks", "revelation"],
};

// =============================================================================
// SLICE OF LIFE TEMPLATE
// =============================================================================

export const SliceOfLifeTemplate: StoryTemplate = {
  id: "slice_of_life",
  name: "Slice of Life",
  description: "Character-driven narrative focusing on everyday moments and relationships",
  genre: "slice_of_life",

  acts: [
    {
      number: 1,
      name: "Introduction",
      purpose: "Establish characters, relationships, and daily rhythms",
      targetTension: [0.1, 0.2],
      phases: ["exposition"],
      typicalDuration: 30,
      keyObjectives: [
        "Introduce characters naturally",
        "Establish relationships and dynamics",
        "Show normal life patterns",
        "Hint at underlying desires/conflicts",
      ],
    },
    {
      number: 2,
      name: "Complication",
      purpose: "Small disruptions that reveal character",
      targetTension: [0.2, 0.5],
      phases: ["inciting", "rising"],
      typicalDuration: 45,
      keyObjectives: [
        "Introduce minor conflict or change",
        "Deepen character relationships",
        "Create moments of connection",
        "Allow for reflection and growth",
      ],
    },
    {
      number: 3,
      name: "Resolution",
      purpose: "Return to equilibrium with new understanding",
      targetTension: [0.3, 0.15],
      phases: ["falling", "resolution", "denouement"],
      typicalDuration: 25,
      keyObjectives: [
        "Resolve the complication (often quietly)",
        "Show how characters have changed",
        "Affirm relationships",
        "Return to daily life, transformed",
      ],
    },
  ],

  requiredRoles: [
    {
      role: "viewpoint_character",
      description: "The character through whom we experience the story",
      arcType: "growth",
      motivations: ["connection", "understanding", "belonging"],
      conflicts: ["internal_doubt", "social_friction"],
    },
  ],

  optionalRoles: [
    {
      role: "close_friend",
      description: "Someone who knows the viewpoint character well",
      arcType: "flat",
      motivations: ["friendship", "support"],
      conflicts: ["own_problems", "misunderstanding"],
    },
    {
      role: "new_acquaintance",
      description: "Someone who brings fresh perspective",
      arcType: "growth",
      motivations: ["acceptance", "finding_place"],
      conflicts: ["outsider_status", "past_baggage"],
    },
    {
      role: "family_member",
      description: "Family connection with history",
      arcType: "flat",
      motivations: ["love", "duty", "tradition"],
      conflicts: ["expectations", "generation_gap"],
    },
  ],

  idealDuration: 60,
  stagnationThreshold: 15,  // 15 ticks - slice of life is slower paced

  tensionCurve: [
    { phase: "exposition", targetTension: 0.15, tolerance: 0.1 },
    { phase: "inciting", targetTension: 0.25, tolerance: 0.1 },
    { phase: "rising", targetTension: 0.35, tolerance: 0.15 },
    { phase: "crisis", targetTension: 0.45, tolerance: 0.1 },
    { phase: "climax", targetTension: 0.5, tolerance: 0.1 },
    { phase: "falling", targetTension: 0.3, tolerance: 0.1 },
    { phase: "resolution", targetTension: 0.2, tolerance: 0.1 },
    { phase: "denouement", targetTension: 0.1, tolerance: 0.05 },
  ],

  pacingGuidelines: [
    { condition: "no_interaction", action: "create_encounter", priority: 1 },
    { condition: "tension_too_high", action: "quiet_moment", priority: 1 },
    { condition: "static_relationships", action: "reveal_vulnerability", priority: 2 },
    { condition: "too_much_introspection", action: "external_event", priority: 2 },
    { condition: "conflict_escalating", action: "de_escalate_naturally", priority: 1 },
  ],

  keyBeats: [
    {
      id: "daily_life",
      name: "A Day in Life",
      description: "Establishing normal routines",
      phase: "exposition",
      type: "character",
      prerequisites: [],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["story_begins"],
      tensionChange: 0,
      establishes: ["routine", "character_world"],
      optional: false,
      alternatives: [],
    },
    {
      id: "small_disruption",
      name: "Small Disruption",
      description: "Something slightly out of ordinary",
      phase: "inciting",
      type: "plot",
      prerequisites: ["daily_life"],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["routine_established"],
      tensionChange: 0.1,
      establishes: ["change_catalyst"],
      optional: false,
      alternatives: [],
    },
    {
      id: "connection_moment",
      name: "Moment of Connection",
      description: "Meaningful interaction between characters",
      phase: "rising",
      type: "character",
      prerequisites: ["small_disruption"],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["characters_together"],
      tensionChange: -0.05,
      establishes: ["deepened_relationship"],
      optional: false,
      alternatives: [],
    },
    {
      id: "quiet_revelation",
      name: "Quiet Revelation",
      description: "Small insight or realization",
      phase: "crisis",
      type: "character",
      prerequisites: ["connection_moment"],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["emotional_buildup"],
      tensionChange: 0.1,
      establishes: ["new_understanding"],
      optional: false,
      alternatives: [],
    },
    {
      id: "gentle_resolution",
      name: "Gentle Resolution",
      description: "Things settle into new normal",
      phase: "resolution",
      type: "thematic",
      prerequisites: ["quiet_revelation"],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["insight_gained"],
      tensionChange: -0.15,
      establishes: ["acceptance", "growth"],
      optional: false,
      alternatives: [],
    },
  ],

  optionalBeats: [
    {
      id: "shared_meal",
      name: "Shared Meal",
      description: "Characters connect over food",
      phase: "rising",
      type: "character",
      prerequisites: [],
      requiredRoles: ["viewpoint_character"],
      triggerConditions: ["mealtime"],
      tensionChange: -0.05,
      establishes: ["community", "normalcy"],
      optional: true,
      alternatives: [],
    },
    {
      id: "seasonal_moment",
      name: "Seasonal Moment",
      description: "Connection to nature/time passing",
      phase: "exposition",
      type: "thematic",
      prerequisites: [],
      requiredRoles: [],
      triggerConditions: ["environment_described"],
      tensionChange: 0,
      establishes: ["atmosphere", "time_passing"],
      optional: true,
      alternatives: [],
    },
  ],

  interventionSuggestions: [
    {
      trigger: "characters_isolated",
      type: "inject_stimulus",
      templates: [
        "A reason to visit someone",
        "An unexpected encounter",
        "A shared task or activity",
      ],
    },
    {
      trigger: "too_peaceful",
      type: "inject_stimulus",
      templates: [
        "Minor inconvenience",
        "Small misunderstanding",
        "Reminder of something unresolved",
      ],
    },
    {
      trigger: "emotional_flatness",
      type: "modify_mood",
      templates: [
        "Nostalgia triggered by sensory detail",
        "Sudden appreciation for present moment",
        "Brief melancholy",
      ],
    },
  ],

  themes: ["connection", "acceptance", "appreciation", "growth"],
  motifs: ["seasons", "meals", "small_gestures", "quiet_moments"],
};

// =============================================================================
// CONFLICT/CONFRONTATION TEMPLATE
// =============================================================================

export const ConflictTemplate: StoryTemplate = {
  id: "conflict",
  name: "Conflict/Confrontation",
  description: "Direct opposition between parties building to confrontation",
  genre: "conflict",

  acts: [
    {
      number: 1,
      name: "Opposition Established",
      purpose: "Introduce opposing parties and their incompatible goals",
      targetTension: [0.3, 0.5],
      phases: ["exposition", "inciting"],
      typicalDuration: 25,
      keyObjectives: [
        "Establish both sides' positions",
        "Show why compromise seems impossible",
        "First direct confrontation",
        "Stakes established",
      ],
    },
    {
      number: 2,
      name: "Escalation",
      purpose: "Conflict intensifies with each exchange",
      targetTension: [0.5, 0.85],
      phases: ["rising", "crisis"],
      typicalDuration: 50,
      keyObjectives: [
        "Each side takes actions",
        "Consequences ripple outward",
        "Others are drawn in",
        "Point of no return",
      ],
    },
    {
      number: 3,
      name: "Resolution",
      purpose: "Conflict comes to head and is resolved",
      targetTension: [0.85, 0.3],
      phases: ["climax", "falling", "resolution"],
      typicalDuration: 25,
      keyObjectives: [
        "Final confrontation",
        "One side prevails or compromise reached",
        "Aftermath dealt with",
        "New status quo",
      ],
    },
  ],

  requiredRoles: [
    {
      role: "party_a",
      description: "One side of the conflict",
      arcType: "transformation",
      motivations: ["goal", "values", "necessity"],
      conflicts: ["opposition", "cost_of_victory"],
    },
    {
      role: "party_b",
      description: "The opposing side",
      arcType: "transformation",
      motivations: ["opposing_goal", "different_values", "necessity"],
      conflicts: ["opposition", "cost_of_victory"],
    },
  ],

  optionalRoles: [
    {
      role: "neutral_party",
      description: "Someone caught in the middle",
      arcType: "growth",
      motivations: ["peace", "survival", "own_interests"],
      conflicts: ["pressure_from_both_sides", "forced_choice"],
    },
    {
      role: "mediator",
      description: "Someone trying to resolve the conflict",
      arcType: "flat",
      motivations: ["peace", "justice", "duty"],
      conflicts: ["distrust", "own_biases"],
    },
  ],

  idealDuration: 70,
  stagnationThreshold: 6,  // 6 ticks - conflict stories need constant momentum

  tensionCurve: [
    { phase: "exposition", targetTension: 0.4, tolerance: 0.1 },
    { phase: "inciting", targetTension: 0.55, tolerance: 0.1 },
    { phase: "rising", targetTension: 0.7, tolerance: 0.1 },
    { phase: "crisis", targetTension: 0.85, tolerance: 0.1 },
    { phase: "climax", targetTension: 0.95, tolerance: 0.05 },
    { phase: "falling", targetTension: 0.6, tolerance: 0.15 },
    { phase: "resolution", targetTension: 0.35, tolerance: 0.1 },
    { phase: "denouement", targetTension: 0.2, tolerance: 0.1 },
  ],

  pacingGuidelines: [
    { condition: "tension_dropping", action: "provocation", priority: 1 },
    { condition: "one_side_passive", action: "force_response", priority: 1 },
    { condition: "conflict_static", action: "escalate_stakes", priority: 1 },
    { condition: "no_consequences", action: "show_cost", priority: 2 },
    { condition: "bystanders_uninvolved", action: "collateral_effect", priority: 3 },
  ],

  keyBeats: [
    {
      id: "opposing_positions",
      name: "Opposing Positions Revealed",
      description: "Both sides' incompatible goals made clear",
      phase: "exposition",
      type: "plot",
      prerequisites: [],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["parties_introduced"],
      tensionChange: 0.2,
      establishes: ["central_conflict", "stakes"],
      optional: false,
      alternatives: [],
    },
    {
      id: "first_clash",
      name: "First Direct Clash",
      description: "Initial confrontation between parties",
      phase: "inciting",
      type: "plot",
      prerequisites: ["opposing_positions"],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["parties_in_proximity"],
      tensionChange: 0.15,
      establishes: ["conflict_dynamic"],
      optional: false,
      alternatives: [],
    },
    {
      id: "escalation",
      name: "Escalation",
      description: "Stakes or intensity increases",
      phase: "rising",
      type: "plot",
      prerequisites: ["first_clash"],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["after_first_clash"],
      tensionChange: 0.15,
      establishes: ["raised_stakes"],
      optional: false,
      alternatives: [],
    },
    {
      id: "point_of_no_return",
      name: "Point of No Return",
      description: "Action taken that cannot be undone",
      phase: "crisis",
      type: "plot",
      prerequisites: ["escalation"],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["high_tension"],
      tensionChange: 0.1,
      establishes: ["inevitability"],
      optional: false,
      alternatives: [],
    },
    {
      id: "final_confrontation",
      name: "Final Confrontation",
      description: "Decisive clash",
      phase: "climax",
      type: "plot",
      prerequisites: ["point_of_no_return"],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["climax_ready"],
      tensionChange: 0.1,
      establishes: ["resolution_direction"],
      optional: false,
      alternatives: [],
    },
    {
      id: "aftermath",
      name: "Aftermath",
      description: "Dealing with consequences",
      phase: "resolution",
      type: "character",
      prerequisites: ["final_confrontation"],
      requiredRoles: [],
      triggerConditions: ["conflict_resolved"],
      tensionChange: -0.4,
      establishes: ["new_status_quo"],
      optional: false,
      alternatives: [],
    },
  ],

  optionalBeats: [
    {
      id: "failed_negotiation",
      name: "Failed Negotiation",
      description: "Attempt at peace that fails",
      phase: "rising",
      type: "character",
      prerequisites: ["first_clash"],
      requiredRoles: ["party_a", "party_b"],
      triggerConditions: ["attempt_at_peace"],
      tensionChange: 0.1,
      establishes: ["impossibility_of_compromise"],
      optional: true,
      alternatives: [],
    },
    {
      id: "collateral_damage",
      name: "Collateral Damage",
      description: "Innocent affected by conflict",
      phase: "rising",
      type: "plot",
      prerequisites: ["escalation"],
      requiredRoles: ["neutral_party"],
      triggerConditions: ["conflict_spreading"],
      tensionChange: 0.1,
      establishes: ["wider_consequences"],
      optional: true,
      alternatives: [],
    },
  ],

  interventionSuggestions: [
    {
      trigger: "conflict_stalling",
      type: "inject_stimulus",
      templates: [
        "One side takes provocative action",
        "New information changes calculations",
        "Third party involvement",
      ],
    },
    {
      trigger: "tension_plateau",
      type: "environmental",
      templates: [
        "Resource becomes scarce",
        "External pressure increases",
        "Time limit imposed",
      ],
    },
    {
      trigger: "one_side_dominant",
      type: "inject_stimulus",
      templates: [
        "Underdog receives unexpected support",
        "Dominant side overreaches",
        "Hidden weakness revealed",
      ],
    },
  ],

  themes: ["power", "justice", "cost_of_conflict", "compromise"],
  motifs: ["battle_lines", "escalation", "casualties", "victory_pyrrhic"],
};

// =============================================================================
// EPISODIC/ONGOING TEMPLATE
// =============================================================================

export const EpisodicTemplate: StoryTemplate = {
  id: "episodic",
  name: "Episodic/Ongoing Saga",
  description: "Infinite narrative with rotating plot threads, mini-arcs, and character cycles. Stories never truly end - they evolve.",
  genre: "slice_of_life",  // Closest match - character-driven ongoing

  acts: [
    {
      number: 1,
      name: "Episode Setup",
      purpose: "Introduce this episode's focus while maintaining ongoing threads",
      targetTension: [0.2, 0.4],
      phases: ["exposition", "inciting"],
      typicalDuration: 20,
      keyObjectives: [
        "Reference ongoing plot threads",
        "Introduce episode-specific hook",
        "Check in with main characters",
        "Plant seeds for future episodes",
      ],
    },
    {
      number: 2,
      name: "Episode Development",
      purpose: "Develop this episode's thread while advancing long-term arcs",
      targetTension: [0.4, 0.7],
      phases: ["rising", "crisis"],
      typicalDuration: 50,
      keyObjectives: [
        "Advance episode plot",
        "Create character moments",
        "Introduce complications",
        "Connect to larger narrative",
      ],
    },
    {
      number: 3,
      name: "Episode Resolution",
      purpose: "Resolve episode hook but leave larger threads open",
      targetTension: [0.6, 0.3],
      phases: ["climax", "falling"],
      typicalDuration: 30,
      keyObjectives: [
        "Resolve immediate episode conflict",
        "Leave ongoing threads unresolved",
        "Set up next episode hook",
        "Character growth moment",
      ],
    },
  ],

  requiredRoles: [
    {
      role: "ensemble_cast",
      description: "Rotating focus characters from a stable cast",
      arcType: "growth",
      motivations: ["personal_goals", "relationships", "community"],
      conflicts: ["interpersonal", "personal_growth", "external_threats"],
    },
  ],

  optionalRoles: [
    {
      role: "recurring_antagonist",
      description: "Opposition that returns across episodes",
      arcType: "transformation",
      motivations: ["ongoing_goal", "revenge", "ideology"],
      conflicts: ["protagonist_opposition", "own_arc"],
    },
    {
      role: "guest_character",
      description: "Episode-specific character who may return",
      arcType: "flat",
      motivations: ["episode_specific"],
      conflicts: ["episode_specific"],
    },
    {
      role: "wildcard",
      description: "Unpredictable character who shakes things up",
      arcType: "flat",
      motivations: ["chaos", "self_interest"],
      conflicts: ["unpredictability"],
    },
  ],

  idealDuration: 50,  // Per episode - cycles infinitely
  stagnationThreshold: 12,

  tensionCurve: [
    { phase: "exposition", targetTension: 0.25, tolerance: 0.15 },
    { phase: "inciting", targetTension: 0.4, tolerance: 0.1 },
    { phase: "rising", targetTension: 0.55, tolerance: 0.15 },
    { phase: "crisis", targetTension: 0.7, tolerance: 0.15 },
    { phase: "climax", targetTension: 0.75, tolerance: 0.1 },  // Lower peak than finite stories
    { phase: "falling", targetTension: 0.4, tolerance: 0.15 },
    { phase: "resolution", targetTension: 0.3, tolerance: 0.1 },  // Never fully resolves
    { phase: "denouement", targetTension: 0.25, tolerance: 0.1 },  // Sets up next episode
  ],

  pacingGuidelines: [
    { condition: "tension_too_high_sustained", action: "release_valve_moment", priority: 1 },
    { condition: "tension_too_low_sustained", action: "introduce_complication", priority: 1 },
    { condition: "plot_thread_stale", action: "escalate_or_resolve_thread", priority: 2 },
    { condition: "character_underused", action: "focus_episode_on_character", priority: 2 },
    { condition: "no_active_threads", action: "introduce_new_thread", priority: 1 },
    { condition: "too_many_threads", action: "resolve_minor_thread", priority: 2 },
    { condition: "approaching_episode_end", action: "plant_next_hook", priority: 1 },
  ],

  keyBeats: [
    {
      id: "episode_hook",
      name: "Episode Hook",
      description: "Something happens that defines this episode's focus",
      phase: "inciting",
      type: "plot",
      prerequisites: [],
      requiredRoles: ["ensemble_cast"],
      triggerConditions: ["episode_begins"],
      tensionChange: 0.15,
      establishes: ["episode_focus"],
      optional: false,
      alternatives: [],
    },
    {
      id: "character_spotlight",
      name: "Character Spotlight",
      description: "A character gets meaningful development",
      phase: "rising",
      type: "character",
      prerequisites: ["episode_hook"],
      requiredRoles: ["ensemble_cast"],
      triggerConditions: ["episode_progressing"],
      tensionChange: 0.1,
      establishes: ["character_depth"],
      optional: false,
      alternatives: [],
    },
    {
      id: "thread_advancement",
      name: "Thread Advancement",
      description: "An ongoing plot thread moves forward",
      phase: "rising",
      type: "plot",
      prerequisites: ["episode_hook"],
      requiredRoles: [],
      triggerConditions: ["ongoing_thread_exists"],
      tensionChange: 0.1,
      establishes: ["continuity"],
      optional: false,
      alternatives: [],
    },
    {
      id: "episode_climax",
      name: "Episode Climax",
      description: "The episode's specific conflict peaks",
      phase: "climax",
      type: "plot",
      prerequisites: ["character_spotlight"],
      requiredRoles: ["ensemble_cast"],
      triggerConditions: ["episode_tension_high"],
      tensionChange: 0.1,
      establishes: ["episode_resolution_path"],
      optional: false,
      alternatives: [],
    },
    {
      id: "partial_resolution",
      name: "Partial Resolution",
      description: "Episode conflict resolves but larger issues remain",
      phase: "resolution",
      type: "plot",
      prerequisites: ["episode_climax"],
      requiredRoles: [],
      triggerConditions: ["episode_climax_passed"],
      tensionChange: -0.2,
      establishes: ["episode_closure", "ongoing_questions"],
      optional: false,
      alternatives: [],
    },
    {
      id: "next_hook",
      name: "Next Episode Hook",
      description: "Something happens that sets up the next episode",
      phase: "denouement",
      type: "plot",
      prerequisites: ["partial_resolution"],
      requiredRoles: [],
      triggerConditions: ["episode_ending"],
      tensionChange: 0.1,  // Slight uptick to create anticipation
      establishes: ["next_episode_setup"],
      optional: false,
      alternatives: [],
    },
  ],

  optionalBeats: [
    {
      id: "callback",
      name: "Callback to Past",
      description: "Reference to events from previous episodes",
      phase: "exposition",
      type: "thematic",
      prerequisites: [],
      requiredRoles: [],
      triggerConditions: ["past_events_exist"],
      tensionChange: 0,
      establishes: ["continuity", "world_history"],
      optional: true,
      alternatives: [],
    },
    {
      id: "new_thread_seed",
      name: "New Thread Seed",
      description: "Plant the seed of a future plot thread",
      phase: "rising",
      type: "plot",
      prerequisites: [],
      requiredRoles: [],
      triggerConditions: ["thread_capacity_available"],
      tensionChange: 0.05,
      establishes: ["future_potential"],
      optional: true,
      alternatives: [],
    },
    {
      id: "breather_moment",
      name: "Breather Moment",
      description: "Low-stakes character interaction",
      phase: "falling",
      type: "character",
      prerequisites: [],
      requiredRoles: ["ensemble_cast"],
      triggerConditions: ["tension_was_high"],
      tensionChange: -0.1,
      establishes: ["character_bonds", "emotional_reset"],
      optional: true,
      alternatives: [],
    },
  ],

  interventionSuggestions: [
    {
      trigger: "episode_stagnating",
      type: "inject_stimulus",
      templates: [
        "A character from a dormant plot thread reappears",
        "News arrives that changes the situation",
        "An unexpected visitor brings complications",
        "Someone discovers a secret",
      ],
    },
    {
      trigger: "tension_sustained_high",
      type: "inject_stimulus",
      templates: [
        "A moment of levity breaks the tension",
        "Characters take a breath to regroup",
        "A small victory provides relief",
      ],
    },
    {
      trigger: "tension_sustained_low",
      type: "inject_stimulus",
      templates: [
        "A dormant conflict resurfaces",
        "Someone makes a mistake with consequences",
        "External pressure arrives",
      ],
    },
    {
      trigger: "character_fading",
      type: "inject_stimulus",
      templates: [
        "Focus shifts to underused character",
        "Character faces a personal challenge",
        "Character's past comes back",
      ],
    },
    {
      trigger: "approaching_episode_boundary",
      type: "inject_stimulus",
      templates: [
        "A cliffhanger moment approaches",
        "An unresolved question is highlighted",
        "A new mystery is introduced",
      ],
    },
  ],

  themes: ["community", "growth", "persistence", "change", "cycles"],
  motifs: ["seasons", "returns", "echoes", "generations"],
};

// =============================================================================
// TEMPLATE REGISTRY
// =============================================================================

export const StoryTemplates: Record<string, StoryTemplate> = {
  classic_three_act: ClassicThreeActTemplate,
  mystery: MysteryTemplate,
  slice_of_life: SliceOfLifeTemplate,
  conflict: ConflictTemplate,
  episodic: EpisodicTemplate,
};

// =============================================================================
// TEMPLATE UTILITIES
// =============================================================================

/**
 * Get suggested template based on simulation characteristics
 */
export function suggestTemplate(
  agentCount: number,
  hasAntagonist: boolean,
  preferredTension: "low" | "medium" | "high"
): StoryTemplate {
  if (preferredTension === "low") {
    return SliceOfLifeTemplate;
  }

  if (hasAntagonist && preferredTension === "high") {
    return ConflictTemplate;
  }

  if (agentCount <= 5 && !hasAntagonist) {
    return SliceOfLifeTemplate;
  }

  return ClassicThreeActTemplate;
}

/**
 * Get the next expected beat based on current state
 */
export function getNextExpectedBeat(
  template: StoryTemplate,
  completedBeatIds: string[],
  currentPhase: NarrativePhase
): BeatTemplate | null {
  // Find beats for current phase that haven't been completed
  const availableBeats = template.keyBeats.filter(beat => {
    if (completedBeatIds.includes(beat.id)) return false;
    if (beat.phase !== currentPhase) return false;

    // Check prerequisites
    const prereqsMet = beat.prerequisites.every(prereqId =>
      completedBeatIds.includes(prereqId)
    );
    return prereqsMet;
  });

  return availableBeats[0] || null;
}

/**
 * Get intervention suggestions based on current state
 */
export function getInterventionSuggestions(
  template: StoryTemplate,
  currentTension: number,
  currentPhase: NarrativePhase,
  ticksSinceLastEvent: number
): InterventionSuggestion[] {
  const suggestions: InterventionSuggestion[] = [];

  // Find target tension for current phase
  const tensionTarget = template.tensionCurve.find(t => t.phase === currentPhase);

  if (tensionTarget) {
    const tensionDiff = currentTension - tensionTarget.targetTension;

    // Too low tension
    if (tensionDiff < -tensionTarget.tolerance) {
      suggestions.push(...template.interventionSuggestions.filter(s =>
        s.trigger.includes("tension_too_low") ||
        s.trigger.includes("stagnation")
      ));
    }

    // Too high tension (for low-tension genres)
    if (tensionDiff > tensionTarget.tolerance && template.genre === "slice_of_life") {
      suggestions.push(...template.interventionSuggestions.filter(s =>
        s.trigger.includes("tension_too_high")
      ));
    }
  }

  // Stagnation check
  if (ticksSinceLastEvent > template.stagnationThreshold) {
    suggestions.push(...template.interventionSuggestions.filter(s =>
      s.trigger.includes("stagnation") ||
      s.trigger.includes("stalled")
    ));
  }

  return suggestions;
}

/**
 * Calculate how well the current story matches the template
 */
export function calculateTemplateAlignment(
  template: StoryTemplate,
  currentTension: number,
  currentPhase: NarrativePhase,
  completedBeatIds: string[],
  eventCount: number
): { alignment: number; issues: string[] } {
  const issues: string[] = [];
  let alignmentScore = 1.0;

  // Check tension alignment
  const tensionTarget = template.tensionCurve.find(t => t.phase === currentPhase);
  if (tensionTarget) {
    const tensionDiff = Math.abs(currentTension - tensionTarget.targetTension);
    if (tensionDiff > tensionTarget.tolerance) {
      alignmentScore -= 0.2;
      issues.push(`Tension (${currentTension.toFixed(2)}) differs from target (${tensionTarget.targetTension}) for ${currentPhase} phase`);
    }
  }

  // Check beat completion
  const requiredBeatsForPhase = template.keyBeats.filter(b =>
    !b.optional &&
    template.acts.findIndex(a => a.phases.includes(b.phase)) <=
    template.acts.findIndex(a => a.phases.includes(currentPhase))
  );

  const missedBeats = requiredBeatsForPhase.filter(b =>
    !completedBeatIds.includes(b.id)
  );

  if (missedBeats.length > 0) {
    alignmentScore -= missedBeats.length * 0.1;
    issues.push(`Missing key beats: ${missedBeats.map(b => b.name).join(", ")}`);
  }

  // Check pacing (rough estimate)
  const expectedProgress = eventCount / template.idealDuration;
  const phaseIndex = ["exposition", "inciting", "rising", "crisis", "climax", "falling", "resolution", "denouement"].indexOf(currentPhase);
  const expectedPhaseProgress = phaseIndex / 8;

  if (Math.abs(expectedProgress - expectedPhaseProgress) > 0.3) {
    alignmentScore -= 0.15;
    issues.push(`Pacing issue: story at ${(expectedProgress * 100).toFixed(0)}% but phase suggests ${(expectedPhaseProgress * 100).toFixed(0)}%`);
  }

  return {
    alignment: Math.max(0, alignmentScore),
    issues,
  };
}

// =============================================================================
// EPISODIC CYCLE MANAGEMENT
// =============================================================================

export interface EpisodeState {
  episodeNumber: number;
  episodeTitle?: string;
  startedAt: number;
  completedBeats: string[];
  focusCharacters: string[];
  activeThreads: string[];
  dormantThreads: string[];
  resolvedThreads: string[];
}

let currentEpisode: EpisodeState | null = null;
let episodeHistory: EpisodeState[] = [];

/**
 * Start a new episode in an ongoing narrative
 */
export function startNewEpisode(
  focusCharacters: string[] = [],
  episodeTitle?: string
): EpisodeState {
  // Archive current episode if exists
  if (currentEpisode) {
    episodeHistory.push({ ...currentEpisode });
  }

  const episodeNumber = episodeHistory.length + 1;

  currentEpisode = {
    episodeNumber,
    episodeTitle: episodeTitle || `Episode ${episodeNumber}`,
    startedAt: Date.now(),
    completedBeats: [],
    focusCharacters,
    activeThreads: currentEpisode?.activeThreads || [],
    dormantThreads: currentEpisode?.dormantThreads || [],
    resolvedThreads: [],
  };

  console.log(`[Narrator] Starting ${currentEpisode.episodeTitle}`);
  return currentEpisode;
}

/**
 * Get the current episode state
 */
export function getCurrentEpisode(): EpisodeState | null {
  return currentEpisode;
}

/**
 * Get episode history
 */
export function getEpisodeHistory(): EpisodeState[] {
  return episodeHistory;
}

/**
 * Add a plot thread to the current episode
 */
export function addPlotThread(threadId: string, dormant: boolean = false): void {
  if (!currentEpisode) return;

  if (dormant) {
    if (!currentEpisode.dormantThreads.includes(threadId)) {
      currentEpisode.dormantThreads.push(threadId);
    }
  } else {
    if (!currentEpisode.activeThreads.includes(threadId)) {
      currentEpisode.activeThreads.push(threadId);
    }
    // Remove from dormant if it was there
    currentEpisode.dormantThreads = currentEpisode.dormantThreads.filter(t => t !== threadId);
  }
}

/**
 * Resolve a plot thread
 */
export function resolvePlotThread(threadId: string): void {
  if (!currentEpisode) return;

  currentEpisode.activeThreads = currentEpisode.activeThreads.filter(t => t !== threadId);
  currentEpisode.dormantThreads = currentEpisode.dormantThreads.filter(t => t !== threadId);

  if (!currentEpisode.resolvedThreads.includes(threadId)) {
    currentEpisode.resolvedThreads.push(threadId);
  }
}

/**
 * Make a thread dormant (for picking up later)
 */
export function makePlotThreadDormant(threadId: string): void {
  if (!currentEpisode) return;

  currentEpisode.activeThreads = currentEpisode.activeThreads.filter(t => t !== threadId);
  if (!currentEpisode.dormantThreads.includes(threadId)) {
    currentEpisode.dormantThreads.push(threadId);
  }
}

/**
 * Check if it's time to end the current episode
 */
export function shouldEndEpisode(
  template: StoryTemplate,
  ticksSinceStart: number,
  completedBeats: string[]
): { shouldEnd: boolean; reason: string } {
  if (template.id !== "episodic") {
    return { shouldEnd: false, reason: "Not using episodic template" };
  }

  // Check if all required beats are done
  const requiredBeats = template.keyBeats.filter(b => !b.optional).map(b => b.id);
  const allBeatsComplete = requiredBeats.every(b => completedBeats.includes(b));

  if (allBeatsComplete) {
    return { shouldEnd: true, reason: "All episode beats completed" };
  }

  // Check if we've exceeded ideal duration significantly
  if (ticksSinceStart > template.idealDuration * 1.5) {
    return { shouldEnd: true, reason: "Episode duration exceeded" };
  }

  return { shouldEnd: false, reason: "Episode in progress" };
}

// =============================================================================
// NARRATIVE OUTPUT FOR COMICS/VISUALIZATION
// =============================================================================

/**
 * A single panel in a comic representation
 */
export interface ComicPanel {
  id: string;
  sequence: number;
  type: "action" | "dialogue" | "thought" | "establishing" | "reaction" | "transition";

  // Scene context
  location: string;
  timeOfDay?: string;
  mood: string;  // "tense", "peaceful", "chaotic", etc.

  // Characters in panel
  characters: {
    name: string;
    position: "left" | "center" | "right" | "background";
    expression: string;  // "happy", "angry", "surprised", etc.
    pose?: string;       // "standing", "sitting", "running", etc.
    speaking: boolean;
  }[];

  // Content
  dialogue?: {
    speaker: string;
    text: string;
    type: "speech" | "thought" | "narration" | "whisper" | "shout";
  }[];

  narration?: string;  // Caption box text
  soundEffect?: string;  // "CRASH!", "knock knock", etc.

  // Visual suggestions
  cameraAngle?: "wide" | "medium" | "closeup" | "extreme_closeup" | "bird_eye" | "worm_eye";
  focusOn?: string;  // Character or object to focus on

  // Metadata
  beatId?: string;  // Associated story beat
  tensionLevel: number;  // 0-1
}

/**
 * A page of comic panels
 */
export interface ComicPage {
  pageNumber: number;
  panels: ComicPanel[];
  layout: "single" | "two_horizontal" | "two_vertical" | "grid_2x2" | "grid_3x3" | "dynamic";
}

/**
 * Full comic output from narrative
 */
export interface ComicOutput {
  title: string;
  episode?: number;
  pages: ComicPage[];
  characters: {
    name: string;
    description: string;
    defaultExpression: string;
  }[];
  generatedAt: number;
}

/**
 * Convert a narrative event to comic panel format
 */
export function narrativeEventToPanel(
  event: {
    type: string;
    actor: string;
    target?: string;
    content: string;
    location: string;
  },
  sequence: number,
  characters: { name: string; mood: string }[],
  tensionLevel: number
): ComicPanel {
  const panel: ComicPanel = {
    id: `panel_${Date.now()}_${sequence}`,
    sequence,
    type: mapEventToType(event.type),
    location: event.location,
    mood: tensionLevel > 0.7 ? "tense" : tensionLevel < 0.3 ? "peaceful" : "neutral",
    characters: [],
    tensionLevel,
  };

  // Determine camera angle based on event type
  if (event.type === "speak" || event.type === "dialogue") {
    panel.cameraAngle = "medium";
    panel.dialogue = [{
      speaker: event.actor,
      text: event.content,
      type: "speech",
    }];
  } else if (event.type === "thought" || event.type === "emotion") {
    panel.cameraAngle = "closeup";
    panel.focusOn = event.actor;
    panel.dialogue = [{
      speaker: event.actor,
      text: event.content,
      type: "thought",
    }];
  } else if (event.type === "action") {
    panel.cameraAngle = tensionLevel > 0.7 ? "wide" : "medium";
    panel.narration = event.content;
  }

  // Add characters to panel
  const actorChar = characters.find(c => c.name === event.actor);
  if (actorChar) {
    panel.characters.push({
      name: event.actor,
      position: "center",
      expression: moodToExpression(actorChar.mood),
      speaking: event.type === "speak" || event.type === "dialogue",
    });
  }

  if (event.target) {
    const targetChar = characters.find(c => c.name === event.target);
    if (targetChar) {
      panel.characters.push({
        name: event.target,
        position: "right",
        expression: moodToExpression(targetChar.mood),
        speaking: false,
      });
    }
  }

  return panel;
}

function mapEventToType(eventType: string): ComicPanel["type"] {
  switch (eventType) {
    case "speak":
    case "dialogue":
    case "dialogue_spoken":
      return "dialogue";
    case "thought":
    case "emotion":
      return "thought";
    case "action":
    case "action_executed":
      return "action";
    case "movement":
    case "room_entered":
    case "room_left":
      return "transition";
    default:
      return "action";
  }
}

function moodToExpression(mood: string): string {
  const moodMap: Record<string, string> = {
    calm: "neutral",
    alert: "attentive",
    excited: "eager",
    anxious: "worried",
    angry: "angry",
    sad: "sad",
    happy: "happy",
    scared: "frightened",
    suspicious: "skeptical",
  };
  return moodMap[mood] || "neutral";
}

/**
 * Organize panels into pages with appropriate layouts
 */
export function organizePanelsIntoPages(
  panels: ComicPanel[],
  panelsPerPage: number = 4
): ComicPage[] {
  const pages: ComicPage[] = [];
  let currentPage: ComicPanel[] = [];
  let pageNumber = 1;

  for (const panel of panels) {
    currentPage.push(panel);

    // Start new page when full or at natural break points
    const shouldBreak =
      currentPage.length >= panelsPerPage ||
      panel.type === "transition" ||
      (panel.beatId && panel.beatId.includes("climax"));

    if (shouldBreak && currentPage.length > 0) {
      pages.push({
        pageNumber: pageNumber++,
        panels: [...currentPage],
        layout: selectLayout(currentPage),
      });
      currentPage = [];
    }
  }

  // Add remaining panels
  if (currentPage.length > 0) {
    pages.push({
      pageNumber: pageNumber++,
      panels: currentPage,
      layout: selectLayout(currentPage),
    });
  }

  return pages;
}

function selectLayout(panels: ComicPanel[]): ComicPage["layout"] {
  const count = panels.length;
  const hasDialogue = panels.some(p => p.dialogue && p.dialogue.length > 0);
  const highTension = panels.some(p => p.tensionLevel > 0.8);

  if (count === 1) return "single";
  if (count === 2) return hasDialogue ? "two_horizontal" : "two_vertical";
  if (count <= 4) return "grid_2x2";
  if (highTension) return "dynamic";
  return "grid_3x3";
}

/**
 * Hooks for external renderers (like nano-banana)
 */
export type NarrativeHook = (output: {
  type: "panel" | "page" | "episode_start" | "episode_end" | "beat_complete";
  data: ComicPanel | ComicPage | EpisodeState | { beatId: string; beatName: string };
}) => void | Promise<void>;

const narrativeHooks: NarrativeHook[] = [];

/**
 * Register a hook to receive narrative output for rendering
 */
export function registerNarrativeHook(hook: NarrativeHook): () => void {
  narrativeHooks.push(hook);
  return () => {
    const index = narrativeHooks.indexOf(hook);
    if (index > -1) {
      narrativeHooks.splice(index, 1);
    }
  };
}

/**
 * Emit to all registered narrative hooks
 */
export async function emitToNarrativeHooks(output: Parameters<NarrativeHook>[0]): Promise<void> {
  for (const hook of narrativeHooks) {
    try {
      await hook(output);
    } catch (error) {
      console.error("[Narrator] Hook error:", error);
    }
  }
}

/**
 * Get role assignment suggestions based on agent characteristics
 */
export function suggestRoleAssignments(
  template: StoryTemplate,
  agents: { name: string; traits: string[]; arousal: number }[]
): { role: string; suggestedAgent: string; reason: string }[] {
  const suggestions: { role: string; suggestedAgent: string; reason: string }[] = [];

  for (const role of template.requiredRoles) {
    // Simple heuristic: higher arousal = protagonist/antagonist
    // lower arousal = mentor/ally
    if (role.role === "protagonist" || role.role === "detective" || role.role === "viewpoint_character") {
      const highestArousal = agents.reduce((a, b) => a.arousal > b.arousal ? a : b);
      suggestions.push({
        role: role.role,
        suggestedAgent: highestArousal.name,
        reason: "Highest arousal/activity level",
      });
    } else if (role.role === "antagonist" || role.role === "culprit" || role.role === "party_b") {
      const sorted = [...agents].sort((a, b) => b.arousal - a.arousal);
      if (sorted.length > 1) {
        suggestions.push({
          role: role.role,
          suggestedAgent: sorted[1].name,
          reason: "Second highest arousal, distinct from protagonist",
        });
      }
    }
  }

  return suggestions;
}
