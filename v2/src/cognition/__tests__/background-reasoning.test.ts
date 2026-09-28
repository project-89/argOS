import {jest} from "@jest/globals";
import {backgroundThinkingLevel,backgroundOutputTokens,backgroundDeadlineMs,observeBackgroundProvider} from "../background-reasoning";
const previous=process.env.ARGOS_BACKGROUND_THINKING;
test("role-specific slow deadlines remain bounded and preserve low behavior",()=>{
  expect(backgroundDeadlineMs("planning","low")).toBe(10000);
  expect(backgroundDeadlineMs("reflection","low")).toBe(12000);
  expect(backgroundDeadlineMs("planning","medium")).toBe(15000);
  expect(backgroundDeadlineMs("reflection","medium")).toBe(20000);
  expect(backgroundDeadlineMs("planning","high")).toBe(20000);
  expect(backgroundDeadlineMs("reflection","high")).toBe(30000);
});
afterEach(()=>{jest.restoreAllMocks();if(previous===undefined)delete process.env.ARGOS_BACKGROUND_THINKING;else process.env.ARGOS_BACKGROUND_THINKING=previous;});
test("background setting defaults to medium and validates explicit overrides",()=>{
  delete process.env.ARGOS_BACKGROUND_THINKING;expect(backgroundThinkingLevel()).toBe("medium");
  process.env.ARGOS_BACKGROUND_THINKING="high";expect(backgroundThinkingLevel()).toBe("high");
  process.env.ARGOS_BACKGROUND_THINKING="invalid";expect(backgroundThinkingLevel).toThrow();
});
test("deeper reasoning reserves answer headroom without changing low budgets",()=>{
  expect(backgroundOutputTokens("planning","low")).toBe(2200);
  expect(backgroundOutputTokens("reflection","low")).toBe(1500);
  for(const faculty of ["planning","reflection"] as const){
    expect(backgroundOutputTokens(faculty,"medium")).toBe(4096);
    expect(backgroundOutputTokens(faculty,"high")).toBe(8192);
  }
});
test("records truncation and token counts without recording response content",async()=>{
  const log=jest.spyOn(console,"log").mockImplementation(()=>{});
  const response={text:"PRIVATE",finishReason:"length",usage:{inputTokens:20,outputTokens:1500,outputTokenDetails:{reasoningTokens:1498}}};
  expect(await observeBackgroundProvider("reflection",2,"high",async()=>response)).toBe(response);
  const metrics=JSON.parse(String(log.mock.calls[0][1]));
  expect(metrics).toMatchObject({finishReason:"length",outputTokens:1500,reasoningTokens:1498,outputCharacters:7});
  expect(JSON.stringify(metrics)).not.toContain("PRIVATE");
});
test("errors remain failures and diagnostics never log error messages",async()=>{
  const log=jest.spyOn(console,"log").mockImplementation(()=>{});
  const error=new Error("PRIVATE_ERROR");error.name="TimeoutError";
  await expect(observeBackgroundProvider("planning",2,"high",async()=>{throw error;})).rejects.toBe(error);
  expect(JSON.parse(String(log.mock.calls[0][1])).outcome).toBe("timeout");
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_ERROR");
});
