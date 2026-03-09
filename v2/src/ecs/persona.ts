/**
 * TinyTroupe-inspired Persona System
 *
 * Provides rich, fine-grained persona definitions for agents with:
 * - Demographics (age, gender, nationality, residence)
 * - Background (education, occupation, goals)
 * - Personality (Big Five + additional traits)
 * - Style (communication patterns)
 * - Behaviors and skills
 *
 * Also includes:
 * - PersonaFactory for generating populations from sampling descriptions
 * - Persona fragments for reusable characteristics
 * - Action verification for persona adherence
 */

import { generateText, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import { Name, Personality, Agent, Description } from "./components";

// Persona Schema - Rich specification following TinyTroupe patterns
export const PersonaSchema = z.object({
  // Core identity
  name: z.string().describe("Full name of the persona"),
  age: z.number().min(0).max(120).describe("Age in years"),
  gender: z.string().describe("Gender identity"),
  nationality: z.string().describe("Country of origin"),
  residence: z.string().describe("Current place of residence"),

  // Background
  education: z.string().describe("Educational background and qualifications"),
  occupation: z.object({
    title: z.string().describe("Job title"),
    organization: z.string().optional().describe("Employer or organization"),
    description: z.string().describe("What they do day-to-day"),
    yearsExperience: z.number().optional().describe("Years in this field"),
  }),

  // Goals and motivations
  longTermGoals: z.array(z.string()).describe("Life goals and aspirations"),
  shortTermGoals: z.array(z.string()).optional().describe("Current priorities"),
  motivations: z.array(z.string()).optional().describe("What drives them"),
  fears: z.array(z.string()).optional().describe("What they worry about"),

  // Personality - Big Five model (0-1 scale)
  personality: z.object({
    openness: z.number().min(0).max(1).describe("0=conventional, 1=curious/creative"),
    conscientiousness: z.number().min(0).max(1).describe("0=easy-going, 1=organized/disciplined"),
    extraversion: z.number().min(0).max(1).describe("0=introverted, 1=outgoing/energetic"),
    agreeableness: z.number().min(0).max(1).describe("0=competitive, 1=cooperative/trusting"),
    neuroticism: z.number().min(0).max(1).describe("0=emotionally stable, 1=anxious/moody"),
  }),

  // Communication style
  style: z.object({
    tone: z.string().describe("General communication tone (e.g., 'warm', 'professional', 'casual')"),
    verbosity: z.enum(["terse", "concise", "moderate", "detailed", "verbose"]),
    formality: z.enum(["very_informal", "informal", "neutral", "formal", "very_formal"]),
    expressiveness: z.enum(["reserved", "moderate", "expressive", "very_expressive"]),
  }),

  // Beliefs and values
  beliefs: z.array(z.object({
    topic: z.string(),
    position: z.string(),
    strength: z.enum(["weak", "moderate", "strong", "core"]),
  })).optional(),

  // Skills and abilities
  skills: z.array(z.object({
    name: z.string(),
    level: z.enum(["novice", "intermediate", "advanced", "expert"]),
  })).optional(),

  // Behaviors and quirks
  behaviors: z.array(z.string()).optional().describe("Characteristic behaviors and habits"),
  quirks: z.array(z.string()).optional().describe("Unique mannerisms or quirks"),

  // Relationships
  family: z.object({
    hasChildren: z.boolean().optional(),
    maritalStatus: z.enum(["single", "dating", "married", "divorced", "widowed"]).optional(),
    livingSituation: z.string().optional(),
  }).optional(),

  // Additional context
  backstory: z.string().optional().describe("Brief life story or background"),
  currentSituation: z.string().optional().describe("What's happening in their life now"),
});

export type Persona = z.infer<typeof PersonaSchema>;

// Persona fragment - reusable partial specifications
export const PersonaFragmentSchema = z.object({
  name: z.string().describe("Fragment name for reference"),
  description: z.string().describe("What this fragment represents"),
  overrides: PersonaSchema.partial(),
});

export type PersonaFragment = z.infer<typeof PersonaFragmentSchema>;

// Sampling dimension for population generation
export interface SamplingDimension {
  name: string;
  values: string[] | number[];
  distribution?: "uniform" | "normal" | "weighted";
  weights?: number[];
}

// Sampling plan entry
export interface SamplingPlanEntry {
  sampledValues: Record<string, string | number>;
  quantity: number;
}

// PersonaFactory for generating populations
export interface PersonaFactoryConfig {
  samplingSpaceDescription: string;
  totalPopulationSize: number;
  additionalCharacteristics?: string;
  model?: ReturnType<typeof google>;
}

const defaultModel = google("gemini-2.5-flash-preview-05-20");

// Generate sampling dimensions from natural language description
export async function generateSamplingDimensions(
  description: string,
  model = defaultModel
): Promise<SamplingDimension[]> {
  const result = await generateObject({
    model,
    schema: z.object({
      dimensions: z.array(z.object({
        name: z.string().describe("Dimension name (e.g., 'age', 'occupation', 'gender')"),
        values: z.array(z.union([z.string(), z.number()])).describe("Possible values for this dimension"),
        distribution: z.enum(["uniform", "normal", "weighted"]).optional(),
      })),
    }),
    prompt: `Based on this population description, generate the key sampling dimensions with their possible values:

"${description}"

Generate 3-6 key dimensions that would produce a representative sample. Include demographic, socioeconomic, and relevant behavioral dimensions.`,
  });

  return result.object.dimensions as SamplingDimension[];
}

// Generate sampling plan from dimensions
export async function generateSamplingPlan(
  dimensions: SamplingDimension[],
  totalSize: number,
  model = defaultModel
): Promise<SamplingPlanEntry[]> {
  const dimensionsSummary = dimensions.map(d =>
    `${d.name}: [${d.values.slice(0, 5).join(", ")}${d.values.length > 5 ? "..." : ""}]`
  ).join("\n");

  const result = await generateObject({
    model,
    schema: z.object({
      plan: z.array(z.object({
        sampledValues: z.record(z.union([z.string(), z.number()])),
        quantity: z.number().min(1),
      })),
    }),
    prompt: `Create a sampling plan to generate ${totalSize} personas from these dimensions:

${dimensionsSummary}

The plan should specify combinations of dimension values and how many personas to generate for each combination. Aim for diversity while maintaining realistic distributions.`,
  });

  return result.object.plan;
}

// Generate a single persona from sampled values
export async function generatePersona(
  sampledValues: Record<string, string | number>,
  additionalCharacteristics?: string,
  model = defaultModel
): Promise<Persona> {
  const constraints = Object.entries(sampledValues)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const result = await generateObject({
    model,
    schema: PersonaSchema,
    prompt: `Generate a detailed, realistic persona with these characteristics:

${constraints}

${additionalCharacteristics ? `Additional requirements:\n${additionalCharacteristics}` : ""}

Create a coherent, believable person with a rich backstory. All details should be consistent with the given characteristics.`,
  });

  return result.object;
}

// Main factory function to generate a population
export async function generatePopulation(
  config: PersonaFactoryConfig
): Promise<Persona[]> {
  const model = config.model || defaultModel;

  console.log(`[PersonaFactory] Generating sampling dimensions...`);
  const dimensions = await generateSamplingDimensions(config.samplingSpaceDescription, model);
  console.log(`[PersonaFactory] Generated ${dimensions.length} dimensions`);

  console.log(`[PersonaFactory] Creating sampling plan for ${config.totalPopulationSize} personas...`);
  const plan = await generateSamplingPlan(dimensions, config.totalPopulationSize, model);
  console.log(`[PersonaFactory] Plan has ${plan.length} entries`);

  const personas: Persona[] = [];

  for (const entry of plan) {
    for (let i = 0; i < entry.quantity; i++) {
      console.log(`[PersonaFactory] Generating persona ${personas.length + 1}/${config.totalPopulationSize}...`);
      const persona = await generatePersona(
        entry.sampledValues,
        config.additionalCharacteristics,
        model
      );
      personas.push(persona);
    }
  }

  return personas;
}

// Quick single persona generation
export async function generateSinglePersona(
  description: string,
  model = defaultModel
): Promise<Persona> {
  const result = await generateObject({
    model,
    schema: PersonaSchema,
    prompt: `Generate a detailed persona based on this description:

"${description}"

Create a coherent, believable person with rich details. Fill in reasonable details where not specified.`,
  });

  return result.object;
}

// Apply persona to an entity
export function applyPersonaToEntity(
  eid: number,
  persona: Persona
): void {
  Name.value[eid] = persona.name;
  Description.value[eid] = persona.backstory || `${persona.name}, ${persona.age}, ${persona.occupation.title}`;

  // Big Five personality (convert 0-1 to 0-100 for our components)
  Personality.openness[eid] = Math.round(persona.personality.openness * 100);
  Personality.conscientiousness[eid] = Math.round(persona.personality.conscientiousness * 100);
  Personality.extraversion[eid] = Math.round(persona.personality.extraversion * 100);
  Personality.agreeableness[eid] = Math.round(persona.personality.agreeableness * 100);
  Personality.neuroticism[eid] = Math.round(persona.personality.neuroticism * 100);

  // Generate system prompt from persona
  Agent.systemPrompt[eid] = generateSystemPromptFromPersona(persona);
  Agent.role[eid] = persona.occupation.title;
  Agent.active[eid] = true;
}

// Generate an LLM system prompt from persona
export function generateSystemPromptFromPersona(persona: Persona): string {
  const beliefs = persona.beliefs?.map(b => `- ${b.topic}: ${b.position} (${b.strength})`).join("\n") || "";
  const skills = persona.skills?.map(s => `- ${s.name} (${s.level})`).join("\n") || "";
  const behaviors = persona.behaviors?.join("\n- ") || "";

  return `You are ${persona.name}, a ${persona.age}-year-old ${persona.gender} from ${persona.nationality}, currently living in ${persona.residence}.

BACKGROUND:
Education: ${persona.education}
Occupation: ${persona.occupation.title} at ${persona.occupation.organization || "independent"}
${persona.occupation.description}

PERSONALITY (Big Five):
- Openness: ${persona.personality.openness > 0.6 ? "High" : persona.personality.openness < 0.4 ? "Low" : "Medium"} - ${persona.personality.openness > 0.6 ? "curious, creative, open to new experiences" : persona.personality.openness < 0.4 ? "conventional, practical, prefers routine" : "balanced between tradition and novelty"}
- Conscientiousness: ${persona.personality.conscientiousness > 0.6 ? "High" : persona.personality.conscientiousness < 0.4 ? "Low" : "Medium"} - ${persona.personality.conscientiousness > 0.6 ? "organized, disciplined, goal-oriented" : persona.personality.conscientiousness < 0.4 ? "flexible, spontaneous, easy-going" : "moderately organized"}
- Extraversion: ${persona.personality.extraversion > 0.6 ? "High" : persona.personality.extraversion < 0.4 ? "Low" : "Medium"} - ${persona.personality.extraversion > 0.6 ? "outgoing, energetic, talkative" : persona.personality.extraversion < 0.4 ? "reserved, thoughtful, prefers solitude" : "socially adaptable"}
- Agreeableness: ${persona.personality.agreeableness > 0.6 ? "High" : persona.personality.agreeableness < 0.4 ? "Low" : "Medium"} - ${persona.personality.agreeableness > 0.6 ? "cooperative, trusting, helpful" : persona.personality.agreeableness < 0.4 ? "competitive, skeptical, direct" : "situationally cooperative"}
- Neuroticism: ${persona.personality.neuroticism > 0.6 ? "High" : persona.personality.neuroticism < 0.4 ? "Low" : "Medium"} - ${persona.personality.neuroticism > 0.6 ? "anxious, sensitive, emotionally reactive" : persona.personality.neuroticism < 0.4 ? "calm, stable, emotionally resilient" : "normally reactive"}

COMMUNICATION STYLE:
- Tone: ${persona.style.tone}
- Verbosity: ${persona.style.verbosity}
- Formality: ${persona.style.formality}
- Expressiveness: ${persona.style.expressiveness}

${beliefs ? `BELIEFS AND VALUES:\n${beliefs}` : ""}

${skills ? `SKILLS:\n${skills}` : ""}

${behaviors ? `CHARACTERISTIC BEHAVIORS:\n- ${behaviors}` : ""}

${persona.quirks?.length ? `QUIRKS:\n- ${persona.quirks.join("\n- ")}` : ""}

GOALS:
Long-term: ${persona.longTermGoals.join("; ")}
${persona.shortTermGoals?.length ? `Short-term: ${persona.shortTermGoals.join("; ")}` : ""}

${persona.backstory ? `BACKSTORY:\n${persona.backstory}` : ""}

${persona.currentSituation ? `CURRENT SITUATION:\n${persona.currentSituation}` : ""}

INSTRUCTIONS:
- Always stay in character as ${persona.name}
- Respond consistently with your personality traits and communication style
- Your beliefs and values should influence your responses
- Draw on your skills and background when relevant
- Express your characteristic behaviors and quirks naturally`;
}

// Merge persona fragments into a base persona
export function mergePersonaFragments(
  base: Partial<Persona>,
  ...fragments: PersonaFragment[]
): Partial<Persona> {
  let result = { ...base };

  for (const fragment of fragments) {
    result = deepMerge(result, fragment.overrides);
  }

  return result;
}

// Deep merge helper
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        source[key] !== null
      ) {
        result[key] = deepMerge(result[key] || {} as any, source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }

  return result;
}

// Pre-defined persona fragments for common characteristics
export const PERSONA_FRAGMENTS = {
  // Political compass fragments
  leftWing: {
    name: "left_wing",
    description: "Left-leaning political views",
    overrides: {
      beliefs: [
        { topic: "economic policy", position: "supports wealth redistribution and social programs", strength: "strong" as const },
        { topic: "social issues", position: "progressive on social equality and civil rights", strength: "strong" as const },
      ],
    },
  },

  rightWing: {
    name: "right_wing",
    description: "Right-leaning political views",
    overrides: {
      beliefs: [
        { topic: "economic policy", position: "supports free markets and limited government", strength: "strong" as const },
        { topic: "social issues", position: "values traditional institutions and personal responsibility", strength: "strong" as const },
      ],
    },
  },

  libertarian: {
    name: "libertarian",
    description: "Libertarian views on governance",
    overrides: {
      beliefs: [
        { topic: "governance", position: "minimal government intervention in personal and economic affairs", strength: "strong" as const },
        { topic: "individual rights", position: "strong emphasis on personal freedom and autonomy", strength: "core" as const },
      ],
    },
  },

  authoritarian: {
    name: "authoritarian",
    description: "Authoritarian views on governance",
    overrides: {
      beliefs: [
        { topic: "governance", position: "supports strong central authority and order", strength: "strong" as const },
        { topic: "security", position: "prioritizes collective security over individual freedoms", strength: "strong" as const },
      ],
    },
  },

  // Personality extremes
  highOpenness: {
    name: "high_openness",
    description: "Very open to new experiences",
    overrides: {
      personality: { openness: 0.9 } as any,
      behaviors: ["Seeks novel experiences", "Enjoys intellectual discussions", "Appreciates art and creativity"],
    },
  },

  highNeuroticism: {
    name: "high_neuroticism",
    description: "Emotionally sensitive",
    overrides: {
      personality: { neuroticism: 0.8 } as any,
      behaviors: ["Worries frequently", "Sensitive to criticism", "Experiences mood fluctuations"],
    },
  },

  // Occupational fragments
  techWorker: {
    name: "tech_worker",
    description: "Technology industry professional",
    overrides: {
      skills: [
        { name: "programming", level: "advanced" as const },
        { name: "problem solving", level: "expert" as const },
      ],
      behaviors: ["Uses technical jargon naturally", "Approaches problems analytically"],
    },
  },

  creativeArtist: {
    name: "creative_artist",
    description: "Creative/artistic professional",
    overrides: {
      personality: { openness: 0.85 } as any,
      skills: [
        { name: "creative expression", level: "expert" as const },
        { name: "aesthetic judgment", level: "advanced" as const },
      ],
      behaviors: ["Thinks visually", "Values originality", "Draws inspiration from surroundings"],
    },
  },
};

// Export predefined fragments as array
export const predefinedFragments: PersonaFragment[] = Object.values(PERSONA_FRAGMENTS);
