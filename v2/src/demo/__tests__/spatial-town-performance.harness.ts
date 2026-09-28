import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

// A CPU/event-loop regression gate, not ten autonomous NPCs or a live-provider
// benchmark. It uses the actual foreground request projections and native motor
// on an ordinary 100ms timer; it never catches the clock up after a late tick.
// The Jest wrapper runs this in the production Node/tsx runtime, outside Jest's
// VM globals. Run the wrapper in isolation (--runInBand) to avoid CPU contention.
const STEP_MS = 100, TICKS = 80, MAX_WALL_MS = 16_000;
const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};
const rounded = (value: number) => Number(value.toFixed(3));

async function run() {
  const report = console.log.bind(console);
  console.log = () => {};
  let fetchAttempts = 0;
  globalThis.fetch = (async () => { fetchAttempts++; throw new Error("Town performance gate is offline"); }) as typeof fetch;
  // Block fetch before loading any engine modules, not just before startup.
  const { SpatialDemo } = await import("../spatial-demo");
  const { TOWN_SPATIAL_BLUEPRINT } = await import("../spatial-town");
  const { Position, WorkingMemoryIdentity } = await import("../../ecs/components");
  const { getRoomForEntity } = await import("../../ecs/location");
  const { getCommittedEvents } = await import("../../runtime/committed-events");
  const { captureForegroundDecisionFence } = await import("../../cognition/foreground-action-admission");
  const { buildAgentContext } = await import("../../cognition/agent-mind");
  const { formatActionsForPrompt, getValidActionTypes } = await import("../../cognition/action-registry");
  let demo: Awaited<ReturnType<typeof SpatialDemo.create>> | undefined;
  try {
    const setupAt = performance.now();
    demo = await SpatialDemo.create({ scenario: "town", live: false, automaticClock: false });
    await demo.start();
    const d = demo, world = d.sim.world, source = d.sourceId, initial = d.snapshot();
    const setupMs = performance.now() - setupAt;
    assert.equal(initial.actors.length, 10);
    assert.equal(initial.rooms.length, 8);
    const trips = initial.actors.map(actor => {
      const candidates = initial.rooms.filter(room => room.id !== getRoomForEntity(world, actor.id));
      const target = candidates.sort((a, b) => {
        const entry = (room: typeof a) => TOWN_SPATIAL_BLUEPRINT.rooms.find(r => d.byId.get(r.id) === room.id)!.entry;
        const distance = (room: typeof a) => Math.hypot(entry(room).x - Position.x[actor.id], entry(room).y - Position.y[actor.id]);
        return distance(b) - distance(a);
      })[0];
      return { actor, target };
    });
    const tree = d.byId.get("square-tree-1")!;
    assert.notEqual(tree, undefined);
    const originalTree = { x: Position.x[tree], y: Position.y[tree] };
    const previous = new Map(initial.actors.map(actor => [actor.id, { x: Position.x[actor.id], y: Position.y[actor.id] }]));
    const traveled = new Map(initial.actors.map(actor => [actor.id, 0]));
    const projections = new Map(initial.actors.map(actor => [actor.id, 0]));
    const gaps: number[] = [], projectionCpu: number[] = [], tickCpu: number[] = [];
    const phaseRows: Array<{ tick: number; advance: number; fence: number; context: number; actions: number; types: number;
      routeCalls: number; routeMs: number; total: number }> = [];
    const systemRows: Array<{ tick: number; name: string; synchronousMs: number }> = [];
    for (const system of d.sim.god.systemRegistry.systems.values()) {
      const compiled = system.compiledFn;
      if (!compiled) continue;
      system.compiledFn = (world, context) => {
        const at = performance.now();
        try { return compiled(world, context); }
        finally { systemRows.push({ tick: context.tick, name: system.name, synchronousMs: performance.now() - at }); }
      };
    }
    let routeCalls = 0, routeMs = 0;
    const originalMovementTargets = d.spatial.movementTargets;
    d.spatial.movementTargets = actor => {
      const at = performance.now(); routeCalls++;
      try { return originalMovementTargets(actor); } finally { routeMs += performance.now() - at; }
    };
    let ticks = 0, maxDisplacement = 0, geometryEdited = false, invalidProjection = false, deadlineReached = false;
    const startedAt = performance.now();
    // No warmup is excluded. Cold route admission is both reported separately
    // and charged to total wall time and the first tick gap.
    for (const trip of trips) d.dispatch(trip.actor.key, "move", trip.target.key);
    const admissionMs = performance.now() - startedAt;
    assert.equal(d.actors.filter(actor => d.spatial.busy(actor)).length, 10);
    let lastTickAt = startedAt;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearInterval(interval); clearTimeout(deadline);
        if (error) reject(error); else resolve();
      };
      const interval = setInterval(() => {
        const tickAt = performance.now();
        gaps.push(tickAt - lastTickAt); lastTickAt = tickAt;
        try {
          routeCalls = 0; routeMs = 0;
          // A raw ECS transform change must invalidate derived navigation, not
          // only an adapter registration call. This edge tree stays away from
          // the ten journeys; collision/freshness edge cases have unit gates.
          if (ticks === TICKS / 2) {
            Position.x[tree] = originalTree.x + .5;
            geometryEdited = true;
          }
          const advanceAt = performance.now();
          d.advance(STEP_MS);
          const advanceMs = performance.now() - advanceAt;
          for (const actor of initial.actors) {
            const before = previous.get(actor.id)!;
            const after = { x: Position.x[actor.id], y: Position.y[actor.id] };
            const distance = Math.hypot(after.x - before.x, after.y - before.y);
            maxDisplacement = Math.max(maxDisplacement, distance);
            traveled.set(actor.id, traveled.get(actor.id)! + distance);
            previous.set(actor.id, after);
          }
          // These four production calls formerly repeated seven full room-route
          // searches. Rotate actors while all their positions change, rather
          // than repeatedly measuring one stationary cached actor/menu.
          const actor = initial.actors[ticks % initial.actors.length];
          const projectionAt = performance.now();
          const fence = captureForegroundDecisionFence(world, actor.id);
          const fenceEnd = performance.now();
          const context = buildAgentContext(world, actor.id);
          const contextEnd = performance.now();
          const actions = formatActionsForPrompt(world, actor.id);
          const actionsEnd = performance.now();
          const types = getValidActionTypes(world, actor.id);
          const typesEnd = performance.now();
          projectionCpu.push(typesEnd - projectionAt);
          invalidProjection ||= !fence || !context.length || !actions.length || !types.length;
          projections.set(actor.id, projections.get(actor.id)! + 1);
          ticks++;
          tickCpu.push(performance.now() - tickAt);
          phaseRows.push({ tick: ticks, advance: advanceMs, fence: fenceEnd - projectionAt,
            context: contextEnd - fenceEnd, actions: actionsEnd - contextEnd, types: typesEnd - actionsEnd,
            routeCalls, routeMs, total: tickCpu.at(-1)! });
          if (ticks === TICKS) finish();
          else if (performance.now() - startedAt >= MAX_WALL_MS) { deadlineReached = true; finish(); }
        } catch (error) { finish(error); }
      }, STEP_MS);
      const deadline = setTimeout(() => { deadlineReached = true; finish(); }, Math.max(1, MAX_WALL_MS - admissionMs));
    });
    const elapsedMs = performance.now() - startedAt;
    const stats = {
      gate: "town-foreground-realtime", actors: initial.actors.length, ticks, simulatedMs: d.atSimMs,
      setupMs: rounded(setupMs), admissionMs: rounded(admissionMs), elapsedMs: rounded(elapsedMs),
      realtimeFactor: rounded(d.atSimMs / elapsedMs), tickGapP95Ms: rounded(percentile(gaps, .95)),
      tickGapMaxMs: rounded(Math.max(...gaps)), projectionP95Ms: rounded(percentile(projectionCpu, .95)),
      projectionMaxMs: rounded(Math.max(...projectionCpu)), tickCpuP95Ms: rounded(percentile(tickCpu, .95)),
      tickCpuMaxMs: rounded(Math.max(...tickCpu)), geometryEdited, deadlineReached,
      sourceUnchanged: source === d.sourceId, fetchAttempts,
      phaseP95Ms: Object.fromEntries((["advance", "fence", "context", "actions", "types", "routeMs"] as const)
        .map(phase => [phase, rounded(percentile(phaseRows.map(row => row[phase]), .95))])),
      slowestTicks: [...phaseRows].sort((a, b) => b.total - a.total).slice(0, 5)
        .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, rounded(value)]))),
      slowestSystems: [...systemRows].sort((a, b) => b.synchronousMs - a.synchronousMs).slice(0, 8)
        .map(row => ({ ...row, synchronousMs: rounded(row.synchronousMs) })),
    };
    report("TOWN_PERFORMANCE " + JSON.stringify(stats));

    assert.equal(deadlineReached, false, "bounded wall deadline");
    assert.equal(ticks, TICKS);
    assert.equal(d.atSimMs, TICKS * STEP_MS);
    assert.equal(d.snapshot().tick, TICKS);
    assert.equal(source, d.sourceId);
    assert.equal(geometryEdited, true);
    assert.equal(Position.x[tree], originalTree.x + .5);
    assert.equal(Position.y[tree], originalTree.y);
    assert.equal(invalidProjection, false);
    assert.deepEqual([...projections.values()], Array(10).fill(8));
    assert.ok(maxDisplacement <= 1.25 * STEP_MS / 1000 + 1e-8, "native 1.25m/s speed limit");
    for (const actor of initial.actors) {
      // All destinations are farther than the eight-second walking budget.
      // Keeping the clock responsive must not change physical speed/arrival.
      // Summed endpoint distances can be shorter than the true motor path when
      // a 100ms step rounds a right-angle waypoint, so do not require exactly10m.
      assert.ok(traveled.get(actor.id)! > 9, `${actor.name} made native walking progress`);
      assert.ok(traveled.get(actor.id)! <= 10 + 1e-8, `${actor.name} did not accelerate`);
      assert.equal(WorkingMemoryIdentity.id[actor.id], actor.key);
      assert.equal(d.spatial.busy(actor.id), true, `${actor.name} cannot arrive early`);
    }
    const movement = getCommittedEvents(world).events.filter(e => e.kind === "action" && e.action === "move");
    assert.equal(movement.length, 10);
    for (const trip of trips) {
      const event = movement.find(e => e.actorKey === trip.actor.key)!;
      assert.ok(event);
      assert.deepEqual({ sourceId: event.sourceId, actorId: event.actorId, targetKey: event.targetKey,
        status: event.status, startedAtSimMs: event.startedAtSimMs }, {
        sourceId: source, actorId: trip.actor.id, targetKey: trip.target.key, status: "pending", startedAtSimMs: 0,
      });
    }
    // This leaves headroom for scheduling jitter, but rejects a slowed clock or
    // foreground preparation that regularly consumes an entire 100ms tick.
    assert.ok(d.atSimMs / elapsedMs >= .85, "real-time factor >= 0.85");
    assert.ok(percentile(gaps, .95) <= 160, "p95 tick gap <=160ms");
    assert.ok(Math.max(...gaps) <= 1000, "maximum tick gap <=1000ms");
    assert.ok(percentile(projectionCpu, .95) <= 60, "p95 foreground CPU <=60ms");
    assert.ok(Math.max(...projectionCpu) <= 700, "maximum foreground CPU <=700ms");
    assert.ok(percentile(tickCpu, .95) <= 80, "p95 total tick CPU <=80ms");
    assert.ok(Math.max(...tickCpu) <= 900, "maximum total tick CPU <=900ms");
  } finally {
    try { demo?.stop(); assert.equal(fetchAttempts, 0, "no network attempts"); }
    finally { console.log = report; }
  }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
