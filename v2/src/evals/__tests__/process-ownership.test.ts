import { createRequire } from "node:module";

type ProcessRow = { pid: number; ppid: number; pgid: number; rss: number; born: string };
const { collectOwnedProcesses } = createRequire(import.meta.url)("../process-ownership.cjs") as {
  collectOwnedProcesses(rows: ProcessRow[], ownerPid: number, roots: (number | undefined)[],
    owned: Map<number, ProcessRow>, groups: Set<number>): ProcessRow[];
};
const root: ProcessRow = { pid: 100, ppid: 77, pgid: 100, rss: 128, born: "original root" };
const child: ProcessRow = { pid: 110, ppid: 100, pgid: 110, rss: 64, born: "original child" };
const stranger: ProcessRow = { pid: 900, ppid: 1, pgid: 900, rss: 32, born: "stranger" };
function tracker() {
  const owned = new Map<number, ProcessRow>(), groups = new Set<number>();
  return { owned, groups, poll: (rows: ProcessRow[], roots: (number | undefined)[] = [100]) =>
    collectOwnedProcesses(rows, 77, roots, owned, groups) };
}

test("registers only declared roots with the guard as their actual parent", () => {
  const t = tracker(); expect(t.poll([{ ...root, ppid: 1 }, stranger])).toEqual([]);
  expect(t.owned.size).toBe(0); expect(t.groups.size).toBe(0);
  expect(t.poll([root, stranger])).toEqual([root]);
});
test("discovers out-of-order descendants and their detached groups transitively", () => {
  const t = tracker(), grandchild = { ...child, pid: 120, ppid: 110, born: "grandchild" };
  expect(t.poll([grandchild, stranger, child, root]).map(p => p.pid).sort()).toEqual([100, 110, 120]);
  expect([...t.groups].sort()).toEqual([100, 110]);
});
test("retains identity-proven detached descendants after their parent exits", () => {
  const t = tracker(); t.poll([root, child]);
  expect(t.poll([{ ...child, ppid: 1 }, stranger])).toEqual([{ ...child, ppid: 1 }]);
  expect(t.owned.get(100)).toEqual(root); expect(t.groups.has(100)).toBe(false);
});
test("original group membership remains usable when leader is alive", () => {
  const t = tracker(); t.poll([root]);
  const member = { ...child, ppid: 1, pgid: 100 };
  expect(t.poll([member, root, stranger])).toEqual([member, root]);
});
test("reused root PID is not the previously owned process", () => {
  const t = tracker(); t.poll([root]);
  expect(t.poll([{ ...root, ppid: 1, born: "new root" }, stranger])).toEqual([]);
  expect(t.owned.get(100)).toEqual(root);
});
test("recreated group cannot authorize unrelated children before invalidation", () => {
  const t = tracker(); t.poll([root, child]);
  const reused = { ...root, ppid: 1, born: "new root" };
  const unrelatedMember = { ...stranger, pid: 901, ppid: 100, pgid: 100 };
  expect(t.poll([unrelatedMember, reused, { ...child, ppid: 1 }])).toEqual([{ ...child, ppid: 1 }]);
  expect(t.owned.has(901)).toBe(false); expect(t.groups.has(100)).toBe(false);
  expect(t.owned.get(100)).toEqual(root);
  expect(t.poll([unrelatedMember, stranger])).toEqual([]);
});
test("a vanished group's numeric ID alone never reactivates it later", () => {
  const t = tracker(); t.poll([root]); t.poll([stranger]);
  expect(t.poll([{ ...stranger, pid: 901, ppid: 1, pgid: 100 }])).toEqual([]);
});
test("reused detached group leader cannot authorize unrelated grandchildren", () => {
  const t = tracker(); t.poll([root, child]);
  expect(t.poll([root, { ...child, ppid: 1, born: "new child" },
    { ...stranger, pid: 901, ppid: 110, pgid: 110 }])).toEqual([root]);
  expect(t.owned.has(901)).toBe(false); expect(t.groups.has(110)).toBe(false);
});
test("late sampler is a separate explicitly owned root, never a foreign process", () => {
  const t = tracker(); t.poll([root]);
  const sampler = { ...root, pid: 200, pgid: 200, born: "sampler" };
  expect(t.poll([root, sampler, stranger], [100, 200])).toEqual([root, sampler]);
  expect(t.poll([sampler, stranger], [100, 200])).toEqual([sampler]);
});
test("undefined or wrong-parent sampler does not create a grant", () => {
  const t = tracker(); t.poll([root]);
  expect(t.poll([root, { ...stranger, pid: 200 }], [100, undefined, 200])).toEqual([root]);
});
test("a changed process group does not pass exact owned birth/group identity", () => {
  const t = tracker(); t.poll([root, child]);
  expect(t.poll([root, { ...child, pgid: 999 }])).toEqual([root]);
});
test("no row or historical record is rewritten and no unrelated host action exists", () => {
  const t = tracker(), rows = [root, child, stranger].map(p => Object.freeze({ ...p }));
  expect(t.poll(rows)).toEqual([root, child]);
  t.poll([stranger]); expect(t.owned.get(100)).toEqual(root); expect(t.owned.get(110)).toEqual(child);
  expect(t.groups.size).toBe(0); expect(rows).toEqual([root, child, stranger]);
});
