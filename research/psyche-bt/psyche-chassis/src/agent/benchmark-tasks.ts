/**
 * Benchmark Tasks — 30 tasks across 5 categories for evaluating the Swarm-BT agent.
 *
 * Each task has an expected answer (or rubric), difficulty rating, and category.
 * Tasks are designed to test different aspects of agent capability:
 *   - Reasoning: can it think logically?
 *   - Planning: can it decompose complex goals?
 *   - Coding: can it write and debug code?
 *   - Creative: can it produce quality content?
 *   - Multi-step: can it chain tool calls effectively?
 */

// =============================================================================
// TYPES
// =============================================================================

export interface BenchmarkTask {
  id: string;
  category: "reasoning" | "planning" | "coding" | "creative" | "multi_step";
  description: string;
  /** The task prompt given to the agent */
  prompt: string;
  /** Expected answer (exact for math, rubric keywords for open-ended) */
  expectedAnswer: string;
  /** Keywords that should appear in a correct answer */
  answerKeywords: string[];
  /** Difficulty 1-5 */
  difficulty: number;
  /** Does this task benefit from tools? */
  requiresTools: boolean;
  /** Evaluation method */
  evalMethod: "exact" | "keywords" | "judge";
}

// =============================================================================
// REASONING TASKS (10)
// =============================================================================

const REASONING_TASKS: BenchmarkTask[] = [
  {
    id: "r1_arithmetic",
    category: "reasoning",
    description: "Multi-step arithmetic word problem",
    prompt: "A store sells apples for $2 each and oranges for $3 each. Maria buys 5 apples and 3 oranges. She pays with a $20 bill. How much change does she receive?",
    expectedAnswer: "1",
    answerKeywords: ["1", "$1", "one dollar"],
    difficulty: 1,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r2_percentage",
    category: "reasoning",
    description: "Percentage calculation",
    prompt: "A shirt originally costs $80. It's on sale for 25% off, and there's an additional 10% discount on the sale price. What is the final price?",
    expectedAnswer: "54",
    answerKeywords: ["54", "$54"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r3_logic",
    category: "reasoning",
    description: "Logical deduction",
    prompt: "In a race, Alex finished before Ben. Charlie finished after Diana but before Alex. Diana finished first. What was the finishing order from first to last?",
    expectedAnswer: "Diana, Charlie, Alex, Ben",
    answerKeywords: ["diana", "charlie", "alex", "ben"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "r4_algebra",
    category: "reasoning",
    description: "Two-step algebra",
    prompt: "If 3x + 7 = 22, what is the value of 5x - 3?",
    expectedAnswer: "22",
    answerKeywords: ["22"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r5_probability",
    category: "reasoning",
    description: "Basic probability",
    prompt: "A bag contains 4 red balls, 3 blue balls, and 5 green balls. If you draw two balls WITHOUT replacement, what is the probability that both are red? Express as a fraction.",
    expectedAnswer: "1/11",
    answerKeywords: ["1/11", "1 / 11"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r6_pattern",
    category: "reasoning",
    description: "Pattern recognition",
    prompt: "What is the next number in this sequence: 2, 6, 12, 20, 30, ?",
    expectedAnswer: "42",
    answerKeywords: ["42"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r7_causal",
    category: "reasoning",
    description: "Causal reasoning",
    prompt: "A plant is wilting. The soil is wet, it's in direct sunlight during the hottest part of the day, and the leaves have brown spots. What is the most likely cause and what should be done?",
    expectedAnswer: "sunburn/heat stress",
    answerKeywords: ["sun", "heat", "shade", "move"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "r8_multistep_math",
    category: "reasoning",
    description: "Multi-step math with units",
    prompt: "A train travels at 60 mph for 2.5 hours, then at 80 mph for 1.5 hours. What is the average speed for the entire journey? Round to one decimal place.",
    expectedAnswer: "67.5",
    answerKeywords: ["67.5"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "exact",
  },
  {
    id: "r9_constraint",
    category: "reasoning",
    description: "Constraint satisfaction",
    prompt: "You need to schedule 3 meetings: A (1 hour), B (2 hours), C (30 min). Available slots: 9-12pm. Constraints: A must be before B, C must not be adjacent to A. Give a valid schedule.",
    expectedAnswer: "various valid schedules",
    answerKeywords: ["9", "10", "11", "meeting"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "r10_recursion",
    category: "reasoning",
    description: "Recursive thinking",
    prompt: "Consider the function f(n) = f(n-1) + f(n-2), with f(1) = 1 and f(2) = 1. What is f(8)?",
    expectedAnswer: "21",
    answerKeywords: ["21"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "exact",
  },
];

// =============================================================================
// PLANNING TASKS (5)
// =============================================================================

const PLANNING_TASKS: BenchmarkTask[] = [
  {
    id: "p1_dinner",
    category: "planning",
    description: "Plan a dinner party",
    prompt: "Plan a dinner party for 6 people. Two are vegetarian, one is gluten-free. Budget is $100. Include menu, shopping list, timeline, and tasks.",
    expectedAnswer: "comprehensive plan",
    answerKeywords: ["menu", "vegetarian", "gluten", "budget", "timeline", "shopping"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "p2_study",
    category: "planning",
    description: "Create a study plan",
    prompt: "Create a 2-week study plan for someone learning Python who has 2 hours per day. They know basic HTML/CSS but no programming. Include daily topics, exercises, and milestones.",
    expectedAnswer: "structured study plan",
    answerKeywords: ["variables", "functions", "loops", "day", "exercise", "week"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "p3_project",
    category: "planning",
    description: "Project decomposition",
    prompt: "Break down the task of 'build a personal blog website' into a work breakdown structure with tasks, dependencies, and time estimates. Assume a solo developer with basic web skills.",
    expectedAnswer: "work breakdown structure",
    answerKeywords: ["design", "frontend", "deploy", "database", "content", "hours"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "p4_travel",
    category: "planning",
    description: "Travel itinerary",
    prompt: "Plan a 3-day weekend trip to a city. Budget: $500 total. Include transportation, accommodation, activities for each day, and meal suggestions. Be specific about time allocation.",
    expectedAnswer: "detailed itinerary",
    answerKeywords: ["day 1", "day 2", "day 3", "hotel", "budget", "morning", "evening"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "p5_emergency",
    category: "planning",
    description: "Emergency response plan",
    prompt: "Create a step-by-step emergency plan for a small office (20 people) in case of an earthquake. Include immediate actions, evacuation procedures, communication plan, and recovery steps.",
    expectedAnswer: "emergency response plan",
    answerKeywords: ["evacuate", "shelter", "communication", "assembly", "first aid", "contact"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
];

// =============================================================================
// CODING TASKS (5)
// =============================================================================

const CODING_TASKS: BenchmarkTask[] = [
  {
    id: "c1_palindrome",
    category: "coding",
    description: "Write a palindrome checker",
    prompt: "Write a JavaScript function called `isPalindrome(str)` that returns true if the string is a palindrome (ignoring case and non-alphanumeric characters). Then test it with: 'A man, a plan, a canal: Panama' (should return true) and 'hello' (should return false). Use the run_code tool to verify.",
    expectedAnswer: "true, false",
    answerKeywords: ["true", "false", "palindrome"],
    difficulty: 2,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "c2_fibonacci",
    category: "coding",
    description: "Fibonacci with memoization",
    prompt: "Write a JavaScript function that computes the nth Fibonacci number using memoization. Calculate fib(50) and return the result. Use the run_code tool.",
    expectedAnswer: "12586269025",
    answerKeywords: ["12586269025"],
    difficulty: 2,
    requiresTools: true,
    evalMethod: "exact",
  },
  {
    id: "c3_sort",
    category: "coding",
    description: "Implement merge sort",
    prompt: "Implement merge sort in JavaScript. Sort the array [38, 27, 43, 3, 9, 82, 10] and output the result. Use the run_code tool to verify.",
    expectedAnswer: "[3, 9, 10, 27, 38, 43, 82]",
    answerKeywords: ["3", "9", "10", "27", "38", "43", "82"],
    difficulty: 3,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "c4_debug",
    category: "coding",
    description: "Debug a broken function",
    prompt: "This JavaScript function is supposed to flatten a nested array, but it has bugs. Fix it and test with [[1,[2]],3,[4,[5,[6]]]]. Expected output: [1,2,3,4,5,6].\n\nBroken code:\n```javascript\nfunction flatten(arr) {\n  let result = [];\n  for (let item of arr) {\n    if (Array.isArray(item)) {\n      result.push(flatten(item));\n    } else {\n      result.push(item);\n    }\n  }\n  return result;\n}\n```\n\nUse the run_code tool to test your fix.",
    expectedAnswer: "[1,2,3,4,5,6]",
    answerKeywords: ["1", "2", "3", "4", "5", "6", "concat", "spread", "..."],
    difficulty: 2,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "c5_api",
    category: "coding",
    description: "Design a data structure",
    prompt: "Design and implement a LRU (Least Recently Used) Cache in JavaScript with get(key) and put(key, value) operations, both in O(1) time. Capacity is 3. Test with: put(1,'a'), put(2,'b'), put(3,'c'), get(1), put(4,'d'). Then get(2) should return undefined (evicted), and get(1) should return 'a'. Use run_code to verify.",
    expectedAnswer: "undefined, a",
    answerKeywords: ["undefined", "map", "cache"],
    difficulty: 4,
    requiresTools: true,
    evalMethod: "keywords",
  },
];

// =============================================================================
// CREATIVE TASKS (5)
// =============================================================================

const CREATIVE_TASKS: BenchmarkTask[] = [
  {
    id: "cr1_email",
    category: "creative",
    description: "Professional email",
    prompt: "Write a professional email declining a meeting invitation politely. The meeting is about Q3 marketing strategy, scheduled for Tuesday at 2pm. You have a conflict but want to contribute asynchronously. Keep it under 100 words.",
    expectedAnswer: "professional email",
    answerKeywords: ["meeting", "tuesday", "conflict", "contribute", "asynchronous"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "cr2_product",
    category: "creative",
    description: "Product description",
    prompt: "Write a compelling product description for a noise-canceling headphone called 'SilentPro X1'. Features: 40-hour battery, adaptive ANC, spatial audio, lightweight (250g). Target audience: remote workers. Keep it under 150 words.",
    expectedAnswer: "product description",
    answerKeywords: ["noise", "battery", "40", "remote", "lightweight", "audio"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "cr3_taglines",
    category: "creative",
    description: "Marketing taglines",
    prompt: "Generate 5 different marketing taglines for an eco-friendly water bottle brand called 'PureFlow'. Each tagline should be under 8 words and appeal to environmentally conscious millennials.",
    expectedAnswer: "5 taglines",
    answerKeywords: ["pure", "eco", "planet", "sustainable", "water"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "cr4_summary",
    category: "creative",
    description: "Technical concept explanation",
    prompt: "Explain the concept of 'eventual consistency' in distributed systems to a smart 12-year-old. Use an analogy. Keep it under 200 words.",
    expectedAnswer: "clear explanation with analogy",
    answerKeywords: ["consistent", "update", "time", "agree", "different"],
    difficulty: 3,
    requiresTools: false,
    evalMethod: "keywords",
  },
  {
    id: "cr5_compare",
    category: "creative",
    description: "Pros/cons analysis",
    prompt: "Compare working remotely vs. working in an office. Give 3 pros and 3 cons for each, with a balanced recommendation. Format as a structured comparison.",
    expectedAnswer: "structured comparison",
    answerKeywords: ["remote", "office", "pro", "con", "flexibility", "collaboration"],
    difficulty: 2,
    requiresTools: false,
    evalMethod: "keywords",
  },
];

// =============================================================================
// MULTI-STEP TASKS (5)
// =============================================================================

const MULTI_STEP_TASKS: BenchmarkTask[] = [
  {
    id: "m1_analyze_code",
    category: "multi_step",
    description: "Write, run, and analyze code",
    prompt: "Write a JavaScript function that generates 100 random numbers between 1 and 1000, then calculate the mean, median, and standard deviation. Use the run_code tool to execute and report the results.",
    expectedAnswer: "mean, median, std dev values",
    answerKeywords: ["mean", "median", "standard deviation"],
    difficulty: 3,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "m2_data_pipeline",
    category: "multi_step",
    description: "Multi-step data processing",
    prompt: "Create a file called 'data.json' containing an array of 5 objects, each with 'name', 'age', and 'score' fields. Then read the file, calculate the average score, find the oldest person, and write a summary report to 'report.txt'. Use file tools.",
    expectedAnswer: "report written",
    answerKeywords: ["average", "oldest", "report", "written"],
    difficulty: 3,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "m3_research",
    category: "multi_step",
    description: "Research and synthesize",
    prompt: "Think through the following question step by step using your think tool: 'What are the key differences between REST and GraphQL APIs? When should you use each?' Then provide a structured comparison with recommendations.",
    expectedAnswer: "comparison of REST vs GraphQL",
    answerKeywords: ["rest", "graphql", "endpoint", "query", "schema", "over-fetching"],
    difficulty: 2,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "m4_calculate_verify",
    category: "multi_step",
    description: "Calculate and verify",
    prompt: "A company has quarterly revenues: Q1=$1.2M, Q2=$1.5M, Q3=$1.1M, Q4=$1.8M. Calculate: (1) total annual revenue, (2) quarter-over-quarter growth rates, (3) which quarter had the highest growth. Use the calculate tool to verify your math.",
    expectedAnswer: "total: 5.6M, growth rates, Q4 highest",
    answerKeywords: ["5.6", "growth", "Q4"],
    difficulty: 3,
    requiresTools: true,
    evalMethod: "keywords",
  },
  {
    id: "m5_code_and_explain",
    category: "multi_step",
    description: "Code, test, and explain",
    prompt: "Implement a binary search function in JavaScript. Test it by searching for the value 7 in the sorted array [1, 3, 5, 7, 9, 11, 13]. Use run_code to verify it returns index 3. Then explain the time complexity.",
    expectedAnswer: "index 3, O(log n)",
    answerKeywords: ["3", "log", "O(log n)", "binary"],
    difficulty: 2,
    requiresTools: true,
    evalMethod: "keywords",
  },
];

// =============================================================================
// ALL TASKS
// =============================================================================

export const ALL_BENCHMARK_TASKS: BenchmarkTask[] = [
  ...REASONING_TASKS,
  ...PLANNING_TASKS,
  ...CODING_TASKS,
  ...CREATIVE_TASKS,
  ...MULTI_STEP_TASKS,
];

export function getTasksByCategory(category: BenchmarkTask["category"]): BenchmarkTask[] {
  return ALL_BENCHMARK_TASKS.filter(t => t.category === category);
}

export function getTaskById(id: string): BenchmarkTask | undefined {
  return ALL_BENCHMARK_TASKS.find(t => t.id === id);
}
