import { roomExtents } from './framing-view.mjs';
import { skyPresentation } from './environment-view.mjs';

const length = Math.hypot(-.45, 1.6, .55);
/** One art-directed light direction, not an invented day/night clock. */
export const SOLAR_DIRECTION = Object.freeze({ x: -.45 / length, y: 1.6 / length, z: .55 / length });
export const ENVIRONMENT_FAR = 1200;

export function atmosphereBounds(rooms) {
  const b = roomExtents(rooms); if (!b) return null;
  return { ...b, x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
    radius: Math.min(480, Math.max(150, Math.hypot(b.width, b.depth) * 4)),
    altitude: Math.min(16, Math.max(11.5, Math.max(b.width, b.depth) * .2)) };
}

/** Decorative clusters are seeded from room placement, not fresh random values
 * on each poll. They add no entities, colliders, weather cells or wind force. */
export function cloudLayout(rooms, weather) {
  const bounds = atmosphereBounds(rooms), view = skyPresentation(weather); if (!bounds || !view) return [];
  const conditions = new Map(weather.rooms?.map(row => [row.roomId, row.condition]) ?? []);
  const outside = rooms.filter(room => room.environment === 'outdoor' && roomExtents([room]));
  const selected = weather.condition === 'rain' && conditions.size
    ? outside.filter(room => conditions.get(room.id) === 'rain') : outside;
  if (!selected.length) return [];
  const anchors = [[.18, .28], [.78, .7], [.49, .48], [.82, .18], [.25, .82], [.56, .13], [.63, .84]];
  return Array.from({ length: view.cloudCount }, (_, i) => {
    const room = selected[i % selected.length], b = room.bounds, [x, z] = anchors[i];
    return { x: b.x + x * b.width, z: b.z + z * b.depth,
      y: bounds.altitude + i % 3 * 1.35, scale: .82 + i % 3 * .13, roomId: room.id, phase: i * 1.7 };
  });
}

export function cloudDrift(index, atSimMs, reducedMotion) {
  if (reducedMotion || !Number.isFinite(atSimMs)) return { x: 0, z: 0 };
  return { x: Math.sin(atSimMs * .000018 + index * 1.7) * .85,
    z: Math.sin(atSimMs * .000012 + index * .8) * .38 };
}
