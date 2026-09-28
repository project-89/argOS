import type { AgentAction } from "../../cognition/agent-mind";
import { estimateSpeechDurationMs } from "../../cognition/timed-speech";
import type { GenerativeAgentsTestbed, TestbedCharacter } from "../generative-agents";

/** Complete only the fixture's newly submitted finite atomic operation.
 * Continuous holds/drying/repair/travel remain explicitly stepped by tests. */
export function completeFixtureHandling(house: GenerativeAgentsTestbed, actor: TestbedCharacter, action: AgentAction) {
  const eid = house.ids[actor];
  const duration = house.activity.phase[eid] === "handling" ? house.activity.untilMs[eid] - house.elapsedMs
    : action.type === "speak" ? estimateSpeechDurationMs(action.content ?? "")
    : ({ give: 1000, drop: 600, observe: 1000, examine: 1500, use: 2000 } as Record<string, number>)[action.type] ?? 0;
  if (duration > 0) house.advance(duration);
}
