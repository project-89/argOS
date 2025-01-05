import { createWorld } from "bitecs";
import { SimulationRuntime } from "../../runtime/SimulationRuntime";
import { ProcessingMode } from "../../components/ProcessingState";
import { CognitiveEvaluator } from "./evaluators/CognitiveEvaluator";

interface CognitiveMetrics {
  coherence: number; // 0-1 score for thought consistency
  relevance: number; // 0-1 score for context relevance
  creativity: number; // 0-1 score for novel thinking
  responseTime: number; // ms to generate response
  memoryAccuracy: number; // 0-1 score for memory recall accuracy
  goalAlignment: number; // 0-1 score for alignment with goals
}

export class CognitiveQualityTest {
  private metrics: CognitiveMetrics[] = [];
  private baseline: CognitiveMetrics | null = null;
  private evaluator: CognitiveEvaluator;

  constructor(private runtime: SimulationRuntime, private agent: number) {
    this.evaluator = new CognitiveEvaluator(runtime, agent);
  }

  async measureBaseline() {
    // Run standard test suite to establish baseline metrics
    this.baseline = await this.runMetricsSuite();
    return this.baseline;
  }

  async runMetricsSuite(): Promise<CognitiveMetrics> {
    const startTime = Date.now();

    // Test coherence through conversation chain
    const coherence = await this.testCoherence();

    // Test contextual relevance
    const relevance = await this.testRelevance();

    // Test creative problem solving
    const creativity = await this.testCreativity();

    // Memory recall accuracy
    const memoryAccuracy = await this.testMemory();

    // Goal pursuit effectiveness
    const goalAlignment = await this.testGoalAlignment();

    return {
      coherence,
      relevance,
      creativity,
      responseTime: Date.now() - startTime,
      memoryAccuracy,
      goalAlignment,
    };
  }

  private async testCoherence(): Promise<number> {
    // Test conversation chain consistency
    const responses = await this.runConversationChain([
      "What is your primary goal?",
      "How does that goal influence your decisions?",
      "Can you give an example of a decision you made based on that goal?",
    ]);

    return this.evaluateCoherence(responses);
  }

  private async testRelevance(): Promise<number> {
    // Test contextual awareness and response relevance
    const contextualPrompts = [
      { context: "emergency", prompt: "The system is failing!" },
      { context: "casual", prompt: "How's your day going?" },
      { context: "technical", prompt: "Can you explain your architecture?" },
    ];

    const scores = await Promise.all(
      contextualPrompts.map(async ({ context, prompt }) => {
        const response = await this.getAgentResponse(prompt);
        return this.evaluateContextualRelevance(response, context);
      })
    );

    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private async testCreativity(): Promise<number> {
    // Test novel problem solving
    const problem = "How would you redesign yourself to be more effective?";
    const solution = await this.getAgentResponse(problem);

    return this.evaluateCreativity(solution);
  }

  private async testMemory(): Promise<number> {
    // Test memory retention and recall
    const testMemory = "Remember this sequence: A1B2C3";
    await this.getAgentResponse(testMemory);

    // Add some cognitive load
    await this.runConversationChain([
      "What's 2+2?",
      "Name a color",
      "What's your role?",
    ]);

    // Test recall
    const recall = await this.getAgentResponse(
      "What sequence did I ask you to remember?"
    );

    return this.evaluateMemoryAccuracy(recall, "A1B2C3");
  }

  async compareToBaseline(): Promise<{
    metrics: CognitiveMetrics;
    improvements: Partial<Record<keyof CognitiveMetrics, number>>;
  }> {
    if (!this.baseline) {
      throw new Error("Baseline not established");
    }

    const current = await this.runMetricsSuite();
    const improvements: Partial<Record<keyof CognitiveMetrics, number>> = {};

    // Calculate improvements
    for (const key of Object.keys(current) as Array<keyof CognitiveMetrics>) {
      improvements[key] = current[key] - this.baseline[key];
    }

    return { metrics: current, improvements };
  }

  private async getAgentResponse(prompt: string): Promise<string> {
    await this.runtime.sendStimulus(this.agent, {
      type: "speech",
      content: prompt,
    });

    const response = await this.runtime.waitForResponse(this.agent);
    return response.content;
  }

  private async runConversationChain(prompts: string[]): Promise<string[]> {
    const responses = [];
    for (const prompt of prompts) {
      const response = await this.getAgentResponse(prompt);
      responses.push(response);
    }
    return responses;
  }

  private async evaluateCoherence(responses: string[]): Promise<number> {
    return this.evaluator.evaluateCoherence(responses);
  }

  private async evaluateContextualRelevance(
    response: string,
    context: string
  ): Promise<number> {
    return this.evaluator.evaluateContextualRelevance(response, context);
  }

  private async evaluateCreativity(solution: string): Promise<number> {
    return this.evaluator.evaluateCreativity(solution);
  }

  private async evaluateMemoryAccuracy(
    recall: string,
    original: string
  ): Promise<number> {
    return this.evaluator.evaluateMemoryAccuracy(recall, original);
  }
}
