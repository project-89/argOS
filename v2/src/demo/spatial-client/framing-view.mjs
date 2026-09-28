/** Read-only presentation bounds, in the renderer's X/Z ground plane. */
export function roomExtents(rooms = []) {
  const valid = rooms.map(room => room?.bounds).filter(bounds => bounds
    && [bounds.x, bounds.z, bounds.width, bounds.depth].every(Number.isFinite)
    && bounds.width > 0 && bounds.depth > 0);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map(b => b.x)), maxX = Math.max(...valid.map(b => b.x + b.width));
  const minZ = Math.min(...valid.map(b => b.z)), maxZ = Math.max(...valid.map(b => b.z + b.depth));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/** The initial source gets an overview; ordinary polling/growth never steals
 * the operator's orbit, pan, zoom or follow choice. Overview is an explicit reset. */
export function shouldInitializeOverview(previous, next) {
  return !!roomExtents(next?.rooms) && (!previous || previous.sourceId !== next.sourceId || !roomExtents(previous.rooms));
}

export function roomViewSignature(room) {
  return JSON.stringify([room.name, room.bounds, room.floor, room.environment, room.building]);
}

/** Native meshes (including canopy envelopes and exterior walls) may extend a
 * little beyond floor rectangles. Fit their committed bounds as well. */
function visualExtents(rooms, entities) {
  const envelopes = entities.flatMap(entity => {
    const p = entity.position, s = entity.size;
    if (!p || !s || ![p.x, p.z, s.x, s.z].every(Number.isFinite) || s.x <= 0 || s.z <= 0) return [];
    const yaw = Number.isFinite(entity.rotationY) ? entity.rotationY : 0;
    const width = Math.abs(Math.cos(yaw)) * s.x + Math.abs(Math.sin(yaw)) * s.z;
    const depth = Math.abs(Math.sin(yaw)) * s.x + Math.abs(Math.cos(yaw)) * s.z;
    return [{ bounds: { x: p.x - width / 2, z: p.z - depth / 2, width, depth } }];
  });
  return roomExtents([...rooms, ...envelopes]);
}

/** Fit all eight corners of the current world's visual box, not a hardcoded
 * apartment width. The camera direction is fixed only for an overview reset. */
export function overviewFrame(rooms, entities, viewportWidth, viewportHeight) {
  const extents = visualExtents(rooms ?? [], entities ?? []) ?? { minX: -2, maxX: 2, minZ: -2, maxZ: 2, width: 4, depth: 4 };
  const width = Math.max(1, viewportWidth), height = Math.max(1, viewportHeight), halfHeight = 8.8;
  const sceneHeight = Math.max(2, ...(entities ?? []).map(entity => Number.isFinite(entity.position?.y) && Number.isFinite(entity.size?.y)
    ? Math.max(0, entity.position.y + entity.size.y) : 0));
  const magnitude = Math.hypot(15, 19, 21), horizontal = Math.hypot(15, 21);
  const direction = { x: 15 / magnitude, y: 19 / magnitude, z: 21 / magnitude };
  const right = { x: 21 / horizontal, y: 0, z: -15 / horizontal };
  const up = { x: -direction.y * 15 / horizontal, y: horizontal / magnitude, z: -direction.y * 21 / horizontal };
  const projectedWidth = Math.abs(right.x) * extents.width + Math.abs(right.z) * extents.depth;
  const projectedHeight = Math.abs(up.x) * extents.width + up.y * sceneHeight + Math.abs(up.z) * extents.depth;
  const usableWidth = Math.max(width * .6, width - 70), usableHeight = Math.max(height * .5, height - 230);
  const zoom = Math.min(1.35, 2 * halfHeight * (width / height) * (usableWidth / width) / projectedWidth,
    2 * halfHeight * (usableHeight / height) / projectedHeight);
  const radius = Math.hypot(extents.width, sceneHeight, extents.depth) / 2;
  const distance = Math.max(28, radius * 3);
  const center = { x: (extents.minX + extents.maxX) / 2, y: sceneHeight / 2, z: (extents.minZ + extents.maxZ) / 2 };
  return { extents, center, right, up, direction, zoom, distance, far: distance + radius * 3 + 20,
    halfHeight, projectedWidth, projectedHeight };
}

/** Clear residual orbit/pan damping before an explicit camera reset. Otherwise
 * a mathematically fitted view can keep drifting out of frame afterward. */
export function applyOverviewFrame(camera, controls, frame) {
  const damping = controls.enableDamping;
  controls.enableDamping = false; controls.update();
  controls.target.set(frame.center.x, frame.center.y, frame.center.z);
  camera.position.set(frame.center.x + frame.direction.x * frame.distance,
    frame.center.y + frame.direction.y * frame.distance, frame.center.z + frame.direction.z * frame.distance);
  camera.zoom = frame.zoom; camera.far = frame.far;
  controls.minZoom = Math.min(.4, frame.zoom * .35);
  camera.updateProjectionMatrix(); controls.update(); controls.enableDamping = damping;
  camera.updateMatrixWorld(true);
}

const actorPalette = ['#c6db91', '#acd0d5', '#e8b790', '#c9b5e2', '#88bca7', '#d3c878', '#d698a5', '#a6bedf', '#dda975', '#b6c8b0'];
/** Stable presentation color, not inferred identity, clothing or world state. */
export function actorAccent(entity) {
  if (/^#[\da-f]{6}$/i.test(entity?.color ?? '')) return entity.color;
  let hash = 0; for (const letter of String(entity?.key ?? entity?.name ?? 'resident')) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return actorPalette[hash % actorPalette.length];
}

/** Offscreen speech stays offscreen instead of being clamped into another
 * character's close-up while the operator follows someone across town. */
export function isProjectedPointVisible(point) {
  return [point.x, point.y, point.z].every(Number.isFinite)
    && Math.abs(point.x) <= 1.08 && Math.abs(point.y) <= 1.08 && point.z >= -1 && point.z <= 1;
}
