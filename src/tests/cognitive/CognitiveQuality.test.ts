import { setupTestSimulation } from "../utils/testSetup";
import { LongTermQualityMonitor } from "./LongTermQualityMonitor";

describe("Cognitive Quality Testing", () => {
  let simulation;
  let monitor;
  let agent;

  beforeEach(async () => {
    simulation = await setupTestSimulation();
    monitor = new LongTermQualityMonitor(simulation.runtime);
    agent = await simulation.spawnTestAgent();
  });

  test("should maintain cognitive quality over time", async () => {
    // Start monitoring
    await monitor.startMonitoring(agent);

    // Simulate extended operation
    for (let i = 0; i < 10; i++) {
      // Run complex cognitive tasks
      await simulation.sendStimulus(agent, {
        type: "complex_task",
        content: `Solve problem set ${i}`,
      });

      // Wait for processing
      await simulation.waitForProcessing(agent);
    }

    // Get quality report
    const report = await monitor.generateQualityReport(agent);

    // Verify quality metrics
    expect(report.current.coherence).toBeGreaterThan(0.7);
    expect(report.current.relevance).toBeGreaterThan(0.7);
    expect(report.current.creativity).toBeGreaterThan(0.6);
    expect(report.current.memoryAccuracy).toBeGreaterThan(0.8);
    expect(report.current.goalAlignment).toBeGreaterThan(0.7);

    // Verify no significant degradation
    Object.values(report.improvements).forEach((improvement) => {
      expect(improvement).toBeGreaterThan(-0.2);
    });
  });
});
