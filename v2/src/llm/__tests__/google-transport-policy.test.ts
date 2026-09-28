import { afterEach, expect, jest, test } from "@jest/globals";

const dispatcher = { dispatch: jest.fn() };
const constructAgent = jest.fn(() => dispatcher);
jest.unstable_mockModule("undici", () => ({ Agent: constructAgent }));
const { googleProviderFetch } = await import("../google-transport");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("explicitly disables H2 once per shared provider pool, not globally or per request", async () => {
  const observed: unknown[] = [];
  const observer: typeof fetch = async (_input, init) => {
    observed.push((init as any).dispatcher);
    return new Response("fixture");
  };
  globalThis.fetch = observer;
  await googleProviderFetch("https://generativelanguage.googleapis.com/fixture");
  await googleProviderFetch("https://generativelanguage.googleapis.com/fixture");
  expect(constructAgent).toHaveBeenCalledTimes(1);
  expect(constructAgent).toHaveBeenCalledWith({ allowH2: false });
  expect(observed).toEqual([dispatcher, dispatcher]);
  expect(globalThis.fetch).toBe(observer);
});
