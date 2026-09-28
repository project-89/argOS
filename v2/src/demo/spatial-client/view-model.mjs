/** Pure presentation math. The endpoints must both come from committed snapshots.
 * In particular an expected end/target/plan is not a physical position. */
export function interpolateConfirmedPosition(from, to, fraction) {
  if (![from.x, from.y, from.z, to.x, to.y, to.z, fraction].every(Number.isFinite)) throw new Error('Invalid committed position');
  const t = Math.min(1, Math.max(0, fraction));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
}

/** Clips only depict source evidence; an admitted move is not evidence of progress. */
export function animationFor(entity, confirmedMoving) {
  if (/^(sitting|seated)$/i.test(entity.state ?? '')) return 'sit';
  if (confirmedMoving) return 'walk';
  const action = entity.activity?.status === 'pending' ? entity.activity.action : '';
  if (/pickup|pick.up/.test(action)) return 'pick-up';
  if (/read|type|typing|phone|interact|use/.test(action)) return 'interact-right';
  return 'idle';
}

/** Rig-only transition. Resuming a walk preserves the existing cycle rather than
 * repeatedly planting the same first foot when a snapshot arrives late. */
export function setPresentationAnimation(node, name, { loopOnce, loopRepeat }) {
  if (!node.mixer || node.animation === name) return;
  const clip = node.clips.find(candidate => candidate.name === name) || node.clips.find(candidate => candidate.name === 'idle');
  if (!clip) return;
  node.action?.fadeOut(.16);
  const next = node.mixer.clipAction(clip);
  if (name !== 'walk') next.reset();
  next.enabled = true; next.paused = false;
  next.fadeIn(.16).play();
  if (name === 'pick-up') { next.setLoop(loopOnce, 1); next.clampWhenFinished = true; }
  else next.setLoop(loopRepeat, Infinity);
  node.action = next; node.animation = name;
}

/** A pickup request is not possession. Only an existing confirmed actor holder
 * permits the phone's presentation mesh to follow a hand. */
export function confirmedPhoneHolder(entity, entities) {
  if (entity.asset !== 'phone' || !Number.isInteger(entity.heldBy)) return undefined;
  return entities.find(candidate => candidate.kind === 'actor' && candidate.id === entity.heldBy);
}

/** A small arrival-cadence buffer for committed positions, not a prediction of
 * movement. Simulation deltas can alternate 200/300ms under a 250ms poll; using
 * them as animation durations creates an artificial stop on every short sample.
 * A duplicate cannot snap, restart, or extend a track. A missing update can only
 * finish the already-confirmed displacement (within 550ms), then hold still. */
export function createConfirmedMotionPlayback({ reducedMotion = false } = {}) {
  const tracks = new Map();
  let source, sourceAt = null, receivedAt = null, cadenceMs = 250;
  const samePosition = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
  const sample = (key, wallNow) => {
    const track = tracks.get(key); if (!track) return null;
    const fraction = track.duration ? Math.min(1, Math.max(0, (wallNow - track.receivedAt) / track.duration)) : 1;
    const yawDelta = Math.atan2(Math.sin(track.toYaw - track.fromYaw), Math.cos(track.toYaw - track.fromYaw));
    return { position: interpolateConfirmedPosition(track.from, track.to, fraction), yaw: track.fromYaw + yawDelta * fraction,
      moving: fraction < 1 && Math.hypot(track.to.x - track.from.x, track.to.z - track.from.z) > .001 };
  };
  return {
    sync(snapshot, wallNow) {
      if (!Number.isFinite(wallNow) || !Number.isFinite(snapshot.atSimMs)) throw new Error('Invalid playback timestamp');
      const reset = source !== snapshot.sourceId;
      if (!reset && sourceAt !== null && snapshot.atSimMs < sourceAt) return;
      if (reset) { tracks.clear(); source = snapshot.sourceId; sourceAt = null; receivedAt = null; cadenceMs = 250; }
      const advanced = sourceAt !== null && snapshot.atSimMs > sourceAt;
      // The regular poll waits 250ms; action receipts can refresh sooner. Those
      // extra samples must not collapse the next regular interpolation window.
      if (advanced && receivedAt !== null && wallNow > receivedAt) cadenceMs = Math.min(500, Math.max(250, wallNow - receivedAt));
      // Stop and reduced motion explicitly settle to the newest committed state.
      const duration = !reducedMotion && snapshot.running && sourceAt !== null
        ? Math.min(550, cadenceMs + Math.min(50, cadenceMs * .2)) : 0;
      const present = new Set(snapshot.entities.map(entity => entity.key));
      for (const key of tracks.keys()) if (!present.has(key)) tracks.delete(key);
      for (const entity of snapshot.entities) {
        const target = entity.position;
        if (![target.x, target.y, target.z].every(Number.isFinite)) throw new Error('Invalid committed position');
        let track = tracks.get(entity.key);
        if (!track) {
          const yaw = entity.rotationY ?? 0;
          track = { from: { ...target }, to: { ...target }, fromYaw: yaw, toYaw: yaw, receivedAt: wallNow, duration: 0 };
          tracks.set(entity.key, track);
        } else if (!samePosition(target, track.to)) {
          const shown = sample(entity.key, wallNow), dx = target.x - shown.position.x, dz = target.z - shown.position.z;
          track.from = shown.position; track.to = { ...target }; track.fromYaw = shown.yaw;
          track.toYaw = entity.rotationY ?? (entity.kind === 'actor' && Math.hypot(dx, dz) > .001 ? Math.atan2(dx, dz) : track.toYaw);
          track.receivedAt = wallNow; track.duration = duration;
        } else if (entity.rotationY !== undefined && entity.rotationY !== track.toYaw) {
          track.fromYaw = sample(entity.key, wallNow).yaw; track.toYaw = entity.rotationY;
        }
        if (!duration) { track.from = { ...target }; track.to = { ...target }; track.fromYaw = track.toYaw; track.duration = 0; }
      }
      if (sourceAt === null || advanced) receivedAt = wallNow;
      sourceAt = snapshot.atSimMs;
    },
    sample,
  };
}

/** Native readings only. Missing/bad telemetry is not zero hunger/full energy,
 * and an action label is never evidence that eating or resting has completed. */
export function nativeNeeds(actor) {
  const needs = actor?.needs;
  if (!needs || ![needs.hunger, needs.energy].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  return { hunger: needs.hunger, energy: needs.energy };
}

/** Native ObjectState only. A proposal, narration or future intention cannot
 * break a tree in the view. Decorations add neither collision nor affordances. */
export function treeStatePresentation(entity) {
  if (entity?.asset !== 'tree') return null;
  if (entity.state === 'branch_damage') return { state: 'branch_damage', canopyHeight: .86, canopyScaleY: .86, leafColor: '#9b9565',
    // A small broken limb leaning against the trunk, entirely inside its
    // existing ±.3m collider footprint. Not a fallen tree across a path.
    branch: { size: [.07, .64, .07], position: [.2, .42, .11], rotationZ: .13 } };
  if (entity.state === 'pruned') return { state: 'pruned', canopyHeight: .9, canopyScaleY: .7, leafColor: null, branch: null };
  return { state: 'normal', canopyHeight: 1, canopyScaleY: 1, leafColor: null, branch: null };
}

const weatherConditions = new Set(['clear', 'cloudy', 'rain']);
const changeLabels = Object.freeze({ proposed: 'Proposed', approved: 'Approved', applied: 'Applied', rejected: 'Rejected', failed: 'Failed', used: 'Used', observed: 'Observed' });
const viewText = (value, limit = 320) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

/** Public renderer state. Private spirit reports and proposed weather never
 * supply a physical effect; this works unchanged on the stripped scene feed. */
export function weatherPresentation(snapshot) {
  const sourceNow = snapshot?.atSimMs, rawWeather = snapshot?.weather;
  if (!Number.isFinite(sourceNow) || sourceNow < 0 || !rawWeather || !weatherConditions.has(rawWeather.condition)
    || !Number.isSafeInteger(rawWeather.revision) || rawWeather.revision < 0
    || !Number.isFinite(rawWeather.changedAtSimMs) || rawWeather.changedAtSimMs < 0 || rawWeather.changedAtSimMs > sourceNow) return null;
  return { condition: rawWeather.condition, label: { clear: 'Clear skies', cloudy: 'Cloudy', rain: 'Rain' }[rawWeather.condition],
    revision: rawWeather.revision, changedAtSimMs: rawWeather.changedAtSimMs,
    ...(Array.isArray(rawWeather.rooms) ? { rooms: rawWeather.rooms.slice(0, 64).filter(room => Number.isSafeInteger(room?.roomId)
      && room.roomId >= 0 && weatherConditions.has(room?.condition)).map(room => ({ roomId: room.roomId, condition: room.condition })) } : {}) };
}

/** Operator-only projection. A proposal/approval is never relabeled as an
 * applied change, and an applied change is not proof an NPC actually used it.
 * No retained state: changing sources cannot inherit the former world's feed. */
export function townLifePresentation(snapshot) {
  const life = snapshot?.townLife;
  if (!life || typeof life.enabled !== 'boolean') return null;
  const sourceNow = snapshot.atSimMs, weather = weatherPresentation(snapshot);
  const spirits = (Array.isArray(life.spirits) ? life.spirits : []).slice(0, 12).map(spirit => ({
    name: viewText(spirit?.name, 60), status: viewText(spirit?.status, 100),
  })).filter(spirit => spirit.name && spirit.status);
  const changes = new Map();
  for (const change of (Array.isArray(life.changes) ? life.changes : []).slice(-128)) {
    const id = viewText(change?.id, 160), spirit = viewText(change?.spirit, 60), summary = viewText(change?.summary);
    if (!id || !spirit || !summary || !Object.hasOwn(changeLabels, change?.status)
      || !Number.isFinite(change.atSimMs) || change.atSimMs < 0 || change.atSimMs > sourceNow) continue;
    changes.set(id, { id, spirit, summary, status: change.status, label: changeLabels[change.status], atSimMs: change.atSimMs });
  }
  const remaining = Number.isSafeInteger(life.growth?.remaining) && life.growth.remaining >= 0 ? life.growth.remaining : null;
  const nonnegativeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const rawMechanic = life.mechanic;
  const mechanic = rawMechanic && viewText(rawMechanic.status, 80) ? { status: viewText(rawMechanic.status, 80),
    summary: viewText(rawMechanic.summary, 500), remaining: nonnegativeCount(rawMechanic.remaining) } : null;
  const rawStory = life.story, style = viewText(rawStory?.style, 80), premise = viewText(rawStory?.premise, 600);
  const reviewed = Number.isFinite(sourceNow) && sourceNow >= 0 && Number.isFinite(rawStory?.lastReviewAtSimMs)
    && rawStory.lastReviewAtSimMs >= 0 && rawStory.lastReviewAtSimMs <= sourceNow;
  // An authored brief is available before any review. A phase/tension readout
  // is a Narrator interpretation, never evidence that an event was applied.
  const story = style && premise ? { style, premise,
    lastReviewAtSimMs: reviewed ? rawStory.lastReviewAtSimMs : null,
    phase: reviewed ? viewText(rawStory.phase, 80) : '',
    tension: reviewed && Number.isFinite(rawStory.tension) && rawStory.tension >= 0 && rawStory.tension <= 1 ? rawStory.tension : null,
    observedEvents: reviewed ? nonnegativeCount(rawStory.observedEvents) : null,
    interventions: reviewed ? nonnegativeCount(rawStory.interventions) : null,
    remainingEvents: nonnegativeCount(rawStory.remainingEvents),
  } : null;
  return { sourceId: snapshot.sourceId, enabled: life.enabled, summary: viewText(life.summary), weather, spirits,
    changes: [...changes.values()].sort((a, b) => b.atSimMs - a.atSimMs).slice(0, 6),
    growth: { remaining, summary: viewText(life.growth?.summary) }, story, mechanic };
}

/** A bounded cosmetic rain footprint. Only confirmed rainy outdoor rooms get
 * drops; indoor footprints remain dry even when their roofs are cut away. */
export function outdoorRainSites(rooms, weather, requestedCount = 192) {
  if (weather?.condition !== 'rain') return [];
  const validBounds = room => room?.bounds && [room.bounds.x, room.bounds.z, room.bounds.width, room.bounds.depth].every(Number.isFinite)
    && room.bounds.width > 0 && room.bounds.depth > 0;
  const inside = (x, z, bounds) => x >= bounds.x && x <= bounds.x + bounds.width && z >= bounds.z && z <= bounds.z + bounds.depth;
  const indoor = rooms.filter(room => room.environment === 'indoor' && validBounds(room));
  const rainRooms = weather.rooms ? new Set(weather.rooms.filter(room => room.condition === 'rain').map(room => room.roomId)) : null;
  const outside = rooms.filter(room => room.environment === 'outdoor' && validBounds(room) && (!rainRooms || rainRooms.has(room.id)));
  const area = outside.reduce((sum, room) => sum + room.bounds.width * room.bounds.depth, 0);
  const count = Number.isFinite(requestedCount) ? Math.min(240, Math.max(0, Math.floor(requestedCount))) : 0;
  if (!area || !Number.isFinite(area) || !count) return [];
  const sites = [];
  for (let attempt = 0; attempt < count * 4 && sites.length < count; attempt++) {
    let selection = ((attempt + .5) * .61803398875 % 1) * area, room = outside[0];
    for (const candidate of outside) { room = candidate; selection -= room.bounds.width * room.bounds.depth; if (selection <= 0) break; }
    const { x, z, width, depth } = room.bounds;
    const px = x + width * (.04 + ((attempt + 1) * .754877666 % 1) * .92);
    const pz = z + depth * (.04 + ((attempt + 1) * .569840291 % 1) * .92);
    if (indoor.some(candidate => inside(px, pz, candidate.bounds))) continue;
    sites.push({ x: px, z: pz, phase: (attempt * .38196601125) % 1, speed: 3.8 + (attempt % 5) * .18 });
  }
  return sites;
}

/** Admission is not completion. The legacy synchronous executor reports a final
 * action suffix, while timed actions have dedicated terminal event kinds. */
export function latestNativeOutcome(events) {
  return [...events].reverse().find(event => ['completed', 'failed'].includes(event.kind)
    || event.kind === 'action' && / · (completed|failed)$/.test(event.text));
}

export function operatorActionTargets(state, actionType, actorId) {
  return actionType === 'move' ? state.rooms.map(room => ({ key: room.key, name: room.name }))
    : state.entities.filter(entity => entity.kind !== 'actor' && entity.asset !== 'wall'
      && (actionType !== 'drop' || entity.heldBy === actorId));
}

/** Source time decides eligibility; wall time lets a frozen/disconnected view
 * fade out. Re-reading an identical snapshot never renews a bubble's lifetime. */
export function createSceneCueTracker() {
  let source;
  const seen = new Map();
  return {
    sync(snapshot, wallNow) {
      if (source !== snapshot.sourceId) { seen.clear(); source = snapshot.sourceId; }
      const present = new Set(snapshot.entities.map(e => e.key)), active = new Set();
      for (const cue of (snapshot.cues ?? []).slice(-64)) {
        if (!snapshot.running || !present.has(cue.entityKey) || typeof cue.id !== 'string'
          || !['speech', 'action', 'sound'].includes(cue.kind) || typeof cue.text !== 'string' || !cue.text.trim()
          || ![cue.atSimMs, cue.updatedAtSimMs, cue.expiresAtSimMs, snapshot.atSimMs].every(Number.isFinite)
          || cue.atSimMs < 0 || cue.atSimMs > cue.updatedAtSimMs || cue.updatedAtSimMs > snapshot.atSimMs
          || cue.expiresAtSimMs <= snapshot.atSimMs) continue;
        active.add(cue.id);
        const revision = JSON.stringify([cue.entityKey, cue.updatedAtSimMs, cue.expiresAtSimMs, cue.text]);
        const prior = seen.get(cue.id);
        if (!prior || prior.revision !== revision) seen.set(cue.id, { revision, cue: { ...cue },
          until: wallNow + Math.min(10000, cue.expiresAtSimMs - snapshot.atSimMs) });
        else prior.until = Math.min(prior.until, wallNow + cue.expiresAtSimMs - snapshot.atSimMs);
      }
      for (const [id, row] of seen) if (!active.has(id)) row.until = Math.min(row.until, wallNow);
      while (seen.size > 512) seen.delete(seen.keys().next().value);
    },
    visible(wallNow) { return [...seen.values()].filter(row => row.until > wallNow).map(row => row.cue); },
  };
}
