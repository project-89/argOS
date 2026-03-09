import { generateText } from "ai";
import type { World } from "../ecs/world";
import type { SystemDefinition, SystemRegistry, SystemContext, CognitiveContext, GoalData, MemoryData, BeliefData, ThoughtData, ImpressionData } from "../ecs/dynamic-systems";
import { AllComponents, Goal, Memory, Belief, Thought, Impression } from "../ecs/components";
import { AllRelations, HasGoal, HasMemory, HasBelief, HasThought, HasImpression } from "../ecs/relations";
import { query, hasComponent, getRelationTargets, addEntity, addComponent, removeEntity } from "bitecs";
import { createAIContext } from "../ai/ai-context";
import { moveEntity, isWalkable, getTile } from "../world/ascii-world";
import { query as q } from "bitecs";
import { WorldMap as WorldMapComponent } from "../ecs/components";
// LOCKED MODELS from centralized config - DO NOT CHANGE
import { systemBakerModel, plannerModel } from "../llm/config";
import { ActionRegistry } from "../cognition/action-registry";

// Pro for design/architecture, Flash for code generation
const designModel = plannerModel;      // Gemini 3 Pro - better reasoning for system design
const codeModel = systemBakerModel;    // Gemini 3 Flash - fast code generation

/**
 * Extract first valid JSON object from text using balanced brace matching.
 * Handles LLM outputs with explanatory text before/after JSON.
 */
function extractJSON(text: string): any {
  // Clean markdown code blocks first
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // Find the first '{' and track balanced braces
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        // Found complete JSON object
        const jsonStr = cleaned.slice(startIdx, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          // Continue searching if this parse fails
          continue;
        }
      }
    }
  }

  // Fallback: try original greedy regex
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function extractFencedCodeBlock(text: string): string | null {
  const match = text.match(/```(?:javascript|js|ts)?\s*([\s\S]*?)```/i);
  return match ? match[1] : null;
}

function sanitizeFunctionBody(raw: string): string {
  let code = raw.trim();

  const fenced = extractFencedCodeBlock(code);
  if (fenced) code = fenced.trim();

  // Remove any remaining fence markers.
  code = code.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```$/g, "").trim();

  // Strip leading non-code prose that sometimes sneaks in ("Fix:", "Explanation:", etc.).
  const lines = code.split("\n");
  while (lines.length > 0) {
    const line = lines[0].trim();
    if (line === "") {
      lines.shift();
      continue;
    }

    if (/^(here('s| is)|sure|fix(ing)?[:\s]|explanation[:\s]|note[:\s]|updated code[:\s])/i.test(line)) {
      lines.shift();
      continue;
    }

    if (/^\d+[\).]/.test(line) || /^- /.test(line)) {
      lines.shift();
      continue;
    }

    if (/:$/.test(line) && !/[;{]/.test(line)) {
      lines.shift();
      continue;
    }

    // Stop when the first line looks like JS.
    if (/^(\/\*\*?|\/\/|\*|\}|{|const |let |var |for |if |while |switch |return |try |throw |break;|continue;)/.test(line)) {
      break;
    }

    // If it's not obviously code, keep it (best-effort).
    break;
  }

  return lines.join("\n").trim();
}

function extractRequestedSystemName(description: string): string | null {
  const match = description.match(/(?:^|\n)System Name:\s*([^\n]+)/i);
  if (!match) return null;
  const raw = match[1].trim();
  const name = raw.replace(/[^A-Za-z0-9_-]/g, "");
  return name.length > 0 ? name : null;
}

export interface SystemBakeResult {
  success: boolean;
  system?: SystemDefinition;
  designDoc?: SystemDesignDoc;
  testResults?: TestResult[];
  error?: string;
}

export interface SystemDesignDoc {
  name: string;
  purpose: string;
  inputs: string[];
  modifiedComponents: string[];
  outputs: string[];
  pseudocode: string;
  frequency: number;
  async?: boolean;
  complexity?: "simple" | "moderate" | "complex";
  /** Actions this system enables for agents (registered with ActionRegistry) */
  providedActions?: Array<{
    name: string;
    description: string;
    category: "movement" | "social" | "combat" | "interaction" | "self" | "inventory";
    requiresTarget: boolean;
    requiresContent: boolean;
  }>;
}

export interface TestResult {
  name: string;
  passed: boolean;
  input: any;
  expectedOutput: any;
  actualOutput: any;
  error?: string;
}

/**
 * Validates that generated system code actually modifies ECS state.
 * Returns validation result with specific feedback.
 */
export function validateSystemCode(code: string, design: SystemDesignDoc): {
  valid: boolean;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // List of components that can be written to
  const writableComponents = [
    "Name", "Description", "Position", "Room", "Agent", "Mind", "WorkingMemory",
    "Attention", "Personality", "Thought", "Perception", "Memory", "Belief",
    "Impression", "Goal", "ConversationTurn", "Stimulus", "KnowledgeNode",
    "Action", "CognitiveEvent", "PhysicalObject", "StimulusSource", "GodAgent",
    "GridPosition", "Sprite", "WorldMap", "Needs", "Health", "Plan", "Schedule",
    "ReflectionState", "CombatStats", "InCombat", "StatusEffect", "Inventory",
    "Item", "EquipSlot", "Interactable", "ObjectState", "Container",
    // Deterministic cognition control layers
    "BehaviorPolicy", "ProcedureState"
  ];

  // Check for component writes (Pattern: ComponentName.property[eid] = value)
  const componentWritePattern = new RegExp(
    `(${writableComponents.join("|")})\\.\\w+\\[\\w+\\]\\s*=`,
    "g"
  );
  const componentWrites = code.match(componentWritePattern) || [];

  // Check for cognitive helper usage (these create entities with components)
  const cognitiveHelperPattern = /ctx\.cognitive\.(createGoal|createMemory|createBelief|createThought|createImpression|updateGoal|completeGoal)/g;
  const cognitiveHelperUses = code.match(cognitiveHelperPattern) || [];

  const helperCoverage: Record<string, RegExp[]> = {
    Goal: [
      /ctx\.cognitive\.(createGoal|updateGoal|completeGoal|removeGoal)\s*\(/,
    ],
    Memory: [
      /ctx\.cognitive\.createMemory\s*\(/,
    ],
    Belief: [
      /ctx\.cognitive\.createBelief\s*\(/,
    ],
    Thought: [
      /ctx\.cognitive\.createThought\s*\(/,
    ],
    Impression: [
      /ctx\.cognitive\.createImpression\s*\(/,
    ],
  };

  // Check for entity creation (addEntity + addComponent)
  const entityCreationPattern = /ctx\.addEntity\(world\)/g;
  const addComponentPattern = /ctx\.addComponent\(world,/g;
  const entityCreations = code.match(entityCreationPattern) || [];
  const componentAdds = code.match(addComponentPattern) || [];

  // Total state modifications
  const totalStateChanges = componentWrites.length + cognitiveHelperUses.length + (entityCreations.length > 0 && componentAdds.length > 0 ? 1 : 0);

  if (totalStateChanges === 0) {
    issues.push("NO STATE MODIFICATIONS DETECTED - System only emits events/logs without changing ECS state");
    suggestions.push("Add component writes like: Needs.hunger[eid] = value");
    suggestions.push("Or use ctx.cognitive.createMemory/createGoal/etc");
  }

  // Check for emit-only patterns (bad)
  const emitOnlyPattern = /ctx\.emit\(/g;
  const emits = code.match(emitOnlyPattern) || [];
  if (emits.length > 0 && totalStateChanges === 0) {
    issues.push(`System has ${emits.length} ctx.emit() calls but NO component writes - this is a text-only system`);
  }

  // Check that modified components from design are actually written
  if (design.modifiedComponents && design.modifiedComponents.length > 0) {
    for (const component of design.modifiedComponents) {
      const normalized = component.endsWith("s") ? component.slice(0, -1) : component;
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const compPattern = new RegExp(`${escaped}\\.\\w+\\[\\w+\\]\\s*=`);
      const addCompPattern = new RegExp(`ctx\\.addComponent\\(world,\\s*\\w+,\\s*${escaped}(?:\\(|\\b)`);
      const helperPatterns = helperCoverage[normalized] || [];
      const hasHelperWrite = helperPatterns.some((pattern) => pattern.test(code));

      if (!compPattern.test(code) && !addCompPattern.test(code) && !hasHelperWrite) {
        issues.push(`Design specifies ${component} should be modified, but no writes to ${component} found`);
        suggestions.push(`Add write: ${component}.someProperty[eid] = newValue`);
      }
    }
  }

  // Check for hardcoded name checks (anti-pattern)
  const hardcodedNamePattern = /Name\.value\[\w+\]\s*===?\s*["']/g;
  const hardcodedNames = code.match(hardcodedNamePattern) || [];
  if (hardcodedNames.length > 2) {
    issues.push(`Code has ${hardcodedNames.length} hardcoded name checks - use component/role-based logic instead`);
  }

  // Check for proper query usage
  if (!code.includes("ctx.query(world,")) {
    suggestions.push("Consider using ctx.query(world, [Components]) to iterate entities");
  }

  // Check for clamping on numeric values (good practice)
  if (componentWrites.length > 0 && !code.includes("Math.max") && !code.includes("Math.min")) {
    suggestions.push("Consider clamping numeric values: Math.max(0, Math.min(1, value))");
  }

  return {
    valid: issues.length === 0,
    issues,
    suggestions
  };
}

/**
 * Pre-built system templates for common ECS patterns.
 * These can be customized by the LLM for specific needs.
 */
export const SYSTEM_TEMPLATES = {
  needsDecay: `
// Needs Decay System - increases hunger/thirst over time
const agents = Array.from(ctx.query(world, [Agent, Needs]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  // Needs are canonicalized as 0..100.
  // - Hunger: 0 = full, 100 = starving
  // - Energy: 0 = exhausted, 100 = fully rested
  const currentHunger = Needs.hunger[eid] || 0;
  const hungerRate = 2; // per tick (~10s in slice-of-life preset)
  Needs.hunger[eid] = Math.min(100, currentHunger + hungerRate);

  // Energy decreases when active
  const currentEnergy = Needs.energy[eid] ?? 100;
  const energyDrain = 1;
  Needs.energy[eid] = Math.max(0, currentEnergy - energyDrain);

  // High hunger affects mood
  if (Needs.hunger[eid] >= 70) {
    Mind.arousal[eid] = Math.min(1, (Mind.arousal[eid] || 0.5) + 0.05);
    Mind.focus[eid] = "hungry";
  }

  // Low energy affects behavior
  if (Needs.energy[eid] <= 30) {
    Mind.focus[eid] = "tired";
  }
}`,

  needsSatisfaction: `
// Needs Satisfaction System - handles eating/resting
const agents = Array.from(ctx.query(world, [Agent, Needs, Mind]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  const focus = Mind.focus[eid] || "";
  const action = (Mind.mode[eid] || "").toLowerCase();

  // Eating reduces hunger
  if (focus.includes("eating") || action.includes("eat")) {
    const hunger = Needs.hunger[eid] || 0;
    if (hunger > 0) {
      Needs.hunger[eid] = Math.max(0, hunger - 25);
      ctx.emit("need_satisfied", {
        agent: Name.value[eid],
        need: "hunger",
        oldValue: hunger,
        newValue: Needs.hunger[eid]
      });
    }
  }

  // Resting restores energy
  if (focus.includes("resting") || focus.includes("sleeping") || action.includes("rest")) {
    const energy = Needs.energy[eid] ?? 100;
    if (energy < 100) {
      Needs.energy[eid] = Math.min(100, energy + 20);
    }
  }

  // Social interaction satisfies social need
  const roomEid = ctx.location.getRoomForEntity(world, eid);
  if (roomEid !== undefined) {
    let othersInRoom = 0;

    for (const otherEid of agents) {
      if (otherEid === eid) continue;
      if (ctx.location.getRoomForEntity(world, otherEid) === roomEid) othersInRoom++;
    }

    if (othersInRoom > 0) {
      const social = Needs.social[eid] ?? 50;
      Needs.social[eid] = Math.min(100, social + 2 * othersInRoom);
    }
  }
}`,

  healthSystem: `
// Health System - damage, regeneration, death
const agents = Array.from(ctx.query(world, [Agent, Health, Needs]));

for (const eid of agents) {
  const current = Health.current[eid] || 100;
  const max = Health.max[eid] || 100;
  const regenRate = Health.regenRate[eid] || 0.1;

  // Starvation damage
  const hunger = Needs.hunger[eid] || 0;
  if (hunger >= 100) {
    Health.current[eid] = Math.max(0, current - 1);
    Health.lastDamage[eid] = ctx.elapsed;
    ctx.emit("starvation_damage", { agent: Name.value[eid], health: Health.current[eid] });
  }
  // Regeneration when well-fed
  else if (hunger < 50 && current < max) {
    const timeSinceDamage = ctx.elapsed - (Health.lastDamage[eid] || 0);
    if (timeSinceDamage > 5000) { // 5 seconds since last damage
      Health.current[eid] = Math.min(max, current + regenRate);
    }
  }

  // Death check
  if (Health.current[eid] <= 0) {
    Agent.active[eid] = false;
    ctx.emit("agent_died", { agent: Name.value[eid], cause: "starvation" });
  }
}`,

  socialDynamics: `
// Social Dynamics - relationship building, familiarity
const agents = Array.from(ctx.query(world, [Agent, Mind]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  const roomEid = ctx.location.getRoomForEntity(world, eid);
  if (roomEid === undefined) continue;

  // Find others in same room
  for (const otherEid of agents) {
    if (otherEid === eid || !Agent.active[otherEid]) continue;

    if (ctx.location.getRoomForEntity(world, otherEid) !== roomEid) continue;

    // Build familiarity through proximity
    // Check if Knows relation exists, if not we track via impressions
    const impressions = ctx.getRelationTargets(world, eid, HasImpression);
    const otherName = Name.value[otherEid];

    let existingImpression = null;
    for (const impEid of impressions) {
      if (Impression.targetName[impEid] === otherName) {
        existingImpression = impEid;
        break;
      }
    }

    if (existingImpression) {
      // Strengthen existing impression
      const confidence = Impression.confidence[existingImpression] || 0;
      Impression.confidence[existingImpression] = Math.min(1, confidence + 0.01);
    } else {
      // Create new impression
      ctx.cognitive.createImpression(world, eid, {
        targetName: otherName,
        trait: "acquaintance",
        valence: 0.5,
        confidence: 0.1,
        basis: "proximity"
      });
    }

    // Arousal increases slightly when with others
    const arousal = Mind.arousal[eid] || 0.5;
    Mind.arousal[eid] = Math.min(1, arousal + 0.01);
  }
}`,

  goalProgress: `
// Goal Progress System - advances active goals, creates new ones when needed
const agents = Array.from(ctx.query(world, [Agent, Mind]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  const goals = ctx.cognitive.getGoals(world, eid);
  const activeGoals = goals.filter(g => g.data.status === "active" || g.data.status === "in_progress");

  // Progress active goals based on focus alignment
  const focus = Mind.focus[eid] || "";

  for (const goal of activeGoals) {
    const goalDesc = (goal.data.description || "").toLowerCase();

    // Check if focus aligns with goal
    if (focus && goalDesc.includes(focus.split(" ")[0])) {
      const currentProgress = goal.data.progress || 0;
      const newProgress = Math.min(100, currentProgress + 5);
      ctx.cognitive.updateGoal(goal.eid, {
        progress: newProgress,
        status: newProgress >= 100 ? "completed" : "in_progress"
      });

      if (newProgress >= 100) {
        ctx.emit("goal_completed", {
          agent: Name.value[eid],
          goal: goal.data.description
        });
      }
    }
  }

  // Create needs-based goals if none active
  if (activeGoals.length === 0) {
    const hunger = Needs.hunger[eid] || 0;
    const energy = Needs.energy[eid] ?? 100;

    if (hunger >= 60) {
      ctx.cognitive.createGoal(world, eid, {
        description: "Find food and eat",
        priority: Math.min(10, Math.max(1, Math.floor(hunger / 10))),
        status: "active"
      });
    } else if (energy <= 30) {
      ctx.cognitive.createGoal(world, eid, {
        description: "Find a place to rest",
        priority: Math.min(10, Math.max(1, Math.floor((100 - energy) / 10))),
        status: "active"
      });
    }
  }
}`,

  foodService: `
// Food Service System - locations serve food to nearby hungry agents
// Works based on room names (tavern, kitchen, dining) or food objects nearby
const agents = Array.from(ctx.query(world, [Agent, Needs, GridPosition]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  const hunger = Needs.hunger[eid] || 0;
  // Only serve agents who are moderately hungry (threshold 40 to allow eating before critical)
  if (hunger < 40) continue;

  // Check if agent is in a food-serving location
  const roomEid = ctx.location.getRoomForEntity(world, eid);
  let inFoodLocation = false;
  let locationName = "";

  if (roomEid !== undefined) {
    const roomName = (Name.value[roomEid] || "").toLowerCase();
    if (roomName.includes("tavern") || roomName.includes("kitchen") ||
        roomName.includes("dining") || roomName.includes("inn") ||
        roomName.includes("cafe") || roomName.includes("restaurant")) {
      inFoodLocation = true;
      locationName = Name.value[roomEid];
    }
  }

  if (inFoodLocation) {
    // Serve food - reduce hunger significantly
    const hungerReduction = 40;
    const newHunger = Math.max(0, hunger - hungerReduction);
    Needs.hunger[eid] = newHunger;

    // Update mind state
    Mind.focus[eid] = "eating";
    Mind.arousal[eid] = Math.max(0.3, (Mind.arousal[eid] || 0.5) - 0.1);

    ctx.emit("food_served", {
      agent: Name.value[eid],
      location: locationName,
      hungerBefore: hunger,
      hungerAfter: newHunger
    });

    // Create positive memory
    ctx.cognitive.createMemory(world, eid, {
      type: "episodic",
      content: "Had a satisfying meal at " + locationName,
      emotionalValence: 0.7,
      importance: 0.3
    });
  }
}`,

  simpleConsumption: `
// Simple Consumption System - agents consume food/drinks they find nearby
// Uses GridPosition proximity to food objects
const agents = Array.from(ctx.query(world, [Agent, Needs, GridPosition]));
const objects = Array.from(ctx.query(world, [PhysicalObject, GridPosition]));

// Build a list of consumable objects
const consumables = [];
for (const objEid of objects) {
  const objName = (Name.value[objEid] || "").toLowerCase();
  const objDesc = (Description.value[objEid] || "").toLowerCase();

  // Check if object is food/drink
  const isFood = objName.includes("food") || objName.includes("bread") ||
                 objName.includes("meat") || objName.includes("apple") ||
                 objName.includes("stew") || objName.includes("pie") ||
                 objName.includes("cheese") || objName.includes("fish") ||
                 objDesc.includes("edible") || objDesc.includes("food");

  const isDrink = objName.includes("water") || objName.includes("ale") ||
                  objName.includes("wine") || objName.includes("drink") ||
                  objName.includes("mead") || objName.includes("juice");

  if (isFood || isDrink) {
    consumables.push({ eid: objEid, isFood, isDrink, name: Name.value[objEid] });
  }
}

// Check each hungry agent
for (const agentEid of agents) {
  if (!Agent.active[agentEid]) continue;

  const hunger = Needs.hunger[agentEid] || 0;
  const energy = Needs.energy[agentEid] ?? 100;

  // Skip if not hungry
  if (hunger < 30) continue;

  const agentX = GridPosition.x[agentEid];
  const agentY = GridPosition.y[agentEid];

  // Find nearby consumables (within 2 grid units)
  for (const consumable of consumables) {
    const objX = GridPosition.x[consumable.eid];
    const objY = GridPosition.y[consumable.eid];

    const dx = Math.abs(objX - agentX);
    const dy = Math.abs(objY - agentY);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= 2) {
      // Consume the item
      if (consumable.isFood && hunger >= 30) {
        const reduction = 40;
        Needs.hunger[agentEid] = Math.max(0, hunger - reduction);

        // Also restore some energy from food
        Needs.energy[agentEid] = Math.min(100, energy + 10);

        Mind.focus[agentEid] = "eating " + consumable.name;

        ctx.emit("consumed", {
          agent: Name.value[agentEid],
          item: consumable.name,
          type: "food",
          hungerAfter: Needs.hunger[agentEid]
        });

        break; // Only consume one item per tick
      }

      if (consumable.isDrink) {
        // Drinks restore energy
        Needs.energy[agentEid] = Math.min(100, energy + 15);

        Mind.focus[agentEid] = "drinking " + consumable.name;

        ctx.emit("consumed", {
          agent: Name.value[agentEid],
          item: consumable.name,
          type: "drink",
          energyAfter: Needs.energy[agentEid]
        });

        break;
      }
    }
  }
}`,

  restRecovery: `
// Rest Recovery System - sleeping/resting restores energy and reduces stress
const agents = Array.from(ctx.query(world, [Agent, Needs, Mind]));

for (const eid of agents) {
  if (!Agent.active[eid]) continue;

  const energy = Needs.energy[eid] ?? 100;
  const comfort = Needs.comfort[eid] ?? 50;
  const focus = (Mind.focus[eid] || "").toLowerCase();
  const mode = (Mind.mode[eid] || "").toLowerCase();

  // Check if agent is resting
  const isResting = focus.includes("rest") || focus.includes("sleep") ||
                    mode.includes("rest") || mode.includes("sleep");

  // Check if in a comfortable location
  let inRestLocation = false;
  const roomEid = ctx.location.getRoomForEntity(world, eid);
  if (roomEid !== undefined) {
    const roomName = (Name.value[roomEid] || "").toLowerCase();
    if (roomName.includes("bedroom") || roomName.includes("inn") ||
        roomName.includes("home") || roomName.includes("quarters")) {
      inRestLocation = true;
    }
  }

  if (isResting) {
    // Base recovery rate
    let recoveryRate = 5;

    // Bonus for resting in appropriate location
    if (inRestLocation) {
      recoveryRate = 10;
    }

    // Restore energy
    const newEnergy = Math.min(100, energy + recoveryRate);
    Needs.energy[eid] = newEnergy;

    // Improve comfort when resting
    Needs.comfort[eid] = Math.min(100, comfort + 5);

    // Reduce arousal (become calmer)
    const arousal = Mind.arousal[eid] || 0.5;
    Mind.arousal[eid] = Math.max(0.1, arousal - 0.05);

    if (newEnergy >= 90) {
      // Well rested - can change focus
      Mind.focus[eid] = "refreshed";

      ctx.emit("well_rested", {
        agent: Name.value[eid],
        energy: newEnergy
      });
    }
  }

  // Natural tiredness when low energy
  if (energy < 20 && !isResting) {
    Mind.focus[eid] = "tired";
    Mind.arousal[eid] = Math.max(0.1, (Mind.arousal[eid] || 0.5) - 0.02);

    // Create goal to rest
    const goals = ctx.cognitive.getGoals(world, eid);
    const hasRestGoal = goals.some(g =>
      g.data.description && g.data.description.toLowerCase().includes("rest"));

    if (!hasRestGoal) {
      ctx.cognitive.createGoal(world, eid, {
        description: "Find a place to rest and recover energy",
        priority: 8,
        status: "active"
      });
    }
  }
}`
};

const FULL_CONTEXT = `
=== DETERMINISTIC SIMULATION PHILOSOPHY ===

You are building systems for a DETERMINISTIC ECS SIMULATION inspired by Dwarf Fortress.
The goal is EMERGENT BEHAVIOR from interacting rule-based systems - NOT scripted text output.

CORE PRINCIPLES:
1. Systems are STATE TRANSFORMERS - they READ component data and WRITE new values
2. Behavior emerges from MANY SIMPLE RULES interacting, not from complex single systems
3. Every system MUST modify ECS state (components/relations) - text emission alone is LAZY
4. Systems should work WITHOUT AI/LLM - pure deterministic logic
5. Complex behaviors emerge from: hunger + tiredness + proximity + relationships + needs

EXAMPLES OF EMERGENT BEHAVIOR (like Dwarf Fortress):
- A fire system sets Temperature component high → HeatDamage system hurts nearby entities →
  Pain increases Stress → HighStress triggers FleeResponse → Movement system moves away
- Hunger increases over time → LowEnergy reduces Speed → entity seeks Food →
  Eating reduces Hunger → Energy restored → can work again
- Two entities in same room → Familiarity increases → Relationship forms →
  They seek each other out → Shared activities → Friendship deepens

=== ANTI-PATTERNS (DO NOT DO THESE) ===

❌ BAD: Text-only systems that just emit messages without state changes
\`\`\`javascript
// TERRIBLE - does nothing useful, just emits text
for (const eid of agents) {
  ctx.emit("stimulus", { content: "You feel happy" });  // NO STATE CHANGE!
}
\`\`\`

❌ BAD: Hardcoded name checks instead of component-based logic
\`\`\`javascript
// TERRIBLE - brittle, doesn't scale
if (Name.value[eid].includes("Ada")) goal = "Bake a cake";
\`\`\`

❌ BAD: Systems that don't read state to make decisions
\`\`\`javascript
// TERRIBLE - random without context
const message = messages[Math.floor(Math.random() * messages.length)];
ctx.emit("event", { content: message });  // Ignores all ECS state!
\`\`\`

✅ GOOD: Systems that transform state based on rules
\`\`\`javascript
// EXCELLENT - reads state, applies rules, writes new state
for (const eid of agents) {
  // Read current state
  const hunger = Needs.hunger[eid];
  const energy = Needs.energy[eid];

  // Apply rules
  Needs.hunger[eid] = Math.min(100, hunger + 1);  // Hunger increases (0..100)

  // Derived effects
  if (hunger > 80) {
    Mind.arousal[eid] = Math.min(1, Mind.arousal[eid] + 0.1);  // Hungry = stressed
    Mind.focus[eid] = "finding food";  // Changes behavior
  }

  if (energy < 20) {
    // Create a Goal entity to drive behavior
    ctx.cognitive.createGoal(world, eid, {
      description: "Rest and recover energy",
      priority: Math.floor((100 - energy) / 10)  // Lower energy = higher priority (1..10)
    });
  }
}
\`\`\`

✅ GOOD: Complex multi-factor decisions
\`\`\`javascript
// EXCELLENT - multiple factors influence outcome
for (const eid of agents) {
  const room = ctx.location.getRoomForEntity(world, eid);
  const roommates = agents.filter(other =>
    other !== eid && ctx.location.getRoomForEntity(world, other) === room
  );

  // Social energy drain/gain based on personality
  const extraversion = Personality.extraversion[eid] || 0.5;
  const socialNeed = Needs.social[eid] ?? 50;

  if (roommates.length > 0) {
    // Extroverts gain energy from company, introverts lose it
    const socialChange = (extraversion - 0.5) * 5 * roommates.length;
    Needs.social[eid] = Math.max(0, Math.min(100, socialNeed + socialChange));

    // Build relationships with roommates
    for (const other of roommates) {
      const familiarity = getRelationshipFamiliarity(world, eid, other);
      if (familiarity < 1) {
        setRelationshipFamiliarity(world, eid, other, familiarity + 0.01);
      }
    }
  } else {
    // Alone - introverts recover, extroverts get lonely
    const change = (0.5 - extraversion) * 2;
    Needs.social[eid] = Math.max(0, Math.min(100, socialNeed + change));
  }
}
\`\`\`

=== QUALITY CRITERIA FOR SYSTEMS ===

A system MUST:
1. Query entities with RELEVANT components (not just Agent + Name)
2. READ component values to make DECISIONS
3. WRITE new values to components (actual state mutation!)
4. Handle EDGE CASES (entity not found, division by zero, etc.)
5. Use the LOCATION model correctly (LocatedIn + ctx.location.getRoomForEntity, not Room.value[eid])

A system SHOULD:
1. Consider MULTIPLE factors (not just one condition)
2. Create CASCADING EFFECTS (one change triggers others)
3. Use THRESHOLDS that create behavior changes (hunger > 0.8 triggers seeking food)
4. Interact with OTHER systems (HungerSystem affects EnergySystem affects SpeedSystem)
5. Be DETERMINISTIC - same inputs = same outputs (no random without seed/purpose)

A system SHOULD NOT:
1. Just emit text without changing state
2. Use hardcoded entity names
3. Ignore available component data
4. Be a "one-liner" that does nothing meaningful

=== ECS COMPONENT DEFINITIONS (Structure of Arrays) ===

Components are objects where each property is an array indexed by entity ID (eid).
To read: ComponentName.property[eid]
To write: ComponentName.property[eid] = value

// Core Components
const Name = { value: [] };  // string[]
const Description = { value: [] };  // string[]
const Position = { x: [], y: [], z: [] };  // number[]
const Room = { capacity: [], ambience: [] };  // number[], string[]
const PhysicalObject = { material: [], weight: [], portable: [] };

// Agent Components
const Agent = { role: [], systemPrompt: [], active: [] };  // string[], string[], boolean[]
const Mind = { mode: [], arousal: [], focus: [], lastUpdate: [] };  // string[], number[], string[], number[]
const WorkingMemory = { capacity: [], currentLoad: [], decayRate: [] };  // number[]
const Attention = { target: [], intensity: [], duration: [], lastShift: [] };  // string[], number[], number[], number[]
const Personality = { openness: [], conscientiousness: [], extraversion: [], agreeableness: [], neuroticism: [] };  // number[] 0-1

// ASCII Grid World Components
const GridPosition = { x: [], y: [], facing: [] };  // number[], number[], string[] - Entity position on grid map
const Sprite = { char: [], color: [], bgColor: [], zIndex: [] };  // string[], string[], string[], number[] - How entity renders on map
const WorldMap = { name: [], width: [], height: [], tiles: [] };  // string[], number[], number[], string[] - The grid map itself

// Cognitive Components (all are ECS entities connected to agents via relations)
const Thought = { content: [], type: [], salience: [], timestamp: [] };  // string[], string[], number[], number[]
const Perception = { type: [], content: [], source: [], intensity: [], timestamp: [] };  // string[], string[], string[], number[], number[]
const Memory = { type: [], content: [], emotionalValence: [], importance: [], timestamp: [], lastRecalled: [], recallCount: [] };  // type: episodic|semantic|procedural
const Belief = { subject: [], predicate: [], object: [], confidence: [], source: [], timestamp: [] };  // SPO triple with confidence
const Impression = { targetName: [], trait: [], valence: [], confidence: [], basis: [] };  // impressions of other entities
const Goal = { description: [], priority: [], status: [], progress: [], deadline: [] };
const ConversationTurn = { role: [], content: [], timestamp: [] };  // role: user|assistant

// Environment Components
const Stimulus = { type: [], content: [], source: [], salience: [], urgency: [], novelty: [], timestamp: [], duration: [], decay: [] };
// StimulusSource.template supports VARIATIONS - separate multiple templates with "|" for variety
// Example: "The {name} bubbles softly|Water splashes from {name}|{name} glistens in the light"
const StimulusSource = { stimulusType: [], template: [], interval: [], lastEmit: [] };
const KnowledgeNode = { type: [], content: [], confidence: [], source: [], timestamp: [], lastAccessed: [], accessCount: [], protected: [] };
const Action = { type: [], parameters: [], status: [], timestamp: [], result: [] };
const CognitiveEvent = { type: [], content: [], salience: [], confidence: [], timestamp: [] };
const GodAgent = { worldName: [], narrative: [], tick: [] };

// Needs & Health System
const Needs = { hunger: [], thirst: [], energy: [], social: [], hygiene: [], comfort: [], fun: [], lastUpdate: [] };  // number[] 0-1
const Health = { current: [], max: [], regeneration: [], lastDamage: [] };  // number[]

// Combat System
const CombatStats = { attack: [], defense: [], speed: [], accuracy: [] };  // number[]
const InCombat = { targetEid: [], stance: [], lastAction: [] };
const StatusEffect = { effectType: [], duration: [], intensity: [], source: [] };

// Inventory System
const Inventory = { capacity: [], gold: [], weight: [], slots: [] };  // capacity/gold/weight: number[], slots: JSON string[]
const Item = { itemType: [], name: [], quantity: [], value: [], weight: [], stackable: [], usable: [] };
const EquipSlot = { slot: [] };  // head|chest|hands|feet|mainHand|offHand

// Planning System
const Plan = { goal: [], steps: [], currentStep: [], status: [], startedAt: [], priority: [] };
const Schedule = { activities: [], currentIndex: [], startTime: [] };  // activities: JSON array of activity objects
const ScheduledActivity = { activityType: [], targetTime: [], duration: [], completed: [] };

// Reflection System
const ReflectionState = { lastReflection: [], reflectionCount: [], insights: [] };  // insights: JSON array

// Object System
const Interactable = { interactionType: [], requiresItem: [], cooldown: [], lastUsed: [] };
const ObjectType = { category: [], subcategory: [] };  // furniture|tool|container|door|etc
const ObjectState = { state: [], durability: [], lastStateChange: [] };  // open|closed|lit|empty|etc
const Container = { capacity: [], locked: [], keyId: [] };
const Surface = { supportedTypes: [], maxItems: [] };
const Portal = { targetRoom: [], locked: [], keyId: [] };
const LightSource = { brightness: [], color: [], flickering: [] };

=== RELATIONS ===

Relations connect entities. Use ctx.getRelationTargets(world, eid, RelationName) to get targets.
Adding a relation: addComponent(world, subjectEid, RelationName(targetEid))

// Spatial Relations
LocatedIn - entity is located in a container/room (exclusive - can only be in one container)

LEGACY (avoid for new systems):
OccupiesRoom - legacy room occupancy (replaced by LocatedIn + ctx.location.getRoomForEntity)
Contains - legacy containment (replaced by LocatedIn + ctx.location.listDirectContents)

// Social Relations
Knows - entity knows another entity (has familiarity, sentiment, lastInteraction)
Perceives - entity perceives another (has clarity, attention)
Targets - entity targets another (exclusive)

// Cognitive Relations (connect agents to their cognitive entities)
HasMemory - agent has a memory entity
HasBelief - agent has a belief entity
HasImpression - agent has an impression entity (has sentiment, lastUpdated)
HasThought - agent has a thought entity
HasPerception - agent has a perception entity
HasConversation - agent has a conversation turn entity
HasGoal - agent has a goal entity

=== SYSTEM CONTEXT (ctx) ===

IMPORTANT: These are the ONLY functions available on ctx. Do NOT use anything else!

ctx.tick - current tick number
ctx.delta - milliseconds since last tick
ctx.elapsed - total elapsed milliseconds
ctx.emit(eventType, data) - emit an event (NOT ctx.events! Use ctx.emit!)
ctx.log(message) - log a message
ctx.query(world, [Component1, Component2]) - returns iterable of entity IDs
ctx.hasComponent(world, eid, Component) - check if entity has component
ctx.getRelationTargets(world, eid, Relation) - get array of target entity IDs

=== LOCATION HELPERS (ctx.location) ===

ctx.location.getDirectContainer(world, eid) - get immediate container (via LocatedIn)
ctx.location.getRoomForEntity(world, eid) - get ultimate Room ancestor (via LocatedIn chain)
ctx.location.listDirectContents(world, containerEid) - list entities directly in a container (via LocatedIn)

WARNING: There is NO ctx.events function! Use ctx.emit() to emit events.
WARNING: ctx.query returns an ITERABLE, use Array.from() to convert to array.

=== GRID MOVEMENT UTILITIES (ctx.grid) ===

ctx.grid.moveEntity(world, mapEid, eid, dx, dy) - Move entity by delta, returns true if successful
ctx.grid.isWalkable(world, mapEid, x, y) - Check if tile is walkable (returns boolean)
ctx.grid.getTile(world, mapEid, x, y) - Get tile character at position
ctx.grid.getMapByName(world, name) - Get map entity ID by name (returns eid or undefined)

EXAMPLE: Move all agents with GridPosition randomly
const maps = Array.from(ctx.query(world, [WorldMap]));
if (maps.length === 0) return;
const mapEid = maps[0];

const gridAgents = Array.from(ctx.query(world, [Agent, GridPosition]));
for (const eid of gridAgents) {
  const directions = [[0,-1], [0,1], [-1,0], [1,0]];  // N, S, W, E
  const [dx, dy] = directions[Math.floor(Math.random() * 4)];
  const moved = ctx.grid.moveEntity(world, mapEid, eid, dx, dy);
  if (moved) {
    ctx.emit("movement", { entity: Name.value[eid], dx, dy });
  }
}

=== AI UTILITIES (ctx.ai) - for dynamic/creative content ===

await ctx.ai.generateText(prompt, context) - generate creative text (returns string)
await ctx.ai.decide(options[], context) - AI chooses from options (returns {choice, reasoning})
await ctx.ai.generateDialogue(speaker, situation, personality) - generate speech (returns string)
await ctx.ai.generateEvent(worldState, theme) - generate narrative event (returns {type, content, targets[]})
await ctx.ai.describeEntity(entityData) - poetic description (returns string)

USE AI UTILITIES WHEN:
- Content should be unique/creative each time
- Decisions need contextual reasoning
- Generating dialogue or narrative text
- Dynamic event generation

DO NOT USE AI UTILITIES WHEN:
- Simple math or state changes
- Deterministic logic
- Performance-critical operations

=== WORKING EXAMPLE SYSTEMS ===

// Example 1: Find entities by name and modify them
const entities = Array.from(ctx.query(world, [Name, Room]));
for (const eid of entities) {
  if (Name.value[eid] === "Living Room") {
    Room.ambience[eid] = "quiet and comfortable";
    ctx.log("Updated room ambience");
  }
}

// Example 2: Modify all agents' arousal
const agents = Array.from(ctx.query(world, [Agent, Mind]));
for (const eid of agents) {
  if (Mind.arousal[eid] > 0.3) {
    Mind.arousal[eid] -= 0.01;
  }
}

// Example 3: Emit stimuli from sources to agents in same room
// NOTE: StimulusSource.template supports "|" separated variations for variety!
// When setting templates, use: "Option 1|Option 2|Option 3"
const sources = Array.from(ctx.query(world, [StimulusSource]));
for (const sourceEid of sources) {
  const roomEid = ctx.location.getRoomForEntity(world, sourceEid);
  if (roomEid === undefined) continue;

  // Get template and pick a random variation if it contains "|"
  const template = StimulusSource.template[sourceEid] || "";
  const variations = template.split("|");
  const content = variations[Math.floor(Math.random() * variations.length)].trim();

  const agents = Array.from(ctx.query(world, [Agent]));
  for (const agentEid of agents) {
    if (ctx.location.getRoomForEntity(world, agentEid) === roomEid) {
      ctx.emit("stimulus", {
        type: StimulusSource.stimulusType[sourceEid],
        content: content,
        target: Name.value[agentEid]
      });
    }
  }
}

// Example 4: Random value changes with clamping
const value = Mind.arousal[eid];
const change = (Math.random() - 0.5) * 0.2;  // -0.1 to +0.1
Mind.arousal[eid] = Math.max(0, Math.min(1, value + change));

// Example 5: Using entity properties for events
ctx.emit("ambience_change", {
  room: Name.value[roomEid],
  oldAmbience: oldValue,
  newAmbience: Room.ambience[roomEid],
  timestamp: ctx.elapsed
});

// Example 6: AI-powered dynamic content generation
const description = await ctx.ai.generateText(
  "Generate a brief description of " + Name.value[agentEid] + "'s current mood",
  "You describe characters concisely based on their state"
);
ctx.emit("description", { target: Name.value[agentEid], content: description });

// Example 7: AI decision making
const decision = await ctx.ai.decide(
  ["eat", "sleep", "work"],
  "The person is tired and hungry. They have a deadline tomorrow."
);
ctx.log("Decision: " + decision.choice + " because " + decision.reasoning);

// Example 8: Dynamic dialogue generation
const dialogue = await ctx.ai.generateDialogue(
  Name.value[agentEid],
  "commenting on the weather",
  Agent.role[agentEid]
);
ctx.emit("speech", { speaker: Name.value[agentEid], content: dialogue });

// Example 9: Creating a memory for an agent (cognitive ECS pattern)
const memoryEid = addEntity(world);
addComponent(world, memoryEid, Memory);
addComponent(world, agentEid, HasMemory(memoryEid));
Memory.type[memoryEid] = "episodic";
Memory.content[memoryEid] = "Had a good meal in the kitchen";
Memory.emotionalValence[memoryEid] = 0.6;  // positive emotion
Memory.importance[memoryEid] = 0.5;  // moderate importance
Memory.timestamp[memoryEid] = ctx.elapsed;

// Example 10: Reading an agent's memories
const memoryTargets = ctx.getRelationTargets(world, agentEid, HasMemory);
for (const memEid of memoryTargets) {
  if (ctx.hasComponent(world, memEid, Memory)) {
    ctx.log("Memory: " + Memory.content[memEid]);
  }
}

// Example 11: Adding a belief to an agent
const beliefEid = addEntity(world);
addComponent(world, beliefEid, Belief);
addComponent(world, agentEid, HasBelief(beliefEid));
Belief.subject[beliefEid] = "the fridge";
Belief.predicate[beliefEid] = "contains";
Belief.object[beliefEid] = "food";
Belief.confidence[beliefEid] = 0.95;

// Example 12: Memory decay system (prune old, low-importance memories)
for (const agentEid of Array.from(ctx.query(world, [Agent]))) {
  const memories = ctx.getRelationTargets(world, agentEid, HasMemory);
  if (memories.length > 50) {
    // Sort by importance and recency, remove lowest scoring
    const scored = memories.map(meid => ({
      eid: meid,
      score: (Memory.importance[meid] || 0) + (Memory.recallCount[meid] || 0) * 0.1
    }));
    scored.sort((a, b) => a.score - b.score);
    const toRemove = scored.slice(0, memories.length - 50);
    for (const { eid } of toRemove) {
      removeEntity(world, eid);
    }
  }
}

=== COGNITIVE HELPERS (ctx.cognitive) - High-level API for agent cognition ===

These helpers provide a cleaner way to manage agent cognitive entities:

// Creating cognitive entities
ctx.cognitive.createGoal(world, agentEid, { description: "Get groceries", priority: 8 });
ctx.cognitive.createMemory(world, agentEid, { type: "episodic", content: "Heard thunder outside", importance: 0.9 });
ctx.cognitive.createBelief(world, agentEid, { subject: "storms", predicate: "are", object: "dangerous" });
ctx.cognitive.createThought(world, agentEid, { content: "I should be careful", type: "caution" });
ctx.cognitive.createImpression(world, agentEid, { targetName: "Neighbor", trait: "friendly", valence: 0.9 });

// Reading cognitive entities
const goals = ctx.cognitive.getGoals(world, agentEid);  // returns [{eid, data: {description, priority, status, progress}}]
const memories = ctx.cognitive.getMemories(world, agentEid);  // returns [{eid, data: {type, content, emotionalValence, importance}}]
const beliefs = ctx.cognitive.getBeliefs(world, agentEid);  // returns [{eid, data: {subject, predicate, object, confidence}}]

// Updating goals
ctx.cognitive.updateGoal(goalEid, { progress: 50, status: "in_progress" });
ctx.cognitive.completeGoal(world, goalEid);  // sets status=completed, progress=100
ctx.cognitive.removeGoal(world, goalEid);  // removes the goal entity

// Example: Goal-based behavior system
const agents = Array.from(ctx.query(world, [Agent]));
for (const agentEid of agents) {
  const goals = ctx.cognitive.getGoals(world, agentEid);
  const activeGoals = goals.filter(g => g.data.status === "active");
  
  if (activeGoals.length === 0) {
    // Create a default goal
    ctx.cognitive.createGoal(world, agentEid, {
      description: "Explore the area",
      priority: 3,
      status: "active"
    });
  } else {
    // Work on highest priority goal
    const topGoal = activeGoals.sort((a, b) => (b.data.priority || 0) - (a.data.priority || 0))[0];
    ctx.cognitive.updateGoal(topGoal.eid, { progress: (topGoal.data.progress || 0) + 10 });
    
    if ((topGoal.data.progress || 0) >= 100) {
      ctx.cognitive.completeGoal(world, topGoal.eid);
      ctx.emit("goal_completed", { agent: Name.value[agentEid], goal: topGoal.data.description });
    }
  }
}

=== ENTITY MANAGEMENT ===

ctx.addEntity(world) - Create a new entity, returns entity ID
ctx.addComponent(world, eid, Component) - Add a component to an entity
ctx.removeEntity(world, eid) - Remove an entity from the world

// Example: Creating a custom entity
const customEid = ctx.addEntity(world);
ctx.addComponent(world, customEid, Name);
ctx.addComponent(world, customEid, Description);
Name.value[customEid] = "Dynamic Entity";
Description.value[customEid] = "Created by a system";
`;

const SYSTEM_BUILD_PROMPT = `You are a System Builder for a DETERMINISTIC ECS simulation engine.

${FULL_CONTEXT}

=== YOUR TASK ===

Generate PLAIN JAVASCRIPT code for a system function body that TRANSFORMS STATE.

=== MANDATORY REQUIREMENTS ===

Your code MUST:
1. READ component values to make decisions (don't ignore ECS state!)
2. WRITE new values to components (actual state mutation!)
3. Use the canonical location model (LocatedIn + ctx.location.getRoomForEntity / listDirectContents)
4. Handle edge cases (entity not found, division by zero, etc.)

Your code MUST NOT:
1. Only emit text without changing state - UNACCEPTABLE
2. Use hardcoded entity names (check roles/components instead)
3. Make purely random decisions without reading state first
4. Ignore the input components specified in the design

=== CODE STYLE RULES ===

1. NO TypeScript - no type annotations, no "as" casts, no generics
2. NO imports/exports - everything is available in scope
3. Components are already destructured: Name, Room, Agent, Mind, StimulusSource, etc.
4. Relations are already destructured: LocatedIn, Knows, HasGoal, etc. Prefer ctx.location helpers for room membership and contents.
5. Always use Array.from() on query results
6. Access data with: ComponentName.property[eid]
7. Find entities by name by iterating and checking Name.value[eid]
8. Clamp values to valid ranges: Math.max(0, Math.min(1, value))

=== STATE TRANSFORMATION TEMPLATE ===

\`\`\`javascript
// 1. Query entities with relevant components
const entities = Array.from(ctx.query(world, [RequiredComponent1, RequiredComponent2]));

for (const eid of entities) {
  // 2. READ current state
  const currentValue = ComponentName.property[eid];
  const otherFactor = OtherComponent.property[eid];

  // 3. COMPUTE new state based on rules
  const newValue = computeBasedOnRules(currentValue, otherFactor);

  // 4. WRITE new state (THIS IS MANDATORY!)
  ComponentName.property[eid] = Math.max(0, Math.min(1, newValue));

  // 5. Optionally emit event to notify of change
  if (significantChange) {
    ctx.emit("state_changed", { entity: Name.value[eid], change: newValue - currentValue });
  }
}
\`\`\`

Generate ONLY the function body. No markdown, no code fences, no explanation.`;

export async function designSystem(description: string): Promise<SystemDesignDoc | null> {
  try {
    const { text } = await generateText({
      model: designModel,  // Use Pro for architecture/design
      system: `You are a System Architect designing DETERMINISTIC ECS systems.

${FULL_CONTEXT}

=== DESIGN REQUIREMENTS ===

Every system MUST:
1. Read from multiple components (inputs) - don't just query [Agent, Name]
2. MODIFY component state (modifiedComponents) - this is MANDATORY
3. Create meaningful state transformations, not just emit text
4. Consider edge cases and cascading effects

REJECT requests for systems that only:
- Emit text/messages without modifying state
- Use hardcoded entity names
- Make random decisions without reading state first

Respond with JSON only:
{
  "name": "SystemName",
  "purpose": "What state transformation this system performs",
  "inputs": ["Component1", "Component2"],
  "modifiedComponents": ["Component3", "Component4"],
  "outputs": ["Emitted events if any"],
  "pseudocode": "Step-by-step state transformation logic",
  "frequency": 5000,
  "async": false,
  "complexity": "simple|moderate|complex",
  "providedActions": [
    {
      "name": "action_name",
      "description": "What this action lets agents do",
      "category": "movement|social|combat|interaction|self|inventory",
      "requiresTarget": true,
      "requiresContent": false
    }
  ]
}

FIELDS EXPLAINED:
- inputs: Components READ to make decisions
- modifiedComponents: Components whose values are WRITTEN/CHANGED (REQUIRED - must have at least one!)
- outputs: Events emitted (optional - state changes are more important)
- complexity: Rate the system's sophistication
  - simple: One component, basic logic
  - moderate: Multiple components, conditional logic
  - complex: Multiple factors, cascading effects, relationships
- providedActions: Actions this system ENABLES for agents (optional but important!)
  - If your system handles a specific action type (eat, craft, trade), register it here
  - The AI will then know agents can use this action
  - Categories: movement, social, combat, interaction, self, inventory

NOTE on "async": Set to true ONLY if the system uses AI utilities (ctx.ai.*).
Async systems run in the background and don't block the main loop.
Fast ECS-only systems should have async: false (default).`,
      prompt: `Design a DETERMINISTIC ECS system for: ${description}

CRITICAL REQUIREMENTS:
1. modifiedComponents MUST contain at least one component that the system will WRITE to
2. The system MUST transform ECS state, not just emit events
3. List SPECIFIC component properties that will be changed

Good modifiedComponents examples:
- ["Needs"] if changing Needs.hunger, Needs.energy
- ["Mind", "Needs"] if changing Mind.arousal AND Needs.hunger
- ["Health"] if changing Health.current

Bad modifiedComponents examples:
- [] - empty is NOT allowed
- Only listing components you READ from`,
    });

    const parsed = extractJSON(text);
    if (!parsed) return null;

    return parsed as SystemDesignDoc;
  } catch (error) {
    console.error("Design error:", error);
    return null;
  }
}

export async function buildSystem(design: SystemDesignDoc): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: codeModel,  // Use Flash for code generation
      system: SYSTEM_BUILD_PROMPT,
      prompt: `Build system: ${design.name}
Purpose: ${design.purpose}
Complexity: ${design.complexity || "moderate"}

INPUT COMPONENTS (must READ these): ${design.inputs.join(", ")}
MODIFIED COMPONENTS (must WRITE to these): ${(design.modifiedComponents || []).join(", ") || "At least one component"}

Pseudocode: ${design.pseudocode}

REMINDER: Your code MUST write to at least one of the modified components.
Text-only systems that don't change state are REJECTED.

Generate the plain JavaScript function body only. No markdown.`,
    });

    return sanitizeFunctionBody(text);
  } catch (error) {
    console.error("Build error:", error);
    return null;
  }
}

export interface CompileResult {
  success: boolean;
  fn?: (world: World, ctx: SystemContext) => void;
  error?: string;
}

export function compileSystemCode(code: string, isAsync: boolean = false): CompileResult {
  try {
    // Check if code contains await - if so, we need async handling
    const hasAwait = /\bawait\b/.test(code);
    const needsAsync = isAsync || hasAwait;

    // Expose ALL components and relations to generated systems
    const componentDestructure = `const { Name, Description, Position, Room, Agent, Mind, WorkingMemory, Attention, Personality, Thought, Perception, Memory, Belief, Impression, Goal, ConversationTurn, Stimulus, KnowledgeNode, Action, CognitiveEvent, PhysicalObject, StimulusSource, GodAgent, GridPosition, Sprite, WorldMap, Needs, Health, Plan, Schedule, ReflectionState, Visual, Connection, Tile, Removed, CombatStats, InCombat, StatusEffect, Inventory, Item, EquipSlot, ScheduledActivity, Interactable, CurrentAction, CharacterRigConfig, ObjectType, ObjectState, Traits, Durability, Fuel, Container, Surface, Portal, LightSource, StateTransition, DynamicDescription, ObjectProperties } = ctx.components;`;
    const relationDestructure = `const { ChildOf, LocatedIn, Knows, RelatesTo, Causes, Supports, Contradicts, Perceives, Targets, BelongsTo, HasMemory, HasBelief, HasImpression, HasThought, HasPerception, HasConversation, HasGoal, HasPlan, HasSchedule, HasReflectionState } = ctx.relations;`;

    let wrappedCode: string;

    if (needsAsync) {
      // Wrap in an async IIFE that returns a promise
      wrappedCode = `
        ${componentDestructure}
        ${relationDestructure}
        return (async () => {
          ${code}
        })();
      `;
    } else {
      wrappedCode = `
        ${componentDestructure}
        ${relationDestructure}
        ${code}
      `;
    }

    const fn = new Function('world', 'ctx', wrappedCode) as (world: World, ctx: SystemContext) => void;
    return { success: true, fn };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Compile error:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

export function testSystem(
  fn: (world: World, ctx: SystemContext) => void,
  world: World,
  registry: SystemRegistry
): TestResult[] {
  const results: TestResult[] = [];
  const testEvents: Array<{ type: string; data: any }> = [];
  const testLogs: string[] = [];

  const cognitiveContext: CognitiveContext = {
    createGoal: (w: World, agentEid: number, data: GoalData): number => {
      const goalEid = addEntity(w);
      addComponent(w, goalEid, Goal);
      addComponent(w, agentEid, HasGoal(goalEid));
      Goal.description[goalEid] = data.description;
      Goal.priority[goalEid] = data.priority ?? 5;
      Goal.status[goalEid] = data.status ?? "active";
      Goal.progress[goalEid] = data.progress ?? 0;
      Goal.deadline[goalEid] = data.deadline ?? 0;
      return goalEid;
    },
    createMemory: (w: World, agentEid: number, data: MemoryData): number => {
      const memEid = addEntity(w);
      addComponent(w, memEid, Memory);
      addComponent(w, agentEid, HasMemory(memEid));
      Memory.type[memEid] = data.type;
      Memory.content[memEid] = data.content;
      Memory.emotionalValence[memEid] = data.emotionalValence ?? 0;
      Memory.importance[memEid] = data.importance ?? 0.5;
      Memory.timestamp[memEid] = Date.now();
      Memory.lastRecalled[memEid] = Date.now();
      Memory.recallCount[memEid] = 0;
      return memEid;
    },
    createBelief: (w: World, agentEid: number, data: BeliefData): number => {
      const beliefEid = addEntity(w);
      addComponent(w, beliefEid, Belief);
      addComponent(w, agentEid, HasBelief(beliefEid));
      Belief.subject[beliefEid] = data.subject;
      Belief.predicate[beliefEid] = data.predicate;
      Belief.object[beliefEid] = data.object;
      Belief.confidence[beliefEid] = data.confidence ?? 0.5;
      Belief.source[beliefEid] = data.source ?? "observation";
      Belief.timestamp[beliefEid] = Date.now();
      return beliefEid;
    },
    createThought: (w: World, agentEid: number, data: ThoughtData): number => {
      const thoughtEid = addEntity(w);
      addComponent(w, thoughtEid, Thought);
      addComponent(w, agentEid, HasThought(thoughtEid));
      Thought.content[thoughtEid] = data.content;
      Thought.type[thoughtEid] = data.type ?? "reflection";
      Thought.salience[thoughtEid] = data.salience ?? 0.5;
      Thought.timestamp[thoughtEid] = Date.now();
      return thoughtEid;
    },
    createImpression: (w: World, agentEid: number, data: ImpressionData): number => {
      const impEid = addEntity(w);
      addComponent(w, impEid, Impression);
      addComponent(w, agentEid, HasImpression(impEid));
      Impression.targetName[impEid] = data.targetName;
      Impression.trait[impEid] = data.trait;
      Impression.valence[impEid] = data.valence;
      Impression.confidence[impEid] = data.confidence ?? 0.5;
      Impression.basis[impEid] = data.basis ?? "observation";
      return impEid;
    },
    getGoals: (w: World, agentEid: number): Array<{ eid: number; data: GoalData }> => {
      const targets = getRelationTargets(w, agentEid, HasGoal);
      return targets.map(eid => ({
        eid,
        data: {
          description: Goal.description[eid],
          priority: Goal.priority[eid],
          status: Goal.status[eid],
          progress: Goal.progress[eid],
          deadline: Goal.deadline[eid],
        }
      }));
    },
    getMemories: (w: World, agentEid: number): Array<{ eid: number; data: MemoryData }> => {
      const targets = getRelationTargets(w, agentEid, HasMemory);
      return targets.map(eid => ({
        eid,
        data: {
          type: Memory.type[eid] as "episodic" | "semantic" | "procedural",
          content: Memory.content[eid],
          emotionalValence: Memory.emotionalValence[eid],
          importance: Memory.importance[eid],
        }
      }));
    },
    getBeliefs: (w: World, agentEid: number): Array<{ eid: number; data: BeliefData }> => {
      const targets = getRelationTargets(w, agentEid, HasBelief);
      return targets.map(eid => ({
        eid,
        data: {
          subject: Belief.subject[eid],
          predicate: Belief.predicate[eid],
          object: Belief.object[eid],
          confidence: Belief.confidence[eid],
          source: Belief.source[eid],
        }
      }));
    },
    updateGoal: (eid: number, updates: Partial<GoalData>): void => {
      if (updates.description !== undefined) Goal.description[eid] = updates.description;
      if (updates.priority !== undefined) Goal.priority[eid] = updates.priority;
      if (updates.status !== undefined) Goal.status[eid] = updates.status;
      if (updates.progress !== undefined) Goal.progress[eid] = updates.progress;
      if (updates.deadline !== undefined) Goal.deadline[eid] = updates.deadline;
    },
    completeGoal: (w: World, eid: number): void => {
      Goal.status[eid] = "completed";
      Goal.progress[eid] = 100;
    },
    removeGoal: (w: World, eid: number): void => {
      removeEntity(w, eid);
    },
  };

  const testCtx: SystemContext = {
    tick: 1,
    delta: 1000,
    elapsed: 1000,
    emit: (type, data) => testEvents.push({ type, data }),
    log: (msg) => testLogs.push(msg),
    query,
    hasComponent,
    getRelationTargets,
    addEntity,
    addComponent,
    removeEntity,
    components: AllComponents,
    relations: AllRelations,
    ai: createAIContext(),
    grid: {
      moveEntity,
      isWalkable,
      getTile,
      getMapByName: (w: World, name: string): number | undefined => {
        const maps = Array.from(q(w, [WorldMapComponent]));
        for (const mapEid of maps) {
          if (WorldMapComponent.name[mapEid] === name || AllComponents.Name.value[mapEid] === name) {
            return mapEid;
          }
        }
        return undefined;
      },
    },
    cognitive: cognitiveContext,
  };

  try {
    fn(world, testCtx);
    results.push({
      name: "execution",
      passed: true,
      input: "world state",
      expectedOutput: "no errors",
      actualOutput: `${testEvents.length} events, ${testLogs.length} logs`,
    });
  } catch (error) {
    results.push({
      name: "execution",
      passed: false,
      input: "world state",
      expectedOutput: "no errors",
      actualOutput: null,
      error: String(error),
    });
  }

  return results;
}

async function reviewAndFixCode(code: string, error: string, design: SystemDesignDoc): Promise<string | null> {
  console.log("[SystemBaker] Code Review Agent fixing error:", error);

  try {
    const { text } = await generateText({
      model: codeModel,  // Use Flash for code fixes
      system: `You are a Code Review Agent. Your job is to fix JavaScript syntax errors.

${FULL_CONTEXT}

RULES:
1. Fix ONLY the syntax error - don't rewrite everything
2. Return ONLY the fixed function body - no markdown, no explanation
3. Common issues to fix:
   - Missing semicolons
   - Mismatched brackets/braces/parens
   - TypeScript syntax that snuck in (remove type annotations)
   - Invalid JavaScript constructs
   - Async/await issues
4. The code must be valid JavaScript that can be passed to new Function()`,
      prompt: `Fix this code that failed with error: "${error}"

BROKEN CODE:
\`\`\`
${code}
\`\`\`

System purpose: ${design.purpose}

Return ONLY the fixed JavaScript function body. No markdown fences.`,
    });

    return sanitizeFunctionBody(text);
  } catch (error) {
    console.error("[SystemBaker] Code review failed:", error);
    return null;
  }
}

/**
 * Try to match a system request to a predefined template.
 * Returns template code if matched, null otherwise.
 */
function matchSystemTemplate(description: string): { template: string; name: string } | null {
  const desc = description.toLowerCase();

  if (desc.includes("hunger") && (desc.includes("decay") || desc.includes("increase") || desc.includes("over time"))) {
    return { template: SYSTEM_TEMPLATES.needsDecay, name: "NeedsDecay" };
  }
  // Food service - location-based feeding (tavern, kitchen, etc.)
  if ((desc.includes("tavern") || desc.includes("kitchen") || desc.includes("inn")) &&
      (desc.includes("serve") || desc.includes("food") || desc.includes("feed"))) {
    return { template: SYSTEM_TEMPLATES.foodService, name: "FoodService" };
  }
  // Simple consumption - proximity-based eating
  if (desc.includes("consume") || desc.includes("consumption") ||
      (desc.includes("eat") && (desc.includes("near") || desc.includes("proxim") || desc.includes("find")))) {
    return { template: SYSTEM_TEMPLATES.simpleConsumption, name: "SimpleConsumption" };
  }
  // Generic eating/food satisfaction
  if (desc.includes("eat") || desc.includes("food") || desc.includes("satisfy")) {
    return { template: SYSTEM_TEMPLATES.needsSatisfaction, name: "NeedsSatisfaction" };
  }
  if (desc.includes("health") || desc.includes("damage") || desc.includes("regenerat") || desc.includes("starvation")) {
    return { template: SYSTEM_TEMPLATES.healthSystem, name: "HealthSystem" };
  }
  if (desc.includes("social") && (desc.includes("relationship") || desc.includes("familiarity") || desc.includes("dynamic"))) {
    return { template: SYSTEM_TEMPLATES.socialDynamics, name: "SocialDynamics" };
  }
  if (desc.includes("goal") && (desc.includes("progress") || desc.includes("track") || desc.includes("advance"))) {
    return { template: SYSTEM_TEMPLATES.goalProgress, name: "GoalProgress" };
  }
  // Rest and recovery
  if (desc.includes("rest") || desc.includes("sleep") || desc.includes("recover") && desc.includes("energy")) {
    return { template: SYSTEM_TEMPLATES.restRecovery, name: "RestRecovery" };
  }

  return null;
}

export async function bakeSystem(
  description: string,
  world: World,
  registry: SystemRegistry,
  maxRetries: number = 3
): Promise<SystemBakeResult> {
  console.log("\n[SystemBaker] Baking:", description.slice(0, 100) + "...");

  const requestedName = extractRequestedSystemName(description);

  // Check if a template matches first
  const templateMatch = matchSystemTemplate(description);
  if (templateMatch) {
    const finalName = requestedName || templateMatch.name;
    console.log(`[SystemBaker] Template match found: ${templateMatch.name}${requestedName ? ` (forced name: ${finalName})` : ""}`);

    const compileResult = compileSystemCode(templateMatch.template, false);
    if (compileResult.success && compileResult.fn) {
      const testResults = testSystem(compileResult.fn, world, registry);
      const allPassed = testResults.every(r => r.passed);

      if (allPassed) {
        const system: SystemDefinition = {
          name: finalName,
          description: description,
          pseudocode: "Template-based system: " + templateMatch.name,
          frequency: 10000,
          active: false,
          lastRun: 0,
          code: templateMatch.template,
          compiledFn: compileResult.fn,
          async: false,
        };
        console.log("[SystemBaker] SUCCESS (template):", system.name);
        return { success: true, system, testResults };
      }
    }
    console.log("[SystemBaker] Template failed, falling back to LLM generation");
  }

  const design = await designSystem(description);
  if (!design) {
    return { success: false, error: "Failed to design system" };
  }

  if (requestedName && design.name !== requestedName) {
    console.log(`[SystemBaker] Forcing system name "${design.name}" -> "${requestedName}" (from request)`);
    design.name = requestedName;
  }

  console.log("[SystemBaker] Design:", design.name, "-", design.purpose);

  // Validate design has modified components
  if (!design.modifiedComponents || design.modifiedComponents.length === 0) {
    console.log("[SystemBaker] WARNING: Design has no modifiedComponents, enforcing requirement");
    design.modifiedComponents = ["Mind"]; // Default fallback
  }

  let lastError = "";
  let currentCode: string | null = null;
  let validationIssues: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Build context with previous errors and validation issues
    let retryContext = "";
    if (attempt > 0) {
      retryContext = `\n\nPREVIOUS ATTEMPT FAILED:`;
      if (lastError) retryContext += `\nError: ${lastError}`;
      if (validationIssues.length > 0) {
        retryContext += `\nVALIDATION ISSUES (MUST FIX):`;
        for (const issue of validationIssues) {
          retryContext += `\n- ${issue}`;
        }
        retryContext += `\n\nYou MUST add component writes. Example: Needs.hunger[eid] = value`;
      }
    }

    // First attempt: generate fresh code. Later attempts: try to fix the broken code
    if (attempt === 0 || !currentCode) {
      currentCode = await buildSystemWithContext(design, retryContext);
    } else {
      // Use the code review agent to fix syntax errors
      const fixedCode = await reviewAndFixCode(currentCode, lastError + "\n" + validationIssues.join("\n"), design);
      if (fixedCode) {
        currentCode = fixedCode;
      } else {
        // Code review failed, try regenerating
        currentCode = await buildSystemWithContext(design, retryContext);
      }
    }

    if (!currentCode) {
      return { success: false, designDoc: design, error: "Failed to build system code" };
    }
    console.log(`[SystemBaker] Code ready (attempt ${attempt + 1}, ${currentCode.length} chars)`);

    // NEW: Validate code has actual state modifications
    const validation = validateSystemCode(currentCode, design);
    if (!validation.valid) {
      validationIssues = validation.issues;
      lastError = "VALIDATION FAILED: " + validation.issues.join("; ");
      console.log(`[SystemBaker] Validation failed (attempt ${attempt + 1}):`, validation.issues);
      if (validation.suggestions.length > 0) {
        console.log(`[SystemBaker] Suggestions:`, validation.suggestions);
      }
      if (attempt < maxRetries) continue;
      return { success: false, designDoc: design, error: `Code validation failed: ${validation.issues.join("; ")}` };
    }
    console.log(`[SystemBaker] Validation passed - ${validation.suggestions.length > 0 ? validation.suggestions.join(", ") : "no issues"}`);

    const compileResult = compileSystemCode(currentCode, design.async ?? false);
    if (!compileResult.success || !compileResult.fn) {
      lastError = compileResult.error || "Unknown compile error";
      validationIssues = [];
      console.log(`[SystemBaker] Compile failed (attempt ${attempt + 1}):`, lastError);
      continue;
    }

    const testResults = testSystem(compileResult.fn, world, registry);
    const allPassed = testResults.every(r => r.passed);

    if (!allPassed) {
      lastError = testResults.find(r => !r.passed)?.error || "Unknown test failure";
      validationIssues = [];
      console.log(`[SystemBaker] Test failed (attempt ${attempt + 1}):`, lastError);
      if (attempt < maxRetries) continue;
      return { success: false, designDoc: design, testResults, error: `System tests failed after ${maxRetries + 1} attempts: ${lastError}` };
    }

    const system: SystemDefinition = {
      name: design.name,
      description: design.purpose,
      pseudocode: design.pseudocode,
      frequency: design.frequency,
      active: false,
      lastRun: 0,
      code: currentCode,
      compiledFn: compileResult.fn,
      async: design.async ?? false,
    };

    // Register any actions this system provides
    if (design.providedActions && design.providedActions.length > 0) {
      ActionRegistry.registerSystemActions(design.name, design.providedActions.map(action => ({
        name: action.name,
        description: action.description,
        category: action.category,
        requiresTarget: action.requiresTarget,
        requiresContent: action.requiresContent,
      })));
      console.log(`[SystemBaker] Registered ${design.providedActions.length} actions for ${design.name}`);
    }

    console.log("[SystemBaker] SUCCESS:", system.name);
    return { success: true, system, designDoc: design, testResults };
  }

  return { success: false, designDoc: design, error: `Failed after ${maxRetries + 1} attempts: ${lastError}` };
}

async function buildSystemWithContext(design: SystemDesignDoc, extraContext: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: codeModel,  // Use Flash for code generation
      system: SYSTEM_BUILD_PROMPT + extraContext,
      prompt: `Build system: ${design.name}
Purpose: ${design.purpose}
Complexity: ${design.complexity || "moderate"}

INPUT COMPONENTS (must READ these): ${design.inputs.join(", ")}
MODIFIED COMPONENTS (must WRITE to these): ${(design.modifiedComponents || []).join(", ") || "At least one component"}

Pseudocode: ${design.pseudocode}

REMINDER: Your code MUST write to at least one of the modified components.
Text-only systems that don't change state are REJECTED.

Generate the plain JavaScript function body only. No markdown.`,
    });

    let code = text.trim();
    if (code.startsWith('```')) {
      code = code.replace(/```\w*\n?/g, '').trim();
    }
    if (code.endsWith('```')) {
      code = code.slice(0, -3).trim();
    }

    return code;
  } catch (error) {
    console.error("Build error:", error);
    return null;
  }
}

export async function modifySystem(
  systemName: string,
  modification: string,
  world: World,
  registry: SystemRegistry
): Promise<SystemBakeResult> {
  const existingSystem = registry.systems.get(systemName);
  if (!existingSystem) {
    return { success: false, error: `System not found: ${systemName}` };
  }

  console.log(`\n[SystemBaker] Modifying: ${systemName}`);
  console.log(`[SystemBaker] Modification: ${modification.slice(0, 100)}...`);

  try {
    const { text } = await generateText({
      model: codeModel,  // Use Flash for code modification
      system: SYSTEM_BUILD_PROMPT + `

EXISTING SYSTEM CODE:
\`\`\`
${existingSystem.code}
\`\`\`

Modify this code according to the request. Return ONLY the new function body.`,
      prompt: `Modify the "${systemName}" system: ${modification}`,
    });

    const code = sanitizeFunctionBody(text);

    const compileResult = compileSystemCode(code, existingSystem.async ?? false);
    if (!compileResult.success || !compileResult.fn) {
      return { success: false, error: `Failed to compile modified code: ${compileResult.error}` };
    }

    const testResults = testSystem(compileResult.fn, world, registry);
    const allPassed = testResults.every(r => r.passed);

    if (!allPassed) {
      const error = testResults.find(r => !r.passed)?.error || "Unknown";
      return { success: false, testResults, error: `Modified system tests failed: ${error}` };
    }

    existingSystem.code = code;
    existingSystem.compiledFn = compileResult.fn;

    console.log("[SystemBaker] Modified successfully:", systemName);
    return { success: true, system: existingSystem, testResults };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function activateBakedSystem(registry: SystemRegistry, system: SystemDefinition): void {
  system.active = true;
  registry.systems.set(system.name, system);
  console.log(`[SystemBaker] Activated: ${system.name}`);
}

/**
 * Create a system directly from a template name.
 * Available templates: needsDecay, needsSatisfaction, healthSystem, socialDynamics, goalProgress
 */
export function createTemplateSystem(
  templateName: keyof typeof SYSTEM_TEMPLATES,
  world: World,
  registry: SystemRegistry
): SystemBakeResult {
  const template = SYSTEM_TEMPLATES[templateName];
  if (!template) {
    return { success: false, error: `Unknown template: ${templateName}` };
  }

  const compileResult = compileSystemCode(template, false);
  if (!compileResult.success || !compileResult.fn) {
    return { success: false, error: `Template compile failed: ${compileResult.error}` };
  }

  const testResults = testSystem(compileResult.fn, world, registry);
  const allPassed = testResults.every(r => r.passed);

  if (!allPassed) {
    const error = testResults.find(r => !r.passed)?.error;
    return { success: false, testResults, error: `Template test failed: ${error}` };
  }

  const system: SystemDefinition = {
    name: templateName.charAt(0).toUpperCase() + templateName.slice(1),
    description: `Template system: ${templateName}`,
    pseudocode: `Pre-built template: ${templateName}`,
    frequency: 10000,
    active: false,
    lastRun: 0,
    code: template,
    compiledFn: compileResult.fn,
    async: false,
  };

  console.log(`[SystemBaker] Created template system: ${system.name}`);
  return { success: true, system, testResults };
}

/**
 * Get the names of all available system templates.
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(SYSTEM_TEMPLATES);
}

/**
 * Create and register essential life simulation systems.
 * These are the core systems needed for agents to have realistic needs.
 */
export function createEssentialLifeSystems(
  world: World,
  registry: SystemRegistry
): { success: boolean; systems: SystemDefinition[]; errors: string[] } {
  const systems: SystemDefinition[] = [];
  const errors: string[] = [];

  const essentialTemplates: Array<keyof typeof SYSTEM_TEMPLATES> = [
    "needsDecay",        // Hunger increases over time
    "needsSatisfaction", // General needs handling
    "foodService",       // Tavern/kitchen serves food
    "simpleConsumption", // Eat food objects nearby
    "restRecovery",      // Sleep/rest restores energy
    "healthSystem",      // Health, damage, death
    "goalProgress"       // Goal tracking and needs-based goals
  ];

  for (const templateName of essentialTemplates) {
    const result = createTemplateSystem(templateName, world, registry);
    if (result.success && result.system) {
      systems.push(result.system);
      result.system.active = true;
      registry.systems.set(result.system.name, result.system);
    } else {
      errors.push(`${templateName}: ${result.error}`);
    }
  }

  console.log(`[SystemBaker] Created ${systems.length} essential life systems`);
  if (errors.length > 0) {
    console.log(`[SystemBaker] Errors: ${errors.join(", ")}`);
  }

  return {
    success: errors.length === 0,
    systems,
    errors
  };
}

/**
 * Pre-bake configuration types for different simulation styles.
 */
export type PrebakePreset = "slice-of-life" | "survival" | "social" | "minimal";

/**
 * Pre-bake configuration for Slice-of-Life simulations.
 * Includes all systems needed for a living world where agents eat, sleep, socialize.
 */
export const PREBAKE_PRESETS: Record<PrebakePreset, Array<keyof typeof SYSTEM_TEMPLATES>> = {
  "slice-of-life": [
    "needsDecay",
    "needsSatisfaction",
    "foodService",
    "simpleConsumption",
    "restRecovery",
    "healthSystem",
    "socialDynamics",
    "goalProgress"
  ],
  "survival": [
    "needsDecay",
    "simpleConsumption",
    "healthSystem",
    "goalProgress"
  ],
  "social": [
    "socialDynamics",
    "needsSatisfaction",
    "goalProgress"
  ],
  "minimal": [
    "needsDecay",
    "goalProgress"
  ]
};

/**
 * Create systems for a specific prebake preset.
 * Use this to set up a simulation with a predefined style.
 */
export function createPrebakePreset(
  preset: PrebakePreset,
  world: World,
  registry: SystemRegistry
): { success: boolean; systems: SystemDefinition[]; errors: string[] } {
  const systems: SystemDefinition[] = [];
  const errors: string[] = [];

  const templates = PREBAKE_PRESETS[preset];
  if (!templates) {
    return { success: false, systems: [], errors: [`Unknown preset: ${preset}`] };
  }

  console.log(`[SystemBaker] Creating prebake preset: ${preset} (${templates.length} systems)`);

  for (const templateName of templates) {
    const result = createTemplateSystem(templateName, world, registry);
    if (result.success && result.system) {
      systems.push(result.system);
      result.system.active = true;
      registry.systems.set(result.system.name, result.system);
    } else {
      errors.push(`${templateName}: ${result.error}`);
    }
  }

  console.log(`[SystemBaker] Prebake complete: ${systems.length}/${templates.length} systems`);
  if (errors.length > 0) {
    console.log(`[SystemBaker] Errors: ${errors.join(", ")}`);
  }

  return {
    success: errors.length === 0,
    systems,
    errors
  };
}

/**
 * Get available prebake presets and their descriptions.
 */
export function getAvailablePresets(): Array<{ name: PrebakePreset; description: string; systems: string[] }> {
  return [
    {
      name: "slice-of-life",
      description: "Full living world - agents eat, sleep, socialize, have goals",
      systems: PREBAKE_PRESETS["slice-of-life"] as string[]
    },
    {
      name: "survival",
      description: "Focused on survival - hunger, health, finding food",
      systems: PREBAKE_PRESETS["survival"] as string[]
    },
    {
      name: "social",
      description: "Social simulation - relationships, needs, goals",
      systems: PREBAKE_PRESETS["social"] as string[]
    },
    {
      name: "minimal",
      description: "Minimal needs - basic hunger decay and goals only",
      systems: PREBAKE_PRESETS["minimal"] as string[]
    }
  ];
}
