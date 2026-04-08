/**
 * Task Generator — Creates varied multi-turn conversation scripts for swarm instances.
 *
 * Each instance gets a unique conversation that explores a specific region of the
 * interaction space. Conversations are generated from templates with randomized slots,
 * ensuring each instance learns from different (but structurally similar) interactions.
 *
 * No LLM needed — pure template expansion with controlled randomization.
 */

import type { ConversationScript, TaskGenConfig } from "./types.js";

// =============================================================================
// SEED DATA — Slot fillers for conversation templates
// =============================================================================

const TOPICS = {
  work: ["deadline", "presentation", "client meeting", "quarterly review", "performance review", "team conflict", "project scope", "budget cut"],
  creative: ["gallery show", "manuscript draft", "album recording", "portfolio review", "commission piece", "exhibition deadline", "design critique"],
  health: ["doctor appointment", "sleep issues", "workout routine", "diet change", "back pain", "anxiety symptoms", "therapy session"],
  social: ["dinner with friends", "family gathering", "partner disagreement", "neighbor complaint", "wedding planning", "birthday party", "reunion"],
  money: ["rent increase", "investment decision", "car repair bill", "tax filing", "student loans", "bonus negotiation", "side project income"],
  tech: ["server outage", "code review", "deployment pipeline", "API redesign", "bug investigation", "database migration", "security audit"],
};

const EMOTIONS = {
  stressed: ["stressed", "overwhelmed", "anxious", "worried", "under pressure", "stretched thin"],
  excited: ["excited", "thrilled", "pumped", "stoked", "really looking forward to"],
  frustrated: ["frustrated", "annoyed", "fed up", "irritated"],
  sad: ["down", "bummed", "feeling low", "a bit sad", "disappointed"],
  neutral: ["thinking about", "wondering about", "curious about", "considering"],
};

const POSITIVE_FOLLOWUPS_TEMPLATE = [
  "That's really helpful for the {topic}! I'll try breaking it down like you said.",
  "Yes, exactly! That's what I needed to hear about the {topic} situation.",
  "Good point about the {topic}, I hadn't thought of it that way.",
  "Thanks, that makes me feel better about the {topic}.",
  "You're right about the {topic}, I should prioritize that first.",
  "That's a great suggestion for the {topic}, I'll try it this week.",
  "Oh wow, yeah that's the right approach for my {topic}.",
  "Perfect, that's just what I was looking for on the {topic} front.",
];

const NEGATIVE_FOLLOWUPS = [
  "No, that's not really what I meant about the {topic}.",
  "That's not helpful for the {topic} situation.",
  "You're missing the point about the {topic}.",
  "Ugh, never mind about the {topic}.",
  "That's terrible advice about the {topic} honestly.",
];

const DEEPENERS = [
  "Can you help me think through the details?",
  "What would you do in my situation?",
  "I think the real issue is deeper than that.",
  "There's actually more to it — let me explain.",
  "How should I prioritize this against everything else?",
  "What's the first thing I should tackle?",
];

const TOPIC_SHIFTS = [
  "Oh, also — completely different topic — ",
  "Switching gears for a second, ",
  "One more thing while I'm thinking about it: ",
  "Unrelated, but ",
];

// =============================================================================
// CONVERSATION TEMPLATES
// =============================================================================

/** Fill {topic} in template string */
function fillTopic(template: string, topic: string): string {
  return template.replace(/\{topic\}/g, topic);
}

function pickPositive(topic: string, rng: () => number): string {
  return fillTopic(pick(POSITIVE_FOLLOWUPS_TEMPLATE, rng), topic);
}

function pickNegative(topic: string, rng: () => number): string {
  return fillTopic(pick(NEGATIVE_FOLLOWUPS, rng), topic);
}

type TemplateBuilder = (topic: string, topicCategory: string, emotion: string, rng: () => number) => string[];

const TEMPLATES: Record<string, TemplateBuilder> = {
  /** Deep dive: one topic, emotional, multiple turns */
  deep_emotional: (topic, category, emotion, rng) => {
    const turns: string[] = [];
    turns.push(`I'm feeling really ${emotion} about my ${topic}`);
    turns.push(pickPositive(topic, rng));
    turns.push(`The ${topic} situation is getting worse. ${pick(DEEPENERS, rng)}`);
    if (rng() > 0.5) turns.push(pickPositive(topic, rng));
    turns.push(`I think I have a plan for the ${topic} now. Thanks for talking it through.`);
    return turns;
  },

  /** Quick check-in: short, varied, tests breadth */
  quick_varied: (topic, category, emotion, rng) => {
    const otherCategory = pick(Object.keys(TOPICS).filter(c => c !== category), rng);
    const otherTopic = pick(TOPICS[otherCategory as keyof typeof TOPICS], rng);
    return [
      `Hey, quick question about my ${topic}`,
      pickPositive(topic, rng),
      `${pick(TOPIC_SHIFTS, rng)}I'm also ${pick(EMOTIONS.neutral, rng)} my ${otherTopic}`,
      `Thanks, that covers both the ${topic} and ${otherTopic}!`,
    ];
  },

  /** Stress escalation: starts mild, gets worse */
  stress_escalation: (topic, _category, _emotion, rng) => {
    return [
      `I've been ${pick(EMOTIONS.neutral, rng)} the ${topic} situation`,
      `Actually, the ${topic} is worse than I thought. I'm really ${pick(EMOTIONS.stressed, rng)}.`,
      pick(DEEPENERS, rng),
      rng() > 0.3 ? pickPositive(topic, rng) : pickNegative(topic, rng),
      `OK, I think I know what to do about the ${topic}. I'll keep you posted.`,
    ];
  },

  /** Positive momentum: good news + seeking guidance */
  positive_momentum: (topic, _category, _emotion, rng) => {
    return [
      `Great news about my ${topic}! I'm ${pick(EMOTIONS.excited, rng)} it`,
      `Yeah! ${pickPositive(topic, rng)}`,
      `Now I'm wondering — what should I focus on next with the ${topic}?`,
      pickPositive(topic, rng),
    ];
  },

  /** Returning user: catch-up after absence */
  returning_user: (topic, _category, _emotion, rng) => {
    return [
      `Hey, it's been a while! How have things been?`,
      `So about that ${topic} — things have changed. ${pick(DEEPENERS, rng)}`,
      pickPositive(topic, rng),
    ];
  },

  /** Tool request: asks for concrete help */
  tool_request: (topic, _category, _emotion, rng) => {
    const tools = [
      `Can you make me a checklist for the ${topic}?`,
      `Help me draft an email about the ${topic}`,
      `Can you summarize what we discussed about the ${topic}?`,
    ];
    return [
      `I need help with my ${topic}`,
      pick(tools, rng),
      pickPositive(topic, rng),
    ];
  },

  /** Mixed emotions: complex emotional state */
  mixed_emotions: (topic, _category, _emotion, rng) => {
    return [
      `I'm ${pick(EMOTIONS.excited, rng)} about the ${topic}, but also kind of ${pick(EMOTIONS.stressed, rng)}`,
      pick(DEEPENERS, rng),
      pickPositive(topic, rng),
      `I guess I'm feeling a lot of things about the ${topic} right now`,
    ];
  },
};

// =============================================================================
// GENERATOR
// =============================================================================

/** Simple seeded PRNG (xorshift32). */
function createRng(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[] | readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate N conversation scripts with controlled variation.
 * Each script is a multi-turn conversation exploring a specific topic/emotion/template combo.
 */
export function generateConversationScripts(config: TaskGenConfig): ConversationScript[] {
  const rng = createRng(config.seed ?? Date.now());
  const scripts: ConversationScript[] = [];
  const templateNames = Object.keys(TEMPLATES);
  const categoryList = config.categories?.length
    ? config.categories
    : Object.keys(TOPICS);

  for (let i = 0; i < config.count; i++) {
    const category = categoryList[i % categoryList.length];
    const topicPool = TOPICS[category as keyof typeof TOPICS] ?? TOPICS.work;
    const topic = pick(topicPool, rng);

    const emotionCategory = pick(Object.keys(EMOTIONS), rng);
    const emotion = pick(EMOTIONS[emotionCategory as keyof typeof EMOTIONS], rng);

    const templateName = templateNames[i % templateNames.length];
    const template = TEMPLATES[templateName];

    const messages = template(topic, category, emotion, rng);

    // Trim or pad to target turn count
    while (messages.length < config.turnsPerConversation) {
      messages.push(pick(DEEPENERS, rng));
    }
    if (messages.length > config.turnsPerConversation) {
      messages.length = config.turnsPerConversation;
    }

    scripts.push({
      id: `script_${i}_${category}_${templateName}`,
      category,
      messages,
      description: `${templateName}: ${emotion} about ${topic} (${category})`,
    });
  }

  return scripts;
}

/**
 * Get the list of available categories.
 */
export function getAvailableCategories(): string[] {
  return Object.keys(TOPICS);
}
