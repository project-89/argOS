/** Public room metadata chooses the surface. The legacy street-name fallback
 * remains for older snapshots; explicit indoor metadata always takes priority. */
export function outdoorRoom(room) {
  return room.environment === 'outdoor' || room.environment === undefined && /street|outside|lane/i.test(room.name);
}

/** Decorative paths stay inside observed room bounds. They neither create
 * navigable terrain nor promise passage across unregistered gaps. */
export function outdoorPaths(room) {
  if (!outdoorRoom(room)) return [];
  const { x, z, width, depth } = room.bounds;
  if (![x, z, width, depth].every(Number.isFinite) || width <= .4 || depth <= .4) return [];
  const pathWidth = Math.min(1.05, width * .3, depth * .3);
  return [
    { size: [width - .3, .012, pathWidth], position: [x + width / 2, .004, z + depth / 2] },
    { size: [pathWidth, .014, depth - .3], position: [x + width / 2, .005, z + depth / 2] },
  ];
}

/** Low-poly ornamental tree proportions, contained in its visible envelope.
 * Native physics owns the narrower trunk collider, not this geometry. */
export function treeShape(size) {
  const width = Math.max(.1, size.x), height = Math.max(.1, size.y), depth = Math.max(.1, size.z);
  return { trunk: { radius: Math.min(width, depth) * .10, height: height * .62 },
    canopy: { center: [0, height * .74, 0], scale: [width * .5, height * .26, depth * .5] },
    lowerCanopy: { center: [-width * .10, height * .60, depth * .06], scale: [width * .38, height * .22, depth * .40] } };
}
