import { CognitiveQualityTest } from "./CognitiveQualityTest";
import { SimulationRuntime } from "../../runtime/SimulationRuntime";

export class LongTermQualityMonitor {
  private qualityTests: Map<number, CognitiveQualityTest> = new Map();
  private qualityHistory: Map<
    number,
    Array<{
      timestamp: number;
      metrics: CognitiveMetrics;
    }>
  > = new Map();

  constructor(private runtime: SimulationRuntime) {}

  async startMonitoring(agentId: number) {
    const test = new CognitiveQualityTest(this.runtime, agentId);
    this.qualityTests.set(agentId, test);

    // Establish baseline
    const baseline = await test.measureBaseline();
    this.qualityHistory.set(agentId, [
      {
        timestamp: Date.now(),
        metrics: baseline,
      },
    ]);

    // Start periodic testing
    this.scheduleQualityCheck(agentId);
  }

  private scheduleQualityCheck(agentId: number) {
    setInterval(async () => {
      const test = this.qualityTests.get(agentId);
      if (!test) return;

      const { metrics, improvements } = await test.compareToBaseline();

      // Store results
      const history = this.qualityHistory.get(agentId) || [];
      history.push({
        timestamp: Date.now(),
        metrics,
      });

      // Alert if significant degradation
      this.checkForDegradation(agentId, improvements);
    }, 1000 * 60 * 60); // Check every hour
  }

  private checkForDegradation(
    agentId: number,
    improvements: Partial<Record<keyof CognitiveMetrics, number>>
  ) {
    const degradationThreshold = -0.2; // 20% decrease

    for (const [metric, change] of Object.entries(improvements)) {
      if (change < degradationThreshold) {
        console.warn(
          `Agent ${agentId} showing significant degradation in ${metric}: ${
            change * 100
          }%`
        );
      }
    }
  }

  async generateQualityReport(agentId: number) {
    const history = this.qualityHistory.get(agentId);
    if (!history) return null;

    const latest = history[history.length - 1];
    const baseline = history[0];
    const test = this.qualityTests.get(agentId);

    if (!test) return null;

    const { improvements } = await test.compareToBaseline();

    return {
      agentId,
      baseline: baseline.metrics,
      current: latest.metrics,
      improvements,
      history: history.map((h) => ({
        timestamp: h.timestamp,
        metrics: h.metrics,
      })),
    };
  }
}
