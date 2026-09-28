// Pure census ownership calculation. Callers own collection, timeouts, stop
// policy and signalling; this helper never performs a host action.
function collectOwnedProcesses(rows, ownerPid, rootPids, owned, groups) {
  // A numeric PGID is not durable authority. A newly born leader disproves
  // continuity of the previously owned group; remove it BEFORE adopting any
  // members. Keep historical identities for audit, never replace them on reuse.
  for (const group of groups) {
    const leader = rows.find(p => p.pid === group), original = owned.get(group);
    if (leader && original && leader.born !== original.born) groups.delete(group);
  }
  for (const pid of rootPids) {
    const root = rows.find(p => p.pid === pid && p.ppid === ownerPid);
    if (root && !owned.has(pid)) { owned.set(root.pid, root); groups.add(root.pgid); }
  }
  let changed = true;
  while (changed) {
    changed = false;
    const alive = new Set(rows.filter(p => owned.get(p.pid)?.born === p.born).map(p => p.pid));
    for (const p of rows) if (!owned.has(p.pid) && (alive.has(p.ppid) || groups.has(p.pgid))) {
      owned.set(p.pid, p); if (p.pid === p.pgid) groups.add(p.pgid); changed = true;
    }
  }
  for (const group of groups) if (!rows.some(p => p.pgid === group)) groups.delete(group);
  return rows.filter(p => owned.get(p.pid)?.born === p.born && owned.get(p.pid)?.pgid === p.pgid);
}
module.exports = { collectOwnedProcesses };
