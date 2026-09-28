/** WebXR entry point — a stub. Detection is real; the immersive session is a
 * follow-up task.
 *
 * TODO(webxr): implement `enterImmersiveVR` as Inhabit with an XR camera:
 *   1. `renderer.xr.enabled = true`; request `navigator.xr.requestSession('immersive-vr',
 *      { optionalFeatures: ['local-floor', 'hand-tracking'] })` and `renderer.xr.setSession(session)`.
 *   2. Parent the XR camera rig to the controlled body's root (first-person eyes; see
 *      `cameraPose` in inhabit-camera.mjs), using the head pose's yaw as `look.yaw`.
 *   3. Drive the body only through the shared facade from inhabit-controls.mjs:
 *      thumbstick → `walkVector({forward, strafe}, headYaw)` → `controls.walk(dx, dy)` via
 *      `createWalkSender`; trigger on a nearby target → `controls.interact(verb, key)` using
 *      `interactOptions(control.nearby)`; grip-to-talk → `createPushToTalk` → `controls.say(text)`.
 *   4. Show subtitles on a head-locked plane (CanvasTexture) fed by the same subtitle queue.
 *   5. `renderer.setAnimationLoop` replaces requestAnimationFrame while presenting.
 */

export async function detectImmersiveVR(xr = globalThis.navigator?.xr) {
  try { return !!(xr && await xr.isSessionSupported('immersive-vr')); }
  catch { return false; }
}

export async function enterImmersiveVR() {
  throw new Error('VR is detected on this device, but immersive Inhabit is not built yet.');
}
