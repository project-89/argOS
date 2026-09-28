import * as THREE from 'three';
import { outdoorRainSites, weatherPresentation } from './view-model.mjs';
import { rainSegment, skyPresentation } from './environment-view.mjs';
import { atmosphereBounds, cloudLayout, cloudDrift, SOLAR_DIRECTION } from './world-atmosphere.mjs';
import { worldTheme } from './theme-view.mjs';

/** Read-only world-space atmosphere. One camera/depth buffer for clouds,
 * buildings and people; mesh detail confers no simulation authority. */
export function createWeatherScene(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group(); root.name = 'world-atmosphere'; root.visible = false; scene.add(root);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zenith: { value: new THREE.Color('#274353') }, horizon: { value: new THREE.Color('#152c36') } },
    vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 zenith;uniform vec3 horizon;varying vec3 vDirection;void main(){float h=smoothstep(-0.55,0.8,normalize(vDirection).y);gl_FragColor=vec4(mix(horizon,zenith,h),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  }));
  sky.name = 'world-atmosphere-dome'; sky.renderOrder = -20; sky.frustumCulled = false; root.add(sky);
  const solarVector = new THREE.Vector3(SOLAR_DIRECTION.x, SOLAR_DIRECTION.y, SOLAR_DIRECTION.z);
  const sun = new THREE.Group(); sun.name = 'world-atmosphere-sun';
  sun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), solarVector.clone().negate()); root.add(sun);
  for (const [radius, opacity] of [[3.6, .04], [2.6, .08], [1.75, .13], [1.1, 1]]) {
    const disc = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 12), new THREE.MeshBasicMaterial({ color: '#ffe5ad',
      transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    disc.userData.baseOpacity = opacity; sun.add(disc);
  }
  // Shared softly rounded geometry; seven solid lobes per cloud, seven clouds
  // at most. Instance matrices supply real X/Y/Z volume, not flattened cards.
  const puffGeometry = new THREE.SphereGeometry(1, 16, 10), positionsAttribute = puffGeometry.getAttribute('position');
  const colors = new Float32Array(positionsAttribute.count * 3), upper = new THREE.Color('#e3e0d5'), lower = new THREE.Color('#536b7a');
  const tint = new THREE.Color();
  for (let i = 0; i < positionsAttribute.count; i++) {
    tint.copy(lower).lerp(upper, THREE.MathUtils.smoothstep(positionsAttribute.getY(i), -.85, .5));
    tint.toArray(colors, i * 3);
  }
  puffGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lobes = [[-2.2, -.1, .2, 1.35, .78, 1.12], [-1.1, .45, -.45, 1.35, 1.2, 1.15],
    [.1, .62, .1, 1.58, 1.4, 1.25], [1.7, .18, .25, 1.35, 1.05, 1.08], [2.65, -.2, -.1, 1.05, .62, .92],
    [-.45, -.35, .9, 1.6, .67, .85], [1.15, -.3, -.85, 1.3, .63, .88]];
  const transform = new THREE.Object3D();
  const clouds = Array.from({ length: 7 }, (_, index) => {
    const material = new THREE.MeshStandardMaterial({ color: '#bac7ca', roughness: 1, metalness: 0, vertexColors: true });
    const cloud = new THREE.InstancedMesh(puffGeometry, material, lobes.length);
    cloud.name = `world-cloud-${index}`; cloud.visible = false; cloud.castShadow = false; cloud.receiveShadow = false;
    lobes.forEach(([x, y, z, sx, sy, sz], i) => {
      transform.position.set(x, y, z); transform.scale.set(sx, sy, sz); transform.rotation.set(0, (i + index) * .27, .03 * (i % 3 - 1));
      transform.updateMatrix(); cloud.setMatrixAt(i, transform.matrix);
    });
    cloud.instanceMatrix.needsUpdate = true; cloud.computeBoundingSphere(); root.add(cloud); return cloud;
  });
  const positions = new Float32Array(240 * 6), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#dfedf0', transparent: true, opacity: .61, depthWrite: false }));
  rain.name = 'committed-outdoor-rain'; rain.frustumCulled = false; rain.visible = false; root.add(rain);
  let signature = '', sites = [], active = false, view = null, bounds = null, layout = [], disposed = false;
  const cloudInCamera = new THREE.Vector3(), focusInCamera = new THREE.Vector3();
  return {
    sync(snapshot) {
      if (disposed) return;
      const weather = weatherPresentation(snapshot);
      const theme = worldTheme(snapshot.scenario);
      const nextSignature = JSON.stringify([snapshot.sourceId, theme?.id, weather, snapshot.rooms.map(room => [room.id, room.bounds, room.environment])]);
      if (signature === nextSignature) return;
      signature = nextSignature; view = skyPresentation(weather); bounds = atmosphereBounds(snapshot.rooms);
      active = !!view && !!bounds; root.visible = active;
      layout = active ? cloudLayout(snapshot.rooms, weather) : [];
      if (bounds) {
        sky.position.set(bounds.x, 0, bounds.z); sky.scale.setScalar(bounds.radius);
        // A compact, stylized solar marker above the clouds, not astronomical
        // distance. It stays fixed in world space and agrees with the key light.
        sun.position.copy(solarVector).multiplyScalar(bounds.altitude * 2.7 / SOLAR_DIRECTION.y)
          .add(new THREE.Vector3(bounds.x, 0, bounds.z));
      }
      sky.material.uniforms.zenith.value.set(view?.condition === 'rain' ? '#344c60' : view?.condition === 'cloudy' ? '#3c5261' : '#274353');
      sky.material.uniforms.horizon.value.set(view?.condition === 'rain' ? '#172735' : view?.condition === 'cloudy' ? '#283c43' : '#152c36');
      if (theme) {
        sky.material.uniforms.zenith.value.lerp(new THREE.Color(theme.zenith), .8);
        sky.material.uniforms.horizon.value.lerp(new THREE.Color(theme.horizon), .65);
      }
      for (const disc of sun.children) {
        disc.material.opacity = disc.userData.baseOpacity * (view?.sunOpacity ?? 0);
        disc.material.color.set(theme?.sunColor ?? '#ffe5ad');
      }
      clouds.forEach((cloud, index) => {
        cloud.visible = !!layout[index]; cloud.material.color.set(view?.condition === 'rain' ? '#899caa' : '#bac7ca');
        if (theme) cloud.material.color.lerp(new THREE.Color(theme.cloudColor), .4);
        // Inspection fading is recomputed in draw, not reset on every weather poll.
        if (layout[index]) { const p = layout[index]; cloud.position.set(p.x, p.y, p.z); cloud.scale.setScalar(p.scale); }
      });
      // Reduced-motion mode keeps a sparse, static rain reading rather than
      // making native rain disappear. Indoor footprints stay masked in either mode.
      sites = outdoorRainSites(snapshot.rooms, weather, reducedMotion ? 60 : 240);
      rain.visible = sites.length > 0; geometry.setDrawRange(0, sites.length * 2);
    },
    draw(atSimMs, { camera, focusPosition, interiors = false } = {}) {
      if (!active) return;
      camera?.updateMatrixWorld();
      if (camera && focusPosition) focusInCamera.copy(focusPosition).applyMatrix4(camera.matrixWorldInverse);
      clouds.forEach((cloud, index) => {
        const p = layout[index]; if (!p) return;
        const drift = cloudDrift(index, atSimMs, reducedMotion); cloud.position.set(p.x + drift.x, p.y, p.z + drift.z);
        let obscures = false;
        if (camera && focusPosition) {
          cloudInCamera.copy(cloud.position).applyMatrix4(camera.matrixWorldInverse);
          obscures = cloudInCamera.z > focusInCamera.z && Math.hypot(cloudInCamera.x - focusInCamera.x, cloudInCamera.y - focusInCamera.y) < 4.5 * p.scale;
        }
        const opacity = obscures ? .14 : interiors ? .28 : 1;
        const transparent = opacity < 1;
        if (cloud.material.transparent !== transparent) { cloud.material.transparent = transparent; cloud.material.needsUpdate = true; }
        cloud.material.opacity = opacity; cloud.material.depthWrite = !transparent;
      });
      if (!rain.visible) return;
      for (let index = 0; index < sites.length; index++) {
        const site = sites[index], offset = index * 6, segment = rainSegment(site, reducedMotion ? 0 : atSimMs);
        positions[offset] = site.x; positions[offset + 1] = segment.bottom; positions[offset + 2] = site.z;
        positions[offset + 3] = site.x; positions[offset + 4] = segment.top; positions[offset + 5] = site.z;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      if (disposed) return; disposed = true; active = false; root.visible = false; scene.remove(root);
      const geometries = new Set(), materials = new Set();
      root.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
      for (const cloud of clouds) cloud.dispose();
      for (const material of materials) material.dispose(); for (const geometry of geometries) geometry.dispose();
    },
    // Read-only diagnostics for offline geometry tests and browser inspection.
    diagnostics: () => ({ active, condition: view?.condition ?? null, cloudCount: clouds.filter(cloud => cloud.visible).length,
      rainSites: sites.map(site => ({ ...site })), rain, clouds, root, sky, sun, bounds, disposed }),
  };
}
