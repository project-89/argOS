/** Inhabit camera math (pure). Third-person over-the-shoulder or first-person
 * eyes, driven by a yaw/pitch that mouse, pointer-lock or (later) an XR head
 * pose supplies. three.js conventions: yaw 0 looks toward -Z. */

export const VIEWS = Object.freeze(['third', 'first']);
const PITCH = { third: [-0.75, 0.42], first: [-1.2, 1.2] };

export function createLookState({ yaw = 0, pitch = -0.2, view = 'third' } = {}) {
  return { yaw, pitch, view: VIEWS.includes(view) ? view : 'third' };
}

/** Character roots face +Z at rotationY 0; the camera looks along the body. */
export function yawBehind(bodyRotationY = 0) {
  return wrapAngle((Number.isFinite(bodyRotationY) ? bodyRotationY : 0) + Math.PI);
}

export function wrapAngle(angle) {
  const turn = Math.PI * 2;
  return ((angle + Math.PI) % turn + turn) % turn - Math.PI;
}

/** Pointer movement in CSS pixels → new look. Pitch is clamped per view. */
export function applyLook(look, movementX, movementY, sensitivity = 0.0032) {
  const [minPitch, maxPitch] = PITCH[look.view] ?? PITCH.third;
  const yaw = wrapAngle(look.yaw - (Number(movementX) || 0) * sensitivity);
  const pitch = Math.max(minPitch, Math.min(maxPitch, look.pitch - (Number(movementY) || 0) * sensitivity));
  return { ...look, yaw, pitch };
}

export function toggleView(look) {
  const view = look.view === 'third' ? 'first' : 'third';
  const [minPitch, maxPitch] = PITCH[view];
  return { ...look, view, pitch: Math.max(minPitch, Math.min(maxPitch, look.pitch)) };
}

/** Camera position and look-at target for a body standing at `body` (ground
 * point) with height `height`. Third person sits behind the right shoulder. */
export function cameraPose(body, height, look, { distance = 3.6, shoulder = 0.62, indoor = false } = {}) {
  const h = Number.isFinite(height) && height > 0 ? height : 1.65;
  const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw);
  const rx = Math.cos(look.yaw), rz = -Math.sin(look.yaw);
  const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
  if (look.view === 'first') {
    const eye = { x: body.x + fx * 0.08, y: body.y + h * 0.93, z: body.z + fz * 0.08 };
    return { position: eye, target: { x: eye.x + fx * cp * 10, y: eye.y + sp * 10, z: eye.z + fz * cp * 10 }, hideBody: true };
  }
  // Pull in closer indoors so the camera stays inside small rooms.
  const reach = indoor ? distance * 0.72 : distance;
  const pivot = { x: body.x + rx * shoulder, y: body.y + h * 0.9, z: body.z + rz * shoulder };
  const position = { x: pivot.x - fx * cp * reach, y: Math.max(body.y + 0.35, pivot.y - sp * reach + 0.35), z: pivot.z - fz * cp * reach };
  const target = { x: pivot.x + fx * cp * 4, y: pivot.y + sp * 4, z: pivot.z + fz * cp * 4 };
  return { position, target, pivot, hideBody: false };
}

/** Camera collision: when something solid lies `hitDistance` along the ray
 * from the pivot (head) to the desired camera position, stop just short of it. */
export function pullIn(pivot, position, hitDistance, { margin = 0.22, minimum = 0.3 } = {}) {
  const dx = position.x - pivot.x, dy = position.y - pivot.y, dz = position.z - pivot.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0) || !Number.isFinite(hitDistance) || hitDistance >= length) return position;
  const reach = Math.max(minimum, hitDistance - margin) / length;
  return { x: pivot.x + dx * reach, y: pivot.y + dy * reach, z: pivot.z + dz * reach };
}

/** Frame-rate independent smoothing factor for a time constant in seconds. */
export function smoothing(deltaSeconds, timeConstant = 0.12) {
  if (!(deltaSeconds > 0)) return 0;
  if (!(timeConstant > 0)) return 1;
  return 1 - Math.exp(-deltaSeconds / timeConstant);
}
