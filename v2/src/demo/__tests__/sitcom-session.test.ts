import { SITCOM_DURATION, SitcomSessionBudget } from "../sitcom-session";

test("the live default is ten minutes, with an explicit thirty-minute local ceiling", () => {
  expect(SITCOM_DURATION).toEqual({ min: 10, max: 1800, default: 600 });
  for (const seconds of [10, 120, 300, 600, 1200, 1800]) expect(new SitcomSessionBudget(0, seconds).effectiveSeconds).toBe(seconds);
  for (const seconds of [0, 9, 1801, 120.5, NaN, Infinity]) expect(() => new SitcomSessionBudget(0, seconds)).toThrow();
});

test("an accelerated thirty-minute episode remains alive past two minutes and ends at its chosen deadline", () => {
  const budget = new SitcomSessionBudget(0, 1800); budget.allocated(8500); budget.ready(19000);
  for (let now = 0; now < 1_819_000; now += 500) {
    if (now % 10000 === 0) budget.heartbeat(now);
    expect(budget.expiration(now)).toBeNull();
  }
  expect(budget.expiration(1_819_000)).toBe("duration");
});

test("provider caps, repeated ready and late metadata can only shorten the budget", () => {
  const budget = new SitcomSessionBudget(1000, 600); budget.allocated(10000); budget.ready(20000);
  const selectedDeadline = budget.deadline;
  budget.reportProvider(null); expect(budget.deadline).toBe(selectedDeadline);
  budget.reportProvider(1800); expect(budget.deadline).toBe(selectedDeadline);
  budget.reportProvider(120); expect(budget.deadline).toBe(130000);
  expect(budget.effectiveSeconds).toBe(120);
  budget.ready(50000); budget.allocated(60000); budget.reportProvider(600); budget.reportProvider(null);
  expect(budget.deadline).toBe(130000); expect(budget.providerMaxSessionSeconds).toBe(120);
  budget.heartbeat(140000); expect(budget.expiration(140000)).toBe("duration");
  for (const cap of [0, -1, NaN, Infinity]) expect(() => budget.reportProvider(cap)).toThrow();
});

test("missing first media does not erase the absolute budget or browser-disconnect safeguard", () => {
  const budget = new SitcomSessionBudget(0, 600);
  expect(budget.deadline).toBe(660000);
  expect(budget.expiration(29999)).toBeNull(); expect(budget.expiration(30000)).toBe("client_disconnected");
  budget.heartbeat(30000); expect(budget.expiration(30000)).toBeNull();
  budget.heartbeat(10000); expect(budget.expiration(59999)).toBeNull();
  expect(budget.expiration(60000)).toBe("client_disconnected");
  budget.reportProvider(15); expect(budget.deadline).toBe(15000);
});
