/** Presentation time advances only toward an observed simulation timestamp.
 * A stalled poll cannot keep weather moving; duplicate snapshots never renew
 * an interpolation. This clock has no authority over the simulation. */
export function createCommittedEnvironmentClock({ reducedMotion = false } = {}) {
  let source, from = 0, to = 0, receivedAt = 0, duration = 0, previousArrival = null;
  const sample = wallNow => from + (to - from) * (duration ? Math.min(1, Math.max(0, (wallNow - receivedAt) / duration)) : 1);
  return {
    sample,
    sync(snapshot, wallNow) {
      if (!Number.isFinite(snapshot?.atSimMs) || snapshot.atSimMs < 0 || !Number.isFinite(wallNow)) return;
      const reset = source !== snapshot.sourceId;
      if (!reset && snapshot.atSimMs < to) return;
      if (reset || reducedMotion || !snapshot.running) {
        source = snapshot.sourceId; from = to = snapshot.atSimMs; receivedAt = wallNow; duration = 0; previousArrival = wallNow; return;
      }
      if (snapshot.atSimMs === to) return;
      from = sample(wallNow); to = snapshot.atSimMs;
      duration = Math.min(550, Math.max(250, wallNow - (previousArrival ?? wallNow)) + 50);
      receivedAt = previousArrival = wallNow;
    },
  };
}

/** Only a newly observed native state transition animates. Joining a damaged
 * world, changing sources, replacing an identity or reconnecting after a long
 * gap shows the final state, not an invented replay of its incident. */
export function createTreeIncidentPlayback({ reducedMotion = false } = {}) {
  const tracks = new Map();
  let source, previousAt = null;
  return {
    sync(snapshot) {
      const now = snapshot?.atSimMs;
      if (!Number.isFinite(now) || now < 0) return;
      const reset = source !== snapshot.sourceId;
      if (!reset && previousAt !== null && now < previousAt) return;
      if (reset) { tracks.clear(); source = snapshot.sourceId; previousAt = null; }
      const liveTransition = !reducedMotion && snapshot.running && previousAt !== null && now - previousAt <= 2000;
      const present = new Set();
      for (const entity of snapshot.entities ?? []) {
        if (entity.asset !== 'tree') continue;
        present.add(entity.key);
        const previous = tracks.get(entity.key), state = entity.state ?? 'normal';
        const sameIdentity = previous?.id === entity.id;
        const newlyBroken = liveTransition && sameIdentity && previous.state === 'normal' && state === 'branch_damage';
        tracks.set(entity.key, { id: entity.id, state,
          startedAt: newlyBroken ? now : sameIdentity && previous.state === state && snapshot.running ? previous.startedAt : null });
      }
      for (const key of tracks.keys()) if (!present.has(key)) tracks.delete(key);
      previousAt = now;
    },
    sample(key, atSimMs) {
      const track = tracks.get(key);
      if (track?.startedAt == null || track.state !== 'branch_damage' || !Number.isFinite(atSimMs)) return null;
      const progress = Math.min(1, Math.max(0, (atSimMs - track.startedAt) / 2200));
      if (progress === 1) return null;
      const settle = 1 - (1 - progress) ** 3;
      return { progress, settle, recoil: Math.sin(progress * Math.PI * 5) * (1 - progress) * .025,
        branchLift: (1 - settle) * 1.2, branchRotationZ: -.12 + settle * .25 };
    },
  };
}

/** Atmosphere is visual detail, not extra navigable objects or an invented
 * day/night simulation. Its condition comes exclusively from native weather. */
export function skyPresentation(weather) {
  if (!weather || !['clear', 'cloudy', 'rain'].includes(weather.condition)) return null;
  const condition = weather.condition;
  return { condition, sunOpacity: condition === 'clear' ? .92 : condition === 'cloudy' ? .36 : .10,
    cloudCount: condition === 'clear' ? 2 : condition === 'cloudy' ? 5 : 7 };
}

export function rainSegment(site, atSimMs) {
  const seconds = Number.isFinite(atSimMs) ? Math.max(0, atSimMs) / 1000 : 0;
  const y = .08 + ((site.phase * 6 - seconds * site.speed) % 6 + 6) % 6;
  return { bottom: y, top: Math.min(6.08, y + .42) };
}

/** Only published generated output is wetness. Rain, location and an actor's
 * prose are not substitutes for a missing accepted component value. */
export function wetnessPresentation(entity) {
  const value = entity?.wetness;
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return { value, phase: value >= .5 ? 'wet' : value >= .05 ? 'damp' : 'dry', label: value >= .5 ? 'Wet' : value >= .05 ? 'Damp' : '' };
}

/** Apply once after restoring this instance's normal/scenario material. */
export function tintWetMaterial(material, reading) {
  if (!reading) return;
  material.color?.multiplyScalar(1 - reading.value * .24);
  if (Number.isFinite(material.roughness)) material.roughness = material.roughness * (1 - reading.value * .6);
}
